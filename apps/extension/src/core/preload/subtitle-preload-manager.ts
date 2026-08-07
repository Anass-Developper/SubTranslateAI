import type {
  PreloadBatchTranslation,
  PreloadCue,
  PreloadedCueTranslation,
  SubtitleBatchClient,
  SubtitlePreloadManagerOptions,
  SubtitlePreloadStatus,
} from "./types";

const MAX_BATCH_SIZE = 40;
const MAX_CONCURRENCY = 2;
const DEFAULT_LOOK_AHEAD_MS = 120_000;
const DEFAULT_LOOK_BEHIND_MS = 10_000;
const SEEK_PREEMPT_THRESHOLD_MS = 10_000;
const MAX_AUTOMATIC_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 500;
const TRANSIENT_CIRCUIT_COOLDOWN_MS = 15_000;

interface TrackState {
  id: string;
  generation: number;
  cues: readonly Readonly<PreloadCue>[];
}

interface RankedCue {
  cue: Readonly<PreloadCue>;
  tier: number;
  distance: number;
}

/**
 * Précharge une piste complète en donnant toujours la priorité aux cues proches
 * de la position de lecture. Cette classe ne dépend ni du DOM ni du transport.
 */
export class SubtitlePreloadManager {
  private readonly maxBatchSize: number;
  private readonly concurrency: number;
  private readonly foregroundBatchSize: number;
  private readonly foregroundWindowMs: number;
  private readonly lookAheadMs: number;
  private readonly lookBehindMs: number;
  private readonly onTranslation: ((translation: PreloadedCueTranslation) => void) | undefined;
  private readonly onError: ((error: unknown, cues: readonly PreloadCue[]) => void) | undefined;

  private track: TrackState | null = null;
  private currentTimeMs = 0;
  private generation = 0;
  private disposed = false;
  private readonly translations = new Map<string, PreloadedCueTranslation>();
  private readonly inFlightKeys = new Set<string>();
  private readonly failedKeys = new Set<string>();
  private readonly failureAttempts = new Map<string, number>();
  private readonly retryAtByKey = new Map<string, number>();
  private readonly controllers = new Set<AbortController>();
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private circuitTimer: ReturnType<typeof setTimeout> | undefined;
  private circuitBlocked = false;
  private circuitPermanent = false;

  constructor(
    private readonly client: SubtitleBatchClient,
    options: SubtitlePreloadManagerOptions = {},
  ) {
    this.maxBatchSize = boundedInteger(options.maxBatchSize, MAX_BATCH_SIZE, MAX_BATCH_SIZE);
    this.concurrency = boundedInteger(options.concurrency, MAX_CONCURRENCY, MAX_CONCURRENCY);
    this.foregroundBatchSize = boundedInteger(
      options.foregroundBatchSize,
      this.maxBatchSize,
      this.maxBatchSize,
    );
    this.foregroundWindowMs = nonNegativeNumber(options.foregroundWindowMs, 0);
    this.lookAheadMs = nonNegativeNumber(options.lookAheadMs, DEFAULT_LOOK_AHEAD_MS);
    this.lookBehindMs = nonNegativeNumber(options.lookBehindMs, DEFAULT_LOOK_BEHIND_MS);
    this.onTranslation = options.onTranslation;
    this.onError = options.onError;
  }

  setTrack(trackId: string, cues: readonly PreloadCue[], currentTimeMs: number): void {
    this.assertUsable();
    if (!trackId) {
      throw new TypeError("trackId ne peut pas être vide");
    }

    const snapshot = validateAndCloneCues(cues);
    const nextCurrentTimeMs = validCurrentTime(currentTimeMs);
    const sameTrack = this.track?.id === trackId;
    const validKeys = new Set(snapshot.map(cueKey));

    // Les pistes segmentées arrivent progressivement. Tant que la nouvelle
    // vue contient toutes les cues déjà connues, conserver le même objet de
    // piste permet aux lots actifs de terminer sans perdre leur réponse.
    if (sameTrack && this.track && this.track.cues.every((cue) => validKeys.has(cueKey(cue)))) {
      this.currentTimeMs = nextCurrentTimeMs;
      this.track.cues = snapshot;
      this.pump();
      return;
    }

    this.abortActiveWork();
    this.clearRetryTimer();
    this.clearCircuitTimer();
    this.circuitBlocked = false;
    this.circuitPermanent = false;
    this.generation += 1;
    this.currentTimeMs = nextCurrentTimeMs;
    if (!sameTrack) {
      this.translations.clear();
    } else {
      for (const key of this.translations.keys()) {
        if (!validKeys.has(key)) this.translations.delete(key);
      }
    }
    this.inFlightKeys.clear();
    this.failedKeys.clear();
    this.failureAttempts.clear();
    this.retryAtByKey.clear();
    this.track = {
      id: trackId,
      generation: this.generation,
      cues: snapshot,
    };
    this.pump();
  }

  updateCurrentTime(currentTimeMs: number): void {
    this.assertUsable();
    const nextCurrentTimeMs = validCurrentTime(currentTimeMs);
    const shouldPreempt =
      this.track !== null &&
      this.controllers.size > 0 &&
      Math.abs(nextCurrentTimeMs - this.currentTimeMs) >= SEEK_PREEMPT_THRESHOLD_MS;
    this.currentTimeMs = nextCurrentTimeMs;
    if (shouldPreempt) {
      this.abortActiveWork();
      this.inFlightKeys.clear();
    }
    this.pump();
  }

  lookup(cue: PreloadCue): PreloadedCueTranslation | null {
    return this.translations.get(cueKey(cue)) ?? null;
  }

  /** Exécute le fallback uniquement si aucune traduction exacte n'est préchargée. */
  resolve<T>(cue: PreloadCue, fallback: (cue: PreloadCue) => T): PreloadedCueTranslation | T {
    return this.lookup(cue) ?? fallback(cue);
  }

  retryMissing(): void {
    this.assertUsable();
    this.clearRetryTimer();
    this.clearCircuitTimer();
    this.circuitBlocked = false;
    this.circuitPermanent = false;
    this.failedKeys.clear();
    this.failureAttempts.clear();
    this.retryAtByKey.clear();
    this.pump();
  }

  getStatus(): SubtitlePreloadStatus {
    const total = this.track?.cues.length ?? 0;
    const translated = this.translations.size;
    const inFlight = this.inFlightKeys.size;
    const failed = this.failedKeys.size;
    return {
      trackId: this.track?.id ?? null,
      total,
      translated,
      inFlight,
      failed,
      pending: Math.max(0, total - translated - inFlight - failed),
    };
  }

  cancel(): void {
    if (this.disposed) return;
    this.abortActiveWork();
    this.clearRetryTimer();
    this.clearCircuitTimer();
    this.circuitBlocked = false;
    this.circuitPermanent = false;
    this.generation += 1;
    this.track = null;
    this.translations.clear();
    this.inFlightKeys.clear();
    this.failedKeys.clear();
    this.failureAttempts.clear();
    this.retryAtByKey.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.cancel();
    this.disposed = true;
  }

  private pump(): void {
    const track = this.track;
    if (!track || this.disposed || this.circuitBlocked || this.retryTimer !== undefined) return;

    while (this.controllers.size < this.concurrency) {
      const batch = this.nextBatch(track);
      if (batch.length === 0) return;
      this.startBatch(track, batch);
    }
  }

  private nextBatch(track: TrackState): readonly Readonly<PreloadCue>[] {
    const ranked = track.cues
      .filter((cue) => {
        const key = cueKey(cue);
        return (
          !this.translations.has(key) && !this.inFlightKeys.has(key) && !this.failedKeys.has(key)
        );
      })
      .map((cue) => this.rank(cue))
      .sort(compareRankedCues);
    if (this.foregroundBatchSize < this.maxBatchSize) {
      const foreground = ranked.filter(({ cue }) => this.isForegroundCue(cue));
      if (foreground.length > 0) {
        return foreground.slice(0, this.foregroundBatchSize).map(({ cue }) => cue);
      }
    }
    return ranked.slice(0, this.maxBatchSize).map(({ cue }) => cue);
  }

  private rank(cue: Readonly<PreloadCue>): RankedCue {
    const nearStart = Math.max(0, this.currentTimeMs - this.lookBehindMs);
    const nearEnd = this.currentTimeMs + this.lookAheadMs;
    const distance = distanceFromCue(cue, this.currentTimeMs);
    if (cue.endMs >= nearStart && cue.startMs <= nearEnd) {
      return { cue, tier: 0, distance };
    }
    if (cue.startMs > nearEnd) {
      return { cue, tier: 1, distance };
    }
    return { cue, tier: 2, distance };
  }

  private isForegroundCue(cue: Readonly<PreloadCue>): boolean {
    return (
      cue.endMs >= this.currentTimeMs && cue.startMs <= this.currentTimeMs + this.foregroundWindowMs
    );
  }

  private startBatch(track: TrackState, cues: readonly Readonly<PreloadCue>[]): void {
    const controller = new AbortController();
    this.controllers.add(controller);
    for (const cue of cues) this.inFlightKeys.add(cueKey(cue));

    void this.client
      .translateBatch({ trackId: track.id, cues }, controller.signal)
      .then((results) => this.acceptResults(track, cues, results, controller.signal))
      .catch((error: unknown) => {
        if (!controller.signal.aborted && this.isCurrent(track)) {
          this.markFailed(cues, isRetryableBatchError(error));
          this.onError?.(error, cues);
        }
      })
      .finally(() => {
        const wasActive = this.controllers.delete(controller);
        if (wasActive && this.isCurrent(track)) {
          for (const cue of cues) this.inFlightKeys.delete(cueKey(cue));
          this.pump();
        }
      });
  }

  private acceptResults(
    track: TrackState,
    cues: readonly Readonly<PreloadCue>[],
    results: readonly PreloadBatchTranslation[],
    signal: AbortSignal,
  ): void {
    if (signal.aborted || !this.isCurrent(track)) return;

    const resultsById = new Map<string, PreloadBatchTranslation>();
    for (const result of results) {
      if (!resultsById.has(result.id)) resultsById.set(result.id, result);
    }

    const missing: Readonly<PreloadCue>[] = [];
    for (const cue of cues) {
      const key = cueKey(cue);
      const result = resultsById.get(cue.id);
      if (!result) {
        missing.push(cue);
        continue;
      }
      const translation: PreloadedCueTranslation = { ...result, cue };
      this.translations.set(key, translation);
      this.failedKeys.delete(key);
      this.failureAttempts.delete(key);
      this.retryAtByKey.delete(key);
      this.onTranslation?.(translation);
    }
    this.markFailed(missing, false);
  }

  private markFailed(cues: readonly Readonly<PreloadCue>[], retryable: boolean): void {
    const now = Date.now();
    for (const cue of cues) {
      const key = cueKey(cue);
      const failures = (this.failureAttempts.get(key) ?? 0) + 1;
      this.failureAttempts.set(key, failures);
      this.failedKeys.add(key);
      if (retryable && failures <= MAX_AUTOMATIC_RETRIES) {
        this.retryAtByKey.set(key, now + RETRY_BASE_DELAY_MS * 2 ** (failures - 1));
      } else {
        this.retryAtByKey.delete(key);
        this.circuitBlocked = true;
        if (!retryable) this.circuitPermanent = true;
      }
    }
    if (this.circuitBlocked) {
      this.clearRetryTimer();
      if (retryable && !this.circuitPermanent) this.scheduleCircuitReset();
      return;
    }
    this.scheduleRetryTimer();
  }

  private scheduleRetryTimer(): void {
    this.clearRetryTimer();
    if (this.disposed || !this.track || this.retryAtByKey.size === 0) return;

    const nextRetryAt = Math.min(...this.retryAtByKey.values());
    this.retryTimer = setTimeout(
      () => {
        this.retryTimer = undefined;
        if (this.disposed || !this.track) return;

        const now = Date.now();
        for (const [key, retryAt] of this.retryAtByKey) {
          if (retryAt <= now) {
            this.retryAtByKey.delete(key);
            if (!this.translations.has(key)) this.failedKeys.delete(key);
          }
        }
        this.scheduleRetryTimer();
        this.pump();
      },
      Math.max(0, nextRetryAt - Date.now()),
    );
  }

  private clearRetryTimer(): void {
    if (this.retryTimer === undefined) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  private scheduleCircuitReset(): void {
    if (this.circuitTimer !== undefined || this.disposed || !this.track) return;
    this.circuitTimer = setTimeout(() => {
      this.circuitTimer = undefined;
      if (this.disposed || !this.track) return;
      this.circuitBlocked = false;
      this.circuitPermanent = false;
      this.failedKeys.clear();
      this.failureAttempts.clear();
      this.retryAtByKey.clear();
      this.pump();
    }, TRANSIENT_CIRCUIT_COOLDOWN_MS);
  }

  private clearCircuitTimer(): void {
    if (this.circuitTimer === undefined) return;
    clearTimeout(this.circuitTimer);
    this.circuitTimer = undefined;
  }

  private isCurrent(track: TrackState): boolean {
    return (
      !this.disposed &&
      this.track === track &&
      track.generation === this.generation &&
      track.id === this.track.id
    );
  }

  private abortActiveWork(): void {
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error("SubtitlePreloadManager est déjà détruit");
  }
}

function cueKey(cue: PreloadCue): string {
  return JSON.stringify([cue.id, cue.startMs, cue.endMs, cue.text]);
}

function distanceFromCue(
  cue: Pick<PreloadCue, "startMs" | "endMs">,
  currentTimeMs: number,
): number {
  if (currentTimeMs < cue.startMs) return cue.startMs - currentTimeMs;
  if (currentTimeMs > cue.endMs) return currentTimeMs - cue.endMs;
  return 0;
}

function validateAndCloneCues(cues: readonly PreloadCue[]): readonly Readonly<PreloadCue>[] {
  const ids = new Set<string>();
  return cues.map((cue) => {
    if (
      !cue.id ||
      ids.has(cue.id) ||
      !cue.text ||
      !Number.isFinite(cue.startMs) ||
      !Number.isFinite(cue.endMs) ||
      cue.startMs < 0 ||
      cue.endMs < cue.startMs
    ) {
      throw new TypeError(`Cue de sous-titre invalide ou dupliquée : ${cue.id}`);
    }
    ids.add(cue.id);
    return Object.freeze({ ...cue });
  });
}

function compareRankedCues(left: RankedCue, right: RankedCue): number {
  return (
    left.tier - right.tier ||
    left.distance - right.distance ||
    left.cue.startMs - right.cue.startMs ||
    left.cue.id.localeCompare(right.cue.id)
  );
}

function boundedInteger(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(value)));
}

function nonNegativeNumber(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : Math.max(0, value);
}

function validCurrentTime(value: number): number {
  if (!Number.isFinite(value)) throw new TypeError("currentTimeMs doit être un nombre fini");
  return Math.max(0, value);
}

function isRetryableBatchError(error: unknown): boolean {
  if (!error || typeof error !== "object") return true;
  const candidate = error as { kind?: unknown; status?: unknown };
  if (candidate.kind === "unauthorized" || candidate.kind === "invalid-response") return false;
  if (
    typeof candidate.status === "number" &&
    candidate.status >= 400 &&
    candidate.status < 500 &&
    candidate.status !== 408 &&
    candidate.status !== 429
  ) {
    return false;
  }
  return true;
}
