import { detectLanguageHint, normalizeDetectedText } from "../src/core/text";

describe("texte de sous-titres dans l'extension", () => {
  it("normalise espaces, retours et balises techniques", () => {
    expect(normalizeDetectedText(" <i>Hello</i>\u00a0  there\r\n friend ")).toBe(
      "Hello there friend",
    );
  });

  it("détecte un indice chinois", () => {
    expect(detectLanguageHint("我不知道你在这里。")).toBe("zh");
  });

  it("détecte un indice français sans prétendre détecter l'anglais", () => {
    expect(detectLanguageHint("Je ne suis pas avec vous.")).toBe("fr");
    expect(detectLanguageHint("I did not know you were here.")).toBeUndefined();
  });

  it("laisse le modèle trancher pour le japonais et le portugais", () => {
    expect(detectLanguageHint("私は学生です。")).toBeUndefined();
    expect(detectLanguageHint("東京")).toBeUndefined();
    expect(detectLanguageHint("A ação está pronta.")).toBeUndefined();
    expect(detectLanguageHint("Él está en la casa.")).toBeUndefined();
  });
});
