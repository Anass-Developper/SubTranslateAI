const HTML_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  '&amp;': '&',
  '&apos;': "'",
  '&#39;': "'",
  '&quot;': '"',
  '&lt;': '<',
  '&gt;': '>',
  '&nbsp;': ' ',
});

const ZERO_WIDTH_CHARACTERS = /[\u200B-\u200D\u2060\uFEFF]/gu;
const VTT_OR_HTML_TAGS = /<\/?(?:b|c|font|i|lang|ruby|rt|span|u|v)(?:\.[^\s>]+|\s[^>]*)?>/giu;
const SSA_TAGS = /\{\\[^}]+\}/gu;
const VTT_TIMESTAMPS = /<\d{2}:\d{2}(?::\d{2})?\.\d{3}>/gu;

function decodeKnownEntities(text: string): string {
  return text.replace(/&(amp|apos|#39|quot|lt|gt|nbsp);/giu, (entity) => {
    return HTML_ENTITIES[entity.toLowerCase()] ?? entity;
  });
}

/**
 * Retire uniquement les marqueurs techniques courants et stabilise les espaces.
 * Le contenu éditorial (ponctuation, indications sonores et noms propres) est conservé.
 */
export function normalizeSubtitleText(input: string): string {
  return decodeKnownEntities(input)
    .normalize('NFKC')
    .replace(ZERO_WIDTH_CHARACTERS, '')
    .replace(VTT_TIMESTAMPS, '')
    .replace(VTT_OR_HTML_TAGS, '')
    .replace(SSA_TAGS, '')
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/[\t\f\v ]+/gu, ' ')
    .trim();
}

export const sanitizeSubtitleText = normalizeSubtitleText;

/** Normalisation de comparaison, volontairement distincte du texte envoyé au modèle. */
export function subtitleComparisonKey(input: string): string {
  return normalizeSubtitleText(input).toLocaleLowerCase('und');
}

export function isDuplicateSubtitle(left: string, right: string): boolean {
  const leftKey = subtitleComparisonKey(left);
  return leftKey.length > 0 && leftKey === subtitleComparisonKey(right);
}

export class SubtitleDeduplicator {
  readonly #ttlMs: number;
  #lastKey = '';
  #lastSeenAt = Number.NEGATIVE_INFINITY;

  public constructor(ttlMs = 5_000) {
    if (!Number.isFinite(ttlMs) || ttlMs < 0) {
      throw new RangeError('ttlMs doit être un nombre positif');
    }
    this.#ttlMs = ttlMs;
  }

  /** Renvoie true si la ligne identique vient juste d'être observée. */
  public isDuplicate(text: string, now = Date.now()): boolean {
    const key = subtitleComparisonKey(text);
    if (!key) return true;

    const duplicate = key === this.#lastKey && now - this.#lastSeenAt <= this.#ttlMs;
    this.#lastKey = key;
    this.#lastSeenAt = now;
    return duplicate;
  }

  public reset(): void {
    this.#lastKey = '';
    this.#lastSeenAt = Number.NEGATIVE_INFINITY;
  }
}
