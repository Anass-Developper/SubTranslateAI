import { parseBilibiliSubtitle } from "./bilibili-json";
import { parseSrt } from "./srt";
import { parseTtml } from "./ttml";
import type { Cue, SubtitleTrackFormat } from "./types";
import { parseWebVtt } from "./webvtt";
import { parseYouTubeTimedText } from "./youtube-json";

export type { Cue, SubtitleTrackFormat } from "./types";
export { parseBilibiliSubtitle, looksLikeBilibiliSubtitle } from "./bilibili-json";
export { parseSrt } from "./srt";
export { parseTtml } from "./ttml";
export { parseWebVtt } from "./webvtt";
export { parseYouTubeTimedText } from "./youtube-json";
export {
  TimedTextTrackCapture,
  detectTrackFormat,
  parseCapturedTrackResource,
} from "./track-capture";
export type {
  BridgeCaptureStats,
  CapturedSubtitleTrack,
  CapturedTrackListener,
  TimedTextResourcePayload,
} from "./track-capture";

export function parseSubtitleTrack(source: string | unknown, format: SubtitleTrackFormat): Cue[] {
  switch (format) {
    case "webvtt":
    case "vtt":
      return typeof source === "string" ? parseWebVtt(source) : [];
    case "srt":
      return typeof source === "string" ? parseSrt(source) : [];
    case "ttml":
    case "dfxp":
    case "imsc":
      return typeof source === "string" ? parseTtml(source) : [];
    case "youtube-json":
      return parseYouTubeTimedText(source);
    case "bilibili-json":
      return parseBilibiliSubtitle(source);
  }
}
