import type { TranslateBatchRequest, TranslateBatchResponse } from "@dual-subtitles/shared";
import type { ServerStats, TranslationRequest, TranslationResponse } from "../types";

interface ServerRequestMessage {
  type: "SERVER_REQUEST";
  requestId: string;
  baseUrl: string;
  path: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  timeoutMs: number;
}

interface ServerResponseMessage {
  ok: boolean;
  status: number;
  data?: unknown;
  error?: string;
}

export type ServerErrorKind =
  "aborted" | "timeout" | "network" | "unauthorized" | "rate-limit" | "server" | "invalid-response";

export class ServerClientError extends Error {
  constructor(
    message: string,
    readonly kind: ServerErrorKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ServerClientError";
  }
}

export class ServerClient {
  readonly baseUrl: string;

  constructor(
    serverUrl: string,
    private readonly timeoutMs = 20_000,
  ) {
    this.baseUrl = normalizeLocalServerUrl(serverUrl);
  }

  async health(signal?: AbortSignal): Promise<boolean> {
    try {
      await this.getHealth(signal);
      return true;
    } catch (error) {
      if (error instanceof ServerClientError && error.kind === "aborted") {
        throw error;
      }
      return false;
    }
  }

  async getHealth(signal?: AbortSignal): Promise<{
    status: "ok";
    apiKeyConfigured: boolean;
    provider: "opencode" | "ollama" | "hybrid";
    model: string;
  }> {
    const response = await this.request<{
      status?: unknown;
      apiKeyConfigured?: unknown;
      provider?: unknown;
      model?: unknown;
    }>("/health", "GET", undefined, signal);
    if (
      response.status !== "ok" ||
      typeof response.apiKeyConfigured !== "boolean" ||
      (response.provider !== "opencode" &&
        response.provider !== "ollama" &&
        response.provider !== "hybrid") ||
      typeof response.model !== "string"
    ) {
      throw new ServerClientError("Réponse de santé invalide", "invalid-response");
    }
    return {
      status: "ok",
      apiKeyConfigured: response.apiKeyConfigured,
      provider: response.provider,
      model: response.model,
    };
  }

  async translate(request: TranslationRequest, signal?: AbortSignal): Promise<TranslationResponse> {
    const response = await this.request<TranslationResponse>("/translate", "POST", request, signal);
    if (
      typeof response.id !== "string" ||
      typeof response.sourceLanguage !== "string" ||
      typeof response.fr !== "string" ||
      typeof response.zh !== "string" ||
      typeof response.cached !== "boolean"
    ) {
      throw new ServerClientError("Réponse de traduction invalide", "invalid-response");
    }
    return response;
  }

  async translateBatch(
    request: TranslateBatchRequest,
    signal?: AbortSignal,
  ): Promise<TranslateBatchResponse> {
    const response = await this.request<TranslateBatchResponse>(
      "/translate/batch",
      "POST",
      request,
      signal,
    );
    if (
      !Array.isArray(response.results) ||
      response.results.length === 0 ||
      response.results.some(
        (result) =>
          typeof result.cueId !== "string" ||
          typeof result.sourceLanguage !== "string" ||
          typeof result.fr !== "string" ||
          typeof result.zh !== "string" ||
          typeof result.cached !== "boolean",
      )
    ) {
      throw new ServerClientError("Réponse de traduction batch invalide", "invalid-response");
    }
    return response;
  }

  async getStats(signal?: AbortSignal): Promise<ServerStats> {
    return this.request<ServerStats>("/stats", "GET", undefined, signal);
  }

  async clearCache(signal?: AbortSignal): Promise<{ cleared: number }> {
    return this.request<{ cleared: number }>("/cache", "DELETE", undefined, signal);
  }

  private async request<T>(
    path: string,
    method: ServerRequestMessage["method"],
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) {
      throw new ServerClientError("Requête annulée", "aborted");
    }

    const requestId = crypto.randomUUID();
    let response: ServerResponseMessage;
    try {
      response = supportsExtensionTransport()
        ? await sendRuntimeRequest(
            {
              type: "SERVER_REQUEST",
              requestId,
              baseUrl: this.baseUrl,
              path,
              method,
              body,
              timeoutMs: this.timeoutMs,
            },
            signal,
          )
        : await sendFetchRequest(this.baseUrl, path, method, body, this.timeoutMs, signal);
    } catch (error) {
      if (signal?.aborted) {
        throw new ServerClientError("Requête annulée", "aborted");
      }
      if (error instanceof ServerClientError) {
        throw error;
      }
      throw new ServerClientError(
        error instanceof Error ? error.message : "Serveur de traduction indisponible",
        "network",
      );
    }

    if (!response.ok) {
      throw classifyHttpError(response.status, response.error);
    }
    return response.data as T;
  }
}

export function normalizeLocalServerUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ServerClientError("Adresse du serveur local invalide", "network");
  }
  if (url.protocol !== "http:" || (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")) {
    throw new ServerClientError(
      "Le serveur doit utiliser http://127.0.0.1 ou http://localhost",
      "network",
    );
  }
  url.pathname = url.pathname.replace(/\/+$/u, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
}

function supportsExtensionTransport(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id && chrome.runtime.sendMessage);
}

async function sendRuntimeRequest(
  message: ServerRequestMessage,
  signal?: AbortSignal,
): Promise<ServerResponseMessage> {
  const cancel = (): void => {
    void chrome.runtime.sendMessage({
      type: "CANCEL_SERVER_REQUEST",
      requestId: message.requestId,
    });
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    return (await chrome.runtime.sendMessage(message)) as ServerResponseMessage;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

async function sendFetchRequest(
  baseUrl: string,
  path: string,
  method: string,
  body: unknown,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ServerResponseMessage> {
  const controller = new AbortController();
  const relayAbort = (): void => controller.abort();
  signal?.addEventListener("abort", relayAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await parseJsonSafely(response);
    return {
      ok: response.ok,
      status: response.status,
      data,
      error: extractErrorMessage(data),
    };
  } catch (error) {
    if (signal?.aborted) {
      throw new ServerClientError("Requête annulée", "aborted");
    }
    if (controller.signal.aborted) {
      throw new ServerClientError("Délai de réponse dépassé", "timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", relayAbort);
  }
}

async function parseJsonSafely(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text.slice(0, 300) };
  }
}

function extractErrorMessage(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const candidate = record.message ?? record.error;
  if (typeof candidate === "string") {
    return candidate;
  }
  if (candidate && typeof candidate === "object") {
    const nestedMessage = (candidate as Record<string, unknown>).message;
    return typeof nestedMessage === "string" ? nestedMessage : undefined;
  }
  return undefined;
}

function classifyHttpError(status: number, message?: string): ServerClientError {
  if (status === 401) {
    return new ServerClientError(message ?? "Clé OpenCode Go refusée", "unauthorized", status);
  }
  if (status === 429) {
    return new ServerClientError(message ?? "Limite de traduction atteinte", "rate-limit", status);
  }
  if (status >= 500) {
    return new ServerClientError(
      message ?? "Service de traduction temporairement indisponible",
      "server",
      status,
    );
  }
  return new ServerClientError(message ?? `Erreur serveur ${status}`, "network", status);
}
