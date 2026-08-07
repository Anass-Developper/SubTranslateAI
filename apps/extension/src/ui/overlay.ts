import type { DiagnosticReport, ExtensionSettings, TranslationResponse } from "../types";

export class SubtitleOverlay {
  private readonly host: HTMLDivElement;
  private readonly shadow: ShadowRoot;
  private readonly container: HTMLDivElement;
  private readonly subtitleCard: HTMLDivElement;
  private readonly frenchLine: HTMLDivElement;
  private readonly chineseLine: HTMLDivElement;
  private readonly sourceLine: HTMLDivElement;
  private readonly statusLine: HTMLDivElement;
  private readonly debugPanel: HTMLDivElement;
  private readonly debugText: HTMLPreElement;
  private readonly copyButton: HTMLButtonElement;
  private currentDiagnostics: DiagnosticReport | null = null;
  private mounted = false;
  private readonly fullscreenHandler = (): void => this.moveIntoFullscreenRoot();
  private readonly copyHandler = (): void => void this.copyDiagnostics();

  constructor(private readonly documentRoot: Document = document) {
    this.host = documentRoot.createElement("div");
    this.host.dataset.dualSubtitlesOverlay = "true";
    this.host.style.cssText =
      "all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;";
    this.shadow = this.host.attachShadow({ mode: "open" });

    const style = documentRoot.createElement("style");
    style.textContent = OVERLAY_CSS;
    this.container = documentRoot.createElement("div");
    this.container.className = "subtitle-container";
    this.container.dataset.state = "empty";
    this.container.setAttribute("role", "region");
    this.container.setAttribute("aria-label", "Sous-titres traduits");
    this.container.setAttribute("aria-live", "polite");
    this.container.setAttribute("aria-atomic", "true");

    this.subtitleCard = documentRoot.createElement("div");
    this.subtitleCard.className = "subtitle-card";
    this.subtitleCard.hidden = true;

    this.frenchLine = this.createLine("subtitle-line french", "fr", "FR");
    this.chineseLine = this.createLine("subtitle-line chinese", "zh-Hans", "简中");
    this.sourceLine = this.createLine("subtitle-line source", "");
    this.statusLine = this.createLine("status", "fr");
    this.statusLine.setAttribute("role", "status");
    this.subtitleCard.append(this.frenchLine, this.chineseLine, this.sourceLine);
    this.container.append(this.subtitleCard, this.statusLine);

    this.debugPanel = documentRoot.createElement("div");
    this.debugPanel.className = "debug-panel";
    const debugTitle = documentRoot.createElement("strong");
    debugTitle.textContent = "Diagnostic sous-titres";
    this.debugText = documentRoot.createElement("pre");
    this.copyButton = documentRoot.createElement("button");
    this.copyButton.type = "button";
    this.copyButton.textContent = "Copier le diagnostic";
    this.copyButton.addEventListener("click", this.copyHandler);
    this.debugPanel.append(debugTitle, this.debugText, this.copyButton);

    this.shadow.append(style, this.container, this.debugPanel);
  }

  mount(): void {
    if (this.mounted) {
      return;
    }
    this.mounted = true;
    this.documentRoot.addEventListener("fullscreenchange", this.fullscreenHandler);
    this.moveIntoFullscreenRoot();
  }

  destroy(): void {
    this.documentRoot.removeEventListener("fullscreenchange", this.fullscreenHandler);
    this.copyButton.removeEventListener("click", this.copyHandler);
    this.host.remove();
    this.mounted = false;
  }

  setActive(active: boolean): void {
    this.host.style.display = active ? "block" : "none";
  }

  applySettings(settings: ExtensionSettings): void {
    this.host.style.setProperty("--dual-font-size", `${settings.fontSize}px`);
    this.host.style.setProperty("--dual-bottom", `${settings.verticalPosition}%`);
    this.host.style.setProperty("--dual-bg-opacity", settings.backgroundOpacity.toString());
    this.host.style.setProperty(
      "--dual-shadow",
      settings.textShadow
        ? "0 2px 4px #000, 0 0 2px #000, -1px -1px 1px #000, 1px 1px 1px #000"
        : "none",
    );
    this.frenchLine.style.order = settings.languageOrder === "fr-first" ? "1" : "2";
    this.chineseLine.style.order = settings.languageOrder === "fr-first" ? "2" : "1";
    this.sourceLine.style.order = "1";
    this.statusLine.style.order = "3";
    this.setDebugVisible(settings.debug);
  }

  showPendingSource(text: string, languageHint?: "fr" | "zh"): void {
    this.clearText();
    if (languageHint === "fr") {
      this.setLine(this.frenchLine, text);
    } else if (languageHint === "zh") {
      this.setLine(this.chineseLine, text);
    } else {
      this.setLine(this.sourceLine, text);
    }
    this.container.dataset.state = "pending";
    this.syncSubtitleCard();
    this.setStatus("");
  }

  showTranslation(response: TranslationResponse): void {
    this.setLine(this.frenchLine, response.fr);
    this.setLine(this.chineseLine, response.zh);
    this.setLine(this.sourceLine, "");
    this.container.dataset.state = "translated";
    this.syncSubtitleCard();
    this.setStatus("");
  }

  clearText(): void {
    this.setLine(this.frenchLine, "");
    this.setLine(this.chineseLine, "");
    this.setLine(this.sourceLine, "");
    this.container.dataset.state = "empty";
    this.syncSubtitleCard();
  }

  setStatus(message: string): void {
    this.setLine(this.statusLine, message);
  }

  setDiagnostics(report: DiagnosticReport): void {
    this.currentDiagnostics = report;
    this.debugText.textContent = formatDiagnosticReport(report);
  }

  private setDebugVisible(visible: boolean): void {
    this.debugPanel.toggleAttribute("data-visible", visible);
  }

  private createLine(className: string, language: string, label?: string): HTMLDivElement {
    const element = this.documentRoot.createElement("div");
    element.className = className;
    if (language) {
      element.lang = language;
    }
    if (label) {
      element.dataset.label = label;
    }
    element.hidden = true;
    return element;
  }

  private setLine(element: HTMLElement, text: string): void {
    element.textContent = text;
    element.hidden = !text;
  }

  private syncSubtitleCard(): void {
    this.subtitleCard.hidden = [this.frenchLine, this.chineseLine, this.sourceLine].every(
      (line) => line.hidden,
    );
  }

  private moveIntoFullscreenRoot(): void {
    if (!this.mounted) {
      return;
    }
    const fullscreenElement = this.documentRoot.fullscreenElement;
    const target = fullscreenElement ?? this.documentRoot.documentElement;
    if (target && this.host.parentElement !== target) {
      target.append(this.host);
    }
  }

  private async copyDiagnostics(): Promise<void> {
    if (!this.currentDiagnostics) {
      return;
    }
    const text = formatDiagnosticReport(this.currentDiagnostics);
    try {
      await navigator.clipboard.writeText(text);
      this.copyButton.textContent = "Copié !";
    } catch {
      const textarea = this.documentRoot.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      this.documentRoot.body.append(textarea);
      textarea.select();
      this.documentRoot.execCommand("copy");
      textarea.remove();
      this.copyButton.textContent = "Copié !";
    }
    setTimeout(() => {
      this.copyButton.textContent = "Copier le diagnostic";
    }, 1_500);
  }
}

export function formatDiagnosticReport(report: DiagnosticReport): string {
  return JSON.stringify(report, null, 2);
}

const OVERLAY_CSS = `
  :host {
    --dual-font-size: 30px;
    --dual-bottom: 10%;
    --dual-bg-opacity: 0.62;
    --dual-shadow: 0 2px 4px #000, 0 0 2px #000;
    color-scheme: dark;
  }
  *, *::before, *::after { box-sizing: border-box; }
  .subtitle-container {
    position: fixed;
    left: 50%;
    bottom: max(var(--dual-bottom), env(safe-area-inset-bottom, 0px));
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    width: max-content;
    max-width: min(92vw, 1100px);
    pointer-events: none;
    contain: layout style;
    isolation: isolate;
    font-family: Inter, system-ui, -apple-system, "Segoe UI", "Microsoft YaHei",
      "Noto Sans CJK SC", sans-serif;
    text-align: center;
    line-height: 1.28;
    text-rendering: optimizeLegibility;
  }
  .subtitle-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    max-width: 100%;
    padding: 8px 16px 10px;
    overflow: hidden;
    border: 1px solid rgb(255 255 255 / 0.14);
    border-radius: 12px;
    background: linear-gradient(
      160deg,
      rgb(13 18 28 / var(--dual-bg-opacity)),
      rgb(2 5 10 / var(--dual-bg-opacity))
    );
    box-shadow: 0 10px 36px rgb(0 0 0 / 0.38), inset 0 1px rgb(255 255 255 / 0.05);
    backdrop-filter: blur(10px) saturate(1.12);
    -webkit-backdrop-filter: blur(10px) saturate(1.12);
    transition: opacity 140ms ease, transform 140ms ease;
  }
  .subtitle-container[data-state="pending"] .subtitle-card {
    opacity: 0.78;
    transform: translateY(2px) scale(0.995);
  }
  .subtitle-line {
    max-width: 100%;
    padding: 2px 4px;
    color: #fff;
    font-size: clamp(18px, var(--dual-font-size), 56px);
    font-weight: 650;
    letter-spacing: 0.005em;
    overflow-wrap: anywhere;
    text-shadow: var(--dual-shadow);
    white-space: pre-wrap;
  }
  .subtitle-line[data-label]::before {
    content: attr(data-label);
    display: inline-block;
    margin-inline-end: 0.62em;
    padding: 0.18em 0.42em;
    transform: translateY(-0.12em);
    border: 1px solid currentColor;
    border-radius: 999px;
    font: 700 0.36em/1 system-ui, sans-serif;
    letter-spacing: 0.08em;
    opacity: 0.78;
    text-shadow: none;
    vertical-align: middle;
  }
  .french { color: #f7fbff; }
  .french::before { color: #78c7ff; }
  .chinese {
    color: #fff8e7;
    font-family: "Microsoft YaHei", "Noto Sans CJK SC", "PingFang SC", system-ui, sans-serif;
  }
  .chinese::before { color: #ffd36b; }
  .source { color: #f3f5f8; font-style: italic; }
  .status {
    max-width: min(84vw, 720px);
    padding: 5px 11px;
    border-radius: 999px;
    border: 1px solid rgb(255 255 255 / 0.12);
    background: rgb(8 12 20 / 0.82);
    color: #dbe6f5;
    font: 500 13px/1.3 system-ui, sans-serif;
    box-shadow: 0 5px 18px rgb(0 0 0 / 0.32);
    backdrop-filter: blur(8px);
  }
  .debug-panel {
    position: fixed;
    top: 12px;
    right: 12px;
    display: none;
    width: min(430px, calc(100vw - 24px));
    max-height: min(48vh, 420px);
    padding: 10px;
    border: 1px solid #526178;
    border-radius: 7px;
    background: rgb(10 15 24 / 0.93);
    color: #dce7f7;
    font: 12px/1.4 Consolas, monospace;
    box-shadow: 0 6px 24px rgb(0 0 0 / 0.5);
    pointer-events: auto;
  }
  .debug-panel[data-visible] { display: block; }
  .debug-panel strong { font: 600 13px/1.4 Arial, sans-serif; }
  .debug-panel pre {
    max-height: 300px;
    margin: 8px 0;
    overflow: auto;
    white-space: pre-wrap;
    user-select: text;
  }
  .debug-panel button {
    padding: 6px 9px;
    border: 1px solid #7d8da7;
    border-radius: 5px;
    background: #26364e;
    color: #fff;
    cursor: pointer;
    font: 12px Arial, sans-serif;
  }
  @media (max-width: 720px) {
    .subtitle-container { max-width: 96vw; }
    .subtitle-card { padding: 7px 11px 9px; border-radius: 10px; }
    .subtitle-line { font-size: min(var(--dual-font-size), 7vw); }
  }
  @media (prefers-reduced-motion: reduce) {
    .subtitle-card { transition: none; }
  }
  [hidden] { display: none !important; }
`;
