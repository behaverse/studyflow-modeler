import { expect, test } from '@playwright/test';

import { embedStudyflowIntoPng, extractXmlFromPng } from '../src/modeler/models/exporters/pngEmbedding';

/**
 * Pure chunk-level coverage of the PNG round-trip contract (the browser end —
 * export via canvas, re-open via the file picker — is covered in
 * modeler.file.spec.ts). A minimal-but-well-formed PNG skeleton is enough:
 * embed/extract walk chunks by declared length and never decode pixels.
 */

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

function minimalPng(): Uint8Array {
  const ihdr = pngChunk('IHDR', new Uint8Array(13));
  const iend = pngChunk('IEND', new Uint8Array(0));
  const png = new Uint8Array(PNG_SIGNATURE.length + ihdr.length + iend.length);
  png.set(PNG_SIGNATURE, 0);
  png.set(ihdr, PNG_SIGNATURE.length);
  png.set(iend, PNG_SIGNATURE.length + ihdr.length);
  return png;
}

test.describe('PNG studyflow embedding', () => {
  test('round-trips the diagram XML, including non-Latin-1 text', () => {
    const xml = '<?xml version="1.0"?>\n<bpmn:definitions name="Étude — 実験" />';

    const png = embedStudyflowIntoPng(minimalPng(), xml);

    expect(extractXmlFromPng(png)).toBe(xml);
    // The signature and trailing IEND survive, so the file is still a PNG.
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
  });
});
