import { InitialWarmupPause } from "../src/content/initial-warmup-pause";

describe("pause pendant le premier chargement", () => {
  it("ne coupe pas une traduction qui répond rapidement", async () => {
    vi.useFakeTimers();
    const video = playingVideo();
    const pause = new InitialWarmupPause(() => video);

    pause.schedule(true);
    await pause.complete();
    await vi.advanceTimersByTimeAsync(700);

    expect(video.pause).not.toHaveBeenCalled();
    expect(video.play).not.toHaveBeenCalled();
  });

  it("met en pause après 700 ms puis reprend quand la traduction est prête", async () => {
    vi.useFakeTimers();
    const video = playingVideo();
    const onStateChange = vi.fn();
    const pause = new InitialWarmupPause(() => video, onStateChange);

    pause.schedule(true);
    await vi.advanceTimersByTimeAsync(699);
    expect(video.pause).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(video.pause).toHaveBeenCalledOnce();
    expect(pause.isPausedByExtension()).toBe(true);

    Object.defineProperty(video, "paused", { configurable: true, value: true });
    await expect(pause.complete()).resolves.toBe(true);
    expect(video.play).toHaveBeenCalledOnce();
    expect(pause.isPausedByExtension()).toBe(false);
    expect(onStateChange).toHaveBeenCalledTimes(2);
  });

  it("respecte la désactivation et une vidéo déjà arrêtée par l’utilisateur", async () => {
    vi.useFakeTimers();
    const video = playingVideo();
    Object.defineProperty(video, "paused", { configurable: true, value: true });
    const pause = new InitialWarmupPause(() => video);

    pause.schedule(false);
    pause.schedule(true);
    await vi.advanceTimersByTimeAsync(700);
    await pause.complete();

    expect(video.pause).not.toHaveBeenCalled();
    expect(video.play).not.toHaveBeenCalled();
  });
});

function playingVideo(): HTMLVideoElement & {
  pause: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
} {
  const video = document.createElement("video");
  document.body.append(video);
  Object.defineProperties(video, {
    paused: { configurable: true, value: false },
    ended: { configurable: true, value: false },
    pause: { configurable: true, value: vi.fn() },
    play: { configurable: true, value: vi.fn(async () => undefined) },
  });
  return video as HTMLVideoElement & {
    pause: ReturnType<typeof vi.fn>;
    play: ReturnType<typeof vi.fn>;
  };
}
