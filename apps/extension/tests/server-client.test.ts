import {
  ServerClient,
  ServerClientError,
  normalizeLocalServerUrl,
} from "../src/client/server-client";

describe("client du serveur local", () => {
  it("accepte uniquement une adresse HTTP loopback", () => {
    expect(normalizeLocalServerUrl("http://127.0.0.1:47831/")).toBe("http://127.0.0.1:47831");
    expect(() => normalizeLocalServerUrl("https://example.com")).toThrow(ServerClientError);
    expect(() => normalizeLocalServerUrl("http://192.168.1.5:47831")).toThrow(ServerClientError);
  });

  it("valide strictement la forme d'une traduction", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: "x", fr: "bonjour" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const client = new ServerClient("http://127.0.0.1:47831");

    await expect(
      client.translate({ id: "x", text: "hello", previousLines: [] }),
    ).rejects.toMatchObject({ kind: "invalid-response" });
  });

  it("expose l'état de configuration de la clé sans déclarer le serveur indisponible", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              status: "ok",
              apiKeyConfigured: false,
              provider: "ollama",
              model: "translategemma:4b-it-q8_0",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
      ),
    );
    const client = new ServerClient("http://127.0.0.1:47831");

    await expect(client.getHealth()).resolves.toEqual({
      status: "ok",
      apiKeyConfigured: false,
      provider: "ollama",
      model: "translategemma:4b-it-q8_0",
    });
    await expect(client.health()).resolves.toBe(true);
  });

  it("classe une erreur 429", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: "PROVIDER_RATE_LIMIT", message: "Trop de requêtes", retryable: true },
          }),
          { status: 429 },
        ),
      ),
    );
    const client = new ServerClient("http://127.0.0.1:47831");

    await expect(
      client.translate({ id: "x", text: "hello", previousLines: [] }),
    ).rejects.toMatchObject({
      kind: "rate-limit",
      status: 429,
      message: "Trop de requêtes",
    });
  });
});
