// Generated from src/formats/bmp.js by scripts/build-app.mjs. Edit the source, not this copy.
// BMP and ICO. BMP reads 1, 4, 8, 16, 24 and 32 bit images, top down or bottom up, with
// palettes, bit fields and RLE4 or RLE8 compression; it writes 32 bit BGRA with an alpha mask
// header (or 24 bit when opaque). ICO reads every entry (PNG or BMP) and opens the largest one;
// it writes PNG entries at several sizes.

import { FormatError, Reader, Writer, image, startsWith } from './binary.js';
import { decodePng, encodePng, isPng } from './png.js';

export const isBmp = (b) => startsWith(b, [0x42, 0x4d]);
export const isIco = (b) => startsWith(b, [0, 0, 1, 0]) && b.length > 22 && b[4] + b[5] * 256 > 0;

function maskShift(mask) {
  if (!mask) return { shift: 0, max: 1 };
  let shift = 0;
  while (!((mask >>> shift) & 1)) shift++;
  let bits = 0;
  while ((mask >>> (shift + bits)) & 1) bits++;
  return { shift, max: 2 ** bits - 1 };
}

/** Decodes the DIB part (header plus pixels). In an ICO the height covers the image and the AND mask. */
export function decodeDib(bytes, { ico = false } = {}) {
  const r = new Reader(bytes, { little: true });
  const headerSize = r.u32();
  let width;
  let height;
  let bpp;
  let compression = 0;
  let colors = 0;
  let masks = null;
  if (headerSize === 12) {
    width = r.u16();
    height = r.i16();
    r.u16();
    bpp = r.u16();
  } else {
    width = r.i32();
    height = r.i32();
    r.u16();
    bpp = r.u16();
    compression = r.u32();
    r.u32();
    r.i32();
    r.i32();
    colors = r.u32();
    r.u32();
    if (compression === 3 || compression === 6) {
      if (headerSize >= 52) masks = [r.u32(), r.u32(), r.u32(), headerSize >= 56 ? r.u32() : 0];
      else masks = [new Reader(bytes, { little: true, offset: headerSize }).u32(), 0, 0, 0];
    }
  }
  if (ico) height = Math.round(height / 2);
  const topDown = height < 0;
  height = Math.abs(height);
  const img = image(Math.abs(width), height);
  width = img.width;
  let pos = headerSize;
  if ((compression === 3 || compression === 6) && headerSize === 40) {
    const mr = new Reader(bytes, { little: true, offset: 40 });
    masks = [mr.u32(), mr.u32(), mr.u32(), compression === 6 ? mr.u32() : 0];
    pos += compression === 6 ? 16 : 12;
  }
  let palette = null;
  if (bpp <= 8) {
    const n = colors || 1 << bpp;
    const entry = headerSize === 12 ? 3 : 4;
    palette = [];
    for (let i = 0; i < n; i++) {
      const o = pos + i * entry;
      palette.push([bytes[o + 2], bytes[o + 1], bytes[o]]);
    }
    pos += n * entry;
  }
  return { img, width, height, bpp, compression, masks, palette, topDown, pixelStart: pos };
}

function readPixels(bytes, info, start) {
  const { img, width, height, bpp, compression, palette, topDown } = info;
  let masks = info.masks;
  const d = img.data;
  const rowBytes = Math.floor((bpp * width + 31) / 32) * 4;
  const put = (x, y, r, g, b, a = 255) => {
    const yy = topDown ? y : height - 1 - y;
    const o = (yy * width + x) * 4;
    d[o] = r;
    d[o + 1] = g;
    d[o + 2] = b;
    d[o + 3] = a;
  };
  if (compression === 1 || compression === 2) {
    // RLE8 or RLE4, bottom up
    let x = 0;
    let y = 0;
    let i = start;
    const four = compression === 2;
    while (i < bytes.length - 1 && y < height) {
      const n = bytes[i++];
      const v = bytes[i++];
      if (n) {
        for (let k = 0; k < n && x < width; k++, x++) {
          const idx = four ? (k & 1 ? v & 15 : v >> 4) : v;
          const c = palette[idx] ?? [0, 0, 0];
          put(x, y, c[0], c[1], c[2]);
        }
      } else if (v === 0) {
        x = 0;
        y++;
      } else if (v === 1) break;
      else if (v === 2) {
        x += bytes[i++];
        y += bytes[i++];
      } else {
        for (let k = 0; k < v; k++, x++) {
          const byte = four ? bytes[i + (k >> 1)] : bytes[i + k];
          const idx = four ? (k & 1 ? byte & 15 : byte >> 4) : byte;
          const c = palette[idx] ?? [0, 0, 0];
          if (x < width) put(x, y, c[0], c[1], c[2]);
        }
        const used = four ? Math.ceil(v / 2) : v;
        i += used + (used & 1);
      }
    }
    return img;
  }
  if (bpp === 16 && !masks) masks = [0x7c00, 0x03e0, 0x001f, 0];
  if (bpp === 32 && !masks) masks = [0xff0000, 0xff00, 0xff, 0];
  const ms = masks ? masks.map(maskShift) : null;
  let anyAlpha = false;
  for (let y = 0; y < height; y++) {
    const row = start + y * rowBytes;
    if (row >= bytes.length) break;
    for (let x = 0; x < width; x++) {
      if (bpp <= 8) {
        const bit = x * bpp;
        const byte = bytes[row + (bit >> 3)];
        const idx = (byte >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
        const c = palette[idx] ?? [0, 0, 0];
        put(x, y, c[0], c[1], c[2]);
      } else if (bpp === 24) {
        const o = row + x * 3;
        put(x, y, bytes[o + 2], bytes[o + 1], bytes[o]);
      } else {
        const o = row + x * (bpp / 8);
        const v = bpp === 16 ? bytes[o] | (bytes[o + 1] << 8) : (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0;
        const ch = (k) => (masks[k] ? Math.round(((((v & masks[k]) >>> 0) >>> ms[k].shift) * 255) / ms[k].max) : null);
        const a = ch(3);
        if (a !== null && a !== 0) anyAlpha = true;
        put(x, y, ch(0), ch(1), ch(2), a ?? 255);
      }
    }
  }
  // 32 bit images with an alpha mask that is all zero are opaque in practice
  if (bpp === 32 && masks[3] && !anyAlpha) for (let i = 3; i < d.length; i += 4) d[i] = 255;
  return img;
}

export function decodeBmp(bytes) {
  if (!isBmp(bytes)) throw new FormatError('Not a BMP file');
  const r = new Reader(bytes, { little: true });
  r.skip(10);
  const offset = r.u32();
  const info = decodeDib(bytes.subarray(14));
  return readPixels(bytes, info, offset);
}

/** Encodes RGBA as BMP: 32 bit with alpha (BITMAPV4 header) or 24 bit when opaque. */
export function encodeBmp(img) {
  let alpha = false;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] !== 255) alpha = true;
  const bpp = alpha ? 32 : 24;
  const rowBytes = Math.floor((bpp * img.width + 31) / 32) * 4;
  const header = alpha ? 108 : 40;
  const size = 14 + header + rowBytes * img.height;
  const w = new Writer(size, { little: true });
  w.ascii('BM').u32(size).u32(0).u32(14 + header);
  w.u32(header).i32(img.width).i32(img.height).u16(1).u16(bpp).u32(alpha ? 3 : 0).u32(rowBytes * img.height).i32(2835).i32(2835).u32(0).u32(0);
  if (alpha) {
    w.u32(0x00ff0000).u32(0x0000ff00).u32(0x000000ff).u32(0xff000000);
    w.ascii('BGRs');
    w.pad(36 + 12);
  }
  for (let y = img.height - 1; y >= 0; y--) {
    const start = w.pos;
    for (let x = 0; x < img.width; x++) {
      const o = (y * img.width + x) * 4;
      w.u8(img.data[o + 2]).u8(img.data[o + 1]).u8(img.data[o]);
      if (alpha) w.u8(img.data[o + 3]);
    }
    w.pad(rowBytes - (w.pos - start));
  }
  return w.done();
}

/** Decodes an ICO or CUR file and returns the largest image, plus every entry in `entries`. */
export async function decodeIco(bytes) {
  const r = new Reader(bytes, { little: true });
  r.skip(4);
  const count = r.u16();
  const entries = [];
  for (let i = 0; i < count; i++) {
    const w = r.u8() || 256;
    const h = r.u8() || 256;
    r.skip(6);
    const size = r.u32();
    const offset = r.u32();
    entries.push({ w, h, size, offset });
  }
  const images = [];
  for (const e of entries) {
    const part = bytes.subarray(e.offset, e.offset + e.size);
    if (isPng(part)) images.push(await decodePng(part));
    else {
      const info = decodeDib(part, { ico: true });
      const img = readPixels(part, info, info.pixelStart);
      if (info.bpp < 32) {
        // the AND mask after the color pixels sets transparency
        const rowBytes = Math.floor((info.bpp * info.width + 31) / 32) * 4;
        const maskStart = info.pixelStart + rowBytes * info.height;
        const maskRow = Math.floor((info.width + 31) / 32) * 4;
        for (let y = 0; y < info.height; y++) {
          for (let x = 0; x < info.width; x++) {
            const b = part[maskStart + y * maskRow + (x >> 3)];
            if (b === undefined) continue;
            if ((b >> (7 - (x & 7))) & 1) img.data[((info.height - 1 - y) * info.width + x) * 4 + 3] = 0;
          }
        }
      }
      images.push(img);
    }
  }
  if (!images.length) throw new FormatError('The icon file has no images', 'damaged');
  images.sort((a, b) => b.width * b.height - a.width * a.height);
  return { ...images[0], entries: images };
}

/** Encodes an ICO with PNG entries. images: [{ width, height, data }] (16 to 256 px). */
export async function encodeIco(images) {
  const pngs = [];
  for (const img of images) pngs.push(await encodePng(img));
  const w = new Writer(6 + images.length * 16 + pngs.reduce((a, p) => a + p.length, 0), { little: true });
  w.u16(0).u16(1).u16(images.length);
  let offset = 6 + images.length * 16;
  images.forEach((img, i) => {
    w.u8(img.width >= 256 ? 0 : img.width).u8(img.height >= 256 ? 0 : img.height).u8(0).u8(0).u16(1).u16(32).u32(pngs[i].length).u32(offset);
    offset += pngs[i].length;
  });
  for (const p of pngs) w.bytes(p);
  return w.done();
}
