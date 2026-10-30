const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** A PNG carries the `.studyflow.yaml` text, in the iTXt chunk its MIME type keys. */
const KEYWORD = 'application/vnd.studyflow+yaml';
/**
 * And each image pasted on its canvas in a chunk of its own, the image's id, a NUL, then the bytes of its PNG. The
 * letters of the name say the chunk is ancillary, private and safe to copy, so a tool that keeps what it cannot read
 * keeps it.
 */
const IMAGE_CHUNK = 'stIm';

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

/** The bytes a PNG takes to say what it is and its size. */
const PNG_HEAD = 24;

/** Whether `bytes` start as a PNG file does, as far as saying what it is and its size. */
export function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= PNG_HEAD && PNG_SIGNATURE.every((byte, i) => bytes[i] === byte);
}

function assertPngSignature(png: Uint8Array): void {
  if (!isPng(png)) {
    throw new Error('The selected file is not a valid PNG.');
  }
}

/** A PNG's size in pixels, from its header, the first chunk of every PNG. */
export function pngSize(png: Uint8Array): { width: number; height: number } {
  assertPngSignature(png);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** A PNG's bytes as a data URL, a stretch at a time: an argument list cannot hold a whole image. */
export function pngToDataUrl(png: Uint8Array): string {
  const STRETCH = 0x8000;
  let binary = '';
  for (let i = 0; i < png.length; i += STRETCH) binary += String.fromCharCode(...png.subarray(i, i + STRETCH));
  return `data:image/png;base64,${btoa(binary)}`;
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

function withoutChunks(png: Uint8Array, drops: (chunk: PngChunk) => boolean): Uint8Array {
  const drop = [...pngChunks(png)].filter(drops);
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

function insertChunkBefore(base: Uint8Array, chunk: Uint8Array, before: string): Uint8Array {
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

/** `png` carrying `studyflow`, the text of a `.studyflow.yaml`, in an iTXt chunk keyed by its MIME type. */
export function embedStudyflowIntoPng(png: Uint8Array, studyflow: string): Uint8Array {
  assertPngSignature(png);
  const encoder = new TextEncoder();
  const keyword = encoder.encode(KEYWORD);
  const text = encoder.encode(studyflow);
  // iTXt layout: keyword NUL, flag+method (0 0 = uncompressed), empty language NUL, empty translated keyword NUL, UTF-8 text.
  const data = new Uint8Array(keyword.length + 5 + text.length);
  data.set(keyword, 0);
  data.set(text, keyword.length + 5);

  return insertChunkBefore(withoutChunks(png, (chunk) => chunkKeyword(png, chunk) === KEYWORD), buildChunk('iTXt', data), 'IEND');
}

/** The text {@link embedStudyflowIntoPng} put in the PNG. */
export function extractStudyflowFromPng(content: ArrayBuffer | Uint8Array): string {
  const png = content instanceof Uint8Array ? content : new Uint8Array(content);
  assertPngSignature(png);
  const decoder = new TextDecoder();

  for (const { type, offset, dataLength } of pngChunks(png)) {
    if (type !== 'iTXt') continue;
    const data = png.subarray(offset + 8, offset + 8 + dataLength);

    const keywordEnd = data.indexOf(0);
    if (keywordEnd < 0 || decoder.decode(data.subarray(0, keywordEnd)) !== KEYWORD) continue;
    if (data[keywordEnd + 1] !== 0) continue; // compressed text; this exporter never writes it

    const languageEnd = data.indexOf(0, keywordEnd + 3);
    const translatedEnd = languageEnd < 0 ? -1 : data.indexOf(0, languageEnd + 1);
    if (translatedEnd < 0) continue;
    return decoder.decode(data.subarray(translatedEnd + 1));
  }

  throw new Error('The selected PNG file does not contain embedded Studyflow.');
}

/** `png` carrying exactly `images`, each a PNG's bytes by the id its pasted image names; whatever it carried goes. */
export function embedPastedImagesIntoPng(png: Uint8Array, images: ReadonlyMap<string, Uint8Array>): Uint8Array {
  assertPngSignature(png);
  let out = withoutChunks(png, ({ type }) => type === IMAGE_CHUNK);
  for (const [id, bytes] of images) {
    const name = new TextEncoder().encode(id);
    const data = new Uint8Array(name.length + 1 + bytes.length);
    data.set(name, 0);
    data.set(bytes, name.length + 1);
    out = insertChunkBefore(out, buildChunk(IMAGE_CHUNK, data), 'IEND');
  }
  return out;
}

/** The images {@link embedPastedImagesIntoPng} put in the PNG, by id; a chunk that does not hold a PNG is passed over. */
export function extractPastedImagesFromPng(content: ArrayBuffer | Uint8Array): Map<string, Uint8Array> {
  const png = content instanceof Uint8Array ? content : new Uint8Array(content);
  assertPngSignature(png);
  const images = new Map<string, Uint8Array>();
  for (const { type, offset, dataLength } of pngChunks(png)) {
    if (type !== IMAGE_CHUNK) continue;
    const data = png.subarray(offset + 8, offset + 8 + dataLength);
    const idEnd = data.indexOf(0);
    const bytes = data.slice(idEnd + 1);
    if (idEnd > 0 && isPng(bytes)) images.set(new TextDecoder().decode(data.subarray(0, idEnd)), bytes);
  }
  return images;
}
