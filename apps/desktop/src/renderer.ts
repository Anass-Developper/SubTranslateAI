import type { ControlPanelState, DesktopStatus, UpdateStatus } from './contracts.js';
import {
  isInterfaceLanguage,
  resolveInterfaceLocale,
  translate,
  translateStaticText,
  type InterfaceLanguage,
  type InterfaceLocale,
} from './i18n.js';

const message = requiredElement('global-message');
const setupButton = requiredButton('setup-everything');
const extensionButton = requiredButton('open-extension');
const refreshButton = requiredButton('refresh');
const checkUpdateButton = requiredButton('check-update');
const installUpdateButton = requiredButton('install-update');
const saveSettingsButton = requiredButton('save-settings');
const clearCacheButton = requiredButton('clear-cache');
const interfaceLanguageSelect = requiredSelect('interface-language');
const settingsForm = requiredForm('settings-form');
const settingsMessage = requiredElement('settings-message');
let settingsDirty = false;
let languagePreference: InterfaceLanguage = 'auto';
let systemLocale: InterfaceLocale = resolveInterfaceLocale('auto', navigator.languages);
let locale: InterfaceLocale = resolveInterfaceLocale(languagePreference, systemLocale);
let latestStatus: DesktopStatus | null = null;
let latestUpdateStatus: UpdateStatus | null = null;

setupButton.addEventListener('click', () => void setupEverything());
extensionButton.addEventListener('click', () => void window.subTranslate.openExtensionFolder());
refreshButton.addEventListener('click', () => void refreshAll());
checkUpdateButton.addEventListener('click', () => void checkForUpdates());
installUpdateButton.addEventListener('click', () => void window.subTranslate.installUpdate());
clearCacheButton.addEventListener('click', () => void clearCache());
settingsForm.addEventListener('submit', (event) => void saveSettings(event));
settingsForm.addEventListener('change', () => {
  settingsDirty = true;
  settingsMessage.textContent = translate(locale, 'unsavedChanges');
});
interfaceLanguageSelect.addEventListener('change', () => {
  languagePreference = interfaceLanguage(interfaceLanguageSelect.value);
  applyLocale();
});

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-page-target]')) {
  button.addEventListener('click', () => selectPage(button.dataset.pageTarget ?? 'home'));
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-browser]')) {
  button.addEventListener('click', () => {
    const browser = button.dataset.browser;
    if (browser === 'chrome' || browser === 'edge') {
      void window.subTranslate.openExtensionsPage(browser);
    }
  });
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-open-extension]')) {
  button.addEventListener('click', () => void window.subTranslate.openExtensionFolder());
}
requiredButton('copy-diagnostics').addEventListener(
  'click',
  () => void window.subTranslate.copyDiagnostics(),
);
requiredButton('open-ollama-help').addEventListener(
  'click',
  () => void window.subTranslate.openOllamaDownload(),
);

window.subTranslate.onProgress((progressMessage) => {
  message.textContent = progressMessage;
});
window.subTranslate.onUpdateStatus(updateUpdatePanel);

applyLocale(false);
void refreshAll();
setInterval(() => void refreshStatus(), 5_000);
setInterval(() => void refreshControlPanel(), 20_000);

async function refreshAll(): Promise<void> {
  refreshButton.disabled = true;
  await Promise.all([refreshStatus(), refreshControlPanel(), refreshUpdateStatus()]);
  refreshButton.disabled = false;
}

async function refreshStatus(): Promise<void> {
  try {
    updateStatus(await window.subTranslate.getStatus());
  } catch (error) {
    message.textContent = errorMessage(error);
  }
}

function updateStatus(status: DesktopStatus): void {
  latestStatus = status;
  requiredElement('app-version').textContent = `v${status.version}`;
  setIndicator(
    'server-state',
    status.serverReady,
    translate(locale, status.serverReady ? 'serverReady' : 'serverStopped'),
  );
  setIndicator(
    'ollama-state',
    status.ollamaReachable,
    status.ollamaReachable
      ? translate(locale, 'ollamaConnected')
      : status.ollamaInstalled
        ? translate(locale, 'ollamaStarting')
        : translate(locale, 'ollamaMissing'),
  );
  setIndicator(
    'model-state',
    status.modelInstalled,
    translate(locale, status.modelInstalled ? 'modelReady' : 'modelMissing'),
  );
  const ready = status.serverReady && status.ollamaReachable && status.modelInstalled;
  setupButton.disabled = status.setupBusy;
  setupButton.textContent = ready
    ? translate(locale, 'setupComplete')
    : status.setupBusy
      ? translate(locale, 'setupRunning')
      : translate(locale, 'setupAction');
  setupButton.dataset.complete = String(ready);
  if (status.serverError) message.textContent = status.serverError;
  else if (ready && !status.setupBusy) {
    message.textContent = translate(locale, 'readyMessage');
  }
}

async function setupEverything(): Promise<void> {
  const accepted = window.confirm(translate(locale, 'setupConfirmation'));
  if (!accepted) return;
  setupButton.disabled = true;
  message.textContent = translate(locale, 'setupPreparing');
  const result = await window.subTranslate.setupEverything();
  if (!result.ok) message.textContent = result.error ?? translate(locale, 'setupImpossible');
  await refreshAll();
}

async function refreshControlPanel(): Promise<void> {
  try {
    updateControlPanel(await window.subTranslate.getControlPanel());
  } catch (error) {
    message.textContent = errorMessage(error);
  }
}

function updateControlPanel(state: ControlPanelState): void {
  systemLocale = state.systemLocale;
  if (!settingsDirty) {
    const nextLanguage = state.preferences.interfaceLanguage;
    const languageChanged = nextLanguage !== languagePreference;
    languagePreference = nextLanguage;
    interfaceLanguageSelect.value = nextLanguage;
    if (languageChanged) applyLocale(false);
    requiredCheckbox('automatic-updates').checked = state.preferences.automaticUpdates;
    requiredSelect('request-timeout').value = String(state.serverSettings.requestTimeoutMs);
    requiredSelect('max-retries').value = String(state.serverSettings.maxRetries);
    requiredSelect('memory-cache').value = String(state.serverSettings.memoryCacheEntries);
  }
  const stats = state.stats;
  requiredElement('stat-translated').textContent = String(stats?.translatedLines ?? '—');
  requiredElement('stat-cache').textContent = String(stats?.cacheEntries ?? '—');
  requiredElement('stat-hit-rate').textContent = stats
    ? `${Math.round(stats.cacheHitRate * 100)} %`
    : '—';
  requiredElement('stat-errors').textContent = String(stats?.errors ?? '—');
}

async function saveSettings(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  saveSettingsButton.disabled = true;
  try {
    const state = await window.subTranslate.saveControlPanel({
      automaticUpdates: requiredCheckbox('automatic-updates').checked,
      launchAtLogin: false,
      interfaceLanguage: interfaceLanguage(interfaceLanguageSelect.value),
      requestTimeoutMs: Number(requiredSelect('request-timeout').value),
      maxRetries: Number(requiredSelect('max-retries').value),
      memoryCacheEntries: Number(requiredSelect('memory-cache').value),
    });
    settingsDirty = false;
    updateControlPanel(state);
    settingsMessage.textContent = translate(locale, 'settingsSaved');
  } catch (error) {
    settingsMessage.textContent = errorMessage(error);
  } finally {
    saveSettingsButton.disabled = false;
  }
}

async function clearCache(): Promise<void> {
  if (!window.confirm(translate(locale, 'clearCacheConfirmation'))) return;
  clearCacheButton.disabled = true;
  const result = await window.subTranslate.clearCache();
  clearCacheButton.disabled = false;
  if (!result.ok) message.textContent = result.error ?? translate(locale, 'clearCacheImpossible');
  await refreshControlPanel();
}

async function refreshUpdateStatus(): Promise<void> {
  updateUpdatePanel(await window.subTranslate.getUpdateStatus());
}

async function checkForUpdates(): Promise<void> {
  checkUpdateButton.disabled = true;
  updateUpdatePanel(await window.subTranslate.checkForUpdates());
  checkUpdateButton.disabled = false;
}

function updateUpdatePanel(status: UpdateStatus): void {
  latestUpdateStatus = status;
  requiredElement('update-message').textContent = status.message;
  const progress = requiredElement('update-progress');
  progress.hidden = status.progressPercent === null;
  progress.setAttribute('value', String(status.progressPercent ?? 0));
  checkUpdateButton.disabled = status.phase === 'checking' || status.phase === 'downloading';
  checkUpdateButton.hidden = !status.supported;
  installUpdateButton.hidden = status.phase !== 'downloaded';
}

function selectPage(page: string): void {
  for (const element of document.querySelectorAll<HTMLElement>('[data-page]')) {
    element.hidden = element.dataset.page !== page;
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-page-target]')) {
    button.dataset.active = String(button.dataset.pageTarget === page);
  }
  document.querySelector<HTMLElement>('[data-page]:not([hidden])')?.focus();
}

function setIndicator(id: string, ready: boolean, label: string): void {
  const element = requiredElement(id);
  element.dataset.ready = String(ready);
  const text = element.querySelector('span');
  if (text) text.textContent = label;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(translate(locale, 'missingElement', { id }));
  return element;
}

function requiredButton(id: string): HTMLButtonElement {
  const element = requiredElement(id);
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(translate(locale, 'notButton', { id }));
  }
  return element;
}

function requiredCheckbox(id: string): HTMLInputElement {
  const element = requiredElement(id);
  if (!(element instanceof HTMLInputElement)) {
    throw new Error(translate(locale, 'notCheckbox', { id }));
  }
  return element;
}

function requiredSelect(id: string): HTMLSelectElement {
  const element = requiredElement(id);
  if (!(element instanceof HTMLSelectElement)) {
    throw new Error(translate(locale, 'notSelect', { id }));
  }
  return element;
}

function requiredForm(id: string): HTMLFormElement {
  const element = requiredElement(id);
  if (!(element instanceof HTMLFormElement)) {
    throw new Error(translate(locale, 'notForm', { id }));
  }
  return element;
}

function interfaceLanguage(value: string): InterfaceLanguage {
  return isInterfaceLanguage(value) ? value : 'auto';
}

function applyLocale(rerender = true): void {
  locale = resolveInterfaceLocale(languagePreference, systemLocale);
  document.documentElement.lang = locale;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (!['SCRIPT', 'STYLE'].includes(node.parentElement?.tagName ?? '')) {
      node.textContent = translateStaticText(locale, node.textContent ?? '');
    }
    node = walker.nextNode();
  }
  for (const element of document.querySelectorAll<HTMLElement>('[aria-label]')) {
    const label = element.getAttribute('aria-label');
    if (label) element.setAttribute('aria-label', translateStaticText(locale, label));
  }
  interfaceLanguageSelect.value = languagePreference;
  if (!rerender) return;
  if (latestStatus) updateStatus(latestStatus);
  if (latestUpdateStatus) updateUpdatePanel(latestUpdateStatus);
}
