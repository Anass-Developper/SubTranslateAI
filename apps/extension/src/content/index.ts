import { ContentController } from "./controller";

declare global {
  interface Window {
    __dualSubtitlesController?: ContentController;
  }
}

if (!window.__dualSubtitlesController) {
  const controller = new ContentController();
  window.__dualSubtitlesController = controller;
  void controller.start().catch((error: unknown) => {
    console.error("[Dual Subtitles] Initialisation impossible", error);
    delete window.__dualSubtitlesController;
  });
}
