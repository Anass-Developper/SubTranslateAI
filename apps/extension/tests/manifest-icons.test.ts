import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

interface ExtensionManifest {
  default_locale?: string;
  name?: string;
  description?: string;
  icons?: Record<string, string>;
  action?: {
    default_icon?: Record<string, string>;
  };
}

describe("identité visuelle de l’extension", () => {
  it("déclare des icônes de barre et d’installation qui existent", () => {
    const extensionRoot = process.cwd();
    const manifest = JSON.parse(
      readFileSync(resolve(extensionRoot, "manifest.json"), "utf8"),
    ) as ExtensionManifest;

    expect(manifest.icons).toEqual({
      "16": "icons/icon16.png",
      "32": "icons/icon32.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png",
    });
    expect(manifest.action?.default_icon).toEqual({
      "16": "icons/icon16.png",
      "32": "icons/icon32.png",
    });

    for (const iconPath of Object.values(manifest.icons ?? {})) {
      const absolutePath = resolve(extensionRoot, iconPath);
      expect(existsSync(absolutePath)).toBe(true);
      expect(statSync(absolutePath).size).toBeGreaterThan(0);
    }
  });

  it("déclare les métadonnées françaises et anglaises", () => {
    const extensionRoot = process.cwd();
    const manifest = JSON.parse(
      readFileSync(resolve(extensionRoot, "manifest.json"), "utf8"),
    ) as ExtensionManifest;

    expect(manifest.default_locale).toBe("en");
    expect(manifest.name).toBe("__MSG_appName__");
    expect(manifest.description).toBe("__MSG_appDescription__");

    for (const locale of ["fr", "en"]) {
      const messages = JSON.parse(
        readFileSync(resolve(extensionRoot, "_locales", locale, "messages.json"), "utf8"),
      ) as Record<string, { message?: string }>;
      expect(messages.appName?.message).toBeTruthy();
      expect(messages.appDescription?.message).toBeTruthy();
      expect(messages.toggleCommandDescription?.message).toBeTruthy();
    }
  });
});
