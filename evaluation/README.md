# Synthetic FR/ZH/EN subtitle evaluation set

This directory contains a small, machine-readable corpus for repeatable
translation-quality checks. Every dialogue line and reference was created
specifically for this repository; no film, series, or third-party subtitle text
was copied.

## Provenance and license

Each record declares:

- `origin: synthetic`;
- the human contributor responsible for the record; and
- the `Apache-2.0` license used by this repository.

The fixture therefore contains only original synthetic material contributed
under Apache-2.0. It has no dependency on a copyrighted subtitle corpus or a
remote service.

## Schema

`subtitle-evaluation-v1.json` contains 10 short conversational examples. Each
record has a unique ID, source language and text, English/French/simplified
Chinese references, one difficulty category, a short evaluation note, and
record-level provenance.

Run the dependency-free validator with:

```bash
npm run validate:evaluation
```

The validator rejects an invalid corpus version or license, a corpus outside
the 10–20 record range, duplicate IDs, unsupported languages/categories,
missing references or notes, mismatched source/reference text, and incomplete
provenance.

## Quality limitation

These initial references intentionally use short, constrained dialogue, but
they have not yet received independent native-speaker review in all three
languages. Treat them as a reproducible starter fixture, not as a definitive
linguistic gold standard. Translation corrections can be reviewed without
changing the provenance or schema requirements.
