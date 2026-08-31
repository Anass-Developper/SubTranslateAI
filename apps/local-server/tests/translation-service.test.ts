import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProviderTranslation } from '@dual-subtitles/shared';

import { TranslationCache } from '../src/cache/translation-cache.js';
import { DatabaseConnection } from '../src/database/database.js';
import type {
  ProviderRequestOptions,
  TranslationInput,
  TranslationProvider,
} from '../src/providers/translation-provider.js';
import { TranslationService } from '../src/services/translation-service.js';
import { SettingsStore } from '../src/settings/settings-store.js';
import { StatsStore } from '../src/stats/stats-store.js';

function fixture(result: { sourceLanguage: string; fr: string; zh: string }) {
  const database = new DatabaseConnection(':memory:');
  const cache = new TranslationCache(database, 100);
  const settings = new SettingsStore(database);
  const stats = new StatsStore(database, cache);
  const translate = vi.fn(async (_input: TranslationInput, options: ProviderRequestOptions) => {
    options.onAttempt?.();
    return result;
  });
  const provider: TranslationProvider = { name: 'fake', translate };
  return {
    database,
    cache,
    translate,
    stats,
    service: new TranslationService({ provider, cache, settings, stats }),
  };
}

describe('TranslationService', () => {
  const databases: DatabaseConnection[] = [];
  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
  });

  it('français vers chinois: conserve exactement le français original', async () => {
    const test = fixture({ sourceLanguage: 'fr', fr: 'Texte modifié', zh: '我不知道。' });
    databases.push(test.database);
    await expect(
      test.service.translate({
        id: 'fr-1',
        text: 'Je ne savais pas que tu étais ici.',
        detectedLanguage: 'fr-FR',
        previousLines: [],
      }),
    ).resolves.toEqual({
      id: 'fr-1',
      sourceLanguage: 'fr',
      fr: 'Je ne savais pas que tu étais ici.',
      zh: '我不知道。',
      cached: false,
    });
  });

  it('chinois vers français: conserve exactement le chinois original', async () => {
    const test = fixture({ sourceLanguage: 'zh', fr: 'Je ne savais pas.', zh: 'changé' });
    databases.push(test.database);
    await expect(
      test.service.translate({
        id: 'zh-1',
        text: '我不知道。',
        detectedLanguage: 'zh-Hans',
        previousLines: [],
      }),
    ).resolves.toMatchObject({
      sourceLanguage: 'zh',
      fr: 'Je ne savais pas.',
      zh: '我不知道。',
    });
  });

  it('anglais vers français et chinois puis réutilise le cache', async () => {
    const test = fixture({ sourceLanguage: 'en', fr: 'Je suis là.', zh: '我在这里。' });
    databases.push(test.database);
    const request = {
      id: 'en-1',
      text: "I'm here.",
      detectedLanguage: 'en',
      previousLines: ['Where are you?'],
    };
    await expect(test.service.translate(request)).resolves.toMatchObject({
      sourceLanguage: 'en',
      fr: 'Je suis là.',
      zh: '我在这里。',
      cached: false,
    });
    await expect(test.service.translate({ ...request, id: 'en-2' })).resolves.toMatchObject({
      id: 'en-2',
      cached: true,
    });
    expect(test.translate).toHaveBeenCalledTimes(1);
    expect(test.stats.get()).toMatchObject({
      translatedLines: 1,
      cacheHits: 1,
      cacheMisses: 1,
      apiRequests: 1,
    });
  });

  it('préfère la langue réellement détectée par le modèle à un indice erroné', async () => {
    const test = fixture({
      sourceLanguage: 'ja',
      fr: 'Je suis étudiant.',
      zh: '我是学生。',
    });
    databases.push(test.database);

    await expect(
      test.service.translate({
        id: 'wrong-hint',
        text: '私は学生です。',
        detectedLanguage: 'zh',
        previousLines: [],
      }),
    ).resolves.toMatchObject({
      sourceLanguage: 'ja',
      fr: 'Je suis étudiant.',
      zh: '我是学生。',
    });
  });

  it('limite et normalise le contexte précédent', async () => {
    const test = fixture({ sourceLanguage: 'en', fr: 'Maintenant', zh: '现在' });
    databases.push(test.database);
    await test.service.translate({
      id: 'context',
      text: 'Now',
      detectedLanguage: 'en',
      previousLines: [' one ', '<i>two</i>', 'three', 'four'],
    });
    expect(test.translate.mock.calls[0]![0].previousLines).toEqual(['two', 'three', 'four']);
  });

  it('invalide une ancienne phrase NASA/FBI restée en français dans le cache', async () => {
    const source = 'La NASA collabore avec le FBI.';
    const test = fixture({ sourceLanguage: 'fr', fr: source, zh: 'NASA与FBI合作。' });
    databases.push(test.database);
    test.cache.set(source, 'fr', ['zh'], { sourceLanguage: 'fr', fr: source, zh: source });

    await expect(
      test.service.translate({
        id: 'repair-acronyms',
        text: source,
        detectedLanguage: 'fr',
        previousLines: [],
      }),
    ).resolves.toMatchObject({ zh: 'NASA与FBI合作。', cached: false });
    expect(test.translate).toHaveBeenCalledTimes(1);
    expect(test.cache.count()).toBe(1);
  });

  it("n'annule pas une traduction partagée tant qu'un autre client l'attend", async () => {
    const database = new DatabaseConnection(':memory:');
    databases.push(database);
    const cache = new TranslationCache(database, 100);
    const settings = new SettingsStore(database);
    const stats = new StatsStore(database, cache);
    let resolveProvider!: (value: ProviderTranslation) => void;
    let providerSignal: AbortSignal | undefined;
    const provider: TranslationProvider = {
      name: 'shared-request',
      translate(_input, options) {
        options.onAttempt?.();
        providerSignal = options.signal;
        return new Promise<ProviderTranslation>((resolve) => {
          resolveProvider = resolve;
        });
      },
    };
    const service = new TranslationService({ provider, cache, settings, stats });
    const firstController = new AbortController();
    const secondController = new AbortController();
    const request = {
      id: 'shared-1',
      text: 'Hello',
      detectedLanguage: 'en',
      previousLines: [],
    };

    const first = service.translate(request, firstController.signal);
    const second = service.translate({ ...request, id: 'shared-2' }, secondController.signal);
    firstController.abort();

    await expect(first).rejects.toMatchObject({ code: 'REQUEST_ABORTED' });
    expect(providerSignal?.aborted).toBe(false);
    resolveProvider({ sourceLanguage: 'en', fr: 'Bonjour', zh: '你好' });
    await expect(second).resolves.toMatchObject({ id: 'shared-2', cached: true });
  });
});
