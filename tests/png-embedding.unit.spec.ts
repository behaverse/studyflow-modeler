import { expect, test } from '@playwright/test';

import {
  embedDrawioIntoPng,
  embedStudyflowIntoPng,
  extractXmlFromPng,
} from '@core/document/png';

/** Pure chunk-level coverage of the PNG round-trip contract. */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(new TextEncoder().encode(type), 4);
  chunk.set(data, 8);
  // CRC left zeroed; the embedding code never validates it.
  return chunk;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function minimalPng(): Uint8Array {
  return concat([
    new Uint8Array(PNG_SIGNATURE),
    pngChunk('IHDR', new Uint8Array(13)),
    pngChunk('IDAT', new Uint8Array(4)),
    pngChunk('IEND', new Uint8Array(0)),
  ]);
}

function chunkTypes(png: Uint8Array): string[] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const types: string[] = [];
  for (let offset = PNG_SIGNATURE.length; offset + 8 <= png.length;) {
    const length = view.getUint32(offset);
    types.push(String.fromCharCode(...png.subarray(offset + 4, offset + 8)));
    offset += 12 + length;
  }
  return types;
}

function readTextChunkBytes(png: Uint8Array, keyword: string): Uint8Array {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  for (let offset = PNG_SIGNATURE.length; offset + 8 <= png.length;) {
    const length = view.getUint32(offset);
    if (String.fromCharCode(...png.subarray(offset + 4, offset + 8)) === 'tEXt') {
      const data = png.subarray(offset + 8, offset + 8 + length);
      const split = data.indexOf(0);
      if (new TextDecoder().decode(data.subarray(0, split)) === keyword) {
        return data.subarray(split + 1);
      }
    }
    offset += 12 + length;
  }
  throw new Error(`no tEXt chunk keyed ${keyword}`);
}

function readTextChunk(png: Uint8Array, keyword: string): string {
  return decodeURIComponent(new TextDecoder().decode(readTextChunkBytes(png, keyword)));
}

test.describe('PNG studyflow embedding', () => {
  test('round-trips the diagram XML, including non-Latin-1 text', () => {
    const xml = '<?xml version="1.0"?>\n<bpmn:definitions name="Étude — 実験" />';

    const png = embedStudyflowIntoPng(minimalPng(), xml);

    expect(extractXmlFromPng(png)).toBe(xml);
    expect(Array.from(png.subarray(0, 8))).toEqual(PNG_SIGNATURE);
    expect(String.fromCharCode(...png.subarray(png.length - 8, png.length - 4))).toBe('IEND');
  });

  test('extraction accepts an ArrayBuffer (as delivered by FileReader)', () => {
    const png = embedStudyflowIntoPng(minimalPng(), '<x/>');
    const buffer = new ArrayBuffer(png.byteLength);
    new Uint8Array(buffer).set(png);

    expect(extractXmlFromPng(buffer)).toBe('<x/>');
  });

  test('throws on a PNG without embedded studyflow', () => {
    expect(() => extractXmlFromPng(minimalPng())).toThrow(/does not contain embedded Studyflow/);
  });

  test('throws on non-PNG bytes', () => {
    const notPng = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(() => extractXmlFromPng(notPng)).toThrow(/not a valid PNG/);
    expect(() => embedStudyflowIntoPng(notPng, '<x/>')).toThrow(/not a valid PNG/);
    expect(() => embedDrawioIntoPng(notPng, '<mxfile/>')).toThrow(/not a valid PNG/);
  });
});

test.describe('PNG draw.io embedding', () => {
  const mxfile = '<mxfile host="studyflow-modeler"><diagram name="Étude — 実験" /></mxfile>';

  test('the mxfile chunk lands ahead of the image data', () => {
    // draw.io stops scanning at the first IDAT, so a chunk parked next to IEND would never be found.
    const png = embedDrawioIntoPng(minimalPng(), mxfile);

    const types = chunkTypes(png);
    expect(types).toEqual(['IHDR', 'tEXt', 'IDAT', 'IEND']);
    expect(types.indexOf('tEXt')).toBeLessThan(types.indexOf('IDAT'));
  });

  test('round-trips the diagram, including non-Latin-1 text', () => {
    const png = embedDrawioIntoPng(minimalPng(), mxfile);

    expect(readTextChunk(png, 'mxfile')).toBe(mxfile);
  });

  test('URL-encoding keeps the payload inside tEXt\'s Latin-1 text field', () => {
    // `tEXt` cannot carry UTF-8; the accented/CJK name survives only because encodeURIComponent yields pure ASCII.
    const bytes = readTextChunkBytes(embedDrawioIntoPng(minimalPng(), mxfile), 'mxfile');

    expect(bytes.length).toBeGreaterThan(0);
    expect(Array.from(bytes).filter((byte) => byte > 0x7f)).toEqual([]);
  });

  test('both payloads coexist in one file', () => {
    const xml = '<?xml version="1.0"?>\n<bpmn:definitions name="Étude" />';

    const png = embedDrawioIntoPng(embedStudyflowIntoPng(minimalPng(), xml), mxfile);

    expect(extractXmlFromPng(png)).toBe(xml);
    expect(readTextChunk(png, 'mxfile')).toBe(mxfile);
    expect(chunkTypes(png)).toEqual(['IHDR', 'tEXt', 'IDAT', 'iTXt', 'IEND']);
  });

  test('re-embedding replaces the payload instead of stacking a second one', () => {
    // Readers take the *first* matching chunk; an appended one would silently keep the stale diagram.
    const first = '<?xml version="1.0"?>\n<bpmn:definitions id="first" />';
    const second = '<?xml version="1.0"?>\n<bpmn:definitions id="second" />';

    const png = embedStudyflowIntoPng(embedStudyflowIntoPng(minimalPng(), first), second);

    expect(extractXmlFromPng(png)).toBe(second);
    expect(chunkTypes(png)).toEqual(['IHDR', 'IDAT', 'iTXt', 'IEND']);

    const both = embedDrawioIntoPng(embedDrawioIntoPng(png, '<mxfile>a</mxfile>'), mxfile);
    expect(readTextChunk(both, 'mxfile')).toBe(mxfile);
    expect(extractXmlFromPng(both)).toBe(second);
    expect(chunkTypes(both)).toEqual(['IHDR', 'tEXt', 'IDAT', 'iTXt', 'IEND']);
  });
});
