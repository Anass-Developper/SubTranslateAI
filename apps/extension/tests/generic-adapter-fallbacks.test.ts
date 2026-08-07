import { GenericSubtitleAdapter } from "../src/adapters/generic-subtitle-adapter";

describe("fallbacks DOM de l'adaptateur générique", () => {
  it("traverse récursivement les Shadow DOM ouverts", () => {
    const outerHost = document.createElement("div");
    document.body.append(outerHost);
    const outerRoot = outerHost.attachShadow({ mode: "open" });
    const innerHost = document.createElement("div");
    outerRoot.append(innerHost);
    const innerRoot = innerHost.attachShadow({ mode: "open" });
    innerRoot.innerHTML = `
      <div class="movie-subtitle">
        <span role="text">A subtitle in a nested shadow root</span>
      </div>
    `;

    const snapshot = new GenericSubtitleAdapter(document).readSnapshot();

    expect(snapshot.text).toBe("A subtitle in a nested shadow root");
    expect(snapshot.selector).toContain("subtitle");
    expect(snapshot.candidates).toEqual([
      expect.objectContaining({ text: "A subtitle in a nested shadow root", visible: true }),
    ]);
  });

  it("observe les mutations des Shadow DOM découverts dynamiquement", async () => {
    vi.useFakeTimers();
    const adapter = new GenericSubtitleAdapter(document);
    const listener = vi.fn();
    adapter.start(listener);

    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<div class="movie-subtitle"><span role="text">First line</span></div>`;
    document.body.append(host);
    await vi.advanceTimersByTimeAsync(30);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ text: "First line" }));

    const subtitle = shadow.querySelector<HTMLElement>("[role='text']");
    expect(subtitle).not.toBeNull();
    if (subtitle) subtitle.textContent = "Second line";
    await vi.advanceTimersByTimeAsync(30);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ text: "Second line" }));

    adapter.stop();
  });
});

describe("fallback textTracks de l'adaptateur générique", () => {
  it("lit uniquement les activeCues des pistes en mode showing, y compris dans un Shadow DOM", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    const video = document.createElement("video");
    shadow.append(video);
    const hiddenTrack = mockTextTrack("hidden", ["Hidden subtitle"]);
    const showingTrack = mockTextTrack("showing", ["<i>Visible</i> subtitle", "Second speaker"]);
    installTextTracks(video, [hiddenTrack.track, showingTrack.track]);

    const snapshot = new GenericSubtitleAdapter(document).readSnapshot();

    expect(snapshot.text).toBe("Visible subtitle Second speaker");
    expect(snapshot.selector).toBe("video.textTracks.activeCues");
  });

  it("préfère un sous-titre DOM au fallback textTracks", () => {
    document.body.innerHTML = `
      <video></video>
      <div class="movie-subtitle"><span role="text">DOM subtitle</span></div>
    `;
    const video = document.querySelector<HTMLVideoElement>("video");
    expect(video).not.toBeNull();
    if (video) installTextTracks(video, [mockTextTrack("showing", ["Native cue"]).track]);

    const snapshot = new GenericSubtitleAdapter(document).readSnapshot();

    expect(snapshot.text).toBe("DOM subtitle");
    expect(snapshot.selector).not.toBe("video.textTracks.activeCues");
  });

  it("réagit aux cuechange avec debounce et retire le listener à l'arrêt", async () => {
    vi.useFakeTimers();
    const video = document.createElement("video");
    document.body.append(video);
    const textTrack = mockTextTrack("showing", ["First cue"]);
    installTextTracks(video, [textTrack.track]);
    const adapter = new GenericSubtitleAdapter(document);
    const listener = vi.fn();
    adapter.start(listener);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ text: "First cue" }));

    textTrack.setActiveCues(["Second cue"]);
    textTrack.track.dispatchEvent(new Event("cuechange"));
    textTrack.track.dispatchEvent(new Event("cuechange"));
    await vi.advanceTimersByTimeAsync(24);
    expect(listener).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ text: "Second cue" }));

    adapter.stop();
    textTrack.setActiveCues(["Cue after stop"]);
    textTrack.track.dispatchEvent(new Event("cuechange"));
    await vi.advanceTimersByTimeAsync(30);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

function mockTextTrack(
  initialMode: TextTrackMode,
  initialTexts: readonly string[],
): { track: TextTrack; setActiveCues(texts: readonly string[]): void } {
  let activeCues = cueList(initialTexts);
  const track = new EventTarget() as TextTrack;
  Object.defineProperties(track, {
    mode: { configurable: true, get: () => initialMode },
    activeCues: { configurable: true, get: () => activeCues },
  });
  return {
    track,
    setActiveCues(texts) {
      activeCues = cueList(texts);
    },
  };
}

function cueList(texts: readonly string[]): TextTrackCueList {
  const cues = texts.map((text, index) => ({
    id: `cue-${index + 1}`,
    startTime: index,
    endTime: index + 1,
    text,
  }));
  const list: Record<number | string, unknown> = {
    length: cues.length,
    getCueById: (id: string) => cues.find((cue) => cue.id === id) ?? null,
  };
  for (const [index, cue] of cues.entries()) list[index] = cue;
  return list as unknown as TextTrackCueList;
}

function installTextTracks(video: HTMLVideoElement, tracks: readonly TextTrack[]): void {
  const list: Record<number | string, unknown> = { length: tracks.length };
  for (const [index, track] of tracks.entries()) list[index] = track;
  Object.defineProperty(video, "textTracks", { configurable: true, value: list });
}
