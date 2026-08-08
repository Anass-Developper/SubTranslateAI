import {
  ProviderTranslationSchema,
  chooseTranslationTargets,
  inferLanguageFromText,
  normalizeLanguageCode,
  normalizeSubtitleText,
  preserveOriginalLanguage,
  type ProviderBatchTranslationItem,
  type ProviderTranslation,
  type ServerSettings,
  type TranslateBatchRequest,
  type TranslateBatchResponse,
  type TranslateBatchResult,
  type TranslateRequest,
  type TranslateResponse,
} from '@dual-subtitles/shared';

import { createTranslationCacheKey, type TranslationCache } from '../cache/translation-cache.js';
import { InvalidProviderResponseError, ProviderError } from '../providers/errors.js';
import type {
  BatchTranslationInput,
  TranslationProvider,
} from '../providers/translation-provider.js';
import type { SettingsStore } from '../settings/settings-store.js';
import type { StatsStore } from '../stats/stats-store.js';

export class TranslationInputError extends Error {
  public readonly code = 'INVALID_SUBTITLE';
  public readonly statusCode = 400;

  public constructor(message: string) {
    super(message);
    this.name = 'TranslationInputError';
  }
}

interface UncachedTranslation extends ProviderTranslation {
  readonly sourceLanguage: string;
}

interface InFlightTranslation {
  readonly promise: Promise<UncachedTranslation>;
  readonly controller: AbortController;
  consumers: number;
  settled: boolean;
}

interface PreparedBatchCue {
  readonly cueId: string;
  readonly text: string;
  readonly sourceHint: string;
  readonly cacheKey: string;
  readonly previousLines: readonly string[];
}

interface PendingBatchTranslation {
  readonly prepared: PreparedBatchCue;
  readonly indexes: number[];
}

export interface TranslationServiceDependencies {
  readonly provider: TranslationProvider;
  readonly cache: TranslationCache;
  readonly settings: SettingsStore;
  readonly stats: StatsStore;
}

export class TranslationService {
  readonly #provider: TranslationProvider;
  readonly #cache: TranslationCache;
  readonly #settings: SettingsStore;
  readonly #stats: StatsStore;
  readonly #inFlight = new Map<string, InFlightTranslation>();

  public constructor(dependencies: TranslationServiceDependencies) {
    this.#provider = dependencies.provider;
    this.#cache = dependencies.cache;
    this.#settings = dependencies.settings;
    this.#stats = dependencies.stats;
  }

  public async translate(
    request: TranslateRequest,
    signal?: AbortSignal,
  ): Promise<TranslateResponse> {
    const text = normalizeSubtitleText(request.text);
    if (!text) throw new TranslationInputError('Le sous-titre est vide après normalisation.');

    const sourceHint =
      normalizeLanguageCode(request.detectedLanguage) ?? inferLanguageFromText(text) ?? 'und';
    const previouslyDetectedSource =
      sourceHint === 'und' ? this.#cache.findUniqueSourceLanguage(text) : undefined;
    const lookupSource = previouslyDetectedSource ?? sourceHint;
    const lookupTargetLanguages = chooseTranslationTargets(lookupSource);
    const cacheKey = createTranslationCacheKey(text, lookupSource, lookupTargetLanguages);
    const cached = this.#cache.get(cacheKey);
    if (cached) {
      this.#stats.increment('cacheHits');
      return {
        id: request.id,
        sourceLanguage: cached.sourceLanguage,
        fr: cached.fr,
        zh: cached.zh,
        cached: true,
      };
    }

    const existingRequest = this.#inFlight.get(cacheKey);
    if (existingRequest) {
      this.#stats.increment('cacheHits');
      return this.#consumeInFlight(existingRequest, request.id, signal, true);
    }

    this.#stats.increment('cacheMisses');
    const controller = new AbortController();
    const entry: InFlightTranslation = {
      controller,
      consumers: 0,
      settled: false,
      promise: this.#translateUncached(request, text, sourceHint, controller.signal),
    };
    this.#inFlight.set(cacheKey, entry);
    void entry.promise.then(
      () => this.#finishInFlight(cacheKey, entry),
      () => this.#finishInFlight(cacheKey, entry),
    );
    return this.#consumeInFlight(entry, request.id, signal, false);
  }

  public async translateBatch(
    request: TranslateBatchRequest,
    signal?: AbortSignal,
  ): Promise<TranslateBatchResponse> {
    if (!this.#provider.translateBatch) return this.#translateBatchFallback(request, signal);

    const controller = new AbortController();
    const abortFromCaller = (): void => controller.abort(signal?.reason);
    if (signal?.aborted) abortFromCaller();
    else signal?.addEventListener('abort', abortFromCaller, { once: true });

    try {
      const settings = this.#settings.get();
      const results: Array<TranslateBatchResult | undefined> = new Array(request.cues.length);
      const pendingByCacheKey = new Map<string, PendingBatchTranslation>();
      const inFlightConsumers: Promise<void>[] = [];

      for (const [index, cue] of request.cues.entries()) {
        const prepared = this.#prepareBatchCue(cue, settings);
        const cached = this.#cache.get(prepared.cacheKey);
        if (cached) {
          this.#stats.increment('cacheHits');
          results[index] = this.#toBatchResult(cue.cueId, cached, true);
          continue;
        }

        const existingRequest = this.#inFlight.get(prepared.cacheKey);
        if (existingRequest) {
          this.#stats.increment('cacheHits');
          inFlightConsumers.push(
            this.#consumeInFlight(existingRequest, cue.cueId, controller.signal, true).then(
              (translated) => {
                results[index] = this.#toBatchResult(cue.cueId, translated, true);
              },
            ),
          );
          continue;
        }

        const duplicate = pendingByCacheKey.get(prepared.cacheKey);
        if (duplicate) {
          this.#stats.increment('cacheHits');
          duplicate.indexes.push(index);
          continue;
        }

        this.#stats.increment('cacheMisses');
        pendingByCacheKey.set(prepared.cacheKey, { prepared, indexes: [index] });
      }

      const pending = [...pendingByCacheKey.values()];
      const translateMisses = this.#translateBatchUncached(
        pending.map(({ prepared }) => prepared),
        settings,
        controller.signal,
      ).then((translatedByCacheKey) => {
        for (const { prepared, indexes } of pending) {
          const translated = translatedByCacheKey.get(prepared.cacheKey);
          if (!translated) {
            throw new InvalidProviderResponseError(
              `Aucune traduction batch pour la cue ${prepared.cueId}.`,
            );
          }
          for (const [duplicateIndex, resultIndex] of indexes.entries()) {
            const cue = request.cues[resultIndex]!;
            results[resultIndex] = this.#toBatchResult(cue.cueId, translated, duplicateIndex > 0);
          }
        }
      });

      try {
        await Promise.all([translateMisses, ...inFlightConsumers]);
      } catch (error) {
        controller.abort(error);
        throw error;
      }

      return {
        results: results.map((result) => {
          if (!result) {
            throw new InvalidProviderResponseError('Une traduction batch est manquante.');
          }
          return result;
        }),
      };
    } finally {
      signal?.removeEventListener('abort', abortFromCaller);
    }
  }

  async #consumeInFlight(
    entry: InFlightTranslation,
    requestId: string,
    signal: AbortSignal | undefined,
    cached: boolean,
  ): Promise<TranslateResponse> {
    entry.consumers += 1;
    try {
      const shared = await this.#waitForConsumer(entry.promise, signal);
      return { id: requestId, ...shared, cached };
    } finally {
      entry.consumers -= 1;
      if (entry.consumers === 0 && !entry.settled) {
        entry.controller.abort(new Error('Tous les clients ont annulé la traduction'));
      }
    }
  }

  #waitForConsumer<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(this.#consumerAbortedError());

    return new Promise<T>((resolve, reject) => {
      let finished = false;
      const finish = (callback: () => void): void => {
        if (finished) return;
        finished = true;
        signal.removeEventListener('abort', onAbort);
        callback();
      };
      const onAbort = (): void => finish(() => reject(this.#consumerAbortedError()));
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
      void promise.then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
    });
  }

  #consumerAbortedError(): ProviderError {
    return new ProviderError('La requête a été annulée.', 'REQUEST_ABORTED', 499, false);
  }

  #finishInFlight(cacheKey: string, entry: InFlightTranslation): void {
    entry.settled = true;
    if (this.#inFlight.get(cacheKey) === entry) this.#inFlight.delete(cacheKey);
  }

  #prepareBatchCue(
    cue: TranslateBatchRequest['cues'][number],
    settings: ServerSettings,
  ): PreparedBatchCue {
    const text = normalizeSubtitleText(cue.text);
    if (!text) throw new TranslationInputError('Le sous-titre est vide après normalisation.');
    const sourceHint =
      normalizeLanguageCode(cue.detectedLanguage) ?? inferLanguageFromText(text) ?? 'und';
    const previouslyDetectedSource =
      sourceHint === 'und' ? this.#cache.findUniqueSourceLanguage(text) : undefined;
    const lookupSource = previouslyDetectedSource ?? sourceHint;
    const cacheKey = createTranslationCacheKey(
      text,
      lookupSource,
      chooseTranslationTargets(lookupSource),
    );
    const previousLines = (cue.previousLines ?? [])
      .map(normalizeSubtitleText)
      .filter((line) => line.length > 0 && line !== text)
      .slice(-settings.maxContextLines);
    return { cueId: cue.cueId, text, sourceHint, cacheKey, previousLines };
  }

  async #translateBatchUncached(
    preparedCues: readonly PreparedBatchCue[],
    settings: ServerSettings,
    signal: AbortSignal,
  ): Promise<Map<string, UncachedTranslation>> {
    if (preparedCues.length === 0) return new Map();
    const trackedRequest = this.#stats.beginRequest('batch', preparedCues.length);
    const providerInputs: BatchTranslationInput[] = preparedCues.map((cue) => ({
      cueId: cue.cueId,
      text: cue.text,
      previousLines: cue.previousLines,
      ...(cue.sourceHint === 'und' ? {} : { detectedLanguage: cue.sourceHint }),
    }));

    try {
      const providerResults = await this.#provider.translateBatch!(providerInputs, {
        timeoutMs: settings.requestTimeoutMs,
        maxRetries: settings.maxRetries,
        signal,
        onAttempt: () => this.#stats.increment('apiRequests'),
      });
      const byCueId = this.#validateBatchProviderResults(providerResults, preparedCues);
      const translatedByCacheKey = new Map<string, UncachedTranslation>();
      for (const cue of preparedCues) {
        const providerResult = byCueId.get(cue.cueId)!;
        const cleaned = this.#cleanProviderTranslation(cue.text, cue.sourceHint, providerResult);
        this.#cache.set(
          cue.text,
          cleaned.sourceLanguage,
          chooseTranslationTargets(cleaned.sourceLanguage),
          cleaned,
        );
        this.#stats.increment('translatedLines');
        translatedByCacheKey.set(cue.cacheKey, cleaned);
      }
      this.#stats.finishRequest(trackedRequest);
      return translatedByCacheKey;
    } catch (error) {
      this.#stats.finishRequest(trackedRequest, error);
      throw error;
    }
  }

  #validateBatchProviderResults(
    providerResults: readonly ProviderBatchTranslationItem[],
    preparedCues: readonly PreparedBatchCue[],
  ): Map<string, ProviderBatchTranslationItem> {
    const expectedCueIds = new Set(preparedCues.map(({ cueId }) => cueId));
    const byCueId = new Map<string, ProviderBatchTranslationItem>();
    for (const result of providerResults) {
      if (!expectedCueIds.has(result.cueId) || byCueId.has(result.cueId)) {
        throw new InvalidProviderResponseError(
          'Le fournisseur batch a renvoyé un cueId inattendu ou dupliqué.',
        );
      }
      byCueId.set(result.cueId, result);
    }
    if (byCueId.size !== expectedCueIds.size) {
      throw new InvalidProviderResponseError(
        'Le fournisseur batch a omis une ou plusieurs traductions.',
      );
    }
    return byCueId;
  }

  #cleanProviderTranslation(
    text: string,
    sourceHint: string,
    translated: ProviderTranslation,
  ): UncachedTranslation {
    const providerSourceLanguage =
      normalizeLanguageCode(translated.sourceLanguage) ?? translated.sourceLanguage;
    const sourceLanguage =
      providerSourceLanguage === 'und' && sourceHint !== 'und'
        ? sourceHint
        : providerSourceLanguage;
    const cleaned = ProviderTranslationSchema.safeParse({
      sourceLanguage,
      fr: normalizeSubtitleText(translated.fr),
      zh: normalizeSubtitleText(translated.zh),
    });
    if (!cleaned.success) {
      throw new InvalidProviderResponseError(
        'La traduction est vide ou invalide après normalisation.',
        cleaned.error,
      );
    }
    return preserveOriginalLanguage(text, sourceLanguage, cleaned.data);
  }

  #toBatchResult(
    cueId: string,
    translated: ProviderTranslation,
    cached: boolean,
  ): TranslateBatchResult {
    return {
      cueId,
      sourceLanguage: translated.sourceLanguage,
      fr: translated.fr,
      zh: translated.zh,
      cached,
    };
  }

  async #translateBatchFallback(
    request: TranslateBatchRequest,
    signal: AbortSignal | undefined,
  ): Promise<TranslateBatchResponse> {
    const controller = new AbortController();
    const abortFromCaller = (): void => controller.abort(signal?.reason);
    if (signal?.aborted) abortFromCaller();
    else signal?.addEventListener('abort', abortFromCaller, { once: true });

    const results: Array<TranslateBatchResult | undefined> = new Array(request.cues.length);
    let nextIndex = 0;
    let failed = false;
    let firstError: unknown;
    const worker = async (): Promise<void> => {
      while (!failed) {
        const index = nextIndex;
        nextIndex += 1;
        const cue = request.cues[index];
        if (!cue) return;
        try {
          const translated = await this.translate(
            {
              id: cue.cueId,
              text: cue.text,
              previousLines: cue.previousLines ?? [],
              ...(cue.detectedLanguage === undefined
                ? {}
                : { detectedLanguage: cue.detectedLanguage }),
            },
            controller.signal,
          );
          results[index] = this.#toBatchResult(cue.cueId, translated, translated.cached);
        } catch (error) {
          if (!failed) {
            failed = true;
            firstError = error;
            controller.abort(error);
          }
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(2, request.cues.length) }, worker));
      if (failed) throw firstError;
      return {
        results: results.map((result) => {
          if (!result) {
            throw new InvalidProviderResponseError('Une traduction batch est manquante.');
          }
          return result;
        }),
      };
    } finally {
      signal?.removeEventListener('abort', abortFromCaller);
    }
  }

  async #translateUncached(
    request: TranslateRequest,
    text: string,
    sourceHint: string,
    signal: AbortSignal | undefined,
  ): Promise<UncachedTranslation> {
    const settings = this.#settings.get();
    const trackedRequest = this.#stats.beginRequest('single', 1);
    const previousLines = request.previousLines
      .map(normalizeSubtitleText)
      .filter((line) => line.length > 0 && line !== text)
      .slice(-settings.maxContextLines);

    try {
      const providerInput = {
        text,
        previousLines,
        ...(sourceHint === 'und' ? {} : { detectedLanguage: sourceHint }),
      };
      const translated = await this.#provider.translate(providerInput, {
        timeoutMs: settings.requestTimeoutMs,
        maxRetries: settings.maxRetries,
        ...(signal ? { signal } : {}),
        onAttempt: () => this.#stats.increment('apiRequests'),
      });

      const preserved = this.#cleanProviderTranslation(text, sourceHint, translated);
      const targetLanguages = chooseTranslationTargets(preserved.sourceLanguage);
      this.#cache.set(text, preserved.sourceLanguage, targetLanguages, preserved);
      this.#stats.increment('translatedLines');
      this.#stats.finishRequest(trackedRequest);
      return preserved;
    } catch (error) {
      this.#stats.finishRequest(trackedRequest, error);
      throw error;
    }
  }
}
