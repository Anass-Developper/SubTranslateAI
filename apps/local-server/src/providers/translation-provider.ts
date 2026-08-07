import type { ProviderBatchTranslationItem, ProviderTranslation } from '@dual-subtitles/shared';

export interface TranslationInput {
  readonly text: string;
  readonly detectedLanguage?: string;
  readonly previousLines: readonly string[];
}

export interface BatchTranslationInput extends TranslationInput {
  readonly cueId: string;
}

export interface ProviderRequestOptions {
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly signal?: AbortSignal;
  readonly onAttempt?: () => void;
}

export interface TranslationProvider {
  readonly name: string;
  warmup?(): Promise<void>;
  translate(input: TranslationInput, options: ProviderRequestOptions): Promise<ProviderTranslation>;
  translateBatch?(
    inputs: readonly BatchTranslationInput[],
    options: ProviderRequestOptions,
  ): Promise<readonly ProviderBatchTranslationItem[]>;
}
