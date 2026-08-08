import type { DiagnosticIncident, Stats } from '@dual-subtitles/shared';

import type { TranslationCache } from '../cache/translation-cache.js';
import type { DatabaseConnection } from '../database/database.js';

export type CounterName =
  'translatedLines' | 'cacheHits' | 'cacheMisses' | 'apiRequests' | 'errors' | 'cancelledLines';

const COUNTERS: readonly CounterName[] = [
  'translatedLines',
  'cacheHits',
  'cacheMisses',
  'apiRequests',
  'errors',
  'cancelledLines',
];

type TranslationOperation = 'single' | 'batch';

export interface TrackedTranslationRequest {
  readonly startedAt: number;
  readonly operation: TranslationOperation;
  readonly cueCount: number;
  finished: boolean;
}

interface ClassifiedFailure {
  readonly cancelled: boolean;
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

const RECENT_INCIDENT_LIMIT = 20;

export class StatsStore {
  readonly #database: DatabaseConnection;
  readonly #cache: TranslationCache;
  readonly #startedAt = Date.now();
  readonly #sessionCounters = new Map<CounterName, number>();
  readonly #errorCounts = new Map<string, number>();
  readonly #recentIncidents: DiagnosticIncident[] = [];
  #activeRequests = 0;
  #peakConcurrentRequests = 0;
  #completedRequests = 0;
  #successfulRequests = 0;
  #failedRequests = 0;
  #cancelledRequests = 0;
  #affectedFailedCues = 0;
  #affectedCancelledCues = 0;
  #totalRequestDurationMs = 0;
  #lastRequestDurationMs: number | null = null;
  #maxRequestDurationMs = 0;

  public constructor(database: DatabaseConnection, cache: TranslationCache) {
    this.#database = database;
    this.#cache = cache;
  }

  public increment(counter: CounterName, amount = 1): void {
    this.#database.handle
      .prepare(
        `INSERT INTO counters (counter_key, counter_value) VALUES (?, ?)
         ON CONFLICT(counter_key) DO UPDATE
         SET counter_value = counter_value + excluded.counter_value`,
      )
      .run(counter, amount);
    this.#sessionCounters.set(counter, (this.#sessionCounters.get(counter) ?? 0) + amount);
  }

  public beginRequest(
    operation: TranslationOperation,
    cueCount: number,
  ): TrackedTranslationRequest {
    this.#activeRequests += 1;
    this.#peakConcurrentRequests = Math.max(this.#peakConcurrentRequests, this.#activeRequests);
    return {
      startedAt: Date.now(),
      operation,
      cueCount: Math.max(1, Math.trunc(cueCount)),
      finished: false,
    };
  }

  public finishRequest(request: TrackedTranslationRequest, error?: unknown): void {
    if (request.finished) return;
    request.finished = true;
    this.#activeRequests = Math.max(0, this.#activeRequests - 1);
    this.#completedRequests += 1;
    const durationMs = Math.max(0, Date.now() - request.startedAt);
    this.#totalRequestDurationMs += durationMs;
    this.#lastRequestDurationMs = durationMs;
    this.#maxRequestDurationMs = Math.max(this.#maxRequestDurationMs, durationMs);

    if (error === undefined) {
      this.#successfulRequests += 1;
      return;
    }

    const failure = classifyFailure(error);
    this.#errorCounts.set(failure.code, (this.#errorCounts.get(failure.code) ?? 0) + 1);
    if (failure.cancelled) {
      this.#cancelledRequests += 1;
      this.#affectedCancelledCues += request.cueCount;
      this.increment('cancelledLines', request.cueCount);
    } else {
      this.#failedRequests += 1;
      this.#affectedFailedCues += request.cueCount;
      this.increment('errors', request.cueCount);
    }
    this.#recentIncidents.push({
      occurredAt: new Date().toISOString(),
      kind: failure.cancelled ? 'cancellation' : 'error',
      operation: request.operation,
      code: failure.code,
      message: failure.message,
      retryable: failure.retryable,
      cueCount: request.cueCount,
      durationMs,
    });
    if (this.#recentIncidents.length > RECENT_INCIDENT_LIMIT) this.#recentIncidents.shift();
  }

  public get(): Stats {
    const storedRows = this.#database.handle
      .prepare('SELECT counter_key, counter_value FROM counters')
      .all() as Array<{ counter_key: string; counter_value: number }>;
    const stored = new Map(storedRows.map((row) => [row.counter_key, row.counter_value]));
    const values = Object.fromEntries(COUNTERS.map((key) => [key, stored.get(key) ?? 0])) as Record<
      CounterName,
      number
    >;
    const lookups = values.cacheHits + values.cacheMisses;
    return {
      ...values,
      cacheEntries: this.#cache.count(),
      uptimeSeconds: Math.max(0, Math.floor((Date.now() - this.#startedAt) / 1_000)),
      cacheHitRate: lookups === 0 ? 0 : values.cacheHits / lookups,
      runtime: {
        sessionStartedAt: new Date(this.#startedAt).toISOString(),
        translatedLines: this.#sessionValue('translatedLines'),
        cacheHits: this.#sessionValue('cacheHits'),
        cacheMisses: this.#sessionValue('cacheMisses'),
        apiRequests: this.#sessionValue('apiRequests'),
        activeRequests: this.#activeRequests,
        peakConcurrentRequests: this.#peakConcurrentRequests,
        completedRequests: this.#completedRequests,
        successfulRequests: this.#successfulRequests,
        failedRequests: this.#failedRequests,
        cancelledRequests: this.#cancelledRequests,
        affectedFailedCues: this.#affectedFailedCues,
        affectedCancelledCues: this.#affectedCancelledCues,
        averageRequestDurationMs:
          this.#completedRequests === 0
            ? 0
            : Math.round(this.#totalRequestDurationMs / this.#completedRequests),
        lastRequestDurationMs: this.#lastRequestDurationMs,
        maxRequestDurationMs: this.#maxRequestDurationMs,
        errorCounts: Object.fromEntries(this.#errorCounts),
        recentIncidents: [...this.#recentIncidents],
      },
    };
  }

  #sessionValue(counter: CounterName): number {
    return this.#sessionCounters.get(counter) ?? 0;
  }
}

function classifyFailure(error: unknown): ClassifiedFailure {
  const record =
    typeof error === 'object' && error !== null
      ? (error as { code?: unknown; message?: unknown; retryable?: unknown; name?: unknown })
      : {};
  const code =
    typeof record.code === 'string' && record.code.length > 0
      ? record.code.slice(0, 80)
      : record.name === 'AbortError'
        ? 'REQUEST_ABORTED'
        : 'UNKNOWN_ERROR';
  const cancelled = code === 'REQUEST_ABORTED';
  const rawMessage =
    typeof record.message === 'string' && record.message.trim().length > 0
      ? record.message.trim()
      : cancelled
        ? 'La requête a été annulée.'
        : 'Erreur de traduction non classée.';
  return {
    cancelled,
    code,
    message: rawMessage.slice(0, 500),
    retryable: record.retryable === true,
  };
}
