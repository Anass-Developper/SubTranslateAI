import manifest from "../manifest.json";
import {
  SiteAccessError,
  activateSiteAccessForCurrentTab,
  createSiteAccessContentScripts,
  siteAccessScriptIds,
  toHttpsOriginPattern,
  type SiteAccessDependencies,
} from "../src/settings/site-access";

describe("accès optionnel aux plateformes", () => {
  it("limite les permissions permanentes au serveur local", () => {
    expect(manifest.permissions).toEqual(["storage", "activeTab", "scripting"]);
    expect(manifest.host_permissions).toEqual(["http://127.0.0.1/*", "http://localhost/*"]);
    expect(manifest.optional_host_permissions).toEqual(["https://*/*"]);
  });

  it("injecte statiquement le bridge et le contrôleur sur Canal+ et Apple TV", () => {
    for (const contentScript of manifest.content_scripts) {
      expect(contentScript.matches).toEqual(
        expect.arrayContaining(["https://www.canalplus.com/*", "https://tv.apple.com/*"]),
      );
    }
  });

  it("normalise une URL HTTPS vers le motif exact de son hôte", () => {
    expect(toHttpsOriginPattern("https://Streaming.Example/watch/42?from=home")).toBe(
      "https://streaming.example/*",
    );
    expect(() => toHttpsOriginPattern("http://streaming.example/watch")).toThrow(SiteAccessError);
    expect(() => toHttpsOriginPattern("chrome://extensions")).toThrow(SiteAccessError);
  });

  it("produit des IDs stables et les deux mondes d'injection attendus", () => {
    const originPattern = "https://streaming.example/*";
    const scripts = createSiteAccessContentScripts(originPattern);

    expect(siteAccessScriptIds(originPattern)).toEqual(siteAccessScriptIds(originPattern));
    expect(scripts).toEqual([
      expect.objectContaining({
        id: siteAccessScriptIds(originPattern).pageBridge,
        matches: [originPattern],
        js: ["page-bridge.js"],
        runAt: "document_start",
        world: "MAIN",
        persistAcrossSessions: true,
      }),
      expect.objectContaining({
        id: siteAccessScriptIds(originPattern).content,
        matches: [originPattern],
        js: ["content.js"],
        runAt: "document_idle",
        world: "ISOLATED",
        persistAcrossSessions: true,
      }),
    ]);
  });

  it("demande l'origine, enregistre les scripts puis recharge l'onglet", async () => {
    const events: string[] = [];
    const dependencies = dependenciesFixture(events);

    const result = await activateSiteAccessForCurrentTab(dependencies);

    expect(result).toMatchObject({
      tabId: 42,
      originPattern: "https://streaming.example/*",
      granted: true,
      reloaded: true,
    });
    expect(result.registeredScriptIds).toHaveLength(2);
    expect(events).toEqual(["query", "request", "list", "register", "reload"]);
  });

  it("ne modifie rien lorsque l'utilisateur refuse la permission", async () => {
    const events: string[] = [];
    const dependencies = dependenciesFixture(events, false);

    const result = await activateSiteAccessForCurrentTab(dependencies);

    expect(result).toMatchObject({ granted: false, reloaded: false });
    expect(events).toEqual(["query", "request"]);
  });

  it("remplace les anciens enregistrements portant les mêmes IDs", async () => {
    const events: string[] = [];
    const originPattern = "https://streaming.example/*";
    const existing = createSiteAccessContentScripts(originPattern);
    const dependencies = dependenciesFixture(events, true, existing);

    await activateSiteAccessForCurrentTab(dependencies);

    expect(events).toEqual(["query", "request", "list", "unregister", "register", "reload"]);
  });
});

function dependenciesFixture(
  events: string[],
  granted = true,
  registered: readonly chrome.scripting.RegisteredContentScript[] = [],
): SiteAccessDependencies {
  return {
    queryActiveTab: async () => {
      events.push("query");
      return { id: 42, url: "https://streaming.example/watch/42" };
    },
    requestOrigin: async () => {
      events.push("request");
      return granted;
    },
    listRegisteredContentScripts: async () => {
      events.push("list");
      return registered;
    },
    unregisterContentScripts: async () => {
      events.push("unregister");
    },
    registerContentScripts: async () => {
      events.push("register");
    },
    reloadTab: async () => {
      events.push("reload");
    },
  };
}
