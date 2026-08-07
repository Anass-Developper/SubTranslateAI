import { describe, expect, it } from 'vitest';

import { SubtitleFragmentAggregator, mergeSubtitleFragments } from '../src/index.js';

describe('regroupement des fragments', () => {
  it('préfère la version incrémentale la plus complète', () => {
    expect(mergeSubtitleFragments("I didn't", "I didn't know")).toBe("I didn't know");
  });

  it('fusionne les chevauchements', () => {
    expect(mergeSubtitleFragments('Where are', 'are you?')).toBe('Where are you?');
  });

  it('redémarre après la fenêtre temporelle', () => {
    const aggregator = new SubtitleFragmentAggregator(100);
    expect(aggregator.push('Hello', 0).text).toBe('Hello');
    expect(aggregator.push('Hello world', 50)).toEqual({ text: 'Hello world', merged: true });
    expect(aggregator.push('Next line', 200)).toEqual({ text: 'Next line', merged: false });
  });
});
