/**
 * @vitest-environment-options {"url":"https://www.youtube.com/watch?v=test-video"}
 */

import { DEFAULT_EXTENSION_SETTINGS } from "../src/config";
import {
  SubtitlePreloadCoordinator,
  findMatchingCue,
  selectBestTrack,
  selectPlaybackVideo,
} from "../src/content/subtitle-preload-coordinator";
import type { CapturedSubtitleTrack } from "../src/tracks";

describe("coordination du préchargement", () => {
  it("sélectionne uniquement la piste qui correspond au texte et au timecode courants", () => {
    const english = track("en", "Hello", 0, 2_000);
    const french = track("fr", "Bonjour", 0, 2_000);

    expect(selectBestTrack([french, english], "Hello", 1_000)?.trackId).toBe("en");
    expect(selectBestTrack([english], "Hello", 30_000)).toBeNull();
    expect(findMatchingCue(english.cues, " Hello ", 1_000)?.text).toBe("Hello");
    expect(findMatchingCue(english.cues, "Hello", 30_000)).toBeNull();
  });

  it("conserve la piste active à score égal et résout aussi une caption progressive", () => {
    const active = track("active", "This is the complete caption", 0, 2_000);
    const duplicate = {
      ...track("duplicate", "This is the complete caption", 0, 2_000),
      receivedAt: active.receivedAt + 1_000,
    };

    expect(
      selectBestTrack([duplicate, active], "This is the complete caption", 1_000, "active")
        ?.trackId,
    ).toBe("active");
    expect(findMatchingCue(active.cues, "This is the complete", 1_000)?.id).toBe("active-cue");
  });

  it("utilise la vidéo principale visible plutôt qu'une petite preview", () => {
    const preview = mediaElement(12, 160, 90);
    const movie = mediaElement(87, 1_280, 720);
    document.body.append(preview, movie);

    expect(selectPlaybackVideo(document)).toBe(movie);
  });

  it("trouve la vidéo de lecture dans un Shadow DOM ouvert", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    const movie = mediaElement(42, 1_280, 720);
    shadow.append(movie);

    expect(selectPlaybackVideo(document)).toBe(movie);
  });

  it("démarre le préchargement immédiatement pour une piste active", () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchMock);
    const coordinator = new SubtitlePreloadCoordinator(
      DEFAULT_EXTENSION_SETTINGS,
      { onTranslation: vi.fn() },
      document,
    );
    coordinator.start("youtube");

    dispatchCapturedTrack("youtube:active", { activeHint: true });

    expect(coordinator.getStatus().trackId).toBe("youtube:active");
    expect(fetchMock).toHaveBeenCalledOnce();
    coordinator.stop();
  });

  it("attend 400 ms avant d'activer une piste sans indice et refuse un choix ambigu", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchMock);
    const coordinator = new SubtitlePreloadCoordinator(
      DEFAULT_EXTENSION_SETTINGS,
      { onTranslation: vi.fn() },
      document,
    );
    coordinator.start("youtube");

    dispatchCapturedTrack("youtube:first");
    await vi.advanceTimersByTimeAsync(399);
    expect(coordinator.getStatus().trackId).toBeNull();

    dispatchCapturedTrack("youtube:second");
    await vi.advanceTimersByTimeAsync(400);

    expect(coordinator.getStatus().trackId).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    coordinator.stop();
  });

  it("active une piste réellement unique après 400 ms", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchMock);
    const coordinator = new SubtitlePreloadCoordinator(
      DEFAULT_EXTENSION_SETTINGS,
      { onTranslation: vi.fn() },
      document,
    );
    coordinator.start("youtube");

    dispatchCapturedTrack("youtube:unique");
    await vi.advanceTimersByTimeAsync(399);
    expect(coordinator.getStatus().trackId).toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    expect(coordinator.getStatus().trackId).toBe("youtube:unique");
    expect(fetchMock).toHaveBeenCalledOnce();
    coordinator.stop();
  });

  it("annule la stabilisation en pause, au reset et à l'arrêt", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchMock);

    for (const action of ["pause", "reset", "stop"] as const) {
      const coordinator = new SubtitlePreloadCoordinator(
        DEFAULT_EXTENSION_SETTINGS,
        { onTranslation: vi.fn() },
        document,
      );
      coordinator.start("youtube");
      dispatchCapturedTrack(`youtube:${action}`);

      if (action === "pause") coordinator.pause();
      if (action === "reset") coordinator.reset("youtube");
      if (action === "stop") coordinator.stop();
      await vi.advanceTimersByTimeAsync(400);

      expect(fetchMock).not.toHaveBeenCalled();
      if (action !== "stop") coordinator.stop();
    }
  });

  it("traduit une piste capturée par lot puis fournit la cue active sans requête live", async () => {
    const video = document.createElement("video");
    Object.defineProperty(video, "currentTime", { configurable: true, value: 1 });
    document.body.append(video);
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        cues: Array<{ cueId: string; text: string }>;
      };
      return new Response(
        JSON.stringify({
          results: request.cues.map((cue) => ({
            cueId: cue.cueId,
            sourceLanguage: "en",
            fr: `FR:${cue.text}`,
            zh: `ZH:${cue.text}`,
            cached: false,
          })),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const onTranslation = vi.fn();
    const coordinator = new SubtitlePreloadCoordinator(
      DEFAULT_EXTENSION_SETTINGS,
      { onTranslation },
      document,
    );
    coordinator.start("youtube");
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        data: {
          source: "dual-subtitles-page-bridge",
          type: "TIMED_TEXT_RESOURCE",
          payload: {
            platform: "youtube",
            trackId: "youtube:en",
            language: "en",
            contentType: "text/vtt",
            body: "WEBVTT\n\n00:00.000 --> 00:05.000\nHello",
          },
        },
      }),
    );

    expect(coordinator.observe("Hello")).toBeNull();
    await vi.waitFor(() => expect(onTranslation).toHaveBeenCalledOnce());
    expect(onTranslation).toHaveBeenCalledWith(
      "Hello",
      expect.objectContaining({ fr: "FR:Hello", zh: "ZH:Hello" }),
    );
    expect(coordinator.getStatus()).toMatchObject({ total: 1, translated: 1 });
    expect(fetchMock).toHaveBeenCalledOnce();
    coordinator.stop();
  });

  it("sépare l'erreur de préchargement dans les diagnostics", async () => {
    const video = document.createElement("video");
    Object.defineProperty(video, "currentTime", { configurable: true, value: 1 });
    document.body.append(video);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: "Lot DeepSeek invalide" } }), {
            status: 502,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const coordinator = new SubtitlePreloadCoordinator(
      DEFAULT_EXTENSION_SETTINGS,
      { onTranslation: vi.fn() },
      document,
    );
    coordinator.start("youtube");
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        data: {
          source: "dual-subtitles-page-bridge",
          type: "TIMED_TEXT_RESOURCE",
          payload: {
            platform: "youtube",
            trackId: "youtube:error",
            language: "en",
            contentType: "text/vtt",
            body: "WEBVTT\n\n00:00.000 --> 00:05.000\nHello",
          },
        },
      }),
    );

    coordinator.observe("Hello");
    await vi.waitFor(() => expect(coordinator.getStatus().lastError).toBe("Lot DeepSeek invalide"));
    coordinator.stop();
  });
});

function track(
  trackId: string,
  text: string,
  startMs: number,
  endMs: number,
): CapturedSubtitleTrack {
  return {
    platform: "youtube",
    trackId,
    language: trackId,
    cues: [{ id: `${trackId}-cue`, startMs, endMs, text }],
    receivedAt: Date.now(),
  };
}

function dispatchCapturedTrack(trackId: string, metadata: { activeHint?: boolean } = {}): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window,
      data: {
        source: "dual-subtitles-page-bridge",
        type: "TIMED_TEXT_RESOURCE",
        payload: {
          platform: "youtube",
          trackId,
          language: "en",
          ...metadata,
          contentType: "text/vtt",
          body: `WEBVTT\n\n00:00.000 --> 00:05.000\n${trackId}`,
        },
      },
    }),
  );
}

function mediaElement(currentTime: number, width: number, height: number): HTMLVideoElement {
  const video = document.createElement("video");
  Object.defineProperties(video, {
    currentTime: { configurable: true, value: currentTime },
    paused: { configurable: true, value: false },
    ended: { configurable: true, value: false },
    readyState: { configurable: true, value: 4 },
    duration: { configurable: true, value: 7_200 },
  });
  vi.spyOn(video, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({}),
  });
  return video;
}
