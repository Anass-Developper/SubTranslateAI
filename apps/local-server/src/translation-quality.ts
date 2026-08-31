import type { ProviderTranslation } from '@dual-subtitles/shared';

/**
 * Returns acronyms and technical codes that must survive translation verbatim.
 * Ordinary capitalized words are intentionally excluded so the model can translate them.
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
  const protectedTerms = protectedLatinTerms(sourceText);
  const translatedTargets =
    translation.sourceLanguage === 'fr'
      ? [translation.zh]
      : translation.sourceLanguage === 'zh'
        ? [translation.fr]
        : [translation.fr, translation.zh];

  if (protectedTerms.some((term) => translatedTargets.some((target) => !target.includes(term)))) {
    return false;
  }

  if (translation.sourceLanguage === 'zh') {
    return !/\p{Script=Han}/u.test(translation.fr);
  }

  if (!hasTranslatableTextOutsideProtectedTerms(sourceText)) return true;
  return comparableText(translation.zh) !== comparableText(sourceText);
}

function comparableText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, '').toLocaleLowerCase();
}
