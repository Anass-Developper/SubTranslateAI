import { NativeSubtitleHider } from "../src/content/native-subtitle-hider";

describe("sous-titres natifs", () => {
  it("injecte puis retire proprement la règle de masquage", () => {
    const hider = new NativeSubtitleHider(document);

    hider.apply([".native-subtitle"], true);
    expect(
      document.head.querySelector("[data-dual-subtitles-native-hider]")?.textContent,
    ).toContain(".native-subtitle");

    hider.clear();
    expect(document.head.querySelector("[data-dual-subtitles-native-hider]")).toBeNull();
  });
});
