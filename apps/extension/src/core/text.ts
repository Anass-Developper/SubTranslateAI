const SPACE_PATTERN = /[\t\u00a0\u2000-\u200b\u202f\u205f\u3000 ]+/gu;
const TECHNICAL_TAG_PATTERN = /<\/?(?:i|b|u|font|c(?:\.[^>]*)?|v(?:\s+[^>]*)?|ruby|rt)>/giu;

export function normalizeDetectedText(value: string): string {
  return value
    .replace(TECHNICAL_TAG_PATTERN, "")
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.replace(SPACE_PATTERN, " ").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

export function detectLanguageHint(text: string): "fr" | "zh" | undefined {
  const containsHan = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(text);
  const containsKanaOrHangul = /[\u3040-\u30ff\u31f0-\u31ff\uac00-\ud7af]/u.test(text);
  const containsConfidentChineseMarker = /[你这们吗哪谁给让说没]/u.test(text);
  if (containsHan && !containsKanaOrHangul && containsConfidentChineseMarker) {
    return "zh";
  }

  const lowered = ` ${text.toLocaleLowerCase("fr-FR")} `;
  if (
    /(?<!\p{L})(?:avec|bonjour|français|française|madame|merci|monsieur|nous|où|pourquoi|suis|êtes|aujourd'hui|voilà|vous)(?!\p{L})/iu.test(
      lowered,
    )
  ) {
    return "fr";
  }
  const frenchSignals = [
    " je ",
    " tu ",
    " vous ",
    " nous ",
    " le ",
    " la ",
    " les ",
    " une ",
    " des ",
    " pas ",
    " est ",
    " suis ",
    " avec ",
    " pour ",
  ];
  const score = frenchSignals.reduce(
    (total, signal) => total + Number(lowered.includes(signal)),
    0,
  );
  return score >= 2 ? "fr" : undefined;
}

export function createSubtitleId(sequence: number): string {
  return `subtitle-${Date.now().toString(36)}-${sequence.toString(36)}`;
}
