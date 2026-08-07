import type {
  TranslateBatchRequest,
  TranslateBatchResponse,
  TranslateRequest,
  TranslateResponse,
} from '@dual-subtitles/shared';

export const BATCH_TRANSLATION_CONCURRENCY = 2;

export interface LineTranslationService {
  translate(request: TranslateRequest, signal?: AbortSignal): Promise<TranslateResponse>;
  translateBatch?(
    request: TranslateBatchRequest,
    signal?: AbortSignal,
  ): Promise<TranslateBatchResponse>;
}

export class BatchTranslationService {
  readonly #translations: LineTranslationService;

  public constructor(translations: LineTranslationService) {
    this.#translations = translations;
  }

  public async translate(
    request: TranslateBatchRequest,
    signal?: AbortSignal,
  ): Promise<TranslateBatchResponse> {
    if (this.#translations.translateBatch) {
      return this.#translations.translateBatch(request, signal);
    }

    const controller = new AbortController();
    const abortFromCaller = (): void => controller.abort(signal?.reason);
    if (signal?.aborted) abortFromCaller();
    else signal?.addEventListener('abort', abortFromCaller, { once: true });

    const results: TranslateBatchResponse['results'] = new Array(request.cues.length);
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
          const translated = await this.#translations.translate(
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
          results[index] = {
            cueId: cue.cueId,
            sourceLanguage: translated.sourceLanguage,
            fr: translated.fr,
            zh: translated.zh,
            cached: translated.cached,
          };
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
      const workerCount = Math.min(BATCH_TRANSLATION_CONCURRENCY, request.cues.length);
      await Promise.all(Array.from({ length: workerCount }, worker));
      if (failed) throw firstError;
      return { results };
    } finally {
      signal?.removeEventListener('abort', abortFromCaller);
    }
  }
}
