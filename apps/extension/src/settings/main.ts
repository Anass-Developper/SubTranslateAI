import { ServerClient, ServerClientError } from "../client/server-client";
import { mergeSettings } from "../config";
import { loadSettings, saveSettings } from "../storage";
import type { DiagnosticReport, ExtensionSettings, ServerStats } from "../types";
import { formatDiagnosticReport } from "../ui/overlay";
import { resolveUiLanguage, translate, type TranslationKey, type UiLanguage } from "./i18n";
import { activateSiteAccessForCurrentTab } from "./site-access";

type Translator = (key: TranslationKey) => string;

const root = document.querySelector<HTMLElement>("#app");
if (!root) {
  throw new Error("Conteneur de réglages introuvable");
}

const popupMode = document.body.dataset.mode === "popup";
void mountApplication(root, popupMode);

async function mountApplication(
  container: HTMLElement,
  compact: boolean,
  providedSettings?: ExtensionSettings,
): Promise<void> {
  const settings = providedSettings ?? (await loadSettings());
  const detectedLanguage =
    (typeof chrome !== "undefined" ? chrome.i18n?.getUILanguage?.() : undefined) ??
    navigator.language;
  const language = resolveUiLanguage(settings.interfaceLocale, detectedLanguage);
  const t: Translator = (key) => translate(language, key);
  document.documentElement.lang = language;
  document.title = compact ? "SubTranslateAI" : `${t("display")} — SubTranslateAI`;
  renderApplication(container, compact, t);
  await initialize(container, compact, settings, language, t);
}

function renderApplication(container: HTMLElement, compact: boolean, t: Translator): void {
  container.innerHTML = `
    <header class="app-header">
      <div class="brand">
        <img class="brand-icon" src="icons/icon48.png" alt="" width="42" height="42" />
        <div>
          <h1>SubTranslateAI</h1>
          <p class="brand-subtitle">${t("french")} <span aria-hidden="true">↔</span> 中文</p>
        </div>
      </div>
      <label class="switch-label primary-toggle" title="${t("toggleExtension")}">
        <input id="enabled" type="checkbox" />
        <span class="switch-track" aria-hidden="true"></span>
        <span class="switch-text">${t("enabled")}</span>
      </label>
    </header>

    <section class="connection-card" id="connection-card" data-state="checking" aria-live="polite">
      <span class="connection-indicator" aria-hidden="true"></span>
      <div class="connection-copy">
        <strong id="connection-state">${t("checking")}</strong>
        <span id="connection-detail">${t("localEngineConnection")}</span>
      </div>
      <button id="retry-server" type="button" class="icon-button" title="${t("retryConnection")}" aria-label="${t("retryConnection")}">↻</button>
    </section>

    <form id="settings-form">
      <section class="panel options-only platforms-panel">
        <h2>${t("platforms")}</h2>
        <div class="checkbox-grid">
          <label><input id="platform-youtube" type="checkbox" /> YouTube</label>
          <label><input id="platform-netflix" type="checkbox" /> Netflix</label>
          <label><input id="platform-prime" type="checkbox" /> Prime Video</label>
          <label><input id="platform-canal-plus" type="checkbox" /> CANAL+</label>
          <label><input id="platform-apple-tv" type="checkbox" /> Apple TV+</label>
          <label><input id="platform-bilibili" type="checkbox" /> Bilibili</label>
          <label><input id="platform-generic" type="checkbox" /> ${t("genericPlatforms")}</label>
        </div>
        <p class="hint">${t("siteHint")}</p>
      </section>

      <section class="panel options-only server-panel">
        <h2>${t("localServer")}</h2>
        <label class="field">
          <span>${t("address")}</span>
          <input id="server-url" type="url" spellcheck="false" autocomplete="off" />
        </label>
        <div class="button-row">
          <button id="test-server" type="button">${t("testConnection")}</button>
          <span id="server-result" class="result" role="status"></span>
        </div>
      </section>

      <section class="panel display-panel">
        <div class="section-heading">
          <div><p class="eyebrow">${t("subtitles")}</p><h2>${t("display")}</h2></div>
          <span class="auto-save">${t("autoSave")}</span>
        </div>
        <label class="field">
          <span>${t("interfaceLanguage")}</span>
          <select id="interface-locale">
            <option value="auto">${t("automatic")}</option>
            <option value="fr">${t("french")}</option>
            <option value="en">${t("english")}</option>
          </select>
          <small>${t("interfaceLanguageHint")}</small>
        </label>
        <label class="field">
          <span>${t("displayedLanguages")}</span>
          <select id="subtitle-display-mode">
            <option value="both">${t("frenchAndChinese")}</option>
            <option value="fr-only">${t("frenchOnly")}</option>
            <option value="zh-only">${t("chineseOnly")}</option>
          </select>
          <small>${t("subtitleExplanation")}</small>
        </label>
        <label class="field">
          <span>${t("languageOrder")}</span>
          <select id="language-order">
            <option value="fr-first">${t("frenchThenChinese")}</option>
            <option value="zh-first">${t("chineseThenFrench")}</option>
          </select>
        </label>
        <label class="field range-field">
          <span>${t("fontSize")} <output id="font-size-output"></output></span>
          <input id="font-size" type="range" min="16" max="56" step="1" />
        </label>
        <label class="field range-field">
          <span>${t("verticalPosition")} <output id="vertical-output"></output></span>
          <input id="vertical-position" type="range" min="2" max="45" step="1" />
        </label>
        <label class="field range-field">
          <span>${t("backgroundOpacity")} <output id="opacity-output"></output></span>
          <input id="background-opacity" type="range" min="0" max="0.95" step="0.05" />
        </label>
        <div class="toggle-list">
          <label class="setting-toggle">
            <span><strong>${t("textShadow")}</strong><small>${t("textShadowDescription")}</small></span>
            <input id="text-shadow" type="checkbox" />
          </label>
          <label class="setting-toggle">
            <span><strong>${t("hideNative")}</strong><small>${t("hideNativeDescription")}</small></span>
            <input id="hide-native" type="checkbox" />
          </label>
          <label class="setting-toggle">
            <span><strong>${t("preload")}</strong><small>${t("preloadDescription")}</small></span>
            <input id="preload-enabled" type="checkbox" />
          </label>
          <label class="setting-toggle">
            <span><strong>${t("warmupPause")}</strong><small>${t("warmupPauseDescription")}</small></span>
            <input id="pause-on-warmup" type="checkbox" />
          </label>
          <label class="setting-toggle options-only">
            <span><strong>${t("debugMode")}</strong><small>${t("debugDescription")}</small></span>
            <input id="debug" type="checkbox" />
          </label>
        </div>
      </section>

      ${
        compact
          ? `<section class="panel current-site-panel">
              <div>
                <h2>${t("currentPage")}</h2>
                <p class="hint">${t("currentPageHint")}</p>
              </div>
              <button id="enable-current-site" type="button" class="secondary">${t("enableCurrentSite")}</button>
              <span id="site-access-result" class="result full-width" role="status"></span>
            </section>`
          : ""
      }

      <section class="panel options-only performance-panel">
        <div class="section-heading">
          <div><p class="eyebrow">${t("expert")}</p><h2>${t("performance")}</h2></div>
        </div>
        <div class="two-columns">
          <label class="field">
            <span>${t("stabilization")}</span>
            <input id="debounce" type="number" min="20" max="500" step="10" />
          </label>
          <label class="field">
            <span>${t("fragmentWait")}</span>
            <input id="fragment-window" type="number" min="40" max="1000" step="10" />
          </label>
          <label class="field">
            <span>${t("maximumDelay")}</span>
            <input id="request-timeout" type="number" min="1000" max="25000" step="500" />
          </label>
          <label class="field">
            <span>${t("reconnect")}</span>
            <input id="reconnect-interval" type="number" min="3000" max="120000" step="1000" />
          </label>
          <label class="field">
            <span>${t("contextLines")}</span>
            <input id="context-lines" type="number" min="2" max="4" step="1" />
          </label>
        </div>
      </section>

      <section class="panel diagnostic-panel">
        <div class="section-heading">
          <div><p class="eyebrow">${t("activity")}</p><h2>${t("localTranslations")}</h2></div>
        </div>
        <dl class="stats">
          <div><dt>${t("translatedLines")}</dt><dd id="translated-stat">—</dd></div>
          <div><dt>${t("reusedLines")}</dt><dd id="cached-stat">—</dd></div>
          <div class="options-only"><dt>${t("cacheRate")}</dt><dd id="cache-rate-stat">—</dd></div>
        </dl>
        <div class="button-row wrap">
          <button id="copy-diagnostics" type="button">${t("copyDiagnostic")}</button>
          <button id="refresh-stats" type="button" class="secondary">${t("refresh")}</button>
          <button id="clear-cache" type="button" class="secondary options-only">${t("clearCache")}</button>
        </div>
        <p id="action-result" class="result" role="status"></p>
      </section>
    </form>

    <footer>
      <span class="shortcut"><kbd>Ctrl</kbd><span>+</span><kbd>Shift</kbd><span>+</span><kbd>Y</kbd></span>
      ${compact ? `<button id="open-options" type="button" class="link-button">${t("openAllSettings")}</button>` : `<span>${t("settingsSavedAutomatically")}</span>`}
    </footer>
  `;
}

async function initialize(
  container: HTMLElement,
  compact: boolean,
  initialSettings: ExtensionSettings,
  language: UiLanguage,
  t: Translator,
): Promise<void> {
  let settings = initialSettings;
  fillForm(container, settings);
  updateRangeOutputs(container);
  updateLanguageControls(container, t);

  const form = requiredElement<HTMLFormElement>(container, "#settings-form");
  form.addEventListener("change", (event) => {
    updateLanguageControls(container, t);
    const next = readForm(container, settings, t);
    if (!next) {
      return;
    }
    const localeChanged = next.interfaceLocale !== settings.interfaceLocale;
    settings = next;
    void saveSettings(settings).then(() => {
      if (localeChanged && event.target === select(container, "#interface-locale")) {
        void mountApplication(container, compact, settings);
        return;
      }
      setResult(container, "#action-result", t("saved"));
    });
  });
  form.addEventListener("input", () => updateRangeOutputs(container));

  requiredElement(container, "#test-server").addEventListener("click", () => {
    void testConnection(container, settings, t);
  });
  requiredElement(container, "#retry-server").addEventListener("click", () => {
    void testConnection(container, settings, t);
  });
  requiredElement(container, "#refresh-stats").addEventListener("click", () => {
    void refreshStats(container, settings, t);
  });
  requiredElement(container, "#clear-cache").addEventListener("click", () => {
    void clearCache(container, settings, t);
  });
  requiredElement(container, "#copy-diagnostics").addEventListener("click", () => {
    void copyDiagnostics(container, t);
  });

  if (compact) {
    requiredElement(container, "#enable-current-site").addEventListener("click", () => {
      void activateCurrentSite(container, language, t);
    });
    requiredElement(container, "#open-options").addEventListener("click", () => {
      void chrome.runtime.openOptionsPage();
    });
  }

  await Promise.all([
    refreshStats(container, settings, t, true),
    refreshConnectionState(container, settings, t),
  ]);
}

function fillForm(container: HTMLElement, settings: ExtensionSettings): void {
  checkbox(container, "#enabled").checked = settings.enabled;
  checkbox(container, "#platform-youtube").checked = settings.platforms.youtube;
  checkbox(container, "#platform-netflix").checked = settings.platforms.netflix;
  checkbox(container, "#platform-prime").checked = settings.platforms.primeVideo;
  checkbox(container, "#platform-canal-plus").checked = settings.platforms.canalPlus;
  checkbox(container, "#platform-apple-tv").checked = settings.platforms.appleTv;
  checkbox(container, "#platform-bilibili").checked = settings.platforms.bilibili;
  checkbox(container, "#platform-generic").checked = settings.platforms.generic;
  input(container, "#server-url").value = settings.serverUrl;
  select(container, "#interface-locale").value = settings.interfaceLocale;
  select(container, "#subtitle-display-mode").value = settings.subtitleDisplayMode;
  select(container, "#language-order").value = settings.languageOrder;
  input(container, "#font-size").value = settings.fontSize.toString();
  input(container, "#vertical-position").value = settings.verticalPosition.toString();
  input(container, "#background-opacity").value = settings.backgroundOpacity.toString();
  checkbox(container, "#text-shadow").checked = settings.textShadow;
  checkbox(container, "#hide-native").checked = settings.hideNativeSubtitles;
  checkbox(container, "#debug").checked = settings.debug;
  checkbox(container, "#preload-enabled").checked = settings.preloadEnabled;
  checkbox(container, "#pause-on-warmup").checked = settings.pauseOnInitialWarmup;
  input(container, "#fragment-window").value = settings.fragmentWindowMs.toString();
  input(container, "#debounce").value = settings.debounceMs.toString();
  input(container, "#request-timeout").value = settings.requestTimeoutMs.toString();
  input(container, "#reconnect-interval").value = settings.reconnectIntervalMs.toString();
  input(container, "#context-lines").value = settings.contextLineCount.toString();
}

function readForm(
  container: HTMLElement,
  previous: ExtensionSettings,
  t: Translator,
): ExtensionSettings | null {
  const serverUrl = input(container, "#server-url").value.trim();
  try {
    new ServerClient(serverUrl);
  } catch (error) {
    setResult(container, "#server-result", readableError(error, t), true);
    return null;
  }

  return mergeSettings({
    ...previous,
    enabled: checkbox(container, "#enabled").checked,
    platforms: {
      youtube: checkbox(container, "#platform-youtube").checked,
      netflix: checkbox(container, "#platform-netflix").checked,
      primeVideo: checkbox(container, "#platform-prime").checked,
      canalPlus: checkbox(container, "#platform-canal-plus").checked,
      appleTv: checkbox(container, "#platform-apple-tv").checked,
      bilibili: checkbox(container, "#platform-bilibili").checked,
      generic: checkbox(container, "#platform-generic").checked,
    },
    serverUrl,
    interfaceLocale: interfaceLocale(container),
    subtitleDisplayMode: subtitleDisplayMode(container),
    languageOrder:
      select(container, "#language-order").value === "zh-first" ? "zh-first" : "fr-first",
    fontSize: numberValue(container, "#font-size", 16, 56),
    verticalPosition: numberValue(container, "#vertical-position", 2, 45),
    backgroundOpacity: numberValue(container, "#background-opacity", 0, 0.95),
    textShadow: checkbox(container, "#text-shadow").checked,
    hideNativeSubtitles: checkbox(container, "#hide-native").checked,
    debug: checkbox(container, "#debug").checked,
    preloadEnabled: checkbox(container, "#preload-enabled").checked,
    pauseOnInitialWarmup: checkbox(container, "#pause-on-warmup").checked,
    debounceMs: numberValue(container, "#debounce", 20, 500),
    fragmentWindowMs: numberValue(container, "#fragment-window", 40, 1000),
    requestTimeoutMs: numberValue(container, "#request-timeout", 1000, 25000),
    reconnectIntervalMs: numberValue(container, "#reconnect-interval", 3000, 120000),
    contextLineCount: numberValue(container, "#context-lines", 2, 4),
  });
}

function interfaceLocale(container: HTMLElement): ExtensionSettings["interfaceLocale"] {
  const value = select(container, "#interface-locale").value;
  if (value === "fr" || value === "en") return value;
  return "auto";
}

function subtitleDisplayMode(container: HTMLElement): ExtensionSettings["subtitleDisplayMode"] {
  const value = select(container, "#subtitle-display-mode").value;
  if (value === "fr-only" || value === "zh-only") return value;
  return "both";
}

function updateLanguageControls(container: HTMLElement, t: Translator): void {
  const order = select(container, "#language-order");
  const bothLanguages = subtitleDisplayMode(container) === "both";
  order.disabled = !bothLanguages;
  order.title = bothLanguages ? "" : t("languageOrderUnavailable");
}

async function testConnection(
  container: HTMLElement,
  settings: ExtensionSettings,
  t: Translator,
): Promise<void> {
  setResult(container, "#server-result", t("connectionPending"));
  setConnectionState(container, "checking", t("checking"), t("localEngineConnection"));
  try {
    const client = new ServerClient(
      input(container, "#server-url").value,
      settings.requestTimeoutMs,
    );
    const health = await client.getHealth();
    const providerLabel =
      health.provider === "ollama"
        ? `local · ${health.model}`
        : health.provider === "hybrid"
          ? `local · ${health.model} · ${t("fallbackApi")}`
          : health.model;
    const missingRemoteKey = health.provider !== "ollama" && !health.apiKeyConfigured;
    setResult(
      container,
      "#server-result",
      missingRemoteKey
        ? `${t("serverAvailable")} — ${providerLabel} — ${t("missingFallbackKey")}`
        : `${t("serverAvailable")} — ${providerLabel}`,
    );
    setConnectionState(container, "ready", t("ready"), providerLabel);
  } catch (error) {
    setResult(container, "#server-result", readableError(error, t), true);
    setConnectionState(container, "error", t("serverUnavailable"), readableError(error, t));
  }
}

async function refreshConnectionState(
  container: HTMLElement,
  settings: ExtensionSettings,
  t: Translator,
): Promise<void> {
  try {
    const health = await new ServerClient(
      settings.serverUrl,
      settings.requestTimeoutMs,
    ).getHealth();
    const detail = health.provider === "ollama" ? `Local · ${health.model}` : health.model;
    setConnectionState(container, "ready", t("ready"), detail);
  } catch (error) {
    setConnectionState(container, "error", t("serverUnavailable"), readableError(error, t));
  }
}

function setConnectionState(
  container: HTMLElement,
  state: "checking" | "ready" | "error",
  title: string,
  detail: string,
): void {
  requiredElement(container, "#connection-card").dataset.state = state;
  requiredElement(container, "#connection-state").textContent = title;
  requiredElement(container, "#connection-detail").textContent = detail;
}

async function refreshStats(
  container: HTMLElement,
  settings: ExtensionSettings,
  t: Translator,
  silent = false,
): Promise<void> {
  try {
    const stats = await new ServerClient(settings.serverUrl, settings.requestTimeoutMs).getStats();
    applyStats(container, stats);
    if (!silent) {
      setResult(container, "#action-result", t("statsRefreshed"));
    }
  } catch (error) {
    if (!silent) {
      setResult(container, "#action-result", readableError(error, t), true);
    }
  }
}

async function clearCache(
  container: HTMLElement,
  settings: ExtensionSettings,
  t: Translator,
): Promise<void> {
  try {
    const result = await new ServerClient(
      settings.serverUrl,
      settings.requestTimeoutMs,
    ).clearCache();
    setResult(container, "#action-result", `${result.cleared} ${t("cacheCleared")}`);
    await refreshStats(container, settings, t, true);
  } catch (error) {
    setResult(container, "#action-result", readableError(error, t), true);
  }
}

async function copyDiagnostics(container: HTMLElement, t: Translator): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];
    if (!activeTab?.id) {
      throw new Error(t("activeTabMissing"));
    }
    const report = (await chrome.tabs.sendMessage(activeTab.id, {
      type: "GET_DIAGNOSTICS",
    })) as DiagnosticReport;
    await copyText(formatDiagnosticReport(report));
    setResult(container, "#action-result", t("diagnosticsCopied"));
  } catch {
    setResult(container, "#action-result", t("diagnosticsHint"), true);
  }
}

async function activateCurrentSite(
  container: HTMLElement,
  language: UiLanguage,
  t: Translator,
): Promise<void> {
  setResult(container, "#site-access-result", t("activationPending"));
  try {
    const result = await activateSiteAccessForCurrentTab();
    if (!result.granted) {
      setResult(container, "#site-access-result", t("activationRefused"), true);
      return;
    }
    setResult(container, "#site-access-result", t("activationSucceeded"));
  } catch (error) {
    setResult(container, "#site-access-result", localizedSiteAccessError(error, language, t), true);
  }
}

function applyStats(container: HTMLElement, stats: ServerStats): void {
  const translated = stats.translatedLines ?? stats.translated ?? 0;
  const cached = stats.cacheHits ?? stats.cached ?? 0;
  requiredElement(container, "#translated-stat").textContent = String(translated);
  requiredElement(container, "#cached-stat").textContent = String(cached);
  const rate = typeof stats.cacheHitRate === "number" ? stats.cacheHitRate : null;
  requiredElement(container, "#cache-rate-stat").textContent =
    rate === null ? "—" : `${Math.round(rate * 100)} %`;
}

function updateRangeOutputs(container: HTMLElement): void {
  requiredElement(container, "#font-size-output").textContent =
    `${input(container, "#font-size").value} px`;
  requiredElement(container, "#vertical-output").textContent =
    `${input(container, "#vertical-position").value} %`;
  requiredElement(container, "#opacity-output").textContent =
    `${Math.round(Number(input(container, "#background-opacity").value) * 100)} %`;
}

function setResult(
  container: HTMLElement,
  selectorValue: string,
  message: string,
  error = false,
): void {
  const element = requiredElement(container, selectorValue);
  element.textContent = message;
  element.toggleAttribute("data-error", error);
}

function readableError(error: unknown, t: Translator): string {
  if (error instanceof ServerClientError) {
    const keys: Record<ServerClientError["kind"], TranslationKey> = {
      aborted: "errorAborted",
      timeout: "errorTimeout",
      network: "errorNetwork",
      unauthorized: "errorUnauthorized",
      "rate-limit": "errorRateLimit",
      server: "errorServer",
      "invalid-response": "errorInvalidResponse",
    };
    return t(keys[error.kind]);
  }
  if (error instanceof Error) {
    return error.message;
  }
  return t("translationServerUnavailable");
}

function localizedSiteAccessError(error: unknown, language: UiLanguage, t: Translator): string {
  if (!(error instanceof Error) || language === "fr") {
    return error instanceof Error ? error.message : t("activationFailed");
  }
  const messages: Record<string, string> = {
    "Aucun onglet actif": "No active tab",
    "Adresse de l'onglet indisponible": "The tab address is unavailable",
    "Adresse de l'onglet invalide": "The tab address is invalid",
    "Seules les pages HTTPS peuvent être activées": "Only HTTPS pages can be enabled",
  };
  return messages[error.message] ?? t("activationFailed");
}

async function copyText(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}

function requiredElement<T extends HTMLElement = HTMLElement>(
  container: HTMLElement,
  selectorValue: string,
): T {
  const element = container.querySelector<T>(selectorValue);
  if (!element) {
    throw new Error(`Élément manquant : ${selectorValue}`);
  }
  return element;
}

function input(container: HTMLElement, selectorValue: string): HTMLInputElement {
  return requiredElement<HTMLInputElement>(container, selectorValue);
}

function checkbox(container: HTMLElement, selectorValue: string): HTMLInputElement {
  return input(container, selectorValue);
}

function select(container: HTMLElement, selectorValue: string): HTMLSelectElement {
  return requiredElement<HTMLSelectElement>(container, selectorValue);
}

function numberValue(
  container: HTMLElement,
  selectorValue: string,
  minimum: number,
  maximum: number,
): number {
  const value = Number(input(container, selectorValue).value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}
