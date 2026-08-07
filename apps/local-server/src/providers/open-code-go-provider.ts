import type { ProviderBatchTranslationItem } from '@dual-subtitles/shared';
import { z } from 'zod';

import { InvalidProviderResponseError, ProviderError, providerHttpError } from './errors.js';
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

const ChatCompletionSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            message: z.object({ content: z.string() }).passthrough(),
            finish_reason: z.string().nullable().optional(),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();

export interface OpenCodeGoProviderOptions {
  readonly apiKey: string;
  readonly endpoint?: string;
  readonly model?: string;
  readonly fetchFunction?: typeof fetch;
  readonly sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  readonly random?: () => number;
}

const DEFAULT_ENDPOINT = 'https://opencode.ai/zen/go/v1/chat/completions';
const DEFAULT_MODEL = 'deepseek-v4-flash';
const MAX_REALTIME_RETRY_DELAY_MS = 2_000;
const MAX_TRANSLATION_TOKENS = 8_000;
const MAX_BATCH_RECOVERY_DEPTH = 1;

function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timeout);
      reject(new DOMException('aborted', 'AbortError'));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function retryAfterMilliseconds(response: Response): number | undefined {
  const value = response.headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

async function safeResponseDetail(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 1_000);
  } catch {
    return "Réponse d'erreur illisible";
  }
}

export class OpenCodeGoProvider implements TranslationProvider {
  public readonly name = 'OpenCode Go / DeepSeek V4 Flash';
  readonly #apiKey: string;
  readonly #endpoint: string;
  readonly #model: string;
  readonly #fetch: typeof fetch;
  readonly #sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  readonly #random: () => number;

  public constructor(options: OpenCodeGoProviderOptions) {
    this.#apiKey = options.apiKey.trim();
    this.#endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.#model = options.model ?? DEFAULT_MODEL;
    this.#fetch = options.fetchFunction ?? fetch;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#random = options.random ?? Math.random;
  }

  public async translate(input: TranslationInput, options: ProviderRequestOptions) {
    return this.#withRetries(options, async (strictRetry) => {
      const content = await this.#request(
        SUBTITLE_SYSTEM_PROMPT,
        createSubtitleUserPrompt(input, strictRetry),
        estimateSingleMaxTokens(input.text),
        options.timeoutMs,
        options.signal,
      );
      return parseProviderTranslation(content);
    });
  }

  public async translateBatch(
    inputs: readonly BatchTranslationInput[],
    options: ProviderRequestOptions,
  ) {
    if (inputs.length === 0 || inputs.length > 40) {
      throw new InvalidProviderResponseError('Le lot fournisseur doit contenir de 1 à 40 cues.');
    }
    return this.#translateBatchWithRecovery(inputs, options);
  }

  async #translateBatchWithRecovery(
    inputs: readonly BatchTranslationInput[],
    options: ProviderRequestOptions,
    recoveryDepth = 0,
  ): Promise<ProviderBatchTranslationItem[]> {
    try {
      return await this.#requestBatch(inputs, options);
    } catch (error) {
      if (
        !(error instanceof InvalidProviderResponseError) ||
        inputs.length === 1 ||
        recoveryDepth >= MAX_BATCH_RECOVERY_DEPTH
      ) {
        throw error;
      }

      const middle = Math.ceil(inputs.length / 2);
      const firstHalf = await this.#translateBatchWithRecovery(
        inputs.slice(0, middle),
        options,
        recoveryDepth + 1,
      );
      const secondHalf = await this.#translateBatchWithRecovery(
        inputs.slice(middle),
        options,
        recoveryDepth + 1,
      );
      return [...firstHalf, ...secondHalf];
    }
  }

  async #requestBatch(
    inputs: readonly BatchTranslationInput[],
    options: ProviderRequestOptions,
  ): Promise<ProviderBatchTranslationItem[]> {
    const expectedCueIds = inputs.map(({ cueId }) => cueId);
    const maxTokens = estimateBatchMaxTokens(inputs);
    const translations = await this.#withRetries(options, async (strictRetry) => {
      const content = await this.#request(
        SUBTITLE_BATCH_SYSTEM_PROMPT,
        createSubtitleBatchUserPrompt(inputs, strictRetry),
        maxTokens,
        options.timeoutMs,
        options.signal,
      );
      return parseProviderBatchTranslation(content, expectedCueIds);
    });
    const byCueId = new Map(translations.map((translation) => [translation.cueId, translation]));
    return expectedCueIds.map((cueId) => byCueId.get(cueId)!);
  }

  async #withRetries<T>(
    options: ProviderRequestOptions,
    request: (strictRetry: boolean) => Promise<T>,
  ): Promise<T> {
    if (!this.#apiKey) {
      throw new ProviderError(
        "OPENCODE_GO_API_KEY n'est pas configurée dans le fichier .env du serveur.",
        'PROVIDER_NOT_CONFIGURED',
        503,
        false,
      );
    }

    let lastError: ProviderError | undefined;
    for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
      if (options.signal?.aborted) {
        throw new ProviderError('La requête a été annulée.', 'REQUEST_ABORTED', 499, false);
      }
      try {
        options.onAttempt?.();
        return await request(attempt > 0);
      } catch (error) {
        const providerError = this.#normalizeError(error);
        lastError = providerError;
        if (!providerError.retryable || attempt >= options.maxRetries) throw providerError;
        const exponentialDelay = Math.min(2_000, 250 * 2 ** attempt);
        const jitter = Math.floor(this.#random() * 100);
        const retryDelay = Math.min(
          MAX_REALTIME_RETRY_DELAY_MS,
          providerError.retryAfterMs ?? exponentialDelay + jitter,
        );
        try {
          await this.#sleep(retryDelay, options.signal);
        } catch (sleepError) {
          if (options.signal?.aborted) {
            throw new ProviderError('La requête a été annulée.', 'REQUEST_ABORTED', 499, false, {
              cause: sleepError,
            });
          }
          throw sleepError;
        }
      }
    }
    throw lastError ?? new InvalidProviderResponseError('Échec de traduction inattendu.');
  }

  async #request(
    systemPrompt: string,
    userPrompt: string,
    maxTokens: number,
    timeoutMs: number,
    externalSignal: AbortSignal | undefined,
  ): Promise<string> {
    const controller = new AbortController();
    let timedOut = false;
    const onExternalAbort = () => controller.abort(externalSignal?.reason);
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error('timeout'));
    }, timeoutMs);

    try {
      const response = await this.#fetch(this.#endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.#model,
          temperature: 0,
          max_tokens: maxTokens,
          thinking: { type: 'disabled' },
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw providerHttpError(
          response.status,
          await safeResponseDetail(response),
          retryAfterMilliseconds(response),
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        throw new InvalidProviderResponseError(
          "OpenCode Go n'a pas renvoyé un JSON HTTP valide.",
          error,
        );
      }
      const completion = ChatCompletionSchema.safeParse(payload);
      if (!completion.success) {
        throw new InvalidProviderResponseError(
          'La réponse OpenCode Go ne contient aucun message de modèle.',
          completion.error,
        );
      }
      const choice = completion.data.choices[0]!;
      if (choice.finish_reason === 'length') {
        throw new InvalidProviderResponseError(
          'La réponse JSON du modèle a été tronquée par la limite de tokens.',
        );
      }
      const content = choice.message.content;
      if (!content.trim()) {
        throw new InvalidProviderResponseError('Le modèle a renvoyé une réponse JSON vide.');
      }
      return content;
    } catch (error) {
      if (controller.signal.aborted) {
        if (externalSignal?.aborted && !timedOut) {
          throw new ProviderError('La requête a été annulée.', 'REQUEST_ABORTED', 499, false, {
            cause: error,
          });
        }
        throw new ProviderError(
          `OpenCode Go n'a pas répondu dans le délai de ${timeoutMs} ms.`,
          'PROVIDER_TIMEOUT',
          504,
          true,
          { cause: error },
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    }
  }

  #normalizeError(error: unknown): ProviderError {
    if (error instanceof ProviderError) return error;
    return new ProviderError(
      'Impossible de joindre OpenCode Go. Vérifiez votre connexion réseau.',
      'PROVIDER_NETWORK',
      503,
      true,
      { cause: error },
    );
  }
}

function estimateSingleMaxTokens(text: string): number {
  return clampTokenBudget(512, 256 + Math.ceil(text.length * 1.5));
}

function estimateBatchMaxTokens(inputs: readonly BatchTranslationInput[]): number {
  const estimate = inputs.reduce(
    (total, input) =>
      total + 96 + Math.ceil(input.text.length * 1.5) + Math.ceil(input.cueId.length / 2),
    256,
  );
  return clampTokenBudget(768, estimate);
}

function clampTokenBudget(minimum: number, estimate: number): number {
  return Math.min(MAX_TRANSLATION_TOKENS, Math.max(minimum, estimate));
}
