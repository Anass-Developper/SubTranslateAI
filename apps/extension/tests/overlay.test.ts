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
    expect(container?.dataset.state).toBe("translated");
    expect(container?.getAttribute("aria-live")).toBe("polite");
    expect(card?.hidden).toBe(false);
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
