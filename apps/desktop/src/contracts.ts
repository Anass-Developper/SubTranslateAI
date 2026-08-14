import type { InterfaceLanguage, InterfaceLocale } from './i18n.js';

export interface DesktopStatus {
  serverReady: boolean;
  serverError: string | null;
  ollamaReachable: boolean;
  ollamaInstalled: boolean;
  modelInstalled: boolean;
  model: string;
  extensionPath: string;
  version: string;
  setupBusy: boolean;
}

export interface InstallResult {
  ok: boolean;
  error?: string;
}

export interface AppPreferences {
  automaticUpdates: boolean;
  launchAtLogin: boolean;
  interfaceLanguage: InterfaceLanguage;
}

export interface EditableServerSettings {
  requestTimeoutMs: number;
  maxRetries: number;
  memoryCacheEntries: number;
}

export interface ControlPanelState {
  preferences: AppPreferences;
  systemLocale: InterfaceLocale;
  serverSettings: EditableServerSettings;
  stats: {
    translatedLines: number;
    cacheHits: number;
    errors: number;
    cacheEntries: number;
    cacheHitRate: number;
  } | null;
}

export type UpdatePhase =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'error';

export interface UpdateStatus {
  supported: boolean;
  phase: UpdatePhase;
  currentVersion: string;
  availableVersion: string | null;
  progressPercent: number | null;
  message: string;
}

export interface SaveControlSettingsInput {
  automaticUpdates: boolean;
  launchAtLogin: boolean;
  interfaceLanguage: InterfaceLanguage;
  requestTimeoutMs: number;
  maxRetries: number;
  memoryCacheEntries: number;
}

export interface DesktopApi {
  getStatus(): Promise<DesktopStatus>;
  setupEverything(): Promise<InstallResult>;
  installModel(): Promise<InstallResult>;
  getControlPanel(): Promise<ControlPanelState>;
  saveControlPanel(input: SaveControlSettingsInput): Promise<ControlPanelState>;
  clearCache(): Promise<InstallResult>;
  getUpdateStatus(): Promise<UpdateStatus>;
  checkForUpdates(): Promise<UpdateStatus>;
  installUpdate(): Promise<void>;
  openExtensionFolder(): Promise<void>;
  openExtensionsPage(browser: 'chrome' | 'edge'): Promise<void>;
  openOllamaDownload(): Promise<void>;
  copyDiagnostics(): Promise<void>;
  onProgress(callback: (message: string) => void): () => void;
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
}
