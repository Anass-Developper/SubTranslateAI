import { describe, expect, it } from 'vitest';

import {
  chooseTranslationTargets,
  inferLanguageFromText,
  normalizeLanguageCode,
  preserveOriginalLanguage,
} from '../src/index.js';

describe('choix des langues', () => {
  it('ne traduit que vers le chinois depuis le français', () => {
    expect(chooseTranslationTargets('fr-FR')).toEqual(['zh']);
  });

  it('ne traduit que vers le français depuis le chinois', () => {
    expect(chooseTranslationTargets('zh-Hans')).toEqual(['fr']);
  });

  it("traduit vers les deux langues depuis l'anglais", () => {
    expect(chooseTranslationTargets('en')).toEqual(['fr', 'zh']);
  });

  it('reconnaît les scripts chinois et certains indices français', () => {
    expect(inferLanguageFromText('我不知道你在这里。')).toBe('zh');
    expect(inferLanguageFromText('Où êtes-vous ?')).toBe('fr');
    expect(normalizeLanguageCode('ZHO-Hans')).toBe('zh');
  });

  it('ne confond pas le japonais ou le portugais avec le chinois ou le français', () => {
    expect(inferLanguageFromText('私は学生です。')).toBeUndefined();
    expect(inferLanguageFromText('東京')).toBeUndefined();
    expect(inferLanguageFromText('A ação está pronta.')).toBeUndefined();
    expect(inferLanguageFromText('Él está en la casa.')).toBeUndefined();
  });

  it('conserve strictement la ligne source', () => {
    expect(
      preserveOriginalLanguage('Bonjour !', 'fr', {
        sourceLanguage: 'fr',
        fr: 'Salut !',
        zh: '你好！',
      }).fr,
    ).toBe('Bonjour !');
  });
});
