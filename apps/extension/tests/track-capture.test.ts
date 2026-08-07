import {
  TimedTextTrackCapture,
  detectTrackFormat,
  parseCapturedTrackResource,
  type TimedTextResourcePayload,
} from "../src/tracks";
import { TIMED_TEXT_CONTENT_SOURCE } from "../src/tracks/track-capture";

describe("capture des pistes horodatées", () => {
  it("détecte les formats pris en charge à partir du contenu", () => {
    expect(detectTrackFormat("WEBVTT\n\n00:00.000 --> 00:01.000\nSalut")).toBe("webvtt");
    expect(detectTrackFormat(`<tt><body><p begin="1s" dur="1s">Salut</p></body></tt>`)).toBe(
      "ttml",
    );
    expect(detectTrackFormat(`1\n00:00:01,000 --> 00:00:02,000\nSalut`)).toBe("srt");
    expect(detectTrackFormat(`{"events":[{"tStartMs":0,"segs":[{"utf8":"Salut"}]}]}`)).toBe(
      "youtube-json",
    );
    expect(detectTrackFormat("contenu ordinaire")).toBeNull();
  });

  it("convertit une ressource en cues normalisées et identifiants stables", () => {
    const cues = parseCapturedTrackResource(
      resource(
        `<transcript><text start="1.25" dur="2"> Une &amp; deux </text><text start="4" dur="1">Fin</text></transcript>`,
      ),
    );

    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({ startMs: 1_250, endMs: 3_250, text: "Une & deux" });
    expect(cues[0]?.id).toMatch(/^cue-1250-3250-/u);
  });

  it("fusionne les segments successifs d'une même piste sans doublons", () => {
    const capture = new TimedTextTrackCapture(document);
    const listener = vi.fn();
    capture.subscribe(listener);

    capture.ingest(resource(`WEBVTT\n\n00:00.000 --> 00:01.000\nUn`, "track", "text/vtt"));
    const merged = capture.ingest(
      resource(
        `WEBVTT\n\n00:00.000 --> 00:01.000\nUn\n\n00:01.000 --> 00:02.000\nDeux`,
        "track",
        "text/vtt",
      ),
    );

    expect(merged?.cues.map(({ text }) => text)).toEqual(["Un", "Deux"]);
    expect(capture.list("youtube")).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it.each(["canalPlus", "appleTv"] as const)(
    "accepte les pistes de la plateforme %s",
    (platform) => {
      const capture = new TimedTextTrackCapture(document);
      const track = capture.ingest({
        ...resource("WEBVTT\n\n00:00.000 --> 00:01.000\nPlatform subtitle"),
        platform,
        trackId: `${platform}:en`,
      });

      expect(track?.platform).toBe(platform);
      expect(capture.list(platform)).toHaveLength(1);
    },
  );

  it("combine les cues simultanées lorsque leurs textes diffèrent", () => {
    const capture = new TimedTextTrackCapture(document);
    const track = capture.ingest(
      resource(
        `WEBVTT

00:01.000 --> 00:03.000
Première voix

00:01.000 --> 00:03.000
Deuxième voix`,
        "track-simultaneous",
        "text/vtt",
      ),
    );

    expect(track?.cues).toHaveLength(1);
    expect(track?.cues[0]).toMatchObject({
      startMs: 1_000,
      endMs: 3_000,
      text: "Première voix Deuxième voix",
    });

    const replayed = capture.ingest(
      resource(
        `WEBVTT

00:01.000 --> 00:03.000
Première voix

00:01.000 --> 00:03.000
Deuxième voix`,
        "track-simultaneous",
        "text/vtt",
      ),
    );
    expect(replayed?.cues).toHaveLength(1);
    expect(replayed?.cues[0]?.text).toBe("Première voix Deuxième voix");
  });

  it("annonce au bridge qu'il est prêt après avoir installé son listener", () => {
    vi.useFakeTimers();
    const postMessage = vi.spyOn(window, "postMessage");
    const capture = new TimedTextTrackCapture(document);

    try {
      capture.start();
      expect(postMessage).toHaveBeenCalledWith(
        { source: TIMED_TEXT_CONTENT_SOURCE, type: "TRACK_BRIDGE_READY" },
        window.location.origin,
      );
      postMessage.mockClear();
      capture.clear();
      expect(postMessage).toHaveBeenCalledWith(
        { source: TIMED_TEXT_CONTENT_SOURCE, type: "TRACK_BRIDGE_READY" },
        window.location.origin,
      );
    } finally {
      capture.stop();
      postMessage.mockRestore();
      vi.useRealTimers();
    }
  });

  it("capture une piste native située dans un Shadow DOM ouvert", () => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    const video = document.createElement("video");
    const cue = { id: "native-1", startTime: 1, endTime: 3, text: "Shadow native cue" };
    const cues = { 0: cue, length: 1 } as unknown as TextTrackCueList;
    const textTrack = { language: "en", label: "English", cues } as unknown as TextTrack;
    Object.defineProperty(video, "textTracks", {
      configurable: true,
      value: { 0: textTrack, length: 1 },
    });
    shadow.append(video);
    const capture = new TimedTextTrackCapture(document);

    try {
      capture.start();
      expect(capture.list("generic")[0]?.cues[0]).toMatchObject({
        startMs: 1_000,
        endMs: 3_000,
        text: "Shadow native cue",
      });
    } finally {
      capture.stop();
    }
  });

  it("propage le mode showing natif même lorsque les cues ne changent pas", async () => {
    vi.useFakeTimers();
    const video = document.createElement("video");
    const cue = { id: "native-1", startTime: 1, endTime: 3, text: "Native cue" };
    const cues = { 0: cue, length: 1 } as unknown as TextTrackCueList;
    const textTrack = {
      language: "en",
      label: "English",
      mode: "hidden",
      cues,
    } as unknown as TextTrack;
    Object.defineProperty(video, "textTracks", {
      configurable: true,
      value: { 0: textTrack, length: 1 },
    });
    document.body.append(video);
    const capture = new TimedTextTrackCapture(document);
    const listener = vi.fn();
    capture.subscribe(listener);

    try {
      capture.start();
      expect(capture.list("generic")[0]?.activeHint).toBe(false);
      expect(listener).toHaveBeenCalledTimes(1);

      textTrack.mode = "showing";
      await vi.advanceTimersByTimeAsync(1_000);

      expect(capture.list("generic")[0]?.activeHint).toBe(true);
      expect(listener).toHaveBeenCalledTimes(2);
    } finally {
      capture.stop();
    }
  });

  it("applique les quotas de cues et rejette les timelines déraisonnables", () => {
    const blocks = Array.from({ length: 5_005 }, (_, index) => {
      const start = vttTimestamp(index * 1_000);
      const end = vttTimestamp(index * 1_000 + 500);
      return `${start} --> ${end}\nCue ${index}`;
    });
    expect(
      parseCapturedTrackResource(resource(`WEBVTT\n\n${blocks.join("\n\n")}`, "large", "text/vtt")),
    ).toHaveLength(4_400);
    expect(
      parseCapturedTrackResource(
        resource(`WEBVTT\n\n49:00:00.000 --> 49:00:01.000\nTrop loin`, "long", "text/vtt"),
      ),
    ).toEqual([]);
  });
});

function resource(
  body: string,
  trackId = "youtube:en",
  contentType = "application/json",
): TimedTextResourcePayload {
  return {
    platform: "youtube",
    trackId,
    language: "en",
    contentType,
    body,
  };
}

function vttTimestamp(milliseconds: number): string {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const millis = milliseconds % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}
