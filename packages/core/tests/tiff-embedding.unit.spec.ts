import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import {
  embedPastedImagesIntoTiff,
  embedStudyflowIntoTiff,
  encodeTiff,
  extractPastedImagesFromTiff,
  extractStudyflowFromTiff,
  isTiff,
  tiffResolution,
  tiffSize,
  tiffXmp,
  type Raster,
} from '@core/document/tiff';

/** Tag-level coverage of the TIFF round-trip contract, and of the writer, whose strips are decoded here. */

const ABOUT = { id: 'etude', name: 'Étude', digest: 'sha256:0123456789abcdef', creatorTool: 'studyflow-modeler/test' };

/** The directory a reader of either byte order finds first: each tag's type, count and value bytes. */
function directoryOf(bytes: Uint8Array): { little: boolean; at: number; tags: Map<number, { type: number; count: number; value: Uint8Array; numbers: number[] }> } {
  const little = bytes[0] === 0x49;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sizes = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4];
  const at = view.getUint32(4, little);
  const tags = new Map();
  for (let i = 0; i < view.getUint16(at, little); i++) {
    const entry = at + 2 + i * 12;
    const type = view.getUint16(entry + 2, little);
    const count = view.getUint32(entry + 4, little);
    const size = sizes[type] * count;
    const offset = size <= 4 ? entry + 8 : view.getUint32(entry + 8, little);
    const value = bytes.subarray(offset, offset + size);
    const numbers = Array.from({ length: count }, (_, n) => (type === 3 ? view.getUint16(offset + n * 2, little)
      : type === 4 ? view.getUint32(offset + n * 4, little)
        : type === 5 ? view.getUint32(offset + n * 8, little) / view.getUint32(offset + n * 8 + 4, little) : value[n]));
    tags.set(view.getUint16(entry, little), { type, count, value, numbers });
  }
  return { little, at, tags };
}

/** A strip's LZW undone, as the TIFF specification reads it: codes most significant bit first, widths changing one entry early. */
function lzwDecode(data: Uint8Array): Uint8Array {
  let out = new Uint8Array(1024);
  let length = 0;
  let bit = 0;
  let width = 9;
  let table: Uint8Array[] = [];
  const reset = (): void => {
    table = Array.from({ length: 258 }, (_, i) => (i < 256 ? Uint8Array.of(i) : new Uint8Array(0)));
    width = 9;
  };
  const read = (): number => {
    let code = 0;
    for (let i = 0; i < width; i++, bit++) code = (code << 1) | ((data[bit >> 3] >> (7 - (bit & 7))) & 1);
    return code;
  };
  const push = (entry: Uint8Array): void => {
    if (length + entry.length > out.length) {
      const grown = new Uint8Array(Math.max(out.length * 2, length + entry.length));
      grown.set(out);
      out = grown;
    }
    out.set(entry, length);
    length += entry.length;
  };
  reset();
  let previous: Uint8Array | undefined;
  while (bit + width <= data.length * 8) {
    const code = read();
    if (code === 257) break;
    if (code === 256) {
      reset();
      previous = undefined;
      continue;
    }
    let entry: Uint8Array;
    if (code < table.length) {
      entry = table[code];
      if (previous) table.push(Uint8Array.of(...previous, entry[0]));
    } else if (previous && code === table.length) {
      entry = Uint8Array.of(...previous, previous[0]);
      table.push(entry);
    } else throw new Error(`code ${code} with ${table.length} entries`);
    push(entry);
    previous = entry;
    if (table.length + 1 >= 1 << width && width < 12) width++;
  }
  return out.subarray(0, length);
}

/** The pixels a TIFF's strips hold, decoded: what the writer put in. */
function pixelsOf(tiff: Uint8Array): Uint8Array {
  const { tags } = directoryOf(tiff);
  const offsets = tags.get(273)!.numbers;
  const counts = tags.get(279)!.numbers;
  const strips = offsets.map((offset, i) => lzwDecode(tiff.subarray(offset, offset + counts[i])));
  const out = new Uint8Array(strips.reduce((total, strip) => total + strip.length, 0));
  let at = 0;
  for (const strip of strips) {
    out.set(strip, at);
    at += strip.length;
  }
  return out;
}

/** A TIFF of one pixel, in either byte order, with `extra` tags besides: a stand-in for one another tool wrote. */
function tinyTiff(little: boolean, extra: Array<{ tag: number; type: number; data: Uint8Array }> = []): Uint8Array {
  const entries = [
    { tag: 256, type: 4, data: Uint8Array.of(1, 0, 0, 0) }, { tag: 257, type: 4, data: Uint8Array.of(1, 0, 0, 0) },
    { tag: 258, type: 3, data: Uint8Array.of(8, 0, 8, 0, 8, 0) }, { tag: 259, type: 3, data: Uint8Array.of(1, 0) },
    { tag: 262, type: 3, data: Uint8Array.of(2, 0) }, { tag: 273, type: 4, data: Uint8Array.of(8, 0, 0, 0) },
    { tag: 277, type: 3, data: Uint8Array.of(3, 0) }, { tag: 278, type: 4, data: Uint8Array.of(1, 0, 0, 0) },
    { tag: 279, type: 4, data: Uint8Array.of(3, 0, 0, 0) }, ...extra,
  ].sort((a, b) => a.tag - b.tag);
  // Numbers above are spelled little-endian; a big-endian file has them the other way round.
  const swapped = (entry: typeof entries[number]): Uint8Array => {
    if (little || entry.type === 1 || entry.type === 2 || entry.type === 7) return entry.data;
    const size = entry.type === 3 ? 2 : 4;
    const out = new Uint8Array(entry.data.length);
    for (let i = 0; i < out.length; i += size) out.set(entry.data.subarray(i, i + size).reverse(), i);
    return out;
  };
  const sizes = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4];
  let length = 8 + 4;
  const placed = entries.map((entry) => {
    const data = swapped(entry);
    const offset = data.length > 4 ? length : undefined;
    if (offset !== undefined) length += data.length + (data.length % 2);
    return { ...entry, data, offset, count: data.length / sizes[entry.type] };
  });
  const at = length;
  const out = new Uint8Array(at + 2 + placed.length * 12 + 4);
  const view = new DataView(out.buffer);
  out.set(little ? [0x49, 0x49, 42, 0] : [0x4d, 0x4d, 0, 42]);
  view.setUint32(4, at, little);
  out.set([250, 128, 7], 8);
  view.setUint16(at, placed.length, little);
  placed.forEach((entry, i) => {
    const cursor = at + 2 + i * 12;
    view.setUint16(cursor, entry.tag, little);
    view.setUint16(cursor + 2, entry.type, little);
    view.setUint32(cursor + 4, entry.count, little);
    if (entry.offset === undefined) out.set(entry.data, cursor + 8);
    else {
      out.set(entry.data, entry.offset);
      view.setUint32(cursor + 8, entry.offset, little);
    }
  });
  return out;
}

const ascii = (tiff: Uint8Array, tag: number): string => new TextDecoder().decode(directoryOf(tiff).tags.get(tag)?.value ?? new Uint8Array()).replace(/\0$/, '');

/** A raster of `width` by `height`, its pixels from a seeded generator, so a run is the same as the last. */
function noise(width: number, height: number, channels: Raster['channels'], seed = 7): Raster {
  const pixels = new Uint8Array(width * height * channels);
  let state = seed;
  for (let i = 0; i < pixels.length; i++) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    pixels[i] = state >>> 24;
  }
  return { width, height, channels, pixels };
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Enough of a PNG for {@link extractPastedImagesFromTiff} to take it for one. */
const png = (...tail: number[]): Uint8Array => Uint8Array.of(...PNG_SIGNATURE, ...new Array(16).fill(0), ...tail);

const SIPS = new Uint8Array(readFileSync(path.join(process.cwd(), 'packages/core/tests/fixtures/sips.tif')));

test.describe('TIFF studyflow embedding', () => {
  test('writes a little-endian LZW TIFF whose strips decode to the pixels given, grey spread and alpha flattened on white', () => {
    const rgba: Raster = { width: 3, height: 2, channels: 4, pixels: Uint8Array.of(
      255, 0, 0, 255, 0, 0, 255, 0, 0, 0, 255, 128,
      10, 20, 30, 255, 200, 100, 0, 64, 255, 255, 255, 255,
    ) };
    const tiff = encodeTiff(rgba, 300);
    expect(isTiff(tiff)).toBe(true);
    expect(tiffSize(tiff)).toEqual({ width: 3, height: 2 });
    expect(tiffResolution(tiff)).toEqual({ x: 300, y: 300 });
    const { little, tags } = directoryOf(tiff);
    expect(little).toBe(true);
    // 8-bit RGB, LZW, the print size in inches, and one strip holding both rows.
    expect([258, 259, 262, 277, 278, 284, 296].map((tag) => tags.get(tag)!.numbers)).toEqual([[8, 8, 8], [5], [2], [3], [2], [1], [2]]);
    expect([...tags.keys()]).toEqual([...tags.keys()].sort((a, b) => a - b));
    // A transparent pixel is white, a half-transparent one halfway to it, and an opaque one as it was.
    expect(Array.from(pixelsOf(tiff))).toEqual([255, 0, 0, 255, 255, 255, 127, 127, 255, 10, 20, 30, 241, 216, 191, 255, 255, 255]);

    const grey: Raster = { width: 2, height: 1, channels: 1, pixels: Uint8Array.of(0, 200) };
    expect(Array.from(pixelsOf(encodeTiff(grey, { x: 72, y: 96.5 })))).toEqual([0, 0, 0, 200, 200, 200]);
    expect(tiffResolution(encodeTiff(grey, { x: 72, y: 96.5 }))).toEqual({ x: 72, y: 96.5 });
  });

  test('compresses a strip through every code width and a cleared table, and cuts a figure into strips', () => {
    // Noise fills the table many times over; the last strip is short.
    const raster = noise(1000, 400, 3);
    const tiff = encodeTiff(raster, 300);
    const { tags } = directoryOf(tiff);
    expect(tags.get(273)!.count).toBe(2);
    expect(tags.get(278)!.numbers).toEqual([349]);
    expect(Array.from(pixelsOf(tiff))).toEqual(Array.from(raster.pixels));
    // Flat colour, the body of a diagram, compresses to little.
    const flat: Raster = { width: 500, height: 100, channels: 3, pixels: new Uint8Array(500 * 100 * 3).fill(255) };
    expect(encodeTiff(flat, 300).length).toBeLessThan(1500);
    expect(pixelsOf(encodeTiff(flat, 300)).every((byte) => byte === 255)).toBe(true);
  });

  test('round-trips the studyflow YAML through an XMP packet that says what the image is, and says so in the description', () => {
    const yaml = 'id: etude\ndefinitions:\n  name: Étude <&> 実験\n';
    const tiff = embedStudyflowIntoTiff(encodeTiff(noise(4, 4, 3), 300), yaml, ABOUT);

    expect(extractStudyflowFromTiff(tiff)).toBe(yaml);
    // FileReader hands over an ArrayBuffer.
    expect(extractStudyflowFromTiff(tiff.slice().buffer)).toBe(yaml);
    const xmp = tiffXmp(tiff)!;
    expect(xmp.startsWith('<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>')).toBe(true);
    expect(xmp.endsWith('<?xpacket end="w"?>')).toBe(true);
    expect(xmp).toContain('<dc:format>image/tiff</dc:format>');
    expect(xmp).toContain('<rdf:li xml:lang="x-default">Étude</rdf:li>');
    expect(xmp).toContain('<xmp:CreatorTool>studyflow-modeler/test</xmp:CreatorTool>');
    expect(xmp).toContain('xmlns:studyflow="http://behaverse.org/schemas/studyflow/xmp/1.0/"');
    expect(xmp).toContain('<studyflow:format>application/vnd.studyflow+yaml</studyflow:format>');
    expect(xmp).toContain('<studyflow:digest>sha256:0123456789abcdef</studyflow:digest>');
    expect(xmp).toContain('<studyflow:study>id: etude\ndefinitions:\n  name: Étude &lt;&amp;&gt; 実験\n</studyflow:study>');
    // The tag is bytes, a packet a tool that edits XMP in place has room in.
    expect(directoryOf(tiff).tags.get(700)!.type).toBe(1);
    expect(xmp.length - xmp.indexOf('</x:xmpmeta>')).toBeGreaterThan(2000);
    expect(ascii(tiff, 270)).toBe('Studyflow study etude, sha256:0123456789abcdef: studyflow in XMP');

    // The pixels are untouched, and a second embedding replaces the first: the file does not grow.
    expect(Array.from(pixelsOf(tiff))).toEqual(Array.from(noise(4, 4, 3).pixels));
    const again = embedStudyflowIntoTiff(tiff, 'id: new\n', ABOUT);
    expect(extractStudyflowFromTiff(again)).toBe('id: new\n');
    expect(again.length).toBe(embedStudyflowIntoTiff(encodeTiff(noise(4, 4, 3), 300), 'id: new\n', ABOUT).length);
    expect(tiffXmp(again)).not.toContain('etude');
  });

  test('embeds into a TIFF another tool wrote, in its byte order, leaving every byte of it where it was', () => {
    // packages/core/tests/fixtures/sips.tif: `sips -c 8 12 assets/img/favicon.png --out small.png && sips -s format tiff
    // -s dpiWidth 300 -s dpiHeight 300 small.png --out sips.tif`. Big-endian, RGBA, an EXIF directory and an ICC profile.
    expect(SIPS[0]).toBe(0x4d);
    expect(tiffSize(SIPS)).toEqual({ width: 12, height: 8 });
    expect(tiffResolution(SIPS)).toEqual({ x: 300, y: 300 });
    const images = new Map([['one', png(1)], ['two', png(2, 2)]]);

    const tiff = embedPastedImagesIntoTiff(embedStudyflowIntoTiff(SIPS, 'id: sips\n', ABOUT), images);
    expect(tiff.length).toBeGreaterThan(SIPS.length);
    expect(Array.from(tiff.subarray(0, 4))).toEqual([0x4d, 0x4d, 0, 42]);
    expect(Buffer.from(tiff.subarray(8, SIPS.length)).equals(Buffer.from(SIPS.subarray(8)))).toBe(true);
    expect(extractStudyflowFromTiff(tiff)).toBe('id: sips\n');
    expect(extractPastedImagesFromTiff(tiff)).toEqual(images);
    expect(tiffSize(tiff)).toEqual({ width: 12, height: 8 });
    expect(tiffResolution(tiff)).toEqual({ x: 300, y: 300 });
    // The directory it has now says what the old one said, the EXIF directory and the profile where they were.
    const before = directoryOf(SIPS).tags;
    const after = directoryOf(tiff).tags;
    expect([...after.keys()]).toEqual([...before.keys(), 65300].concat([270, 700]).sort((a, b) => a - b));
    for (const [tag, entry] of before) expect(after.get(tag)!.numbers, String(tag)).toEqual(entry.numbers);
    expect(after.get(34665)!.numbers).toEqual([8]);
    expect(Buffer.from(after.get(34675)!.value).equals(Buffer.from(before.get(34675)!.value))).toBe(true);
    const strip = (bytes: Uint8Array) => Buffer.from(bytes.subarray(directoryOf(bytes).tags.get(273)!.numbers[0], directoryOf(bytes).tags.get(273)!.numbers[0] + 384));
    expect(strip(tiff).equals(strip(SIPS))).toBe(true);

    // Embedding again replaces the tail this put on the file, so the file is no longer than after the first time.
    const again = embedStudyflowIntoTiff(tiff, 'id: again\n', ABOUT);
    expect(again.length).toBe(embedPastedImagesIntoTiff(embedStudyflowIntoTiff(SIPS, 'id: again\n', ABOUT), images).length);
    expect(extractStudyflowFromTiff(again)).toBe('id: again\n');
    expect(extractPastedImagesFromTiff(again)).toEqual(images);
  });

  test('rejects a TIFF that carries no studyflow, and bytes that are not a classic TIFF', () => {
    expect(() => extractStudyflowFromTiff(SIPS)).toThrow(/Studyflow/i);
    expect(() => extractStudyflowFromTiff(encodeTiff(noise(2, 2, 3), 72))).toThrow(/Studyflow/i);
    const notTiff = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(() => extractStudyflowFromTiff(notTiff)).toThrow(/TIFF/);
    expect(() => embedStudyflowIntoTiff(notTiff, 'id: x\n', ABOUT)).toThrow(/TIFF/);
    expect(isTiff(notTiff)).toBe(false);
    // A BigTIFF: the magic is 43, and its offsets are eight bytes, which this reader does not follow.
    expect(isTiff(Uint8Array.of(0x49, 0x49, 43, 0, 8, 0, 0, 0, 16, 0, 0, 0, 0, 0, 0, 0))).toBe(false);
    // A packet with no study in it.
    const packet = new TextEncoder().encode('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:format>image/tiff</dc:format></rdf:Description></rdf:RDF></x:xmpmeta>');
    expect(() => extractStudyflowFromTiff(tinyTiff(true, [{ tag: 700, type: 1, data: packet }]))).toThrow(/Studyflow/i);
  });

  test('reads the study out of a packet another tool rewrote, under its own prefix or as an attribute, in either byte order', () => {
    const element = new TextEncoder().encode('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
      + '<rdf:Description rdf:about="" xmlns:sf="http://behaverse.org/schemas/studyflow/xmp/1.0/"><sf:study>id: element\nname: a &amp; b\n</sf:study></rdf:Description></rdf:RDF></x:xmpmeta>\0');
    const attribute = new TextEncoder().encode('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
      + '<rdf:Description rdf:about="" xmlns:ns0=\'http://behaverse.org/schemas/studyflow/xmp/1.0/\' ns0:study="id: attribute&#10;name: &quot;q&quot; &#x3C;&#62;&#10;"/></rdf:RDF></x:xmpmeta>');
    for (const little of [true, false]) {
      expect(extractStudyflowFromTiff(tinyTiff(little, [{ tag: 700, type: 7, data: element }])), String(little)).toBe('id: element\nname: a & b\n');
      expect(extractStudyflowFromTiff(tinyTiff(little, [{ tag: 700, type: 1, data: attribute }])), String(little)).toBe('id: attribute\nname: "q" <>\n');
      // A study this module writes into a file of either order reads back, and the file keeps its order.
      const tiff = embedStudyflowIntoTiff(tinyTiff(little), 'id: tiny\n', ABOUT);
      expect(tiff[0]).toBe(little ? 0x49 : 0x4d);
      expect(directoryOf(tiff).little).toBe(little);
      expect(extractStudyflowFromTiff(tiff)).toBe('id: tiny\n');
      expect(tiffSize(tiff)).toEqual({ width: 1, height: 1 });
      expect(Array.from(tiff.subarray(8, 11))).toEqual([250, 128, 7]);
    }
  });

  test('pasted images ride in a tag of their own: a new study leaves them, a new set replaces them, none drops the tag, and junk is passed over', () => {
    const first = png(1);
    const second = png(2, 2, 2);
    const images = new Map([['one', first], ['two', second]]);

    const tiff = embedStudyflowIntoTiff(embedPastedImagesIntoTiff(embedStudyflowIntoTiff(encodeTiff(noise(2, 2, 3), 72), 'id: old\n', ABOUT), images), 'id: new\n', ABOUT);
    expect(extractStudyflowFromTiff(tiff)).toBe('id: new\n');
    expect(extractPastedImagesFromTiff(tiff)).toEqual(images);
    expect(extractPastedImagesFromTiff(tiff.slice().buffer)).toEqual(images);
    expect(directoryOf(tiff).tags.get(65300)!.type).toBe(7);

    const replaced = embedPastedImagesIntoTiff(tiff, new Map([['two', second]]));
    expect([...extractPastedImagesFromTiff(replaced).keys()]).toEqual(['two']);
    expect(extractStudyflowFromTiff(replaced)).toBe('id: new\n');
    const none = embedPastedImagesIntoTiff(tiff, new Map());
    expect(extractPastedImagesFromTiff(none).size).toBe(0);
    expect(directoryOf(none).tags.has(65300)).toBe(false);
    expect(extractPastedImagesFromTiff(encodeTiff(noise(2, 2, 3), 72)).size).toBe(0);

    const notAnImage = new TextEncoder().encode('<svg onload="alert(1)"/>');
    const record = Uint8Array.of(...new TextEncoder().encode('junk'), 0, 0, 0, 0, notAnImage.length, ...notAnImage);
    const forged = tinyTiff(true, [{ tag: 65300, type: 7, data: record }]);
    expect(extractPastedImagesFromTiff(forged).size).toBe(0);
  });
});
