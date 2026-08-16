import { DEFAULT_EXTENSION_SETTINGS } from "../src/config";
import { SubtitleOverlay } from "../src/ui/overlay";

describe("overlay bilingue", () => {
  it("affiche le français et le chinois sans capturer les clics", () => {
    const overlay = new SubtitleOverlay(document);
    overlay.mount();
    overlay.applySettings(DEFAULT_EXTENSION_SETTINGS);
    overlay.showTranslation({
      id: "subtitle-1",
      sourceLanguage: "en",
      fr: "Je ne savais pas que tu étais ici.",
      zh: "我不知道你在这里。",
      cached: false,
    });

    const host = document.querySelector<HTMLElement>("[data-dual-subtitles-overlay]");
    expect(host).not.toBeNull();
    expect(host?.style.pointerEvents).toBe("none");
    expect(host?.shadowRoot?.textContent).toContain("Je ne savais pas");
    expect(host?.shadowRoot?.textContent).toContain("我不知道你在这里。");
    const container = host?.shadowRoot?.querySelector<HTMLElement>(".subtitle-container");
    const card = host?.shadowRoot?.querySelector<HTMLElement>(".subtitle-card");
    const style = host?.shadowRoot?.querySelector("style")?.textContent;
    expect(container?.dataset.state).toBe("translated");
    expect(container?.getAttribute("aria-live")).toBe("polite");
    expect(card?.hidden).toBe(false);
    expect(style).toContain("max-width: min(90vw, 980px)");
    expect(style).not.toContain(".subtitle-card::before");
    overlay.destroy();
  });

  it("localise le nom accessible et le diagnostic selon le choix manuel", () => {
    const overlay = new SubtitleOverlay(document);
    overlay.mount();
    overlay.applySettings({ ...DEFAULT_EXTENSION_SETTINGS, interfaceLocale: "en", debug: true });

    const shadow = document.querySelector<HTMLElement>("[data-dual-subtitles-overlay]")?.shadowRoot;
    const container = shadow?.querySelector<HTMLElement>(".subtitle-container");
    const debugPanel = shadow?.querySelector<HTMLElement>(".debug-panel");

    expect(container?.lang).toBe("en");
    expect(container?.getAttribute("aria-label")).toBe("Translated subtitles");
    expect(debugPanel?.lang).toBe("en");
    expect(debugPanel?.querySelector("strong")?.textContent).toBe("Subtitle diagnostics");
    expect(debugPanel?.querySelector("button")?.textContent).toBe("Copy diagnostics");

    overlay.applySettings({ ...DEFAULT_EXTENSION_SETTINGS, interfaceLocale: "fr", debug: true });
    expect(container?.lang).toBe("fr");
    expect(container?.getAttribute("aria-label")).toBe("Sous-titres traduits");
    expect(debugPanel?.querySelector("strong")?.textContent).toBe("Diagnostic sous-titres");
    expect(debugPanel?.querySelector("button")?.textContent).toBe("Copier le diagnostic");
    overlay.destroy();
  });

  it("détecte automatiquement la langue du navigateur pour l’overlay", () => {
    vi.stubGlobal("chrome", { i18n: { getUILanguage: () => "fr-FR" } });
    const overlay = new SubtitleOverlay(document);
    overlay.mount();
    overlay.applySettings({ ...DEFAULT_EXTENSION_SETTINGS, interfaceLocale: "auto" });

    const container = document
      .querySelector<HTMLElement>("[data-dual-subtitles-overlay]")
      ?.shadowRoot?.querySelector<HTMLElement>(".subtitle-container");
    expect(container?.lang).toBe("fr");
    expect(container?.getAttribute("aria-label")).toBe("Sous-titres traduits");
    overlay.destroy();
  });

  it("localise une erreur de traduction et la retraduit après un changement de langue", () => {
    const overlay = new SubtitleOverlay(document);
    overlay.mount();
    overlay.applySettings({ ...DEFAULT_EXTENSION_SETTINGS, interfaceLocale: "en" });
    overlay.setErrorStatus("rate-limit");

    const status = document
      .querySelector<HTMLElement>("[data-dual-subtitles-overlay]")
      ?.shadowRoot?.querySelector<HTMLElement>(".status");
    expect(status?.textContent).toBe("Translation limit reached");

    overlay.applySettings({ ...DEFAULT_EXTENSION_SETTINGS, interfaceLocale: "fr" });
    expect(status?.textContent).toBe("Limite de traduction atteinte");
    overlay.destroy();
  });

  it("n'affiche aucun message de préparation ou de modèle", () => {
    const overlay = new SubtitleOverlay(document);
    overlay.mount();
    overlay.showPendingSource("Hello", "fr");

    const host = document.querySelector<HTMLElement>("[data-dual-subtitles-overlay]");
    expect(host?.shadowRoot?.querySelector(".preparation")).toBeNull();
    expect(host?.shadowRoot?.textContent).not.toContain("Traduction en cours");
    expect(host?.shadowRoot?.textContent).not.toContain("Épisode prêt");
    overlay.destroy();
  });

  it("choisit français, chinois ou les deux pour une piste source anglaise", () => {
    const overlay = new SubtitleOverlay(document);
    overlay.mount();
    overlay.applySettings({ ...DEFAULT_EXTENSION_SETTINGS, subtitleDisplayMode: "fr-only" });
    overlay.showTranslation({
      id: "english-subtitle",
      sourceLanguage: "en",
      fr: "Je serai là demain.",
      zh: "我明天会来。",
      cached: false,
    });

    const host = document.querySelector<HTMLElement>("[data-dual-subtitles-overlay]");
    const french = host?.shadowRoot?.querySelector<HTMLElement>(".french");
    const chinese = host?.shadowRoot?.querySelector<HTMLElement>(".chinese");
    expect(french?.hidden).toBe(false);
    expect(chinese?.hidden).toBe(true);

    overlay.applySettings({ ...DEFAULT_EXTENSION_SETTINGS, subtitleDisplayMode: "zh-only" });
    expect(french?.hidden).toBe(true);
    expect(chinese?.hidden).toBe(false);
    expect(chinese?.textContent).toBe("我明天会来。");

    overlay.applySettings({ ...DEFAULT_EXTENSION_SETTINGS, subtitleDisplayMode: "both" });
    expect(french?.hidden).toBe(false);
    expect(chinese?.hidden).toBe(false);
    overlay.destroy();
  });

  it("inverse l'ordre visuel via les réglages", () => {
    const overlay = new SubtitleOverlay(document);
    overlay.mount();
    overlay.applySettings({ ...DEFAULT_EXTENSION_SETTINGS, languageOrder: "zh-first" });
    const host = document.querySelector<HTMLElement>("[data-dual-subtitles-overlay]");
    const fr = host?.shadowRoot?.querySelector<HTMLElement>(".french");
    const zh = host?.shadowRoot?.querySelector<HTMLElement>(".chinese");

    expect(zh?.style.order).toBe("1");
    expect(fr?.style.order).toBe("2");
    overlay.destroy();
  });

  it("distingue l’attente puis masque proprement la carte vide", () => {
    const overlay = new SubtitleOverlay(document);
    overlay.mount();
    overlay.showPendingSource("字幕正在翻译", "zh");

    const host = document.querySelector<HTMLElement>("[data-dual-subtitles-overlay]");
    const container = host?.shadowRoot?.querySelector<HTMLElement>(".subtitle-container");
    const card = host?.shadowRoot?.querySelector<HTMLElement>(".subtitle-card");
    const chinese = host?.shadowRoot?.querySelector<HTMLElement>(".chinese");
    expect(container?.dataset.state).toBe("pending");
    expect(card?.hidden).toBe(false);
    expect(chinese?.dataset.label).toBe("简中");

    overlay.clearText();
    expect(container?.dataset.state).toBe("empty");
    expect(card?.hidden).toBe(true);
    overlay.destroy();
  });
});
