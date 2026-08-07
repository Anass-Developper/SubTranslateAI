import { mergeSettings } from "../src/config";

describe("migration des réglages de latence", () => {
  it("remplace automatiquement les anciens délais par les valeurs rapides", () => {
    expect(
      mergeSettings({
        debounceMs: 180,
        fragmentWindowMs: 220,
        requestTimeoutMs: 60_000,
      }),
    ).toMatchObject({
      debounceMs: 60,
      fragmentWindowMs: 120,
      requestTimeoutMs: 20_000,
    });
  });

  it("préserve des valeurs personnalisées", () => {
    expect(
      mergeSettings({
        debounceMs: 90,
        fragmentWindowMs: 300,
        requestTimeoutMs: 12_000,
      }),
    ).toMatchObject({
      debounceMs: 90,
      fragmentWindowMs: 300,
      requestTimeoutMs: 12_000,
    });
  });

  it("ne remigre pas les anciennes valeurs choisies volontairement après la mise à jour", () => {
    expect(
      mergeSettings({
        settingsVersion: 2,
        debounceMs: 180,
        fragmentWindowMs: 220,
        requestTimeoutMs: 60_000,
      }),
    ).toMatchObject({
      settingsVersion: 4,
      debounceMs: 180,
      fragmentWindowMs: 220,
      requestTimeoutMs: 60_000,
    });
  });

  it("active les nouvelles plateformes lors de la migration des anciens réglages", () => {
    const legacySettings = {
      settingsVersion: 3,
      platforms: {
        youtube: false,
        netflix: true,
        primeVideo: true,
        generic: false,
      },
    } as unknown as Parameters<typeof mergeSettings>[0];

    expect(mergeSettings(legacySettings)).toMatchObject({
      settingsVersion: 4,
      platforms: {
        youtube: false,
        netflix: true,
        primeVideo: true,
        canalPlus: true,
        appleTv: true,
        generic: false,
      },
    });
  });
});
