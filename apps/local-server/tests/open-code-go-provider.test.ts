import { describe, expect, it, vi } from 'vitest';

import { ProviderError } from '../src/providers/errors.js';
import { OpenCodeGoProvider } from '../src/providers/open-code-go-provider.js';

const VALID_COMPLETION = {
  choices: [
    {
      message: {
        content: '{"sourceLanguage":"en","fr":"Salut","zh":"你好"}',
      },
    },
  ],
};

function jsonResponse(value: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const INPUT = { text: 'Hi', detectedLanguage: 'en', previousLines: [] } as const;

describe('OpenCodeGoProvider', () => {
  it('traduit plusieurs cues avec un seul appel HTTP sans métadonnées média', async () => {
    const translations = [
      { cueId: 'cue-2', sourceLanguage: 'en', fr: 'Deux', zh: '二' },
      { cueId: 'cue-1', sourceLanguage: 'en', fr: 'Un', zh: '一' },
    ];
    const completion = {
      choices: [{ message: { content: JSON.stringify({ translations }) } }],
    };
    const fetchFunction = vi.fn(async () => jsonResponse(completion));
    const provider = new OpenCodeGoProvider({
      apiKey: 'secret',
      fetchFunction: fetchFunction as unknown as typeof fetch,
    });
    const inputs = [
      { cueId: 'cue-1', text: 'One', detectedLanguage: 'en', previousLines: [] },
      { cueId: 'cue-2', text: 'Two', detectedLanguage: 'en', previousLines: ['One'] },
    ] as const;

    await expect(
      provider.translateBatch(inputs, { timeoutMs: 1_000, maxRetries: 0 }),
    ).resolves.toEqual([translations[1], translations[0]]);
    expect(fetchFunction).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchFunction.mock.calls[0]![1] as RequestInit).body)) as {
      max_tokens: number;
      thinking: { type: string };
      messages: Array<{ content: string }>;
    };
    expect(body.max_tokens).toBe(768);
    expect(body.thinking).toEqual({ type: 'disabled' });
    const prompt = JSON.parse(body.messages[1]!.content) as { cues: unknown[] };
    expect(prompt.cues).toEqual([
      {
        cueId: 'cue-1',
        detectedLanguageHint: 'en',
        previousLines: [],
        currentLine: 'One',
      },
      {
        cueId: 'cue-2',
        detectedLanguageHint: 'en',
        previousLines: ['One'],
        currentLine: 'Two',
      },
    ]);
    expect(body.messages[1]!.content).not.toContain('startMs');
    expect(body.messages[1]!.content).not.toContain('http');
  });

  it("scinde séquentiellement un lot invalide après ses retries et conserve l'ordre", async () => {
    const inputs = Array.from({ length: 8 }, (_, index) => ({
      cueId: `cue-${index + 1}`,
      text: `Line ${index + 1}`,
      previousLines: [],
    }));
    const requestedBatches: string[][] = [];
    const fetchFunction = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      const userPrompt = body.messages[1]!.content;
      const prompt = JSON.parse(userPrompt.slice(userPrompt.indexOf('{"cues"'))) as {
        cues: Array<{ cueId: string }>;
      };
      const cueIds = prompt.cues.map(({ cueId }) => cueId);
      requestedBatches.push(cueIds);
      if (cueIds.length === 8) {
        return jsonResponse({ choices: [{ message: { content: 'réponse tronquée' } }] });
      }
      const translations = [...cueIds].reverse().map((cueId) => ({
        cueId,
        sourceLanguage: 'en',
        fr: `Français ${cueId}`,
        zh: `中${cueId}`,
      }));
      return jsonResponse({
        choices: [{ message: { content: JSON.stringify({ translations }) } }],
      });
    });
    const sleep = vi.fn(async () => undefined);
    const provider = new OpenCodeGoProvider({
      apiKey: 'secret',
      fetchFunction: fetchFunction as unknown as typeof fetch,
      sleep,
      random: () => 0,
    });

    const results = await provider.translateBatch(inputs, {
      timeoutMs: 1_000,
      maxRetries: 1,
    });

    expect(requestedBatches).toEqual([
      inputs.map(({ cueId }) => cueId),
      inputs.map(({ cueId }) => cueId),
      inputs.slice(0, 4).map(({ cueId }) => cueId),
      inputs.slice(4).map(({ cueId }) => cueId),
    ]);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(results.map(({ cueId }) => cueId)).toEqual(inputs.map(({ cueId }) => cueId));
  });

  it('ne scinde jamais une cue seule quand sa réponse est invalide', async () => {
    const fetchFunction = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: 'réponse tronquée' } }] }),
    );
    const provider = new OpenCodeGoProvider({
      apiKey: 'secret',
      fetchFunction: fetchFunction as unknown as typeof fetch,
    });

    await expect(
      provider.translateBatch([{ cueId: 'cue-1', text: 'One', previousLines: [] }], {
        timeoutMs: 1_000,
        maxRetries: 0,
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_INVALID_RESPONSE' });
    expect(fetchFunction).toHaveBeenCalledTimes(1);
  });

  it('borne la récupération batch à une seule division', async () => {
    const fetchFunction = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: 'réponse tronquée' } }] }),
    );
    const provider = new OpenCodeGoProvider({
      apiKey: 'secret',
      fetchFunction: fetchFunction as unknown as typeof fetch,
    });

    await expect(
      provider.translateBatch(
        Array.from({ length: 8 }, (_, index) => ({
          cueId: `cue-${index + 1}`,
          text: `Line ${index + 1}`,
          previousLines: [],
        })),
        { timeoutMs: 1_000, maxRetries: 0 },
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_INVALID_RESPONSE' });
    expect(fetchFunction).toHaveBeenCalledTimes(2);
  });

  it('ne scinde pas un lot refusé par le rate limit', async () => {
    const fetchFunction = vi.fn(async () => jsonResponse({ error: 'slow down' }, 429));
    const provider = new OpenCodeGoProvider({
      apiKey: 'secret',
      fetchFunction: fetchFunction as unknown as typeof fetch,
    });

    await expect(
      provider.translateBatch(
        Array.from({ length: 8 }, (_, index) => ({
          cueId: `cue-${index + 1}`,
          text: `Line ${index + 1}`,
          previousLines: [],
        })),
        { timeoutMs: 1_000, maxRetries: 0 },
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_RATE_LIMIT' });
    expect(fetchFunction).toHaveBeenCalledTimes(1);
  });

  it('ne scinde pas un lot après une erreur réseau', async () => {
    const fetchFunction = vi.fn(async () => {
      throw new TypeError('network unavailable');
    });
    const provider = new OpenCodeGoProvider({
      apiKey: 'secret',
      fetchFunction: fetchFunction as unknown as typeof fetch,
    });

    await expect(
      provider.translateBatch(
        Array.from({ length: 8 }, (_, index) => ({
          cueId: `cue-${index + 1}`,
          text: `Line ${index + 1}`,
          previousLines: [],
        })),
        { timeoutMs: 1_000, maxRetries: 0 },
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_NETWORK' });
    expect(fetchFunction).toHaveBeenCalledTimes(1);
  });

  it('refuse une réponse batch qui omet une cue demandée', async () => {
    const completion = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              translations: [{ cueId: 'cue-1', sourceLanguage: 'en', fr: 'Un', zh: '一' }],
            }),
          },
        },
      ],
    };
    const fetchFunction = vi.fn(async () => jsonResponse(completion));
    const provider = new OpenCodeGoProvider({
      apiKey: 'secret',
      fetchFunction: fetchFunction as unknown as typeof fetch,
    });

    await expect(
      provider.translateBatch(
        [
          { cueId: 'cue-1', text: 'One', previousLines: [] },
          { cueId: 'cue-2', text: 'Two', previousLines: [] },
        ],
        { timeoutMs: 1_000, maxRetries: 0 },
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_INVALID_RESPONSE' });
  });

  it("envoie le modèle, l'authentification et une requête indépendante minimale", async () => {
    const fetchFunction = vi.fn(async () => jsonResponse(VALID_COMPLETION));
    const provider = new OpenCodeGoProvider({
      apiKey: 'secret',
      fetchFunction: fetchFunction as unknown as typeof fetch,
    });

    await expect(provider.translate(INPUT, { timeoutMs: 1_000, maxRetries: 0 })).resolves.toEqual({
      sourceLanguage: 'en',
      fr: 'Salut',
      zh: '你好',
    });
    const [url, init] = fetchFunction.mock.calls[0]!;
    expect(url).toBe('https://opencode.ai/zen/go/v1/chat/completions');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer secret' });
    const body = JSON.parse(String((init as RequestInit).body)) as {
      model: string;
      temperature: number;
      max_tokens: number;
      thinking: { type: string };
      messages: unknown[];
    };
    expect(body.model).toBe('deepseek-v4-flash');
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBe(512);
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.messages).toHaveLength(2);
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('retente automatiquement un JSON modèle invalide', async () => {
    const fetchFunction = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'pas du json' } }] }))
      .mockResolvedValueOnce(jsonResponse(VALID_COMPLETION));
    const sleep = vi.fn(async () => undefined);
    const provider = new OpenCodeGoProvider({
      apiKey: 'secret',
      fetchFunction: fetchFunction as unknown as typeof fetch,
      sleep,
      random: () => 0,
    });

    await expect(
      provider.translate(INPUT, { timeoutMs: 1_000, maxRetries: 1 }),
    ).resolves.toMatchObject({
      fr: 'Salut',
    });
    expect(fetchFunction).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls[0]?.[0]).toBe(250);
    const retryBody = JSON.parse(String((fetchFunction.mock.calls[1]![1] as RequestInit).body)) as {
      messages: Array<{ content: string }>;
    };
    expect(retryBody.messages[1]!.content).toContain('réponse précédente était invalide');
  });

  it('retente un contenu vide et signale explicitement une sortie tronquée', async () => {
    const fetchFunction = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '' } }] }))
      .mockResolvedValueOnce(jsonResponse(VALID_COMPLETION));
    const provider = new OpenCodeGoProvider({
      apiKey: 'secret',
      fetchFunction: fetchFunction as unknown as typeof fetch,
      sleep: async () => undefined,
      random: () => 0,
    });

    await expect(
      provider.translate(INPUT, { timeoutMs: 1_000, maxRetries: 1 }),
    ).resolves.toMatchObject({ fr: 'Salut' });

    const truncatedProvider = new OpenCodeGoProvider({
      apiKey: 'secret',
      fetchFunction: (async () =>
        jsonResponse({
          choices: [{ finish_reason: 'length', message: { content: '{"sourceLanguage":"en"' } }],
        })) as typeof fetch,
    });
    await expect(
      truncatedProvider.translate(INPUT, { timeoutMs: 1_000, maxRetries: 0 }),
    ).rejects.toThrow('tronquée');
  });

  it('ne retente jamais une erreur 401', async () => {
    const fetchFunction = vi.fn(async () => jsonResponse({ error: 'unauthorized' }, 401));
    const provider = new OpenCodeGoProvider({
      apiKey: 'bad',
      fetchFunction: fetchFunction as unknown as typeof fetch,
    });

    const error = await provider
      .translate(INPUT, { timeoutMs: 1_000, maxRetries: 3 })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({
      code: 'PROVIDER_AUTHENTICATION',
      statusCode: 401,
      retryable: false,
    });
    expect(fetchFunction).toHaveBeenCalledTimes(1);
  });

  it('respecte Retry-After sur une erreur 429 puis réussit', async () => {
    const fetchFunction = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'slow down' }, 429, { 'retry-after': '1' }))
      .mockResolvedValueOnce(jsonResponse(VALID_COMPLETION));
    const sleep = vi.fn(async () => undefined);
    const provider = new OpenCodeGoProvider({
      apiKey: 'secret',
      fetchFunction: fetchFunction as unknown as typeof fetch,
      sleep,
    });

    await provider.translate(INPUT, { timeoutMs: 1_000, maxRetries: 1 });
    expect(sleep.mock.calls[0]?.[0]).toBe(1_000);
    expect(fetchFunction).toHaveBeenCalledTimes(2);
  });

  it('plafonne un Retry-After excessif', async () => {
    const fetchFunction = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'slow down' }, 429, { 'retry-after': '999' }))
      .mockResolvedValueOnce(jsonResponse(VALID_COMPLETION));
    const sleep = vi.fn(async () => undefined);
    const provider = new OpenCodeGoProvider({
      apiKey: 'secret',
      fetchFunction: fetchFunction as unknown as typeof fetch,
      sleep,
    });

    await provider.translate(INPUT, { timeoutMs: 1_000, maxRetries: 1 });
    expect(sleep.mock.calls[0]?.[0]).toBe(2_000);
  });

  it("interrompt immédiatement l'attente avant retry quand le client annule", async () => {
    const controller = new AbortController();
    const fetchFunction = vi.fn(async () =>
      jsonResponse({ error: 'slow down' }, 429, { 'retry-after': '10' }),
    );
    const sleep = vi.fn(async (_milliseconds: number, signal?: AbortSignal) => {
      controller.abort();
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    });
    const provider = new OpenCodeGoProvider({
      apiKey: 'secret',
      fetchFunction: fetchFunction as unknown as typeof fetch,
      sleep,
    });

    await expect(
      provider.translate(INPUT, {
        timeoutMs: 1_000,
        maxRetries: 2,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_ABORTED', retryable: false });
    expect(fetchFunction).toHaveBeenCalledTimes(1);
  });

  it('transforme un dépassement de délai en erreur explicite', async () => {
    const fetchFunction = vi.fn((_url: unknown, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    });
    const provider = new OpenCodeGoProvider({
      apiKey: 'secret',
      fetchFunction: fetchFunction as unknown as typeof fetch,
    });

    const error = await provider
      .translate(INPUT, { timeoutMs: 5, maxRetries: 0 })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'PROVIDER_TIMEOUT', retryable: true });
  });
});
