export interface SiteAccessTab {
  id?: number;
  url?: string;
}

export interface SiteAccessDependencies {
  queryActiveTab: () => Promise<SiteAccessTab | undefined>;
  requestOrigin: (originPattern: string) => Promise<boolean>;
  listRegisteredContentScripts: (
    scriptIds: readonly string[],
  ) => Promise<readonly chrome.scripting.RegisteredContentScript[]>;
  unregisterContentScripts: (scriptIds: readonly string[]) => Promise<void>;
  registerContentScripts: (
    scripts: readonly chrome.scripting.RegisteredContentScript[],
  ) => Promise<void>;
  reloadTab: (tabId: number) => Promise<void>;
}

export interface SiteAccessActivationResult {
  tabId: number;
  originPattern: string;
  granted: boolean;
  registeredScriptIds: readonly string[];
  reloaded: boolean;
}

export class SiteAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SiteAccessError";
  }
}

export function toHttpsOriginPattern(urlValue: string): string {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw new SiteAccessError("Adresse de l'onglet invalide");
  }
  if (url.protocol !== "https:" || !url.hostname) {
    throw new SiteAccessError("Seules les pages HTTPS peuvent être activées");
  }
  return `https://${url.hostname}/*`;
}

export function siteAccessScriptIds(originPattern: string): {
  pageBridge: string;
  content: string;
} {
  const suffix = stableHash(originPattern);
  return {
    pageBridge: `dual-subtitles-page-bridge-${suffix}`,
    content: `dual-subtitles-content-${suffix}`,
  };
}

export function createSiteAccessContentScripts(
  originPattern: string,
): chrome.scripting.RegisteredContentScript[] {
  const ids = siteAccessScriptIds(originPattern);
  return [
    {
      id: ids.pageBridge,
      matches: [originPattern],
      js: ["page-bridge.js"],
      runAt: "document_start",
      world: "MAIN",
      allFrames: false,
      persistAcrossSessions: true,
    },
    {
      id: ids.content,
      matches: [originPattern],
      js: ["content.js"],
      runAt: "document_idle",
      world: "ISOLATED",
      allFrames: false,
      persistAcrossSessions: true,
    },
  ];
}

export async function activateSiteAccessForCurrentTab(
  dependencies: SiteAccessDependencies = createChromeSiteAccessDependencies(),
): Promise<SiteAccessActivationResult> {
  const tab = await dependencies.queryActiveTab();
  if (tab?.id === undefined) {
    throw new SiteAccessError("Aucun onglet actif");
  }
  if (!tab.url) {
    throw new SiteAccessError("Adresse de l'onglet indisponible");
  }

  const originPattern = toHttpsOriginPattern(tab.url);
  const scripts = createSiteAccessContentScripts(originPattern);
  const scriptIds = scripts.map(({ id }) => id);
  const granted = await dependencies.requestOrigin(originPattern);
  if (!granted) {
    return {
      tabId: tab.id,
      originPattern,
      granted: false,
      registeredScriptIds: [],
      reloaded: false,
    };
  }

  const registered = await dependencies.listRegisteredContentScripts(scriptIds);
  if (registered.length > 0) {
    await dependencies.unregisterContentScripts(registered.map(({ id }) => id));
  }
  await dependencies.registerContentScripts(scripts);
  await dependencies.reloadTab(tab.id);

  return {
    tabId: tab.id,
    originPattern,
    granted: true,
    registeredScriptIds: scriptIds,
    reloaded: true,
  };
}

function createChromeSiteAccessDependencies(): SiteAccessDependencies {
  return {
    queryActiveTab: async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      return tabs[0];
    },
    requestOrigin: (originPattern) => chrome.permissions.request({ origins: [originPattern] }),
    listRegisteredContentScripts: (scriptIds) =>
      chrome.scripting.getRegisteredContentScripts({ ids: [...scriptIds] }),
    unregisterContentScripts: (scriptIds) =>
      chrome.scripting.unregisterContentScripts({ ids: [...scriptIds] }),
    registerContentScripts: (scripts) => chrome.scripting.registerContentScripts([...scripts]),
    reloadTab: (tabId) => chrome.tabs.reload(tabId),
  };
}

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}
