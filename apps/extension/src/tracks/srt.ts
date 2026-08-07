import { finalizeCues, parseColonTimestamp, type CueCandidate } from "./parser-utils";
import type { Cue } from "./types";

const TIMING_LINE = /^\s*(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/;

function parseTimingLine(line: string): { startMs: number; endMs: number } | undefined {
  const match = line.match(TIMING_LINE);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  const startMs = parseColonTimestamp(match[1]);
  const endMs = parseColonTimestamp(match[2]);
  return startMs === undefined || endMs === undefined ? undefined : { startMs, endMs };
}

export function parseSrt(source: string): Cue[] {
  const lines = source
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const candidates: CueCandidate[] = [];
  let index = 0;

  while (index < lines.length) {
    while (index < lines.length && !lines[index]?.trim()) {
      index += 1;
    }
    if (index >= lines.length) {
      break;
    }

    let id: string | undefined;
    let timing = parseTimingLine(lines[index] ?? "");
    if (!timing && index + 1 < lines.length) {
      id = lines[index]?.trim();
      index += 1;
      timing = parseTimingLine(lines[index] ?? "");
    }

    if (!timing) {
      index += 1;
      continue;
    }

    index += 1;
    const payload: string[] = [];
    while (index < lines.length && lines[index]?.trim()) {
      if (
        parseTimingLine(lines[index] ?? "") ||
        (index + 1 < lines.length && parseTimingLine(lines[index + 1] ?? ""))
      ) {
        break;
      }
      payload.push(lines[index] ?? "");
      index += 1;
    }

    candidates.push({ id, ...timing, text: payload.join("\n") });
  }

  return finalizeCues(candidates, "srt");
}
