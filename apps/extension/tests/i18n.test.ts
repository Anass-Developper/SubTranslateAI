import { resolveUiLanguage, translate } from "../src/settings/i18n";

describe("langue de l'interface de l'extension", () => {
  it("détecte automatiquement le français et utilise l'anglais par défaut", () => {
    expect(resolveUiLanguage("auto", "fr-FR")).toBe("fr");
    expect(resolveUiLanguage("auto", "fr_CA")).toBe("fr");
    expect(resolveUiLanguage("auto", "en-US")).toBe("en");
    expect(resolveUiLanguage("auto", "de-DE")).toBe("en");
    expect(resolveUiLanguage("auto", undefined)).toBe("en");
  });

  it("respecte le choix manuel indépendamment de la langue du navigateur", () => {
    expect(resolveUiLanguage("fr", "en-US")).toBe("fr");
    expect(resolveUiLanguage("en", "fr-FR")).toBe("en");
  });

  it("fournit les libellés français et anglais", () => {
    expect(translate("fr", "interfaceLanguage")).toBe("Langue de l'interface");
    expect(translate("en", "interfaceLanguage")).toBe("Interface language");
  });
});
