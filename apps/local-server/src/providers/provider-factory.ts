import type { ServerConfig } from '../config.js';
import { FallbackTranslationProvider } from './fallback-translation-provider.js';
import { OllamaTranslationProvider } from './ollama-translation-provider.js';
import { OpenCodeGoProvider } from './open-code-go-provider.js';
import type { TranslationProvider } from './translation-provider.js';

export function createTranslationProvider(config: ServerConfig): TranslationProvider {
  const remote = new OpenCodeGoProvider({ apiKey: config.apiKey });
  if (config.translationProvider === 'opencode') return remote;

  const local = new OllamaTranslationProvider({
    endpoint: config.ollamaEndpoint,
    model: config.ollamaModel,
    modelType: config.ollamaModelType,
    concurrency: config.ollamaConcurrency,
  });
  if (config.translationProvider === 'ollama') return local;
  return new FallbackTranslationProvider(local, remote);
}
