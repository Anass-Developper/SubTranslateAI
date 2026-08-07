import type { PlatformId } from "../types";
import { normalizeDetectedText } from "../core/text";
import { querySelectorAllOpen } from "../dom/open-shadow-dom";
import { detectPlatform, isPlatformId } from "../platforms";
import { looksLikeBilibiliSubtitle, parseBilibiliSubtitle } from "./bilibili-json";
import { parseSrt } from "./srt";
import { parseTtml } from "./ttml";
import type { Cue, SubtitleTrackFormat } from "./types";
import { parseWebVtt } from "./webvtt";
import { parseYouTubeTimedText } from "./youtube-json";

export const TIMED_TEXT_BRIDGE_SOURCE = "dual-subtitles-page-bridge";
export const TIMED_TEXT_CONTENT_SOURCE = "dual-subtitles-content";

/** Statistiques d'observation émises par le page-bridge, à visée de diagnostic. */
export interface BridgeCaptureStats {
  bridgeVersion: string;
  responsesSeen: number;
  responsesInspected: number;
  manifestsProcessed: number;
  dashManifests: number;
  hlsPlaylists: number;
  discoveredQueued: number;
  discoveredFetched: number;
  discoveredErrors: number;
  publishedResources: number;
  workersCreated: number;
  recentSeenUrls: string[];
  recentWorkerScripts: string[];
  recentPublishedTracks: string[];
  recentManifestSamples: string[];
  recentDiscoveredErrors: string[];
}
const MAX_TRACK_BYTES = 4 * 1024 * 1024;
const MAX_TRACK_CUES = 4_400;
const MAX_TRACK_TEXT_CHARS = 250_000;
const MAX_CUE_TEXT_CHARS = 2_000;
const MAX_TRACK_TIMELINE_MS = 48 * 60 * 60 * 1_000;
const MAX_CAPTURED_TRACKS = 24;
const NATIVE_TRACK_SCAN_MS = 1_000;

export interface TimedTextResourcePayload {
  platform: PlatformId;
  trackId: string;
  language?: string;
  label?: string;
  activeHint?: boolean;
  contentType: string;
  body: string;
}

export interface CapturedSubtitleTrack {
  platform: PlatformId;
  trackId: string;
  language?: string;
  label?: string;
  activeHint?: boolean;
  cues: readonly Cue[];
  receivedAt: number;
}

export type CapturedTrackListener = (track: CapturedSubtitleTrack) => void;

export class TimedTextTrackCapture {
  private readonly tracks = new Map<string, CapturedSubtitleTrack>();
  private readonly listeners = new Set<CapturedTrackListener>();
  private nativeScanTimer: ReturnType<typeof setInterval> | null = null;
  private bridgeStats: (BridgeCaptureStats & { receivedAt: number }) | null = null;
  private started = false;

  constructor(private readonly documentRoot: Document = document) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    window.addEventListener("message", this.messageListener);
    this.requestBridgeReplay();
    this.nativeScanTimer = setInterval(() => this.scanNativeTextTracks(), NATIVE_TRACK_SCAN_MS);
    this.scanNativeTextTracks();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    window.removeEventListener("message", this.messageListener);
    if (this.nativeScanTimer !== null) clearInterval(this.nativeScanTimer);
    this.nativeScanTimer = null;
    this.clear();
  }

  clear(): void {
    this.tracks.clear();
    if (this.started) this.requestBridgeReplay();
  }

  subscribe(listener: CapturedTrackListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list(platform?: PlatformId): readonly CapturedSubtitleTrack[] {
    return [...this.tracks.values()].filter((track) => !platform || track.platform === platform);
  }

  ingest(payload: TimedTextResourcePayload): CapturedSubtitleTrack | null {
    const cues = parseCapturedTrackResource(payload);
    if (cues.length === 0) return null;
    return this.storeTrack(payload, cues, false);
  }

  getBridgeStats(): (BridgeCaptureStats & { receivedAt: number }) | null {
    return this.bridgeStats;
  }

  private readonly messageListener = (event: MessageEvent<unknown>): void => {
    if (event.source !== window) return;
    if (isBridgeStatsMessage(event.data)) {
      this.bridgeStats = { ...event.data.payload, receivedAt: Date.now() };
      return;
    }
    if (!isBridgeMessage(event.data)) return;
    if (event.data.payload.platform !== detectPlatform(window.location)) return;
    this.ingest(event.data.payload);
  };

  private requestBridgeReplay(): void {
    window.postMessage(
      { source: TIMED_TEXT_CONTENT_SOURCE, type: "TRACK_BRIDGE_READY" },
      window.location.origin,
    );
  }

  private scanNativeTextTracks(): void {
    const platform = detectPlatform(window.location);
    const videos = querySelectorAllOpen<HTMLVideoElement>(this.documentRoot, "video");
    for (const [videoIndex, video] of videos.entries()) {
      for (let trackIndex = 0; trackIndex < video.textTracks.length; trackIndex += 1) {
        const textTrack = video.textTracks[trackIndex];
        if (!textTrack?.cues || textTrack.cues.length === 0) continue;
        const cues: Cue[] = [];
        const cueLimit = Math.min(textTrack.cues.length, MAX_TRACK_CUES);
        for (let cueIndex = 0; cueIndex < cueLimit; cueIndex += 1) {
          const nativeCue = textTrack.cues[cueIndex];
          if (!nativeCue) continue;
          const value = nativeCue as TextTrackCue & { text?: unknown };
          if (typeof value.text !== "string") continue;
          cues.push({
            id: nativeCue.id || `native-${cueIndex + 1}`,
            startMs: nativeCue.startTime * 1_000,
            endMs: nativeCue.endTime * 1_000,
            text: value.text,
          });
        }
        if (cues.length === 0) continue;
        this.storeTrack(
          {
            platform,
            trackId: `native:${videoIndex}:${trackIndex}:${textTrack.language || "unknown"}:${textTrack.label || ""}`,
            language: textTrack.language || undefined,
            label: textTrack.label || undefined,
            activeHint: textTrack.mode === "showing",
            contentType: "text/vtt",
            body: "",
          },
          cues,
          true,
        );
      }
    }
  }

  private storeTrack(
    payload: Omit<TimedTextResourcePayload, "body"> & { body?: string },
    rawCues: readonly Cue[],
    replace: boolean,
  ): CapturedSubtitleTrack | null {
    const key = `${payload.platform}\u0000${payload.trackId}`;
    const previous = this.tracks.get(key);
    const cues = canonicalizeCues(replace ? rawCues : [...(previous?.cues ?? []), ...rawCues]);
    if (cues.length === 0) return null;
    const activeHint = payload.activeHint ?? previous?.activeHint;
    if (previous && previous.activeHint === activeHint && sameCueSet(previous.cues, cues)) {
      return previous;
    }

    const track: CapturedSubtitleTrack = {
      platform: payload.platform,
      trackId: payload.trackId,
      ...(payload.language ? { language: payload.language } : {}),
      ...(payload.label ? { label: payload.label } : {}),
      ...(activeHint !== undefined ? { activeHint } : {}),
      cues,
      receivedAt: Date.now(),
    };
    if (!previous && this.tracks.size >= MAX_CAPTURED_TRACKS) {
      const oldest = [...this.tracks.entries()].sort(
        ([, left], [, right]) => left.receivedAt - right.receivedAt,
      )[0];
      if (oldest) this.tracks.delete(oldest[0]);
    }
    this.tracks.set(key, track);
    for (const listener of this.listeners) listener(track);
    return track;
  }
}

export function parseCapturedTrackResource(payload: TimedTextResourcePayload): Cue[] {
  if (!isTimedTextResourcePayload(payload)) return [];
  const format = detectTrackFormat(payload.body, payload.contentType);
  if (!format) return [];
  const cues =
    format === "webvtt" || format === "vtt"
      ? parseWebVtt(payload.body)
      : format === "srt"
        ? parseSrt(payload.body)
        : format === "youtube-json"
          ? parseYouTubeTimedText(payload.body)
          : format === "bilibili-json"
            ? parseBilibiliSubtitle(payload.body)
            : parseTtml(payload.body);
  return canonicalizeCues(cues);
}

export function detectTrackFormat(source: string, contentType = ""): SubtitleTrackFormat | null {
  const sample = source.slice(0, 4_096).trimStart();
  const type = contentType.toLocaleLowerCase();
  if (sample.startsWith("WEBVTT") || type.includes("text/vtt")) return "webvtt";
  if (/<(?:tt)(?:\s|>)/iu.test(sample) || /(?:ttml|dfxp|imsc)/u.test(type)) return "ttml";
  if (/<transcript(?:\s|>)/iu.test(sample)) return "youtube-json";
  if (looksLikeBilibiliSubtitle(sample)) return "bilibili-json";
  if (/^[{[]/u.test(sample) && /"(?:events|segs|tStartMs|transcriptCueRenderer)"/u.test(sample)) {
    return "youtube-json";
  }
  if (/^(?:\d+\s*\r?\n)?\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s+-->/u.test(sample)) return "srt";
  return null;
}

function canonicalizeCues(rawCues: readonly Cue[]): Cue[] {
  const textsByTiming = new Map<string, { startMs: number; endMs: number; texts: string[] }>();
  let totalTextChars = 0;
  for (const cue of rawCues) {
    const text = normalizeDetectedText(cue.text);
    if (
      !text ||
      text.length > MAX_CUE_TEXT_CHARS ||
      !Number.isFinite(cue.startMs) ||
      !Number.isFinite(cue.endMs) ||
      cue.startMs < 0 ||
      cue.endMs <= cue.startMs ||
      cue.endMs > MAX_TRACK_TIMELINE_MS
    ) {
      continue;
    }
    const startMs = Math.round(cue.startMs);
    const endMs = Math.round(cue.endMs);
    if (startMs < 0 || endMs <= startMs || endMs > MAX_TRACK_TIMELINE_MS) continue;
    const timingKey = `${startMs}:${endMs}`;
    let group = textsByTiming.get(timingKey);
    if (!group) {
      if (textsByTiming.size >= MAX_TRACK_CUES) continue;
      group = { startMs, endMs, texts: [] };
      textsByTiming.set(timingKey, group);
    }

    // A replayed segment can contain the already-combined text plus its individual regions.
    // Keeping only maximal texts avoids duplication while retaining simultaneous speakers.
    if (group.texts.some((existing) => existing === text || existing.includes(text))) continue;
    const contained = group.texts.filter((existing) => text.includes(existing));
    const removedChars = contained.reduce((sum, existing) => sum + existing.length, 0);
    if (totalTextChars - removedChars + text.length > MAX_TRACK_TEXT_CHARS) continue;
    if (contained.length > 0) {
      group.texts = group.texts.filter((existing) => !contained.includes(existing));
      totalTextChars -= removedChars;
    }
    group.texts.push(text);
    totalTextChars += text.length;
  }

  const cues: Cue[] = [];
  for (const { startMs, endMs, texts } of textsByTiming.values()) {
    const text = texts.join(" ");
    if (!text || text.length > MAX_CUE_TEXT_CHARS) continue;
    cues.push({
      id: `cue-${startMs}-${endMs}-${stableHash(text)}`,
      startMs,
      endMs,
      text,
    });
  }
  return cues.sort(
    (left, right) =>
      left.startMs - right.startMs ||
      left.endMs - right.endMs ||
      left.text.localeCompare(right.text),
  );
}

function sameCueSet(left: readonly Cue[], right: readonly Cue[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((cue, index) => {
    const other = right[index];
    return (
      cue.id === other?.id &&
      cue.startMs === other.startMs &&
      cue.endMs === other.endMs &&
      cue.text === other.text
    );
  });
}

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function isBridgeStatsMessage(value: unknown): value is {
  source: typeof TIMED_TEXT_BRIDGE_SOURCE;
  type: "TRACK_BRIDGE_STATS";
  payload: BridgeCaptureStats;
} {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  if (message.source !== TIMED_TEXT_BRIDGE_SOURCE || message.type !== "TRACK_BRIDGE_STATS") {
    return false;
  }
  const payload = message.payload as Record<string, unknown> | null | undefined;
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof payload.bridgeVersion === "string" &&
    typeof payload.responsesSeen === "number" &&
    Array.isArray(payload.recentSeenUrls)
  );
}

function isBridgeMessage(value: unknown): value is {
  source: typeof TIMED_TEXT_BRIDGE_SOURCE;
  type: "TIMED_TEXT_RESOURCE";
  payload: TimedTextResourcePayload;
} {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  if (message.source !== TIMED_TEXT_BRIDGE_SOURCE || message.type !== "TIMED_TEXT_RESOURCE")
    return false;
  return isTimedTextResourcePayload(message.payload);
}

function isTimedTextResourcePayload(value: unknown): value is TimedTextResourcePayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    isPlatformId(payload.platform) &&
    typeof payload.trackId === "string" &&
    payload.trackId.trim().length > 0 &&
    payload.trackId.length <= 500 &&
    typeof payload.contentType === "string" &&
    payload.contentType.length <= 160 &&
    typeof payload.body === "string" &&
    payload.body.length > 0 &&
    payload.body.length <= MAX_TRACK_BYTES &&
    (payload.language === undefined ||
      (typeof payload.language === "string" &&
        payload.language.trim().length > 0 &&
        payload.language.length <= 35)) &&
    (payload.label === undefined ||
      (typeof payload.label === "string" &&
        payload.label.trim().length > 0 &&
        payload.label.length <= 160)) &&
    (payload.activeHint === undefined || typeof payload.activeHint === "boolean")
  );
}
