// Generated from src/formats/gif.js by scripts/build-app.mjs. Edit the source, not this copy.
// GIF, read and write. Reading composites every frame with its disposal method and
// transparency, so an animated GIF opens as one full layer per frame with its delay. Writing
// quantizes to a shared 256 color palette (median cut, dithered) and LZW compresses each frame.

import { FormatError, Reader, Writer, image } from './binary.js';
import { mapToPalette, medianCut } from './quantize.js';
import { isGif } from './magic.js';

export { isGif };


function lzwDecode(minCode, data, pixels) {
  const out = new Uint8Array(pixels);
  const clear = 1 << minCode;
  const end = clear + 1;
  let size = minCode + 1;
  let mask = (1 << size) - 1;
  let next = end + 1;
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const length = new Uint16Array(4096);
  for (let i = 0; i < clear; i++) {
    prefix[i] = -1;
    suffix[i] = i;
    length[i] = 1;
  }
  let prev = -1;
  let bits = 0;
  let acc = 0;
  let o = 0;
  const stack = new Uint8Array(4097);
  for (let i = 0; i < data.length && o < pixels; ) {
    while (bits < size && i < data.length) {
      acc |= data[i++] << bits;
      bits += 8;
    }
    if (bits < size) break;
    const code = acc & mask;
    acc >>>= size;
    bits -= size;
    if (code === clear) {
      size = minCode + 1;
      mask = (1 << size) - 1;
      next = end + 1;
      prev = -1;
      continue;
    }
    if (code === end) break;
    let cur = code;
    let first;
    if (code >= next) {
      if (prev < 0) break;
      cur = prev;
    }
    // walk the chain into the stack
    let sp = 0;
    let c = cur;
    while (c >= 0 && sp < 4097) {
      stack[sp++] = suffix[c];
      c = prefix[c];
    }
    first = stack[sp - 1];
    while (sp > 0 && o < pixels) out[o++] = stack[--sp];
    if (code >= next && o < pixels) out[o++] = first;
    if (prev >= 0 && next < 4096) {
      prefix[next] = prev;
      suffix[next] = first;
      length[next] = length[prev] + 1;
      next++;
      if (next > mask && size < 12) {
        size++;
        mask = (1 << size) - 1;
      }
    }
    prev = code;
  }
  return out;
}

function readSubBlocks(r) {
  const parts = [];
  let total = 0;
  for (;;) {
    const n = r.u8();
    if (!n) break;
    const b = r.bytesAt(n);
    parts.push(b);
    total += n;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Decodes a GIF. Returns { width, height, data, frames? } (frames for animations). */
export function decodeGif(bytes) {
  if (!isGif(bytes)) throw new FormatError('Not a GIF file');
  const r = new Reader(bytes, { little: true });
  r.skip(6);
  const W = r.u16();
  const H = r.u16();
  const flags = r.u8();
  const bgIndex = r.u8();
  r.u8();
  let globalTable = null;
  if (flags & 0x80) globalTable = r.bytesAt(3 * (1 << ((flags & 7) + 1)));
  void bgIndex;
  const out = image(W, H);
  let canvas = new Uint8ClampedArray(W * H * 4);
  const frames = [];
  let gce = { delay: 100, transparent: -1, dispose: 0 };
  while (r.left > 0) {
    const block = r.u8();
    if (block === 0x3b) break;
    if (block === 0x21) {
      const label = r.u8();
      if (label === 0xf9) {
        r.u8();
        const pf = r.u8();
        const delay = r.u16() * 10;
        const ti = r.u8();
        r.u8();
        gce = { delay: delay || 100, transparent: pf & 1 ? ti : -1, dispose: (pf >> 2) & 7 };
      } else readSubBlocks(r);
      continue;
    }
    if (block !== 0x2c) throw new FormatError('The GIF file is damaged', 'damaged');
    const fx = r.u16();
    const fy = r.u16();
    const fw = r.u16();
    const fh = r.u16();
    const f = r.u8();
    let table = globalTable;
    if (f & 0x80) table = r.bytesAt(3 * (1 << ((f & 7) + 1)));
    if (!table) throw new FormatError('The GIF has no color table', 'damaged');
    const interlaced = (f & 0x40) !== 0;
    const minCode = r.u8();
    const idx = lzwDecode(minCode, readSubBlocks(r), fw * fh);
    const before = gce.dispose === 3 ? canvas.slice() : null;
    const rowOrder = [];
    if (interlaced) {
      for (const [start, step] of [
        [0, 8],
        [4, 8],
        [2, 4],
        [1, 2],
      ])
        for (let y = start; y < fh; y += step) rowOrder.push(y);
    } else for (let y = 0; y < fh; y++) rowOrder.push(y);
    rowOrder.forEach((y, row) => {
      for (let x = 0; x < fw; x++) {
        const k = idx[row * fw + x];
        if (k === gce.transparent) continue;
        const X = fx + x;
        const Y = fy + y;
        if (X >= W || Y >= H) continue;
        const d = (Y * W + X) * 4;
        canvas[d] = table[k * 3];
        canvas[d + 1] = table[k * 3 + 1];
        canvas[d + 2] = table[k * 3 + 2];
        canvas[d + 3] = 255;
      }
    });
    frames.push({ width: W, height: H, data: canvas.slice(), delay: gce.delay });
    if (gce.dispose === 2) for (let y = fy; y < Math.min(H, fy + fh); y++) canvas.fill(0, (y * W + fx) * 4, (y * W + Math.min(W, fx + fw)) * 4);
    else if (before) canvas = before;
    gce = { delay: 100, transparent: -1, dispose: 0 };
  }
  if (!frames.length) throw new FormatError('The GIF has no images', 'damaged');
  out.data = frames[0].data;
  return { ...out, frames: frames.length > 1 ? frames : undefined };
}

function lzwEncode(minCode, indices) {
  const w = [];
  let acc = 0;
  let bits = 0;
  let size = minCode + 1;
  const clear = 1 << minCode;
  const end = clear + 1;
  const emit = (code) => {
    acc |= code << bits;
    bits += size;
    while (bits >= 8) {
      w.push(acc & 255);
      acc >>>= 8;
      bits -= 8;
    }
  };
  let dict = new Map();
  let next = end + 1;
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = prefix * 4096 + k;
    const hit = dict.get(key);
    if (hit !== undefined) {
      prefix = hit;
      continue;
    }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      if (next - 1 === 1 << size && size < 12) size++;
    } else {
      emit(clear);
      dict = new Map();
      next = end + 1;
      size = minCode + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(end);
  if (bits > 0) w.push(acc & 255);
  return Uint8Array.from(w);
}

/**
 * Encodes one image or several frames ({ data, delay }) as a GIF with a shared palette.
 * Pixels with alpha below 128 become transparent.
 */
export function encodeGif(img, { frames = null, loops = 0, dither = true } = {}) {
  const list = frames?.length ? frames : [{ data: img.data, delay: 100 }];
  const transparent = list.some((f) => {
    for (let i = 3; i < f.data.length; i += 4) if (f.data[i] < 128) return true;
    return false;
  });
  const palette = medianCut(
    list.map((f) => f.data),
    transparent ? 255 : 256,
  );
  const tIndex = transparent ? palette.length : -1;
  const full = palette.slice();
  if (transparent) full.push([0, 0, 0]);
  let bitsPer = 1;
  while (1 << bitsPer < full.length) bitsPer++;
  const tableSize = 1 << bitsPer;
  const w = new Writer(1 << 16, { little: true });
  w.ascii('GIF89a').u16(img.width).u16(img.height).u8(0x80 | (bitsPer - 1)).u8(0).u8(0);
  for (let i = 0; i < tableSize; i++) {
    const c = full[i] ?? [0, 0, 0];
    w.u8(c[0]).u8(c[1]).u8(c[2]);
  }
  if (list.length > 1) w.u8(0x21).u8(0xff).u8(11).ascii('NETSCAPE2.0').u8(3).u8(1).u16(loops).u8(0);
  for (const f of list) {
    w.u8(0x21).u8(0xf9).u8(4).u8((transparent ? 1 : 0) | (2 << 2)).u16(Math.max(2, Math.round((f.delay ?? 100) / 10))).u8(transparent ? tIndex : 0).u8(0);
    w.u8(0x2c).u16(0).u16(0).u16(img.width).u16(img.height).u8(0);
    const idx = mapToPalette(f.data, img.width, img.height, full, { dither, transparentIndex: tIndex });
    const minCode = Math.max(2, bitsPer);
    w.u8(minCode);
    const data = lzwEncode(minCode, idx);
    for (let i = 0; i < data.length; i += 255) {
      const part = data.subarray(i, i + 255);
      w.u8(part.length).bytes(part);
    }
    w.u8(0);
  }
  w.u8(0x3b);
  return w.done();
}
