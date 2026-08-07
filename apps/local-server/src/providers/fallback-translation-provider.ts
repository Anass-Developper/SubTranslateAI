import { ProviderError } from './errors.js';
import type {
  BatchTranslationInput,
  ProviderRequestOptions,
  TranslationInput,
  TranslationProvider,
} from './translation-provider.js';

export class FallbackTranslationProvider implements TranslationProvider {
  public readonly name: string;

  public constructor(
    private readonly primary: TranslationProvider,
    private readonly fallback: TranslationProvider,
  ) {
    this.name = `${primary.name}, secours ${fallback.name}`;
  }

  public async warmup(): Promise<void> {
    await this.primary.warmup?.();
  }

  public async translate(input: TranslationInput, options: ProviderRequestOptions) {
    try {
      return await this.primary.translate(input, options);
    } catch (error) {
      if (!shouldFallback(error, options.signal)) throw error;
      return this.fallback.translate(input, options);
    }
  }

  public async translateBatch(
    inputs: readonly BatchTranslationInput[],
    options: ProviderRequestOptions,
  ) {
    try {
      if (this.primary.translateBatch) return await this.primary.translateBatch(inputs, options);
      return await translateIndividually(this.primary, inputs, options);
    } catch (error) {
      if (!shouldFallback(error, options.signal)) throw error;
      if (this.fallback.translateBatch) return this.fallback.translateBatch(inputs, options);
      return translateIndividually(this.fallback, inputs, options);
    }
  }
}

function shouldFallback(error: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) return false;
  return !(error instanceof ProviderError && error.code === 'REQUEST_ABORTED');
}

async function translateIndividually(
  provider: TranslationProvider,
  inputs: readonly BatchTranslationInput[],
  options: ProviderRequestOptions,
) {
  return Promise.all(
    inputs.map(async (input) => ({
      cueId: input.cueId,
      ...(await provider.translate(input, options)),
    })),
  );
}
