import { normalizeLocalServerUrl } from "../client/server-client";
import { ensureDefaultSettings, loadSettings, saveSettings } from "../storage";

interface ServerRequestMessage {
  type: "SERVER_REQUEST";
  requestId: string;
  baseUrl: string;
  path: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  timeoutMs: number;
}

interface CancelRequestMessage {
  type: "CANCEL_SERVER_REQUEST";
  requestId: string;
}

const ALLOWED_ENDPOINTS = new Set([
  "/health",
  "/translate",
  "/translate/batch",
  "/settings",
  "/stats",
  "/cache",
]);
const activeRequests = new Map<string, AbortController>();

void ensureDefaultSettings();
chrome.runtime.onInstalled.addListener(() => void ensureDefaultSettings());
chrome.runtime.onStartup.addListener(() => void ensureDefaultSettings());

chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-dual-subtitles") {
    return;
  }
  void loadSettings().then(async (settings) => {
    await saveSettings({ ...settings, enabled: !settings.enabled });
  });
});

chrome.runtime.onMessage.addListener(
  (
    message: ServerRequestMessage | CancelRequestMessage,
    _sender,
    sendResponse: (response?: unknown) => void,
  ) => {
    if (message.type === "CANCEL_SERVER_REQUEST") {
      activeRequests.get(message.requestId)?.abort();
      activeRequests.delete(message.requestId);
      sendResponse({ ok: true });
      return false;
    }
    if (message.type !== "SERVER_REQUEST") {
      return false;
    }
    void proxyServerRequest(message).then(sendResponse);
    return true;
  },
);

async function proxyServerRequest(message: ServerRequestMessage): Promise<{
  ok: boolean;
  status: number;
  data?: unknown;
  error?: string;
}> {
  if (!ALLOWED_ENDPOINTS.has(message.path)) {
    return { ok: false, status: 400, error: "Endpoint local non autorisé" };
  }

  let baseUrl: string;
  try {
    baseUrl = normalizeLocalServerUrl(message.baseUrl);
  } catch (error) {
    return {
      ok: false,
      status: 400,
      error: error instanceof Error ? error.message : "Adresse locale invalide",
    };
  }

  const controller = new AbortController();
  activeRequests.set(message.requestId, controller);
  const timeout = setTimeout(
    () => controller.abort(),
    Math.min(Math.max(message.timeoutMs, 1_000), 25_000),
  );

  try {
    const response = await fetch(`${baseUrl}${message.path}`, {
      method: message.method,
      headers: message.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: message.body === undefined ? undefined : JSON.stringify(message.body),
      signal: controller.signal,
    });
    const responseText = await response.text();
    let data: unknown;
    try {
      data = responseText ? (JSON.parse(responseText) as unknown) : undefined;
    } catch {
      data = { message: responseText.slice(0, 300) };
    }
    return {
      ok: response.ok,
      status: response.status,
      data,
      error: extractMessage(data),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error:
        error instanceof DOMException && error.name === "AbortError"
          ? "Requête locale annulée ou expirée"
          : "Serveur de traduction indisponible",
    };
  } finally {
    clearTimeout(timeout);
    activeRequests.delete(message.requestId);
  }
}

function extractMessage(data: unknown): string | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }
  const record = data as Record<string, unknown>;
  const value = record.message ?? record.error;
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    const nestedMessage = (value as Record<string, unknown>).message;
    return typeof nestedMessage === "string" ? nestedMessage : undefined;
  }
  return undefined;
}
