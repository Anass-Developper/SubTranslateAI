import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const fixtureUrl = new URL('../../../evaluation/subtitle-evaluation-v1.json', import.meta.url);
const allowedSourceLanguages = new Set(['en', 'fr', 'zh-Hans']);
const allowedDifficulties = new Set(['politeness', 'negation', 'idiom', 'context']);
const sourceReferenceKeys = { en: 'en', fr: 'fr', 'zh-Hans': 'zhHans' };

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const corpus = JSON.parse(await readFile(fileURLToPath(fixtureUrl), 'utf8'));

assert(corpus.schemaVersion === '1.0', 'schemaVersion must be 1.0');
assert(typeof corpus.corpusId === 'string' && corpus.corpusId.length > 0, 'corpusId is required');
assert(corpus.corpusLicense === 'Apache-2.0', 'corpusLicense must be Apache-2.0');
assert(Array.isArray(corpus.examples), 'examples must be an array');
assert(
  corpus.examples.length >= 10 && corpus.examples.length <= 20,
  'examples must contain between 10 and 20 records',
);

const ids = new Set();
for (const [index, example] of corpus.examples.entries()) {
  const prefix = `examples[${index}]`;

  assert(typeof example.id === 'string' && example.id.length > 0, `${prefix}.id is required`);
  assert(!ids.has(example.id), `${prefix}.id must be unique`);
  ids.add(example.id);

  assert(
    allowedSourceLanguages.has(example.sourceLanguage),
    `${prefix}.sourceLanguage is invalid`,
  );
  assert(
    typeof example.sourceText === 'string' && example.sourceText.trim().length > 0,
    `${prefix}.sourceText is required`,
  );
  assert(
    allowedDifficulties.has(example.difficulty),
    `${prefix}.difficulty is invalid`,
  );
  assert(
    typeof example.note === 'string' && example.note.trim().length > 0,
    `${prefix}.note is required`,
  );

  for (const language of ['en', 'fr', 'zhHans']) {
    assert(
      typeof example.references?.[language] === 'string' &&
        example.references[language].trim().length > 0,
      `${prefix}.references.${language} is required`,
    );
  }

  const sourceReference = sourceReferenceKeys[example.sourceLanguage];
  assert(
    example.sourceText === example.references[sourceReference],
    `${prefix}.sourceText must match its same-language reference`,
  );

  assert(example.provenance?.origin === 'synthetic', `${prefix}.provenance.origin is invalid`);
  assert(
    typeof example.provenance?.author === 'string' &&
      example.provenance.author.trim().length > 0,
    `${prefix}.provenance.author is required`,
  );
  assert(
    example.provenance?.license === 'Apache-2.0',
    `${prefix}.provenance.license must be Apache-2.0`,
  );
}

console.log(`Validated ${corpus.examples.length} synthetic subtitle evaluation records.`);
