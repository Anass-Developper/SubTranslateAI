import { describe, expect, it, vi } from 'vitest';

import { ProviderError } from '../src/providers/errors.js';
import { FallbackTranslationProvider } from '../src/providers/fallback-translation-provider.js';
import type { TranslationProvider } from '../src/providers/translation-provider.js';

const translated = { sourceLanguage: 'en', fr: 'Bonjour', zh: '你好' } as const;

describe('FallbackTranslationProvider', () => {
  it('bascule vers le fournisseur distant quand le local échoue', async () => {
    const primary: TranslationProvider = {
      name: 'local',
      translate: vi.fn(async () => {
        throw new ProviderError('hors ligne', 'PROVIDER_NETWORK', 503, true);
      }),
    };
    const fallback: TranslationProvider = {
      name: 'distant',
      translate: vi.fn(async () => translated),
    };
    const provider = new FallbackTranslationProvider(primary, fallback);

    await expect(
      provider.translate({ text: 'Hello', previousLines: [] }, { timeoutMs: 1_000, maxRetries: 0 }),
    ).resolves.toEqual(translated);
    expect(fallback.translate).toHaveBeenCalledTimes(1);
  });

  it('ne transmet jamais une requête annulée au fournisseur distant', async () => {
    const primary: TranslationProvider = {
      name: 'local',
      async translate() {
        throw new ProviderError('annulée', 'REQUEST_ABORTED', 499, false);
      },
    };
    const fallback: TranslationProvider = {
      name: 'distant',
      translate: vi.fn(async () => translated),
    };
    const provider = new FallbackTranslationProvider(primary, fallback);

    await expect(
      provider.translate({ text: 'Hello', previousLines: [] }, { timeoutMs: 1_000, maxRetries: 0 }),
    ).rejects.toMatchObject({ code: 'REQUEST_ABORTED' });
    expect(fallback.translate).not.toHaveBeenCalled();
  });
});
