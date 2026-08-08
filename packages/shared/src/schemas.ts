import { z } from 'zod';

export const LanguageCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(35)
  .regex(/^[a-zA-Z]{2,3}(?:[-_][a-zA-Z0-9]{2,8})*$/, 'Code de langue invalide');

export const TranslateRequestSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    text: z.string().min(1).max(2_000),
    detectedLanguage: LanguageCodeSchema.optional(),
    previousLines: z.array(z.string().min(1).max(2_000)).max(4).default([]),
  })
  .strict();

export const TranslateResponseSchema = z
  .object({
    id: z.string().min(1).max(160),
    sourceLanguage: LanguageCodeSchema,
    fr: z.string().min(1).max(4_000),
    zh: z.string().min(1).max(4_000),
    cached: z.boolean(),
  })
  .strict();

export const TranslateBatchCueSchema = z
  .object({
    cueId: z.string().trim().min(1).max(160),
    text: z.string().min(1).max(2_000),
    detectedLanguage: LanguageCodeSchema.optional(),
    previousLines: z.array(z.string().min(1).max(2_000)).max(4).default([]),
  })
  .strict();

export const TranslateBatchRequestSchema = z
  .object({
    cues: z.array(TranslateBatchCueSchema).min(1).max(40),
  })
  .strict()
  .superRefine(({ cues }, context) => {
    const seenCueIds = new Set<string>();
    for (const [index, cue] of cues.entries()) {
      if (seenCueIds.has(cue.cueId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'cueId doit être unique dans le lot',
          path: ['cues', index, 'cueId'],
        });
      }
      seenCueIds.add(cue.cueId);
    }
  });

export const TranslateBatchResultSchema = z
  .object({
    cueId: z.string().min(1).max(160),
    sourceLanguage: LanguageCodeSchema,
    fr: z.string().min(1).max(4_000),
    zh: z.string().min(1).max(4_000),
    cached: z.boolean(),
  })
  .strict();

export const TranslateBatchResponseSchema = z
  .object({
    results: z.array(TranslateBatchResultSchema).min(1).max(40),
  })
  .strict();

export const ProviderTranslationSchema = z
  .object({
    sourceLanguage: LanguageCodeSchema,
    fr: z.string().trim().min(1).max(4_000),
    zh: z.string().trim().min(1).max(4_000),
  })
  .strict();

export const ProviderBatchTranslationItemSchema = ProviderTranslationSchema.extend({
  cueId: z.string().trim().min(1).max(160),
}).strict();

export const ProviderBatchTranslationResponseSchema = z
  .object({
    translations: z.array(ProviderBatchTranslationItemSchema).min(1).max(40),
  })
  .strict();

export const ServerSettingsSchema = z
  .object({
    debounceMs: z.number().int().min(0).max(2_000),
    fragmentWindowMs: z.number().int().min(0).max(3_000),
    requestTimeoutMs: z.number().int().min(1_000).max(120_000),
    maxRetries: z.number().int().min(0).max(5),
    maxContextLines: z.number().int().min(2).max(4),
    memoryCacheEntries: z.number().int().min(10).max(20_000),
  })
  .strict();

export const UpdateServerSettingsSchema = ServerSettingsSchema.partial().strict();

export const DiagnosticIncidentSchema = z
  .object({
    occurredAt: z.string().datetime(),
    kind: z.enum(['error', 'cancellation']),
    operation: z.enum(['single', 'batch']),
    code: z.string().min(1).max(80),
    message: z.string().min(1).max(500),
    retryable: z.boolean(),
    cueCount: z.number().int().positive(),
    durationMs: z.number().int().nonnegative(),
  })
  .strict();

export const RuntimeDiagnosticsSchema = z
  .object({
    sessionStartedAt: z.string().datetime(),
    translatedLines: z.number().int().nonnegative(),
    cacheHits: z.number().int().nonnegative(),
    cacheMisses: z.number().int().nonnegative(),
    apiRequests: z.number().int().nonnegative(),
    activeRequests: z.number().int().nonnegative(),
    peakConcurrentRequests: z.number().int().nonnegative(),
    completedRequests: z.number().int().nonnegative(),
    successfulRequests: z.number().int().nonnegative(),
    failedRequests: z.number().int().nonnegative(),
    cancelledRequests: z.number().int().nonnegative(),
    affectedFailedCues: z.number().int().nonnegative(),
    affectedCancelledCues: z.number().int().nonnegative(),
    averageRequestDurationMs: z.number().int().nonnegative(),
    lastRequestDurationMs: z.number().int().nonnegative().nullable(),
    maxRequestDurationMs: z.number().int().nonnegative(),
    errorCounts: z.record(z.string(), z.number().int().nonnegative()),
    recentIncidents: z.array(DiagnosticIncidentSchema).max(20),
  })
  .strict();

export const StatsSchema = z
  .object({
    translatedLines: z.number().int().nonnegative(),
    cacheHits: z.number().int().nonnegative(),
    cacheMisses: z.number().int().nonnegative(),
    apiRequests: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
    cancelledLines: z.number().int().nonnegative(),
    cacheEntries: z.number().int().nonnegative(),
    uptimeSeconds: z.number().int().nonnegative(),
    cacheHitRate: z.number().min(0).max(1),
    runtime: RuntimeDiagnosticsSchema,
  })
  .strict();

export const HealthResponseSchema = z
  .object({
    status: z.literal('ok'),
    apiKeyConfigured: z.boolean(),
    provider: z.enum(['opencode', 'ollama', 'hybrid']),
    model: z.string().min(1),
    database: z.literal('ok'),
    version: z.string().min(1),
  })
  .strict();

export const ClearCacheResponseSchema = z
  .object({
    cleared: z.number().int().nonnegative(),
  })
  .strict();

export const ApiErrorResponseSchema = z
  .object({
    error: z.object({
      code: z.string().min(1),
      message: z.string().min(1),
      retryable: z.boolean(),
    }),
  })
  .strict();

export type TranslateRequest = z.infer<typeof TranslateRequestSchema>;
export type TranslateResponse = z.infer<typeof TranslateResponseSchema>;
export type TranslateBatchCue = z.input<typeof TranslateBatchCueSchema>;
export type TranslateBatchRequest = z.input<typeof TranslateBatchRequestSchema>;
export type ParsedTranslateBatchRequest = z.output<typeof TranslateBatchRequestSchema>;
export type TranslateBatchResult = z.infer<typeof TranslateBatchResultSchema>;
export type TranslateBatchResponse = z.infer<typeof TranslateBatchResponseSchema>;
export type ProviderTranslation = z.infer<typeof ProviderTranslationSchema>;
export type ProviderBatchTranslationItem = z.infer<typeof ProviderBatchTranslationItemSchema>;
export type ProviderBatchTranslationResponse = z.infer<
  typeof ProviderBatchTranslationResponseSchema
>;
export type ServerSettings = z.infer<typeof ServerSettingsSchema>;
export type UpdateServerSettings = z.infer<typeof UpdateServerSettingsSchema>;
export type DiagnosticIncident = z.infer<typeof DiagnosticIncidentSchema>;
export type RuntimeDiagnostics = z.infer<typeof RuntimeDiagnosticsSchema>;
export type Stats = z.infer<typeof StatsSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type ClearCacheResponse = z.infer<typeof ClearCacheResponseSchema>;
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

/** Alias conservé pour les consommateurs qui nomment simplement ces réglages Settings. */
export type Settings = ServerSettings;

export const DEFAULT_SERVER_SETTINGS: Readonly<ServerSettings> = Object.freeze({
  debounceMs: 60,
  fragmentWindowMs: 120,
  requestTimeoutMs: 15_000,
  maxRetries: 1,
  maxContextLines: 3,
  memoryCacheEntries: 1_000,
});

export const DEFAULT_SETTINGS = DEFAULT_SERVER_SETTINGS;
