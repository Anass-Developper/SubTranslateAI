import { contextBridge, ipcRenderer } from 'electron';

import type {
  ControlPanelState,
  DesktopApi,
  DesktopStatus,
  InstallResult,
  SaveControlSettingsInput,
  UpdateStatus,
} from './contracts.js';

const api: DesktopApi = {
  getStatus: () => ipcRenderer.invoke('desktop:get-status') as Promise<DesktopStatus>,
  setupEverything: () => ipcRenderer.invoke('desktop:setup-everything') as Promise<InstallResult>,
  installModel: () => ipcRenderer.invoke('desktop:install-model') as Promise<InstallResult>,
  getControlPanel: () =>
    ipcRenderer.invoke('desktop:get-control-panel') as Promise<ControlPanelState>,
  saveControlPanel: (input: SaveControlSettingsInput) =>
    ipcRenderer.invoke('desktop:save-control-panel', input) as Promise<ControlPanelState>,
  clearCache: () => ipcRenderer.invoke('desktop:clear-cache') as Promise<InstallResult>,
  getUpdateStatus: () => ipcRenderer.invoke('desktop:get-update-status') as Promise<UpdateStatus>,
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-updates') as Promise<UpdateStatus>,
  installUpdate: () => ipcRenderer.invoke('desktop:install-update') as Promise<void>,
  openExtensionFolder: () => ipcRenderer.invoke('desktop:open-extension-folder') as Promise<void>,
  openExtensionsPage: (browser) =>
    ipcRenderer.invoke('desktop:open-extensions-page', browser) as Promise<void>,
  openOllamaDownload: () => ipcRenderer.invoke('desktop:open-ollama-download') as Promise<void>,
  copyDiagnostics: () => ipcRenderer.invoke('desktop:copy-diagnostics') as Promise<void>,
  onProgress(callback) {
    const listener = (_event: Electron.IpcRendererEvent, message: unknown): void => {
      if (typeof message === 'string') callback(message);
    };
    ipcRenderer.on('desktop:progress', listener);
    return () => ipcRenderer.removeListener('desktop:progress', listener);
  },
  onUpdateStatus(callback) {
    const listener = (_event: Electron.IpcRendererEvent, status: unknown): void => {
      if (typeof status === 'object' && status !== null) callback(status as UpdateStatus);
    };
    ipcRenderer.on('desktop:update-status', listener);
    return () => ipcRenderer.removeListener('desktop:update-status', listener);
  },
};

contextBridge.exposeInMainWorld('subTranslate', api);
