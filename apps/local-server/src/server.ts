import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import {
  TranslateBatchRequestSchema,
  TranslateRequestSchema,
  UpdateServerSettingsSchema,
  type ApiErrorResponse,
} from '@dual-subtitles/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

import { TranslationCache } from './cache/translation-cache.js';
import { loadConfig, type ServerConfig } from './config.js';
import { DatabaseConnection } from './database/database.js';
import { ProviderError } from './providers/errors.js';
import { createTranslationProvider } from './providers/provider-factory.js';
import type { TranslationProvider } from './providers/translation-provider.js';
import { TranslationInputError, TranslationService } from './services/translation-service.js';
import { BatchTranslationService } from './services/batch-translation-service.js';
import { SettingsStore } from './settings/settings-store.js';
import { StatsStore } from './stats/stats-store.js';

export interface BuildServerOptions {
  readonly config?: ServerConfig;
  readonly provider?: TranslationProvider;
  readonly database?: DatabaseConnection;
  readonly logger?: boolean;
}

function isAllowedOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  try {
    const url = new URL(origin);
    if (url.protocol === 'chrome-extension:' || url.protocol === 'edge-extension:') return true;
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
    );
  } catch {
    return false;
  }
}

function errorPayload(code: string, message: string, retryable: boolean): ApiErrorResponse {
  return { error: { code, message, retryable } };
}

function validationMessage(error: ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
    .join('; ');
}

export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const app = Fastify({
    logger: options.logger ?? { level: config.logLevel },
    bodyLimit: config.bodyLimitBytes,
    trustProxy: false,
  });
  const database = options.database ?? new DatabaseConnection(config.databasePath);
  const settings = new SettingsStore(database, {
    requestTimeoutMs: config.requestTimeoutMs,
    maxRetries: config.providerMaxRetries,
  });
  const initialSettings = settings.get();
  const cache = new TranslationCache(database, initialSettings.memoryCacheEntries);
  const stats = new StatsStore(database, cache);
  const provider = options.provider ?? createTranslationProvider(config);
  if (provider.warmup) {
    void provider.warmup().catch((error: unknown) => {
      app.log.warn({ err: error }, 'Préchauffage du modèle local impossible');
    });
  }
  const translations = new TranslationService({ provider, cache, settings, stats });
  const batchTranslations = new BatchTranslationService(translations);

  await app.register(cors, {
    origin(origin, callback) {
      callback(null, isAllowedOrigin(origin));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type'],
    maxAge: 600,
  });
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindowMs,
    hook: 'onRequest',
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    void reply.header('cache-control', 'no-store');
    void reply.header('x-content-type-options', 'nosniff');
    return payload;
  });

  app.get('/health', async () => {
    database.assertHealthy();
    return {
      status: 'ok' as const,
      apiKeyConfigured: config.apiKey.length > 0,
      provider: config.translationProvider,
      model: config.translationProvider === 'opencode' ? 'deepseek-v4-flash' : config.ollamaModel,
      database: 'ok' as const,
      version: '1.0.0',
    };
  });

  app.post('/translate', async (request, reply) => {
    const contentType = request.headers['content-type']?.toLocaleLowerCase() ?? '';
    if (!contentType.startsWith('application/json')) {
      return reply
        .status(415)
        .send(errorPayload('UNSUPPORTED_MEDIA_TYPE', 'Type de contenu non pris en charge.', false));
    }
    const parsed = TranslateRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorPayload('VALIDATION_ERROR', validationMessage(parsed.error), false));
    }

    const controller = new AbortController();
    const abort = () => controller.abort(new Error('Connexion cliente interrompue'));
    request.raw.once('aborted', abort);
    reply.raw.once('close', abort);
    try {
      return await translations.translate(parsed.data, controller.signal);
    } finally {
      request.raw.off('aborted', abort);
      reply.raw.off('close', abort);
    }
  });

  app.post('/translate/batch', async (request, reply) => {
    const contentType = request.headers['content-type']?.toLocaleLowerCase() ?? '';
    if (!contentType.startsWith('application/json')) {
      return reply
        .status(415)
        .send(errorPayload('UNSUPPORTED_MEDIA_TYPE', 'Type de contenu non pris en charge.', false));
    }
    const parsed = TranslateBatchRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorPayload('VALIDATION_ERROR', validationMessage(parsed.error), false));
    }

    const controller = new AbortController();
    const abort = () => controller.abort(new Error('Connexion cliente interrompue'));
    request.raw.once('aborted', abort);
    reply.raw.once('close', abort);
    try {
      return await batchTranslations.translate(parsed.data, controller.signal);
    } finally {
      request.raw.off('aborted', abort);
      reply.raw.off('close', abort);
    }
  });

  app.get('/settings', async () => settings.get());

  app.put('/settings', async (request, reply) => {
    const contentType = request.headers['content-type']?.toLocaleLowerCase() ?? '';
    if (!contentType.startsWith('application/json')) {
      return reply
        .status(415)
        .send(errorPayload('UNSUPPORTED_MEDIA_TYPE', 'Type de contenu non pris en charge.', false));
    }
    const parsed = UpdateServerSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorPayload('VALIDATION_ERROR', validationMessage(parsed.error), false));
    }
    const updated = settings.update(parsed.data);
    cache.resizeMemory(updated.memoryCacheEntries);
    return updated;
  });

  app.get('/stats', async () => stats.get());

  app.delete('/cache', async () => ({ cleared: cache.clear() }));

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ProviderError) {
      return reply
        .status(error.statusCode)
        .send(errorPayload(error.code, error.message, error.retryable));
    }
    if (error instanceof TranslationInputError) {
      return reply.status(error.statusCode).send(errorPayload(error.code, error.message, false));
    }
    if (error instanceof ZodError) {
      return reply
        .status(400)
        .send(errorPayload('VALIDATION_ERROR', validationMessage(error), false));
    }
    const errorRecord =
      typeof error === 'object' && error !== null
        ? (error as { code?: unknown; statusCode?: unknown })
        : {};
    if (errorRecord.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply
        .status(413)
        .send(errorPayload('BODY_TOO_LARGE', 'La requête dépasse la taille autorisée.', false));
    }
    if (errorRecord.statusCode === 429) {
      return reply
        .status(429)
        .send(errorPayload('LOCAL_RATE_LIMIT', 'Trop de requêtes vers le serveur local.', true));
    }
    if (
      errorRecord.code === 'FST_ERR_CTP_INVALID_JSON_BODY' ||
      errorRecord.code === 'FST_ERR_CTP_EMPTY_JSON_BODY'
    ) {
      return reply
        .status(400)
        .send(errorPayload('INVALID_JSON', 'Le corps JSON de la requête est invalide.', false));
    }
    if (errorRecord.statusCode === 415) {
      return reply
        .status(415)
        .send(errorPayload('UNSUPPORTED_MEDIA_TYPE', 'Type de contenu non pris en charge.', false));
    }
    if (
      typeof errorRecord.statusCode === 'number' &&
      errorRecord.statusCode >= 400 &&
      errorRecord.statusCode < 500
    ) {
      return reply
        .status(errorRecord.statusCode)
        .send(errorPayload('INVALID_REQUEST', 'La requête HTTP est invalide.', false));
    }
    request.log.error({ err: error }, 'Erreur serveur non gérée');
    return reply
      .status(500)
      .send(errorPayload('INTERNAL_ERROR', 'Erreur interne du serveur de traduction.', false));
  });

  app.addHook('onClose', async () => {
    database.close();
  });

  return app;
}
