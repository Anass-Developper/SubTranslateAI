import { finalizeCues, parseColonTimestamp, type CueCandidate } from "./parser-utils";
import type { Cue } from "./types";

const TIMING_LINE = /^\s*(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/;
const TIMESTAMP_MAP_LINE = /^\s*X-TIMESTAMP-MAP\s*=\s*(.+)\s*$/i;
const MPEG_TS_CLOCK_TICKS_PER_MILLISECOND = 90;
const MAX_MPEG_TS = 2 ** 33 - 1;

function parseTimingLine(line: string): { startMs: number; endMs: number } | undefined {
  const match = line.match(TIMING_LINE);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }

  const startMs = parseColonTimestamp(match[1]);
  const endMs = parseColonTimestamp(match[2]);
  if (startMs === undefined || endMs === undefined) {
    return undefined;
  }
  return { startMs, endMs };
}

function parseTimestampMap(line: string): number | undefined {
  const match = line.match(TIMESTAMP_MAP_LINE);
  if (!match?.[1]) return undefined;

  let localMs: number | undefined;
  let mpegTs: number | undefined;
  for (const field of match[1].split(",")) {
    const separatorIndex = field.indexOf(":");
    if (separatorIndex < 0) continue;
    const name = field.slice(0, separatorIndex).trim().toUpperCase();
    const value = field.slice(separatorIndex + 1).trim();
    if (name === "LOCAL") {
      localMs = parseColonTimestamp(value);
    } else if (name === "MPEGTS" && /^\d+$/u.test(value)) {
      const parsed = Number(value);
      if (Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= MAX_MPEG_TS) {
        mpegTs = parsed;
      }
    }
  }

  if (localMs === undefined || mpegTs === undefined) return undefined;
  return mpegTs / MPEG_TS_CLOCK_TICKS_PER_MILLISECOND - localMs;
}

export function parseWebVtt(source: string): Cue[] {
  const lines = source
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const candidates: CueCandidate[] = [];
  let index = 0;
  let timestampOffsetMs = 0;

  if (lines[0]?.trim().startsWith("WEBVTT")) {
    index = 1;
    while (index < lines.length && lines[index]?.trim()) {
      const parsedOffset = parseTimestampMap(lines[index] ?? "");
      if (parsedOffset !== undefined) timestampOffsetMs = parsedOffset;
      index += 1;
    }
  }

  while (index < lines.length) {
    while (index < lines.length && !lines[index]?.trim()) {
      index += 1;
    }
    if (index >= lines.length) {
      break;
    }

    const firstLine = lines[index]?.trim() ?? "";
    if (/^(NOTE(?:\s|$)|STYLE$|REGION$)/.test(firstLine)) {
      index += 1;
      while (index < lines.length && lines[index]?.trim()) {
        index += 1;
      }
      continue;
    }

    let id: string | undefined;
    let timing = parseTimingLine(lines[index] ?? "");
    if (!timing && index + 1 < lines.length) {
      id = firstLine;
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

    candidates.push({
      id,
      startMs: timing.startMs + timestampOffsetMs,
      endMs: timing.endMs + timestampOffsetMs,
      text: payload.join("\n"),
    });
  }

  return finalizeCues(candidates, "vtt");
}
