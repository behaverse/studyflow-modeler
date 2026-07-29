/**
 * PNG counterpart of the SVG export's `<metadata><studyflow>` block: the
 * diagram's BPMN XML travels inside an `iTXt` chunk keyed `studyflow`, so a
 * saved `.png` round-trips back into the modeler just like a saved `.svg`.
 *
 * `iTXt` (not `tEXt`) because its text field is UTF-8; diagram names and
 * documentation are not restricted to Latin-1.
 *
 * The same file can carry a second, independent payload for draw.io — see
 * {@link embedDrawioIntoPng} — so one exported `.png` reopens in the modeler
 * *and* in draw.io. Both payloads are on by default and each is an
 * independent toggle in the Export dialog (see `exporters/formats`).
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const STUDYFLOW_KEYWORD = 'studyflow';
const DRAWIO_KEYWORD = 'mxfile';

/** CRC-32 as specified by the PNG standard (polynomial 0xEDB88320). */
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

/** Decode a `data:...;base64,` URL (as produced by `canvas.toDataURL`) to raw bytes. */
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

/** The keyword a text chunk is keyed under, or undefined for other chunk types. */
function chunkKeyword(png: Uint8Array, chunk: PngChunk): string | undefined {
  if (chunk.type !== 'iTXt' && chunk.type !== 'tEXt' && chunk.type !== 'zTXt') return undefined;
  const data = png.subarray(chunk.offset + 8, chunk.offset + 8 + chunk.dataLength);
  const end = data.indexOf(0);
  return end < 0 ? undefined : new TextDecoder().decode(data.subarray(0, end));
}

/**
 * Drop every text chunk already keyed `keyword`.
 *
 * Embedding is a *replace*: the readers take the first matching chunk, so a
 * second one appended beside it would never be seen and the stale payload
 * would keep winning. That matters whenever a PNG that already carries a
 * diagram is re-embedded — reopening an exported image and exporting it again.
 */
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

/** Splice `chunk` into `png` in front of the first chunk of type `before`,
 *  replacing any text chunk already keyed `keyword`. */
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

/** Embed the diagram's BPMN XML into a PNG as a `studyflow` iTXt chunk
 *  (inserted before IEND) so a saved `.png` round-trips back into the modeler. */
export function embedStudyflowIntoPng(png: Uint8Array, xml: string): Uint8Array {
  const encoder = new TextEncoder();
  const keyword = encoder.encode(STUDYFLOW_KEYWORD);
  const text = encoder.encode(xml);
  // iTXt data: keyword NUL, compression flag + method (0 0 = uncompressed),
  // empty language tag NUL, empty translated keyword NUL, UTF-8 text.
  const data = new Uint8Array(keyword.length + 5 + text.length);
  data.set(keyword, 0);
  data.set(text, keyword.length + 5);

  return insertChunkBefore(png, buildChunk('iTXt', data), 'IEND', STUDYFLOW_KEYWORD);
}

/**
 * Embed a draw.io `<mxfile>` document (see `exporters/drawio`) into a PNG as a
 * `tEXt` chunk keyed `mxfile`, which is what draw.io reads to reopen an
 * exported image as an editable diagram.
 *
 * Two details are load-bearing. The chunk goes **before the first IDAT**:
 * draw.io's PNG scanner stops at the image data, so a chunk parked next to
 * IEND (where the `studyflow` one lives) is never seen. And the payload is
 * `encodeURIComponent`-ed, which both matches what draw.io expects and leaves
 * it pure ASCII — the one way a UTF-8 diagram name survives `tEXt`'s Latin-1
 * text field without the compressed `zTXt` form.
 */
export function embedDrawioIntoPng(png: Uint8Array, mxfileXml: string): Uint8Array {
  const encoder = new TextEncoder();
  const keyword = encoder.encode(DRAWIO_KEYWORD);
  const text = encoder.encode(encodeURIComponent(mxfileXml));
  const data = new Uint8Array(keyword.length + 1 + text.length);
  data.set(keyword, 0);
  data.set(text, keyword.length + 1);

  return insertChunkBefore(png, buildChunk('tEXt', data), 'IDAT', DRAWIO_KEYWORD);
}

/** Extract the studyflow XML embedded in an exported PNG's `studyflow`
 *  iTXt chunk; throws when absent. */
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
