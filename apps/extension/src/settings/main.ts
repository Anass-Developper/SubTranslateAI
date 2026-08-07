import { ServerClient, ServerClientError } from "../client/server-client";
import { mergeSettings } from "../config";
import { loadSettings, saveSettings } from "../storage";
import type { DiagnosticReport, ExtensionSettings, ServerStats } from "../types";
import { formatDiagnosticReport } from "../ui/overlay";
import { activateSiteAccessForCurrentTab } from "./site-access";

const root = document.querySelector<HTMLElement>("#app");
if (!root) {
  throw new Error("Conteneur de réglages introuvable");
}

const popupMode = document.body.dataset.mode === "popup";
renderApplication(root, popupMode);
void initialize(root, popupMode);

function renderApplication(container: HTMLElement, compact: boolean): void {
  container.innerHTML = `
    <header class="app-header">
      <div>
        <p class="eyebrow">Dual Subtitles</p>
        <h1>Français + 中文</h1>
      </div>
      <label class="switch-label primary-toggle">
        <input id="enabled" type="checkbox" />
        <span>Activé</span>
      </label>
    </header>

    <form id="settings-form">
      <section class="panel">
        <h2>Plateformes</h2>
        <div class="checkbox-grid">
          <label><input id="platform-youtube" type="checkbox" /> YouTube</label>
          <label><input id="platform-netflix" type="checkbox" /> Netflix</label>
          <label><input id="platform-prime" type="checkbox" /> Prime Video</label>
          <label><input id="platform-canal-plus" type="checkbox" /> CANAL+</label>
          <label><input id="platform-apple-tv" type="checkbox" /> Apple TV+</label>
          <label><input id="platform-bilibili" type="checkbox" /> Bilibili</label>
          <label><input id="platform-generic" type="checkbox" /> Autres plateformes</label>
        </div>
        ${
          compact
            ? `<div class="button-row site-access-row">
                <button id="enable-current-site" type="button" class="secondary">Activer sur ce site</button>
                <span id="site-access-result" class="result" role="status"></span>
              </div>`
            : `<p class="hint">Pour un autre service de streaming, ouvrez son site puis utilisez « Activer sur ce site » depuis le popup.</p>`
        }
      </section>

      <section class="panel">
        <h2>Serveur local</h2>
        <label class="field">
          <span>Adresse</span>
          <input id="server-url" type="url" spellcheck="false" autocomplete="off" />
        </label>
        <div class="button-row">
          <button id="test-server" type="button">Tester la connexion</button>
          <span id="server-result" class="result" role="status"></span>
        </div>
      </section>

      <section class="panel">
        <h2>Affichage</h2>
        <label class="field">
          <span>Ordre des langues</span>
          <select id="language-order">
            <option value="fr-first">Français puis chinois</option>
            <option value="zh-first">Chinois puis français</option>
          </select>
        </label>
        <label class="field range-field">
          <span>Taille <output id="font-size-output"></output></span>
          <input id="font-size" type="range" min="16" max="56" step="1" />
        </label>
        <label class="field range-field">
          <span>Position depuis le bas <output id="vertical-output"></output></span>
          <input id="vertical-position" type="range" min="2" max="45" step="1" />
        </label>
        <label class="field range-field">
          <span>Opacité du fond <output id="opacity-output"></output></span>
          <input id="background-opacity" type="range" min="0" max="0.95" step="0.05" />
        </label>
        <div class="checkbox-grid stacked">
          <label><input id="text-shadow" type="checkbox" /> Contour / ombre du texte</label>
          <label><input id="hide-native" type="checkbox" /> Masquer le sous-titre natif</label>
          <label><input id="debug" type="checkbox" /> Mode debug</label>
        </div>
      </section>

      <section class="panel advanced">
        <h2>Performance</h2>
        <div class="checkbox-grid stacked">
          <label><input id="preload-enabled" type="checkbox" /> Précharger et traduire la piste complète en arrière-plan</label>
        </div>
        <div class="two-columns">
          <label class="field">
            <span>Stabilisation (ms)</span>
            <input id="debounce" type="number" min="20" max="500" step="10" />
          </label>
          <label class="field">
            <span>Attente maximale des fragments (ms)</span>
            <input id="fragment-window" type="number" min="40" max="1000" step="10" />
          </label>
          <label class="field">
            <span>Délai maximal (ms)</span>
            <input id="request-timeout" type="number" min="1000" max="25000" step="500" />
          </label>
          <label class="field">
            <span>Reconnexion (ms)</span>
            <input id="reconnect-interval" type="number" min="3000" max="120000" step="1000" />
          </label>
          <label class="field">
            <span>Lignes de contexte</span>
            <input id="context-lines" type="number" min="2" max="4" step="1" />
          </label>
        </div>
      </section>

      <section class="panel">
        <h2>Cache et diagnostic</h2>
        <dl class="stats">
          <div><dt>Lignes traduites</dt><dd id="translated-stat">—</dd></div>
          <div><dt>Réutilisées du cache</dt><dd id="cached-stat">—</dd></div>
          <div class="advanced"><dt>Taux de cache</dt><dd id="cache-rate-stat">—</dd></div>
        </dl>
        <div class="button-row wrap">
          <button id="refresh-stats" type="button">Actualiser</button>
          <button id="clear-cache" type="button" class="secondary">Vider le cache</button>
          <button id="copy-diagnostics" type="button" class="secondary">Copier le diagnostic</button>
        </div>
        <p id="action-result" class="result" role="status"></p>
      </section>
    </form>

    <footer>
      <span>Raccourci : <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Y</kbd></span>
      ${compact ? '<button id="open-options" type="button" class="link-button">Réglages avancés</button>' : ""}
    </footer>
  `;
}

async function initialize(container: HTMLElement, compact: boolean): Promise<void> {
  let settings = await loadSettings();
  fillForm(container, settings);
  updateRangeOutputs(container);

  const form = requiredElement<HTMLFormElement>(container, "#settings-form");
  form.addEventListener("change", () => {
    const next = readForm(container, settings);
    if (!next) {
      return;
    }
    settings = next;
    void saveSettings(settings).then(() =>
      setResult(container, "#action-result", "Réglages enregistrés."),
    );
  });
  form.addEventListener("input", () => updateRangeOutputs(container));

  requiredElement(container, "#test-server").addEventListener("click", () => {
    void testConnection(container, settings);
  });
  requiredElement(container, "#refresh-stats").addEventListener("click", () => {
    void refreshStats(container, settings);
  });
  requiredElement(container, "#clear-cache").addEventListener("click", () => {
    void clearCache(container, settings);
  });
  requiredElement(container, "#copy-diagnostics").addEventListener("click", () => {
    void copyDiagnostics(container);
  });

  if (compact) {
    requiredElement(container, "#enable-current-site").addEventListener("click", () => {
      void activateCurrentSite(container);
    });
    requiredElement(container, "#open-options").addEventListener("click", () => {
      void chrome.runtime.openOptionsPage();
    });
  }

  await refreshStats(container, settings, true);
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
  select(container, "#language-order").value = settings.languageOrder;
  input(container, "#font-size").value = settings.fontSize.toString();
  input(container, "#vertical-position").value = settings.verticalPosition.toString();
  input(container, "#background-opacity").value = settings.backgroundOpacity.toString();
  checkbox(container, "#text-shadow").checked = settings.textShadow;
  checkbox(container, "#hide-native").checked = settings.hideNativeSubtitles;
  checkbox(container, "#debug").checked = settings.debug;
  checkbox(container, "#preload-enabled").checked = settings.preloadEnabled;
  input(container, "#fragment-window").value = settings.fragmentWindowMs.toString();
  input(container, "#debounce").value = settings.debounceMs.toString();
  input(container, "#request-timeout").value = settings.requestTimeoutMs.toString();
  input(container, "#reconnect-interval").value = settings.reconnectIntervalMs.toString();
  input(container, "#context-lines").value = settings.contextLineCount.toString();
}

function readForm(container: HTMLElement, previous: ExtensionSettings): ExtensionSettings | null {
  const serverUrl = input(container, "#server-url").value.trim();
  try {
    new ServerClient(serverUrl);
  } catch (error) {
    setResult(
      container,
      "#server-result",
      error instanceof Error ? error.message : "Adresse locale invalide",
      true,
    );
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
    languageOrder:
      select(container, "#language-order").value === "zh-first" ? "zh-first" : "fr-first",
    fontSize: numberValue(container, "#font-size", 16, 56),
    verticalPosition: numberValue(container, "#vertical-position", 2, 45),
    backgroundOpacity: numberValue(container, "#background-opacity", 0, 0.95),
    textShadow: checkbox(container, "#text-shadow").checked,
    hideNativeSubtitles: checkbox(container, "#hide-native").checked,
    debug: checkbox(container, "#debug").checked,
    preloadEnabled: checkbox(container, "#preload-enabled").checked,
    debounceMs: numberValue(container, "#debounce", 20, 500),
    fragmentWindowMs: numberValue(container, "#fragment-window", 40, 1000),
    requestTimeoutMs: numberValue(container, "#request-timeout", 1000, 25000),
    reconnectIntervalMs: numberValue(container, "#reconnect-interval", 3000, 120000),
    contextLineCount: numberValue(container, "#context-lines", 2, 4),
  });
}

async function testConnection(container: HTMLElement, settings: ExtensionSettings): Promise<void> {
  setResult(container, "#server-result", "Connexion…");
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
          ? `local · ${health.model} · secours API`
          : health.model;
    const missingRemoteKey = health.provider !== "ollama" && !health.apiKeyConfigured;
    setResult(
      container,
      "#server-result",
      missingRemoteKey
        ? `Serveur disponible — ${providerLabel} — clé API de secours absente`
        : `Serveur disponible — ${providerLabel}`,
    );
  } catch (error) {
    setResult(container, "#server-result", readableError(error), true);
  }
}

async function refreshStats(
  container: HTMLElement,
  settings: ExtensionSettings,
  silent = false,
): Promise<void> {
  try {
    const stats = await new ServerClient(settings.serverUrl, settings.requestTimeoutMs).getStats();
    applyStats(container, stats);
    if (!silent) {
      setResult(container, "#action-result", "Statistiques actualisées.");
    }
  } catch (error) {
    if (!silent) {
      setResult(container, "#action-result", readableError(error), true);
    }
  }
}

async function clearCache(container: HTMLElement, settings: ExtensionSettings): Promise<void> {
  try {
    const result = await new ServerClient(
      settings.serverUrl,
      settings.requestTimeoutMs,
    ).clearCache();
    setResult(container, "#action-result", `${result.cleared} entrée(s) supprimée(s).`);
    await refreshStats(container, settings, true);
  } catch (error) {
    setResult(container, "#action-result", readableError(error), true);
  }
}

async function copyDiagnostics(container: HTMLElement): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];
    if (!activeTab?.id) {
      throw new Error("Aucun onglet actif");
    }
    const report = (await chrome.tabs.sendMessage(activeTab.id, {
      type: "GET_DIAGNOSTICS",
    })) as DiagnosticReport;
    await copyText(formatDiagnosticReport(report));
    setResult(container, "#action-result", "Diagnostic copié dans le presse-papiers.");
  } catch {
    setResult(
      container,
      "#action-result",
      "Ouvrez une vidéo sur une plateforme activée puis réessayez.",
      true,
    );
  }
}

async function activateCurrentSite(container: HTMLElement): Promise<void> {
  setResult(container, "#site-access-result", "Autorisation…");
  try {
    const result = await activateSiteAccessForCurrentTab();
    if (!result.granted) {
      setResult(container, "#site-access-result", "Autorisation refusée.", true);
      return;
    }
    setResult(container, "#site-access-result", "Site activé et rechargé.");
  } catch (error) {
    setResult(
      container,
      "#site-access-result",
      error instanceof Error ? error.message : "Activation impossible",
      true,
    );
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

function readableError(error: unknown): string {
  if (error instanceof ServerClientError || error instanceof Error) {
    return error.message;
  }
  return "Serveur de traduction indisponible";
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
