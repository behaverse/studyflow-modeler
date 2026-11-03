import { inflateSync } from 'node:zlib';

import { isPng, type Raster } from '@core/document';

/* The pixels of a PNG, for re-encoding as a TIFF: its image data inflated, its filters undone, 8 bits a channel. */

/** The channels a PNG colour type has before any palette: grey, RGB, a palette index, grey and alpha, RGBA. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

type Chunks = { width: number; height: number; depth: number; colorType: number; interlaced: boolean; palette?: Uint8Array; alpha?: Uint8Array; data: Buffer };

function chunksOf(png: Uint8Array): Chunks {
  if (!isPng(png)) throw new Error('The file is not a valid PNG.');
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const image: Buffer[] = [];
  let head: Omit<Chunks, 'data' | 'palette' | 'alpha'> | undefined;
  let palette: Uint8Array | undefined;
  let alpha: Uint8Array | undefined;
  for (let offset = 8; offset + 8 <= png.length;) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') head = { width: view.getUint32(offset + 8), height: view.getUint32(offset + 12), depth: data[8], colorType: data[9], interlaced: data[12] !== 0 };
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') alpha = data;
    else if (type === 'IDAT') image.push(Buffer.from(data));
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (!head || image.length === 0) throw new Error('The file is not a valid PNG.');
  return { ...head, palette, alpha, data: inflateSync(Buffer.concat(image)) };
}

/** `rows` as the PNG filtered them, undone in place: each row's filter byte says how it was taken from the row above. */
function unfilter(data: Buffer, rows: Uint8Array, height: number, rowBytes: number, bytesPerPixel: number): void {
  if (data.length < height * (rowBytes + 1)) throw new Error('The PNG holds fewer pixels than its header says.');
  for (let y = 0; y < height; y++) {
    const filter = data[y * (rowBytes + 1)];
    const from = y * (rowBytes + 1) + 1;
    const to = y * rowBytes;
    const above = (y - 1) * rowBytes;
    for (let i = 0; i < rowBytes; i++) {
      const raw = data[from + i];
      const left = i >= bytesPerPixel ? rows[to + i - bytesPerPixel] : 0;
      const up = y > 0 ? rows[above + i] : 0;
      const upLeft = y > 0 && i >= bytesPerPixel ? rows[above + i - bytesPerPixel] : 0;
      let predicted: number;
      switch (filter) {
        case 0: predicted = 0; break;
        case 1: predicted = left; break;
        case 2: predicted = up; break;
        case 3: predicted = (left + up) >> 1; break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          break;
        }
        default: throw new Error(`The PNG uses a filter this reader does not know (${filter}).`);
      }
      rows[to + i] = (raw + predicted) & 0xff;
    }
  }
}

/** The pixels of `png` as a raster: grey, RGB, or RGBA where it has an alpha (a palette with a tRNS chunk too). */
export function pngRaster(png: Uint8Array): Raster {
  const { width, height, depth, colorType, interlaced, palette, alpha, data } = chunksOf(png);
  const channels = CHANNELS[colorType];
  if (!channels || ![1, 2, 4, 8, 16].includes(depth)) throw new Error(`The PNG's colour type ${colorType} at ${depth} bits is not one this reader takes.`);
  if (interlaced) throw new Error('An interlaced PNG cannot be re-encoded here: save it without interlacing first.');
  if (colorType === 3 && !palette) throw new Error('The PNG names a palette it does not carry.');

  const bitsPerPixel = channels * depth;
  const rowBytes = Math.ceil((width * bitsPerPixel) / 8);
  const rows = new Uint8Array(rowBytes * height);
  unfilter(data, rows, height, rowBytes, Math.max(1, bitsPerPixel >> 3));

  // A sample of fewer than 8 bits, read out of its byte; of 16, its high byte.
  const scale = depth < 8 ? 255 / ((1 << depth) - 1) : 1;
  const sample = (row: number, index: number): number => {
    if (depth === 8) return rows[row * rowBytes + index];
    if (depth === 16) return rows[row * rowBytes + index * 2];
    const bit = index * depth;
    return (rows[row * rowBytes + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
  };

  const out: Raster['channels'] = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 && !alpha ? 3 : 4;
  const pixels = new Uint8Array(width * height * out);
  let write = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      switch (colorType) {
        case 0: pixels[write++] = sample(y, x) * scale; break;
        case 2: for (let c = 0; c < 3; c++) pixels[write++] = sample(y, x * 3 + c); break;
        case 3: {
          const index = sample(y, x);
          pixels[write++] = palette![index * 3];
          pixels[write++] = palette![index * 3 + 1];
          pixels[write++] = palette![index * 3 + 2];
          if (alpha) pixels[write++] = index < alpha.length ? alpha[index] : 255;
          break;
        }
        case 4: {
          const grey = sample(y, x * 2) * scale;
          pixels[write++] = grey;
          pixels[write++] = grey;
          pixels[write++] = grey;
          pixels[write++] = sample(y, x * 2 + 1) * scale;
          break;
        }
        default: for (let c = 0; c < 4; c++) pixels[write++] = sample(y, x * 4 + c);
      }
    }
  }
  return { width, height, channels: out, pixels };
}
