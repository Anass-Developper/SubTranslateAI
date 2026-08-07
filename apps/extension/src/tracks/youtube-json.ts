import {
  asRecord,
  finalizeCues,
  finiteNumber,
  parseColonTimestamp,
  type CueCandidate,
} from "./parser-utils";
import type { Cue } from "./types";

function segmentText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  const record = asRecord(value);
  if (!record) {
    return "";
  }
  if (typeof record.simpleText === "string") {
    return record.simpleText;
  }
  if (typeof record.utf8 === "string") {
    return record.utf8;
  }
  if (Array.isArray(record.runs)) {
    return record.runs
      .map((run) => asRecord(run)?.text)
      .filter((text): text is string => typeof text === "string")
      .join("");
  }
  return "";
}

function parseJson3Events(events: unknown[]): CueCandidate[] {
  return events.flatMap((event): CueCandidate[] => {
    const record = asRecord(event);
    const startMs = finiteNumber(record?.tStartMs);
    if (!record || startMs === undefined || !Array.isArray(record.segs)) {
      return [];
    }
    const text = record.segs.map(segmentText).join("");
    return [
      {
        id: typeof record.id === "string" ? record.id : undefined,
        startMs,
        durationMs: finiteNumber(record.dDurationMs),
        text,
      },
    ];
  });
}

function collectTranscriptRenderers(value: unknown, output: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectTranscriptRenderers(entry, output));
    return;
  }
  const record = asRecord(value);
  if (!record) {
    return;
  }
  for (const [key, child] of Object.entries(record)) {
    if (key === "transcriptCueRenderer") {
      const renderer = asRecord(child);
      if (renderer) {
        output.push(renderer);
      }
    } else {
      collectTranscriptRenderers(child, output);
    }
  }
}

function parseTranscriptRenderer(renderer: Record<string, unknown>): CueCandidate | undefined {
  const startMs = finiteNumber(renderer.startOffsetMs ?? renderer.startTimeMs);
  if (startMs === undefined) {
    return undefined;
  }
  return {
    id: typeof renderer.cueId === "string" ? renderer.cueId : undefined,
    startMs,
    durationMs: finiteNumber(renderer.durationMs),
    text: segmentText(renderer.cue ?? renderer),
  };
}

function genericTime(
  record: Record<string, unknown>,
  millisecondKey: string,
  secondKey: string,
): number | undefined {
  const milliseconds = finiteNumber(record[millisecondKey]);
  if (milliseconds !== undefined) {
    return milliseconds;
  }
  const secondsValue = record[secondKey];
  if (typeof secondsValue === "string" && secondsValue.includes(":")) {
    return parseColonTimestamp(secondsValue);
  }
  const seconds = finiteNumber(secondsValue);
  return seconds === undefined ? undefined : seconds * 1_000;
}

function parseGenericEntries(entries: unknown[]): CueCandidate[] {
  return entries.flatMap((entry): CueCandidate[] => {
    const record = asRecord(entry);
    if (!record) {
      return [];
    }
    const startMs =
      finiteNumber(record.tStartMs ?? record.startMs ?? record.startOffsetMs) ??
      genericTime(record, "offsetMs", "start");
    if (startMs === undefined) {
      return [];
    }
    const endMs = finiteNumber(record.endMs) ?? genericTime(record, "unusedEndMs", "end");
    const durationSeconds = finiteNumber(record.duration);
    const durationMs =
      finiteNumber(record.dDurationMs ?? record.durationMs) ??
      (durationSeconds === undefined ? undefined : durationSeconds * 1_000);
    const text = segmentText(record.text ?? record.cue ?? record.caption ?? record);
    return [
      {
        id: typeof record.id === "string" ? record.id : undefined,
        startMs,
        endMs,
        durationMs,
        text,
      },
    ];
  });
}

function parseTranscriptXml(source: string): Cue[] {
  const documentRoot = new DOMParser().parseFromString(source, "application/xml");
  if (documentRoot.querySelector("parsererror")) return [];
  const candidates = Array.from(documentRoot.querySelectorAll("text")).flatMap(
    (element): CueCandidate[] => {
      const startSeconds = finiteNumber(element.getAttribute("start"));
      if (startSeconds === undefined) return [];
      const durationSeconds = finiteNumber(element.getAttribute("dur"));
      return [
        {
          id: element.getAttribute("id") ?? undefined,
          startMs: startSeconds * 1_000,
          durationMs: durationSeconds === undefined ? undefined : durationSeconds * 1_000,
          text: element.textContent ?? "",
        },
      ];
    },
  );
  return finalizeCues(candidates, "yt");
}

export function parseYouTubeTimedText(source: string | unknown): Cue[] {
  let payload: unknown = source;
  if (typeof source === "string") {
    if (/<transcript(?:\s|>)/iu.test(source.slice(0, 1_000))) {
      return parseTranscriptXml(source);
    }
    try {
      payload = JSON.parse(source.trim().replace(/^\)\]\}'[,]?\s*/, ""));
    } catch {
      return [];
    }
  }

  const root = asRecord(payload);
  if (Array.isArray(root?.events)) {
    return finalizeCues(parseJson3Events(root.events), "yt");
  }

  const renderers: Record<string, unknown>[] = [];
  collectTranscriptRenderers(payload, renderers);
  if (renderers.length > 0) {
    return finalizeCues(
      renderers
        .map(parseTranscriptRenderer)
        .filter((cue): cue is CueCandidate => cue !== undefined),
      "yt",
    );
  }

  const entries = Array.isArray(payload)
    ? payload
    : Array.isArray(root?.cues)
      ? root.cues
      : Array.isArray(root?.subtitles)
        ? root.subtitles
        : [];
  return finalizeCues(parseGenericEntries(entries), "yt");
}
