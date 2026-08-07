import { asRecord, finalizeCues, finiteNumber, type CueCandidate } from "./parser-utils";
import type { Cue } from "./types";

/**
 * Sous-titres Bilibili (CC manuels ou générés par IA) : un document JSON unique
 * couvrant toute la vidéo, de la forme { body: [{ from, to, content }] } avec
 * des temps exprimés en secondes.
 */
export function parseBilibiliSubtitle(source: string | unknown): Cue[] {
  let payload: unknown = source;
  if (typeof source === "string") {
    try {
      payload = JSON.parse(source.trim());
    } catch {
      return [];
    }
  }

  const root = asRecord(payload);
  const body = Array.isArray(root?.body) ? root.body : Array.isArray(payload) ? payload : null;
  if (!body) return [];

  const candidates = body.flatMap((entry): CueCandidate[] => {
    const record = asRecord(entry);
    const fromSeconds = finiteNumber(record?.from);
    const content = record?.content;
    if (!record || fromSeconds === undefined || typeof content !== "string") return [];
    const toSeconds = finiteNumber(record.to);
    return [
      {
        id:
          typeof record.sid === "number" || typeof record.sid === "string" ? record.sid : undefined,
        startMs: fromSeconds * 1_000,
        endMs: toSeconds === undefined ? undefined : toSeconds * 1_000,
        text: content,
      },
    ];
  });
  return finalizeCues(candidates, "bili");
}

export function looksLikeBilibiliSubtitle(sample: string): boolean {
  return (
    /^[{[]/u.test(sample.trimStart()) &&
    /"body"\s*:/u.test(sample) &&
    /"from"\s*:/u.test(sample) &&
    /"content"\s*:/u.test(sample)
  );
}
