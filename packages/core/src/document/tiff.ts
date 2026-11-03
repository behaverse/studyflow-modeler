import { isPng } from '@core/document/png';

/*
 * A TIFF carrying a study, as a PNG does: the `.studyflow.yaml` text in an XMP packet (tag 700), what it is in one
 * line of ImageDescription (270), and the images pasted on its canvas in a private tag of their own. Hand-written like
 * `png.ts`: a writer of the form journals ask for (little-endian, 8-bit RGB, LZW strips, the print size in the
 * resolution tags) and a reader of either byte order that finds and rewrites tags without decoding a pixel.
 */

const TAG = {
  imageWidth: 256,
  imageLength: 257,
  bitsPerSample: 258,
  compression: 259,
  photometric: 262,
  imageDescription: 270,
  stripOffsets: 273,
  samplesPerPixel: 277,
  rowsPerStrip: 278,
  stripByteCounts: 279,
  xResolution: 282,
  yResolution: 283,
  planarConfiguration: 284,
  resolutionUnit: 296,
  tileOffsets: 324,
  tileByteCounts: 325,
  subIfds: 330,
  xmp: 700,
  exifIfd: 34665,
  gpsIfd: 34853,
  interoperabilityIfd: 40965,
  /** The pasted images, in the range TIFF leaves to anyone (65000 to 65535): each image's id, a NUL, the length of its PNG, its PNG. */
  pastedImages: 65300,
} as const;

/** A tag whose value points at another directory: nothing this module writes, but nothing it may move either. */
const DIRECTORY_POINTERS = new Set<number>([TAG.subIfds, TAG.exifIfd, TAG.gpsIfd, TAG.interoperabilityIfd]);

/** The tags this module owns, and rewrites as one. */
const OWN_TAGS = new Set<number>([TAG.imageDescription, TAG.xmp, TAG.pastedImages]);

const TYPE = { byte: 1, ascii: 2, short: 3, long: 4, rational: 5, undefined: 7 } as const;
/** How many bytes one value of each TIFF type takes; an unknown type is kept as it is found. */
const TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4];

const LZW = 5;
const RGB = 2;
const INCH = 2;
const CENTIMETRE = 3;

/** The study's namespace in the packet: what `studyflow:format`, `studyflow:digest` and `studyflow:study` are under. */
const XMP_NAMESPACE = 'http://behaverse.org/schemas/studyflow/xmp/1.0/';
/** What `studyflow:study` holds, the MIME type the PNG keys its chunk by. */
const FORMAT = 'application/vnd.studyflow+yaml';

/* --- reading --- */

/** The bytes a TIFF takes to say what it is and where its first directory is. */
const TIFF_HEAD = 8;

/** Whether `bytes` start as a TIFF file does: a byte order, the magic 42 in it, and the offset of its first directory. */
export function isTiff(bytes: Uint8Array): boolean {
  if (bytes.length < TIFF_HEAD) return false;
  const little = bytes[0] === 0x49 && bytes[1] === 0x49;
  const big = bytes[0] === 0x4d && bytes[1] === 0x4d;
  return (little && bytes[2] === 42 && bytes[3] === 0) || (big && bytes[2] === 0 && bytes[3] === 42);
}

const INVALID = 'The selected file is not a valid TIFF.';

/** A TIFF's bytes and the order its numbers are in. */
type Tiff = { bytes: Uint8Array; view: DataView; little: boolean };

function tiffOf(content: ArrayBuffer | Uint8Array): Tiff {
  const bytes = content instanceof Uint8Array ? content : new Uint8Array(content);
  if (!isTiff(bytes)) throw new Error(INVALID);
  return { bytes, view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), little: bytes[0] === 0x49 };
}

const u16 = (tiff: Tiff, at: number): number => tiff.view.getUint16(at, tiff.little);
const u32 = (tiff: Tiff, at: number): number => tiff.view.getUint32(at, tiff.little);

/** A directory entry: its tag, type and count, and its last four bytes as they stand, the value when it fits in them, else where it is. */
type Entry = { tag: number; type: number; count: number; word: Uint8Array };

type Directory = { at: number; entries: Entry[]; next: number };

const sizeOf = (entry: Entry): number => (TYPE_SIZE[entry.type] ?? 0) * entry.count;

const inline = (entry: Entry): boolean => sizeOf(entry) <= 4;

/** Where an entry's value is: in the file, or none when the value sits in the entry. */
const offsetOf = (tiff: Tiff, entry: Entry): number => new DataView(entry.word.buffer, entry.word.byteOffset, 4).getUint32(0, tiff.little);

/** The first directory, whose entries say what the image is. */
function directory(tiff: Tiff): Directory {
  const at = u32(tiff, 4);
  if (at + 2 > tiff.bytes.length) throw new Error(INVALID);
  const count = u16(tiff, at);
  if (at + 2 + count * 12 + 4 > tiff.bytes.length) throw new Error(INVALID);
  const entries: Entry[] = [];
  for (let i = 0; i < count; i++) {
    const entry = at + 2 + i * 12;
    entries.push({ tag: u16(tiff, entry), type: u16(tiff, entry + 2), count: u32(tiff, entry + 4), word: tiff.bytes.subarray(entry + 8, entry + 12) });
  }
  return { at, entries, next: u32(tiff, at + 2 + count * 12) };
}

const entryOf = (dir: Directory, tag: number): Entry | undefined => dir.entries.find((entry) => entry.tag === tag);

/** An entry's value, wherever it stands. */
function valueOf(tiff: Tiff, entry: Entry): Uint8Array {
  const size = sizeOf(entry);
  if (inline(entry)) return entry.word.subarray(0, size);
  const offset = offsetOf(tiff, entry);
  if (offset + size > tiff.bytes.length) throw new Error(INVALID);
  return tiff.bytes.subarray(offset, offset + size);
}

/** An entry's numbers: its bytes, shorts or longs, or its rationals as quotients. */
function numbersOf(tiff: Tiff, entry: Entry): number[] {
  const value = valueOf(tiff, entry);
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
  const numbers: number[] = [];
  for (let i = 0; i < entry.count; i++) {
    switch (entry.type) {
      case TYPE.short: numbers.push(view.getUint16(i * 2, tiff.little)); break;
      case TYPE.long: case 13: numbers.push(view.getUint32(i * 4, tiff.little)); break;
      case TYPE.rational: numbers.push(view.getUint32(i * 8, tiff.little) / (view.getUint32(i * 8 + 4, tiff.little) || 1)); break;
      default: numbers.push(value[i]);
    }
  }
  return numbers;
}

const numberOf = (tiff: Tiff, dir: Directory, tag: number): number | undefined => {
  const entry = entryOf(dir, tag);
  return entry ? numbersOf(tiff, entry)[0] : undefined;
};

/** A TIFF's size in pixels. */
export function tiffSize(content: ArrayBuffer | Uint8Array): { width: number; height: number } {
  const tiff = tiffOf(content);
  const dir = directory(tiff);
  const width = numberOf(tiff, dir, TAG.imageWidth);
  const height = numberOf(tiff, dir, TAG.imageLength);
  if (width === undefined || height === undefined) throw new Error(INVALID);
  return { width, height };
}

/** The print size a TIFF declares, in dots per inch along each axis; none when it declares no resolution, or one in no unit. */
export function tiffResolution(content: ArrayBuffer | Uint8Array): { x: number; y: number } | undefined {
  const tiff = tiffOf(content);
  const dir = directory(tiff);
  const unit = numberOf(tiff, dir, TAG.resolutionUnit) ?? INCH;
  const x = numberOf(tiff, dir, TAG.xResolution);
  if (x === undefined || !(x > 0) || (unit !== INCH && unit !== CENTIMETRE)) return undefined;
  const y = numberOf(tiff, dir, TAG.yResolution) ?? x;
  const perInch = unit === CENTIMETRE ? 2.54 : 1;
  return { x: x * perInch, y: (y > 0 ? y : x) * perInch };
}

/* --- rewriting tags --- */

type TagValue = { type: number; data: Uint8Array };

/**
 * Where the file's own bytes end: before a tail this module appended to it, so that embedding again replaces that
 * tail rather than piling another on it, else at its end. The tail is this module's when the directory and the values
 * of its own tags are the last things in the file and nothing else reaches into them.
 */
function ownTailStart(tiff: Tiff, dir: Directory): number | undefined {
  let start = dir.at;
  for (const entry of dir.entries) {
    if (OWN_TAGS.has(entry.tag) && !inline(entry)) start = Math.min(start, offsetOf(tiff, entry));
  }
  const counts = (tag: number): number[] => {
    const entry = entryOf(dir, tag);
    return entry ? numbersOf(tiff, entry) : [];
  };
  for (const entry of dir.entries) {
    if (OWN_TAGS.has(entry.tag)) continue;
    if (!inline(entry) && offsetOf(tiff, entry) + sizeOf(entry) > start) return undefined;
    if (DIRECTORY_POINTERS.has(entry.tag) && numbersOf(tiff, entry).some((at) => at >= start)) return undefined;
    if (entry.tag === TAG.stripOffsets || entry.tag === TAG.tileOffsets) {
      const sizes = counts(entry.tag === TAG.stripOffsets ? TAG.stripByteCounts : TAG.tileByteCounts);
      if (numbersOf(tiff, entry).some((at, i) => at + (sizes[i] ?? 0) > start)) return undefined;
    }
  }
  if (dir.next !== 0 && dir.next >= start) return undefined;
  return start;
}

/**
 * `tiff` with `changes` to its first directory: each tag's new value, or none to drop it. Nothing it holds is moved:
 * the new values and the directory go after its bytes, and the header points at the new directory. The old
 * directory stays where it was, unreferenced, as do the values it alone pointed to.
 */
function withTags(content: ArrayBuffer | Uint8Array, changes: ReadonlyMap<number, TagValue | undefined>): Uint8Array {
  const tiff = tiffOf(content);
  const dir = directory(tiff);
  const end = ownTailStart(tiff, dir) ?? tiff.bytes.length;

  const kept = dir.entries.filter((entry) => !changes.has(entry.tag));
  // A kept value standing in the tail being replaced is written again after it; the rest stay where they are.
  const stays = kept.filter((entry) => inline(entry) || offsetOf(tiff, entry) < end);
  const moved = kept.filter((entry) => !stays.includes(entry))
    .map((entry) => ({ tag: entry.tag, type: entry.type, count: entry.count, data: valueOf(tiff, entry).slice() }));
  const added = [...changes].flatMap(([tag, value]) => (value ? [{ tag, type: value.type, count: value.data.length, data: value.data }] : []));
  // A value longer than its entry's four bytes follows the file, each on an even offset as TIFF asks.
  let length = end + (end % 2);
  const placed = [...moved, ...added].map((value) => {
    const offset = value.data.length > 4 ? length : undefined;
    if (offset !== undefined) length += value.data.length + (value.data.length % 2);
    return { ...value, offset };
  });
  const at = length;
  const entries = [...stays, ...placed].sort((a, b) => a.tag - b.tag);
  length += 2 + entries.length * 12 + 4;

  const out = new Uint8Array(length);
  out.set(tiff.bytes.subarray(0, end));
  const view = new DataView(out.buffer);
  view.setUint32(4, at, tiff.little);
  for (const value of placed) if (value.offset !== undefined) out.set(value.data, value.offset);
  view.setUint16(at, entries.length, tiff.little);
  entries.forEach((entry, i) => {
    const cursor = at + 2 + i * 12;
    view.setUint16(cursor, entry.tag, tiff.little);
    view.setUint16(cursor + 2, entry.type, tiff.little);
    view.setUint32(cursor + 4, entry.count, tiff.little);
    if ('word' in entry) out.set(entry.word, cursor + 8);
    else if (entry.offset !== undefined) view.setUint32(cursor + 8, entry.offset, tiff.little);
    else out.set(entry.data, cursor + 8);
  });
  view.setUint32(at + 2 + entries.length * 12, dir.next, tiff.little);
  return out;
}

/** An entry's value as text, trailing NULs dropped. */
function textOf(tiff: Tiff, dir: Directory, tag: number): string | undefined {
  const entry = entryOf(dir, tag);
  if (!entry) return undefined;
  const value = valueOf(tiff, entry);
  let end = value.length;
  while (end > 0 && value[end - 1] === 0) end--;
  return new TextDecoder().decode(value.subarray(0, end));
}

/* --- the study, in XMP --- */

/** What the packet says of the study besides its text. */
export type StudyflowTiffAbout = {
  id?: string;
  name?: string;
  /** The protocol digest `studyflow validate` recomputes. */
  digest: string;
  /** The program writing the file, and its version: `studyflow-modeler/26.11.1`. */
  creatorTool: string;
};

const escapeXml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const unescapeXml = (text: string): string => text.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, name: string) => {
  switch (name.toLowerCase()) {
    case 'lt': return '<';
    case 'gt': return '>';
    case 'amp': return '&';
    case 'quot': return '"';
    case 'apos': return "'";
    default: return String.fromCodePoint(name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10));
  }
});

/** Room for a tool that edits the packet in place, as the XMP specification suggests: 2 KB of whitespace before the end. */
const XMP_PADDING = Array.from({ length: 20 }, () => ' '.repeat(99)).join('\n');

/** The packet: an `rdf:Description` saying what the image is, who wrote it, and the study, its text XML-escaped. */
function xmpPacket(studyflow: string, about: StudyflowTiffAbout): string {
  const title = about.name ?? about.id;
  return [
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    ' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '  <rdf:Description rdf:about=""',
    '    xmlns:dc="http://purl.org/dc/elements/1.1/"',
    '    xmlns:xmp="http://ns.adobe.com/xap/1.0/"',
    `    xmlns:studyflow="${XMP_NAMESPACE}">`,
    '   <dc:format>image/tiff</dc:format>',
    ...(title ? [`   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(title)}</rdf:li></rdf:Alt></dc:title>`] : []),
    `   <xmp:CreatorTool>${escapeXml(about.creatorTool)}</xmp:CreatorTool>`,
    `   <studyflow:format>${FORMAT}</studyflow:format>`,
    `   <studyflow:digest>${escapeXml(about.digest)}</studyflow:digest>`,
    `   <studyflow:study>${escapeXml(studyflow)}</studyflow:study>`,
    '  </rdf:Description>',
    ' </rdf:RDF>',
    '</x:xmpmeta>',
    XMP_PADDING,
    '<?xpacket end="w"?>',
  ].join('\n');
}

/** The one line a tool that reads no XMP shows: ASCII, as the tag is. */
function description(about: StudyflowTiffAbout): string {
  const line = `Studyflow study ${about.id ?? about.name ?? ''}, ${about.digest}: studyflow in XMP`;
  return line.replace(/[^\x20-\x7e]/g, '?');
}

/** The XMP packet a TIFF carries, as text. */
export function tiffXmp(content: ArrayBuffer | Uint8Array): string | undefined {
  const tiff = tiffOf(content);
  return textOf(tiff, directory(tiff), TAG.xmp);
}

/**
 * The study's text in an XMP packet, under whatever prefix the packet binds to the studyflow namespace (`studyflow`
 * as written here; a tool rewriting the packet may choose another, and may put a simple property in an attribute).
 */
function studyflowInXmp(xmp: string): string | undefined {
  const prefix = new RegExp(`xmlns:([\\w.-]+)=["']${XMP_NAMESPACE}["']`).exec(xmp)?.[1];
  if (!prefix) return undefined;
  const element = new RegExp(`<${prefix}:study(?:\\s[^>]*)?>([\\s\\S]*?)</${prefix}:study>`).exec(xmp);
  if (element) return unescapeXml(element[1]);
  const attribute = new RegExp(`\\s${prefix}:study=(["'])([\\s\\S]*?)\\1`).exec(xmp);
  return attribute ? unescapeXml(attribute[2]) : undefined;
}

/**
 * `tiff` carrying `studyflow`, the text of a `.studyflow.yaml`, in an XMP packet (tag 700), and a line saying so in its
 * ImageDescription. The pixels, and the pasted images, stay as they are.
 */
export function embedStudyflowIntoTiff(tiff: Uint8Array, studyflow: string, about: StudyflowTiffAbout): Uint8Array {
  const encoder = new TextEncoder();
  return withTags(tiff, new Map<number, TagValue>([
    [TAG.xmp, { type: TYPE.byte, data: encoder.encode(xmpPacket(studyflow, about)) }],
    [TAG.imageDescription, { type: TYPE.ascii, data: encoder.encode(`${description(about)}\0`) }],
  ]));
}

/** The text {@link embedStudyflowIntoTiff} put in the TIFF. */
export function extractStudyflowFromTiff(content: ArrayBuffer | Uint8Array): string {
  const xmp = tiffXmp(content);
  const studyflow = xmp === undefined ? undefined : studyflowInXmp(xmp);
  if (studyflow === undefined) throw new Error('The selected TIFF file does not contain embedded Studyflow.');
  return studyflow;
}

/* --- the pasted images, in a tag of their own --- */

/** `tiff` carrying exactly `images`, each a PNG's bytes by the id its pasted image names; whatever it carried goes. */
export function embedPastedImagesIntoTiff(tiff: Uint8Array, images: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const records: Uint8Array[] = [];
  for (const [id, bytes] of images) {
    const name = new TextEncoder().encode(id);
    const record = new Uint8Array(name.length + 5 + bytes.length);
    record.set(name, 0);
    new DataView(record.buffer).setUint32(name.length + 1, bytes.length);
    record.set(bytes, name.length + 5);
    records.push(record);
  }
  const data = new Uint8Array(records.reduce((total, record) => total + record.length, 0));
  let offset = 0;
  for (const record of records) {
    data.set(record, offset);
    offset += record.length;
  }
  return withTags(tiff, new Map([[TAG.pastedImages, images.size === 0 ? undefined : { type: TYPE.undefined, data }]]));
}

/** The images {@link embedPastedImagesIntoTiff} put in the TIFF, by id; a record that does not hold a PNG is passed over. */
export function extractPastedImagesFromTiff(content: ArrayBuffer | Uint8Array): Map<string, Uint8Array> {
  const tiff = tiffOf(content);
  const images = new Map<string, Uint8Array>();
  const entry = entryOf(directory(tiff), TAG.pastedImages);
  if (!entry) return images;
  const data = valueOf(tiff, entry);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;
  while (offset < data.length) {
    const idEnd = data.indexOf(0, offset);
    if (idEnd < 0 || idEnd + 5 > data.length) break;
    const length = view.getUint32(idEnd + 1);
    const bytes = data.slice(idEnd + 5, idEnd + 5 + length);
    if (bytes.length < length) break;
    if (idEnd > offset && isPng(bytes)) images.set(new TextDecoder().decode(data.subarray(offset, idEnd)), bytes);
    offset = idEnd + 5 + length;
  }
  return images;
}

/* --- writing --- */

/** An image as pixels: rows top to bottom, each pixel its channels in order, 1 (grey), 3 (RGB) or 4 (RGBA) bytes. */
export type Raster = { width: number; height: number; channels: 1 | 3 | 4; pixels: Uint8Array };

/** A strip holds about this much before compression: one strip of a small image, a few dozen of a figure. */
const STRIP_BYTES = 1 << 20;

/** A value as the RATIONAL a resolution tag holds: whole when it is, else to a ten-thousandth. */
const rational = (value: number): [number, number] => (Number.isInteger(value) ? [value, 1] : [Math.round(value * 10000), 10000]);

/** `raster`'s rows `from` to `to` as 8-bit RGB, a grey pixel spread over the channels and an alpha flattened on white. */
function rgbRows(raster: Raster, from: number, to: number): Uint8Array {
  const { width, channels, pixels } = raster;
  const out = new Uint8Array((to - from) * width * 3);
  const count = (to - from) * width;
  let read = from * width * channels;
  for (let i = 0, write = 0; i < count; i++, write += 3) {
    if (channels === 1) {
      out[write] = out[write + 1] = out[write + 2] = pixels[read++];
    } else if (channels === 3) {
      out[write] = pixels[read++];
      out[write + 1] = pixels[read++];
      out[write + 2] = pixels[read++];
    } else {
      const alpha = pixels[read + 3];
      const white = 255 * (255 - alpha) + 127;
      out[write] = (pixels[read] * alpha + white) / 255;
      out[write + 1] = (pixels[read + 1] * alpha + white) / 255;
      out[write + 2] = (pixels[read + 2] * alpha + white) / 255;
      read += 4;
    }
  }
  return out;
}

/**
 * `raster` as a TIFF: little-endian, 8-bit RGB in LZW strips, printing at `dpi` dots per inch (one value, or one an
 * axis). The study goes in afterwards, with {@link embedStudyflowIntoTiff}.
 */
export function encodeTiff(raster: Raster, dpi: number | { x: number; y: number }): Uint8Array {
  const { width, height } = raster;
  if (!(width > 0 && height > 0) || raster.pixels.length < width * height * raster.channels) throw new Error('The image has no pixels to write.');
  const resolution = typeof dpi === 'number' ? { x: dpi, y: dpi } : dpi;
  const rowsPerStrip = Math.max(1, Math.min(height, Math.floor(STRIP_BYTES / (width * 3))));
  const strips: Uint8Array[] = [];
  for (let row = 0; row < height; row += rowsPerStrip) strips.push(lzwEncode(rgbRows(raster, row, Math.min(height, row + rowsPerStrip))));

  // The strips first, then the values too long for their entries, then the directory, last: a tag rewrite then has
  // nothing beyond its reach to keep.
  let length = TIFF_HEAD;
  const stripOffsets = strips.map((strip) => {
    const offset = length;
    length += strip.length + (strip.length % 2);
    return offset;
  });
  const values: Array<{ tag: number; type: number; count: number; data: Uint8Array; offset?: number }> = [];
  const little = true;
  const shorts = (...numbers: number[]): Uint8Array => {
    const data = new Uint8Array(numbers.length * 2);
    numbers.forEach((n, i) => new DataView(data.buffer).setUint16(i * 2, n, little));
    return data;
  };
  const longs = (...numbers: number[]): Uint8Array => {
    const data = new Uint8Array(numbers.length * 4);
    numbers.forEach((n, i) => new DataView(data.buffer).setUint32(i * 4, n, little));
    return data;
  };
  const rationals = (value: number): Uint8Array => longs(...rational(value));
  const entry = (tag: number, type: number, count: number, data: Uint8Array): void => {
    const offset = data.length > 4 ? length : undefined;
    if (offset !== undefined) length += data.length + (data.length % 2);
    values.push({ tag, type, count, data, offset });
  };
  entry(TAG.imageWidth, TYPE.long, 1, longs(width));
  entry(TAG.imageLength, TYPE.long, 1, longs(height));
  entry(TAG.bitsPerSample, TYPE.short, 3, shorts(8, 8, 8));
  entry(TAG.compression, TYPE.short, 1, shorts(LZW));
  entry(TAG.photometric, TYPE.short, 1, shorts(RGB));
  entry(TAG.stripOffsets, TYPE.long, strips.length, longs(...stripOffsets));
  entry(TAG.samplesPerPixel, TYPE.short, 1, shorts(3));
  entry(TAG.rowsPerStrip, TYPE.long, 1, longs(rowsPerStrip));
  entry(TAG.stripByteCounts, TYPE.long, strips.length, longs(...strips.map((strip) => strip.length)));
  entry(TAG.xResolution, TYPE.rational, 1, rationals(resolution.x));
  entry(TAG.yResolution, TYPE.rational, 1, rationals(resolution.y));
  entry(TAG.planarConfiguration, TYPE.short, 1, shorts(1));
  entry(TAG.resolutionUnit, TYPE.short, 1, shorts(INCH));
  const at = length;
  length += 2 + values.length * 12 + 4;

  const out = new Uint8Array(length);
  const view = new DataView(out.buffer);
  out.set([0x49, 0x49, 42, 0]);
  view.setUint32(4, at, little);
  strips.forEach((strip, i) => out.set(strip, stripOffsets[i]));
  view.setUint16(at, values.length, little);
  values.forEach((value, i) => {
    const cursor = at + 2 + i * 12;
    view.setUint16(cursor, value.tag, little);
    view.setUint16(cursor + 2, value.type, little);
    view.setUint32(cursor + 4, value.count, little);
    if (value.offset !== undefined) {
      out.set(value.data, value.offset);
      view.setUint32(cursor + 8, value.offset, little);
    } else out.set(value.data, cursor + 8);
  });
  view.setUint32(at + 2 + values.length * 12, 0, little);
  return out;
}

/* --- LZW, as TIFF spells it --- */

const CLEAR = 256;
const END = 257;
const FIRST = 258;
/** Codes grow from 9 to 12 bits; at this many entries the table is cleared, as libtiff clears it. */
const TABLE_FULL = 4094;
/** The hash table over (prefix, byte): a prime past the table's size, so a probe always finds a slot. */
const HASH_SIZE = 9001;

/**
 * `data` LZW-compressed as a TIFF strip holds it: a Clear code first, codes packed most significant bit first, nine
 * bits wide until entry 511 is in the table, then ten, eleven and twelve, the table cleared when it is full.
 */
function lzwEncode(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(data.length * 1.5) + 16);
  let write = 0;
  let bits = 0;
  let held = 0;
  let width = 9;
  const emit = (code: number): void => {
    bits = (bits << width) | code;
    held += width;
    while (held >= 8) {
      out[write++] = (bits >>> (held - 8)) & 0xff;
      held -= 8;
    }
    bits &= (1 << held) - 1;
  };
  const keys = new Int32Array(HASH_SIZE).fill(-1);
  const codes = new Uint16Array(HASH_SIZE);
  let next = FIRST;

  emit(CLEAR);
  if (data.length === 0) {
    emit(END);
  } else {
    let prefix = data[0];
    for (let i = 1; i < data.length; i++) {
      const byte = data[i];
      const key = (prefix << 8) | byte;
      let slot = (Math.imul(key, 0x9e3779b1) >>> 0) % HASH_SIZE;
      while (keys[slot] !== -1 && keys[slot] !== key) slot = slot + 1 === HASH_SIZE ? 0 : slot + 1;
      if (keys[slot] === key) {
        prefix = codes[slot];
        continue;
      }
      emit(prefix);
      keys[slot] = key;
      codes[slot] = next++;
      prefix = byte;
      if (next === TABLE_FULL) {
        emit(CLEAR);
        keys.fill(-1);
        next = FIRST;
        width = 9;
      } else if (next > (1 << width) - 1) {
        width++;
      }
    }
    emit(prefix);
    emit(END);
  }
  if (held > 0) out[write++] = (bits << (8 - held)) & 0xff;
  return out.slice(0, write);
}
