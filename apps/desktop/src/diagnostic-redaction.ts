export interface DiagnosticReplacement {
  readonly value: string;
  readonly replacement: string;
}

export function redactDiagnosticText(
  text: string,
  replacements: readonly DiagnosticReplacement[],
): string {
  return replacements
    .flatMap(({ value, replacement }) => [
      { value, replacement },
      { value: JSON.stringify(value).slice(1, -1), replacement },
    ])
    .filter(
      ({ value }, index, values) =>
        value.length > 0 && values.findIndex((candidate) => candidate.value === value) === index,
    )
    .sort((left, right) => right.value.length - left.value.length)
    .reduce(
      (redacted, { value, replacement }) =>
        redacted.replace(new RegExp(escapeRegExp(value), 'giu'), replacement),
      text,
    );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
