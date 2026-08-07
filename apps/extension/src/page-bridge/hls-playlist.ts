export type HlsSubtitleResourceKind = "playlist" | "segment";

export interface HlsSubtitleResource {
  url: string;
  kind: HlsSubtitleResourceKind;
}

/**
 * Returns only subtitle resources referenced by an HLS manifest. A master
 * playlist is restricted to EXT-X-MEDIA entries explicitly marked as
 * subtitles; media URIs are followed only after such a playlist was selected.
 */
export function findHlsSubtitleResources(
  source: string,
  baseUrl: string,
  assumeSubtitlePlaylist = false,
): HlsSubtitleResource[] {
  if (!isHlsPlaylist(source)) return [];

  const resources = new Map<string, HlsSubtitleResourceKind>();
  const lines = source.split(/\r?\n/u).map((line) => line.trim());

  for (const line of lines) {
    if (!line.startsWith("#EXT-X-MEDIA:")) continue;
    const attributes = parseAttributeList(line.slice("#EXT-X-MEDIA:".length));
    if (attributes.get("TYPE")?.toLocaleUpperCase() !== "SUBTITLES") continue;
    const url = resolveHttpsUrl(attributes.get("URI"), baseUrl);
    if (url) resources.set(url, "playlist");
  }

  if (assumeSubtitlePlaylist) {
    for (const line of lines) {
      if (!line || line.startsWith("#")) continue;
      const url = resolveHttpsUrl(line, baseUrl);
      if (url) resources.set(url, isHlsPlaylistUrl(url) ? "playlist" : "segment");
    }
  }

  return [...resources].map(([url, kind]) => ({ url, kind }));
}

export function isHlsPlaylist(source: string, contentType = ""): boolean {
  return (
    source.slice(0, 1_024).trimStart().startsWith("#EXTM3U") ||
    /(?:application|audio)\/(?:vnd\.apple\.|x-)?mpegurl/iu.test(contentType)
  );
}

function parseAttributeList(value: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const pattern = /([A-Z0-9-]+)=("(?:[^"\\]|\\.)*"|[^,]*)/giu;
  for (const match of value.matchAll(pattern)) {
    const key = match[1]?.toLocaleUpperCase();
    const rawValue = match[2];
    if (!key || rawValue === undefined) continue;
    attributes.set(key, unquote(rawValue.trim()));
  }
  return attributes;
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/gu, '"');
  }
  return value;
}

function resolveHttpsUrl(value: string | undefined, baseUrl: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, baseUrl);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function isHlsPlaylistUrl(value: string): boolean {
  try {
    return /\.m3u8$/iu.test(new URL(value).pathname);
  } catch {
    return false;
  }
}
