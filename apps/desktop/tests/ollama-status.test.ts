import { ollamaModelNames } from '../src/ollama-status.js';
import { describe, expect, it } from 'vitest';

describe('état Ollama de l’application bureau', () => {
  it('extrait les noms de modèles des réponses Ollama actuelles et anciennes', () => {
    expect(
      ollamaModelNames({
        models: [{ name: 'hf.co/tencent/Hy-MT2-7B-GGUF:Q4_K_M' }, { model: 'legacy:model' }],
      }),
    ).toEqual(['hf.co/tencent/Hy-MT2-7B-GGUF:Q4_K_M', 'legacy:model']);
  });

  it('rejette sans erreur une réponse mal formée', () => {
    expect(ollamaModelNames(null)).toEqual([]);
    expect(ollamaModelNames({ models: [null, { name: 42 }] })).toEqual([]);
  });
});
