export type DashSubtitleResourceKind = "track" | "segment";

export interface DashSubtitleResource {
  url: string;
  kind: DashSubtitleResourceKind;
  /** Identité stable de la représentation, indépendante du numéro de segment. */
  trackKey: string;
  language?: string;
}

const MAX_SEGMENTS_PER_REPRESENTATION = 720;
const MAX_TIMELINE_ENTRIES = 4_096;

export function isDashManifest(source: string, contentType = ""): boolean {
  if (/application\/dash\+xml/iu.test(contentType)) return true;
  return /<(?:[A-Za-z][\w.-]*:)?MPD[\s>]/u.test(source.slice(0, 4_096));
}

/**
 * Retourne uniquement les ressources de sous-titres référencées par un
 * manifeste DASH : fichiers complets (BaseURL) ou segments reconstruits via
 * SegmentTemplate/SegmentList. Les pistes audio et vidéo sont ignorées.
 */
export function findDashSubtitleResources(
  source: string,
  manifestUrl: string,
): DashSubtitleResource[] {
  const parsed = new DOMParser().parseFromString(source.replace(/^\uFEFF/, ""), "application/xml");
  if (parsed.getElementsByTagName("parsererror").length > 0) return [];
  const root = parsed.documentElement;
  if (root.localName !== "MPD") return [];

  const resources = new Map<string, DashSubtitleResource>();
  const mpdDurationSec = parseIsoDuration(attribute(root, "mediaPresentationDuration"));
  const mpdBase = resolveBase({ url: manifestUrl, explicit: false }, root);

  for (const [periodIndex, period] of children(root, "Period").entries()) {
    const periodBase = resolveBase(mpdBase, period);
    const periodDurationSec = parseIsoDuration(attribute(period, "duration")) ?? mpdDurationSec;

    for (const [setIndex, adaptationSet] of children(period, "AdaptationSet").entries()) {
      if (!isTextAdaptationSet(adaptationSet)) continue;
      const setBase = resolveBase(periodBase, adaptationSet);
      const language = attribute(adaptationSet, "lang")?.trim() || undefined;
      const setTemplate = firstChild(adaptationSet, "SegmentTemplate");
      const setList = firstChild(adaptationSet, "SegmentList");

      for (const representation of children(adaptationSet, "Representation")) {
        const representationBase = resolveBase(setBase, representation);
        const template = firstChild(representation, "SegmentTemplate") ?? setTemplate;
        const list = firstChild(representation, "SegmentList") ?? setList;
        const representationId = attribute(representation, "id")?.trim() ?? "";
        const trackKey = [
          stripQuery(manifestUrl),
          `period-${attribute(period, "id")?.trim() || periodIndex}`,
          `set-${attribute(adaptationSet, "id")?.trim() || setIndex}`,
          language ?? "und",
          representationId,
        ].join("|");

        const push = (url: string | null, kind: DashSubtitleResourceKind): void => {
          if (!url || resources.has(url)) return;
          resources.set(url, { url, kind, trackKey, ...(language ? { language } : {}) });
        };

        if (template) {
          for (const segmentUrl of expandSegmentTemplate(
            template,
            representation,
            representationBase.url,
            periodDurationSec,
          )) {
            push(segmentUrl, "segment");
          }
          continue;
        }
        if (list) {
          for (const segmentUrl of children(list, "SegmentURL")) {
            push(
              resolveHttpsUrl(attribute(segmentUrl, "media"), representationBase.url),
              "segment",
            );
          }
          continue;
        }
        // Sans segmentation déclarée, un BaseURL explicite pointe vers la piste complète.
        if (representationBase.explicit && !representationBase.url.endsWith("/")) {
          push(resolveHttpsUrl(representationBase.url, representationBase.url), "track");
        }
      }
    }
  }

  return [...resources.values()];
}

function expandSegmentTemplate(
  template: Element,
  representation: Element,
  baseUrl: string,
  periodDurationSec: number | undefined,
): string[] {
  const media = attribute(template, "media");
  if (!media) return [];

  const timescale = positiveNumber(attribute(template, "timescale")) ?? 1;
  const startNumber = positiveInteger(attribute(template, "startNumber")) ?? 1;
  const representationId = attribute(representation, "id")?.trim() ?? "";
  const bandwidth = attribute(representation, "bandwidth")?.trim() ?? "";
  const timeline = firstChild(template, "SegmentTimeline");
  const urls: string[] = [];

  const push = (segmentNumber: number, segmentTime: number): boolean => {
    if (urls.length >= MAX_SEGMENTS_PER_REPRESENTATION) return false;
    const filled = fillTemplate(media, {
      RepresentationID: representationId,
      Bandwidth: bandwidth,
      Number: segmentNumber,
      Time: segmentTime,
    });
    const url = resolveHttpsUrl(filled, baseUrl);
    if (url) urls.push(url);
    return true;
  };

  if (timeline) {
    let segmentNumber = startNumber;
    let segmentTime = 0;
    for (const entry of children(timeline, "S").slice(0, MAX_TIMELINE_ENTRIES)) {
      const duration = positiveNumber(attribute(entry, "d"));
      if (!duration) break;
      const explicitTime = nonNegativeNumber(attribute(entry, "t"));
      if (explicitTime !== undefined) segmentTime = explicitTime;
      let repeat = integer(attribute(entry, "r")) ?? 0;
      if (repeat < 0) {
        // r=-1 répète jusqu'à la fin de la période ; sans durée connue, un seul segment.
        const periodEnd =
          periodDurationSec === undefined ? undefined : periodDurationSec * timescale;
        repeat =
          periodEnd !== undefined && periodEnd > segmentTime
            ? Math.max(0, Math.ceil((periodEnd - segmentTime) / duration) - 1)
            : 0;
      }
      for (let index = 0; index <= repeat; index += 1) {
        if (!push(segmentNumber, segmentTime)) return urls;
        segmentNumber += 1;
        segmentTime += duration;
      }
    }
    return urls;
  }

  const segmentDuration = positiveNumber(attribute(template, "duration"));
  if (!segmentDuration || periodDurationSec === undefined) return urls;
  const count = Math.min(
    MAX_SEGMENTS_PER_REPRESENTATION,
    Math.max(1, Math.ceil((periodDurationSec * timescale) / segmentDuration)),
  );
  for (let index = 0; index < count; index += 1) {
    if (!push(startNumber + index, index * segmentDuration)) break;
  }
  return urls;
}

function isTextAdaptationSet(adaptationSet: Element): boolean {
  const candidates = [adaptationSet, ...children(adaptationSet, "Representation")];
  for (const element of candidates) {
    if (attribute(element, "contentType")?.trim().toLowerCase() === "text") return true;
    const mimeType = attribute(element, "mimeType")?.toLowerCase() ?? "";
    if (/(?:ttml|dfxp|imsc|vtt|subrip|^text\/)/u.test(mimeType)) return true;
    const codecs = attribute(element, "codecs")?.toLowerCase() ?? "";
    if (/(?:stpp|wvtt)/u.test(codecs)) return true;
  }
  for (const role of children(adaptationSet, "Role")) {
    const value = attribute(role, "value")?.trim().toLowerCase();
    if (value === "subtitle" || value === "caption" || value === "forced-subtitle") return true;
  }
  return false;
}

function fillTemplate(
  template: string,
  values: { RepresentationID: string; Bandwidth: string; Number: number; Time: number },
): string {
  return template.replace(
    /\$(RepresentationID|Bandwidth|Number|Time)?(?:%0(\d+)d)?\$/gu,
    (match, name: string | undefined, width: string | undefined) => {
      if (name === undefined) return match === "$$" ? "$" : match;
      const value = String(values[name as keyof typeof values]);
      return width ? value.padStart(Number(width), "0") : value;
    },
  );
}

interface ResolvedBase {
  url: string;
  /** Vrai si au moins un élément BaseURL a été rencontré dans la hiérarchie. */
  explicit: boolean;
}

function resolveBase(current: ResolvedBase, element: Element): ResolvedBase {
  const value = firstChild(element, "BaseURL")?.textContent?.trim();
  if (!value) return current;
  try {
    return { url: new URL(value, current.url).toString(), explicit: true };
  } catch {
    return current;
  }
}

export function parseIsoDuration(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value
    .trim()
    .match(
      /^P(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/u,
    );
  if (!match) return undefined;
  const [, weeks, days, hours, minutes, seconds] = match;
  if (!weeks && !days && !hours && !minutes && !seconds) return undefined;
  return (
    Number(weeks ?? 0) * 604_800 +
    Number(days ?? 0) * 86_400 +
    Number(hours ?? 0) * 3_600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0)
  );
}

function children(element: Element, localName: string): Element[] {
  return Array.from(element.children).filter((child) => child.localName === localName);
}

function firstChild(element: Element, localName: string): Element | undefined {
  return children(element, localName)[0];
}

function attribute(element: Element, name: string): string | undefined {
  const direct = element.getAttribute(name);
  if (direct !== null) return direct;
  for (const candidate of Array.from(element.attributes)) {
    if (candidate.localName === name) return candidate.value;
  }
  return undefined;
}

function positiveNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function nonNegativeNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function positiveInteger(value: string | undefined): number | undefined {
  const parsed = positiveNumber(value);
  return parsed === undefined ? undefined : Math.floor(parsed);
}

function integer(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function stripQuery(urlValue: string): string {
  try {
    const url = new URL(urlValue);
    return `${url.origin}${url.pathname}`;
  } catch {
    return urlValue;
  }
}

function resolveHttpsUrl(value: string | undefined, baseUrl: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, baseUrl);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
