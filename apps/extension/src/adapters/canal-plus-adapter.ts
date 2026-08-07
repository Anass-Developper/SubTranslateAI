import type { PlatformId } from "../types";
import { BaseDomSubtitleAdapter } from "./base-dom-adapter";
import { CANAL_PLUS_NATIVE_SUBTITLE_SELECTORS, CANAL_PLUS_SUBTITLE_SELECTORS } from "./selectors";

export class CanalPlusAdapter extends BaseDomSubtitleAdapter {
  readonly platform: PlatformId = "canalPlus";
  readonly name = "CanalPlusAdapter";
  readonly selectors = CANAL_PLUS_SUBTITLE_SELECTORS;
  readonly nativeSubtitleSelectors = CANAL_PLUS_NATIVE_SUBTITLE_SELECTORS;
}
