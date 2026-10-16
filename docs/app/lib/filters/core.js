// Generated from src/filters/core.js by scripts/build-app.mjs. Edit the source, not this copy.
// Small helpers for the pixel filters: copying images, per channel lookup tables, bilinear
// sampling, a seeded random generator and value noise.

export const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export const copy = (img) => ({ width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) });
export const blank = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });

/** Applies three 256 entry tables (r, g, b) to every pixel. */
export function applyLut(img, lr, lg = lr, lb = lr) {
  const out = copy(img);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = lr[d[i]];
    d[i + 1] = lg[d[i + 1]];
    d[i + 2] = lb[d[i + 2]];
  }
  return out;
}

/** Runs fn(r, g, b, a, i) => [r, g, b] for every pixel. */
export function mapPixels(img, fn) {
  const out = copy(img);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const c = fn(d[i], d[i + 1], d[i + 2], d[i + 3], i >> 2);
    d[i] = clamp255(c[0]);
    d[i + 1] = clamp255(c[1]);
    d[i + 2] = clamp255(c[2]);
    if (c.length > 3) d[i + 3] = clamp255(c[3]);
  }
  return out;
}

export const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Bilinear sample of an RGBA image at (x, y), edges clamped (or wrapped). Writes into out. */
export function sample(img, x, y, out, wrap = false) {
  const { width: w, height: h, data: d } = img;
  if (wrap) {
    x = ((x % w) + w) % w;
    y = ((y % h) + h) % h;
  }
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const cx = (v) => (wrap ? ((v % w) + w) % w : v < 0 ? 0 : v >= w ? w - 1 : v);
  const cy = (v) => (wrap ? ((v % h) + h) % h : v < 0 ? 0 : v >= h ? h - 1 : v);
  const a = (cy(y0) * w + cx(x0)) * 4;
  const b = (cy(y0) * w + cx(x0 + 1)) * 4;
  const c = (cy(y0 + 1) * w + cx(x0)) * 4;
  const e = (cy(y0 + 1) * w + cx(x0 + 1)) * 4;
  for (let k = 0; k < 4; k++) out[k] = (d[a + k] * (1 - tx) + d[b + k] * tx) * (1 - ty) + (d[c + k] * (1 - tx) + d[e + k] * tx) * ty;
  return out;
}

/** Backward mapping: for every output pixel, map(x, y) gives the source position. */
export function remap(img, map, { wrap = false, outside = null } = {}) {
  const out = blank(img.width, img.height);
  const px = [0, 0, 0, 0];
  const p = { x: 0, y: 0 };
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      map(x + 0.5, y + 0.5, p);
      const i = (y * img.width + x) * 4;
      const sx = p.x - 0.5;
      const sy = p.y - 0.5;
      if (outside && !wrap && (sx < -0.5 || sy < -0.5 || sx > img.width - 0.5 || sy > img.height - 0.5)) {
        out.data.set(outside, i);
        continue;
      }
      sample(img, sx, sy, px, wrap);
      out.data[i] = px[0];
      out.data[i + 1] = px[1];
      out.data[i + 2] = px[2];
      out.data[i + 3] = px[3];
    }
  }
  return out;
}

export function rng(seed = 1) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise with octaves (fractal), values about 0..1. */
export function makeNoise(seed = 1) {
  const rand = rng(seed);
  const perm = new Uint8Array(512);
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    perm[i] = i;
    vals[i] = rand();
  }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 256; i++) perm[256 + i] = perm[i];
  const at = (x, y) => vals[perm[(perm[x & 255] + y) & 255]];
  const smooth = (t) => t * t * (3 - 2 * t);
  const noise = (x, y) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = smooth(x - x0);
    const ty = smooth(y - y0);
    const a = at(x0, y0);
    const b = at(x0 + 1, y0);
    const c = at(x0, y0 + 1);
    const d = at(x0 + 1, y0 + 1);
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
  return (x, y, octaves = 5) => {
    let sum = 0;
    let amp = 0.5;
    let f = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += noise(x * f, y * f) * amp;
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / norm;
  };
}

export const hexToRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})/i.exec(String(hex));
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
