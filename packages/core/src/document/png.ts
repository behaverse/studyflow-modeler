const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const STUDYFLOW_KEYWORD = 'studyflow';
const DRAWIO_KEYWORD = 'mxfile';

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

type PngChunk = { type: string; offset: number; dataLength: number };

function* pngChunks(png: Uint8Array): Generator<PngChunk> {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let offset = PNG_SIGNATURE.length;
  while (offset + 8 <= png.length) {
    const dataLength = view.getUint32(offset);
    const type = String.fromCharCode(png[offset + 4], png[offset + 5], png[offset + 6], png[offset + 7]);
    yield { type, offset, dataLength };
    offset += 12 + dataLength; // length + type + data + CRC
  }
}

function assertPngSignature(png: Uint8Array): void {
  const isPng = png.length > PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, i) => png[i] === byte);
  if (!isPng) {
    throw new Error('The selected file is not a valid PNG.');
  }
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Wrap `data` in a PNG chunk of `type`: length, type, data, CRC-32. */
function buildChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(new TextEncoder().encode(type), 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

function chunkKeyword(png: Uint8Array, chunk: PngChunk): string | undefined {
  if (chunk.type !== 'iTXt' && chunk.type !== 'tEXt' && chunk.type !== 'zTXt') return undefined;
  const data = png.subarray(chunk.offset + 8, chunk.offset + 8 + chunk.dataLength);
  const end = data.indexOf(0);
  return end < 0 ? undefined : new TextDecoder().decode(data.subarray(0, end));
}

function withoutTextChunks(png: Uint8Array, keyword: string): Uint8Array {
  const drop = [...pngChunks(png)].filter((chunk) => chunkKeyword(png, chunk) === keyword);
  if (drop.length === 0) return png;

  const removed = drop.reduce((total, chunk) => total + chunk.dataLength + 12, 0);
  const out = new Uint8Array(png.length - removed);
  let read = 0;
  let write = 0;
  for (const chunk of drop) {
    out.set(png.subarray(read, chunk.offset), write);
    write += chunk.offset - read;
    read = chunk.offset + chunk.dataLength + 12;
  }
  out.set(png.subarray(read), write);
  return out;
}

function insertChunkBefore(png: Uint8Array, chunk: Uint8Array, before: string, keyword: string): Uint8Array {
  assertPngSignature(png);
  const base = withoutTextChunks(png, keyword);

  let offset = -1;
  for (const existing of pngChunks(base)) {
    if (existing.type === before) {
      offset = existing.offset;
      break;
    }
  }
  if (offset < 0) {
    throw new Error('The selected file is not a valid PNG.');
  }

  const out = new Uint8Array(base.length + chunk.length);
  out.set(base.subarray(0, offset), 0);
  out.set(chunk, offset);
  out.set(base.subarray(offset), offset + chunk.length);
  return out;
}

export function embedStudyflowIntoPng(png: Uint8Array, xml: string): Uint8Array {
  const encoder = new TextEncoder();
  const keyword = encoder.encode(STUDYFLOW_KEYWORD);
  const text = encoder.encode(xml);
  // iTXt layout: keyword NUL, flag+method (0 0 = uncompressed), empty language NUL, empty translated keyword NUL, UTF-8 text.
  const data = new Uint8Array(keyword.length + 5 + text.length);
  data.set(keyword, 0);
  data.set(text, keyword.length + 5);

  return insertChunkBefore(png, buildChunk('iTXt', data), 'IEND', STUDYFLOW_KEYWORD);
}

export function embedDrawioIntoPng(png: Uint8Array, mxfileXml: string): Uint8Array {
  const encoder = new TextEncoder();
  const keyword = encoder.encode(DRAWIO_KEYWORD);
  const text = encoder.encode(encodeURIComponent(mxfileXml));
  const data = new Uint8Array(keyword.length + 1 + text.length);
  data.set(keyword, 0);
  data.set(text, keyword.length + 1);

  return insertChunkBefore(png, buildChunk('tEXt', data), 'IDAT', DRAWIO_KEYWORD);
}

export function extractXmlFromPng(content: ArrayBuffer | Uint8Array): string {
  const png = content instanceof Uint8Array ? content : new Uint8Array(content);
  assertPngSignature(png);
  const decoder = new TextDecoder();

  for (const { type, offset, dataLength } of pngChunks(png)) {
    if (type !== 'iTXt') continue;
    const data = png.subarray(offset + 8, offset + 8 + dataLength);

    const keywordEnd = data.indexOf(0);
    if (keywordEnd < 0 || decoder.decode(data.subarray(0, keywordEnd)) !== STUDYFLOW_KEYWORD) continue;
    if (data[keywordEnd + 1] !== 0) continue; // compressed text; this exporter never writes it

    const languageEnd = data.indexOf(0, keywordEnd + 3);
    const translatedEnd = languageEnd < 0 ? -1 : data.indexOf(0, languageEnd + 1);
    if (translatedEnd < 0) continue;
    return decoder.decode(data.subarray(translatedEnd + 1));
  }

  throw new Error('The selected PNG file does not contain embedded Studyflow.');
}
