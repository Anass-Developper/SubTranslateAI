import { detectPlatform } from "../platforms";
import { AppleTvAdapter } from "./apple-tv-adapter";
import { BilibiliAdapter } from "./bilibili-adapter";
import { CanalPlusAdapter } from "./canal-plus-adapter";
import { GenericSubtitleAdapter } from "./generic-subtitle-adapter";
import { NetflixAdapter } from "./netflix-adapter";
import { PrimeVideoAdapter } from "./prime-video-adapter";
import type { SubtitleAdapter } from "./types";
import { YouTubeAdapter } from "./youtube-adapter";

export { detectPlatform } from "../platforms";

export function createSubtitleAdapter(
  locationLike: Pick<Location, "hostname" | "pathname"> = window.location,
  documentRoot: Document = document,
): SubtitleAdapter {
  switch (detectPlatform(locationLike)) {
    case "youtube":
      return new YouTubeAdapter(documentRoot);
    case "netflix":
      return new NetflixAdapter(documentRoot);
    case "primeVideo":
      return new PrimeVideoAdapter(documentRoot);
    case "canalPlus":
      return new CanalPlusAdapter(documentRoot);
    case "appleTv":
      return new AppleTvAdapter(documentRoot);
    case "bilibili":
      return new BilibiliAdapter(documentRoot);
    case "generic":
      return new GenericSubtitleAdapter(documentRoot);
  }
}
