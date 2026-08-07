import type { PlatformId } from "../types";
import { BaseDomSubtitleAdapter } from "./base-dom-adapter";
import { YOUTUBE_NATIVE_SUBTITLE_SELECTORS, YOUTUBE_SUBTITLE_SELECTORS } from "./selectors";

export class YouTubeAdapter extends BaseDomSubtitleAdapter {
  readonly platform: PlatformId = "youtube";
  readonly name = "YouTubeAdapter";
  readonly selectors = YOUTUBE_SUBTITLE_SELECTORS;
  readonly nativeSubtitleSelectors = YOUTUBE_NATIVE_SUBTITLE_SELECTORS;
}
