import type { ProviderTranslation } from '@dual-subtitles/shared';

/**
 * Returns acronyms and technical codes that need explicit translation guidance.
 * Ordinary capitalized words are intentionally excluded.
 */
export function protectedLatinTerms(sourceText: string): string[] {
  const terms =
    sourceText.match(
      /\b(?:(?:[A-Z]\.){2,}[A-Z]?|[A-Z]{2,}[A-Z0-9]*(?:[.-][A-Z0-9]+)*|[A-Z0-9]*\d[A-Z][A-Z0-9.-]*)\b/gu,
    ) ?? [];
  return [...new Set(terms)];
}

export function hasTranslatableTextOutsideProtectedTerms(sourceText: string): boolean {
  let remainder = sourceText;
  for (const term of protectedLatinTerms(sourceText)) remainder = remainder.replaceAll(term, ' ');
  return /\p{L}/u.test(remainder);
}

export function isCachedTranslationPlausible(
  sourceText: string,
  translation: ProviderTranslation,
): boolean {
  if (translation.sourceLanguage === 'zh') {
    return !/\p{Script=Han}/u.test(translation.fr);
  }

  if (!hasTranslatableTextOutsideProtectedTerms(sourceText)) return true;
  return comparableText(translation.zh) !== comparableText(sourceText);
}

function comparableText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, '').toLocaleLowerCase();
}
