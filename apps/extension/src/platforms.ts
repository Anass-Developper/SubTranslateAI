import type { PlatformId } from "./types";

const PLATFORM_IDS: Readonly<Record<PlatformId, true>> = {
  youtube: true,
  netflix: true,
  primeVideo: true,
  canalPlus: true,
  appleTv: true,
  bilibili: true,
  generic: true,
};

export function isPlatformId(value: unknown): value is PlatformId {
  return typeof value === "string" && Object.hasOwn(PLATFORM_IDS, value);
}

export function detectPlatform(locationLike: Pick<Location, "hostname" | "pathname">): PlatformId {
  const hostname = locationLike.hostname.toLocaleLowerCase().replace(/\.$/u, "");
  if (isDomain(hostname, "youtube.com") || hostname === "youtu.be") return "youtube";
  if (isDomain(hostname, "netflix.com")) return "netflix";
  if (
    isDomain(hostname, "primevideo.com") ||
    ((isDomain(hostname, "amazon.com") || isDomain(hostname, "amazon.fr")) &&
      locationLike.pathname.startsWith("/gp/video"))
  ) {
    return "primeVideo";
  }
  if (isDomain(hostname, "canalplus.com") || isDomain(hostname, "mycanal.fr")) {
    return "canalPlus";
  }
  if (isDomain(hostname, "tv.apple.com")) return "appleTv";
  if (isDomain(hostname, "bilibili.com") || isDomain(hostname, "bilibili.tv")) return "bilibili";
  return "generic";
}

function isDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}
