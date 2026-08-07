export interface ExtractedTimedText {
  contentType: string;
  body: string;
}

const BOX_HEADER_BYTES = 8;
const LARGE_BOX_HEADER_BYTES = 16;
const MAX_DOCUMENTS = 64;
const KNOWN_TOP_LEVEL_BOXES = new Set([
  "ftyp",
  "styp",
  "moov",
  "moof",
  "mdat",
  "sidx",
  "ssix",
  "emsg",
  "prft",
  "free",
  "skip",
  "meta",
  "mfra",
  "uuid",
]);

const TTML_DOCUMENT_PATTERN =
  /<(?:[A-Za-z][\w.-]*:)?tt[\s>][\s\S]*?<\/(?:[A-Za-z][\w.-]*:)?tt\s*>/gu;

/** Reconnaît un segment MP4 fragmenté par sa première boîte ISOBMFF. */
export function looksLikeIsobmff(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < BOX_HEADER_BYTES) return false;
  const view = new DataView(buffer);
  const type = readBoxType(view, 4);
  if (!type || !KNOWN_TOP_LEVEL_BOXES.has(type)) return false;
  const declaredSize = view.getUint32(0);
  if (declaredSize === 0) return true;
  if (declaredSize === 1) return buffer.byteLength >= LARGE_BOX_HEADER_BYTES;
  return declaredSize >= BOX_HEADER_BYTES && declaredSize <= buffer.byteLength;
}

/**
 * Extrait les documents de sous-titres embarqués dans les boîtes mdat d'un
 * segment fMP4 : TTML pour le codec stpp (un document complet par échantillon),
 * ou un fichier WebVTT brut lorsque le conteneur en transporte un tel quel.
 */
export function extractTimedTextFromIsobmff(buffer: ArrayBuffer): ExtractedTimedText[] {
  if (!looksLikeIsobmff(buffer)) return [];

  const view = new DataView(buffer);
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const documents: ExtractedTimedText[] = [];
  let offset = 0;

  while (offset + BOX_HEADER_BYTES <= buffer.byteLength && documents.length < MAX_DOCUMENTS) {
    const declaredSize = view.getUint32(offset);
    const type = readBoxType(view, offset + 4);
    if (!type) break;

    let headerBytes = BOX_HEADER_BYTES;
    let boxSize = declaredSize;
    if (declaredSize === 1) {
      if (offset + LARGE_BOX_HEADER_BYTES > buffer.byteLength) break;
      const largeSize = view.getBigUint64(offset + 8);
      if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) break;
      boxSize = Number(largeSize);
      headerBytes = LARGE_BOX_HEADER_BYTES;
    } else if (declaredSize === 0) {
      boxSize = buffer.byteLength - offset;
    }
    if (boxSize < headerBytes || offset + boxSize > buffer.byteLength) break;

    if (type === "mdat" && boxSize > headerBytes) {
      const payload = decoder.decode(
        new Uint8Array(buffer, offset + headerBytes, boxSize - headerBytes),
      );
      const ttmlDocuments = payload.match(TTML_DOCUMENT_PATTERN) ?? [];
      for (const body of ttmlDocuments) {
        if (documents.length >= MAX_DOCUMENTS) break;
        documents.push({ contentType: "application/ttml+xml", body });
      }
      if (ttmlDocuments.length === 0 && payload.trimStart().startsWith("WEBVTT")) {
        documents.push({ contentType: "text/vtt", body: payload.trimStart() });
      }
    }

    offset += boxSize;
  }

  return documents;
}

function readBoxType(view: DataView, offset: number): string | null {
  if (offset + 4 > view.byteLength) return null;
  let type = "";
  for (let index = 0; index < 4; index += 1) {
    const code = view.getUint8(offset + index);
    if (code < 0x20 || code > 0x7e) return null;
    type += String.fromCharCode(code);
  }
  return type;
}
