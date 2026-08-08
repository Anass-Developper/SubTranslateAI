import { afterEach, describe, expect, it, vi } from 'vitest';

import { StatsSchema } from '@dual-subtitles/shared';

import type { ServerConfig } from '../src/config.js';
import { DatabaseConnection } from '../src/database/database.js';
import { ProviderError } from '../src/providers/errors.js';
import type { TranslationProvider } from '../src/providers/translation-provider.js';
import { buildServer } from '../src/server.js';

const TEST_CONFIG: ServerConfig = {
  host: '127.0.0.1',
  port: 47_831,
  databasePath: ':memory:',
  apiKey: 'test-key',
  translationProvider: 'opencode',
  ollamaEndpoint: 'http://127.0.0.1:11434/api/chat',
  ollamaModel: 'translategemma:4b-it-q8_0',
  ollamaModelType: 'translategemma',
  ollamaConcurrency: 2,
  logLevel: 'silent',
  requestTimeoutMs: 1_000,
  providerMaxRetries: 0,
  rateLimitMax: 1_000,
  rateLimitWindowMs: 60_000,
  bodyLimitBytes: 32 * 1_024,
};

describe('routes Fastify', () => {
  const applications: Array<Awaited<ReturnType<typeof buildServer>>> = [];
  afterEach(async () => {
    for (const application of applications.splice(0)) await application.close();
  });

  async function setup(provider?: TranslationProvider) {
    const database = new DatabaseConnection(':memory:');
    const defaultProvider: TranslationProvider = {
      name: 'fake',
      async translate(_input, options) {
        options.onAttempt?.();
        return { sourceLanguage: 'en', fr: 'Bonjour', zh: '你好' };
      },
    };
    const app = await buildServer({
      config: TEST_CONFIG,
      database,
      provider: provider ?? defaultProvider,
      logger: false,
    });
    applications.push(app);
    return { app, database };
  }

  it('expose health seulement avec les données non sensibles', async () => {
    const { app } = await setup();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      apiKeyConfigured: true,
      provider: 'opencode',
      model: 'deepseek-v4-flash',
      database: 'ok',
      version: '1.0.0',
    });
    expect(response.body).not.toContain('test-key');
  });

  it('valide puis traduit une ligne et expose les statistiques', async () => {
    const { app } = await setup();
    const invalid = await app.inject({
      method: 'POST',
      url: '/translate',
      payload: { id: 'bad', text: '', previousLines: [] },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });

    const translated = await app.inject({
      method: 'POST',
      url: '/translate',
      payload: { id: 'ok', text: 'Hello', detectedLanguage: 'en', previousLines: [] },
    });
    expect(translated.statusCode).toBe(200);
    expect(translated.json()).toEqual({
      id: 'ok',
      sourceLanguage: 'en',
      fr: 'Bonjour',
      zh: '你好',
      cached: false,
    });
    const stats = await app.inject({ method: 'GET', url: '/stats' });
    expect(stats.json()).toMatchObject({ translatedLines: 1, apiRequests: 1, cacheEntries: 1 });
    expect(() => StatsSchema.parse(stats.json())).not.toThrow();
  });

  it('traduit un lot ordonné et remet chaque résultat en cache', async () => {
    const translate = vi.fn(async () => {
      throw new Error('Le chemin ligne ne doit pas être appelé pour ce lot.');
    });
    const translateBatch = vi.fn(async (inputs, options) => {
      options.onAttempt?.();
      return inputs.map((input) => ({
        cueId: input.cueId,
        sourceLanguage: input.detectedLanguage ?? 'en',
        fr: `fr:${input.text}`,
        zh: `zh:${input.text}`,
      }));
    });
    const { app } = await setup({ name: 'batch-fake', translate, translateBatch });
    const payload = {
      cues: [
        { cueId: 'cue-1', text: 'One', detectedLanguage: 'en' },
        { cueId: 'cue-2', text: 'Two', detectedLanguage: 'en', previousLines: ['One'] },
      ],
    };

    const first = await app.inject({ method: 'POST', url: '/translate/batch', payload });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({
      results: [
        { cueId: 'cue-1', sourceLanguage: 'en', fr: 'fr:One', zh: 'zh:One', cached: false },
        { cueId: 'cue-2', sourceLanguage: 'en', fr: 'fr:Two', zh: 'zh:Two', cached: false },
      ],
    });
    expect(translate).not.toHaveBeenCalled();
    expect(translateBatch).toHaveBeenCalledTimes(1);
    expect(translateBatch.mock.calls[0]![0]).toEqual([
      { cueId: 'cue-1', text: 'One', detectedLanguage: 'en', previousLines: [] },
      { cueId: 'cue-2', text: 'Two', detectedLanguage: 'en', previousLines: ['One'] },
    ]);

    const second = await app.inject({
      method: 'POST',
      url: '/translate/batch',
      payload: {
        cues: payload.cues.map((cue, index) => ({ ...cue, cueId: `cached-${index}` })),
      },
    });
    expect(second.json()).toMatchObject({
      results: [{ cached: true }, { cached: true }],
    });
    expect(translateBatch).toHaveBeenCalledTimes(1);
  });

  it('refuse les lots trop grands, ambigus ou enrichis de métadonnées média', async () => {
    const { app } = await setup();
    const duplicate = await app.inject({
      method: 'POST',
      url: '/translate/batch',
      payload: {
        cues: [
          { cueId: 'same', text: 'One' },
          { cueId: 'same', text: 'Two' },
        ],
      },
    });
    expect(duplicate.statusCode).toBe(400);

    const mediaMetadata = await app.inject({
      method: 'POST',
      url: '/translate/batch',
      payload: { cues: [{ cueId: 'cue-1', text: 'One', startMs: 1_000 }] },
    });
    expect(mediaMetadata.statusCode).toBe(400);

    const tooMany = await app.inject({
      method: 'POST',
      url: '/translate/batch',
      payload: {
        cues: Array.from({ length: 41 }, (_, index) => ({
          cueId: `cue-${index}`,
          text: `Line ${index}`,
        })),
      },
    });
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('classe les corps JSON et types de contenu invalides comme erreurs client', async () => {
    const { app } = await setup();
    const invalidJson = await app.inject({
      method: 'POST',
      url: '/translate',
      headers: { 'content-type': 'application/json' },
      payload: '{invalid',
    });
    expect(invalidJson.statusCode).toBe(400);
    expect(invalidJson.json()).toMatchObject({ error: { code: 'INVALID_JSON' } });

    const emptyJson = await app.inject({
      method: 'POST',
      url: '/translate',
      headers: { 'content-type': 'application/json' },
      payload: '',
    });
    expect(emptyJson.statusCode).toBe(400);
    expect(emptyJson.json()).toMatchObject({ error: { code: 'INVALID_JSON' } });

    const invalidType = await app.inject({
      method: 'POST',
      url: '/translate',
      headers: { 'content-type': 'text/plain' },
      payload: 'hello',
    });
    expect(invalidType.statusCode).toBe(415);
    expect(invalidType.json()).toMatchObject({
      error: { code: 'UNSUPPORTED_MEDIA_TYPE' },
    });

    const invalidSettingsType = await app.inject({
      method: 'PUT',
      url: '/settings',
      headers: { 'content-type': 'text/plain' },
      payload: '{}',
    });
    expect(invalidSettingsType.statusCode).toBe(415);
  });

  it('lit et met à jour uniquement les réglages autorisés', async () => {
    const { app } = await setup();
    const update = await app.inject({
      method: 'PUT',
      url: '/settings',
      payload: { debounceMs: 250, maxContextLines: 4 },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json()).toMatchObject({ debounceMs: 250, maxContextLines: 4 });

    const unknown = await app.inject({
      method: 'PUT',
      url: '/settings',
      payload: { apiKey: 'exfiltration' },
    });
    expect(unknown.statusCode).toBe(400);
  });

  it('vide le cache et ferme proprement SQLite', async () => {
    const { app, database } = await setup();
    await app.inject({
      method: 'POST',
      url: '/translate',
      payload: { id: 'one', text: 'Hello', detectedLanguage: 'en', previousLines: [] },
    });
    const cleared = await app.inject({ method: 'DELETE', url: '/cache' });
    expect(cleared.json()).toEqual({ cleared: 1 });
    await app.close();
    applications.splice(applications.indexOf(app), 1);
    expect(database.handle.open).toBe(false);
  });

  it('autorise les extensions et refuse les origines web externes', async () => {
    const { app } = await setup();
    const extension = await app.inject({
      method: 'OPTIONS',
      url: '/translate',
      headers: {
        origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
        'access-control-request-method': 'POST',
      },
    });
    expect(extension.headers['access-control-allow-origin']).toBe(
      'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
    );
    const external = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil.example' },
    });
    expect(external.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('retourne une erreur fournisseur claire sans révéler la réponse distante', async () => {
    const provider: TranslationProvider = {
      name: 'broken',
      async translate() {
        throw new ProviderError(
          'La limite de requêtes OpenCode Go est atteinte.',
          'PROVIDER_RATE_LIMIT',
          429,
          true,
          { cause: 'secret upstream payload' },
        );
      },
    };
    const { app } = await setup(provider);
    const response = await app.inject({
      method: 'POST',
      url: '/translate',
      payload: { id: 'failure', text: 'Hello', detectedLanguage: 'en', previousLines: [] },
    });
    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({
      error: {
        code: 'PROVIDER_RATE_LIMIT',
        message: 'La limite de requêtes OpenCode Go est atteinte.',
        retryable: true,
      },
    });
    expect(response.body).not.toContain('secret upstream payload');
    const stats = await app.inject({ method: 'GET', url: '/stats' });
    expect(stats.json()).toMatchObject({
      errors: 1,
      cancelledLines: 0,
      runtime: {
        failedRequests: 1,
        cancelledRequests: 0,
        errorCounts: { PROVIDER_RATE_LIMIT: 1 },
        recentIncidents: [
          expect.objectContaining({ code: 'PROVIDER_RATE_LIMIT', operation: 'single' }),
        ],
      },
    });
    expect(stats.body).not.toContain('secret upstream payload');
  });
});
