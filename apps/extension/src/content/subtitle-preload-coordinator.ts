import type { TranslateBatchRequest } from "@dual-subtitles/shared";
import { ServerClient } from "../client/server-client";
import {
  SubtitlePreloadManager,
  type PreloadBatchRequest,
  type PreloadCue,
  type PreloadedCueTranslation,
  type SubtitlePreloadStatus,
} from "../core/preload";
import { detectLanguageHint, normalizeDetectedText } from "../core/text";
import { querySelectorAllOpen } from "../dom/open-shadow-dom";
import {
  TimedTextTrackCapture,
  type BridgeCaptureStats,
  type CapturedSubtitleTrack,
  type Cue,
} from "../tracks";
import type { ExtensionSettings, PlatformId, TranslationResponse } from "../types";

const PLAYBACK_POLL_MS = 250;
const PRELOAD_BACKGROUND_BATCH_SIZE = 16;
const PRELOAD_FOREGROUND_BATCH_SIZE = 6;
const PRELOAD_FOREGROUND_WINDOW_MS = 30_000;
const PRELOAD_CONCURRENCY = 3;
const PRELOAD_LOOK_AHEAD_MS = 180_000;
const ACTIVE_CUE_TOLERANCE_MS = 750;
const TRACK_MATCH_WINDOW_MS = 10_000;
const PLAYBACK_VIDEO_RESCAN_MS = 1_000;
const TRACK_STABILIZATION_MS = 400;

export interface SubtitlePreloadCoordinatorEvents {
  onTranslation: (text: string, response: TranslationResponse) => void;
  onStatusChange?: () => void;
}

export interface CaptureDiagnostics {
  bridge: (BridgeCaptureStats & { receivedAt: number }) | null;
  tracks: Array<{
    trackId: string;
    cues: number;
    language?: string;
    label?: string;
    activeHint?: boolean;
  }>;
}

export class SubtitlePreloadCoordinator {
  private readonly capture: TimedTextTrackCapture;
  private manager: SubtitlePreloadManager;
  private client: ServerClient;
  private settings: ExtensionSettings;
  private platform: PlatformId = "generic";
  private activeTrack: CapturedSubtitleTrack | null = null;
  private currentText = "";
  private currentCue: Cue | null = null;
  private lastDeliveredKey = "";
  private lastPreloadError: string | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private trackStabilizationTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeCapture: (() => void) | null = null;
  private playbackVideo: HTMLVideoElement | null = null;
  private playbackVideoSelectedAt = 0;
  private selectionPaused = false;
  private started = false;

  constructor(
    settings: ExtensionSettings,
    private readonly events: SubtitlePreloadCoordinatorEvents,
    private readonly documentRoot: Document = document,
  ) {
    this.settings = settings;
    this.capture = new TimedTextTrackCapture(documentRoot);
    this.client = new ServerClient(settings.serverUrl, settings.requestTimeoutMs);
    this.manager = this.createManager();
  }

  start(platform: PlatformId): void {
    if (this.started) return;
    this.started = true;
    this.platform = platform;
    this.selectionPaused = !this.settings.enabled || !this.settings.platforms[platform];
    this.unsubscribeCapture = this.capture.subscribe((track) => this.handleTrack(track));
    this.applyEnabledState();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.selectionPaused = true;
    this.clearTrackStabilizationTimer();
    this.stopPolling();
    this.capture.stop();
    this.unsubscribeCapture?.();
    this.unsubscribeCapture = null;
    this.manager.dispose();
  }

  reset(platform: PlatformId): void {
    this.platform = platform;
    this.selectionPaused = !this.settings.enabled || !this.settings.platforms[platform];
    this.clearTrackStabilizationTimer();
    this.currentText = "";
    this.currentCue = null;
    this.activeTrack = null;
    this.lastDeliveredKey = "";
    this.lastPreloadError = null;
    this.capture.clear();
    this.manager.cancel();
    this.events.onStatusChange?.();
  }

  pause(): void {
    this.selectionPaused = true;
    this.clearTrackStabilizationTimer();
    this.currentText = "";
    this.currentCue = null;
    this.activeTrack = null;
    this.lastDeliveredKey = "";
    this.lastPreloadError = null;
    this.manager.cancel();
    this.events.onStatusChange?.();
  }

  updateSettings(settings: ExtensionSettings): void {
    const serverChanged =
      settings.serverUrl !== this.settings.serverUrl ||
      settings.requestTimeoutMs !== this.settings.requestTimeoutMs;
    const enabledChanged = settings.preloadEnabled !== this.settings.preloadEnabled;
    this.settings = settings;
    this.selectionPaused = !settings.enabled || !settings.platforms[this.platform];
    if (this.selectionPaused) this.clearTrackStabilizationTimer();

    if (serverChanged) {
      this.lastPreloadError = null;
      this.manager.dispose();
      this.client = new ServerClient(settings.serverUrl, settings.requestTimeoutMs);
      this.manager = this.createManager();
      if (settings.preloadEnabled && this.activeTrack) {
        this.manager.setTrack(
          this.activeTrack.trackId,
          this.activeTrack.cues,
          this.currentTimeMs(),
        );
      }
    }
    if (enabledChanged) this.applyEnabledState();
  }

  observe(rawText: string): TranslationResponse | null {
    this.currentText = normalizeDetectedText(rawText);
    if (!this.settings.preloadEnabled || !this.currentText) {
      this.currentCue = null;
      this.lastDeliveredKey = "";
      return null;
    }

    const currentTimeMs = this.currentTimeMs();
    const selected = selectBestTrack(
      this.capture.list(this.platform),
      this.currentText,
      currentTimeMs,
      this.activeTrack?.trackId,
    );
    if (selected && selected.trackId !== this.activeTrack?.trackId) {
      this.activateTrack(selected, currentTimeMs);
    }
    if (!this.activeTrack) return null;

    this.manager.updateCurrentTime(currentTimeMs);
    this.currentCue = findMatchingCue(this.activeTrack.cues, this.currentText, currentTimeMs);
    return this.resolveCurrentTranslation(true);
  }

  getStatus(): SubtitlePreloadStatus & {
    enabled: boolean;
    lastError: string | null;
    playbackTimeMs: number | null;
    currentCueId: string | null;
    currentCueStartMs: number | null;
    currentCueEndMs: number | null;
    cueOffsetMs: number | null;
  } {
    const playbackTimeMs = this.playbackVideo?.isConnected ? this.currentTimeMs() : null;
    return {
      enabled: this.settings.preloadEnabled,
      ...this.manager.getStatus(),
      lastError: this.lastPreloadError,
      playbackTimeMs,
      currentCueId: this.currentCue?.id ?? null,
      currentCueStartMs: this.currentCue?.startMs ?? null,
      currentCueEndMs: this.currentCue?.endMs ?? null,
      cueOffsetMs:
        playbackTimeMs !== null && this.currentCue
          ? Math.round(playbackTimeMs - this.currentCue.startMs)
          : null,
    };
  }

  getCaptureDiagnostics(): CaptureDiagnostics {
    return {
      bridge: this.capture.getBridgeStats(),
      tracks: this.capture.list(this.platform).map((track) => ({
        trackId: track.trackId,
        cues: track.cues.length,
        ...(track.language ? { language: track.language } : {}),
        ...(track.label ? { label: track.label } : {}),
        ...(track.activeHint !== undefined ? { activeHint: track.activeHint } : {}),
      })),
    };
  }

  private createManager(): SubtitlePreloadManager {
    return new SubtitlePreloadManager(
      {
        translateBatch: (request, signal) => this.translateBatch(request, signal),
      },
      {
        maxBatchSize: PRELOAD_BACKGROUND_BATCH_SIZE,
        foregroundBatchSize: PRELOAD_FOREGROUND_BATCH_SIZE,
        foregroundWindowMs: PRELOAD_FOREGROUND_WINDOW_MS,
        concurrency: PRELOAD_CONCURRENCY,
        lookAheadMs: PRELOAD_LOOK_AHEAD_MS,
        onTranslation: () => {
          if (this.manager.getStatus().failed === 0) this.lastPreloadError = null;
          const response = this.resolveCurrentTranslation(true);
          if (response && this.currentText) this.events.onTranslation(this.currentText, response);
          this.events.onStatusChange?.();
        },
        onError: (error) => {
          this.lastPreloadError =
            error instanceof Error ? error.message : "Échec temporaire du préchargement";
          this.events.onStatusChange?.();
        },
      },
    );
  }

  private async translateBatch(request: PreloadBatchRequest, signal: AbortSignal) {
    const track =
      this.activeTrack?.trackId === request.trackId
        ? this.activeTrack
        : this.capture.list(this.platform).find(({ trackId }) => trackId === request.trackId);
    const sourceCues = track?.cues ?? request.cues;
    const indexById = new Map(sourceCues.map((cue, index) => [cue.id, index]));
    const payload: TranslateBatchRequest = {
      cues: request.cues.map((cue) => {
        const sourceIndex = indexById.get(cue.id) ?? -1;
        const previousLines =
          sourceIndex < 0
            ? []
            : sourceCues
                .slice(Math.max(0, sourceIndex - this.settings.contextLineCount), sourceIndex)
                .map(({ text }) => text);
        return {
          cueId: cue.id,
          text: cue.text,
          ...(detectLanguageHint(cue.text)
            ? { detectedLanguage: detectLanguageHint(cue.text) }
            : {}),
          previousLines,
        };
      }),
    };
    const response = await this.client.translateBatch(payload, signal);
    return response.results.map((result) => ({
      id: result.cueId,
      sourceLanguage: result.sourceLanguage,
      fr: result.fr,
      zh: result.zh,
      cached: result.cached,
    }));
  }

  private handleTrack(track: CapturedSubtitleTrack): void {
    if (!this.settings.preloadEnabled || this.selectionPaused || track.platform !== this.platform) {
      return;
    }
    if (track.activeHint) {
      this.clearTrackStabilizationTimer();
      if (track.trackId === this.activeTrack?.trackId) {
        this.activeTrack = track;
        this.manager.setTrack(track.trackId, track.cues, this.currentTimeMs());
        this.events.onStatusChange?.();
      } else {
        this.activateTrack(track, this.currentTimeMs());
      }
      return;
    }
    if (track.trackId === this.activeTrack?.trackId) {
      this.activeTrack = track;
      this.manager.setTrack(track.trackId, track.cues, this.currentTimeMs());
    } else if (this.currentText) {
      const selected = selectBestTrack(
        this.capture.list(this.platform),
        this.currentText,
        this.currentTimeMs(),
        this.activeTrack?.trackId,
      );
      if (selected && selected.trackId !== this.activeTrack?.trackId) {
        this.activateTrack(selected, this.currentTimeMs());
        return;
      }
    }
    if (!this.activeTrack) this.scheduleUniqueTrackActivation();
    this.events.onStatusChange?.();
  }

  private activateTrack(track: CapturedSubtitleTrack, currentTimeMs: number): void {
    this.clearTrackStabilizationTimer();
    this.activeTrack = track;
    this.currentCue = null;
    this.lastDeliveredKey = "";
    this.lastPreloadError = null;
    this.manager.setTrack(track.trackId, track.cues, currentTimeMs);
    this.events.onStatusChange?.();
  }

  private resolveCurrentTranslation(markDelivered: boolean): TranslationResponse | null {
    const cue = this.currentCue;
    const track = this.activeTrack;
    if (!cue || !track) return null;
    const translation = this.manager.lookup(cue);
    if (!translation) return null;
    const key = deliveryKey(track.trackId, translation);
    if (key === this.lastDeliveredKey) return null;
    if (markDelivered) this.lastDeliveredKey = key;
    return toTranslationResponse(translation);
  }

  private tick(): void {
    if (!this.settings.preloadEnabled) return;
    const currentTimeMs = this.currentTimeMs();
    if (this.activeTrack) this.manager.updateCurrentTime(currentTimeMs);
    if (!this.currentText || !this.activeTrack) return;
    this.currentCue = findMatchingCue(this.activeTrack.cues, this.currentText, currentTimeMs);
    const response = this.resolveCurrentTranslation(true);
    if (response) this.events.onTranslation(this.currentText, response);
  }

  private applyEnabledState(): void {
    if (!this.started) return;
    if (this.settings.preloadEnabled) {
      this.capture.start();
      if (this.pollTimer === null) {
        this.pollTimer = setInterval(() => this.tick(), PLAYBACK_POLL_MS);
      }
    } else {
      this.selectionPaused = true;
      this.clearTrackStabilizationTimer();
      this.stopPolling();
      this.capture.stop();
      this.activeTrack = null;
      this.currentCue = null;
      this.lastDeliveredKey = "";
      this.manager.cancel();
    }
    this.events.onStatusChange?.();
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private scheduleUniqueTrackActivation(): void {
    this.clearTrackStabilizationTimer();
    this.trackStabilizationTimer = setTimeout(() => {
      this.trackStabilizationTimer = null;
      if (
        !this.started ||
        !this.settings.preloadEnabled ||
        this.selectionPaused ||
        this.activeTrack
      ) {
        return;
      }
      const tracks = this.capture.list(this.platform);
      if (tracks.length !== 1 || !tracks[0]) return;
      this.activateTrack(tracks[0], this.currentTimeMs());
    }, TRACK_STABILIZATION_MS);
  }

  private clearTrackStabilizationTimer(): void {
    if (this.trackStabilizationTimer !== null) {
      clearTimeout(this.trackStabilizationTimer);
      this.trackStabilizationTimer = null;
    }
  }

  private currentTimeMs(): number {
    const now = Date.now();
    if (
      !this.playbackVideo?.isConnected ||
      now - this.playbackVideoSelectedAt >= PLAYBACK_VIDEO_RESCAN_MS
    ) {
      this.playbackVideo = selectPlaybackVideo(this.documentRoot);
      this.playbackVideoSelectedAt = now;
    }
    return Math.max(0, (this.playbackVideo?.currentTime ?? 0) * 1_000);
  }
}

export function selectBestTrack(
  tracks: readonly CapturedSubtitleTrack[],
  text: string,
  currentTimeMs: number,
  preferredTrackId?: string,
): CapturedSubtitleTrack | null {
  let selected: CapturedSubtitleTrack | null = null;
  let selectedScore = 0;
  for (const track of tracks) {
    const score = scoreTrack(track, text, currentTimeMs);
    const replacesEqualScore =
      score === selectedScore &&
      (track.trackId === preferredTrackId
        ? selected?.trackId !== preferredTrackId
        : selected?.trackId !== preferredTrackId && track.receivedAt > (selected?.receivedAt ?? 0));
    if (score > selectedScore || replacesEqualScore) {
      selected = track;
      selectedScore = score;
    }
  }
  return selectedScore >= 500 ? selected : null;
}

export function findMatchingCue(
  cues: readonly PreloadCue[],
  rawText: string,
  currentTimeMs: number,
): PreloadCue | null {
  const text = normalizeDetectedText(rawText);
  if (!text) return null;
  let best: PreloadCue | null = null;
  let bestTextQuality = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const cue of cues) {
    const textQuality = subtitleTextMatchQuality(normalizeDetectedText(cue.text), text);
    if (textQuality === 0) continue;
    const distance = distanceFromCue(cue, currentTimeMs);
    if (
      distance <= ACTIVE_CUE_TOLERANCE_MS &&
      (textQuality > bestTextQuality ||
        (textQuality === bestTextQuality && distance < bestDistance))
    ) {
      best = cue;
      bestTextQuality = textQuality;
      bestDistance = distance;
    }
  }
  return best;
}

function scoreTrack(track: CapturedSubtitleTrack, rawText: string, currentTimeMs: number): number {
  const text = normalizeDetectedText(rawText);
  if (!text) return 0;
  let best = 0;
  for (const cue of track.cues) {
    const cueText = normalizeDetectedText(cue.text);
    const distance = distanceFromCue(cue, currentTimeMs);
    const textQuality = subtitleTextMatchQuality(cueText, text);
    if (textQuality === 2) {
      if (distance <= ACTIVE_CUE_TOLERANCE_MS) best = Math.max(best, 1_000 - distance / 10);
      else if (distance <= TRACK_MATCH_WINDOW_MS) best = Math.max(best, 600 - distance / 100);
    } else if (textQuality === 1 && distance <= ACTIVE_CUE_TOLERANCE_MS) {
      best = Math.max(best, 500 - distance / 10);
    }
  }
  return best;
}

/** Choisit l'horloge du lecteur principal sur les pages qui contiennent pubs ou previews. */
export function selectPlaybackVideo(documentRoot: Document = document): HTMLVideoElement | null {
  const videos = querySelectorAllOpen<HTMLVideoElement>(documentRoot, "video");
  let selected: HTMLVideoElement | null = null;
  let selectedScore = Number.NEGATIVE_INFINITY;
  for (const video of videos) {
    if (!Number.isFinite(video.currentTime)) continue;
    const score = scorePlaybackVideo(video);
    if (score > selectedScore) {
      selected = video;
      selectedScore = score;
    }
  }
  return selected;
}

function scorePlaybackVideo(video: HTMLVideoElement): number {
  const rect = video.getBoundingClientRect();
  const width = Math.max(0, rect.width || video.clientWidth || video.videoWidth || 0);
  const height = Math.max(0, rect.height || video.clientHeight || video.videoHeight || 0);
  const area = Math.min(width * height, 10_000_000);
  const viewportWidth = video.ownerDocument.defaultView?.innerWidth ?? Number.POSITIVE_INFINITY;
  const viewportHeight = video.ownerDocument.defaultView?.innerHeight ?? Number.POSITIVE_INFINITY;
  const intersectsViewport =
    width > 0 &&
    height > 0 &&
    rect.right > 0 &&
    rect.bottom > 0 &&
    rect.left < viewportWidth &&
    rect.top < viewportHeight;
  const style = video.ownerDocument.defaultView?.getComputedStyle(video);
  const visiblyRendered =
    !video.hidden &&
    intersectsViewport &&
    style?.display !== "none" &&
    style?.visibility !== "hidden" &&
    style?.opacity !== "0";
  const playing =
    !video.paused && !video.ended && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
  const durationScore = Number.isFinite(video.duration)
    ? Math.min(Math.max(0, video.duration), 86_400)
    : 0;

  return (
    Number(visiblyRendered) * 2_000_000_000_000 +
    Number(playing) * 1_000_000_000_000 +
    area * 1_000 +
    Math.max(0, video.readyState) * 1_000_000 +
    durationScore
  );
}

function subtitleTextMatchQuality(cueText: string, observedText: string): 0 | 1 | 2 {
  if (cueText === observedText) return 2;
  if (
    Math.min(cueText.length, observedText.length) >= 8 &&
    (cueText.includes(observedText) || observedText.includes(cueText))
  ) {
    return 1;
  }
  return 0;
}

function distanceFromCue(
  cue: Pick<PreloadCue, "startMs" | "endMs">,
  currentTimeMs: number,
): number {
  if (currentTimeMs < cue.startMs) return cue.startMs - currentTimeMs;
  if (currentTimeMs > cue.endMs) return currentTimeMs - cue.endMs;
  return 0;
}

function deliveryKey(trackId: string, translation: PreloadedCueTranslation): string {
  return `${trackId}\u0000${translation.cue.id}\u0000${translation.cue.startMs}\u0000${translation.cue.endMs}`;
}

function toTranslationResponse(translation: PreloadedCueTranslation): TranslationResponse {
  return {
    id: `preload:${translation.id}`,
    sourceLanguage: translation.sourceLanguage,
    fr: translation.fr,
    zh: translation.zh,
    cached: translation.cached,
  };
}
