import { DEFAULT_EXTENSION_SETTINGS } from "../src/config";
import { SubtitlePipeline } from "../src/core/subtitle-pipeline";

describe("pipeline de sous-titres", () => {
  it("lance la dernière version au délai maximal sans cumuler deux attentes", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { id: string; text: string };
      return new Response(
        JSON.stringify({
          id: request.id,
          sourceLanguage: "en",
          fr: "Bonjour",
          zh: "你好",
          cached: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const pipeline = new SubtitlePipeline(
      {
        ...DEFAULT_EXTENSION_SETTINGS,
        fragmentWindowMs: 100,
        debounceMs: 60,
      },
      {
        onPending: vi.fn(),
        onTranslation: vi.fn(),
        onEmpty: vi.fn(),
        onError: vi.fn(),
        onServerState: vi.fn(),
      },
    );

    pipeline.observe("H");
    await vi.advanceTimersByTimeAsync(50);
    pipeline.observe("He");
    await vi.advanceTimersByTimeAsync(40);
    pipeline.observe("Hello");
    await vi.advanceTimersByTimeAsync(9);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ text: "Hello" });
    pipeline.dispose();
  });

  it("ignore une ancienne réponse même si fetch ne respecte pas l'annulation", async () => {
    vi.useFakeTimers();
    const pending: Array<{
      request: { id: string; text: string };
      resolve: (response: Response) => void;
    }> = [];
    const fetchMock = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          pending.push({
            request: JSON.parse(String(init?.body)) as { id: string; text: string },
            resolve,
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onTranslation = vi.fn();
    const pipeline = new SubtitlePipeline(
      {
        ...DEFAULT_EXTENSION_SETTINGS,
        fragmentWindowMs: 0,
        debounceMs: 0,
      },
      {
        onPending: vi.fn(),
        onTranslation,
        onEmpty: vi.fn(),
        onError: vi.fn(),
        onServerState: vi.fn(),
      },
    );

    pipeline.observe("First subtitle");
    await vi.advanceTimersByTimeAsync(0);
    pipeline.observe("Second subtitle");
    await vi.advanceTimersByTimeAsync(0);
    expect(pending).toHaveLength(2);

    pending[0]!.resolve(translationResponse(pending[0]!.request, "Ancien", "旧"));
    await Promise.resolve();
    await Promise.resolve();
    expect(onTranslation).not.toHaveBeenCalled();

    pending[1]!.resolve(translationResponse(pending[1]!.request, "Nouveau", "新"));
    await vi.waitFor(() => expect(onTranslation).toHaveBeenCalledOnce());
    expect(onTranslation).toHaveBeenCalledWith(
      expect.objectContaining({ fr: "Nouveau", zh: "新" }),
    );
    expect(pipeline.getDiagnostics()).toMatchObject({
      observedCues: 2,
      requestsStarted: 2,
      completedTranslations: 1,
      cancelledRequests: 1,
      failedRequests: 0,
      requestInFlight: false,
      lastOutcome: "translated",
    });
    pipeline.dispose();
  });

  it("utilise immédiatement une traduction préchargée et invalide la requête live", async () => {
    vi.useFakeTimers();
    let resolveLive: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn((...args: [unknown, RequestInit?]) => {
      void args;
      return new Promise<Response>((resolve) => {
        resolveLive = resolve;
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const onTranslation = vi.fn();
    const pipeline = new SubtitlePipeline(
      { ...DEFAULT_EXTENSION_SETTINGS, fragmentWindowMs: 0, debounceMs: 0 },
      {
        onPending: vi.fn(),
        onTranslation,
        onEmpty: vi.fn(),
        onError: vi.fn(),
        onServerState: vi.fn(),
      },
    );

    pipeline.observe("Hello");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledOnce();
    pipeline.acceptPreloaded("Hello", {
      id: "preload:cue-1",
      sourceLanguage: "en",
      fr: "Bonjour",
      zh: "你好",
      cached: true,
    });
    expect(onTranslation).toHaveBeenCalledOnce();
    expect(pipeline.getDiagnostics()).toMatchObject({
      preloadedTranslations: 1,
      completedTranslations: 1,
      cancelledRequests: 1,
      lastOutcome: "preloaded",
    });

    const liveRequest = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { id: string };
    resolveLive?.(translationResponse({ id: liveRequest.id, text: "Hello" }, "Tardif", "迟到"));
    await Promise.resolve();
    await Promise.resolve();
    expect(onTranslation).toHaveBeenCalledOnce();
    pipeline.dispose();
  });
});

function translationResponse(
  request: { id: string; text: string },
  fr: string,
  zh: string,
): Response {
  return new Response(
    JSON.stringify({
      id: request.id,
      sourceLanguage: "en",
      fr,
      zh,
      cached: false,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}
