import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import { cpus, freemem, totalmem, uptime } from 'node:os';
import { join, resolve } from 'node:path';

import { DEFAULT_SERVER_SETTINGS, type ServerSettings, type Stats } from '@dual-subtitles/shared';
import { app, BrowserWindow, clipboard, ipcMain, shell } from 'electron';
import type { FastifyInstance } from 'fastify';

import { loadConfig } from '../../local-server/src/config.js';
import { buildServer } from '../../local-server/src/server.js';
import type {
  AppPreferences,
  ControlPanelState,
  DesktopStatus,
  EditableServerSettings,
  InstallResult,
  SaveControlSettingsInput,
  UpdateStatus,
} from './contracts.js';
import {
  downloadOllamaInstaller,
  runOllamaInstaller,
  verifyOllamaInstaller,
} from './ollama-installer.js';
import { disableOllamaLaunchAtLogin, stopOllamaProcesses } from './ollama-lifecycle.js';
import { ollamaModelNames } from './ollama-status.js';
import { DEFAULT_APP_PREFERENCES, readPreferences, writePreferences } from './preferences.js';
import { readUpdateUrl, UpdateManager } from './update-manager.js';

const MODEL = 'hf.co/tencent/Hy-MT2-7B-GGUF:Q4_K_M';
const OLLAMA_TAGS_URL = 'http://127.0.0.1:11434/api/tags';
const OLLAMA_PS_URL = 'http://127.0.0.1:11434/api/ps';
const OLLAMA_VERSION_URL = 'http://127.0.0.1:11434/api/version';
const SERVER_URL = 'http://127.0.0.1:47831';
const currentDirectory = __dirname;
const hiddenLaunch = process.argv.includes('--hidden');
const smokeTest = process.argv.includes('--smoke-test');
const smokePort = process.env.SUBTRANSLATE_SMOKE_PORT;
const smokeDataDirectory = process.env.SUBTRANSLATE_SMOKE_DATA_DIR;

if (smokeTest && smokePort && /^\d{2,5}$/u.test(smokePort)) {
  app.commandLine.appendSwitch('remote-debugging-port', smokePort);
}
if (smokeTest && smokeDataDirectory) {
  app.setPath('userData', smokeDataDirectory);
}

type SetupStage = 'download' | 'signature' | 'install' | 'start' | 'model';

interface SetupFailure {
  occurredAt: string;
  stage: SetupStage;
  message: string;
  technicalDetails: string;
}

let mainWindow: BrowserWindow | null = null;
let server: FastifyInstance | null = null;
let serverReady = false;
let serverError: string | null = null;
let serverTechnicalError: string | null = null;
let lastSetupError: SetupFailure | null = null;
let setupBusy = false;
let quitting = false;
let preferences: AppPreferences = { ...DEFAULT_APP_PREFERENCES };
let updateManager: UpdateManager | null = null;
let ollamaServerProcess: ChildProcess | null = null;

console.error(`[SubTranslateAI] Démarrage (Electron ${process.versions.electron}).`);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());
  void app
    .whenReady()
    .then(async () => {
      const storedPreferences = await readPreferences(preferencesPath());
      preferences = { ...storedPreferences, launchAtLogin: false };
      if (storedPreferences.launchAtLogin) await writePreferences(preferencesPath(), preferences);
      lastSetupError = await readLastSetupError();
      applyLoginPreference(false);
      await disableOllamaLaunchAtLogin();
      registerIpcHandlers();
      await syncExtensionFiles();
      await startServer();
      createWindow();
      await initializeUpdates();
      void ensureOllamaRunning(false);
      if (preferences.automaticUpdates) {
        setTimeout(() => void updateManager?.check(), 5_000);
      }
    })
    .catch((error: unknown) => {
      console.error('[SubTranslateAI] Initialisation impossible.', error);
      serverError = error instanceof Error ? error.message : String(error);
    });
}

app.on('window-all-closed', () => void shutdown());

async function startServer(): Promise<void> {
  const config = loadConfig({
    ...process.env,
    OPENCODE_GO_API_KEY: '',
    TRANSLATION_PROVIDER: 'ollama',
    OLLAMA_ENDPOINT: 'http://127.0.0.1:11434/api/chat',
    OLLAMA_MODEL: MODEL,
    OLLAMA_MODEL_TYPE: 'hy-mt',
    OLLAMA_CONCURRENCY: '2',
    DATABASE_PATH: join(app.getPath('userData'), 'subtitles.db'),
    LOG_LEVEL: 'warn',
    PORT: '47831',
    REQUEST_TIMEOUT_MS: '45000',
  });

  try {
    server = await buildServer({ config });
    await server.listen({ host: config.host, port: config.port });
    serverReady = true;
    serverError = null;
    serverTechnicalError = null;
  } catch (error) {
    console.error("[SubTranslateAI] Le serveur local n'a pas pu démarrer.", error);
    serverTechnicalError = error instanceof Error ? (error.stack ?? error.message) : String(error);
    if (await existingServerIsHealthy()) {
      server = null;
      serverReady = true;
      serverError = 'Un serveur SubTranslateAI déjà lancé est réutilisé.';
      return;
    }
    serverError =
      'Le serveur local n’a pas pu démarrer. Ouvre Aide puis copie le diagnostic pour obtenir les détails.';
    if (server) await server.close().catch(() => undefined);
    server = null;
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1_020,
    height: 780,
    minWidth: 760,
    minHeight: 640,
    show: false,
    backgroundColor: '#07111f',
    title: 'SubTranslateAI',
    icon: join(currentDirectory, 'icon.png'),
    webPreferences: {
      preload: join(currentDirectory, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.once('ready-to-show', () => {
    if (!hiddenLaunch) mainWindow?.show();
  });
  mainWindow.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    void shutdown();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  void mainWindow.loadFile(join(currentDirectory, 'index.html'));
}

function showMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function registerIpcHandlers(): void {
  ipcMain.handle('desktop:get-status', async (): Promise<DesktopStatus> => getStatus());
  ipcMain.handle('desktop:setup-everything', async (): Promise<InstallResult> => setupEverything());
  ipcMain.handle('desktop:install-model', async (): Promise<InstallResult> => installModel());
  ipcMain.handle('desktop:get-control-panel', async (): Promise<ControlPanelState> =>
    getControlPanel(),
  );
  ipcMain.handle(
    'desktop:save-control-panel',
    async (_event, input: unknown): Promise<ControlPanelState> => saveControlPanel(input),
  );
  ipcMain.handle('desktop:clear-cache', async (): Promise<InstallResult> => clearCache());
  ipcMain.handle('desktop:get-update-status', (): UpdateStatus => updateStatus());
  ipcMain.handle('desktop:check-updates', async (): Promise<UpdateStatus> => {
    return (await updateManager?.check(true)) ?? updateStatus();
  });
  ipcMain.handle('desktop:install-update', () => updateManager?.install());
  ipcMain.handle('desktop:open-extension-folder', async () => shell.openPath(extensionPath()));
  ipcMain.handle('desktop:open-extensions-page', async (_event, browser: unknown) => {
    if (browser === 'chrome' || browser === 'edge') await openExtensionsPage(browser);
  });
  ipcMain.handle('desktop:open-ollama-download', async () => {
    await shell.openExternal('https://ollama.com/download/windows');
  });
  ipcMain.handle('desktop:copy-diagnostics', async () => copyDiagnostics());
}

async function initializeUpdates(): Promise<void> {
  const updateUrl = await readUpdateUrl(join(currentDirectory, 'update-config.json'));
  updateManager = new UpdateManager({
    currentVersion: app.getVersion(),
    updateUrl,
    packaged: app.isPackaged,
    notify: (status) => mainWindow?.webContents.send('desktop:update-status', status),
  });
  updateManager.setEnabled(preferences.automaticUpdates);
}

async function getStatus(): Promise<DesktopStatus> {
  const ollamaExecutable = findOllamaExecutable();
  const tags = await fetchOllamaTags();
  return {
    serverReady,
    serverError,
    ollamaReachable: tags !== null,
    ollamaInstalled: ollamaExecutable !== null,
    modelInstalled: tags?.some((name) => name === MODEL) ?? false,
    model: MODEL,
    extensionPath: extensionPath(),
    version: app.getVersion(),
    setupBusy,
  };
}

async function setupEverything(): Promise<InstallResult> {
  if (setupBusy) return { ok: false, error: 'Une installation est déjà en cours.' };
  setupBusy = true;
  let stage: SetupStage = 'download';
  try {
    let executable = findOllamaExecutable();
    if (!executable) {
      sendProgress('Téléchargement officiel d’Ollama…');
      const installerPath = join(app.getPath('temp'), 'SubTranslateAI-OllamaSetup.exe');
      try {
        await downloadOllamaInstaller(installerPath, (percent) => {
          sendProgress(
            percent === null
              ? 'Téléchargement officiel d’Ollama…'
              : `Téléchargement d’Ollama : ${Math.round(percent)} %`,
          );
        });
        stage = 'signature';
        sendProgress('Vérification de la signature numérique d’Ollama…');
        await verifyOllamaInstaller(installerPath);
        stage = 'install';
        sendProgress('Installation d’Ollama dans ton profil Windows…');
        await runOllamaInstaller(installerPath);
        await disableOllamaLaunchAtLogin();
      } finally {
        await rm(installerPath, { force: true }).catch(() => undefined);
      }
      executable = await waitForOllamaExecutable(90_000);
      if (!executable)
        throw new Error('Ollama a été installé, mais son exécutable reste introuvable.');
    }
    stage = 'start';
    await ensureOllamaRunning(true);
    stage = 'model';
    await pullModel(executable);
    lastSetupError = null;
    await rm(setupErrorPath(), { force: true }).catch(() => undefined);
    sendProgress('Installation terminée. SubTranslateAI est prêt.');
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const occurredAt = new Date().toISOString();
    lastSetupError = {
      occurredAt,
      stage,
      message: message.slice(0, 300),
      technicalDetails: readableDiagnosticError(error),
    };
    // Persist only a fixed summary. Network and process errors can contain local paths,
    // URLs or upstream text; their bounded details remain in memory until the app exits.
    const persistedFailure: SetupFailure = {
      occurredAt,
      stage,
      message: setupFailureSummary(stage),
      technicalDetails: 'Les détails techniques n’ont pas été conservés sur le disque.',
    };
    await writeFile(
      setupErrorPath(),
      `${JSON.stringify(persistedFailure, null, 2)}\n`,
      'utf8',
    ).catch(() => undefined);
    sendProgress(message);
    return { ok: false, error: message };
  } finally {
    setupBusy = false;
  }
}

async function installModel(): Promise<InstallResult> {
  const executable = findOllamaExecutable();
  if (!executable) return setupEverything();
  if (setupBusy) return { ok: false, error: 'Une installation est déjà en cours.' };
  setupBusy = true;
  try {
    await ensureOllamaRunning(true);
    await pullModel(executable);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendProgress(message);
    return { ok: false, error: message };
  } finally {
    setupBusy = false;
  }
}

async function pullModel(executable: string): Promise<void> {
  const tags = await fetchOllamaTags();
  if (tags?.includes(MODEL)) {
    sendProgress('Hy‑MT2‑7B est déjà installé.');
    return;
  }
  sendProgress('Téléchargement de Hy‑MT2‑7B (environ 4,6 Go)…');
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(executable, ['pull', MODEL], {
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', () => sendProgress('Téléchargement de Hy‑MT2‑7B en cours…'));
    child.stderr.on('data', (chunk: Buffer) => {
      const match = chunk.toString('utf8').match(/(\d{1,3})%/u);
      sendProgress(
        match ? `Téléchargement de Hy‑MT2‑7B : ${match[1]} %` : 'Vérification du modèle…',
      );
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`Ollama s’est arrêté avec le code ${code ?? 'inconnu'}.`));
    });
  });
  sendProgress('Hy‑MT2‑7B est prêt.');
}

async function ensureOllamaRunning(required: boolean): Promise<boolean> {
  if ((await fetchOllamaTags()) !== null) return true;
  const executable = findOllamaExecutable();
  if (!executable) {
    if (required) throw new Error('Ollama n’est pas installé.');
    return false;
  }
  sendProgress('Démarrage du moteur Ollama…');
  const child = spawn(executable, ['serve'], {
    detached: false,
    windowsHide: true,
    shell: false,
    stdio: 'ignore',
  });
  ollamaServerProcess = child;
  const stoppedBeforeReady = new Promise<boolean>((resolvePromise) => {
    child.once('error', (error) => {
      if (ollamaServerProcess === child) ollamaServerProcess = null;
      console.error('[SubTranslateAI] Ollama could not start.', error);
      resolvePromise(false);
    });
    child.once('exit', () => {
      if (ollamaServerProcess === child) ollamaServerProcess = null;
      resolvePromise(false);
    });
  });
  const ready = await Promise.race([waitForOllama(45_000), stoppedBeforeReady]);
  if (!ready && required) throw new Error('Ollama est installé, mais son service ne démarre pas.');
  return ready;
}

async function fetchOllamaTags(): Promise<string[] | null> {
  try {
    const response = await fetch(OLLAMA_TAGS_URL, { signal: AbortSignal.timeout(2_500) });
    if (!response.ok) return null;
    return ollamaModelNames(await response.json());
  } catch {
    return null;
  }
}

async function waitForOllama(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await fetchOllamaTags()) !== null) return true;
    await delay(1_000);
  }
  return false;
}

async function waitForOllamaExecutable(timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const executable = findOllamaExecutable();
    if (executable) return executable;
    await delay(1_000);
  }
  return null;
}

function findOllamaExecutable(): string | null {
  const localAppData = process.env.LOCALAPPDATA;
  const candidates = [
    localAppData ? join(localAppData, 'Programs', 'Ollama', 'ollama.exe') : null,
    ...(process.env.PATH ?? '')
      .split(';')
      .filter(Boolean)
      .map((entry) => join(entry, 'ollama.exe')),
  ];
  return (
    candidates.find((candidate): candidate is string =>
      Boolean(candidate && existsSync(candidate)),
    ) ?? null
  );
}

async function getControlPanel(): Promise<ControlPanelState> {
  const [serverSettings, stats] = await Promise.all([fetchServerSettings(), fetchStats()]);
  return {
    preferences: { ...preferences },
    serverSettings: editableServerSettings(serverSettings),
    stats: stats
      ? {
          translatedLines: stats.translatedLines,
          cacheHits: stats.cacheHits,
          errors: stats.errors,
          cacheEntries: stats.cacheEntries,
          cacheHitRate: stats.cacheHitRate,
        }
      : null,
  };
}

async function saveControlPanel(input: unknown): Promise<ControlPanelState> {
  const next = validateControlInput(input);
  preferences = {
    automaticUpdates: next.automaticUpdates,
    launchAtLogin: false,
  };
  await writePreferences(preferencesPath(), preferences);
  applyLoginPreference(false);
  updateManager?.setEnabled(preferences.automaticUpdates);
  await serverRequest('/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      requestTimeoutMs: next.requestTimeoutMs,
      maxRetries: next.maxRetries,
      memoryCacheEntries: next.memoryCacheEntries,
    }),
  });
  sendProgress('Réglages enregistrés.');
  return getControlPanel();
}

function validateControlInput(value: unknown): SaveControlSettingsInput {
  if (typeof value !== 'object' || value === null) throw new Error('Réglages invalides.');
  const input = value as Partial<SaveControlSettingsInput>;
  if (typeof input.automaticUpdates !== 'boolean' || typeof input.launchAtLogin !== 'boolean') {
    throw new Error('Options de démarrage invalides.');
  }
  return {
    automaticUpdates: input.automaticUpdates,
    launchAtLogin: input.launchAtLogin,
    requestTimeoutMs: boundedInteger(input.requestTimeoutMs, 5_000, 120_000),
    maxRetries: boundedInteger(input.maxRetries, 0, 5),
    memoryCacheEntries: boundedInteger(input.memoryCacheEntries, 100, 20_000),
  };
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Valeur attendue entre ${minimum} et ${maximum}.`);
  }
  return value;
}

async function fetchServerSettings(): Promise<ServerSettings> {
  try {
    return (await serverRequest('/settings')) as ServerSettings;
  } catch {
    return { ...DEFAULT_SERVER_SETTINGS };
  }
}

async function fetchStats(): Promise<Stats | null> {
  try {
    return (await serverRequest('/stats')) as Stats;
  } catch {
    return null;
  }
}

function editableServerSettings(settings: ServerSettings): EditableServerSettings {
  return {
    requestTimeoutMs: settings.requestTimeoutMs,
    maxRetries: settings.maxRetries,
    memoryCacheEntries: settings.memoryCacheEntries,
  };
}

async function clearCache(): Promise<InstallResult> {
  try {
    const result = (await serverRequest('/cache', { method: 'DELETE' })) as { cleared?: unknown };
    const cleared = typeof result.cleared === 'number' ? result.cleared : 0;
    sendProgress(`Cache vidé : ${cleared} traduction(s) supprimée(s).`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function serverRequest(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${SERVER_URL}${path}`, {
    ...init,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Le serveur local a répondu HTTP ${response.status}.`);
  return response.json();
}

async function copyDiagnostics(): Promise<void> {
  const [status, controls, serverStats, ollamaRuntime, gpu] = await Promise.all([
    getStatus(),
    getControlPanel(),
    fetchStats(),
    getOllamaRuntimeDiagnostics(),
    app.getGPUInfo('basic').catch((error: unknown) => ({
      error: error instanceof Error ? error.message : String(error),
    })),
  ]);
  const processors = cpus();
  clipboard.writeText(
    JSON.stringify(
      {
        app: 'SubTranslateAI',
        diagnosticFormatVersion: 2,
        generatedAt: new Date().toISOString(),
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        electron: process.versions.electron,
        system: {
          cpuModel: processors[0]?.model ?? null,
          logicalProcessors: processors.length,
          totalMemoryBytes: totalmem(),
          freeMemoryBytes: freemem(),
          systemUptimeSeconds: Math.floor(uptime()),
          gpu,
        },
        status,
        ollamaRuntime,
        serverTechnicalError,
        lastSetupError,
        update: updateStatus(),
        settings: controls.serverSettings,
        stats: serverStats ?? controls.stats,
      },
      null,
      2,
    ),
  );
  sendProgress('Diagnostic copié dans le presse-papiers.');
}

async function getOllamaRuntimeDiagnostics(): Promise<unknown> {
  const [versionResult, processesResult] = await Promise.allSettled([
    fetchLocalJson(OLLAMA_VERSION_URL),
    fetchLocalJson(OLLAMA_PS_URL),
  ]);
  return {
    version:
      versionResult.status === 'fulfilled' ? stringProperty(versionResult.value, 'version') : null,
    loadedModels:
      processesResult.status === 'fulfilled' ? sanitizeLoadedModels(processesResult.value) : [],
    versionError:
      versionResult.status === 'rejected' ? readableDiagnosticError(versionResult.reason) : null,
    processesError:
      processesResult.status === 'rejected'
        ? readableDiagnosticError(processesResult.reason)
        : null,
  };
}

async function fetchLocalJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(2_500) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function sanitizeLoadedModels(payload: unknown): unknown[] {
  if (typeof payload !== 'object' || payload === null) return [];
  const models = (payload as { models?: unknown }).models;
  if (!Array.isArray(models)) return [];
  return models.slice(0, 10).map((entry) => {
    const model =
      typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {};
    const details =
      typeof model.details === 'object' && model.details !== null
        ? (model.details as Record<string, unknown>)
        : {};
    return {
      name: typeof model.name === 'string' ? model.name : null,
      sizeBytes: finiteNumber(model.size),
      vramBytes: finiteNumber(model.size_vram),
      expiresAt: typeof model.expires_at === 'string' ? model.expires_at : null,
      family: typeof details.family === 'string' ? details.family : null,
      parameterSize: typeof details.parameter_size === 'string' ? details.parameter_size : null,
      quantization:
        typeof details.quantization_level === 'string' ? details.quantization_level : null,
    };
  });
}

function stringProperty(value: unknown, key: string): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const property = (value as Record<string, unknown>)[key];
  return typeof property === 'string' ? property : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readableDiagnosticError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

function setupFailureSummary(stage: SetupStage): string {
  const summaries: Record<SetupStage, string> = {
    download: 'Le téléchargement d’Ollama a échoué.',
    signature: 'La vérification de la signature d’Ollama a échoué.',
    install: 'L’installation d’Ollama a échoué.',
    start: 'Le démarrage d’Ollama a échoué.',
    model: 'L’installation du modèle Hy-MT2 a échoué.',
  };
  return summaries[stage];
}

async function openExtensionsPage(browser: 'chrome' | 'edge'): Promise<void> {
  const executable = findBrowserExecutable(browser);
  const url = browser === 'chrome' ? 'chrome://extensions' : 'edge://extensions';
  if (!executable) {
    clipboard.writeText(url);
    sendProgress(`${url} copié. Colle cette adresse dans ton navigateur.`);
    return;
  }
  spawn(executable, [url], { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
}

function findBrowserExecutable(browser: 'chrome' | 'edge'): string | null {
  const programFiles = [
    process.env.PROGRAMFILES,
    process.env['PROGRAMFILES(X86)'],
    process.env.LOCALAPPDATA,
  ];
  const relative =
    browser === 'chrome'
      ? join('Google', 'Chrome', 'Application', 'chrome.exe')
      : join('Microsoft', 'Edge', 'Application', 'msedge.exe');
  return (
    programFiles
      .filter((entry): entry is string => Boolean(entry))
      .map((entry) => join(entry, relative))
      .find(existsSync) ?? null
  );
}

function applyLoginPreference(enabled: boolean): void {
  if (!app.isPackaged || smokeTest) return;
  app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
}

function preferencesPath(): string {
  return join(app.getPath('userData'), 'preferences.json');
}

function setupErrorPath(): string {
  return join(app.getPath('userData'), 'last-setup-error.json');
}

async function readLastSetupError(): Promise<SetupFailure | null> {
  try {
    const value = JSON.parse(await readFile(setupErrorPath(), 'utf8')) as Partial<SetupFailure>;
    if (
      typeof value.occurredAt !== 'string' ||
      !['download', 'signature', 'install', 'start', 'model'].includes(value.stage ?? '') ||
      typeof value.message !== 'string' ||
      typeof value.technicalDetails !== 'string'
    ) {
      return null;
    }
    return value as SetupFailure;
  } catch {
    return null;
  }
}

function extensionPath(): string {
  return join(app.getPath('userData'), 'extension');
}

function bundledExtensionPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'extension')
    : resolve(app.getAppPath(), '../extension/dist');
}

async function syncExtensionFiles(): Promise<void> {
  await cp(bundledExtensionPath(), extensionPath(), { recursive: true, force: true });
}

function sendProgress(message: string): void {
  mainWindow?.webContents.send('desktop:progress', message);
}

function updateStatus(): UpdateStatus {
  return (
    updateManager?.getStatus() ?? {
      supported: false,
      phase: 'disabled',
      currentVersion: app.getVersion(),
      availableVersion: null,
      progressPercent: null,
      message: 'Mises à jour non initialisées.',
    }
  );
}

async function existingServerIsHealthy(): Promise<boolean> {
  try {
    const response = await fetch(`${SERVER_URL}/health`, { signal: AbortSignal.timeout(1_500) });
    return response.ok;
  } catch {
    return false;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function shutdown(): Promise<void> {
  if (quitting) return;
  quitting = true;
  if (server) await server.close().catch(() => undefined);
  if (ollamaServerProcess && !ollamaServerProcess.killed) ollamaServerProcess.kill();
  await stopOllamaProcesses(findOllamaExecutable(), MODEL);
  ollamaServerProcess = null;
  app.quit();
}
