import type { ProviderTranslation } from './schemas.js';

const FRENCH_LANGUAGE_CODES = new Set(['fr', 'fra', 'fre']);
const CHINESE_LANGUAGE_CODES = new Set(['zh', 'zho', 'chi', 'cmn']);

export type CanonicalSourceLanguage = 'fr' | 'zh' | string;
export type TargetLanguage = 'fr' | 'zh';

export function normalizeLanguageCode(language: string | undefined): string | undefined {
  if (!language) return undefined;
  const normalized = language.trim().toLowerCase().replaceAll('_', '-');
  if (!normalized) return undefined;
  const base = normalized.split('-')[0] ?? normalized;
  if (FRENCH_LANGUAGE_CODES.has(base)) return 'fr';
  if (CHINESE_LANGUAGE_CODES.has(base)) return 'zh';
  return normalized;
}

export function isFrenchLanguage(language: string | undefined): boolean {
  return normalizeLanguageCode(language) === 'fr';
}

export function isChineseLanguage(language: string | undefined): boolean {
  return normalizeLanguageCode(language) === 'zh';
}

const KANA_OR_HANGUL = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const CHINESE_CONFIDENCE_MARKERS = /[你这们吗哪谁给让说没]/u;
const STRONG_FRENCH_WORDS =
  /(?<!\p{L})(?:avec|bonjour|français|française|madame|merci|monsieur|nous|où|pourquoi|suis|êtes|aujourd'hui|voilà|vous)(?!\p{L})/iu;
const COMMON_FRENCH_WORDS =
  /(?<!\p{L})(?:avec|avoir|ce|cette|dans|des|elle|est|être|il|je|la|le|les|mais|ne|nous|pas|pour|que|qui|suis|sur|toi|tu|une|vous)(?!\p{L})/giu;

/** Détection locale prudente; le fournisseur reste l'autorité pour les cas ambigus. */
export function inferLanguageFromText(text: string): 'fr' | 'zh' | undefined {
  if (
    /\p{Script=Han}/u.test(text) &&
    !KANA_OR_HANGUL.test(text) &&
    CHINESE_CONFIDENCE_MARKERS.test(text)
  ) {
    return 'zh';
  }
  if (STRONG_FRENCH_WORDS.test(text)) return 'fr';

  const wordSignals = new Set(
    [...text.matchAll(COMMON_FRENCH_WORDS)].map((match) => match[0].toLocaleLowerCase('fr')),
  ).size;
  if (wordSignals >= 2) return 'fr';
  return undefined;
}

export function chooseTranslationTargets(sourceLanguage: string | undefined): TargetLanguage[] {
  const source = normalizeLanguageCode(sourceLanguage);
  if (source === 'fr') return ['zh'];
  if (source === 'zh') return ['fr'];
  return ['fr', 'zh'];
}

export function preserveOriginalLanguage(
  originalText: string,
  sourceLanguage: string,
  translation: ProviderTranslation,
): ProviderTranslation {
  const source = normalizeLanguageCode(sourceLanguage) ?? sourceLanguage;
  if (source === 'fr') return { ...translation, sourceLanguage: 'fr', fr: originalText };
  if (source === 'zh') return { ...translation, sourceLanguage: 'zh', zh: originalText };
  return { ...translation, sourceLanguage: source };
}
