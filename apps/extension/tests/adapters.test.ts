import appleTvFixture from "./fixtures/apple-tv.html?raw";
import bilibiliFixture from "./fixtures/bilibili.html?raw";
import canalPlusFixture from "./fixtures/canal-plus.html?raw";
import genericFixture from "./fixtures/generic.html?raw";
import netflixFixture from "./fixtures/netflix.html?raw";
import primeFixture from "./fixtures/prime-video.html?raw";
import youtubeFixture from "./fixtures/youtube.html?raw";
import { AppleTvAdapter } from "../src/adapters/apple-tv-adapter";
import { BilibiliAdapter } from "../src/adapters/bilibili-adapter";
import { CanalPlusAdapter } from "../src/adapters/canal-plus-adapter";
import { createSubtitleAdapter } from "../src/adapters/factory";
import { GenericSubtitleAdapter } from "../src/adapters/generic-subtitle-adapter";
import { NetflixAdapter } from "../src/adapters/netflix-adapter";
import { PrimeVideoAdapter } from "../src/adapters/prime-video-adapter";
import { YouTubeAdapter } from "../src/adapters/youtube-adapter";
import { detectPlatform, isPlatformId } from "../src/platforms";

describe("adaptateurs de plateformes", () => {
  it("détecte et regroupe les segments YouTube", () => {
    document.body.innerHTML = youtubeFixture;
    const snapshot = new YouTubeAdapter(document).readSnapshot();

    expect(snapshot.text).toBe("I didn't know you were here.");
    expect(snapshot.selector).toContain("ytp-caption-segment");
    expect(snapshot.candidates.length).toBeGreaterThan(0);
  });

  it("détecte les sous-titres Netflix", () => {
    document.body.innerHTML = netflixFixture;
    const snapshot = new NetflixAdapter(document).readSnapshot();

    expect(snapshot.text).toBe("Je ne savais pas que tu étais ici.");
    expect(snapshot.selector).toContain("player-timedtext-text-container");
  });

  it("détecte les sous-titres chinois Prime Video", () => {
    document.body.innerHTML = primeFixture;
    const snapshot = new PrimeVideoAdapter(document).readSnapshot();

    expect(snapshot.text).toBe("我不知道你在这里。");
    expect(snapshot.selector).toBe(".atvwebplayersdk-captions-text");
  });

  it("utilise les sélecteurs génériques en dernier recours", () => {
    document.body.innerHTML = genericFixture;
    const snapshot = new GenericSubtitleAdapter(document).readSnapshot();

    expect(snapshot.text).toBe("A generic caption");
    expect(snapshot.candidates[0]?.selector).toContain("subtitle");
  });

  it.each([
    [
      "Shaka Player",
      '<div class="shaka-text-container"><span class="shaka-text-wrapper">Shaka line</span></div>',
      "Shaka line",
    ],
    [
      "Video.js",
      '<div class="vjs-text-track-display"><span class="vjs-text-track-cue">Video.js line</span></div>',
      "Video.js line",
    ],
    [
      "Plyr",
      '<div class="plyr__captions"><span class="plyr__caption">Plyr line</span></div>',
      "Plyr line",
    ],
  ])("prend en charge le lecteur standard %s", (_name, markup, expected) => {
    document.body.innerHTML = markup;
    expect(new GenericSubtitleAdapter(document).readSnapshot().text).toBe(expected);
  });

  it("détecte les sous-titres CANAL+ rendus par RxPlayer", () => {
    document.body.innerHTML = canalPlusFixture;
    const snapshot = new CanalPlusAdapter(document).readSnapshot();

    expect(snapshot.text).toBe("A CANAL+ subtitle line.");
    expect(snapshot.selector).toBe("[data-testid='playerRoot'] .rxp-texttrack-region");
  });

  it("détecte un sous-titre Apple TV exposé sémantiquement", () => {
    document.body.innerHTML = appleTvFixture;
    const snapshot = new AppleTvAdapter(document).readSnapshot();

    expect(snapshot.text).toBe("An Apple TV subtitle line.");
    expect(snapshot.selector).toBe("[data-testid='subtitle-container'] [role='text']");
  });

  it("détecte les sous-titres du lecteur Bilibili", () => {
    document.body.innerHTML = bilibiliFixture;
    const snapshot = new BilibiliAdapter(document).readSnapshot();

    expect(snapshot.text).toBe("我不知道你在这里。");
    expect(snapshot.selector).toBe(
      ".bpx-player-subtitle-panel-major-group .bpx-player-subtitle-panel-text",
    );
  });

  it("crée les adaptateurs dédiés", () => {
    expect(
      createSubtitleAdapter({ hostname: "www.canalplus.com", pathname: "/player" }, document),
    ).toBeInstanceOf(CanalPlusAdapter);
    expect(
      createSubtitleAdapter({ hostname: "tv.apple.com", pathname: "/fr/show" }, document),
    ).toBeInstanceOf(AppleTvAdapter);
    expect(
      createSubtitleAdapter({ hostname: "www.bilibili.com", pathname: "/video/BV1xx" }, document),
    ).toBeInstanceOf(BilibiliAdapter);
  });

  it("réagit aux mutations sans scrutation agressive", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = youtubeFixture;
    const adapter = new YouTubeAdapter(document);
    const listener = vi.fn();
    adapter.start(listener);

    const segment = document.querySelector<HTMLElement>(".ytp-caption-segment");
    expect(segment).not.toBeNull();
    if (segment) {
      segment.textContent = "A new line";
    }
    await vi.advanceTimersByTimeAsync(30);

    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: "A new line you were here." }),
    );
    adapter.stop();
  });

  it.each([
    ["www.youtube.com", "/watch", "youtube"],
    ["www.netflix.com", "/watch/123", "netflix"],
    ["www.primevideo.com", "/detail/123", "primeVideo"],
    ["www.amazon.fr", "/gp/video/detail/123", "primeVideo"],
    ["www.canalplus.com", "/player/123", "canalPlus"],
    ["live.mycanal.fr", "/video/123", "canalPlus"],
    ["tv.apple.com", "/fr/show/123", "appleTv"],
    ["www.bilibili.com", "/video/BV1xx411c7mD", "bilibili"],
    ["m.bilibili.com", "/video/BV1xx411c7mD", "bilibili"],
    ["www.bilibili.tv", "/fr/video/123", "bilibili"],
    ["example.com", "/video", "generic"],
  ] as const)("associe %s à %s", (hostname, pathname, expected) => {
    expect(detectPlatform({ hostname, pathname })).toBe(expected);
  });

  it("valide tous les identifiants de plateforme connus", () => {
    expect(isPlatformId("canalPlus")).toBe(true);
    expect(isPlatformId("appleTv")).toBe(true);
    expect(isPlatformId("bilibili")).toBe(true);
    expect(isPlatformId("unknown-streamer")).toBe(false);
  });
});
