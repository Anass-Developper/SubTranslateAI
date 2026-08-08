import type { SubtitlePreloadStatus } from "../core/preload";

export interface PreloadDisplayStatus {
  state: "hidden" | "loading" | "ready" | "complete";
  message: string;
}

export function describePreloadStatus(
  status: SubtitlePreloadStatus,
  enabled: boolean,
  translationPending: boolean,
): PreloadDisplayStatus {
  if (!enabled) return { state: "hidden", message: "" };

  if (!status.trackId || status.total === 0) {
    return translationPending
      ? { state: "loading", message: "Préparation du modèle et des sous-titres…" }
      : { state: "hidden", message: "" };
  }

  if (status.translated === 0) {
    return { state: "loading", message: "Préparation du modèle et des sous-titres…" };
  }

  if (status.translated < status.total) {
    return {
      state: "ready",
      message: `Prêt · ${status.translated}/${status.total} répliques préparées`,
    };
  }

  return {
    state: "complete",
    message: `Épisode prêt · ${status.total} répliques`,
  };
}
