import { describe, expect, it } from 'vitest';

import {
  hasTranslatableTextOutsideProtectedTerms,
  protectedLatinTerms,
} from '../src/translation-quality.js';

describe('translation-quality', () => {
  it('détecte les sigles courants sans liste codée en dur', () => {
    expect(
      protectedLatinTerms('La NASA, le FBI, ADN, COVID-19, R2D2 et U.S.A. sont cités.'),
    ).toEqual(['NASA', 'FBI', 'ADN', 'COVID-19', 'R2D2', 'U.S.A']);
  });

  it('distingue un sigle seul d’une phrase qui doit encore être traduite', () => {
    expect(hasTranslatableTextOutsideProtectedTerms('FBI')).toBe(false);
    expect(hasTranslatableTextOutsideProtectedTerms('Le FBI arrive.')).toBe(true);
  });
});
