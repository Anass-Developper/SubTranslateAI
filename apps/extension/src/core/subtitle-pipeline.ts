import { ServerClient, ServerClientError, type ServerErrorKind } from "../client/server-client";
import type { ExtensionSettings, TranslationResponse } from "../types";
import { FragmentGrouper } from "./fragment-grouper";
import { createSubtitleId, detectLanguageHint, normalizeDetectedText } from "./text";

export interface SubtitlePipelineEvents {
  onPending: (text: string, languageHint?: "fr" | "zh") => void;
  onTranslation: (response: TranslationResponse) => void;
  onEmpty: () => void;
  onError: (message: string, serverUnavailable: boolean, kind: ServerErrorKind | "unknown") => void;
  onServerState: (reachable: boolean) => void;
}

export interface SubtitlePipelineDiagnostics {
  readonly currentTextPresent: boolean;
  readonly requestInFlight: boolean;
  readonly currentRequestAgeMs: number | null;
  readonly observedCues: number;
  readonly requestsStarted: number;
  readonly completedTranslations: number;
  readonly preloadedTranslations: number;
  readonly cancelledRequests: number;
  readonly failedRequests: number;
  readonly lastRequestDurationMs: number | null;
  readonly lastOutcome: "none" | "translated" | "preloaded" | "cancelled" | "error";
  readonly lastErrorKind: string | null;
}

export class SubtitlePipeline {
  private settings: ExtensionSettings;
  private client: ServerClient;
  private grouper: FragmentGrouper;
  private lastObservedText = "";
  private currentText = "";
  private previousLines: string[] = [];
  private sequence = 0;
  private cueGeneration = 0;
  private requestController: AbortController | null = null;
  private requestStartedAt: number | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private observedCues = 0;
  private requestsStarted = 0;
  private completedTranslations = 0;
  private preloadedTranslations = 0;
  private cancelledRequests = 0;
  private failedRequests = 0;
  private lastRequestDurationMs: number | null = null;
  private lastOutcome: SubtitlePipelineDiagnostics["lastOutcome"] = "none";
  private lastErrorKind: string | null = null;

  constructor(
    settings: ExtensionSettings,
    private readonly events: SubtitlePipelineEvents,
  ) {
    this.settings = settings;
    this.client = new ServerClient(settings.serverUrl, settings.requestTimeoutMs);
    this.grouper = new FragmentGrouper(settings.debounceMs, settings.fragmentWindowMs);
  }

  updateSettings(settings: ExtensionSettings): void {
    const serverChanged =
      settings.serverUrl !== this.settings.serverUrl ||
      settings.requestTimeoutMs !== this.settings.requestTimeoutMs;
    this.settings = settings;
    this.grouper.setDelays(settings.debounceMs, settings.fragmentWindowMs);
    if (serverChanged) {
      this.client = new ServerClient(settings.serverUrl, settings.requestTimeoutMs);
      this.cancelRequest();
      this.scheduleReconnect(0);
    }
  }

  observe(rawText: string): void {
    const text = normalizeDetectedText(rawText);
    if (!text) {
      if (this.lastObservedText) {
        this.cueGeneration += 1;
        this.lastObservedText = "";
        this.currentText = "";
        this.cancelRequest();
        this.grouper.clear();
        this.events.onEmpty();
      }
      return;
    }
    if (text === this.lastObservedText) {
      return;
    }

    this.cueGeneration += 1;
    this.observedCues += 1;
    const generation = this.cueGeneration;
    this.lastObservedText = text;
    this.currentText = text;
    this.cancelRequest();
    this.events.onPending(text, detectLanguageHint(text));
    this.grouper.push(text, () => void this.translate(text, generation));
  }

  acceptPreloaded(rawText: string, response: TranslationResponse): void {
    const text = normalizeDetectedText(rawText);
    if (!text) return;
    this.cueGeneration += 1;
    this.lastObservedText = text;
    this.currentText = text;
    this.cancelRequest();
    this.grouper.clear();
    this.rememberLine(text);
    this.preloadedTranslations += 1;
    this.completedTranslations += 1;
    this.lastOutcome = "preloaded";
    this.lastErrorKind = null;
    this.events.onServerState(true);
    this.events.onTranslation(response);
  }

  reset(): void {
    this.cueGeneration += 1;
    this.cancelRequest();
    this.grouper.clear();
    this.lastObservedText = "";
    this.currentText = "";
    this.previousLines = [];
    this.events.onEmpty();
  }

  dispose(): void {
    this.reset();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  getDiagnostics(): SubtitlePipelineDiagnostics {
    return {
      currentTextPresent: this.currentText.length > 0,
      requestInFlight: this.requestController !== null,
      currentRequestAgeMs:
        this.requestController && this.requestStartedAt !== null
          ? Math.max(0, Date.now() - this.requestStartedAt)
          : null,
      observedCues: this.observedCues,
      requestsStarted: this.requestsStarted,
      completedTranslations: this.completedTranslations,
      preloadedTranslations: this.preloadedTranslations,
      cancelledRequests: this.cancelledRequests,
      failedRequests: this.failedRequests,
      lastRequestDurationMs: this.lastRequestDurationMs,
      lastOutcome: this.lastOutcome,
      lastErrorKind: this.lastErrorKind,
    };
  }

  private async translate(text: string, generation: number): Promise<void> {
    if (!text || generation !== this.cueGeneration || text !== this.currentText) return;

    const controller = new AbortController();
    this.requestController = controller;
    this.requestStartedAt = Date.now();
    this.requestsStarted += 1;
    const id = createSubtitleId(++this.sequence);
    const previousLines = this.previousLines.slice(-this.settings.contextLineCount);

    try {
      const response = await this.client.translate(
        {
          id,
          text,
          detectedLanguage: detectLanguageHint(text),
          previousLines,
        },
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        generation !== this.cueGeneration ||
        this.currentText !== text ||
        response.id !== id
      ) {
        return;
      }
      this.lastRequestDurationMs = this.elapsedCurrentRequest();
      this.requestController = null;
      this.requestStartedAt = null;
      this.rememberLine(text);
      this.completedTranslations += 1;
      this.lastOutcome = "translated";
      this.lastErrorKind = null;
      this.events.onServerState(true);
      this.events.onTranslation(response);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      this.lastRequestDurationMs = this.elapsedCurrentRequest();
      this.requestController = null;
      this.requestStartedAt = null;
      this.failedRequests += 1;
      this.lastOutcome = "error";
      const kind = error instanceof ServerClientError ? error.kind : "unknown";
      this.lastErrorKind = kind;
      const unavailable =
        !(error instanceof ServerClientError) ||
        error.kind === "network" ||
        error.kind === "timeout";
      const message = unavailable
        ? "Serveur de traduction indisponible"
        : error instanceof Error
          ? error.message
          : "Traduction temporairement indisponible";
      this.events.onServerState(!unavailable);
      this.events.onError(message, unavailable, kind);
      if (unavailable) {
        this.scheduleReconnect(this.settings.reconnectIntervalMs);
      }
    }
  }

  private scheduleReconnect(delay: number): void {
    if (this.reconnectTimer !== null) {
      return;
    }
    this.reconnectTimer = setTimeout(
      () => {
        this.reconnectTimer = null;
        void this.client.health().then((reachable) => {
          this.events.onServerState(reachable);
          if (!reachable) {
            this.scheduleReconnect(this.settings.reconnectIntervalMs);
          } else if (this.currentText && !this.requestController) {
            void this.translate(this.currentText, this.cueGeneration);
          }
        });
      },
      Math.max(0, delay),
    );
  }

  private cancelRequest(): void {
    if (this.requestController) {
      this.lastRequestDurationMs = this.elapsedCurrentRequest();
      this.cancelledRequests += 1;
      this.lastOutcome = "cancelled";
      this.lastErrorKind = "aborted";
      this.requestController.abort();
    }
    this.requestController = null;
    this.requestStartedAt = null;
  }

  private elapsedCurrentRequest(): number | null {
    return this.requestStartedAt === null ? null : Math.max(0, Date.now() - this.requestStartedAt);
  }

  private rememberLine(text: string): void {
    if (this.previousLines.at(-1) === text) {
      return;
    }
    this.previousLines.push(text);
    this.previousLines = this.previousLines.slice(-Math.max(2, this.settings.contextLineCount));
  }
}
