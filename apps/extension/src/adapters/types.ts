import type { PlatformId, SubtitleSnapshot } from "../types";

export type SubtitleListener = (snapshot: SubtitleSnapshot) => void;

export interface SubtitleAdapter {
  readonly platform: PlatformId;
  readonly name: string;
  readonly selectors: readonly string[];
  readonly nativeSubtitleSelectors: readonly string[];
  start(listener: SubtitleListener): void;
  stop(): void;
  readSnapshot(): SubtitleSnapshot;
}
