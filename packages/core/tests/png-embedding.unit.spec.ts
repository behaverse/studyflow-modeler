import { expect, test } from '@playwright/test';

import {
  embedPastedImagesIntoPng,
  embedStudyflowIntoPng,
  extractPastedImagesFromPng,
  extractStudyflowFromPng,
  isPng,
  pngSize,
  pngToDataUrl,
  dataUrlToBytes,
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
    // FileReader hands over an ArrayBuffer.
    expect(extractStudyflowFromPng(png.slice().buffer)).toBe(yaml);
  });

  test('the chunk is keyed by the MIME type of what it carries, and a second embedding replaces the first', () => {
    const png = embedStudyflowIntoPng(embedStudyflowIntoPng(minimalPng(), 'id: old\n'), 'id: new\n');
    const bytes = Buffer.from(png);
    const data = bytes.indexOf('iTXt') + 4;

    expect(bytes.toString('latin1', data, bytes.indexOf(0, data))).toBe('application/vnd.studyflow+yaml');
    expect(extractStudyflowFromPng(png)).toBe('id: new\n');
    expect(png.length).toBe(embedStudyflowIntoPng(minimalPng(), 'id: new\n').length);
  });

  test('rejects a PNG that carries no studyflow, and bytes that are not a PNG', () => {
    expect(() => extractStudyflowFromPng(minimalPng())).toThrow(/Studyflow/i);
    const notPng = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(() => extractStudyflowFromPng(notPng)).toThrow(/PNG/);
    expect(() => embedStudyflowIntoPng(notPng, 'id: x\n')).toThrow(/PNG/);
  });

  test('pasted images ride in chunks of their own: a new study leaves them, a new set replaces them, and junk is passed over', () => {
    const first = minimalPng();
    const second = concat([minimalPng(), new Uint8Array([1, 2, 3])]);
    const images = new Map([['one', first], ['two', second]]);

    const png = embedStudyflowIntoPng(embedPastedImagesIntoPng(embedStudyflowIntoPng(minimalPng(), 'id: old\n'), images), 'id: new\n');
    expect(extractStudyflowFromPng(png)).toBe('id: new\n');
    expect(extractPastedImagesFromPng(png)).toEqual(images);
    expect(extractPastedImagesFromPng(png.slice().buffer)).toEqual(images);

    const replaced = embedPastedImagesIntoPng(png, new Map([['two', second]]));
    expect([...extractPastedImagesFromPng(replaced).keys()]).toEqual(['two']);
    expect(extractStudyflowFromPng(replaced)).toBe('id: new\n');
    expect(extractPastedImagesFromPng(embedPastedImagesIntoPng(png, new Map())).size).toBe(0);

    const name = new TextEncoder().encode('junk');
    const notAnImage = concat([name, new Uint8Array(1), new TextEncoder().encode('<svg onload="alert(1)"/>')]);
    const end = minimalPng().length - 12;
    const forged = concat([minimalPng().subarray(0, end), pngChunk('stIm', notAnImage), minimalPng().subarray(end)]);
    expect(extractPastedImagesFromPng(forged).size).toBe(0);
  });

  test('reads a PNG as a pasted image needs: whether it is one, its size, and its bytes as a data URL', () => {
    const header = new Uint8Array(13);
    new DataView(header.buffer).setUint32(0, 1200);
    new DataView(header.buffer).setUint32(4, 300);
    const png = concat([new Uint8Array(PNG_SIGNATURE), pngChunk('IHDR', header), pngChunk('IEND', new Uint8Array(0))]);

    expect(isPng(png)).toBe(true);
    expect(isPng(new TextEncoder().encode('not a png at all'))).toBe(false);
    expect(pngSize(png)).toEqual({ width: 1200, height: 300 });

    // More bytes than an argument list holds, as a screenshot has.
    const large = concat([png, new Uint8Array(300_000).fill(7)]);
    const url = pngToDataUrl(large);
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    expect(dataUrlToBytes(url)).toEqual(large);
  });
});
