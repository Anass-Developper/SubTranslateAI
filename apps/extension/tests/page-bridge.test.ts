/**
 * @vitest-environment-options {"url":"https://www.youtube.com/watch?v=video-a"}
 */

describe("bridge de capture des pistes", () => {
  it("rejoue une piste capturée avant que le content script soit prêt", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Promise.resolve(
        new Response("WEBVTT\n\n00:00.000 --> 00:02.000\nEarly subtitle", {
          status: 200,
          headers: { "content-type": "text/vtt" },
        }),
      ),
    );
    Object.defineProperty(window, "fetch", {
      configurable: true,
      writable: true,
      value: fetchMock,
    });
    const postMessage = vi.spyOn(window, "postMessage");

    await import("../src/page-bridge/index");
    await window.fetch("https://captions.example/subtitle.vtt");
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "dual-subtitles-page-bridge",
          type: "TIMED_TEXT_RESOURCE",
        }),
        window.location.origin,
      ),
    );

    postMessage.mockClear();
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        origin: window.location.origin,
        data: { source: "dual-subtitles-content", type: "TRACK_BRIDGE_READY" },
      }),
    );

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "dual-subtitles-page-bridge",
        type: "TIMED_TEXT_RESOURCE",
        payload: expect.objectContaining({
          body: expect.stringContaining("Early subtitle"),
          contentType: "text/vtt",
          activeHint: true,
        }),
      }),
      window.location.origin,
    );

    postMessage.mockClear();
    await Promise.all([
      window.fetch("https://cdn.example/captions/aaaaaaaaaaaaaaaaaaaa.vtt"),
      window.fetch("https://cdn.example/captions/bbbbbbbbbbbbbbbbbbbb.vtt"),
    ]);
    await vi.waitFor(() => expect(trackMessages(postMessage.mock.calls)).toHaveLength(2));
    expect(
      new Set(trackMessages(postMessage.mock.calls).map(({ payload }) => payload.trackId)),
    ).toHaveProperty("size", 2);

    postMessage.mockClear();
    await Promise.all([
      window.fetch("https://cdn.example/captions/asset-a/segment-1.vtt"),
      window.fetch("https://cdn.example/captions/asset-a/segment-2.vtt"),
    ]);
    await vi.waitFor(() => expect(trackMessages(postMessage.mock.calls)).toHaveLength(2));
    expect(
      new Set(trackMessages(postMessage.mock.calls).map(({ payload }) => payload.trackId)),
    ).toHaveProperty("size", 1);

    let resolveOldResponse!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveOldResponse = resolve;
        }),
    );
    postMessage.mockClear();
    const oldRequest = window.fetch("https://captions.example/opaque-subtitle.vtt");
    window.history.pushState({}, "", "/watch?v=video-b");
    window.dispatchEvent(new Event("yt-navigate-finish"));
    resolveOldResponse(
      new Response("WEBVTT\n\n00:00.000 --> 00:02.000\nOld video", {
        status: 200,
        headers: { "content-type": "text/vtt" },
      }),
    );
    await oldRequest;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({
        source: "dual-subtitles-page-bridge",
        payload: expect.objectContaining({ body: expect.stringContaining("Old video") }),
      }),
      window.location.origin,
    );
  });
});

function trackMessages(calls: readonly unknown[][]): Array<{ payload: { trackId: string } }> {
  return calls
    .map(([message]) => message)
    .filter(
      (message): message is { payload: { trackId: string }; source: string; type: string } => {
        if (!message || typeof message !== "object") return false;
        const candidate = message as {
          payload?: { trackId?: unknown };
          source?: unknown;
          type?: unknown;
        };
        return (
          candidate.source === "dual-subtitles-page-bridge" &&
          candidate.type === "TIMED_TEXT_RESOURCE" &&
          typeof candidate.payload?.trackId === "string"
        );
      },
    );
}
