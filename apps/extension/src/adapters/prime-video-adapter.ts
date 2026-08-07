import type { PlatformId } from "../types";
import { BaseDomSubtitleAdapter } from "./base-dom-adapter";
import { PRIME_VIDEO_NATIVE_SUBTITLE_SELECTORS, PRIME_VIDEO_SUBTITLE_SELECTORS } from "./selectors";

export class PrimeVideoAdapter extends BaseDomSubtitleAdapter {
  readonly platform: PlatformId = "primeVideo";
  readonly name = "PrimeVideoAdapter";
  readonly selectors = PRIME_VIDEO_SUBTITLE_SELECTORS;
  readonly nativeSubtitleSelectors = PRIME_VIDEO_NATIVE_SUBTITLE_SELECTORS;
}
