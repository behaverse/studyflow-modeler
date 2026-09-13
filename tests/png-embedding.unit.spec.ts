import { expect, test } from '@playwright/test';

import {
  embedStudyflowIntoPng,
  extractStudyflowFromPng,
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



test.describe('PNG studyflow embedding', () => {
  test('round-trips the studyflow YAML, including non-Latin-1 text', () => {
    const yaml = 'id: etude\ndefinitions:\n  name: Étude — 実験\n';

    const png = embedStudyflowIntoPng(minimalPng(), yaml);

    expect(extractStudyflowFromPng(png)).toBe(yaml);
    expect(Array.from(png.subarray(0, 8))).toEqual(PNG_SIGNATURE);
    expect(String.fromCharCode(...png.subarray(png.length - 8, png.length - 4))).toBe('IEND');
  });

  test('a second embedding replaces the first', () => {
    const png = embedStudyflowIntoPng(embedStudyflowIntoPng(minimalPng(), 'id: old\n'), 'id: new\n');

    expect(extractStudyflowFromPng(png)).toBe('id: new\n');
    expect(png.length).toBe(embedStudyflowIntoPng(minimalPng(), 'id: new\n').length);
  });

  test('extraction accepts an ArrayBuffer (as delivered by FileReader)', () => {
    const png = embedStudyflowIntoPng(minimalPng(), 'id: x\n');
    const buffer = new ArrayBuffer(png.byteLength);
    new Uint8Array(buffer).set(png);

    expect(extractStudyflowFromPng(buffer)).toBe('id: x\n');
  });

  test('throws on a PNG without embedded studyflow', () => {
    expect(() => extractStudyflowFromPng(minimalPng())).toThrow(/does not contain embedded Studyflow/);
  });

  test('throws on non-PNG bytes', () => {
    const notPng = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(() => extractStudyflowFromPng(notPng)).toThrow(/not a valid PNG/);
    expect(() => embedStudyflowIntoPng(notPng, 'id: x\n')).toThrow(/not a valid PNG/);
  });
});
