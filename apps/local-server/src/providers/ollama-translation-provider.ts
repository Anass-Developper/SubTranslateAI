import {
  normalizeLanguageCode,
  type ProviderBatchTranslationItem,
  type ProviderTranslation,
} from '@dual-subtitles/shared';
import { z } from 'zod';

import { InvalidProviderResponseError, ProviderError } from './errors.js';
import {
  createSubtitleBatchUserPrompt,
  createSubtitleUserPrompt,
  SUBTITLE_BATCH_SYSTEM_PROMPT,
  SUBTITLE_SYSTEM_PROMPT,
} from './prompt.js';
import { parseProviderBatchTranslation, parseProviderTranslation } from './response-parser.js';
import type {
  BatchTranslationInput,
  ProviderRequestOptions,
  TranslationInput,
  TranslationProvider,
} from './translation-provider.js';

const OllamaChatResponseSchema = z
  .object({
    message: z.object({ content: z.string() }).passthrough(),
    done_reason: z.string().optional(),
  })
  .passthrough();

export type OllamaModelType = 'translategemma' | 'hy-mt' | 'chat-json';

export interface OllamaTranslationProviderOptions {
  readonly endpoint?: string;
  readonly model?: string;
  readonly modelType?: OllamaModelType;
  readonly concurrency?: number;
  readonly fetchFunction?: typeof fetch;
  readonly sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  readonly random?: () => number;
}

const DEFAULT_ENDPOINT = 'http://127.0.0.1:11434/api/chat';
const DEFAULT_MODEL = 'hf.co/tencent/Hy-MT2-7B-GGUF:Q4_K_M';
const MAX_RETRY_DELAY_MS = 2_000;
const LOCAL_JSON_SYSTEM_PROMPT = `${SUBTITLE_SYSTEM_PROMPT}

Contraintes supplémentaires pour le modèle local :
- Dans "zh", utilise exclusivement le chinois simplifié et ne laisse aucun mot de la langue source, sauf un véritable nom propre.
- Dans "fr", conserve exactement les négations et évite les calques grammaticaux.
- Vérifie silencieusement que le sens logique, le temps et la négation sont préservés avant de produire le JSON.`;
const LOCAL_JSON_BATCH_SYSTEM_PROMPT = `${SUBTITLE_BATCH_SYSTEM_PROMPT}

Contraintes supplémentaires pour le modèle local :
- Dans "zh", utilise exclusivement le chinois simplifié et ne laisse aucun mot de la langue source, sauf un véritable nom propre.
- Dans "fr", conserve exactement les négations et évite les calques grammaticaux.
- Vérifie silencieusement que le sens logique, le temps et la négation sont préservés avant de produire le JSON.`;

export class OllamaTranslationProvider implements TranslationProvider {
  public readonly name: string;
  readonly #endpoint: string;
  readonly #model: string;
  readonly #modelType: OllamaModelType;
  readonly #concurrency: number;
  readonly #fetch: typeof fetch;
  readonly #sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  readonly #random: () => number;

  public constructor(options: OllamaTranslationProviderOptions = {}) {
    this.#endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.#model = options.model ?? DEFAULT_MODEL;
    this.#modelType = options.modelType ?? 'hy-mt';
    this.#concurrency = Math.max(1, Math.min(8, options.concurrency ?? 2));
    this.#fetch = options.fetchFunction ?? fetch;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#random = options.random ?? Math.random;
    this.name = `Ollama / ${this.#model}`;
  }

  public async warmup(): Promise<void> {
    const response = await this.#fetch(
      this.#endpoint.replace(/\/api\/chat\/?$/u, '/api/generate'),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.#model, keep_alive: '30m' }),
      },
    );
    if (!response.ok) throw ollamaHttpError(response.status, await safeResponseDetail(response));
  }

  public async translate(
    input: TranslationInput,
    options: ProviderRequestOptions,
  ): Promise<ProviderTranslation> {
    if (this.#modelType === 'chat-json') {
      const content = await this.#withRetries(options, async (strictRetry) =>
        this.#request(
          [
            { role: 'system', content: LOCAL_JSON_SYSTEM_PROMPT },
            { role: 'user', content: createSubtitleUserPrompt(input, strictRetry) },
          ],
          true,
          options,
        ),
      );
      return parseProviderTranslation(content);
    }
    return this.#translateWithSingleTargetModel(input, options);
  }

  public async translateBatch(
    inputs: readonly BatchTranslationInput[],
    options: ProviderRequestOptions,
  ): Promise<readonly ProviderBatchTranslationItem[]> {
    if (inputs.length === 0 || inputs.length > 40) {
      throw new InvalidProviderResponseError('Le lot Ollama doit contenir de 1 à 40 cues.');
    }
    if (this.#modelType === 'chat-json') {
      const expectedCueIds = inputs.map(({ cueId }) => cueId);
      const content = await this.#withRetries(options, async (strictRetry) =>
        this.#request(
          [
            { role: 'system', content: LOCAL_JSON_BATCH_SYSTEM_PROMPT },
            { role: 'user', content: createSubtitleBatchUserPrompt(inputs, strictRetry) },
          ],
          true,
          options,
        ),
      );
      const translations = parseProviderBatchTranslation(content, expectedCueIds);
      const byCueId = new Map(translations.map((translation) => [translation.cueId, translation]));
      return expectedCueIds.map((cueId) => byCueId.get(cueId)!);
    }

    const results: Array<ProviderBatchTranslationItem | undefined> = new Array(inputs.length);
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        const input = inputs[index];
        if (!input) return;
        results[index] = { cueId: input.cueId, ...(await this.translate(input, options)) };
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.#concurrency, inputs.length) }, worker));
    return results.map((result) => {
      if (!result) throw new InvalidProviderResponseError('Une traduction Ollama est manquante.');
      return result;
    });
  }

  async #translateWithSingleTargetModel(
    input: TranslationInput,
    options: ProviderRequestOptions,
  ): Promise<ProviderTranslation> {
    const sourceLanguage = detectSourceLanguage(input);
    let fr = input.text;
    let zh = input.text;

    if (sourceLanguage !== 'fr') {
      fr = await this.#translateTarget(input, sourceLanguage, 'fr', options);
    }
    if (sourceLanguage !== 'zh') {
      zh = await this.#translateTarget(input, sourceLanguage, 'zh-Hans', options);
    }
    return { sourceLanguage, fr, zh };
  }

  async #translateTarget(
    input: TranslationInput,
    sourceLanguage: string,
    targetLanguage: 'fr' | 'zh-Hans',
    options: ProviderRequestOptions,
  ): Promise<string> {
    return this.#withRetries(options, async (strictRetry) => {
      const sourceName = languageName(sourceLanguage);
      const targetName = languageName(targetLanguage);
      const context = input.previousLines.length
        ? `Previous dialogue for context only; do not translate or output it:\n${input.previousLines.join('\n')}\n\n`
        : '';
      const strictNotice = strictRetry
        ? 'Your previous answer was invalid. Output only the translated current subtitle.\n\n'
        : '';
      const prompt =
        this.#modelType === 'hy-mt'
          ? `${context}${strictNotice}Translate the following current film subtitle from ${sourceName} into ${targetName}. Preserve its meaning, tone, register and negation, but keep it natural and concise. Note that you must ONLY output the translated result without quotes or any additional explanation:\n${input.text}`
          : `You are a professional ${sourceName} (${sourceLanguage}) to ${targetName} (${targetLanguage}) translator. Your goal is to accurately convey the meaning and nuances of the original ${sourceName} text while adhering to ${targetName} grammar, vocabulary and cultural sensitivities. Keep the result natural and concise enough for a film subtitle. Preserve tone, register, humor and established proper names. Do not censor it.\n\nProduce only the ${targetName} translation, without quotes, labels, explanations or commentary. Never leave untranslated source-language words unless they are proper names.\n\n${context}${strictNotice}Please translate the following ${sourceName} text into ${targetName}:\n${input.text}`;
      const content = await this.#request([{ role: 'user', content: prompt }], false, options);
      return cleanPlainTranslation(content, targetLanguage, input.text);
    });
  }

  async #withRetries<T>(
    options: ProviderRequestOptions,
    request: (strictRetry: boolean) => Promise<T>,
  ): Promise<T> {
    let lastError: ProviderError | undefined;
    for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
      if (options.signal?.aborted) throw abortedError();
      try {
        options.onAttempt?.();
        return await request(attempt > 0);
      } catch (error) {
        const providerError = normalizeOllamaError(error);
        lastError = providerError;
        if (!providerError.retryable || attempt >= options.maxRetries) throw providerError;
        const delay = Math.min(MAX_RETRY_DELAY_MS, 250 * 2 ** attempt + this.#random() * 100);
        await this.#sleep(Math.floor(delay), options.signal);
      }
    }
    throw lastError ?? new InvalidProviderResponseError('Échec Ollama inattendu.');
  }

  async #request(
    messages: ReadonlyArray<{ readonly role: 'system' | 'user'; readonly content: string }>,
    json: boolean,
    options: ProviderRequestOptions,
  ): Promise<string> {
    const controller = new AbortController();
    let timedOut = false;
    const relayAbort = (): void => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', relayAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error('timeout'));
    }, options.timeoutMs);

    try {
      const response = await this.#fetch(this.#endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.#model,
          stream: false,
          think: false,
          keep_alive: '30m',
          ...(json ? { format: 'json' } : {}),
          options:
            this.#modelType === 'hy-mt'
              ? {
                  temperature: 0.7,
                  top_p: 0.6,
                  top_k: 20,
                  repeat_penalty: 1.05,
                  seed: 42,
                  num_predict: 512,
                }
              : { temperature: 0, num_predict: json ? 8_000 : 512 },
          messages,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = await safeResponseDetail(response);
        throw ollamaHttpError(response.status, detail);
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        throw new InvalidProviderResponseError(
          "Ollama n'a pas renvoyé un JSON HTTP valide.",
          error,
        );
      }
      const parsed = OllamaChatResponseSchema.safeParse(payload);
      if (!parsed.success || !parsed.data.message.content.trim()) {
        throw new InvalidProviderResponseError('Ollama a renvoyé une réponse vide ou invalide.');
      }
      if (parsed.data.done_reason === 'length') {
        throw new InvalidProviderResponseError('La réponse Ollama a été tronquée.');
      }
      return parsed.data.message.content;
    } catch (error) {
      if (controller.signal.aborted) {
        if (options.signal?.aborted && !timedOut) throw abortedError(error);
        throw new ProviderError(
          `Ollama n'a pas répondu dans le délai de ${options.timeoutMs} ms.`,
          'PROVIDER_TIMEOUT',
          504,
          true,
          { cause: error },
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', relayAbort);
    }
  }
}

function languageName(code: string): string {
  if (code === 'fr') return 'French';
  if (code === 'zh' || code === 'zh-Hans') return 'Chinese (Simplified)';
  if (code === 'en') return 'English';
  return code;
}

function detectSourceLanguage(input: TranslationInput): string {
  const configured = normalizeLanguageCode(input.detectedLanguage);
  if (configured && configured !== 'und') return configured;
  const context = `${input.previousLines.join(' ')} ${input.text}`;
  if (/\p{Script=Han}/u.test(context)) return 'zh';
  if (/[àâçéèêëîïôùûüÿœæ]/iu.test(context)) return 'fr';
  return 'en';
}

function cleanPlainTranslation(
  content: string,
  targetLanguage: 'fr' | 'zh-Hans',
  sourceText: string,
): string {
  const cleaned = content
    .trim()
    .replace(/^```(?:text)?\s*/iu, '')
    .replace(/\s*```$/u, '')
    .trim();
  if (!cleaned)
    throw new InvalidProviderResponseError('TranslateGemma a renvoyé une traduction vide.');
  if (targetLanguage === 'fr' && /\p{Script=Han}/u.test(cleaned)) {
    throw new InvalidProviderResponseError('Le modèle local a laissé du chinois dans le français.');
  }
  if (targetLanguage === 'zh-Hans') {
    const unexpectedLatinWord = cleaned
      .match(/[A-Za-z][A-Za-z'-]{1,}/gu)
      ?.find((word) => !sourceText.includes(word));
    if (unexpectedLatinWord) {
      throw new InvalidProviderResponseError(
        `Le modèle local a laissé un mot non traduit dans le chinois : ${unexpectedLatinWord}.`,
      );
    }
  }
  return cleaned;
}

function normalizeOllamaError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  return new ProviderError(
    'Impossible de joindre Ollama. Vérifiez que le service local et le modèle sont installés.',
    'PROVIDER_NETWORK',
    503,
    true,
    { cause: error },
  );
}

function ollamaHttpError(status: number, detail: string): ProviderError {
  if (status === 404) {
    return new ProviderError(
      "Le modèle Ollama demandé est introuvable. Exécutez d'abord « ollama pull <modèle> ».",
      'PROVIDER_NOT_CONFIGURED',
      503,
      false,
      { cause: detail },
    );
  }
  if (status >= 500) {
    return new ProviderError(
      `Ollama est temporairement indisponible (HTTP ${status}).`,
      'PROVIDER_UPSTREAM',
      503,
      true,
      { cause: detail },
    );
  }
  return new ProviderError(
    `Ollama a refusé la requête (HTTP ${status}).`,
    'PROVIDER_UPSTREAM',
    502,
    false,
    { cause: detail },
  );
}

function abortedError(cause?: unknown): ProviderError {
  return new ProviderError('La requête a été annulée.', 'REQUEST_ABORTED', 499, false, { cause });
}

async function safeResponseDetail(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 1_000);
  } catch {
    return "Réponse d'erreur illisible";
  }
}

function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortedError(signal.reason));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timeout);
      reject(abortedError(signal?.reason));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
