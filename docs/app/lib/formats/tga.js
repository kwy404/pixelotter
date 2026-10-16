// Generated from src/formats/tga.js by scripts/build-app.mjs. Edit the source, not this copy.
// TGA (read and write) and the Netpbm family (PBM, PGM, PPM and PAM, read only).

import { FormatError, Reader, Writer, image } from './binary.js';

/** TGA has no magic number; this checks that the header makes sense. */
export function looksLikeTga(b) {
  if (b.length < 18) return false;
  const cmapType = b[1];
  const type = b[2];
  const depth = b[16];
  return cmapType <= 1 && [1, 2, 3, 9, 10, 11].includes(type) && [8, 15, 16, 24, 32].includes(depth) && b[12] + b[13] * 256 > 0 && b[14] + b[15] * 256 > 0;
}

export function decodeTga(bytes) {
  if (!looksLikeTga(bytes)) throw new FormatError('Not a TGA file');
  const r = new Reader(bytes, { little: true });
  const idLen = r.u8();
  const cmapType = r.u8();
  const type = r.u8();
  const cmapStart = r.u16();
  const cmapLen = r.u16();
  const cmapDepth = r.u8();
  r.u16();
  r.u16();
  const width = r.u16();
  const height = r.u16();
  const depth = r.u8();
  const desc = r.u8();
  r.skip(idLen);
  let cmap = null;
  if (cmapType === 1) {
    const bpe = Math.ceil(cmapDepth / 8);
    cmap = [];
    for (let i = 0; i < cmapLen; i++) cmap.push(readColor(r.bytesAt(bpe), 0, cmapDepth));
    void cmapStart;
  }
  const img = image(width, height);
  const bpp = Math.ceil(depth / 8);
  const rle = type >= 9;
  const n = width * height;
  const px = new Uint8Array(n * bpp);
  if (!rle) px.set(r.bytesAt(Math.min(n * bpp, r.left)));
  else {
    let o = 0;
    while (o < px.length && r.left > 0) {
      const h = r.u8();
      const count = (h & 127) + 1;
      if (h & 128) {
        const v = r.bytesAt(bpp);
        for (let k = 0; k < count && o < px.length; k++, o += bpp) px.set(v, o);
      } else {
        const len = Math.min(count * bpp, px.length - o);
        px.set(r.bytesAt(len), o);
        o += len;
      }
    }
  }
  const right = (desc & 16) !== 0;
  const top = (desc & 32) !== 0;
  const kind = type & 3; // 1 mapped, 2 true color, 3 gray
  for (let i = 0; i < n; i++) {
    const sx = i % width;
    const sy = Math.floor(i / width);
    const x = right ? width - 1 - sx : sx;
    const y = top ? sy : height - 1 - sy;
    let c;
    if (kind === 1) c = cmap?.[px[i * bpp]] ?? [0, 0, 0, 255];
    else if (kind === 3) c = [px[i * bpp], px[i * bpp], px[i * bpp], bpp > 1 ? px[i * bpp + 1] : 255];
    else c = readColor(px, i * bpp, depth);
    img.data.set(c, (y * width + x) * 4);
  }
  if (depth === 32 && (desc & 15) === 0) {
    // no alpha bits declared: some writers leave zeros, treat as opaque if all zero
    let any = false;
    for (let i = 3; i < img.data.length; i += 4) if (img.data[i]) any = true;
    if (!any) for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
  }
  return img;
}

function readColor(b, o, depth) {
  if (depth === 15 || depth === 16) {
    const v = b[o] | (b[o + 1] << 8);
    return [Math.round((((v >> 10) & 31) * 255) / 31), Math.round((((v >> 5) & 31) * 255) / 31), Math.round(((v & 31) * 255) / 31), depth === 16 && !(v & 0x8000) ? 255 : 255];
  }
  if (depth === 24) return [b[o + 2], b[o + 1], b[o], 255];
  if (depth === 32) return [b[o + 2], b[o + 1], b[o], b[o + 3]];
  return [b[o], b[o], b[o], 255];
}

/** Writes a 32 bit RLE compressed, top down TGA. */
export function encodeTga(img) {
  const w = new Writer(18 + img.width * img.height * 4, { little: true });
  w.u8(0).u8(0).u8(10).u16(0).u16(0).u8(0).u16(0).u16(0).u16(img.width).u16(img.height).u8(32).u8(8 | 32);
  const d = img.data;
  const n = img.width * img.height;
  const same = (a, b) => d[a * 4] === d[b * 4] && d[a * 4 + 1] === d[b * 4 + 1] && d[a * 4 + 2] === d[b * 4 + 2] && d[a * 4 + 3] === d[b * 4 + 3];
  const px = (i) => w.u8(d[i * 4 + 2]).u8(d[i * 4 + 1]).u8(d[i * 4]).u8(d[i * 4 + 3]);
  let i = 0;
  while (i < n) {
    const rowEnd = (Math.floor(i / img.width) + 1) * img.width; // packets may not cross rows
    let run = 1;
    while (i + run < rowEnd && run < 128 && same(i, i + run)) run++;
    if (run > 1) {
      w.u8(127 + run);
      px(i);
      i += run;
      continue;
    }
    let len = 1;
    while (i + len < rowEnd && len < 128 && !(i + len + 1 < rowEnd && same(i + len, i + len + 1))) len++;
    w.u8(len - 1);
    for (let k = 0; k < len; k++) px(i + k);
    i += len;
  }
  return w.done();
}

/** Netpbm: P1 to P6 and P7 (PAM). */
export const isPnm = (b) => b[0] === 0x50 && b[1] >= 0x31 && b[1] <= 0x37 && [0x0a, 0x0d, 0x20, 0x09].includes(b[2]);

export function decodePnm(bytes) {
  if (!isPnm(bytes)) throw new FormatError('Not a PBM, PGM, PPM or PAM file');
  const kind = bytes[1] - 0x30;
  let pos = 2;
  const token = () => {
    for (;;) {
      while (pos < bytes.length && /\s/.test(String.fromCharCode(bytes[pos]))) pos++;
      if (bytes[pos] === 0x23) {
        while (pos < bytes.length && bytes[pos] !== 0x0a) pos++;
        continue;
      }
      break;
    }
    let s = '';
    while (pos < bytes.length && !/\s/.test(String.fromCharCode(bytes[pos]))) s += String.fromCharCode(bytes[pos++]);
    return s;
  };
  let width;
  let height;
  let max = 1;
  let depth = 1;
  let tupl = '';
  if (kind === 7) {
    for (;;) {
      const t = token();
      if (t === 'ENDHDR' || !t) break;
      const v = token();
      if (t === 'WIDTH') width = +v;
      else if (t === 'HEIGHT') height = +v;
      else if (t === 'DEPTH') depth = +v;
      else if (t === 'MAXVAL') max = +v;
      else if (t === 'TUPLTYPE') tupl = v;
    }
  } else {
    width = +token();
    height = +token();
    if (kind !== 1 && kind !== 4) max = +token();
    depth = kind === 3 || kind === 6 ? 3 : 1;
  }
  pos++; // the single whitespace after the header
  const img = image(width, height);
  const n = width * height;
  const ascii = kind <= 3;
  const wide = max > 255;
  const read = (() => {
    if (ascii) return () => +token();
    if (kind === 4) {
      const rowBytes = Math.ceil(width / 8);
      return (i) => {
        const x = i % width;
        const y = Math.floor(i / width);
        return (bytes[pos + y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
      };
    }
    let p = pos;
    return () => {
      const v = wide ? (bytes[p] << 8) | bytes[p + 1] : bytes[p];
      p += wide ? 2 : 1;
      return v;
    };
  })();
  const to8 = (v) => Math.round((v * 255) / max);
  for (let i = 0; i < n; i++) {
    let c;
    if (kind === 1 || kind === 4) {
      const v = read(i);
      c = v ? [0, 0, 0, 255] : [255, 255, 255, 255];
    } else if (depth === 1 || depth === 2) {
      const g = to8(read(i));
      const a = depth === 2 ? to8(read(i)) : 255;
      c = [g, g, g, a];
    } else {
      const r = to8(read(i));
      const g = to8(read(i));
      const b = to8(read(i));
      const a = depth >= 4 ? to8(read(i)) : 255;
      c = [r, g, b, a];
    }
    img.data.set(c, i * 4);
  }
  void tupl;
  return img;
}
