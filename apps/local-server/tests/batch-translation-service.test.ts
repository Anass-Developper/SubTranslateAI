import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  ProviderTranslation,
  TranslateRequest,
  TranslateResponse,
} from '@dual-subtitles/shared';

import { TranslationCache } from '../src/cache/translation-cache.js';
import { DatabaseConnection } from '../src/database/database.js';
import type {
  ProviderRequestOptions,
  TranslationInput,
  TranslationProvider,
} from '../src/providers/translation-provider.js';
import {
  BATCH_TRANSLATION_CONCURRENCY,
  BatchTranslationService,
  type LineTranslationService,
} from '../src/services/batch-translation-service.js';
import { TranslationService } from '../src/services/translation-service.js';
import { SettingsStore } from '../src/settings/settings-store.js';
import { StatsStore } from '../src/stats/stats-store.js';

interface DeferredTranslation {
  readonly resolve: (value: TranslateResponse) => void;
  readonly reject: (reason: unknown) => void;
}

describe('BatchTranslationService', () => {
  const databases: DatabaseConnection[] = [];
  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
  });

  it('préserve l’ordre avec au plus deux traductions simultanées', async () => {
    const pending = new Map<string, DeferredTranslation>();
    let active = 0;
    let maximumActive = 0;
    const lineService: LineTranslationService = {
      translate: vi.fn((request: TranslateRequest) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        return new Promise<TranslateResponse>((resolve, reject) => {
          pending.set(request.id, {
            resolve(value) {
              active -= 1;
              resolve(value);
            },
            reject(reason) {
              active -= 1;
              reject(reason);
            },
          });
        });
      }),
    };
    const service = new BatchTranslationService(lineService);
    const promise = service.translate({
      cues: Array.from({ length: 5 }, (_, index) => ({
        cueId: `cue-${index}`,
        text: `Line ${index}`,
        previousLines: [],
      })),
    });

    await vi.waitFor(() => expect(pending.size).toBe(2));
    expect(maximumActive).toBe(BATCH_TRANSLATION_CONCURRENCY);

    const finish = (cueId: string): void => {
      pending.get(cueId)?.resolve({
        id: cueId,
        sourceLanguage: 'en',
        fr: `fr-${cueId}`,
        zh: `zh-${cueId}`,
        cached: false,
      });
      pending.delete(cueId);
    };
    finish('cue-1');
    await vi.waitFor(() => expect(pending.has('cue-2')).toBe(true));
    finish('cue-0');
    await vi.waitFor(() => expect(pending.has('cue-3')).toBe(true));
    finish('cue-3');
    await vi.waitFor(() => expect(pending.has('cue-4')).toBe(true));
    finish('cue-2');
    finish('cue-4');

    await expect(promise).resolves.toEqual({
      results: Array.from({ length: 5 }, (_, index) => ({
        cueId: `cue-${index}`,
        sourceLanguage: 'en',
        fr: `fr-cue-${index}`,
        zh: `zh-cue-${index}`,
        cached: false,
      })),
    });
    expect(maximumActive).toBe(2);
  });

  it('réutilise le cache et les requêtes en vol du service ligne', async () => {
    const database = new DatabaseConnection(':memory:');
    databases.push(database);
    const cache = new TranslationCache(database, 100);
    const settings = new SettingsStore(database);
    const stats = new StatsStore(database, cache);
    const providerResult: ProviderTranslation = {
      sourceLanguage: 'en',
      fr: 'Bonjour',
      zh: '你好',
    };
    const translate = vi.fn(async (): Promise<ProviderTranslation> => {
      throw new Error('Le fallback ligne ne doit pas être utilisé.');
    });
    const translateBatch = vi.fn(
      async (
        inputs: readonly (TranslationInput & { cueId: string })[],
        options: ProviderRequestOptions,
      ) => {
        options.onAttempt?.();
        return inputs.map(({ cueId }) => ({ cueId, ...providerResult }));
      },
    );
    const provider: TranslationProvider = { name: 'fake', translate, translateBatch };
    const lines = new TranslationService({ provider, cache, settings, stats });
    const service = new BatchTranslationService(lines);

    const response = await service.translate({
      cues: [
        { cueId: 'first', text: 'Hello', detectedLanguage: 'en', previousLines: [] },
        { cueId: 'duplicate', text: 'Hello', detectedLanguage: 'en', previousLines: [] },
      ],
    });

    expect(translate).not.toHaveBeenCalled();
    expect(translateBatch).toHaveBeenCalledTimes(1);
    expect(translateBatch.mock.calls[0]![0]).toEqual([
      { cueId: 'first', text: 'Hello', detectedLanguage: 'en', previousLines: [] },
    ]);
    expect(response.results).toEqual([
      { cueId: 'first', sourceLanguage: 'en', fr: 'Bonjour', zh: '你好', cached: false },
      { cueId: 'duplicate', sourceLanguage: 'en', fr: 'Bonjour', zh: '你好', cached: true },
    ]);

    await expect(
      service.translate({
        cues: [{ cueId: 'later', text: 'Hello', detectedLanguage: 'en', previousLines: [] }],
      }),
    ).resolves.toMatchObject({ results: [{ cueId: 'later', cached: true }] });
    expect(translateBatch).toHaveBeenCalledTimes(1);
  });

  it('arrête les cues en attente dès la première erreur', async () => {
    const failure = new Error('provider failed');
    const signals: AbortSignal[] = [];
    let rejectSecond!: (reason: unknown) => void;
    const translate = vi.fn((request: TranslateRequest, signal?: AbortSignal) => {
      if (signal) signals.push(signal);
      if (request.id === 'first') return Promise.reject(failure);
      return new Promise<TranslateResponse>((_resolve, reject) => {
        rejectSecond = reject;
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    const service = new BatchTranslationService({ translate });
    const promise = service.translate({
      cues: [
        { cueId: 'first', text: 'One', previousLines: [] },
        { cueId: 'second', text: 'Two', previousLines: [] },
        { cueId: 'never-started', text: 'Three', previousLines: [] },
      ],
    });

    await expect(promise).rejects.toBe(failure);
    expect(translate).toHaveBeenCalledTimes(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(rejectSecond).toBeTypeOf('function');
  });
});
