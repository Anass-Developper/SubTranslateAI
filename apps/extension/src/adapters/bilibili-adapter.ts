import type { PlatformId } from "../types";
import { BaseDomSubtitleAdapter } from "./base-dom-adapter";
import { BILIBILI_NATIVE_SUBTITLE_SELECTORS, BILIBILI_SUBTITLE_SELECTORS } from "./selectors";

export class BilibiliAdapter extends BaseDomSubtitleAdapter {
  readonly platform: PlatformId = "bilibili";
  readonly name = "BilibiliAdapter";
  readonly selectors = BILIBILI_SUBTITLE_SELECTORS;
  readonly nativeSubtitleSelectors = BILIBILI_NATIVE_SUBTITLE_SELECTORS;
}
