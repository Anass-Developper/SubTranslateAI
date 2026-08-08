import type { ControlPanelState, DesktopStatus, UpdateStatus } from './contracts.js';

const message = requiredElement('global-message');
const setupButton = requiredButton('setup-everything');
const extensionButton = requiredButton('open-extension');
const refreshButton = requiredButton('refresh');
const checkUpdateButton = requiredButton('check-update');
const installUpdateButton = requiredButton('install-update');
const saveSettingsButton = requiredButton('save-settings');
const clearCacheButton = requiredButton('clear-cache');
const settingsForm = requiredForm('settings-form');
const settingsMessage = requiredElement('settings-message');
let settingsDirty = false;

setupButton.addEventListener('click', () => void setupEverything());
extensionButton.addEventListener('click', () => void window.subTranslate.openExtensionFolder());
refreshButton.addEventListener('click', () => void refreshAll());
checkUpdateButton.addEventListener('click', () => void checkForUpdates());
installUpdateButton.addEventListener('click', () => void window.subTranslate.installUpdate());
clearCacheButton.addEventListener('click', () => void clearCache());
settingsForm.addEventListener('submit', (event) => void saveSettings(event));
settingsForm.addEventListener('change', () => {
  settingsDirty = true;
  settingsMessage.textContent = 'Modifications non enregistrées.';
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
  requiredElement('app-version').textContent = `v${status.version}`;
  setIndicator(
    'server-state',
    status.serverReady,
    status.serverReady ? 'Serveur prêt' : 'Serveur arrêté',
  );
  setIndicator(
    'ollama-state',
    status.ollamaReachable,
    status.ollamaReachable
      ? 'Ollama connecté'
      : status.ollamaInstalled
        ? 'Ollama installé — démarrage…'
        : 'Ollama à installer',
  );
  setIndicator(
    'model-state',
    status.modelInstalled,
    status.modelInstalled ? 'Hy‑MT2‑7B prêt' : 'Hy‑MT2‑7B à télécharger',
  );
  const ready = status.serverReady && status.ollamaReachable && status.modelInstalled;
  setupButton.disabled = status.setupBusy;
  setupButton.textContent = ready
    ? 'Tout est installé ✓'
    : status.setupBusy
      ? 'Installation en cours…'
      : 'Tout installer automatiquement';
  setupButton.dataset.complete = String(ready);
  if (status.serverError) message.textContent = status.serverError;
  else if (ready && !status.setupBusy) {
    message.textContent = 'Tout est prêt. Laisse SubTranslateAI ouvert pendant la vidéo.';
  }
}

async function setupEverything(): Promise<void> {
  const accepted = window.confirm(
    'SubTranslateAI va installer Ollama depuis son site officiel puis télécharger Hy‑MT2‑7B (environ 4,6 Go). Continuer ?',
  );
  if (!accepted) return;
  setupButton.disabled = true;
  message.textContent = 'Préparation de l’installation…';
  const result = await window.subTranslate.setupEverything();
  if (!result.ok) message.textContent = result.error ?? 'Installation impossible.';
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
  if (!settingsDirty) {
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
      requestTimeoutMs: Number(requiredSelect('request-timeout').value),
      maxRetries: Number(requiredSelect('max-retries').value),
      memoryCacheEntries: Number(requiredSelect('memory-cache').value),
    });
    settingsDirty = false;
    updateControlPanel(state);
    settingsMessage.textContent = 'Réglages enregistrés.';
  } catch (error) {
    settingsMessage.textContent = errorMessage(error);
  } finally {
    saveSettingsButton.disabled = false;
  }
}

async function clearCache(): Promise<void> {
  if (!window.confirm('Supprimer toutes les traductions mémorisées localement ?')) return;
  clearCacheButton.disabled = true;
  const result = await window.subTranslate.clearCache();
  clearCacheButton.disabled = false;
  if (!result.ok) message.textContent = result.error ?? 'Impossible de vider le cache.';
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
  if (!element) throw new Error(`Élément #${id} manquant.`);
  return element;
}

function requiredButton(id: string): HTMLButtonElement {
  const element = requiredElement(id);
  if (!(element instanceof HTMLButtonElement)) throw new Error(`#${id} n’est pas un bouton.`);
  return element;
}

function requiredCheckbox(id: string): HTMLInputElement {
  const element = requiredElement(id);
  if (!(element instanceof HTMLInputElement)) throw new Error(`#${id} n’est pas une case.`);
  return element;
}

function requiredSelect(id: string): HTMLSelectElement {
  const element = requiredElement(id);
  if (!(element instanceof HTMLSelectElement)) throw new Error(`#${id} n’est pas une liste.`);
  return element;
}

function requiredForm(id: string): HTMLFormElement {
  const element = requiredElement(id);
  if (!(element instanceof HTMLFormElement)) throw new Error(`#${id} n’est pas un formulaire.`);
  return element;
}
