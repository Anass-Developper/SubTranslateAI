import { afterEach, describe, expect, it, vi } from 'vitest';

import { TranslationCache } from '../src/cache/translation-cache.js';
import { DatabaseConnection } from '../src/database/database.js';
import { ProviderError } from '../src/providers/errors.js';
import { StatsStore } from '../src/stats/stats-store.js';

describe('StatsStore diagnostics', () => {
  const databases: DatabaseConnection[] = [];

  afterEach(() => {
    vi.useRealTimers();
    for (const database of databases.splice(0)) database.close();
  });

  function createStore(): StatsStore {
    const database = new DatabaseConnection(':memory:');
    databases.push(database);
    return new StatsStore(database, new TranslationCache(database, 100));
  }

  it('sépare les annulations des véritables erreurs', () => {
    const stats = createStore();
    const cancelled = stats.beginRequest('batch', 6);
    stats.finishRequest(
      cancelled,
      new ProviderError('La requête a été annulée.', 'REQUEST_ABORTED', 499, false),
    );
    const failed = stats.beginRequest('single', 1);
    stats.finishRequest(
      failed,
      new ProviderError('Délai Ollama dépassé.', 'PROVIDER_TIMEOUT', 504, true),
    );

    expect(stats.get()).toMatchObject({
      errors: 1,
      cancelledLines: 6,
      runtime: {
        completedRequests: 2,
        failedRequests: 1,
        cancelledRequests: 1,
        affectedFailedCues: 1,
        affectedCancelledCues: 6,
        errorCounts: { REQUEST_ABORTED: 1, PROVIDER_TIMEOUT: 1 },
      },
    });
    expect(stats.get().runtime.recentIncidents).toEqual([
      expect.objectContaining({ kind: 'cancellation', operation: 'batch', cueCount: 6 }),
      expect.objectContaining({ kind: 'error', code: 'PROVIDER_TIMEOUT', cueCount: 1 }),
    ]);
  });

  it('mesure la concurrence et la durée de la session', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-08T10:00:00.000Z'));
    const stats = createStore();
    const first = stats.beginRequest('single', 1);
    vi.advanceTimersByTime(40);
    const second = stats.beginRequest('batch', 3);
    vi.advanceTimersByTime(60);
    stats.finishRequest(first);
    vi.advanceTimersByTime(20);
    stats.finishRequest(second);

    expect(stats.get().runtime).toMatchObject({
      activeRequests: 0,
      peakConcurrentRequests: 2,
      completedRequests: 2,
      successfulRequests: 2,
      averageRequestDurationMs: 90,
      lastRequestDurationMs: 80,
      maxRequestDurationMs: 100,
    });
  });
});
