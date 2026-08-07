export interface PreloadCue {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
}

export interface PreloadBatchRequest {
  trackId: string;
  cues: readonly PreloadCue[];
}

export interface PreloadBatchTranslation {
  id: string;
  sourceLanguage: string;
  fr: string;
  zh: string;
  cached: boolean;
}

export interface PreloadedCueTranslation extends PreloadBatchTranslation {
  cue: Readonly<PreloadCue>;
}

/** Transport injectable : HTTP, service worker ou faux client de test. */
export interface SubtitleBatchClient {
  translateBatch(
    request: PreloadBatchRequest,
    signal: AbortSignal,
  ): Promise<readonly PreloadBatchTranslation[]>;
}

export interface SubtitlePreloadManagerOptions {
  /** Limite dure : 40, même si une valeur supérieure est fournie. */
  maxBatchSize?: number;
  /** Limite dure : 2, même si une valeur supérieure est fournie. */
  concurrency?: number;
  /** Taille du micro-lot prioritaire. Sans valeur, les lots historiques sont conservés. */
  foregroundBatchSize?: number;
  /** Fenêtre future, en millisecondes, incluse dans le micro-lot prioritaire. */
  foregroundWindowMs?: number;
  lookAheadMs?: number;
  lookBehindMs?: number;
  onTranslation?: (translation: PreloadedCueTranslation) => void;
  onError?: (error: unknown, cues: readonly PreloadCue[]) => void;
}

export interface SubtitlePreloadStatus {
  trackId: string | null;
  total: number;
  translated: number;
  inFlight: number;
  failed: number;
  pending: number;
}
