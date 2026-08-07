import { describe, expect, it } from 'vitest';

import { InvalidProviderResponseError } from '../src/providers/errors.js';
import {
  extractFirstJsonObject,
  parseProviderBatchTranslation,
  parseProviderTranslation,
} from '../src/providers/response-parser.js';

describe('parseProviderTranslation', () => {
  it('valide une réponse JSON stricte', () => {
    expect(parseProviderTranslation('{"sourceLanguage":"en","fr":"Bonjour","zh":"你好"}')).toEqual({
      sourceLanguage: 'en',
      fr: 'Bonjour',
      zh: '你好',
    });
  });

  it("extrait le JSON d'un bloc Markdown ou d'un commentaire accidentel", () => {
    expect(
      parseProviderTranslation(
        'Voici : ```json\n{"sourceLanguage":"fr","fr":"Ça {va}","zh":"还好"}\n``` fin',
      ),
    ).toEqual({ sourceLanguage: 'fr', fr: 'Ça {va}', zh: '还好' });
  });

  it('gère les accolades échappées dans les chaînes', () => {
    expect(
      extractFirstJsonObject(
        'préfixe {"fr":"elle dit \\"{oui}\\"","zh":"好","sourceLanguage":"fr"} suite',
      ),
    ).toBe('{"fr":"elle dit \\"{oui}\\"","zh":"好","sourceLanguage":"fr"}');
  });

  it('refuse les champs absents ou supplémentaires', () => {
    expect(() => parseProviderTranslation('{"sourceLanguage":"en","fr":"Hi"}')).toThrow(
      InvalidProviderResponseError,
    );
    expect(() =>
      parseProviderTranslation(
        '{"sourceLanguage":"en","fr":"Salut","zh":"你好","explanation":"..."}',
      ),
    ).toThrow(InvalidProviderResponseError);
  });
});

describe('parseProviderBatchTranslation', () => {
  it('accepte tous les cueId même si le modèle change leur ordre', () => {
    const content = JSON.stringify({
      translations: [
        { cueId: 'second', sourceLanguage: 'en', fr: 'Deux', zh: '二' },
        { cueId: 'first', sourceLanguage: 'en', fr: 'Un', zh: '一' },
      ],
    });
    expect(parseProviderBatchTranslation(content, ['first', 'second'])).toHaveLength(2);
  });

  it('refuse les cueId absents, inconnus ou dupliqués', () => {
    const missing = JSON.stringify({
      translations: [{ cueId: 'first', sourceLanguage: 'en', fr: 'Un', zh: '一' }],
    });
    expect(() => parseProviderBatchTranslation(missing, ['first', 'second'])).toThrow(
      InvalidProviderResponseError,
    );

    const duplicate = JSON.stringify({
      translations: [
        { cueId: 'first', sourceLanguage: 'en', fr: 'Un', zh: '一' },
        { cueId: 'first', sourceLanguage: 'en', fr: 'Encore', zh: '又' },
      ],
    });
    expect(() => parseProviderBatchTranslation(duplicate, ['first', 'second'])).toThrow(
      InvalidProviderResponseError,
    );
  });
});
