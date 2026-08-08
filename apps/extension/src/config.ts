import type { ExtensionSettings, PlatformId } from "./types";

export const STORAGE_KEY = "dualSubtitlesSettings";
const CURRENT_SETTINGS_VERSION = 6;
const LATENCY_SETTINGS_VERSION = 2;

export const DEFAULT_EXTENSION_SETTINGS: ExtensionSettings = {
  settingsVersion: CURRENT_SETTINGS_VERSION,
  enabled: true,
  platforms: {
    youtube: true,
    netflix: true,
    primeVideo: true,
    canalPlus: true,
    appleTv: true,
    bilibili: true,
    generic: true,
  },
  serverUrl: "http://127.0.0.1:47831",
  languageOrder: "fr-first",
  subtitleDisplayMode: "both",
  fontSize: 30,
  verticalPosition: 10,
  backgroundOpacity: 0.62,
  textShadow: true,
  hideNativeSubtitles: false,
  debug: false,
  preloadEnabled: true,
  pauseOnInitialWarmup: true,
  debounceMs: 60,
  fragmentWindowMs: 120,
  reconnectIntervalMs: 15_000,
  requestTimeoutMs: 20_000,
  contextLineCount: 3,
};

export function mergeSettings(value?: Partial<ExtensionSettings> | null): ExtensionSettings {
  const needsLatencyMigration =
    (value?.settingsVersion ?? 0) < LATENCY_SETTINGS_VERSION &&
    value?.debounceMs === 180 &&
    value.fragmentWindowMs === 220;
  const needsTimeoutMigration =
    (value?.settingsVersion ?? 0) < LATENCY_SETTINGS_VERSION && value?.requestTimeoutMs === 60_000;
  return {
    ...DEFAULT_EXTENSION_SETTINGS,
    ...value,
    ...(needsLatencyMigration ? { debounceMs: 60, fragmentWindowMs: 120 } : {}),
    ...(needsTimeoutMigration ? { requestTimeoutMs: 20_000 } : {}),
    subtitleDisplayMode:
      value?.subtitleDisplayMode === "fr-only" || value?.subtitleDisplayMode === "zh-only"
        ? value.subtitleDisplayMode
        : "both",
    pauseOnInitialWarmup:
      typeof value?.pauseOnInitialWarmup === "boolean" ? value.pauseOnInitialWarmup : true,
    settingsVersion: CURRENT_SETTINGS_VERSION,
    platforms: {
      ...DEFAULT_EXTENSION_SETTINGS.platforms,
      ...value?.platforms,
    },
  };
}

export function isPlatformEnabled(settings: ExtensionSettings, platform: PlatformId): boolean {
  return settings.enabled && settings.platforms[platform];
}
