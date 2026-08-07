import type { Cue } from "./types";

export interface CueCandidate {
  id?: string | number;
  startMs: number;
  endMs?: number;
  durationMs?: number;
  text: string;
}

export function parseColonTimestamp(value: string): number | undefined {
  const match = value.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/);
  if (!match) {
    return undefined;
  }

  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const fraction = match[4] ?? "0";
  const milliseconds = Number(fraction.padEnd(3, "0"));

  if (minutes > 59 || seconds > 59) {
    return undefined;
  }

  return ((hours * 60 + minutes) * 60 + seconds) * 1_000 + milliseconds;
}

export function normalizeCueText(input: string, stripMarkup = true): string {
  let text = input
    .replace(/\r\n?/g, "\n")
    .replace(/\{\\[^}]+\}/g, "")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");

  if (stripMarkup) {
    const document = new DOMParser().parseFromString(
      `<body>${text.replace(/<br\s*\/?>/gi, "\n")}</body>`,
      "text/html",
    );
    document.querySelectorAll("script, style").forEach((element) => element.remove());
    text = document.body.textContent ?? "";
  }

  return text
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.replace(/[\t\f\v ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export function finalizeCues(
  candidates: CueCandidate[],
  idPrefix: string,
  fallbackDurationMs = 5_000,
): Cue[] {
  const sorted = candidates
    .map((candidate, sourceIndex) => ({ ...candidate, sourceIndex }))
    .filter(
      (candidate) =>
        Number.isFinite(candidate.startMs) && candidate.startMs >= 0 && candidate.text.trim(),
    )
    .sort((left, right) => left.startMs - right.startMs || left.sourceIndex - right.sourceIndex);

  const usedIds = new Set<string>();
  const cues: Cue[] = [];

  for (let index = 0; index < sorted.length; index += 1) {
    const candidate = sorted[index];
    if (!candidate) {
      continue;
    }

    const text = normalizeCueText(candidate.text);
    if (!text) {
      continue;
    }

    const next = sorted[index + 1];
    let endMs = candidate.endMs;
    if (endMs === undefined && candidate.durationMs !== undefined) {
      endMs = candidate.startMs + candidate.durationMs;
    }
    if (endMs === undefined && next && next.startMs > candidate.startMs) {
      endMs = next.startMs;
    }
    if (endMs === undefined) {
      endMs = candidate.startMs + fallbackDurationMs;
    }

    if (!Number.isFinite(endMs) || endMs <= candidate.startMs) {
      continue;
    }

    const requestedId = String(candidate.id ?? `${idPrefix}-${candidate.sourceIndex + 1}`).trim();
    const baseId = requestedId || `${idPrefix}-${candidate.sourceIndex + 1}`;
    let id = baseId;
    let duplicateNumber = 2;
    while (usedIds.has(id)) {
      id = `${baseId}-${duplicateNumber}`;
      duplicateNumber += 1;
    }
    usedIds.add(id);

    cues.push({ id, startMs: candidate.startMs, endMs, text });
  }

  return cues;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
