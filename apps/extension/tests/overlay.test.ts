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
    expect(style).toContain("linear-gradient(180deg, #28c7ed, #8a61ff)");
    overlay.destroy();
  });

  it("affiche clairement la préparation puis l’état prêt", () => {
    const overlay = new SubtitleOverlay(document);
    overlay.mount();
    overlay.showPendingSource("Hello", "fr");

    const host = document.querySelector<HTMLElement>("[data-dual-subtitles-overlay]");
    const preparation = host?.shadowRoot?.querySelector<HTMLElement>(".preparation");
    expect(preparation?.dataset.state).toBe("loading");
    expect(preparation?.textContent).toBe("Traduction en cours…");

    overlay.setPreparationStatus("ready", "Prêt · 6/120 répliques préparées");
    expect(preparation?.dataset.state).toBe("ready");
    expect(preparation?.textContent).toContain("Prêt");
    expect(preparation?.hidden).toBe(false);
    overlay.destroy();
  });

  it("masque automatiquement l’état lorsque l’épisode est prêt", () => {
    vi.useFakeTimers();
    const overlay = new SubtitleOverlay(document);
    overlay.mount();
    overlay.setPreparationStatus("complete", "Épisode prêt · 326 répliques");

    const host = document.querySelector<HTMLElement>("[data-dual-subtitles-overlay]");
    const preparation = host?.shadowRoot?.querySelector<HTMLElement>(".preparation");
    expect(preparation?.hidden).toBe(false);
    vi.advanceTimersByTime(3_999);
    expect(preparation?.hidden).toBe(false);
    vi.advanceTimersByTime(1);
    expect(preparation?.hidden).toBe(true);

    overlay.setPreparationStatus("complete", "Épisode prêt · 326 répliques");
    expect(preparation?.hidden).toBe(true);
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
