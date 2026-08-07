import { describe, expect, it } from 'vitest';

import { downloadPercent } from '../src/ollama-installer.js';

describe('downloadPercent', () => {
  it('calcule et borne la progression', () => {
    expect(downloadPercent(50, 100)).toBe(50);
    expect(downloadPercent(200, 100)).toBe(100);
    expect(downloadPercent(-10, 100)).toBe(0);
  });

  it('gère une taille serveur inconnue', () => {
    expect(downloadPercent(10, null)).toBeNull();
    expect(downloadPercent(10, 0)).toBeNull();
  });
});
