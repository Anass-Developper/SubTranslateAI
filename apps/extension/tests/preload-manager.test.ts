import {
  SubtitlePreloadManager,
  type PreloadBatchRequest,
  type PreloadBatchTranslation,
  type PreloadCue,
  type SubtitleBatchClient,
} from "../src/core/preload";

describe("préchargement des sous-titres", () => {
  it("priorise la fenêtre proche avec des lots de 40 et deux requêtes au maximum", () => {
    const calls: ClientCall[] = [];
    const manager = new SubtitlePreloadManager(deferredClient(calls), {
      maxBatchSize: 200,
      concurrency: 10,
      lookAheadMs: 5_000,
      lookBehindMs: 1_000,
    });
    const cues = makeCues(100);

    manager.setTrack("movie", cues, 50_000);

    expect(calls).toHaveLength(2);
    expect(calls[0]!.request.cues).toHaveLength(40);
    expect(calls[1]!.request.cues).toHaveLength(40);
    expect(calls[0]!.request.cues.slice(0, 7).map(({ id }) => id)).toEqual([
      "cue-50",
      "cue-49",
      "cue-51",
      "cue-52",
      "cue-53",
      "cue-54",
      "cue-55",
    ]);
    expect(manager.getStatus()).toMatchObject({ inFlight: 80, pending: 20 });
    manager.dispose();
  });

  it("place la cue courante en tête même sur une piste dense", () => {
    const calls: ClientCall[] = [];
    const manager = new SubtitlePreloadManager(deferredClient(calls), {
      maxBatchSize: 8,
      concurrency: 2,
      lookAheadMs: 180_000,
      lookBehindMs: 10_000,
    });
    const cues = Array.from({ length: 400 }, (_, index) =>
      makeCue(`dense-${index}`, index * 250, `Dense subtitle ${index}`, 125),
    );

    manager.setTrack("dense-movie", cues, 50_000);

    expect(calls).toHaveLength(2);
    expect(calls[0]!.request.cues).toHaveLength(8);
    expect(calls[1]!.request.cues).toHaveLength(8);
    expect(calls[0]!.request.cues[0]?.id).toBe("dense-200");
    manager.dispose();
  });

  it("réserve un micro-lot aux cues actives et prochaines quand il est configuré", () => {
    const calls: ClientCall[] = [];
    const manager = new SubtitlePreloadManager(deferredClient(calls), {
      maxBatchSize: 8,
      concurrency: 2,
      foregroundBatchSize: 2,
      foregroundWindowMs: 1_500,
      lookAheadMs: 180_000,
      lookBehindMs: 10_000,
    });

    manager.setTrack("movie", makeCues(100), 50_000);

    expect(calls).toHaveLength(2);
    expect(calls[0]!.request.cues.map(({ id }) => id)).toEqual(["cue-50", "cue-51"]);
    expect(calls[1]!.request.cues).toHaveLength(8);
    expect(calls[1]!.request.cues.map(({ id }) => id)).not.toContain("cue-50");
    manager.dispose();
  });

  it("borne la taille foreground à la taille maximale d'un lot", () => {
    const calls: ClientCall[] = [];
    const manager = new SubtitlePreloadManager(deferredClient(calls), {
      maxBatchSize: 2,
      concurrency: 1,
      foregroundBatchSize: 20,
      foregroundWindowMs: 10_000,
    });

    manager.setTrack("movie", makeCues(20), 5_000);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.request.cues).toHaveLength(2);
    expect(calls[0]!.request.cues[0]?.id).toBe("cue-5");
    manager.dispose();
  });

  it("annule le lot actif et relance immédiatement autour de la nouvelle position après un seek", async () => {
    const calls: ClientCall[] = [];
    const manager = new SubtitlePreloadManager(deferredClient(calls), {
      maxBatchSize: 1,
      concurrency: 1,
      lookAheadMs: 0,
      lookBehindMs: 0,
    });
    const cues = makeCues(100);
    manager.setTrack("movie", cues, 0);
    expect(calls[0]!.request.cues[0]!.id).toBe("cue-0");

    manager.updateCurrentTime(90_000);

    expect(calls[0]!.signal.aborted).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.request.cues[0]!.id).toBe("cue-90");

    calls[0]!.resolve(successResults(calls[0]!.request));
    await Promise.resolve();
    expect(manager.lookup(cues[0]!)).toBeNull();
    manager.dispose();
  });

  it("n'utilise la cache que pour l'identité exacte et déclenche sinon le fallback", async () => {
    const cue = makeCues(1)[0]!;
    const client: SubtitleBatchClient = {
      translateBatch: vi.fn(async (request) => successResults(request)),
    };
    const manager = new SubtitlePreloadManager(client, { concurrency: 1 });
    manager.setTrack("movie", [cue], 0);
    await vi.waitFor(() => expect(manager.lookup(cue)).not.toBeNull());

    expect(manager.lookup(cue)).toMatchObject({ fr: "FR: Subtitle 0", zh: "ZH: Subtitle 0" });
    expect(manager.lookup({ ...cue, text: `${cue.text}!` })).toBeNull();
    expect(manager.lookup({ ...cue, startMs: cue.startMs + 1 })).toBeNull();
    expect(manager.lookup({ ...cue, endMs: cue.endMs + 1 })).toBeNull();
    expect(manager.lookup({ ...cue, id: "another-id" })).toBeNull();

    const fallback = vi.fn(() => "live-translation");
    expect(manager.resolve(cue, fallback)).toMatchObject({ id: cue.id });
    expect(fallback).not.toHaveBeenCalled();
    expect(manager.resolve({ ...cue, text: "changed" }, fallback)).toBe("live-translation");
    expect(fallback).toHaveBeenCalledOnce();
    manager.dispose();
  });

  it("annule l'ancienne piste et ignore sa réponse tardive", async () => {
    const calls: ClientCall[] = [];
    const onTranslation = vi.fn();
    const manager = new SubtitlePreloadManager(deferredClient(calls), {
      maxBatchSize: 1,
      concurrency: 1,
      onTranslation,
    });
    const oldCue = makeCue("old", 0, "Old subtitle");
    const newCue = makeCue("new", 0, "New subtitle");

    manager.setTrack("old-track", [oldCue], 0);
    const oldCall = calls[0]!;
    manager.setTrack("new-track", [newCue], 0);
    const newCall = calls[1]!;

    expect(oldCall.signal.aborted).toBe(true);
    oldCall.resolve(successResults(oldCall.request));
    await Promise.resolve();
    await Promise.resolve();
    expect(manager.lookup(oldCue)).toBeNull();
    expect(onTranslation).not.toHaveBeenCalled();

    newCall.resolve(successResults(newCall.request));
    await vi.waitFor(() => expect(manager.lookup(newCue)).not.toBeNull());
    expect(onTranslation).toHaveBeenCalledOnce();
    expect(manager.getStatus()).toMatchObject({ trackId: "new-track", translated: 1 });
    manager.dispose();
  });

  it("conserve le lot actif quand une piste segmentée est enrichie", async () => {
    const calls: ClientCall[] = [];
    const first = makeCue("first", 0, "First");
    const second = makeCue("second", 1_000, "Second");
    const manager = new SubtitlePreloadManager(deferredClient(calls), {
      concurrency: 1,
      maxBatchSize: 1,
    });

    manager.setTrack("segmented", [first], 0);
    const firstCall = calls[0]!;
    manager.setTrack("segmented", [first, second], 0);

    expect(firstCall.signal.aborted).toBe(false);
    expect(calls).toHaveLength(1);

    firstCall.resolve(successResults(firstCall.request));
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(manager.lookup(first)).not.toBeNull();
    expect(calls[1]!.request.cues).toEqual([second]);

    calls[1]!.resolve(successResults(calls[1]!.request));
    await vi.waitFor(() => expect(manager.lookup(second)).not.toBeNull());
    expect(manager.getStatus()).toMatchObject({ total: 2, translated: 2 });
    manager.dispose();
  });

  it("relance automatiquement une erreur transitoire après un court backoff", async () => {
    vi.useFakeTimers();
    const calls: ClientCall[] = [];
    const cue = makeCues(1)[0]!;
    const manager = new SubtitlePreloadManager(deferredClient(calls), { concurrency: 1 });

    try {
      manager.setTrack("movie", [cue], 0);
      calls[0]!.reject(new Error("temporary network error"));
      await vi.advanceTimersByTimeAsync(0);

      expect(manager.getStatus()).toMatchObject({ failed: 1, inFlight: 0 });
      await vi.advanceTimersByTimeAsync(499);
      expect(calls).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(calls).toHaveLength(2);
      calls[1]!.resolve(successResults(calls[1]!.request));
      await vi.advanceTimersByTimeAsync(0);

      expect(manager.lookup(cue)).not.toBeNull();
      expect(manager.getStatus()).toMatchObject({ translated: 1, failed: 0 });
    } finally {
      manager.dispose();
      vi.useRealTimers();
    }
  });

  it("ouvre le circuit après deux relances puis retente après le cooldown", async () => {
    vi.useFakeTimers();
    const calls: ClientCall[] = [];
    const manager = new SubtitlePreloadManager(deferredClient(calls), { concurrency: 1 });

    try {
      manager.setTrack("movie", makeCues(1), 0);
      calls[0]!.reject(new Error("failure 1"));
      await vi.advanceTimersByTimeAsync(500);
      expect(calls).toHaveLength(2);

      calls[1]!.reject(new Error("failure 2"));
      await vi.advanceTimersByTimeAsync(1_000);
      expect(calls).toHaveLength(3);

      calls[2]!.reject(new Error("failure 3"));
      await vi.advanceTimersByTimeAsync(14_999);
      expect(calls).toHaveLength(3);
      expect(manager.getStatus()).toMatchObject({ failed: 1, inFlight: 0 });

      await vi.advanceTimersByTimeAsync(1);
      expect(calls).toHaveLength(4);
      expect(calls[3]!.request.cues[0]?.id).toBe("cue-0");
    } finally {
      manager.dispose();
      vi.useRealTimers();
    }
  });

  it("bloque toute la file sur une erreur non retentable jusqu'à une reprise explicite", async () => {
    vi.useFakeTimers();
    const calls: ClientCall[] = [];
    const manager = new SubtitlePreloadManager(deferredClient(calls), {
      concurrency: 1,
      maxBatchSize: 1,
    });

    try {
      manager.setTrack("movie", makeCues(3), 0);
      calls[0]!.reject({ kind: "unauthorized", status: 401 });
      await vi.advanceTimersByTimeAsync(60_000);

      expect(calls).toHaveLength(1);
      expect(manager.getStatus()).toMatchObject({ failed: 1, pending: 2, inFlight: 0 });

      manager.retryMissing();
      expect(calls).toHaveLength(2);
      expect(calls[1]!.request.cues[0]?.id).toBe("cue-0");
    } finally {
      manager.dispose();
      vi.useRealTimers();
    }
  });

  it("marque une réponse absente sans relancer en boucle et permet un nouvel essai explicite", async () => {
    const client: SubtitleBatchClient = {
      translateBatch: vi
        .fn<SubtitleBatchClient["translateBatch"]>()
        .mockResolvedValueOnce([])
        .mockImplementation(async (request) => successResults(request)),
    };
    const cue = makeCues(1)[0]!;
    const manager = new SubtitlePreloadManager(client, { concurrency: 1 });
    manager.setTrack("movie", [cue], 0);
    await vi.waitFor(() => expect(manager.getStatus().failed).toBe(1));
    expect(client.translateBatch).toHaveBeenCalledOnce();

    manager.retryMissing();
    await vi.waitFor(() => expect(manager.lookup(cue)).not.toBeNull());
    expect(client.translateBatch).toHaveBeenCalledTimes(2);
    manager.dispose();
  });
});

interface ClientCall {
  request: PreloadBatchRequest;
  signal: AbortSignal;
  resolve: (result: readonly PreloadBatchTranslation[]) => void;
  reject: (reason?: unknown) => void;
}

function deferredClient(calls: ClientCall[]): SubtitleBatchClient {
  return {
    translateBatch: (request, signal) =>
      new Promise((resolve, reject) => {
        calls.push({ request, signal, resolve, reject });
      }),
  };
}

function successResults(request: PreloadBatchRequest): readonly PreloadBatchTranslation[] {
  return request.cues.map((cue) => ({
    id: cue.id,
    sourceLanguage: "en",
    fr: `FR: ${cue.text}`,
    zh: `ZH: ${cue.text}`,
    cached: false,
  }));
}

function makeCues(count: number): PreloadCue[] {
  return Array.from({ length: count }, (_, index) =>
    makeCue(`cue-${index}`, index * 1_000, `Subtitle ${index}`),
  );
}

function makeCue(id: string, startMs: number, text: string, durationMs = 500): PreloadCue {
  return { id, startMs, endMs: startMs + durationMs, text };
}
