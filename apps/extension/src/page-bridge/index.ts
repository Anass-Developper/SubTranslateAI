import { detectPlatform } from "../platforms";
import type { BridgeCaptureStats } from "../tracks/track-capture";
import { findDashSubtitleResources, isDashManifest } from "./dash-manifest";
import {
  findHlsSubtitleResources,
  isHlsPlaylist,
  type HlsSubtitleResourceKind,
} from "./hls-playlist";
import { extractTimedTextFromIsobmff, looksLikeIsobmff } from "./isobmff-text";

const BRIDGE_SOURCE = "dual-subtitles-page-bridge";
const CONTENT_SOURCE = "dual-subtitles-content";
const MAX_TRACK_BYTES = 4 * 1024 * 1024;
const MAX_BUFFERED_TRACK_BYTES = 8 * 1024 * 1024;
const MAX_BUFFERED_TRACK_RESOURCES = 96;
const MAX_YOUTUBE_TRACKS = 8;
const YOUTUBE_DISCOVERY_INTERVAL_MS = 500;
const YOUTUBE_DISCOVERY_DURATION_MS = 20_000;
const MAX_METADATA_TRACK_URLS = 24;
const MAX_DISCOVERED_TRACK_RESOURCES = 1_500;
const MAX_DISCOVERED_TRACK_FETCHES = 4;
const MAX_HLS_DISCOVERY_DEPTH = 4;
let acceptDiscoveredYouTubeTrack: ((track: CaptionTrackMetadata) => void) | null = null;
let nativePageFetch: typeof fetch | null = null;
let resetYouTubeDiscovery: (() => void) | null = null;
let navigationGeneration = 0;
const discoveredTrackUrls = new Set<string>();
const discoveredTrackQueue: DiscoveredTrackResource[] = [];
const bufferedTrackResources: BufferedTrackResource[] = [];
let activeDiscoveredTrackFetches = 0;
let bufferedTrackBytes = 0;

const BRIDGE_VERSION = "0.4.0";
const STATS_POST_DELAY_MS = 500;
const MAX_RECENT_SEEN_URLS = 12;
const MAX_RECENT_WORKER_SCRIPTS = 6;
const MAX_RECENT_PUBLISHED_TRACKS = 6;
const MAX_RECENT_MANIFEST_SAMPLES = 3;
const MAX_RECENT_DISCOVERED_ERRORS = 4;
const MANIFEST_SAMPLE_CHARS = 100;
const MAX_NESTED_METADATA_URLS = 4;
const bridgeStats: BridgeCaptureStats = {
  bridgeVersion: BRIDGE_VERSION,
  responsesSeen: 0,
  responsesInspected: 0,
  manifestsProcessed: 0,
  dashManifests: 0,
  hlsPlaylists: 0,
  discoveredQueued: 0,
  discoveredFetched: 0,
  discoveredErrors: 0,
  publishedResources: 0,
  workersCreated: 0,
  recentSeenUrls: [],
  recentWorkerScripts: [],
  recentPublishedTracks: [],
  recentManifestSamples: [],
  recentDiscoveredErrors: [],
};
let statsTimer: number | null = null;

function markStats(mutate: (stats: BridgeCaptureStats) => void): void {
  mutate(bridgeStats);
  if (statsTimer !== null) return;
  statsTimer = window.setTimeout(() => {
    statsTimer = null;
    postStats();
  }, STATS_POST_DELAY_MS);
}

function postStats(): void {
  window.postMessage(
    {
      source: BRIDGE_SOURCE,
      type: "TRACK_BRIDGE_STATS",
      payload: {
        ...bridgeStats,
        recentSeenUrls: [...bridgeStats.recentSeenUrls],
        recentWorkerScripts: [...bridgeStats.recentWorkerScripts],
        recentPublishedTracks: [...bridgeStats.recentPublishedTracks],
        recentManifestSamples: [...bridgeStats.recentManifestSamples],
        recentDiscoveredErrors: [...bridgeStats.recentDiscoveredErrors],
      },
    },
    window.location.origin,
  );
}

function compactUrl(urlValue: string): string {
  const url = safeUrl(urlValue);
  return (url ? `${url.hostname}${url.pathname}` : urlValue).slice(0, 160);
}

function recordSeenResponse(urlValue: string): void {
  const compact = compactUrl(urlValue);
  markStats((stats) => {
    stats.responsesSeen += 1;
    if (stats.recentSeenUrls.at(-1) !== compact) {
      stats.recentSeenUrls.push(compact);
      if (stats.recentSeenUrls.length > MAX_RECENT_SEEN_URLS) stats.recentSeenUrls.shift();
    }
  });
}

interface TimedTextResourceMessage {
  source: typeof BRIDGE_SOURCE;
  type: "TIMED_TEXT_RESOURCE";
  payload: {
    platform: ReturnType<typeof detectPlatform>;
    trackId: string;
    language?: string;
    label?: string;
    activeHint?: boolean;
    contentType: string;
    body: string;
  };
}

interface BufferedTrackResource {
  message: TimedTextResourceMessage;
  bytes: number;
}

interface DiscoveredTrackResource {
  url: URL;
  generation: number;
  kind: "track" | "metadata" | HlsSubtitleResourceKind;
  depth: number;
  trackId?: string;
  language?: string;
}

interface CaptionTrackMetadata {
  baseUrl?: unknown;
  languageCode?: unknown;
  vssId?: unknown;
  name?: { simpleText?: unknown; runs?: Array<{ text?: unknown }> };
}

interface YouTubePlayerResponse {
  videoDetails?: {
    videoId?: unknown;
  };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: CaptionTrackMetadata[];
    };
  };
}

declare global {
  interface Window {
    __dualSubtitlesTrackBridgeInstalled?: boolean;
    ytInitialPlayerResponse?: YouTubePlayerResponse;
    ytplayer?: {
      config?: {
        args?: {
          raw_player_response?: YouTubePlayerResponse | string;
        };
      };
    };
  }
}

if (!window.__dualSubtitlesTrackBridgeInstalled) {
  window.__dualSubtitlesTrackBridgeInstalled = true;
  const nativeFetch = window.fetch.bind(window);
  nativePageFetch = nativeFetch;
  installContentBridgeHandshake();
  installFetchCapture();
  installXhrCapture();
  installWorkerProbe();
  installYouTubeDiscovery(nativeFetch);
  installNavigationReset();
}

/**
 * N'intercepte rien : compte seulement les Web Workers créés par la page pour
 * diagnostiquer les lecteurs dont le trafic réseau part d'un worker (invisible
 * pour les captures fetch/XHR de la fenêtre).
 */
function installWorkerProbe(): void {
  const NativeWorker = window.Worker;
  if (typeof NativeWorker !== "function") return;
  window.Worker = new Proxy(NativeWorker, {
    construct(target, argumentsList: ConstructorParameters<typeof Worker>, newTarget) {
      const scriptUrl = argumentsList[0];
      const compact = compactUrl(
        typeof scriptUrl === "string" ? scriptUrl : String(scriptUrl ?? ""),
      );
      markStats((stats) => {
        stats.workersCreated += 1;
        if (!stats.recentWorkerScripts.includes(compact)) {
          stats.recentWorkerScripts.push(compact);
          if (stats.recentWorkerScripts.length > MAX_RECENT_WORKER_SCRIPTS) {
            stats.recentWorkerScripts.shift();
          }
        }
      });
      return Reflect.construct(target, argumentsList, newTarget);
    },
  });
}

function installNavigationReset(): void {
  let lastHref = window.location.href;
  const resetForNavigation = (force = false): void => {
    if (!force && window.location.href === lastHref) return;
    lastHref = window.location.href;
    clearNavigationCaptureState();
    resetYouTubeDiscovery?.();
  };

  window.setInterval(resetForNavigation, 1_000);
  window.addEventListener("popstate", () => resetForNavigation());
  window.addEventListener("hashchange", () => resetForNavigation());
  window.addEventListener("yt-navigate-finish", () => resetForNavigation());

  const nativePushState = window.history.pushState.bind(window.history);
  window.history.pushState = (...argumentsList): void => {
    nativePushState(...argumentsList);
    resetForNavigation();
  };
  const nativeReplaceState = window.history.replaceState.bind(window.history);
  window.history.replaceState = (...argumentsList): void => {
    nativeReplaceState(...argumentsList);
    resetForNavigation();
  };
}

function installContentBridgeHandshake(): void {
  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    if (!event.data || typeof event.data !== "object") return;
    const message = event.data as { source?: unknown; type?: unknown };
    if (message.source !== CONTENT_SOURCE || message.type !== "TRACK_BRIDGE_READY") return;
    for (const resource of bufferedTrackResources) {
      postTrackResource(resource.message);
    }
    postStats();
  });
}

function clearNavigationCaptureState(): void {
  navigationGeneration += 1;
  discoveredTrackUrls.clear();
  discoveredTrackQueue.length = 0;
  bufferedTrackResources.length = 0;
  bufferedTrackBytes = 0;
}

function installFetchCapture(): void {
  const nativeFetch = window.fetch;
  if (typeof nativeFetch !== "function") return;

  window.fetch = new Proxy(nativeFetch, {
    apply(target, thisArgument, argumentsList: Parameters<typeof fetch>) {
      const requestUrl = readRequestUrl(argumentsList[0]);
      const requestGeneration = navigationGeneration;
      const result = Reflect.apply(target, thisArgument, argumentsList) as Promise<Response>;
      return result.then((response) => {
        void inspectFetchResponse(requestUrl || response.url, response, requestGeneration);
        return response;
      });
    },
  });
}

function installXhrCapture(): void {
  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  const requests = new WeakMap<XMLHttpRequest, { url: string; generation: number }>();

  XMLHttpRequest.prototype.open = function patchedOpen(
    method: string,
    url: string | URL,
    async = true,
    username?: string | null,
    password?: string | null,
  ): void {
    requests.set(this, { url: String(url), generation: navigationGeneration });
    Reflect.apply(nativeOpen, this, [method, url, async, username, password]);
  };

  XMLHttpRequest.prototype.send = function patchedSend(
    body?: Document | XMLHttpRequestBodyInit | null,
  ): void {
    this.addEventListener(
      "load",
      () => {
        const request = requests.get(this);
        const url = request?.url ?? this.responseURL;
        const requestGeneration = request?.generation ?? navigationGeneration;
        if (requestGeneration !== navigationGeneration) return;
        recordSeenResponse(url);
        maybeSelfFetchMetadata(url, requestGeneration);
        const contentType = this.getResponseHeader("content-type") ?? "";
        if (
          !isPotentialTrackUrl(url) &&
          !isPotentialTrackContentType(contentType) &&
          !isPlaybackMetadataUrl(url)
        ) {
          return;
        }
        markStats((stats) => {
          stats.responsesInspected += 1;
        });
        const contentLength = Number(this.getResponseHeader("content-length") ?? "0");
        if (contentLength > MAX_TRACK_BYTES) return;
        if (this.responseType === "blob" && this.response instanceof Blob) {
          if (this.response.size > MAX_TRACK_BYTES) return;
          void this.response
            .arrayBuffer()
            .then((buffer) => processCapturedBinary(url, contentType, buffer, requestGeneration))
            .catch(() => undefined);
          return;
        }
        if (this.responseType === "arraybuffer" && this.response instanceof ArrayBuffer) {
          processCapturedBinary(url, contentType, this.response, requestGeneration);
          return;
        }
        const text = readXhrText(this);
        if (text) processCapturedText(url, contentType, text, requestGeneration);
      },
      { once: true },
    );
    nativeSend.call(this, body);
  };
}

async function inspectFetchResponse(
  url: string,
  response: Response,
  requestGeneration: number,
): Promise<void> {
  if (requestGeneration !== navigationGeneration) return;
  recordSeenResponse(url);
  maybeSelfFetchMetadata(url, requestGeneration);
  const contentType = response.headers.get("content-type") ?? "";
  if (
    !isPotentialTrackUrl(url) &&
    !isPotentialTrackContentType(contentType) &&
    !isPlaybackMetadataUrl(url)
  ) {
    return;
  }
  markStats((stats) => {
    stats.responsesInspected += 1;
  });
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > MAX_TRACK_BYTES) return;

  try {
    const buffer = await response.clone().arrayBuffer();
    processCapturedBinary(url, contentType, buffer, requestGeneration);
  } catch {
    // Some opaque or consumed responses cannot be cloned. The DOM pipeline remains the fallback.
  }
}

/**
 * Les lecteurs qui déportent leur réseau dans un Web Worker (Rx-player en mode
 * multithread) rendent le corps des réponses invisible depuis la page. Dès
 * qu'une URL de manifeste transite par le fil principal, la re-télécharger
 * nous-mêmes suffit à reconstituer les pistes de sous-titres.
 */
function maybeSelfFetchMetadata(urlValue: string, generation: number): void {
  if (!isPlaybackMetadataUrl(urlValue)) return;
  enqueueDiscoveredTrack(urlValue, generation, "metadata", 0);
}

function processCapturedText(
  url: string,
  contentType: string,
  text: string,
  requestGeneration = navigationGeneration,
): void {
  if (requestGeneration !== navigationGeneration || !text || text.length > MAX_TRACK_BYTES) return;
  if (isYouTubePlayerUrl(url)) discoverYouTubeTracksFromText(text);
  const hlsPlaylist = isHlsPlaylist(text, contentType);
  const dashManifest = isDashManifest(text, contentType);
  if (isPlaybackMetadataUrl(url) || hlsPlaylist || dashManifest) {
    markStats((stats) => {
      stats.manifestsProcessed += 1;
      if (hlsPlaylist) stats.hlsPlaylists += 1;
      if (dashManifest) stats.dashManifests += 1;
    });
    discoverTrackUrlsFromMetadata(text, url, contentType, requestGeneration);
  }
  if (looksLikeTimedText(text)) {
    publishTrackResource(url, contentType, text, { activeHint: true });
  }
}

function processCapturedBinary(
  url: string,
  contentType: string,
  buffer: ArrayBuffer,
  requestGeneration = navigationGeneration,
): void {
  if (
    requestGeneration !== navigationGeneration ||
    buffer.byteLength === 0 ||
    buffer.byteLength > MAX_TRACK_BYTES
  ) {
    return;
  }
  if (looksLikeIsobmff(buffer)) {
    for (const extracted of extractTimedTextFromIsobmff(buffer)) {
      publishTrackResource(url, extracted.contentType, extracted.body, { activeHint: true });
    }
    return;
  }
  processCapturedText(url, contentType, new TextDecoder().decode(buffer), requestGeneration);
}

function installYouTubeDiscovery(nativeFetch: typeof fetch): void {
  if (!isYouTubePage()) return;
  const seenUrls = new Set<string>();
  const activeRequests = new Set<AbortController>();
  let stopAt = 0;
  let timer: number | null = null;
  let generation = 0;
  let scopedVideoId: string | undefined;

  const enqueue = (track: CaptionTrackMetadata): void => {
    const baseUrl = typeof track.baseUrl === "string" ? track.baseUrl : "";
    const videoId = scopedVideoId;
    const trackVideoId = readYouTubeVideoId(baseUrl);
    if (!videoId || currentYouTubeVideoId() !== videoId) return;
    if (trackVideoId && trackVideoId !== videoId) return;
    if (!baseUrl || seenUrls.has(baseUrl) || seenUrls.size >= MAX_YOUTUBE_TRACKS) return;
    seenUrls.add(baseUrl);
    const requestGeneration = generation;
    const controller = new AbortController();
    activeRequests.add(controller);
    void fetchYouTubeTrack(
      nativeFetch,
      baseUrl,
      track,
      videoId,
      controller.signal,
      () =>
        !controller.signal.aborted &&
        generation === requestGeneration &&
        scopedVideoId === videoId &&
        currentYouTubeVideoId() === videoId,
    ).finally(() => activeRequests.delete(controller));
  };
  acceptDiscoveredYouTubeTrack = enqueue;

  const scan = (): void => {
    const candidates = [
      window.ytInitialPlayerResponse,
      parsePossibleJson(window.ytplayer?.config?.args?.raw_player_response),
    ];
    for (const candidate of candidates) {
      const responseVideoId = readYouTubeResponseVideoId(candidate);
      if (responseVideoId && responseVideoId !== scopedVideoId) continue;
      for (const track of readYouTubeCaptionTracks(candidate)) enqueue(track);
    }

    if (Date.now() >= stopAt && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const restart = (): void => {
    generation += 1;
    for (const controller of activeRequests) controller.abort();
    activeRequests.clear();
    seenUrls.clear();
    scopedVideoId = currentYouTubeVideoId();
    stopAt = Date.now() + YOUTUBE_DISCOVERY_DURATION_MS;
    if (timer !== null) clearInterval(timer);
    timer = window.setInterval(scan, YOUTUBE_DISCOVERY_INTERVAL_MS);
    scan();
  };

  resetYouTubeDiscovery = restart;
  restart();
}

async function fetchYouTubeTrack(
  nativeFetch: typeof fetch,
  baseUrl: string,
  metadata: CaptionTrackMetadata,
  videoId: string,
  signal: AbortSignal,
  isCurrent: () => boolean,
): Promise<void> {
  try {
    const url = new URL(baseUrl, window.location.href);
    url.searchParams.set("fmt", "json3");
    const response = await nativeFetch(url.toString(), {
      credentials: "same-origin",
      signal,
    });
    if (!response.ok || !isCurrent()) return;
    const text = await response.text();
    if (!isCurrent() || !text || text.length > MAX_TRACK_BYTES || !looksLikeTimedText(text)) return;
    publishTrackResource(url.toString(), response.headers.get("content-type") ?? "", text, {
      trackId: youtubeTrackId(metadata, url, videoId),
      language:
        url.searchParams.get("tlang") ??
        (typeof metadata.languageCode === "string" ? metadata.languageCode : undefined),
      label: readTrackLabel(metadata),
    });
  } catch {
    // Signed URLs may expire or be unavailable. A network capture can still provide the active track.
  }
}

function discoverYouTubeTracksFromText(text: string): void {
  const decoded = parsePossibleJson(text);
  const activeVideoId = currentYouTubeVideoId();
  const responseVideoId = readYouTubeResponseVideoId(decoded);
  if (!activeVideoId || (responseVideoId && responseVideoId !== activeVideoId)) return;
  for (const track of readYouTubeCaptionTracks(decoded)) {
    acceptDiscoveredYouTubeTrack?.(track);
  }
}

function readYouTubeResponseVideoId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const videoId = (value as YouTubePlayerResponse).videoDetails?.videoId;
  return typeof videoId === "string" && videoId ? videoId.slice(0, 100) : undefined;
}

function readYouTubeCaptionTracks(value: unknown): CaptionTrackMetadata[] {
  if (!value || typeof value !== "object") return [];
  const response = value as YouTubePlayerResponse;
  const tracks = response.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  return Array.isArray(tracks) ? tracks.slice(0, MAX_YOUTUBE_TRACKS) : [];
}

function publishTrackResource(
  urlValue: string,
  contentType: string,
  body: string,
  metadata: { trackId?: string; language?: string; label?: string; activeHint?: boolean } = {},
): void {
  if (!body || body.length > MAX_TRACK_BYTES) return;
  const url = safeUrl(urlValue);
  if (isYouTubePage()) {
    const activeVideoId = currentYouTubeVideoId();
    const resourceVideoId = readYouTubeVideoId(urlValue);
    if (!activeVideoId || (resourceVideoId && resourceVideoId !== activeVideoId)) return;
  }
  const inferred = inferTrackMetadata(url);
  const message: TimedTextResourceMessage = {
    source: BRIDGE_SOURCE,
    type: "TIMED_TEXT_RESOURCE",
    payload: {
      platform: detectPlatform(window.location),
      trackId: (metadata.trackId ?? inferred.trackId).slice(0, 500),
      language: (metadata.language ?? inferred.language)?.slice(0, 80),
      label: metadata.label?.slice(0, 300),
      ...(metadata.activeHint !== undefined ? { activeHint: metadata.activeHint } : {}),
      contentType: contentType.slice(0, 160),
      body,
    },
  };
  bufferTrackResource(message);
  postTrackResource(message);
  markStats((stats) => {
    stats.publishedResources += 1;
    const trackId = message.payload.trackId;
    if (!stats.recentPublishedTracks.includes(trackId)) {
      stats.recentPublishedTracks.push(trackId);
      if (stats.recentPublishedTracks.length > MAX_RECENT_PUBLISHED_TRACKS) {
        stats.recentPublishedTracks.shift();
      }
    }
  });
}

function bufferTrackResource(message: TimedTextResourceMessage): void {
  // JavaScript strings can occupy two bytes per code unit. This conservative accounting keeps
  // the retained bridge data strictly below the configured memory ceiling without another copy.
  const bytes = message.payload.body.length * 2 + 2_048;
  if (bytes > MAX_BUFFERED_TRACK_BYTES) return;

  while (
    bufferedTrackResources.length >= MAX_BUFFERED_TRACK_RESOURCES ||
    bufferedTrackBytes + bytes > MAX_BUFFERED_TRACK_BYTES
  ) {
    const removed = bufferedTrackResources.shift();
    if (!removed) break;
    bufferedTrackBytes -= removed.bytes;
  }

  bufferedTrackResources.push({ message, bytes });
  bufferedTrackBytes += bytes;
}

function postTrackResource(message: TimedTextResourceMessage): void {
  window.postMessage(message, window.location.origin);
}

function isPotentialTrackUrl(urlValue: string): boolean {
  if (!urlValue) return false;
  return (
    isYouTubePlayerUrl(urlValue) ||
    /(?:timedtext|caption|subtitle|texttrack|text-stream|\.vtt(?:$|\?)|\.srt(?:$|\?)|\.ttml(?:$|\?)|\.dfxp(?:$|\?))/iu.test(
      urlValue,
    )
  );
}

function isPotentialTrackContentType(contentType: string): boolean {
  return /(?:text\/vtt|ttml|dfxp|imsc|application\/xml|text\/xml|application\/dash\+xml|(?:application|audio)\/(?:vnd\.apple\.|x-)?mpegurl)/iu.test(
    contentType,
  );
}

function isPlaybackMetadataUrl(urlValue: string): boolean {
  if (isYouTubePage()) return false;
  return /(?:manifest|playbackresources|playback-resources|playback\/resource|catalog\/getplayback|\/x\/player\/|\.m3u8(?:$|[?#])|\.mpd(?:$|[?#]))/iu.test(
    urlValue,
  );
}

function discoverTrackUrlsFromMetadata(
  text: string,
  sourceUrl: string,
  contentType: string,
  requestGeneration: number,
): void {
  if (requestGeneration !== navigationGeneration || !nativePageFetch) return;
  recordManifestSample(sourceUrl, text);

  // Les routeurs de lecture (ex. routemeup de Canal+) renvoient un descripteur
  // contenant l'URL réelle du manifeste sur le CDN : la suivre nous-mêmes.
  if (!isHlsPlaylist(text, contentType) && !isDashManifest(text, contentType)) {
    for (const nestedUrl of findNestedManifestUrls(text)) {
      enqueueDiscoveredTrack(nestedUrl, requestGeneration, "metadata", 1);
    }
  }

  const payload = parsePossibleJson(text);
  if (payload) {
    const urls = new Set<string>();
    collectSubtitleUrls(payload, "", urls, 0);
    for (const value of urls) {
      const hlsPlaylist = /\.m3u8(?:$|[?#])/iu.test(value);
      enqueueDiscoveredTrack(
        value,
        requestGeneration,
        hlsPlaylist ? "playlist" : "track",
        0,
        hlsPlaylist ? hlsTrackId(value) : undefined,
      );
    }
  }

  if (isHlsPlaylist(text, contentType)) {
    for (const resource of findHlsSubtitleResources(text, sourceUrl)) {
      const trackId = hlsTrackId(resource.url);
      enqueueDiscoveredTrack(resource.url, requestGeneration, resource.kind, 1, trackId);
    }
  }

  if (isDashManifest(text, contentType)) {
    for (const resource of findDashSubtitleResources(text, sourceUrl)) {
      enqueueDiscoveredTrack(
        resource.url,
        requestGeneration,
        resource.kind,
        1,
        dashTrackId(resource.trackKey),
        resource.language,
      );
    }
  }
}

function recordManifestSample(sourceUrl: string, text: string): void {
  const head = Array.from(text.slice(0, MANIFEST_SAMPLE_CHARS), (char) =>
    char.charCodeAt(0) < 32 ? " " : char,
  ).join("");
  const sample = `${compactUrl(sourceUrl).slice(0, 60)} => ${head}`;
  markStats((stats) => {
    if (stats.recentManifestSamples.includes(sample)) return;
    stats.recentManifestSamples.push(sample);
    if (stats.recentManifestSamples.length > MAX_RECENT_MANIFEST_SAMPLES) {
      stats.recentManifestSamples.shift();
    }
  });
}

function findNestedManifestUrls(text: string): string[] {
  const normalized = text
    .slice(0, 262_144)
    .replace(/\\\//gu, "/")
    .replace(/\\u0026/gu, "&");
  const matches = normalized.match(
    /https:\/\/[^"'\s\\<>]{10,600}\.(?:mpd|m3u8)(?:\?[^"'\s\\<>]{0,600})?/gu,
  );
  return matches ? [...new Set(matches)].slice(0, MAX_NESTED_METADATA_URLS) : [];
}

function collectSubtitleUrls(
  value: unknown,
  keyPath: string,
  output: Set<string>,
  depth: number,
): void {
  if (depth > 12 || output.size >= MAX_METADATA_TRACK_URLS) return;
  if (typeof value === "string") {
    // Bilibili référence ses pistes en URLs sans protocole (//aisubtitle.hdslb.com/...).
    const normalized = value.startsWith("//") ? `https:${value}` : value;
    if (
      /^https:\/\//u.test(normalized) &&
      (/(?:subtitle|caption|timedtext|texttrack|ttml|dfxp|\.vtt(?:$|\?))/iu.test(keyPath) ||
        isPotentialTrackUrl(normalized))
    ) {
      output.add(normalized.replace(/\\u0026/gu, "&"));
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) collectSubtitleUrls(child, keyPath, output, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    collectSubtitleUrls(child, `${keyPath}.${key}`, output, depth + 1);
  }
}

function enqueueDiscoveredTrack(
  urlValue: string,
  generation: number,
  kind: DiscoveredTrackResource["kind"],
  depth: number,
  trackId?: string,
  language?: string,
): void {
  if (
    generation !== navigationGeneration ||
    depth > MAX_HLS_DISCOVERY_DEPTH ||
    discoveredTrackUrls.size >= MAX_DISCOVERED_TRACK_RESOURCES
  ) {
    return;
  }
  const url = safeUrl(urlValue);
  if (!url || url.protocol !== "https:" || discoveredTrackUrls.has(url.toString())) return;
  discoveredTrackUrls.add(url.toString());
  markStats((stats) => {
    stats.discoveredQueued += 1;
  });
  discoveredTrackQueue.push({
    url,
    generation,
    kind,
    depth,
    ...(trackId ? { trackId } : {}),
    ...(language ? { language } : {}),
  });
  drainDiscoveredTrackQueue();
}

function drainDiscoveredTrackQueue(): void {
  if (!nativePageFetch) return;
  while (
    activeDiscoveredTrackFetches < MAX_DISCOVERED_TRACK_FETCHES &&
    discoveredTrackQueue.length > 0
  ) {
    const resource = discoveredTrackQueue.shift();
    if (!resource) return;
    if (resource.generation !== navigationGeneration) continue;
    activeDiscoveredTrackFetches += 1;
    void fetchDiscoveredTrack(nativePageFetch, resource).finally(() => {
      activeDiscoveredTrackFetches -= 1;
      drainDiscoveredTrackQueue();
    });
  }
}

/**
 * Un CDN qui répond « Access-Control-Allow-Origin: * » rejette les requêtes
 * cross-origin envoyées avec cookies : retenter sans credentials couvre les
 * ressources dont l'autorisation passe par un jeton dans l'URL.
 */
async function fetchDiscoveredResponse(nativeFetch: typeof fetch, url: string): Promise<Response> {
  try {
    return await nativeFetch(url, { credentials: "include" });
  } catch {
    return nativeFetch(url, { credentials: "omit" });
  }
}

async function fetchDiscoveredTrack(
  nativeFetch: typeof fetch,
  resource: DiscoveredTrackResource,
): Promise<void> {
  try {
    const response = await fetchDiscoveredResponse(nativeFetch, resource.url.toString());
    if (resource.generation !== navigationGeneration) return;
    if (!response.ok) {
      recordDiscoveredError(resource.url.toString(), `HTTP ${response.status}`);
      return;
    }
    markStats((stats) => {
      stats.discoveredFetched += 1;
    });
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (contentLength > MAX_TRACK_BYTES) return;
    const buffer = await response.arrayBuffer();
    if (
      resource.generation !== navigationGeneration ||
      buffer.byteLength === 0 ||
      buffer.byteLength > MAX_TRACK_BYTES
    ) {
      return;
    }

    const contentType = response.headers.get("content-type") ?? "";
    const trackMetadata = {
      ...(resource.trackId ? { trackId: resource.trackId } : {}),
      ...(resource.language ? { language: resource.language } : {}),
    };
    if (looksLikeIsobmff(buffer)) {
      for (const extracted of extractTimedTextFromIsobmff(buffer)) {
        publishTrackResource(
          resource.url.toString(),
          extracted.contentType,
          extracted.body,
          trackMetadata,
        );
      }
      return;
    }

    const text = new TextDecoder().decode(buffer);
    if (resource.kind === "metadata" && !looksLikeTimedText(text)) {
      processCapturedText(resource.url.toString(), contentType, text, resource.generation);
      return;
    }
    if (looksLikeTimedText(text)) {
      publishTrackResource(resource.url.toString(), contentType, text, trackMetadata);
      return;
    }

    if (isHlsPlaylist(text, contentType) && resource.kind !== "track") {
      for (const nested of findHlsSubtitleResources(
        text,
        resource.url.toString(),
        resource.kind === "playlist",
      )) {
        enqueueDiscoveredTrack(
          nested.url,
          resource.generation,
          nested.kind,
          resource.depth + 1,
          resource.trackId ?? hlsTrackId(resource.url.toString()),
        );
      }
    }
  } catch (error) {
    // The player may require headers that only its own request supplies. Its original response can still be captured.
    recordDiscoveredError(
      resource.url.toString(),
      error instanceof Error ? error.message : String(error),
    );
  }
}

function recordDiscoveredError(urlValue: string, reason: string): void {
  const entry = `${compactUrl(urlValue).slice(0, 80)} => ${reason.slice(0, 80)}`;
  markStats((stats) => {
    stats.discoveredErrors += 1;
    if (stats.recentDiscoveredErrors.includes(entry)) return;
    stats.recentDiscoveredErrors.push(entry);
    if (stats.recentDiscoveredErrors.length > MAX_RECENT_DISCOVERED_ERRORS) {
      stats.recentDiscoveredErrors.shift();
    }
  });
}

function dashTrackId(trackKey: string): string {
  return `${detectPlatform(window.location)}:dash:${stableIdentifierHash(trackKey)}`;
}

function hlsTrackId(playlistUrl: string): string {
  const url = safeUrl(playlistUrl);
  const identity = url
    ? `${detectPlatform(window.location)}:${url.hostname}:${url.pathname}`
    : `${detectPlatform(window.location)}:${playlistUrl}`;
  return `${detectPlatform(window.location)}:hls:${stableIdentifierHash(identity)}`;
}

function isYouTubePlayerUrl(urlValue: string): boolean {
  return /\/youtubei\/v\d+\/player(?:\?|$)/u.test(urlValue);
}

function looksLikeTimedText(text: string): boolean {
  const sample = text.slice(0, 4_096).trimStart();
  return (
    sample.startsWith("WEBVTT") ||
    /^\d+\s*\r?\n\d{2}:\d{2}:\d{2}[,.]\d{3}\s+-->/u.test(sample) ||
    /<(?:tt|transcript)(?:\s|>)/iu.test(sample) ||
    (/^[{[]/u.test(sample) &&
      (/"(?:events|segs|tStartMs|dDurationMs)"/u.test(sample) ||
        (/"body"\s*:/u.test(sample) &&
          /"from"\s*:/u.test(sample) &&
          /"content"\s*:/u.test(sample))))
  );
}

function readXhrText(request: XMLHttpRequest): string | null {
  try {
    if (request.responseType === "" || request.responseType === "text") {
      return request.responseText;
    }
    if (request.responseType === "json") {
      return JSON.stringify(request.response);
    }
    if (request.responseType === "document") {
      const responseDocument = request.response as Document | null;
      return responseDocument ? new XMLSerializer().serializeToString(responseDocument) : null;
    }
    if (request.responseType === "arraybuffer" && request.response instanceof ArrayBuffer) {
      return new TextDecoder().decode(request.response);
    }
  } catch {
    return null;
  }
  return null;
}

function inferTrackMetadata(url: URL | null): { trackId: string; language?: string } {
  if (!url) return { trackId: `${detectPlatform(window.location)}:captured-track` };
  const language =
    url.searchParams.get("tlang") ??
    url.searchParams.get("lang") ??
    url.searchParams.get("language") ??
    url.searchParams.get("locale") ??
    undefined;
  const platform = detectPlatform(window.location);
  const stablePath = normalizeTrackResourcePath(url.pathname);
  const identity = [
    platform,
    platform === "youtube" ? undefined : window.location.pathname,
    url.hostname,
    stablePath,
    url.searchParams.get("v") ?? url.searchParams.get("video_id"),
    language,
    url.searchParams.get("vssId"),
    url.searchParams.get("kind"),
    url.searchParams.get("trackId"),
    url.searchParams.get("subtitleTrackId"),
    url.searchParams.get("representationId"),
    url.searchParams.get("representation_id"),
    url.searchParams.get("adaptationSetId"),
    url.searchParams.get("track"),
    url.searchParams.get("tlang"),
  ]
    .filter(Boolean)
    .join(":");
  return {
    trackId: `${platform}:${language ?? "und"}:${stableIdentifierHash(identity)}`,
    language,
  };
}

function normalizeTrackResourcePath(pathname: string): string {
  return pathname
    .replace(
      /([/_.-])((?:seg(?:ment)?|chunk|part|frag(?:ment)?)[_.-]?)\d+(?=[/_.-]|$)/giu,
      "$1$2{index}",
    )
    .replace(/(\/(?:segments?|chunks?|fragments?|parts?)\/)\d+(?=[/_.-]|$)/giu, "$1{index}");
}

function stableIdentifierHash(value: string): string {
  let high = 0xdeadbeef;
  let low = 0x41c6ce57;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    high = Math.imul(high ^ code, 2_654_435_761);
    low = Math.imul(low ^ code, 1_597_334_677);
  }
  high =
    Math.imul(high ^ (high >>> 16), 2_246_822_507) ^ Math.imul(low ^ (low >>> 13), 3_266_489_909);
  low =
    Math.imul(low ^ (low >>> 16), 2_246_822_507) ^ Math.imul(high ^ (high >>> 13), 3_266_489_909);
  return `${(high >>> 0).toString(36)}${(low >>> 0).toString(36)}`;
}

function youtubeTrackId(metadata: CaptionTrackMetadata, url: URL, videoId: string): string {
  const identity = [
    "youtube",
    videoId,
    typeof metadata.vssId === "string" ? metadata.vssId : undefined,
    typeof metadata.languageCode === "string" ? metadata.languageCode : undefined,
    url.searchParams.get("kind"),
    url.searchParams.get("tlang"),
  ]
    .filter(Boolean)
    .join(":");
  return identity || inferTrackMetadata(url).trackId;
}

function currentYouTubeVideoId(): string | undefined {
  return readYouTubeVideoId(window.location.href);
}

function readYouTubeVideoId(urlValue: string): string | undefined {
  const url = safeUrl(urlValue);
  if (!url) return undefined;
  const queryVideoId = url.searchParams.get("v") ?? url.searchParams.get("video_id");
  if (queryVideoId) return queryVideoId.slice(0, 100);
  const pathVideoId = /^\/(?:embed|live|shorts)\/([^/?#]+)/u.exec(url.pathname)?.[1];
  return pathVideoId ? pathVideoId.slice(0, 100) : undefined;
}

function readTrackLabel(metadata: CaptionTrackMetadata): string | undefined {
  const simple = metadata.name?.simpleText;
  if (typeof simple === "string") return simple;
  const runs = metadata.name?.runs;
  if (!Array.isArray(runs)) return undefined;
  const label = runs.map((run) => (typeof run.text === "string" ? run.text : "")).join("");
  return label || undefined;
}

function readRequestUrl(input: RequestInfo | URL | undefined): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input instanceof Request ? input.url : "";
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value, window.location.href);
  } catch {
    return null;
  }
}

function parsePossibleJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    const cleaned = value
      .trim()
      .replace(/^\)\]\}'[,]?\s*/u, "")
      .replace(/^(?:for\s*\(\s*;\s*;\s*\)|while\s*\(\s*1\s*\))\s*;\s*/u, "");
    return JSON.parse(cleaned) as unknown;
  } catch {
    return undefined;
  }
}

function isYouTubePage(): boolean {
  return detectPlatform(window.location) === "youtube";
}

export {};
