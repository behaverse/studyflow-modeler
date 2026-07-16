/**
 * PNG counterpart of the SVG export's `<metadata><studyflow>` block: the
 * diagram's BPMN XML travels inside an `iTXt` chunk keyed `studyflow`, so a
 * saved `.png` round-trips back into the modeler just like a saved `.svg`.
 *
 * `iTXt` (not `tEXt`) because its text field is UTF-8; diagram names and
 * documentation are not restricted to Latin-1.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const STUDYFLOW_KEYWORD = 'studyflow';

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

/** Embed the diagram's BPMN XML into a PNG as a `studyflow` iTXt chunk
 *  (inserted before IEND) so a saved `.png` round-trips back into the modeler. */
export function embedStudyflowIntoPng(png: Uint8Array, xml: string): Uint8Array {
  assertPngSignature(png);
  let iendOffset = -1;
  for (const chunk of pngChunks(png)) {
    if (chunk.type === 'IEND') {
      iendOffset = chunk.offset;
      break;
    }
  }
  if (iendOffset < 0) {
    throw new Error('The selected file is not a valid PNG.');
  }

  const encoder = new TextEncoder();
  const keyword = encoder.encode(STUDYFLOW_KEYWORD);
  const text = encoder.encode(xml);
  // iTXt data: keyword NUL, compression flag + method (0 0 = uncompressed),
  // empty language tag NUL, empty translated keyword NUL, UTF-8 text.
  const data = new Uint8Array(keyword.length + 5 + text.length);
  data.set(keyword, 0);
  data.set(text, keyword.length + 5);

  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(encoder.encode('iTXt'), 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));

  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, iendOffset), 0);
  out.set(chunk, iendOffset);
  out.set(png.subarray(iendOffset), iendOffset + chunk.length);
  return out;
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
