/**
 * @vitest-environment-options {"url":"https://tv.apple.com/fr/show/example"}
 */

describe("préchargement HLS du bridge", () => {
  it("suit la playlist de sous-titres sans télécharger les playlists vidéo ou audio", async () => {
    const masterUrl = "https://media.example/master.m3u8";
    const subtitlePlaylistUrl = "https://media.example/subs/fr/index.m3u8";
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input);
      if (url === masterUrl) {
        return new Response(
          `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="audio/fr.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="fr",URI="subs/fr/index.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=5000000,AUDIO="audio",SUBTITLES="subs"
video/main.m3u8`,
          { status: 200, headers: { "content-type": "application/vnd.apple.mpegurl" } },
        );
      }
      if (url === subtitlePlaylistUrl) {
        return new Response(
          `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:6.0,
segment-001.vtt
#EXTINF:6.0,
segment-002.vtt`,
          { status: 200, headers: { "content-type": "application/vnd.apple.mpegurl" } },
        );
      }
      if (url.endsWith("segment-001.vtt")) {
        return vttResponse("00:00.000", "00:06.000", "Première ligne");
      }
      if (url.endsWith("segment-002.vtt")) {
        return vttResponse("00:06.000", "00:12.000", "Deuxième ligne");
      }
      throw new Error(`Ressource inattendue : ${url}`);
    });
    Object.defineProperty(window, "fetch", {
      configurable: true,
      writable: true,
      value: fetchMock,
    });
    const postMessage = vi.spyOn(window, "postMessage");

    await import("../src/page-bridge/index");
    await window.fetch(masterUrl);

    await vi.waitFor(() => expect(trackMessages(postMessage.mock.calls)).toHaveLength(2));
    const messages = trackMessages(postMessage.mock.calls);
    expect(new Set(messages.map(({ payload }) => payload.trackId))).toHaveProperty("size", 1);
    expect(messages.every(({ payload }) => payload.platform === "appleTv")).toBe(true);
    expect(messages.every(({ payload }) => payload.activeHint === undefined)).toBe(true);
    expect(messages.map(({ payload }) => payload.body)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Première ligne"),
        expect.stringContaining("Deuxième ligne"),
      ]),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      "https://media.example/audio/fr.m3u8",
      expect.anything(),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      "https://media.example/video/main.m3u8",
      expect.anything(),
    );
  });
});

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.toString() : input.url;
}

function vttResponse(start: string, end: string, text: string): Response {
  return new Response(`WEBVTT\n\n${start} --> ${end}\n${text}`, {
    status: 200,
    headers: { "content-type": "text/vtt" },
  });
}

function trackMessages(calls: readonly unknown[][]): Array<{
  payload: { trackId: string; platform: string; body: string; activeHint?: boolean };
}> {
  return calls
    .map(([message]) => message)
    .filter(
      (
        message,
      ): message is {
        payload: { trackId: string; platform: string; body: string; activeHint?: boolean };
        source: string;
        type: string;
      } => {
        if (!message || typeof message !== "object") return false;
        const candidate = message as {
          payload?: { trackId?: unknown; platform?: unknown; body?: unknown };
          source?: unknown;
          type?: unknown;
        };
        return (
          candidate.source === "dual-subtitles-page-bridge" &&
          candidate.type === "TIMED_TEXT_RESOURCE" &&
          typeof candidate.payload?.trackId === "string" &&
          typeof candidate.payload.platform === "string" &&
          typeof candidate.payload.body === "string"
        );
      },
    );
}

export {};
