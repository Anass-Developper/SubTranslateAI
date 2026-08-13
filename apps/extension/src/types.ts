import type { Stats, TranslateRequest, TranslateResponse } from "@dual-subtitles/shared";
import type { BridgeCaptureStats } from "./tracks/track-capture";

export type PlatformId =
  "youtube" | "netflix" | "primeVideo" | "canalPlus" | "appleTv" | "bilibili" | "generic";

export type LanguageOrder = "fr-first" | "zh-first";
export type SubtitleDisplayMode = "both" | "fr-only" | "zh-only";
export type InterfaceLocale = "auto" | "fr" | "en";

export interface PlatformSettings {
  youtube: boolean;
  netflix: boolean;
  primeVideo: boolean;
  canalPlus: boolean;
  appleTv: boolean;
  bilibili: boolean;
  generic: boolean;
}

export interface ExtensionSettings {
  settingsVersion: number;
  enabled: boolean;
  platforms: PlatformSettings;
  serverUrl: string;
  interfaceLocale: InterfaceLocale;
  languageOrder: LanguageOrder;
  subtitleDisplayMode: SubtitleDisplayMode;
  fontSize: number;
  verticalPosition: number;
  backgroundOpacity: number;
  textShadow: boolean;
  hideNativeSubtitles: boolean;
  debug: boolean;
  preloadEnabled: boolean;
  pauseOnInitialWarmup: boolean;
  debounceMs: number;
  fragmentWindowMs: number;
  reconnectIntervalMs: number;
  requestTimeoutMs: number;
  contextLineCount: number;
}

export interface CandidateDiagnostic {
  selector: string;
  tagName: string;
  className: string;
  text: string;
  visible: boolean;
}

export interface SubtitleSnapshot {
  text: string;
  selector: string | null;
  candidates: CandidateDiagnostic[];
  capturedAt: number;
}

export interface DiagnosticReport {
  extensionVersion: string;
  platform: PlatformId;
  pageOrigin: string;
  pagePath: string;
  adapter: string;
  enabled: boolean;
  detectedText: string;
  selector: string | null;
  candidates: CandidateDiagnostic[];
  serverReachable: boolean | null;
  lastError: string | null;
  settings: {
    subtitleDisplayMode: SubtitleDisplayMode;
    preloadEnabled: boolean;
    pauseOnInitialWarmup: boolean;
    debounceMs: number;
    fragmentWindowMs: number;
    requestTimeoutMs: number;
    reconnectIntervalMs: number;
    contextLineCount: number;
    hideNativeSubtitles: boolean;
    debug: boolean;
  };
  snapshot: {
    capturedAt: string;
    ageMs: number;
    textLength: number;
  };
  pipeline: {
    currentTextPresent: boolean;
    requestInFlight: boolean;
    currentRequestAgeMs: number | null;
    observedCues: number;
    requestsStarted: number;
    completedTranslations: number;
    preloadedTranslations: number;
    cancelledRequests: number;
    failedRequests: number;
    lastRequestDurationMs: number | null;
    lastOutcome: "none" | "translated" | "preloaded" | "cancelled" | "error";
    lastErrorKind: string | null;
  };
  preload: {
    enabled: boolean;
    trackId: string | null;
    total: number;
    translated: number;
    inFlight: number;
    failed: number;
    pending: number;
    lastError: string | null;
    playbackTimeMs: number | null;
    currentCueId: string | null;
    currentCueStartMs: number | null;
    currentCueEndMs: number | null;
    cueOffsetMs: number | null;
  };
  capture?: {
    bridge: (BridgeCaptureStats & { receivedAt: number }) | null;
    tracks: Array<{
      trackId: string;
      cues: number;
      language?: string;
      label?: string;
      activeHint?: boolean;
    }>;
  };
  capturedAt: string;
}

export type ContentMessage =
  { type: "GET_DIAGNOSTICS" } | { type: "REFRESH_SETTINGS" } | { type: "TOGGLE_EXTENSION" };

export type TranslationRequest = TranslateRequest;
export type TranslationResponse = TranslateResponse;

export interface ServerStats extends Partial<Stats> {
  translated?: number;
  translatedLines?: number;
  cacheHits?: number;
  cached?: number;
  [key: string]: unknown;
}
