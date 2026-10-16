// Generated from src/formats/png.js by scripts/build-app.mjs. Edit the source, not this copy.
// PNG and APNG, read and write, in plain code. Reads every color type and bit depth (1 to 16
// bits, palette with transparency, gray, RGB, alpha) and Adam7 interlacing; animated PNG frames
// are composited with their dispose and blend rules. Writes 8 bit RGBA (or RGB when opaque) with
// per row filter selection, and animated PNG from a list of frames.

import { FormatError, Reader, Writer, ascii, crc32, crcDone, image, startsWith, zlibDeflate, zlibInflate } from './binary.js';

export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const isPng = (b) => startsWith(b, PNG_SIGNATURE);

function readChunks(bytes) {
  const r = new Reader(bytes);
  r.skip(8);
  const chunks = [];
  while (r.left >= 12) {
    const len = r.u32();
    const type = r.ascii(4);
    if (len > r.left - 4) throw new FormatError('The PNG file is damaged', 'damaged');
    const data = r.bytesAt(len);
    r.skip(4); // CRC, not checked: a damaged chunk shows up in the pixels or in inflate
    chunks.push({ type, data });
    if (type === 'IEND') break;
  }
  return chunks;
}

const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
];

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function unfilter(data, at, width, height, bpp, rowBytes) {
  const out = new Uint8Array(rowBytes * height);
  let prev = new Uint8Array(rowBytes);
  let p = at;
  for (let y = 0; y < height; y++) {
    const ft = data[p++];
    const row = out.subarray(y * rowBytes, (y + 1) * rowBytes);
    row.set(data.subarray(p, p + rowBytes));
    p += rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      switch (ft) {
        case 0:
          break;
        case 1:
          row[x] = (row[x] + a) & 255;
          break;
        case 2:
          row[x] = (row[x] + b) & 255;
          break;
        case 3:
          row[x] = (row[x] + ((a + b) >> 1)) & 255;
          break;
        case 4:
          row[x] = (row[x] + paeth(a, b, c)) & 255;
          break;
        default:
          throw new FormatError('The PNG file is damaged (unknown filter)', 'damaged');
      }
    }
    prev = row;
  }
  return { rows: out, next: p };
}

function channelsOf(colorType) {
  return { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
}

/** Converts unfiltered rows to RGBA8 at the given positions of the output image. */
function expand(rows, w, h, hdr, palette, trns, out, outW, place) {
  const ch = channelsOf(hdr.colorType);
  const depth = hdr.depth;
  const rowBytes = Math.ceil((w * ch * depth) / 8);
  const max = (1 << depth) - 1;
  const sample = (row, i) => {
    if (depth === 8) return row[i];
    if (depth === 16) return (row[i * 2] << 8) | row[i * 2 + 1];
    const bit = i * depth;
    return (row[bit >> 3] >> (8 - depth - (bit & 7))) & max;
  };
  const to8 = (v) => (depth === 16 ? v >> 8 : depth === 8 ? v : Math.round((v * 255) / max));
  for (let y = 0; y < h; y++) {
    const row = rows.subarray(y * rowBytes, (y + 1) * rowBytes);
    for (let x = 0; x < w; x++) {
      const [ox, oy] = place(x, y);
      const o = (oy * outW + ox) * 4;
      let r;
      let g;
      let b;
      let a = 255;
      switch (hdr.colorType) {
        case 0: {
          const v = sample(row, x);
          r = g = b = to8(v);
          if (trns && trns.gray === v) a = 0;
          break;
        }
        case 2: {
          const vr = sample(row, x * 3);
          const vg = sample(row, x * 3 + 1);
          const vb = sample(row, x * 3 + 2);
          r = to8(vr);
          g = to8(vg);
          b = to8(vb);
          if (trns && trns.r === vr && trns.g === vg && trns.b === vb) a = 0;
          break;
        }
        case 3: {
          const i = sample(row, x);
          if (!palette || i * 3 + 2 >= palette.length) throw new FormatError('The PNG palette is missing or too short', 'damaged');
          r = palette[i * 3];
          g = palette[i * 3 + 1];
          b = palette[i * 3 + 2];
          a = trns?.alpha && i < trns.alpha.length ? trns.alpha[i] : 255;
          break;
        }
        case 4:
          r = g = b = to8(sample(row, x * 2));
          a = to8(sample(row, x * 2 + 1));
          break;
        default:
          r = to8(sample(row, x * 4));
          g = to8(sample(row, x * 4 + 1));
          b = to8(sample(row, x * 4 + 2));
          a = to8(sample(row, x * 4 + 3));
      }
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }
}

async function decodeFrameData(zdata, w, h, hdr, palette, trns) {
  const data = await zlibInflate(zdata);
  const img = image(w, h);
  const ch = channelsOf(hdr.colorType);
  const bpp = Math.max(1, Math.ceil((ch * hdr.depth) / 8));
  if (!hdr.interlace) {
    const rowBytes = Math.ceil((w * ch * hdr.depth) / 8);
    const { rows } = unfilter(data, 0, w, h, bpp, rowBytes);
    expand(rows, w, h, hdr, palette, trns, img.data, w, (x, y) => [x, y]);
    return img;
  }
  let at = 0;
  for (const [x0, y0, dx, dy] of ADAM7) {
    const pw = Math.ceil((w - x0) / dx);
    const ph = Math.ceil((h - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const rowBytes = Math.ceil((pw * ch * hdr.depth) / 8);
    const { rows, next } = unfilter(data, at, pw, ph, bpp, rowBytes);
    at = next;
    expand(rows, pw, ph, hdr, palette, trns, img.data, w, (x, y) => [x0 + x * dx, y0 + y * dy]);
  }
  return img;
}

/**
 * Decodes a PNG or APNG. Returns { width, height, data, frames? } where frames (for APNG) is a
 * list of fully composited RGBA images with a delay in milliseconds.
 */
export async function decodePng(bytes) {
  if (!isPng(bytes)) throw new FormatError('Not a PNG file');
  const chunks = readChunks(bytes);
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  if (!ihdr) throw new FormatError('The PNG file is damaged (no header)', 'damaged');
  const r = new Reader(ihdr.data);
  const hdr = { width: r.u32(), height: r.u32(), depth: r.u8(), colorType: r.u8(), compression: r.u8(), filter: r.u8(), interlace: r.u8() };
  if (!channelsOf(hdr.colorType) || ![1, 2, 4, 8, 16].includes(hdr.depth)) throw new FormatError('This PNG uses an unsupported color type', 'unsupported');
  const palette = chunks.find((c) => c.type === 'PLTE')?.data ?? null;
  const t = chunks.find((c) => c.type === 'tRNS')?.data;
  let trns = null;
  if (t) {
    const tr = new Reader(t);
    if (hdr.colorType === 0 && t.length >= 2) trns = { gray: tr.u16() };
    else if (hdr.colorType === 2 && t.length >= 6) trns = { r: tr.u16(), g: tr.u16(), b: tr.u16() };
    else if (hdr.colorType === 3) trns = { alpha: t };
  }
  const idat = chunks.filter((c) => c.type === 'IDAT').map((c) => c.data);
  const join = (parts) => {
    const n = parts.reduce((a, p) => a + p.length, 0);
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  };
  const main = await decodeFrameData(join(idat), hdr.width, hdr.height, hdr, palette, trns);
  const actl = chunks.find((c) => c.type === 'acTL');
  if (!actl) return main;
  // APNG: collect frame controls and their data
  const frames = [];
  let cur = null;
  let seenIdat = false;
  for (const c of chunks) {
    if (c.type === 'fcTL') {
      const fr = new Reader(c.data);
      fr.u32();
      cur = { w: fr.u32(), h: fr.u32(), x: fr.u32(), y: fr.u32(), num: fr.u16(), den: fr.u16() || 100, dispose: fr.u8(), blend: fr.u8(), parts: [], usesIdat: !seenIdat };
      frames.push(cur);
    } else if (c.type === 'IDAT') {
      seenIdat = true;
      if (cur?.usesIdat) cur.parts.push(c.data);
    } else if (c.type === 'fdAT' && cur) cur.parts.push(c.data.subarray(4));
  }
  const W = hdr.width;
  const H = hdr.height;
  let canvas = new Uint8ClampedArray(W * H * 4);
  const out = [];
  for (const fr of frames) {
    if (!fr.parts.length) continue;
    const sub = fr.usesIdat && fr.w === W && fr.h === H ? main : await decodeFrameData(join(fr.parts), fr.w, fr.h, hdr, palette, trns);
    const before = fr.dispose === 2 ? canvas.slice() : null;
    for (let y = 0; y < fr.h; y++) {
      for (let x = 0; x < fr.w; x++) {
        const s = (y * fr.w + x) * 4;
        const d = ((fr.y + y) * W + fr.x + x) * 4;
        if (fr.x + x >= W || fr.y + y >= H) continue;
        const sa = sub.data[s + 3] / 255;
        if (fr.blend === 0 || sa === 1) {
          canvas[d] = sub.data[s];
          canvas[d + 1] = sub.data[s + 1];
          canvas[d + 2] = sub.data[s + 2];
          canvas[d + 3] = sub.data[s + 3];
        } else if (sa > 0) {
          const da = canvas[d + 3] / 255;
          const oa = sa + da * (1 - sa);
          for (let k = 0; k < 3; k++) canvas[d + k] = Math.round((sub.data[s + k] * sa + canvas[d + k] * da * (1 - sa)) / oa);
          canvas[d + 3] = Math.round(oa * 255);
        }
      }
    }
    out.push({ width: W, height: H, data: canvas.slice(), delay: Math.round((fr.num / fr.den) * 1000) });
    if (fr.dispose === 1) {
      for (let y = 0; y < fr.h; y++) canvas.fill(0, ((fr.y + y) * W + fr.x) * 4, ((fr.y + y) * W + fr.x + fr.w) * 4);
    } else if (before) canvas = before;
  }
  return { ...main, frames: out.length > 1 ? out : undefined };
}

function chunk(w, type, data) {
  w.u32(data.length);
  const head = ascii(type);
  w.bytes(head);
  w.bytes(data);
  w.u32(crcDone(crc32(data, crc32(head))));
}

function filterRows(data, width, height, channels) {
  const rowBytes = width * channels;
  const out = new Uint8Array((rowBytes + 1) * height);
  const bpp = channels;
  const cand = [0, 1, 2, 3, 4].map(() => new Uint8Array(rowBytes));
  let prev = new Uint8Array(rowBytes);
  for (let y = 0; y < height; y++) {
    const row = data.subarray(y * rowBytes, (y + 1) * rowBytes);
    let best = 0;
    let bestCost = Infinity;
    for (let ft = 0; ft < 5; ft++) {
      const c = cand[ft];
      let cost = 0;
      for (let x = 0; x < rowBytes; x++) {
        const a = x >= bpp ? row[x - bpp] : 0;
        const b = prev[x];
        const cc = x >= bpp ? prev[x - bpp] : 0;
        const v = ft === 0 ? row[x] : ft === 1 ? row[x] - a : ft === 2 ? row[x] - b : ft === 3 ? row[x] - ((a + b) >> 1) : row[x] - paeth(a, b, cc);
        c[x] = v & 255;
        cost += c[x] < 128 ? c[x] : 256 - c[x];
        if (cost >= bestCost) break;
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = ft;
      }
    }
    // recompute the winner fully (the loop may have stopped early for it on a tie)
    const c = cand[best];
    for (let x = 0; x < rowBytes; x++) {
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = prev[x];
      const cc = x >= bpp ? prev[x - bpp] : 0;
      const v = best === 0 ? row[x] : best === 1 ? row[x] - a : best === 2 ? row[x] - b : best === 3 ? row[x] - ((a + b) >> 1) : row[x] - paeth(a, b, cc);
      c[x] = v & 255;
    }
    out[y * (rowBytes + 1)] = best;
    out.set(c, y * (rowBytes + 1) + 1);
    prev = row;
  }
  return out;
}

function pixelsFor(img, alpha) {
  if (alpha) return new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  const out = new Uint8Array(img.width * img.height * 3);
  for (let i = 0, j = 0; j < out.length; i += 4, j += 3) {
    out[j] = img.data[i];
    out[j + 1] = img.data[i + 1];
    out[j + 2] = img.data[i + 2];
  }
  return out;
}

const hasAlpha = (data) => {
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return true;
  return false;
};

/**
 * Encodes RGBA pixels as PNG. frames: optional list of { data, delay } (full size) for an
 * animated PNG; the first frame is also the still image. options.dpi writes a pHYs chunk.
 */
export async function encodePng(img, { frames = null, loops = 0, dpi = 0 } = {}) {
  const all = frames?.length ? frames : null;
  const alpha = all ? all.some((f) => hasAlpha(f.data)) : hasAlpha(img.data);
  const ch = alpha ? 4 : 3;
  const w = new Writer(1024 + img.width * img.height);
  w.bytes(Uint8Array.from(PNG_SIGNATURE));
  const ihdr = new Writer(13);
  ihdr.u32(img.width).u32(img.height).u8(8).u8(alpha ? 6 : 2).u8(0).u8(0).u8(0);
  chunk(w, 'IHDR', ihdr.done());
  if (dpi > 0) {
    const ppm = Math.round(dpi / 0.0254);
    chunk(w, 'pHYs', new Writer(9).u32(ppm).u32(ppm).u8(1).done());
  }
  if (!all) {
    chunk(w, 'IDAT', await zlibDeflate(filterRows(pixelsFor(img, alpha), img.width, img.height, ch)));
  } else {
    chunk(w, 'acTL', new Writer(8).u32(all.length).u32(loops).done());
    let seq = 0;
    for (let i = 0; i < all.length; i++) {
      const f = all[i];
      const delay = Math.max(10, Math.round(f.delay ?? 100));
      chunk(w, 'fcTL', new Writer(26).u32(seq++).u32(img.width).u32(img.height).u32(0).u32(0).u16(delay).u16(1000).u8(0).u8(0).done());
      const z = await zlibDeflate(filterRows(pixelsFor({ ...img, data: f.data }, alpha), img.width, img.height, ch));
      if (i === 0) chunk(w, 'IDAT', z);
      else {
        const fd = new Writer(z.length + 4);
        fd.u32(seq++).bytes(z);
        chunk(w, 'fdAT', fd.done());
      }
    }
  }
  chunk(w, 'IEND', new Uint8Array(0));
  return w.done();
}
