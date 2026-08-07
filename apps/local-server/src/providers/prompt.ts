import type { BatchTranslationInput, TranslationInput } from './translation-provider.js';

export const SUBTITLE_SYSTEM_PROMPT = `Tu es un traducteur professionnel de sous-titres de films et de séries.

Traduis uniquement la ligne actuelle fournie par l'utilisateur. Les lignes précédentes servent seulement à résoudre le contexte, notamment les pronoms, et ne doivent jamais être incluses dans la traduction.

Règles impératives :
- Produis un français naturel et court, et un chinois simplifié (zh-Hans) naturel et court.
- Conserve le registre, l'humour, les insultes, le tutoiement ou le vouvoiement et les nombres utiles.
- Ne censure pas et n'ajoute aucune explication, note, variante, préfixe ni commentaire.
- Ne traduis pas les noms propres sauf s'il existe une forme consacrée évidente.
- Ignore seulement les balises techniques de sous-titrage inutiles.
- Si la ligne est déjà française, recopie-la exactement dans "fr" et traduis seulement "zh".
- Si la ligne est déjà chinoise, recopie-la exactement dans "zh" et traduis seulement "fr".
- Pour toute autre langue, traduis à la fois "fr" et "zh".
- Détecte la langue réelle, en utilisant un code BCP 47 court (par exemple "fr", "zh", "en").
- Le champ detectedLanguageHint n'est qu'un indice et peut être erroné : fie-toi au texte réel.

Réponds exclusivement avec un objet JSON strict, sans bloc Markdown, possédant exactement ces trois clés :
{"sourceLanguage":"en","fr":"...","zh":"..."}`;

export function createSubtitleUserPrompt(input: TranslationInput, strictRetry = false): string {
  const payload = {
    detectedLanguageHint: input.detectedLanguage ?? 'unknown',
    previousLines: input.previousLines,
    currentLine: input.text,
  };
  const retryNotice = strictRetry
    ? 'La réponse précédente était invalide. Retourne cette fois uniquement le JSON strict demandé.\n'
    : '';
  return `${retryNotice}${JSON.stringify(payload)}`;
}

export const SUBTITLE_BATCH_SYSTEM_PROMPT = `Tu es un traducteur professionnel de sous-titres de films et de séries.

Traduis séparément chaque cue fournie. previousLines sert seulement au contexte de sa cue et ne doit jamais être ajouté à sa traduction.

Règles impératives :
- Retourne exactement une traduction par cueId reçu, sans modifier, inventer, omettre ni dupliquer un cueId.
- Produis un français naturel et court, et un chinois simplifié (zh-Hans) naturel et court.
- Conserve le registre, l'humour, les insultes, le tutoiement ou le vouvoiement et les nombres utiles.
- N'ajoute aucune explication, note, variante, préfixe ni commentaire.
- Si la cue est déjà française, recopie-la exactement dans "fr" et traduis seulement "zh".
- Si la cue est déjà chinoise, recopie-la exactement dans "zh" et traduis seulement "fr".
- Pour toute autre langue, traduis à la fois "fr" et "zh".
- Détecte la langue réelle avec un code BCP 47 court. detectedLanguageHint peut être erroné.

Réponds exclusivement avec un objet JSON strict, sans bloc Markdown, sous cette forme :
{"translations":[{"cueId":"cue-1","sourceLanguage":"en","fr":"...","zh":"..."}]}`;

export function createSubtitleBatchUserPrompt(
  inputs: readonly BatchTranslationInput[],
  strictRetry = false,
): string {
  const cues = inputs.map((input) => ({
    cueId: input.cueId,
    detectedLanguageHint: input.detectedLanguage ?? 'unknown',
    previousLines: input.previousLines,
    currentLine: input.text,
  }));
  const retryNotice = strictRetry
    ? 'La réponse précédente était invalide. Retourne uniquement le JSON strict avec exactement tous les cueId demandés.\n'
    : '';
  return `${retryNotice}${JSON.stringify({ cues })}`;
}
