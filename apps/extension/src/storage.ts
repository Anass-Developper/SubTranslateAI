import { DEFAULT_EXTENSION_SETTINGS, STORAGE_KEY, mergeSettings } from "./config";
import type { ExtensionSettings } from "./types";

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

export async function loadSettings(): Promise<ExtensionSettings> {
  if (!hasChromeStorage()) {
    return mergeSettings();
  }

  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return mergeSettings(stored[STORAGE_KEY] as Partial<ExtensionSettings> | undefined);
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  if (!hasChromeStorage()) {
    return;
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: mergeSettings(settings) });
}

export async function updateSettings(
  patch: Partial<ExtensionSettings>,
): Promise<ExtensionSettings> {
  const current = await loadSettings();
  const next = mergeSettings({
    ...current,
    ...patch,
    platforms: patch.platforms ? { ...current.platforms, ...patch.platforms } : current.platforms,
  });
  await saveSettings(next);
  return next;
}

export async function ensureDefaultSettings(): Promise<void> {
  if (!hasChromeStorage()) {
    return;
  }
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  if (stored[STORAGE_KEY] === undefined) {
    await chrome.storage.local.set({ [STORAGE_KEY]: DEFAULT_EXTENSION_SETTINGS });
  }
}

export function subscribeToSettings(listener: (settings: ExtensionSettings) => void): () => void {
  if (!hasChromeStorage()) {
    return () => undefined;
  }

  const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
    const change = changes[STORAGE_KEY];
    if (area !== "local" || !change) {
      return;
    }
    listener(mergeSettings(change.newValue as Partial<ExtensionSettings>));
  };

  chrome.storage.onChanged.addListener(onChanged);
  return () => chrome.storage.onChanged.removeListener(onChanged);
}
