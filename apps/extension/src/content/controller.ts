import { createSubtitleAdapter } from "../adapters/factory";
import type { SubtitleAdapter } from "../adapters/types";
import { isPlatformEnabled } from "../config";
import { SubtitlePipeline } from "../core/subtitle-pipeline";
import { normalizeDetectedText } from "../core/text";
import { loadSettings, saveSettings, subscribeToSettings } from "../storage";
import type {
  ContentMessage,
  DiagnosticReport,
  ExtensionSettings,
  SubtitleSnapshot,
} from "../types";
import { SubtitleOverlay } from "../ui/overlay";
import { NativeSubtitleHider } from "./native-subtitle-hider";
import { SpaNavigationWatcher } from "./navigation";
import { SubtitlePreloadCoordinator } from "./subtitle-preload-coordinator";

export class ContentController {
  private settings: ExtensionSettings | null = null;
  private adapter: SubtitleAdapter | null = null;
  private adapterStarted = false;
  private pipeline: SubtitlePipeline | null = null;
  private preload: SubtitlePreloadCoordinator | null = null;
  private overlay: SubtitleOverlay | null = null;
  private readonly hider = new NativeSubtitleHider();
  private navigationWatcher: SpaNavigationWatcher | null = null;
  private unsubscribeSettings: (() => void) | null = null;
  private latestSnapshot: SubtitleSnapshot = {
    text: "",
    selector: null,
    candidates: [],
    capturedAt: Date.now(),
  };
  private serverReachable: boolean | null = null;
  private lastError: string | null = null;

  async start(): Promise<void> {
    this.settings = await loadSettings();
    this.overlay = new SubtitleOverlay();
    this.overlay.mount();
    this.overlay.applySettings(this.settings);
    this.pipeline = this.createPipeline(this.settings);
    this.adapter = createSubtitleAdapter();
    this.preload = new SubtitlePreloadCoordinator(this.settings, {
      onTranslation: (text, response) => {
        if (normalizeDetectedText(this.latestSnapshot.text) === text) {
          this.pipeline?.acceptPreloaded(text, response);
        }
      },
      onStatusChange: () => this.refreshDiagnostics(),
    });
    this.preload.start(this.adapter.platform);

    this.unsubscribeSettings = subscribeToSettings((settings) => this.applySettings(settings));
    this.navigationWatcher = new SpaNavigationWatcher(() => this.handleNavigation());
    this.navigationWatcher.start();
    chrome.runtime.onMessage.addListener(this.runtimeMessageListener);
    this.applySettings(this.settings);
  }

  stop(): void {
    this.stopAdapter();
    this.pipeline?.dispose();
    this.pipeline = null;
    this.preload?.stop();
    this.preload = null;
    this.overlay?.destroy();
    this.overlay = null;
    this.hider.clear();
    this.navigationWatcher?.stop();
    this.navigationWatcher = null;
    this.unsubscribeSettings?.();
    this.unsubscribeSettings = null;
    chrome.runtime.onMessage.removeListener(this.runtimeMessageListener);
  }

  getDiagnostics(): DiagnosticReport {
    const preload = this.preload?.getStatus() ?? {
      enabled: this.settings?.preloadEnabled ?? false,
      trackId: null,
      total: 0,
      translated: 0,
      inFlight: 0,
      failed: 0,
      pending: 0,
      lastError: null,
      playbackTimeMs: null,
      currentCueId: null,
      currentCueStartMs: null,
      currentCueEndMs: null,
      cueOffsetMs: null,
    };
    const settings = this.settings;
    const snapshotAgeMs = Math.max(0, Date.now() - this.latestSnapshot.capturedAt);
    return {
      extensionVersion: chrome.runtime.getManifest().version,
      platform: this.adapter?.platform ?? "generic",
      pageOrigin: window.location.origin,
      pagePath: window.location.pathname,
      adapter: this.adapter?.name ?? "aucun",
      enabled: Boolean(
        this.settings && this.adapter && isPlatformEnabled(this.settings, this.adapter.platform),
      ),
      detectedText: this.latestSnapshot.text,
      selector: this.latestSnapshot.selector,
      candidates: this.latestSnapshot.candidates,
      serverReachable: this.serverReachable,
      lastError: this.lastError,
      settings: {
        preloadEnabled: settings?.preloadEnabled ?? false,
        debounceMs: settings?.debounceMs ?? 0,
        fragmentWindowMs: settings?.fragmentWindowMs ?? 0,
        requestTimeoutMs: settings?.requestTimeoutMs ?? 0,
        reconnectIntervalMs: settings?.reconnectIntervalMs ?? 0,
        contextLineCount: settings?.contextLineCount ?? 0,
        hideNativeSubtitles: settings?.hideNativeSubtitles ?? false,
        debug: settings?.debug ?? false,
      },
      snapshot: {
        capturedAt: new Date(this.latestSnapshot.capturedAt).toISOString(),
        ageMs: snapshotAgeMs,
        textLength: this.latestSnapshot.text.length,
      },
      pipeline: this.pipeline?.getDiagnostics() ?? {
        currentTextPresent: false,
        requestInFlight: false,
        currentRequestAgeMs: null,
        observedCues: 0,
        requestsStarted: 0,
        completedTranslations: 0,
        preloadedTranslations: 0,
        cancelledRequests: 0,
        failedRequests: 0,
        lastRequestDurationMs: null,
        lastOutcome: "none",
        lastErrorKind: null,
      },
      preload,
      capture: this.preload?.getCaptureDiagnostics() ?? { bridge: null, tracks: [] },
      capturedAt: new Date().toISOString(),
    };
  }

  private readonly runtimeMessageListener = (
    message: ContentMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): boolean => {
    if (message.type === "GET_DIAGNOSTICS") {
      sendResponse(this.getDiagnostics());
      return false;
    }
    if (message.type === "REFRESH_SETTINGS") {
      void loadSettings().then((settings) => this.applySettings(settings));
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "TOGGLE_EXTENSION") {
      void this.toggleEnabled();
      sendResponse({ ok: true });
    }
    return false;
  };

  private createPipeline(settings: ExtensionSettings): SubtitlePipeline {
    return new SubtitlePipeline(settings, {
      onPending: (text, hint) => {
        this.lastError = null;
        this.overlay?.showPendingSource(text, hint);
      },
      onTranslation: (response) => {
        this.lastError = null;
        this.serverReachable = true;
        this.overlay?.showTranslation(response);
        this.refreshDiagnostics();
      },
      onEmpty: () => {
        this.lastError = null;
        this.overlay?.clearText();
        this.overlay?.setStatus("");
        this.refreshDiagnostics();
      },
      onError: (message) => {
        this.lastError = message;
        this.overlay?.setStatus(message);
        this.refreshDiagnostics();
      },
      onServerState: (reachable) => {
        this.serverReachable = reachable;
        if (reachable && this.lastError === "Serveur de traduction indisponible") {
          this.lastError = null;
          this.overlay?.setStatus("");
        }
        this.refreshDiagnostics();
      },
    });
  }

  private applySettings(settings: ExtensionSettings): void {
    this.settings = settings;
    this.overlay?.applySettings(settings);
    this.pipeline?.updateSettings(settings);
    this.preload?.updateSettings(settings);

    const enabled = Boolean(this.adapter && isPlatformEnabled(settings, this.adapter.platform));
    this.overlay?.setActive(enabled);
    if (!enabled) {
      this.stopAdapter();
      this.pipeline?.reset();
      this.preload?.pause();
      this.hider.clear();
      return;
    }

    if (!this.adapterStarted) {
      this.startAdapter();
    }
    this.hider.apply(this.adapter?.nativeSubtitleSelectors ?? [], settings.hideNativeSubtitles);
    this.refreshDiagnostics();
  }

  private startAdapter(): void {
    if (!this.adapter || this.adapterStarted) {
      return;
    }
    this.adapterStarted = true;
    this.adapter.start((snapshot) => this.handleSnapshot(snapshot));
  }

  private stopAdapter(): void {
    this.adapter?.stop();
    this.adapterStarted = false;
  }

  private handleSnapshot(snapshot: SubtitleSnapshot): void {
    this.latestSnapshot = snapshot;
    this.refreshDiagnostics();
    const preloaded = this.preload?.observe(snapshot.text);
    if (preloaded && snapshot.text) {
      this.pipeline?.acceptPreloaded(snapshot.text, preloaded);
    } else {
      this.pipeline?.observe(snapshot.text);
    }
  }

  private handleNavigation(): void {
    this.stopAdapter();
    this.pipeline?.reset();
    this.hider.clear();
    this.adapter = createSubtitleAdapter();
    this.preload?.reset(this.adapter.platform);
    this.latestSnapshot = {
      text: "",
      selector: null,
      candidates: [],
      capturedAt: Date.now(),
    };
    if (this.settings) {
      this.applySettings(this.settings);
    }
  }

  private refreshDiagnostics(): void {
    this.overlay?.setDiagnostics(this.getDiagnostics());
  }

  private async toggleEnabled(): Promise<void> {
    if (!this.settings) {
      return;
    }
    const next = { ...this.settings, enabled: !this.settings.enabled };
    await saveSettings(next);
    this.applySettings(next);
  }
}
