// Generated from src/filters/adjust.js by scripts/build-app.mjs. Edit the source, not this copy.
// Photo adjustments on raw RGBA pixels. Every function takes { data, width, height } (an
// ImageData or a plain object with a Uint8ClampedArray) and returns a new object of the same
// shape, so the same code runs in the browser, in a worker and in the unit tests.
//
// Order of operations, the same at every resolution so a preview matches the export:
//   1. tone lookup tables: exposure, brightness, contrast, warmth, tint, fade
//   2. per pixel: shadows, highlights, saturation
//   3. neighborhood: blur, then sharpen (an unsharp mask)
//   4. vignette
// Alpha is never changed.

export const ADJUSTMENTS = Object.freeze({
  exposure: { min: -100, max: 100 },
  brightness: { min: -100, max: 100 },
  contrast: { min: -100, max: 100 },
  saturation: { min: -100, max: 100 },
  warmth: { min: -100, max: 100 },
  tint: { min: -100, max: 100 },
  shadows: { min: -100, max: 100 },
  highlights: { min: -100, max: 100 },
  fade: { min: 0, max: 100 },
  vignette: { min: 0, max: 100 },
  sharpen: { min: 0, max: 100 },
  blur: { min: 0, max: 100 },
});

export const ADJUSTMENT_KEYS = Object.freeze(Object.keys(ADJUSTMENTS));

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/** A full set of adjustments with every value at its neutral position. */
export const neutralAdjustments = () => Object.fromEntries(ADJUSTMENT_KEYS.map((k) => [k, 0]));

/** Fills in missing keys, drops unknown ones and clamps every value to its range. */
export function normalizeAdjustments(input = {}) {
  const out = neutralAdjustments();
  for (const k of ADJUSTMENT_KEYS) {
    const v = Number(input?.[k]);
    if (Number.isFinite(v)) out[k] = clamp(Math.round(v), ADJUSTMENTS[k].min, ADJUSTMENTS[k].max);
  }
  return out;
}

export const isNeutral = (p) => ADJUSTMENT_KEYS.every((k) => !p?.[k]);

/** Rec. 709 luma of a pixel, 0 to 255. */
export const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Three 256 entry tables (r, g, b) for the tone stage. */
export function toneTables(p) {
  const exposure = 2 ** ((p.exposure || 0) / 50); // plus or minus 2 stops
  const brightness = ((p.brightness || 0) / 100) * 80;
  const c = (p.contrast || 0) / 100;
  const contrast = c >= 0 ? 1 + c * 1.5 : 1 + c * 0.9;
  const warmth = ((p.warmth || 0) / 100) * 30;
  const tint = ((p.tint || 0) / 100) * 24;
  const fade = ((p.fade || 0) / 100) * 70;
  const tables = [new Uint8ClampedArray(256), new Uint8ClampedArray(256), new Uint8ClampedArray(256)];
  const shift = [warmth, -tint, -warmth];
  for (let ch = 0; ch < 3; ch++) {
    for (let i = 0; i < 256; i++) {
      let v = i * exposure + brightness;
      v = (v - 128) * contrast + 128;
      v += shift[ch];
      if (fade) v = fade + (v * (255 - fade)) / 255;
      tables[ch][i] = clamp255(v);
    }
  }
  return tables;
}

function copyImage(img) {
  return { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height };
}

/** Applies every adjustment in p and returns a new image. */
export function applyAdjustments(img, params = {}) {
  const p = normalizeAdjustments(params);
  let out = copyImage(img);
  if (isNeutral(p)) return out;
  const d = out.data;
  const n = d.length;

  if (p.exposure || p.brightness || p.contrast || p.warmth || p.tint || p.fade) {
    const [tr, tg, tb] = toneTables(p);
    for (let i = 0; i < n; i += 4) {
      d[i] = tr[d[i]];
      d[i + 1] = tg[d[i + 1]];
      d[i + 2] = tb[d[i + 2]];
    }
  }

  if (p.shadows || p.highlights || p.saturation) {
    const sh = p.shadows / 100;
    const hi = p.highlights / 100;
    const sat = 1 + p.saturation / 100;
    for (let i = 0; i < n; i += 4) {
      let r = d[i];
      let g = d[i + 1];
      let b = d[i + 2];
      if (sh || hi) {
        const l = luma(r, g, b) / 255;
        // Shadows lift or deepen the dark end, highlights recover or boost the bright end.
        const ws = (1 - l) * (1 - l);
        const wh = l * l;
        const delta = sh * ws * 90 + hi * wh * 90;
        r += delta;
        g += delta;
        b += delta;
      }
      if (sat !== 1) {
        const l = luma(r, g, b);
        r = l + (r - l) * sat;
        g = l + (g - l) * sat;
        b = l + (b - l) * sat;
      }
      d[i] = clamp255(r);
      d[i + 1] = clamp255(g);
      d[i + 2] = clamp255(b);
    }
  }

  const scale = Math.max(img.width, img.height);
  if (p.blur) out = blurImage(out, Math.max(0.5, (p.blur / 100) * scale * 0.015));
  if (p.sharpen) out = sharpenImage(out, p.sharpen / 100);
  if (p.vignette) out = vignetteImage(out, p.vignette / 100);
  return out;
}

/**
 * Box blur of one channel plane (Float32Array, w * h) with radius r, done in place on the
 * rows and then the columns. Edges repeat the border pixel.
 */
function boxBlurPlane(src, dst, w, h, r) {
  const div = 2 * r + 1;
  // horizontal
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = src[row] * (r + 1);
    for (let x = 1; x <= r; x++) acc += src[row + Math.min(x, w - 1)];
    for (let x = 0; x < w; x++) {
      dst[row + x] = acc / div;
      const add = src[row + Math.min(x + r + 1, w - 1)];
      const sub = src[row + Math.max(x - r, 0)];
      acc += add - sub;
    }
  }
  // vertical, back into src
  for (let x = 0; x < w; x++) {
    let acc = dst[x] * (r + 1);
    for (let y = 1; y <= r; y++) acc += dst[Math.min(y, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      src[y * w + x] = acc / div;
      const add = dst[Math.min(y + r + 1, h - 1) * w + x];
      const sub = dst[Math.max(y - r, 0) * w + x];
      acc += add - sub;
    }
  }
}

/** Three box passes approximate a Gaussian with the given sigma. */
export function boxSizes(sigma, passes = 3) {
  const ideal = Math.sqrt((12 * sigma * sigma) / passes + 1);
  let wl = Math.floor(ideal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - passes * wl * wl - 4 * passes * wl - 3 * passes) / (-4 * wl - 4));
  return Array.from({ length: passes }, (_, i) => ((i < m ? wl : wu) - 1) / 2);
}

/** Gaussian like blur of a single plane (Float32Array). Returns the same array, blurred. */
export function blurPlane(plane, w, h, sigma) {
  if (sigma <= 0) return plane;
  const tmp = new Float32Array(plane.length);
  for (const r of boxSizes(sigma)) if (r > 0) boxBlurPlane(plane, tmp, w, h, Math.round(r));
  return plane;
}

/**
 * Blurs color with alpha weighting (premultiplied), so transparent pixels do not bleed a dark
 * fringe into the edges of a cut out subject.
 */
export function blurImage(img, sigma) {
  const { width: w, height: h } = img;
  const out = copyImage(img);
  if (sigma <= 0 || w === 0 || h === 0) return out;
  const n = w * h;
  const planes = [0, 1, 2, 3].map(() => new Float32Array(n));
  const d = img.data;
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    const a = d[i + 3] / 255;
    planes[0][j] = d[i] * a;
    planes[1][j] = d[i + 1] * a;
    planes[2][j] = d[i + 2] * a;
    planes[3][j] = d[i + 3];
  }
  for (const p of planes) blurPlane(p, w, h, sigma);
  const o = out.data;
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    const a = planes[3][j];
    const k = a > 0 ? 255 / a : 0;
    o[i] = clamp255(planes[0][j] * k);
    o[i + 1] = clamp255(planes[1][j] * k);
    o[i + 2] = clamp255(planes[2][j] * k);
    o[i + 3] = d[i + 3]; // alpha stays as it was
  }
  return out;
}

/** Unsharp mask: adds back the difference between the image and a small blur of it. */
export function sharpenImage(img, amount) {
  const out = copyImage(img);
  if (amount <= 0) return out;
  const soft = blurImage(img, 1.2);
  const k = amount * 1.8;
  const d = img.data;
  const s = soft.data;
  const o = out.data;
  for (let i = 0; i < d.length; i += 4) {
    o[i] = clamp255(d[i] + (d[i] - s[i]) * k);
    o[i + 1] = clamp255(d[i + 1] + (d[i + 1] - s[i + 1]) * k);
    o[i + 2] = clamp255(d[i + 2] + (d[i + 2] - s[i + 2]) * k);
  }
  return out;
}

/** Darkens the corners with a smooth radial falloff. */
export function vignetteImage(img, amount) {
  const out = copyImage(img);
  const { width: w, height: h } = img;
  const o = out.data;
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const maxD = Math.hypot(cx, cy) || 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = Math.hypot(x - cx, y - cy) / maxD; // 0 center, 1 corner
      const f = 1 - amount * 0.75 * Math.max(0, (t - 0.35) / 0.65) ** 2;
      const i = (y * w + x) * 4;
      o[i] = clamp255(o[i] * f);
      o[i + 1] = clamp255(o[i + 1] * f);
      o[i + 2] = clamp255(o[i + 2] * f);
    }
  }
  return out;
}

/** Luminance histogram (256 bins) of the opaque pixels, plus the mean saturation. */
export function analyze(img) {
  const hist = new Uint32Array(256);
  const d = img.data;
  let count = 0;
  let satSum = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 16) continue;
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    hist[Math.round(luma(r, g, b))]++;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    satSum += mx ? (mx - mn) / mx : 0;
    count++;
  }
  return { hist, count, saturation: count ? satSum / count : 0 };
}

function percentile(hist, count, q) {
  const target = count * q;
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= target) return i;
  }
  return 255;
}

/**
 * Auto enhance: reads the histogram and returns adjustments (not pixels), so the result shows
 * up on the sliders and can be tuned further. It stretches the tonal range, centers the mid
 * tones, opens up deep shadows, holds back clipped highlights and adds a little color to flat
 * photos. A photo that is already balanced gets small values or none.
 */
export function autoEnhance(img) {
  const { hist, count, saturation } = analyze(img);
  if (!count) return neutralAdjustments();
  const lo = percentile(hist, count, 0.01);
  const hi = percentile(hist, count, 0.99);
  const mid = percentile(hist, count, 0.5);
  const spread = Math.max(1, hi - lo);
  const p = {};
  // Exposure: move the median toward the middle gray (the tone tables use 2 ** (exposure / 50)).
  p.exposure = clamp(Math.round(Math.log2(118 / Math.max(8, mid)) * 40), -35, 45);
  const e = 2 ** (p.exposure / 50);
  // Contrast: stretch the range after exposure toward the full one, softly.
  const range = Math.max(1, spread * e);
  p.contrast = clamp(Math.round((220 / range - 1) * 40), -10, 35);
  const c = p.contrast >= 0 ? 1 + (p.contrast / 100) * 1.5 : 1 + (p.contrast / 100) * 0.9;
  // Brightness: put the median back near middle gray after the contrast pivot.
  const b = (118 - 128) / c + 128 - mid * e;
  p.brightness = clamp(Math.round((b / 80) * 100), -30, 30);
  const shadowShare = hist.slice(0, 40).reduce((a, b) => a + b, 0) / count;
  const highShare = hist.slice(225).reduce((a, b) => a + b, 0) / count;
  p.shadows = clamp(Math.round(shadowShare * 120), 0, 35);
  p.highlights = -clamp(Math.round(highShare * 120), 0, 35);
  p.saturation = saturation < 0.35 ? clamp(Math.round((0.35 - saturation) * 60), 0, 18) : 0;
  p.sharpen = 10;
  return normalizeAdjustments(p);
}
