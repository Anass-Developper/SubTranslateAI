import { extractTimedTextFromIsobmff, looksLikeIsobmff } from "../src/page-bridge/isobmff-text";

const TTML_SAMPLE = `<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="00:00:01.000" end="00:00:02.500">Bonjour le monde</p></div></body></tt>`;
const TTML_SECOND = `<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="00:00:03.000" end="00:00:04.000">Deuxième réplique</p></div></body></tt>`;

function box(type: string, payload: Uint8Array): Uint8Array {
  const output = new Uint8Array(8 + payload.length);
  new DataView(output.buffer).setUint32(0, output.length);
  for (let index = 0; index < 4; index += 1) {
    output[4 + index] = type.charCodeAt(index);
  }
  output.set(payload, 8);
  return output;
}

function largeBox(type: string, payload: Uint8Array): Uint8Array {
  const output = new Uint8Array(16 + payload.length);
  const view = new DataView(output.buffer);
  view.setUint32(0, 1);
  for (let index = 0; index < 4; index += 1) {
    output[4 + index] = type.charCodeAt(index);
  }
  view.setBigUint64(8, BigInt(output.length));
  output.set(payload, 16);
  return output;
}

function concat(...parts: Uint8Array[]): ArrayBuffer {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output.buffer;
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function bufferOf(text: string): ArrayBuffer {
  const bytes = encode(text);
  const output = new ArrayBuffer(bytes.length);
  new Uint8Array(output).set(bytes);
  return output;
}

describe("extraction du texte des segments fMP4", () => {
  it("reconnaît un segment ISOBMFF et rejette le texte brut", () => {
    const segment = concat(box("styp", encode("msdh")), box("mdat", encode(TTML_SAMPLE)));
    expect(looksLikeIsobmff(segment)).toBe(true);
    expect(looksLikeIsobmff(bufferOf("WEBVTT\n\n00:00.000 --> 00:02.000\nBonjour"))).toBe(false);
    expect(looksLikeIsobmff(bufferOf(TTML_SAMPLE))).toBe(false);
    expect(looksLikeIsobmff(new ArrayBuffer(4))).toBe(false);
  });

  it("extrait le document TTML d'une boîte mdat", () => {
    const segment = concat(
      box("styp", encode("msdh")),
      box("moof", new Uint8Array(0)),
      box("mdat", encode(TTML_SAMPLE)),
    );

    expect(extractTimedTextFromIsobmff(segment)).toEqual([
      { contentType: "application/ttml+xml", body: TTML_SAMPLE },
    ]);
  });

  it("extrait plusieurs échantillons TTML et plusieurs mdat", () => {
    const segment = concat(
      box("styp", encode("msdh")),
      box("mdat", encode(TTML_SAMPLE + TTML_SECOND)),
      box("mdat", encode(TTML_SAMPLE)),
    );

    const documents = extractTimedTextFromIsobmff(segment);
    expect(documents).toHaveLength(3);
    expect(documents[0]?.body).toBe(TTML_SAMPLE);
    expect(documents[1]?.body).toBe(TTML_SECOND);
  });

  it("gère les boîtes à taille 64 bits", () => {
    const segment = concat(box("styp", encode("msdh")), largeBox("mdat", encode(TTML_SAMPLE)));
    expect(extractTimedTextFromIsobmff(segment)).toEqual([
      { contentType: "application/ttml+xml", body: TTML_SAMPLE },
    ]);
  });

  it("retourne un fichier WebVTT transporté tel quel dans un mdat", () => {
    const vtt = "WEBVTT\n\n00:00.000 --> 00:02.000\nBonjour";
    const segment = concat(box("styp", encode("msdh")), box("mdat", encode(vtt)));
    expect(extractTimedTextFromIsobmff(segment)).toEqual([{ contentType: "text/vtt", body: vtt }]);
  });

  it("ignore les mdat sans texte et les boîtes tronquées", () => {
    const binaryPayload = new Uint8Array([0, 1, 2, 3, 254, 255]);
    const clean = concat(box("styp", encode("msdh")), box("mdat", binaryPayload));
    expect(extractTimedTextFromIsobmff(clean)).toEqual([]);

    const truncated = concat(box("styp", encode("msdh")), box("mdat", encode(TTML_SAMPLE))).slice(
      0,
      24,
    );
    expect(extractTimedTextFromIsobmff(truncated)).toEqual([]);
  });
});
