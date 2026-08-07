import 'dotenv/config';

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { loadConfig } from '../src/config.js';
import { OllamaTranslationProvider } from '../src/providers/ollama-translation-provider.js';
import { OpenCodeGoProvider } from '../src/providers/open-code-go-provider.js';
import type { TranslationProvider } from '../src/providers/translation-provider.js';

const SampleSchema = z.object({
  id: z.string(),
  category: z.string(),
  sourceLanguage: z.enum(['fr', 'zh']),
  targetLanguage: z.enum(['fr', 'zh']),
  source: z.string(),
  previousLines: z.array(z.string()),
  reference: z.string(),
});
const CorpusSchema = z.object({ description: z.string(), samples: z.array(SampleSchema).min(1) });
type Sample = z.infer<typeof SampleSchema>;

interface ProviderRun {
  provider: string;
  model: string;
  succeeded: number;
  failed: number;
  totalDurationMs: number;
  meanDurationMs: number;
  medianDurationMs: number;
  meanReferenceChrF: number;
  results: Array<{
    id: string;
    category: string;
    sourceLanguage: string;
    targetLanguage: string;
    source: string;
    reference: string;
    translation?: string;
    durationMs: number;
    attempts: number;
    referenceChrF?: number;
    scriptValid?: boolean;
    error?: string;
  }>;
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(scriptDirectory, '..');
const args = parseArguments(process.argv.slice(2));
const corpusPath = resolve(packageDirectory, args.corpus);
const corpus = CorpusSchema.parse(JSON.parse(await readFile(corpusPath, 'utf8')));
const config = loadConfig();

const availableProviders: Record<string, { provider: TranslationProvider; model: string }> = {
  opencode: {
    provider: new OpenCodeGoProvider({ apiKey: config.apiKey }),
    model: 'deepseek-v4-flash',
  },
  translategemma: {
    provider: new OllamaTranslationProvider({
      endpoint: config.ollamaEndpoint,
      model: 'translategemma:4b-it-q8_0',
      modelType: 'translategemma',
      concurrency: 1,
    }),
    model: 'translategemma:4b-it-q8_0',
  },
  qwen: {
    provider: new OllamaTranslationProvider({
      endpoint: config.ollamaEndpoint,
      model: 'qwen3:8b',
      modelType: 'chat-json',
      concurrency: 1,
    }),
    model: 'qwen3:8b',
  },
  qwen35: {
    provider: new OllamaTranslationProvider({
      endpoint: config.ollamaEndpoint,
      model: 'qwen3.5:9b',
      modelType: 'chat-json',
      concurrency: 1,
    }),
    model: 'qwen3.5:9b',
  },
  hymt: {
    provider: new OllamaTranslationProvider({
      endpoint: config.ollamaEndpoint,
      model: 'hf.co/tencent/Hy-MT2-7B-GGUF:Q4_K_M',
      modelType: 'hy-mt',
      concurrency: 1,
    }),
    model: 'hf.co/tencent/Hy-MT2-7B-GGUF:Q4_K_M',
  },
};

const selected = args.providers.map((name) => {
  const provider = availableProviders[name];
  if (!provider) throw new Error(`Fournisseur inconnu « ${name} »`);
  return { name, ...provider };
});

const runs: ProviderRun[] = [];
for (const selectedProvider of selected) {
  process.stderr.write(`Benchmark ${selectedProvider.name} (${selectedProvider.model})...\n`);
  runs.push(
    await runProvider(
      selectedProvider.name,
      selectedProvider.model,
      selectedProvider.provider,
      corpus.samples,
      args.timeoutMs,
    ),
  );
}

const report = {
  generatedAt: new Date().toISOString(),
  corpus: { path: corpusPath, description: corpus.description, samples: corpus.samples.length },
  warning:
    'La similarité chrF à une référence ne suffit pas à juger une traduction; une révision bilingue reste nécessaire.',
  runs,
};

const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (args.output) {
  const outputPath = resolve(packageDirectory, args.output);
  await writeFile(outputPath, serialized, 'utf8');
  process.stderr.write(`Rapport écrit dans ${outputPath}\n`);
}
process.stdout.write(serialized);
if (runs.some(({ failed }) => failed > 0)) process.exitCode = 1;

async function runProvider(
  providerName: string,
  model: string,
  provider: TranslationProvider,
  samples: readonly Sample[],
  timeoutMs: number,
): Promise<ProviderRun> {
  const results: ProviderRun['results'] = [];
  for (const sample of samples) {
    let attempts = 0;
    const start = performance.now();
    try {
      const translated = await provider.translate(
        {
          text: sample.source,
          detectedLanguage: sample.sourceLanguage,
          previousLines: sample.previousLines,
        },
        { timeoutMs, maxRetries: 1, onAttempt: () => (attempts += 1) },
      );
      const durationMs = Math.round(performance.now() - start);
      const translation = translated[sample.targetLanguage];
      results.push({
        id: sample.id,
        category: sample.category,
        sourceLanguage: sample.sourceLanguage,
        targetLanguage: sample.targetLanguage,
        source: sample.source,
        reference: sample.reference,
        translation,
        durationMs,
        attempts,
        referenceChrF: round(chrf(translation, sample.reference)),
        scriptValid: hasExpectedScript(translation, sample.targetLanguage),
      });
      process.stderr.write(`  ${sample.id}: ${durationMs} ms\n`);
    } catch (error) {
      results.push({
        id: sample.id,
        category: sample.category,
        sourceLanguage: sample.sourceLanguage,
        targetLanguage: sample.targetLanguage,
        source: sample.source,
        reference: sample.reference,
        durationMs: Math.round(performance.now() - start),
        attempts,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const successes = results.filter((result) => result.translation !== undefined);
  const durations = successes.map(({ durationMs }) => durationMs).sort((a, b) => a - b);
  return {
    provider: providerName,
    model,
    succeeded: successes.length,
    failed: results.length - successes.length,
    totalDurationMs: results.reduce((total, result) => total + result.durationMs, 0),
    meanDurationMs: round(mean(durations)),
    medianDurationMs: round(median(durations)),
    meanReferenceChrF: round(mean(successes.map(({ referenceChrF }) => referenceChrF ?? 0))),
    results,
  };
}

function hasExpectedScript(text: string, language: 'fr' | 'zh'): boolean {
  return language === 'zh' ? /\p{Script=Han}/u.test(text) : /\p{Script=Latin}/u.test(text);
}

function chrf(candidate: string, reference: string): number {
  const left = normalize(candidate);
  const right = normalize(reference);
  const scores: number[] = [];
  for (let size = 1; size <= 3; size += 1) {
    const candidateNgrams = ngrams(left, size);
    const referenceNgrams = ngrams(right, size);
    const overlap = [...candidateNgrams.entries()].reduce(
      (total, [gram, count]) => total + Math.min(count, referenceNgrams.get(gram) ?? 0),
      0,
    );
    const candidateCount = [...candidateNgrams.values()].reduce((sum, count) => sum + count, 0);
    const referenceCount = [...referenceNgrams.values()].reduce((sum, count) => sum + count, 0);
    const precision = candidateCount === 0 ? 0 : overlap / candidateCount;
    const recall = referenceCount === 0 ? 0 : overlap / referenceCount;
    scores.push(precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall));
  }
  return mean(scores) * 100;
}

function ngrams(value: string, size: number): Map<string, number> {
  const characters = [...value];
  const result = new Map<string, number>();
  for (let index = 0; index <= characters.length - size; index += 1) {
    const gram = characters.slice(index, index + size).join('');
    result.set(gram, (result.get(gram) ?? 0) + 1);
  }
  return result;
}

function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{Z}]/gu, '');
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 0
    ? ((values[middle - 1] ?? 0) + (values[middle] ?? 0)) / 2
    : (values[middle] ?? 0);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseArguments(values: readonly string[]): {
  providers: string[];
  corpus: string;
  output?: string;
  timeoutMs: number;
} {
  const result: { providers: string[]; corpus: string; output?: string; timeoutMs: number } = {
    providers: ['opencode', 'translategemma', 'qwen', 'qwen35', 'hymt'],
    corpus: 'benchmarks/subtitle-corpus.json',
    timeoutMs: 120_000,
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const next = values[index + 1];
    if (value === '--providers' && next) {
      result.providers = next.split(',').map((item) => item.trim());
      index += 1;
    } else if (value === '--corpus' && next) {
      result.corpus = next;
      index += 1;
    } else if (value === '--output' && next) {
      result.output = next;
      index += 1;
    } else if (value === '--timeout-ms' && next) {
      result.timeoutMs = Number(next);
      index += 1;
    }
  }
  return result;
}
