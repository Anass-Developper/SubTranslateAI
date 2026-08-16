import type { ServerErrorKind } from "../client/server-client";
import {
  resolveUiLanguage,
  serverErrorTranslationKey,
  translate,
  type TranslationKey,
  type UiLanguage,
} from "../settings/i18n";
import type {
  DiagnosticReport,
  ExtensionSettings,
  SubtitleDisplayMode,
  TranslationResponse,
} from "../types";

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
  private readonly debugTitle: HTMLElement;
  private readonly debugText: HTMLPreElement;
  private readonly copyButton: HTMLButtonElement;
  private currentDiagnostics: DiagnosticReport | null = null;
  private currentTranslation: TranslationResponse | null = null;
  private statusTranslationKey: TranslationKey | null = null;
  private subtitleDisplayMode: SubtitleDisplayMode = "both";
  private uiLanguage: UiLanguage = "en";
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
    this.debugTitle = documentRoot.createElement("strong");
    this.debugText = documentRoot.createElement("pre");
    this.copyButton = documentRoot.createElement("button");
    this.copyButton.type = "button";
    this.copyButton.addEventListener("click", this.copyHandler);
    this.debugPanel.append(this.debugTitle, this.debugText, this.copyButton);

    this.shadow.append(style, this.container, this.debugPanel);
    this.applyTranslations();
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
    const detectedLanguage =
      (typeof chrome !== "undefined" ? chrome.i18n?.getUILanguage?.() : undefined) ??
      navigator.language;
    this.uiLanguage = resolveUiLanguage(settings.interfaceLocale, detectedLanguage);
    this.applyTranslations();
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
    this.subtitleDisplayMode = settings.subtitleDisplayMode;
    if (this.currentTranslation) this.renderTranslation();
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
    this.currentTranslation = response;
    this.renderTranslation();
    this.container.dataset.state = "translated";
    this.setStatus("");
  }

  clearText(): void {
    this.currentTranslation = null;
    this.setLine(this.frenchLine, "");
    this.setLine(this.chineseLine, "");
    this.setLine(this.sourceLine, "");
    this.container.dataset.state = "empty";
    this.syncSubtitleCard();
  }

  setStatus(message: string): void {
    this.statusTranslationKey = null;
    this.setLine(this.statusLine, message);
  }

  setErrorStatus(kind: ServerErrorKind | "unknown"): void {
    this.statusTranslationKey = serverErrorTranslationKey(kind);
    this.renderTranslatedStatus();
  }

  setDiagnostics(report: DiagnosticReport): void {
    this.currentDiagnostics = report;
    this.debugText.textContent = formatDiagnosticReport(report);
  }

  private setDebugVisible(visible: boolean): void {
    this.debugPanel.toggleAttribute("data-visible", visible);
  }

  private applyTranslations(): void {
    this.container.lang = this.uiLanguage;
    this.container.setAttribute("aria-label", translate(this.uiLanguage, "translatedSubtitles"));
    this.statusLine.lang = this.uiLanguage;
    this.debugPanel.lang = this.uiLanguage;
    this.debugTitle.textContent = translate(this.uiLanguage, "diagnosticsTitle");
    this.copyButton.textContent = translate(this.uiLanguage, "copyDiagnostic");
    this.renderTranslatedStatus();
  }

  private renderTranslatedStatus(): void {
    if (this.statusTranslationKey) {
      this.setLine(this.statusLine, translate(this.uiLanguage, this.statusTranslationKey));
    }
  }

  private renderTranslation(): void {
    const response = this.currentTranslation;
    if (!response) return;
    this.setLine(this.frenchLine, this.subtitleDisplayMode === "zh-only" ? "" : response.fr);
    this.setLine(this.chineseLine, this.subtitleDisplayMode === "fr-only" ? "" : response.zh);
    this.setLine(this.sourceLine, "");
    this.syncSubtitleCard();
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
      this.copyButton.textContent = translate(this.uiLanguage, "copied");
    } catch {
      const textarea = this.documentRoot.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      this.documentRoot.body.append(textarea);
      textarea.select();
      this.documentRoot.execCommand("copy");
      textarea.remove();
      this.copyButton.textContent = translate(this.uiLanguage, "copied");
    }
    setTimeout(() => {
      this.copyButton.textContent = translate(this.uiLanguage, "copyDiagnostic");
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
    gap: 7px;
    width: max-content;
    max-width: min(90vw, 980px);
    pointer-events: none;
    contain: layout style;
    isolation: isolate;
    font-family: Inter, system-ui, -apple-system, "Segoe UI", "Microsoft YaHei",
      "Noto Sans CJK SC", sans-serif;
    text-align: center;
    line-height: 1.24;
    text-rendering: optimizeLegibility;
  }
  .subtitle-card {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0;
    max-width: 100%;
    padding: 9px 18px 10px;
    overflow: hidden;
    border: 1px solid rgb(255 255 255 / 0.1);
    border-radius: 14px;
    background: linear-gradient(
      145deg,
      rgb(11 18 31 / var(--dual-bg-opacity)),
      rgb(3 8 16 / var(--dual-bg-opacity))
    );
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.3), inset 0 1px rgb(255 255 255 / 0.04);
    backdrop-filter: blur(12px) saturate(1.08);
    -webkit-backdrop-filter: blur(12px) saturate(1.08);
    transition: opacity 150ms ease, transform 150ms ease;
  }
  .subtitle-container[data-state="pending"] .subtitle-card {
    opacity: 0.72;
    transform: translateY(2px);
  }
  .subtitle-line {
    max-width: 100%;
    padding: 2px 1px;
    color: #fff;
    font-size: clamp(18px, var(--dual-font-size), 56px);
    font-weight: 610;
    letter-spacing: -0.006em;
    overflow-wrap: anywhere;
    text-shadow: var(--dual-shadow);
    white-space: pre-wrap;
  }
  .subtitle-line[data-label]::before {
    content: "";
    display: inline-block;
    width: 0.18em;
    height: 0.18em;
    margin-inline-end: 0.52em;
    transform: translateY(-0.08em);
    border-radius: 50%;
    background: currentColor;
    opacity: 0.74;
    text-shadow: none;
    vertical-align: middle;
  }
  .french { color: #f4f8ff; }
  .french::before { color: #55c9ef; }
  .chinese {
    color: #f5efff;
    font-family: "Microsoft YaHei", "Noto Sans CJK SC", "PingFang SC", system-ui, sans-serif;
  }
  .chinese::before { color: #b792ff; }
  .french:not([hidden]) + .chinese:not([hidden]) {
    margin-top: 4px;
    padding-top: 5px;
    border-top: 1px solid rgb(255 255 255 / 0.09);
  }
  .source { color: #dce5f3; font-style: normal; font-weight: 520; }
  .source::before {
    content: "";
    display: inline-block;
    width: 0.34em;
    height: 0.34em;
    margin-inline-end: 0.55em;
    border-radius: 50%;
    background: #82a7ff;
    box-shadow: 0 0 0 0 rgb(130 167 255 / 0.35);
    animation: dual-pulse 1.25s ease-out infinite;
    vertical-align: 0.08em;
  }
  .status {
    max-width: min(84vw, 720px);
    padding: 5px 11px;
    border-radius: 999px;
    border: 1px solid rgb(255 116 138 / 0.24);
    background: rgb(31 12 22 / 0.88);
    color: #ffdbe2;
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
    border: 1px solid rgb(143 166 201 / 0.22);
    border-radius: 12px;
    background: rgb(7 14 27 / 0.95);
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
    padding: 7px 10px;
    border: 1px solid rgb(143 166 201 / 0.22);
    border-radius: 8px;
    background: linear-gradient(120deg, #426fe8, #7459ee);
    color: #fff;
    cursor: pointer;
    font: 12px Arial, sans-serif;
  }
  @media (max-width: 720px) {
    .subtitle-container { max-width: 96vw; }
    .subtitle-card { padding: 7px 12px 8px; border-radius: 11px; }
    .subtitle-line { font-size: min(var(--dual-font-size), 7vw); }
  }
  @keyframes dual-pulse {
    70% { box-shadow: 0 0 0 0.32em rgb(130 167 255 / 0); }
    100% { box-shadow: 0 0 0 0 rgb(130 167 255 / 0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .subtitle-card { transition: none; }
  }
  [hidden] { display: none !important; }
`;
