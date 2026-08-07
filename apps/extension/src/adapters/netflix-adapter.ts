import type { PlatformId } from "../types";
import { BaseDomSubtitleAdapter } from "./base-dom-adapter";
import { NETFLIX_NATIVE_SUBTITLE_SELECTORS, NETFLIX_SUBTITLE_SELECTORS } from "./selectors";

export class NetflixAdapter extends BaseDomSubtitleAdapter {
  readonly platform: PlatformId = "netflix";
  readonly name = "NetflixAdapter";
  readonly selectors = NETFLIX_SUBTITLE_SELECTORS;
  readonly nativeSubtitleSelectors = NETFLIX_NATIVE_SUBTITLE_SELECTORS;
}
