import type { PlatformId } from "../types";
import { BaseDomSubtitleAdapter } from "./base-dom-adapter";
import { GENERIC_NATIVE_SUBTITLE_SELECTORS, GENERIC_SUBTITLE_SELECTORS } from "./selectors";

export class GenericSubtitleAdapter extends BaseDomSubtitleAdapter {
  readonly platform: PlatformId = "generic";
  readonly name = "GenericSubtitleAdapter";
  readonly selectors = GENERIC_SUBTITLE_SELECTORS;
  readonly nativeSubtitleSelectors = GENERIC_NATIVE_SUBTITLE_SELECTORS;
}
