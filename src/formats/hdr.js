// High dynamic range images, read only: Radiance HDR (RGBE, flat or run length encoded) and
// OpenEXR scanline files (no compression, RLE, ZIPS or ZIP; half, float or uint channels).
// The editor works in 8 bit color, so the light is tone mapped on open with a global
// Reinhard curve around the scene's average luminance. EXR files with PIZ, PXR24, B44 or DWA
// compression, tiled or deep EXR files are reported as unsupported instead of opening wrongly.

import { FormatError, Reader, image, startsWith, zlibInflate } from './binary.js';

export const isHdr = (b) => startsWith(b, [0x23, 0x3f]); // "#?"
export const isExr = (b) => startsWith(b, [0x76, 0x2f, 0x31, 0x01]);

/** Tone maps linear float RGB(A) to sRGB 8 bit with a Reinhard curve. */
export function toneMap(width, height, rgb, alpha = null, { exposure = 1 } = {}) {
  const n = width * height;
  let logSum = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const l = 0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2];
    if (Number.isFinite(l) && l > 0) {
      logSum += Math.log(1e-6 + l);
      count++;
    }
  }
  const avg = count ? Math.exp(logSum / count) : 1;
  const key = (0.18 / avg) * exposure;
  const img = image(width, height);
  const enc = (v) => {
    const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(c * 255)));
  };
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      let v = rgb[i * 3 + c] * key;
      if (!Number.isFinite(v) || v < 0) v = 0;
      img.data[i * 4 + c] = enc(v / (1 + v));
    }
    img.data[i * 4 + 3] = alpha ? Math.max(0, Math.min(255, Math.round(alpha[i] * 255))) : 255;
  }
  return img;
}

export function decodeHdr(bytes) {
  if (!isHdr(bytes)) throw new FormatError('Not a Radiance HDR file');
  let pos = 0;
  const line = () => {
    let s = '';
    while (pos < bytes.length && bytes[pos] !== 0x0a) s += String.fromCharCode(bytes[pos++]);
    pos++;
    return s;
  };
  line();
  for (;;) {
    const l = line();
    if (!l) break;
    if (l.startsWith('FORMAT=') && !l.includes('32-bit_rle_rgbe')) throw new FormatError('This HDR file uses an unsupported color format', 'unsupported');
    if (pos >= bytes.length) throw new FormatError('The HDR file is damaged', 'damaged');
  }
  const m = /^([-+])Y (\d+) ([-+])X (\d+)$/.exec(line().trim());
  if (!m) throw new FormatError('This HDR file uses an unsupported orientation', 'unsupported');
  const height = +m[2];
  const width = +m[4];
  const flipY = m[1] === '+';
  const flipX = m[3] === '-';
  const rgbe = new Uint8Array(width * height * 4);
  const scan = new Uint8Array(width * 4);
  for (let y = 0; y < height; y++) {
    if (width >= 8 && width < 32768 && bytes[pos] === 2 && bytes[pos + 1] === 2 && !(bytes[pos + 2] & 0x80)) {
      pos += 4;
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < width) {
          let n = bytes[pos++];
          if (n > 128) {
            n -= 128;
            const v = bytes[pos++];
            for (let k = 0; k < n && x < width; k++) scan[(x++) * 4 + c] = v;
          } else {
            for (let k = 0; k < n && x < width; k++) scan[(x++) * 4 + c] = bytes[pos++];
          }
        }
      }
    } else {
      scan.set(bytes.subarray(pos, pos + width * 4));
      pos += width * 4;
    }
    const yy = flipY ? height - 1 - y : y;
    for (let x = 0; x < width; x++) {
      const xx = flipX ? width - 1 - x : x;
      rgbe.set(scan.subarray(x * 4, x * 4 + 4), (yy * width + xx) * 4);
    }
  }
  const rgb = new Float32Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const e = rgbe[i * 4 + 3];
    const f = e ? Math.pow(2, e - 136) : 0;
    rgb[i * 3] = rgbe[i * 4] * f;
    rgb[i * 3 + 1] = rgbe[i * 4 + 1] * f;
    rgb[i * 3 + 2] = rgbe[i * 4 + 2] * f;
  }
  return { ...toneMap(width, height, rgb), hdr: true };
}

/** IEEE 754 half to float. */
export function halfToFloat(h) {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 31;
  const f = h & 1023;
  if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + f / 1024);
}

function exrRle(src, size) {
  const out = new Uint8Array(size);
  let i = 0;
  let o = 0;
  while (i < src.length && o < size) {
    const n = src[i] > 127 ? src[i] - 256 : src[i];
    i++;
    if (n < 0) {
      const len = Math.min(-n, size - o);
      out.set(src.subarray(i, i + len), o);
      i += -n;
      o += len;
    } else {
      out.fill(src[i++], o, Math.min(size, o + n + 1));
      o += n + 1;
    }
  }
  return out;
}

function exrUnpredict(raw) {
  // predictor, then de-interleave the two halves
  const t = new Uint8Array(raw);
  for (let i = 1; i < t.length; i++) t[i] = (t[i - 1] + t[i] - 128) & 255;
  const out = new Uint8Array(t.length);
  const half = (t.length + 1) >> 1;
  for (let i = 0, a = 0, b = half; i < t.length; i++) out[i] = i & 1 ? t[b++] : t[a++];
  return out;
}

export async function decodeExr(bytes) {
  if (!isExr(bytes)) throw new FormatError('Not an OpenEXR file');
  const r = new Reader(bytes, { little: true });
  r.skip(4);
  const flags = r.u32();
  if (flags & 0x200) throw new FormatError('Tiled OpenEXR files are not supported yet', 'unsupported');
  if (flags & 0x1800) throw new FormatError('Deep or multi part OpenEXR files are not supported', 'unsupported');
  const attrs = {};
  for (;;) {
    const name = r.cstring(256);
    if (!name) break;
    const type = r.cstring(256);
    const size = r.u32();
    const start = r.pos;
    if (type === 'chlist') {
      const ch = [];
      for (;;) {
        const n = r.cstring(256);
        if (!n) break;
        const pt = r.i32();
        r.skip(4);
        const xs = r.i32();
        const ys = r.i32();
        ch.push({ name: n, type: pt, xs, ys });
      }
      attrs[name] = ch;
    } else if (type === 'compression') attrs[name] = r.u8();
    else if (type === 'box2i') attrs[name] = [r.i32(), r.i32(), r.i32(), r.i32()];
    else if (type === 'lineOrder') attrs[name] = r.u8();
    r.seek(start + size);
  }
  const comp = attrs.compression ?? 0;
  const lines = { 0: 1, 1: 1, 2: 1, 3: 16 }[comp];
  if (!lines) throw new FormatError('This OpenEXR compression (PIZ, PXR24, B44 or DWA) is not supported yet', 'unsupported');
  const [x0, y0, x1, y1] = attrs.dataWindow ?? [0, 0, 0, 0];
  const width = x1 - x0 + 1;
  const height = y1 - y0 + 1;
  const channels = (attrs.channels ?? []).slice().sort((a, b) => (a.name < b.name ? -1 : 1));
  if (channels.some((c) => c.xs !== 1 || c.ys !== 1)) throw new FormatError('Subsampled OpenEXR channels are not supported', 'unsupported');
  const bytesPer = (t) => (t === 1 ? 2 : 4);
  const lineBytes = channels.reduce((a, c) => a + bytesPer(c.type) * width, 0);
  const chunks = Math.ceil(height / lines);
  const offsets = [];
  for (let i = 0; i < chunks; i++) offsets.push(r.u64(true));
  const planes = Object.fromEntries(channels.map((c) => [c.name, new Float32Array(width * height)]));
  for (const off of offsets) {
    r.seek(off);
    const y = r.i32() - y0;
    const size = r.u32();
    const raw = r.bytesAt(size);
    const n = Math.min(lines, height - y);
    const want = lineBytes * n;
    let data;
    if (comp === 0 || size === want) data = raw;
    else if (comp === 1) data = exrUnpredict(exrRle(raw, want));
    else data = exrUnpredict(await zlibInflate(raw));
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let p = 0;
    for (let ly = 0; ly < n; ly++) {
      for (const c of channels) {
        const plane = planes[c.name];
        const row = (y + ly) * width;
        for (let x = 0; x < width; x++) {
          let val;
          if (c.type === 1) val = halfToFloat(v.getUint16(p, true));
          else if (c.type === 2) val = v.getFloat32(p, true);
          else val = v.getUint32(p, true);
          p += bytesPer(c.type);
          plane[row + x] = val;
        }
      }
    }
  }
  const get = (n) => planes[n] ?? planes[n.toLowerCase()] ?? null;
  const R = get('R');
  const G = get('G');
  const B = get('B');
  const Y = get('Y');
  const A = get('A');
  const rgb = new Float32Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    rgb[i * 3] = R ? R[i] : Y ? Y[i] : 0;
    rgb[i * 3 + 1] = G ? G[i] : Y ? Y[i] : 0;
    rgb[i * 3 + 2] = B ? B[i] : Y ? Y[i] : 0;
  }
  return { ...toneMap(width, height, rgb, A), hdr: true };
}
