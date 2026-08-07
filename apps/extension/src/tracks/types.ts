export interface Cue {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
}

export type SubtitleTrackFormat =
  "webvtt" | "vtt" | "srt" | "ttml" | "dfxp" | "imsc" | "youtube-json" | "bilibili-json";
