import type { PlatformId } from "../types";
import { BaseDomSubtitleAdapter } from "./base-dom-adapter";
import { APPLE_TV_NATIVE_SUBTITLE_SELECTORS, APPLE_TV_SUBTITLE_SELECTORS } from "./selectors";

export class AppleTvAdapter extends BaseDomSubtitleAdapter {
  readonly platform: PlatformId = "appleTv";
  readonly name = "AppleTvAdapter";
  readonly selectors = APPLE_TV_SUBTITLE_SELECTORS;
  readonly nativeSubtitleSelectors = APPLE_TV_NATIVE_SUBTITLE_SELECTORS;
}
