import { finalizeCues, type CueCandidate } from "./parser-utils";
import type { Cue } from "./types";

interface TtmlTimingContext {
  frameRate: number;
  subFrameRate: number;
  tickRate: number;
}

function localAttribute(element: Element, localName: string): string | undefined {
  for (const attribute of Array.from(element.attributes)) {
    if (attribute.localName === localName || attribute.name === localName) {
      return attribute.value;
    }
  }
  return undefined;
}

function parseTiming(value: string | undefined, context: TtmlTimingContext): number | undefined {
  if (!value) {
    return undefined;
  }
  const input = value.trim();

  const frameClock = input.match(/^(\d+):(\d{2}):(\d{2}):(\d+)(?:\.(\d+))?$/);
  if (frameClock) {
    const [, hoursValue, minutesValue, secondsValue, framesValue, subFramesValue] = frameClock;
    const hours = Number(hoursValue);
    const minutes = Number(minutesValue);
    const seconds = Number(secondsValue);
    const frames = Number(framesValue);
    const subFrames = Number(subFramesValue ?? 0);
    if (minutes > 59 || seconds > 59 || frames >= context.frameRate) {
      return undefined;
    }
    return (
      ((hours * 60 + minutes) * 60 + seconds) * 1_000 +
      ((frames + subFrames / context.subFrameRate) / context.frameRate) * 1_000
    );
  }

  const clock = input.match(/^(\d+):(\d{2}):(\d{2})(?:[.,](\d+))?$/);
  if (clock) {
    const [, hoursValue, minutesValue, secondsValue, fractionValue] = clock;
    const hours = Number(hoursValue);
    const minutes = Number(minutesValue);
    const seconds = Number(secondsValue);
    if (minutes > 59 || seconds > 59) {
      return undefined;
    }
    const fractionMs = Number(`0.${fractionValue ?? "0"}`) * 1_000;
    return ((hours * 60 + minutes) * 60 + seconds) * 1_000 + fractionMs;
  }

  const offset = input.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(ms|h|m|s|f|t)$/);
  if (!offset?.[1] || !offset[2]) {
    return undefined;
  }
  const amount = Number(offset[1]);
  const multipliers: Record<string, number> = {
    h: 3_600_000,
    m: 60_000,
    s: 1_000,
    ms: 1,
    f: 1_000 / context.frameRate,
    t: 1_000 / context.tickRate,
  };
  return amount * (multipliers[offset[2]] ?? 0);
}

function textFromElement(element: Element): string {
  const visit = (node: Node): string => {
    if (node.nodeType === 3) {
      return node.nodeValue ?? "";
    }
    if (node.nodeType !== 1) {
      return "";
    }
    const childElement = node as Element;
    if (childElement.localName.toLowerCase() === "br") {
      return "\n";
    }
    return Array.from(childElement.childNodes).map(visit).join("");
  };
  return Array.from(element.childNodes).map(visit).join("");
}

function ancestorBegin(element: Element, context: TtmlTimingContext): number {
  let total = 0;
  let ancestor = element.parentElement;
  while (ancestor) {
    total += parseTiming(localAttribute(ancestor, "begin"), context) ?? 0;
    ancestor = ancestor.parentElement;
  }
  return total;
}

export function parseTtml(source: string): Cue[] {
  const document = new DOMParser().parseFromString(
    source.replace(/^\uFEFF/, ""),
    "application/xml",
  );
  if (document.getElementsByTagName("parsererror").length > 0) {
    return [];
  }

  const root = document.documentElement;
  const declaredFrameRate = Number(localAttribute(root, "frameRate") ?? 30);
  const multiplierParts = (localAttribute(root, "frameRateMultiplier") ?? "1 1")
    .trim()
    .split(/\s+/)
    .map(Number);
  const multiplier =
    multiplierParts.length === 2 && multiplierParts[0] && multiplierParts[1]
      ? multiplierParts[0] / multiplierParts[1]
      : 1;
  const frameRate = declaredFrameRate > 0 ? declaredFrameRate * multiplier : 30;
  const subFrameRate = Math.max(1, Number(localAttribute(root, "subFrameRate") ?? 1));
  const tickRate = Math.max(1, Number(localAttribute(root, "tickRate") ?? 1));
  const context: TtmlTimingContext = { frameRate, subFrameRate, tickRate };

  const paragraphElements = Array.from(document.getElementsByTagName("*")).filter(
    (element) => element.localName.toLowerCase() === "p",
  );
  const candidates: CueCandidate[] = paragraphElements.map((paragraph) => {
    const parentOffsetMs = ancestorBegin(paragraph, context);
    const ownBeginMs = parseTiming(localAttribute(paragraph, "begin"), context) ?? 0;
    const startMs = parentOffsetMs + ownBeginMs;
    const relativeEndMs = parseTiming(localAttribute(paragraph, "end"), context);
    const durationMs = parseTiming(localAttribute(paragraph, "dur"), context);

    return {
      id: localAttribute(paragraph, "id"),
      startMs,
      endMs: relativeEndMs === undefined ? undefined : parentOffsetMs + relativeEndMs,
      durationMs,
      text: textFromElement(paragraph),
    };
  });

  return finalizeCues(candidates, "ttml");
}
