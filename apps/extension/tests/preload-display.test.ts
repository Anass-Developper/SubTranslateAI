import { describePreloadStatus } from "../src/content/preload-display";
import type { SubtitlePreloadStatus } from "../src/core/preload";

describe("état visible du préchargement", () => {
  it("annonce le démarrage dès la première réplique détectée", () => {
    expect(describePreloadStatus(status(), true, true)).toEqual({
      state: "loading",
      message: "Préparation du modèle et des sous-titres…",
    });
  });

  it("distingue la préparation, la disponibilité et la fin", () => {
    expect(
      describePreloadStatus(status({ trackId: "episode", total: 100, inFlight: 6 }), true, true),
    ).toMatchObject({ state: "loading" });
    expect(
      describePreloadStatus(
        status({ trackId: "episode", total: 100, translated: 12, inFlight: 6 }),
        true,
        true,
      ),
    ).toEqual({ state: "ready", message: "Prêt · 12/100 répliques préparées" });
    expect(
      describePreloadStatus(
        status({ trackId: "episode", total: 100, translated: 100 }),
        true,
        false,
      ),
    ).toEqual({ state: "complete", message: "Épisode prêt · 100 répliques" });
  });

  it("reste silencieux lorsque le préchargement est désactivé", () => {
    expect(describePreloadStatus(status({ trackId: "episode", total: 10 }), false, true)).toEqual({
      state: "hidden",
      message: "",
    });
  });
});

function status(overrides: Partial<SubtitlePreloadStatus> = {}): SubtitlePreloadStatus {
  return {
    trackId: null,
    total: 0,
    translated: 0,
    inFlight: 0,
    failed: 0,
    pending: 0,
    ...overrides,
  };
}
