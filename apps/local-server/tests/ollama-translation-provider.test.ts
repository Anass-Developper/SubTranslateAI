import { describe, expect, it, vi } from 'vitest';

import { OllamaTranslationProvider } from '../src/providers/ollama-translation-provider.js';

function ollamaResponse(content: string, status = 200): Response {
  return new Response(JSON.stringify({ message: { content }, done: true }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('OllamaTranslationProvider', () => {
  it('utilise TranslateGemma deux fois pour produire français et chinois', async () => {
    const fetchFunction = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{ content: string }>;
        model: string;
        stream: boolean;
        think: boolean;
      };
      const prompt = body.messages[0]!.content;
      return ollamaResponse(prompt.includes('into French') ? 'Pas de problème.' : '没问题。');
    });
    const provider = new OllamaTranslationProvider({
      model: 'translategemma:test',
      modelType: 'translategemma',
      fetchFunction: fetchFunction as unknown as typeof fetch,
    });

    await expect(
      provider.translate(
        {
          text: 'No problem.',
          detectedLanguage: 'en',
          previousLines: ['Can you handle it?'],
        },
        { timeoutMs: 1_000, maxRetries: 0 },
      ),
    ).resolves.toEqual({ sourceLanguage: 'en', fr: 'Pas de problème.', zh: '没问题。' });
    expect(fetchFunction).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String((fetchFunction.mock.calls[0]![1] as RequestInit).body)) as {
      model: string;
      messages: Array<{ content: string }>;
    };
    expect(firstBody.model).toBe('translategemma:test');
    expect(firstBody.messages[0]!.content).toContain('Can you handle it?');
    expect(firstBody.messages[0]!.content).toContain(
      'Please translate the following English text into French:\nNo problem.',
    );
  });

  it('préserve une source française et ne demande que le chinois', async () => {
    const fetchFunction = vi.fn(async () => ollamaResponse('你疯了！'));
    const provider = new OllamaTranslationProvider({
      modelType: 'translategemma',
      fetchFunction: fetchFunction as unknown as typeof fetch,
    });

    await expect(
      provider.translate(
        { text: 'Tu es complètement fou !', detectedLanguage: 'fr', previousLines: [] },
        { timeoutMs: 1_000, maxRetries: 0 },
      ),
    ).resolves.toEqual({
      sourceLanguage: 'fr',
      fr: 'Tu es complètement fou !',
      zh: '你疯了！',
    });
    expect(fetchFunction).toHaveBeenCalledTimes(1);
  });

  it('traduit un lot spécialisé avec une concurrence bornée et conserve son ordre', async () => {
    let active = 0;
    let maximumActive = 0;
    const fetchFunction = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      const current = body.messages[0]!.content.trim().split('\n').at(-1)!;
      active -= 1;
      return ollamaResponse(`译:${current}`);
    });
    const provider = new OllamaTranslationProvider({
      concurrency: 2,
      modelType: 'translategemma',
      fetchFunction: fetchFunction as unknown as typeof fetch,
    });
    const inputs = Array.from({ length: 5 }, (_, index) => ({
      cueId: `cue-${index}`,
      text: `Ligne ${index}`,
      detectedLanguage: 'fr',
      previousLines: [],
    }));

    const result = await provider.translateBatch(inputs, { timeoutMs: 1_000, maxRetries: 0 });

    expect(result.map(({ cueId }) => cueId)).toEqual(inputs.map(({ cueId }) => cueId));
    expect(result[3]?.zh).toBe('译:Ligne 3');
    expect(maximumActive).toBeLessThanOrEqual(2);
  });

  it('utilise une seule réponse JSON batch avec un modèle conversationnel', async () => {
    const fetchFunction = vi.fn(async () =>
      ollamaResponse(
        JSON.stringify({
          translations: [
            { cueId: 'two', sourceLanguage: 'en', fr: 'Deux', zh: '二' },
            { cueId: 'one', sourceLanguage: 'en', fr: 'Un', zh: '一' },
          ],
        }),
      ),
    );
    const provider = new OllamaTranslationProvider({
      model: 'qwen3:8b',
      modelType: 'chat-json',
      fetchFunction: fetchFunction as unknown as typeof fetch,
    });
    const result = await provider.translateBatch(
      [
        { cueId: 'one', text: 'One', detectedLanguage: 'en', previousLines: [] },
        { cueId: 'two', text: 'Two', detectedLanguage: 'en', previousLines: ['One'] },
      ],
      { timeoutMs: 1_000, maxRetries: 0 },
    );

    expect(result.map(({ cueId }) => cueId)).toEqual(['one', 'two']);
    expect(fetchFunction).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchFunction.mock.calls[0]![1] as RequestInit).body)) as {
      format: string;
      think: boolean;
    };
    expect(body).toMatchObject({ format: 'json', think: false });
  });

  it('signale clairement un modèle absent', async () => {
    const provider = new OllamaTranslationProvider({
      fetchFunction: (async () => ollamaResponse('not found', 404)) as typeof fetch,
    });

    await expect(
      provider.translate(
        { text: 'Bonjour', detectedLanguage: 'fr', previousLines: [] },
        { timeoutMs: 1_000, maxRetries: 0 },
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED', retryable: false });
  });

  it('refuse un mot latin halluciné au milieu du chinois', async () => {
    const provider = new OllamaTranslationProvider({
      modelType: 'hy-mt',
      fetchFunction: (async () => ollamaResponse('这扇门通向 nowhere。')) as typeof fetch,
      sleep: async () => undefined,
    });

    await expect(
      provider.translate(
        {
          text: 'Cette porte ne mène nulle part.',
          detectedLanguage: 'fr',
          previousLines: [],
        },
        { timeoutMs: 1_000, maxRetries: 1 },
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_INVALID_RESPONSE' });
  });

  it('retraduit toute la phrase tout en conservant NASA et FBI', async () => {
    const source = 'La NASA collabore avec le FBI.';
    const fetchFunction = vi
      .fn()
      .mockResolvedValueOnce(ollamaResponse(source))
      .mockResolvedValueOnce(ollamaResponse('NASA与FBI合作。'));
    const provider = new OllamaTranslationProvider({
      modelType: 'hy-mt',
      fetchFunction: fetchFunction as unknown as typeof fetch,
      sleep: async () => undefined,
    });

    await expect(
      provider.translate(
        { text: source, detectedLanguage: 'fr', previousLines: [] },
        { timeoutMs: 1_000, maxRetries: 1 },
      ),
    ).resolves.toEqual({ sourceLanguage: 'fr', fr: source, zh: 'NASA与FBI合作。' });
    expect(fetchFunction).toHaveBeenCalledTimes(2);

    for (const call of fetchFunction.mock.calls) {
      const body = JSON.parse(String((call[1] as RequestInit).body)) as {
        messages: Array<{ content: string }>;
      };
      expect(body.messages[0]?.content).toContain('Keep these acronyms or codes unchanged');
      expect(body.messages[0]?.content).toContain('NASA, FBI');
    }
  });

  it('accepte un équivalent chinois établi pour un sigle français', async () => {
    const source = "Demande-lui, pour l'ONU.";
    const provider = new OllamaTranslationProvider({
      modelType: 'hy-mt',
      fetchFunction: (async () => ollamaResponse('请替我问问他关于联合国的事。')) as typeof fetch,
    });

    await expect(
      provider.translate(
        { text: source, detectedLanguage: 'fr', previousLines: ['Parle-lui.'] },
        { timeoutMs: 1_000, maxRetries: 0 },
      ),
    ).resolves.toEqual({
      sourceLanguage: 'fr',
      fr: source,
      zh: '请替我问问他关于联合国的事。',
    });
  });

  it('accepte un sous-titre composé uniquement du sigle FBI', async () => {
    const provider = new OllamaTranslationProvider({
      modelType: 'hy-mt',
      fetchFunction: (async () => ollamaResponse('FBI')) as typeof fetch,
    });

    await expect(
      provider.translate(
        { text: 'FBI', detectedLanguage: 'fr', previousLines: [] },
        { timeoutMs: 1_000, maxRetries: 0 },
      ),
    ).resolves.toEqual({ sourceLanguage: 'fr', fr: 'FBI', zh: 'FBI' });
  });

  it('accepte la casse normalisée par le modèle pour un sigle écrit comme un nom', async () => {
    const source = 'La Nasa prépare le prochain lancement.';
    const provider = new OllamaTranslationProvider({
      modelType: 'hy-mt',
      fetchFunction: (async () => ollamaResponse('NASA正在准备下一次发射。')) as typeof fetch,
    });

    await expect(
      provider.translate(
        { text: source, detectedLanguage: 'fr', previousLines: [] },
        { timeoutMs: 1_000, maxRetries: 0 },
      ),
    ).resolves.toEqual({ sourceLanguage: 'fr', fr: source, zh: 'NASA正在准备下一次发射。' });
  });

  it('préchauffe le modèle sans générer de traduction', async () => {
    const fetchFunction = vi.fn(async () => ollamaResponse(''));
    const provider = new OllamaTranslationProvider({
      endpoint: 'http://127.0.0.1:11434/api/chat',
      model: 'local:test',
      fetchFunction: fetchFunction as unknown as typeof fetch,
    });

    await provider.warmup();

    expect(fetchFunction).toHaveBeenCalledTimes(1);
    expect(fetchFunction.mock.calls[0]?.[0]).toBe('http://127.0.0.1:11434/api/generate');
    const body = JSON.parse(String((fetchFunction.mock.calls[0]![1] as RequestInit).body));
    expect(body).toEqual({ model: 'local:test', keep_alive: '30m' });
  });
});
