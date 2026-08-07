import { describe, expect, it } from 'vitest';

import { TranslateBatchRequestSchema, TranslateBatchResponseSchema } from '../src/schemas.js';

describe('schémas de traduction anticipée', () => {
  it('normalise un lot valide et initialise le contexte absent', () => {
    const parsed = TranslateBatchRequestSchema.parse({
      cues: [
        { cueId: 'cue-1', text: 'Hello', detectedLanguage: 'en-US' },
        { cueId: 'cue-2', text: 'How are you?', previousLines: ['Hello'] },
      ],
    });

    expect(parsed).toEqual({
      cues: [
        { cueId: 'cue-1', text: 'Hello', detectedLanguage: 'en-US', previousLines: [] },
        { cueId: 'cue-2', text: 'How are you?', previousLines: ['Hello'] },
      ],
    });
  });

  it('refuse les identifiants dupliqués et les métadonnées non prévues', () => {
    expect(
      TranslateBatchRequestSchema.safeParse({
        cues: [
          { cueId: 'same', text: 'One' },
          { cueId: 'same', text: 'Two' },
        ],
      }).success,
    ).toBe(false);

    expect(
      TranslateBatchRequestSchema.safeParse({
        cues: [{ cueId: 'cue-1', text: 'Hello', startMs: 1_000, mediaUrl: 'https://example.com' }],
      }).success,
    ).toBe(false);
  });

  it('limite strictement chaque lot à quarante cues', () => {
    expect(
      TranslateBatchRequestSchema.safeParse({
        cues: Array.from({ length: 41 }, (_, index) => ({
          cueId: `cue-${index}`,
          text: `Line ${index}`,
        })),
      }).success,
    ).toBe(false);
  });

  it('valide la forme exacte de la réponse', () => {
    expect(
      TranslateBatchResponseSchema.parse({
        results: [
          {
            cueId: 'cue-1',
            sourceLanguage: 'en',
            fr: 'Bonjour',
            zh: '你好',
            cached: false,
          },
        ],
      }),
    ).toEqual({
      results: [
        {
          cueId: 'cue-1',
          sourceLanguage: 'en',
          fr: 'Bonjour',
          zh: '你好',
          cached: false,
        },
      ],
    });
  });
});
