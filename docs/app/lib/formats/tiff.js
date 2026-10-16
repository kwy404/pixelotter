// Generated from src/formats/tiff.js by scripts/build-app.mjs. Edit the source, not this copy.
// TIFF, read and write. Reads baseline and common extended files: strips or tiles, no
// compression, LZW, Deflate or PackBits, the horizontal predictor, 1 to 16 bit samples (and 32
// bit float), gray, palette, RGB and CMYK, with or without alpha, chunky or planar, and every
// page (each page opens as a layer). Writes RGBA or CMYK, 8 bits per sample, with LZW, Deflate
// or no compression, one page per layer when asked. The IFD reader is also used to find the
// preview images inside camera raw files.

import { FormatError, Reader, Writer, image, startsWith, zlibDeflate, zlibInflate } from './binary.js';
import { cmykToRgb } from '../color/cmyk.js';

export const isTiff = (b) => startsWith(b, [0x49, 0x49, 0x2a, 0x00]) || startsWith(b, [0x4d, 0x4d, 0x00, 0x2a]);

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 };

/** Reads every IFD (and SubIFDs) into tag maps: [{ tags: Map(tag -> values), offset }]. */
export function readIfds(bytes, { subIfds = true, max = 64, anyMagic = false } = {}) {
  const little = bytes[0] === 0x49;
  const r = new Reader(bytes, { little });
  r.skip(2);
  const magic = r.u16();
  if (magic === 43) throw new FormatError('BigTIFF files are not supported', 'unsupported');
  if (magic !== 42 && !anyMagic) throw new FormatError('Not a TIFF file');
  const out = [];
  const queue = [r.u32()];
  const seen = new Set();
  while (queue.length && out.length < max) {
    const off = queue.shift();
    if (!off || seen.has(off) || off >= bytes.length) continue;
    seen.add(off);
    r.seek(off);
    const n = r.u16();
    const tags = new Map();
    for (let i = 0; i < n; i++) {
      const tag = r.u16();
      const type = r.u16();
      const count = r.u32();
      const size = (TYPE_SIZE[type] ?? 1) * count;
      const valuePos = size <= 4 ? r.pos : r.u32();
      if (size <= 4) r.skip(4);
      const save = r.pos;
      try {
        r.seek(valuePos);
        const vals = [];
        const lim = Math.min(count, 1 << 20);
        for (let k = 0; k < lim; k++) {
          if (type === 3 || type === 8) vals.push(type === 3 ? r.u16() : r.i16());
          else if (type === 4 || type === 13) vals.push(r.u32());
          else if (type === 9) vals.push(r.i32());
          else if (type === 5) vals.push(r.u32() / (r.u32() || 1));
          else if (type === 10) vals.push(r.i32() / (r.i32() || 1));
          else if (type === 11) vals.push(r.f32());
          else if (type === 12) vals.push(r.f64());
          else vals.push(r.u8());
        }
        tags.set(tag, type === 2 ? String.fromCharCode(...vals.filter((v) => v)) : vals);
      } catch {
        // a broken tag is skipped
      }
      r.seek(save);
    }
    out.push({ tags, offset: off, little });
    const next = r.left >= 4 ? r.u32() : 0;
    if (next) queue.push(next);
    if (subIfds && tags.has(330)) queue.push(...tags.get(330));
  }
  return out;
}

function lzwDecodeTiff(src, size) {
  const out = new Uint8Array(size);
  let o = 0;
  let bitPos = 0;
  const dict = [];
  const reset = () => {
    dict.length = 0;
    for (let i = 0; i < 256; i++) dict.push([i]);
    dict.push(null, null);
  };
  reset();
  let width = 9;
  let prev = null;
  const read = () => {
    let v = 0;
    for (let i = 0; i < width; i++) {
      const byte = src[(bitPos + i) >> 3];
      if (byte === undefined) return 257;
      v = (v << 1) | ((byte >> (7 - ((bitPos + i) & 7))) & 1);
    }
    bitPos += width;
    return v;
  };
  while (o < size) {
    const code = read();
    if (code === 257) break;
    if (code === 256) {
      reset();
      width = 9;
      prev = null;
      continue;
    }
    let entry;
    if (code < dict.length && dict[code]) entry = dict[code];
    else if (prev) entry = prev.concat(prev[0]);
    else break;
    for (let i = 0; i < entry.length && o < size; i++) out[o++] = entry[i];
    if (prev) dict.push(prev.concat(entry[0]));
    prev = entry;
    // TIFF LZW switches code width one code early
    if (dict.length + 1 >= 1 << width && width < 12) width++;
  }
  return out;
}

function lzwEncodeTiff(src) {
  const out = [];
  let acc = 0;
  let bits = 0;
  let width = 9;
  const emit = (code) => {
    acc = (acc << width) | code;
    bits += width;
    while (bits >= 8) {
      out.push((acc >> (bits - 8)) & 255);
      bits -= 8;
    }
    acc &= (1 << bits) - 1;
  };
  let dict = new Map();
  let next = 258;
  emit(256);
  if (!src.length) {
    emit(257);
    if (bits) out.push((acc << (8 - bits)) & 255);
    return Uint8Array.from(out);
  }
  let w = src[0];
  for (let i = 1; i < src.length; i++) {
    const k = src[i];
    const key = w * 256 + k;
    const hit = dict.get(key);
    if (hit !== undefined) {
      w = hit;
      continue;
    }
    emit(w);
    dict.set(key, next++);
    if (next + 1 > 1 << width && width < 12) width++;
    if (next >= 4093) {
      emit(256);
      dict = new Map();
      next = 258;
      width = 9;
    }
    w = k;
  }
  emit(w);
  next++;
  if (next + 1 > 1 << width && width < 12) width++;
  emit(257);
  if (bits) out.push((acc << (8 - bits)) & 255);
  return Uint8Array.from(out);
}

function unpackBitsTiff(src, size) {
  const out = new Uint8Array(size);
  let i = 0;
  let o = 0;
  while (o < size && i < src.length) {
    const n = src[i] > 127 ? src[i] - 256 : src[i];
    i++;
    if (n >= 0) {
      out.set(src.subarray(i, i + n + 1).subarray(0, size - o), o);
      i += n + 1;
      o += n + 1;
    } else if (n !== -128) {
      out.fill(src[i++], o, Math.min(size, o + 1 - n));
      o += 1 - n;
    }
  }
  return out;
}

async function decompress(comp, data, size) {
  if (comp === 1) return data;
  if (comp === 5) return lzwDecodeTiff(data, size);
  if (comp === 8 || comp === 32946) return zlibInflate(data);
  if (comp === 32773) return unpackBitsTiff(data, size);
  throw new FormatError(`This TIFF compression (${comp}) is not supported`, 'unsupported');
}

const one = (tags, t, d) => (tags.has(t) ? tags.get(t)[0] : d);

/** Decodes one IFD into RGBA. */
export async function decodeTiffPage(bytes, ifd) {
  const t = ifd.tags;
  const width = one(t, 256, 0);
  const height = one(t, 257, 0);
  const bps = t.get(258) ?? [1];
  const bits = bps[0];
  const comp = one(t, 259, 1);
  const photo = one(t, 262, 1);
  const spp = one(t, 277, 1);
  const planar = one(t, 284, 1);
  const predictor = one(t, 317, 1);
  const extra = t.get(338) ?? [];
  const sampleFormat = one(t, 339, 1);
  if (![0, 1, 2, 3, 5].includes(photo)) throw new FormatError('This TIFF color space is not supported (only gray, palette, RGB and CMYK)', 'unsupported');
  if (![1, 2, 4, 8, 16, 32].includes(bits) || (bits === 32 && sampleFormat !== 3)) throw new FormatError(`This TIFF bit depth (${bits}) is not supported`, 'unsupported');
  const img = image(width, height);
  const tiled = t.has(322);
  const tw = tiled ? one(t, 322, width) : width;
  const th = tiled ? one(t, 323, height) : one(t, 278, height);
  const offsets = t.get(tiled ? 324 : 273) ?? [];
  const counts = t.get(tiled ? 325 : 279) ?? [];
  const planes = planar === 2 ? spp : 1;
  const sppIn = planar === 2 ? 1 : spp;
  const rowBytes = Math.ceil((tw * sppIn * bits) / 8);
  const across = Math.ceil(width / tw);
  const down = Math.ceil(height / th);
  const blocksPerPlane = tiled ? across * down : down;
  // raw samples per pixel, gathered into one float buffer
  const samples = new Float32Array(width * height * spp);
  const maxv = bits === 32 ? 1 : 2 ** bits - 1;
  for (let p = 0; p < planes; p++) {
    for (let bi = 0; bi < blocksPerPlane; bi++) {
      const idx = p * blocksPerPlane + bi;
      const off = offsets[idx];
      const cnt = counts[idx] ?? bytes.length - off;
      if (off === undefined || off >= bytes.length) continue;
      const bx = tiled ? (bi % across) * tw : 0;
      const by = tiled ? Math.floor(bi / across) * th : bi * th;
      const rows = tiled ? th : Math.min(th, height - by);
      const raw = await decompress(comp, bytes.subarray(off, off + cnt), rowBytes * rows);
      const data = raw.length >= rowBytes * rows ? raw : (() => {
        const z = new Uint8Array(rowBytes * rows);
        z.set(raw);
        return z;
      })();
      if (predictor === 2) {
        if (bits === 8) for (let y = 0; y < rows; y++) for (let x = sppIn; x < tw * sppIn; x++) data[y * rowBytes + x] = (data[y * rowBytes + x] + data[y * rowBytes + x - sppIn]) & 255;
        else if (bits === 16) {
          const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
          for (let y = 0; y < rows; y++)
            for (let x = sppIn; x < tw * sppIn; x++) {
              const a = y * rowBytes + x * 2;
              dv.setUint16(a, (dv.getUint16(a, ifd.little) + dv.getUint16(a - sppIn * 2, ifd.little)) & 65535, ifd.little);
            }
        }
      } else if (predictor === 3) throw new FormatError('TIFF floating point prediction is not supported', 'unsupported');
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      for (let y = 0; y < rows; y++) {
        const Y = by + y;
        if (Y >= height) break;
        for (let x = 0; x < tw; x++) {
          const X = bx + x;
          if (X >= width) break;
          for (let s = 0; s < sppIn; s++) {
            const si = x * sppIn + s;
            let v;
            if (bits === 8) v = data[y * rowBytes + si];
            else if (bits === 16) v = dv.getUint16(y * rowBytes + si * 2, ifd.little);
            else if (bits === 32) v = dv.getFloat32(y * rowBytes + si * 4, ifd.little);
            else {
              const bit = si * bits;
              v = (data[y * rowBytes + (bit >> 3)] >> (8 - bits - (bit & 7))) & maxv;
            }
            samples[(Y * width + X) * spp + (planar === 2 ? p : s)] = v / maxv;
          }
        }
      }
    }
  }
  const colorCount = photo === 2 ? 3 : photo === 5 ? 4 : 1;
  const alphaIndex = extra.length && spp > colorCount ? colorCount : -1;
  const premult = alphaIndex >= 0 && extra[0] === 1;
  const cmap = t.get(320);
  const to8 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  const cache = new Map();
  for (let i = 0; i < width * height; i++) {
    const s = i * spp;
    let a = alphaIndex >= 0 ? samples[s + alphaIndex] : 1;
    let r;
    let g;
    let b;
    if (photo === 2) [r, g, b] = [samples[s], samples[s + 1], samples[s + 2]];
    else if (photo === 0) r = g = b = 1 - samples[s];
    else if (photo === 1) r = g = b = samples[s];
    else if (photo === 3) {
      const k = Math.round(samples[s] * maxv);
      const n = 1 << bits;
      [r, g, b] = cmap ? [cmap[k] / 65535, cmap[n + k] / 65535, cmap[2 * n + k] / 65535] : [0, 0, 0];
    } else {
      const key = [0, 1, 2, 3].map((c) => to8(samples[s + c])).join(',');
      let rgb = cache.get(key);
      if (!rgb) {
        rgb = cmykToRgb(samples[s] * 100, samples[s + 1] * 100, samples[s + 2] * 100, samples[s + 3] * 100).map((v) => v / 255);
        if (cache.size < 50000) cache.set(key, rgb);
      }
      [r, g, b] = rgb;
    }
    if (premult && a > 0) {
      r /= a;
      g /= a;
      b /= a;
    }
    img.data[i * 4] = to8(r);
    img.data[i * 4 + 1] = to8(g);
    img.data[i * 4 + 2] = to8(b);
    img.data[i * 4 + 3] = to8(a);
  }
  let ink = null;
  if (photo === 5 && bits === 8) {
    // keep the stored ink values, so a CMYK file can be saved again without a round trip
    ink = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) for (let c = 0; c < 4; c++) ink[i * 4 + c] = Math.round(samples[i * spp + c] * 255);
  }
  return { ...img, colorMode: photo === 5 ? 'cmyk' : photo <= 1 ? 'gray' : 'rgb', cmyk: ink, name: typeof t.get(285) === 'string' ? t.get(285) : '' };
}

/** Decodes every page. Returns the first page with `pages` holding all of them. */
export async function decodeTiff(bytes) {
  if (!isTiff(bytes)) throw new FormatError('Not a TIFF file');
  const ifds = readIfds(bytes, { subIfds: false });
  const pages = [];
  for (const ifd of ifds) {
    if (!ifd.tags.has(256) || (!ifd.tags.has(273) && !ifd.tags.has(324))) continue;
    // reduced resolution pages (thumbnails) are skipped
    if (one(ifd.tags, 254, 0) & 1) continue;
    pages.push(await decodeTiffPage(bytes, ifd));
  }
  if (!pages.length) throw new FormatError('The TIFF file has no readable images', 'damaged');
  return { ...pages[0], pages: pages.length > 1 ? pages : undefined };
}

/**
 * Encodes pages as TIFF. page: { width, height, data (RGBA) } or { width, height, cmyk
 * (4 bytes per pixel ink) }. compression: 'lzw' | 'deflate' | 'none'.
 */
export async function encodeTiff(pages, { compression = 'lzw', dpi = 72, names = [] } = {}) {
  const list = Array.isArray(pages) ? pages : [pages];
  const little = true;
  const w = new Writer(1 << 16, { little });
  w.ascii('II').u16(42);
  let fixNext = w.later32();
  const comp = compression === 'deflate' ? 8 : compression === 'none' ? 1 : 5;
  for (let pi = 0; pi < list.length; pi++) {
    const pg = list[pi];
    const cmyk = !!pg.cmyk;
    let alpha = false;
    if (!cmyk) for (let i = 3; i < pg.data.length; i += 4) if (pg.data[i] !== 255) alpha = true;
    const spp = cmyk ? 4 : alpha ? 4 : 3;
    const src = cmyk ? pg.cmyk : pg.data;
    const rowsPerStrip = Math.max(1, Math.floor(65536 / (pg.width * spp)));
    const strips = [];
    for (let y = 0; y < pg.height; y += rowsPerStrip) {
      const rows = Math.min(rowsPerStrip, pg.height - y);
      const raw = new Uint8Array(pg.width * rows * spp);
      for (let yy = 0; yy < rows; yy++) {
        for (let x = 0; x < pg.width; x++) {
          const s = ((y + yy) * pg.width + x) * 4;
          const d = (yy * pg.width + x) * spp;
          for (let c = 0; c < spp; c++) raw[d + c] = src[s + c];
        }
      }
      // horizontal predictor for compressed strips
      if (comp !== 1) for (let yy = 0; yy < rows; yy++) for (let x = pg.width * spp - 1; x >= spp; x--) raw[yy * pg.width * spp + x] = (raw[yy * pg.width * spp + x] - raw[yy * pg.width * spp + x - spp]) & 255;
      strips.push(comp === 5 ? lzwEncodeTiff(raw) : comp === 8 ? await zlibDeflate(raw) : raw);
    }
    // pixel data first, then the IFD
    const offsets = [];
    for (const s of strips) {
      if (w.pos & 1) w.u8(0);
      offsets.push(w.pos);
      w.bytes(s);
    }
    if (w.pos & 1) w.u8(0);
    const bpsAt = w.pos;
    for (let i = 0; i < spp; i++) w.u16(8);
    const resAt = w.pos;
    w.u32(Math.round(dpi * 10000)).u32(10000);
    const offAt = w.pos;
    for (const o of offsets) w.u32(o);
    const cntAt = w.pos;
    for (const s of strips) w.u32(s.length);
    const name = names[pi] ? String(names[pi]).slice(0, 200) : '';
    const nameAt = w.pos;
    if (name) w.ascii(name).u8(0);
    const swAt = w.pos;
    w.ascii('pixelotter').u8(0);
    if (w.pos & 1) w.u8(0);
    const entries = [];
    const add = (tag, type, count, value) => entries.push([tag, type, count, value]);
    if (list.length > 1) add(254, 4, 1, 2); // page of a multi page document
    add(256, 4, 1, pg.width);
    add(257, 4, 1, pg.height);
    add(258, 3, spp, spp <= 2 ? 8 | (8 << 16) : bpsAt);
    add(259, 3, 1, comp);
    add(262, 3, 1, cmyk ? 5 : 2);
    if (name) add(285, 2, name.length + 1, nameAt);
    add(273, 4, offsets.length, offsets.length === 1 ? offsets[0] : offAt);
    add(277, 3, 1, spp);
    add(278, 4, 1, rowsPerStrip);
    add(279, 4, strips.length, strips.length === 1 ? strips[0].length : cntAt);
    add(282, 5, 1, resAt);
    add(283, 5, 1, resAt);
    add(284, 3, 1, 1);
    add(296, 3, 1, 2);
    add(305, 2, 11, swAt);
    if (comp !== 1) add(317, 3, 1, 2);
    if (cmyk) add(332, 3, 1, 1);
    if (!cmyk && alpha) add(338, 3, 1, 2);
    entries.sort((a, b) => a[0] - b[0]);
    fixNext(w.pos);
    w.u16(entries.length);
    for (const [tag, type, count, value] of entries) {
      w.u16(tag).u16(type).u32(count);
      if (type === 3 && count === 1) w.u16(value).u16(0);
      else w.u32(value);
    }
    fixNext = w.later32();
  }
  return w.done();
}
