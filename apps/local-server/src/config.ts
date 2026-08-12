import { resolve } from 'node:path';

import { z } from 'zod';

const integerFromEnvironment = (fallback: number) =>
  z.preprocess(
    (value) => (value === undefined || value === '' ? fallback : Number(value)),
    z.number().int(),
  );

const EnvironmentSchema = z.object({
  OPENCODE_GO_API_KEY: z.string().trim().optional().default(''),
  TRANSLATION_PROVIDER: z.enum(['opencode', 'ollama', 'hybrid']).default('ollama'),
  OLLAMA_ENDPOINT: z
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
      );
    }, 'OLLAMA_ENDPOINT doit rester sur http://127.0.0.1 ou http://localhost')
    .default('http://127.0.0.1:11434/api/chat'),
  OLLAMA_MODEL: z.string().trim().min(1).default('hf.co/tencent/Hy-MT2-7B-GGUF:Q4_K_M'),
  OLLAMA_MODEL_TYPE: z.enum(['translategemma', 'hy-mt', 'chat-json']).default('hy-mt'),
  OLLAMA_CONCURRENCY: integerFromEnvironment(2).pipe(z.number().int().min(1).max(8)),
  PORT: integerFromEnvironment(47_831).pipe(z.number().int().min(1).max(65_535)),
  DATABASE_PATH: z.string().trim().min(1).default('./data/subtitles.db'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  REQUEST_TIMEOUT_MS: integerFromEnvironment(15_000).pipe(z.number().int().min(1_000).max(120_000)),
  PROVIDER_MAX_RETRIES: integerFromEnvironment(1).pipe(z.number().int().min(0).max(5)),
  RATE_LIMIT_MAX: integerFromEnvironment(120).pipe(z.number().int().min(1).max(10_000)),
  RATE_LIMIT_WINDOW_MS: integerFromEnvironment(60_000).pipe(
    z.number().int().min(1_000).max(3_600_000),
  ),
});

export interface ServerConfig {
  readonly host: '127.0.0.1';
  readonly port: number;
  readonly databasePath: string;
  readonly apiKey: string;
  readonly translationProvider: z.infer<typeof EnvironmentSchema>['TRANSLATION_PROVIDER'];
  readonly ollamaEndpoint: string;
  readonly ollamaModel: string;
  readonly ollamaModelType: z.infer<typeof EnvironmentSchema>['OLLAMA_MODEL_TYPE'];
  readonly ollamaConcurrency: number;
  readonly logLevel: z.infer<typeof EnvironmentSchema>['LOG_LEVEL'];
  readonly requestTimeoutMs: number;
  readonly providerMaxRetries: number;
  readonly rateLimitMax: number;
  readonly rateLimitWindowMs: number;
  readonly bodyLimitBytes: number;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = EnvironmentSchema.parse(environment);
  return {
    host: '127.0.0.1',
    port: parsed.PORT,
    databasePath:
      parsed.DATABASE_PATH === ':memory:' ? parsed.DATABASE_PATH : resolve(parsed.DATABASE_PATH),
    apiKey: parsed.OPENCODE_GO_API_KEY,
    translationProvider: parsed.TRANSLATION_PROVIDER,
    ollamaEndpoint: parsed.OLLAMA_ENDPOINT,
    ollamaModel: parsed.OLLAMA_MODEL,
    ollamaModelType: parsed.OLLAMA_MODEL_TYPE,
    ollamaConcurrency: parsed.OLLAMA_CONCURRENCY,
    logLevel: parsed.LOG_LEVEL,
    requestTimeoutMs: parsed.REQUEST_TIMEOUT_MS,
    providerMaxRetries: parsed.PROVIDER_MAX_RETRIES,
    rateLimitMax: parsed.RATE_LIMIT_MAX,
    rateLimitWindowMs: parsed.RATE_LIMIT_WINDOW_MS,
    bodyLimitBytes: 1_024 * 1_024,
  };
}
