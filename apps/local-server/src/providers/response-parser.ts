import {
  ProviderBatchTranslationResponseSchema,
  ProviderTranslationSchema,
  type ProviderBatchTranslationItem,
  type ProviderTranslation,
} from '@dual-subtitles/shared';

import { InvalidProviderResponseError } from './errors.js';

function stripMarkdownFence(value: string): string {
  const trimmed = value.trim().replace(/^\uFEFF/u, '');
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed);
  return match?.[1]?.trim() ?? trimmed;
}

/** Extrait le premier objet JSON équilibré sans être trompé par les accolades dans les chaînes. */
export function extractFirstJsonObject(value: string): string | undefined {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{') {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (character === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) return value.slice(start, index + 1);
    }
  }
  return undefined;
}

export function parseProviderTranslation(content: string): ProviderTranslation {
  const stripped = stripMarkdownFence(content);
  const candidate =
    stripped.startsWith('{') && stripped.endsWith('}')
      ? stripped
      : extractFirstJsonObject(stripped);
  if (!candidate) {
    throw new InvalidProviderResponseError('La réponse du modèle ne contient aucun objet JSON.');
  }

  try {
    const decoded = JSON.parse(candidate) as unknown;
    const result = ProviderTranslationSchema.safeParse(decoded);
    if (!result.success) {
      throw new InvalidProviderResponseError(
        'Le JSON du modèle ne respecte pas le schéma sourceLanguage/fr/zh.',
        result.error,
      );
    }
    return result.data;
  } catch (error) {
    if (error instanceof InvalidProviderResponseError) throw error;
    throw new InvalidProviderResponseError('Le JSON renvoyé par le modèle est invalide.', error);
  }
}

export function parseProviderBatchTranslation(
  content: string,
  expectedCueIds: readonly string[],
): ProviderBatchTranslationItem[] {
  const stripped = stripMarkdownFence(content);
  const candidate =
    stripped.startsWith('{') && stripped.endsWith('}')
      ? stripped
      : extractFirstJsonObject(stripped);
  if (!candidate) {
    throw new InvalidProviderResponseError(
      'La réponse batch du modèle ne contient aucun objet JSON.',
    );
  }

  try {
    const decoded = JSON.parse(candidate) as unknown;
    const parsed = ProviderBatchTranslationResponseSchema.safeParse(decoded);
    if (!parsed.success) {
      throw new InvalidProviderResponseError(
        'Le JSON batch ne respecte pas le schéma cueId/sourceLanguage/fr/zh.',
        parsed.error,
      );
    }

    const expected = new Set(expectedCueIds);
    const received = new Set(parsed.data.translations.map(({ cueId }) => cueId));
    const hasExactCueIds =
      expected.size === expectedCueIds.length &&
      received.size === parsed.data.translations.length &&
      received.size === expected.size &&
      [...expected].every((cueId) => received.has(cueId));
    if (!hasExactCueIds) {
      throw new InvalidProviderResponseError(
        'La réponse batch ne contient pas exactement les cueId demandés.',
      );
    }
    return parsed.data.translations;
  } catch (error) {
    if (error instanceof InvalidProviderResponseError) throw error;
    throw new InvalidProviderResponseError(
      'Le JSON batch renvoyé par le modèle est invalide.',
      error,
    );
  }
}
