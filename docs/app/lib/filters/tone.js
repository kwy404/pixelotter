// Generated from src/filters/tone.js by scripts/build-app.mjs. Edit the source, not this copy.
// Tone and color adjustments. Every one is a pure function (image, params) => image and can be
// used as an adjustment layer: levels, curves, exposure, brightness and contrast, vibrance,
// hue and saturation, color balance, black and white, photo filter, channel mixer, invert,
// posterize, threshold, gradient map and selective color.

import { applyLut, clamp01, clamp255, hexToRgb, lum, mapPixels } from './core.js';
import { hslToRgb, rgbToHsl } from '../color/convert.js';

/** One levels table: input black and white points, gamma, output black and white. */
export function levelsTable({ inBlack = 0, inWhite = 255, gamma = 1, outBlack = 0, outWhite = 255 } = {}) {
  const t = new Uint8ClampedArray(256);
  const span = Math.max(1, inWhite - inBlack);
  for (let i = 0; i < 256; i++) {
    let v = clamp01((i - inBlack) / span);
    v = Math.pow(v, 1 / Math.max(0.01, gamma));
    t[i] = clamp255(outBlack + v * (outWhite - outBlack));
  }
  return t;
}

export function levels(img, p = {}) {
  const m = levelsTable(p.master ?? p);
  const ch = ['red', 'green', 'blue'].map((c) => levelsTable(p[c] ?? {}));
  const t = ch.map((c) => {
    const out = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) out[i] = c[m[i]];
    return out;
  });
  return applyLut(img, t[0], t[1], t[2]);
}

/**
 * A curve through control points [[x, y], ...] (0..255), as a 256 entry table, with monotone
 * cubic interpolation so the curve never overshoots between points.
 */
export function curveTable(points) {
  const pts = (points?.length ? points : [[0, 0], [255, 255]]).map(([x, y]) => [Math.max(0, Math.min(255, x)), Math.max(0, Math.min(255, y))]).sort((a, b) => a[0] - b[0]);
  const uniq = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0]);
  const t = new Uint8ClampedArray(256);
  if (uniq.length === 1) return t.fill(uniq[0][1]);
  const n = uniq.length;
  const dx = [];
  const m = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(uniq[i + 1][0] - uniq[i][0]);
    m.push((uniq[i + 1][1] - uniq[i][1]) / dx[i]);
  }
  const tan = [m[0]];
  for (let i = 1; i < n - 1; i++) tan.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  tan.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      tan[i] = 0;
      tan[i + 1] = 0;
      continue;
    }
    const a = tan[i] / m[i];
    const b = tan[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      tan[i] = k * a * m[i];
      tan[i + 1] = k * b * m[i];
    }
  }
  for (let x = 0; x < 256; x++) {
    if (x <= uniq[0][0]) {
      t[x] = uniq[0][1];
      continue;
    }
    if (x >= uniq[n - 1][0]) {
      t[x] = uniq[n - 1][1];
      continue;
    }
    let i = 0;
    while (uniq[i + 1][0] < x) i++;
    const h = dx[i];
    const s = (x - uniq[i][0]) / h;
    const h00 = 2 * s ** 3 - 3 * s ** 2 + 1;
    const h10 = s ** 3 - 2 * s ** 2 + s;
    const h01 = -2 * s ** 3 + 3 * s ** 2;
    const h11 = s ** 3 - s ** 2;
    t[x] = clamp255(h00 * uniq[i][1] + h10 * h * tan[i] + h01 * uniq[i + 1][1] + h11 * h * tan[i + 1]);
  }
  return t;
}

export function curves(img, p = {}) {
  const m = curveTable(p.rgb);
  const ch = ['red', 'green', 'blue'].map((c) => curveTable(p[c]));
  const t = ch.map((c) => {
    const out = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) out[i] = c[m[i]];
    return out;
  });
  return applyLut(img, t[0], t[1], t[2]);
}

export function exposure(img, { exposure: ev = 0, offset = 0, gamma = 1 } = {}) {
  const t = new Uint8ClampedArray(256);
  const k = 2 ** ev;
  for (let i = 0; i < 256; i++) {
    // in linear light, like a camera exposure change
    const lin = Math.pow(i / 255, 2.2) * k + offset;
    t[i] = clamp255(Math.pow(clamp01(lin), 1 / (2.2 * Math.max(0.01, gamma))) * 255);
  }
  return applyLut(img, t);
}

export function brightnessContrast(img, { brightness = 0, contrast = 0 } = {}) {
  const t = new Uint8ClampedArray(256);
  const c = contrast >= 0 ? 1 + contrast / 50 : 1 + contrast / 100;
  for (let i = 0; i < 256; i++) t[i] = clamp255((i + brightness * 1.5 - 128) * c + 128);
  return applyLut(img, t);
}

export function vibrance(img, { vibrance: vib = 0, saturation = 0 } = {}) {
  const v = vib / 100;
  const s = saturation / 100;
  return mapPixels(img, (r, g, b) => {
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const sat = mx ? (mx - mn) / mx : 0;
    // vibrance boosts muted colors more than saturated ones and spares skin like oranges a bit
    const skin = r > g && g > b ? 0.6 : 1;
    const amount = 1 + s + v * (1 - sat) * skin;
    const l = lum(r, g, b);
    return [l + (r - l) * amount, l + (g - l) * amount, l + (b - l) * amount];
  });
}

export function hueSaturation(img, { hue = 0, saturation = 0, lightness = 0, colorize = false, colorHue = 30, colorSat = 25 } = {}) {
  return mapPixels(img, (r, g, b) => {
    let [h, s, l] = rgbToHsl(r, g, b);
    if (colorize) {
      h = colorHue;
      s = colorSat / 100;
    } else {
      h = (h + hue + 360) % 360;
      s = saturation >= 0 ? s + (1 - s) * (saturation / 100) * s : s * (1 + saturation / 100);
    }
    l = lightness >= 0 ? l + (1 - l) * (lightness / 100) : l * (1 + lightness / 100);
    return hslToRgb(h, clamp01(s), clamp01(l));
  });
}

/** Color balance with separate shadows, midtones and highlights ranges. */
export function colorBalance(img, { shadows = [0, 0, 0], midtones = [0, 0, 0], highlights = [0, 0, 0], preserve = true } = {}) {
  return mapPixels(img, (r, g, b) => {
    const l = lum(r, g, b) / 255;
    const ws = clamp01(1 - l * 3.2) * 0.7 + clamp01(1 - l * 1.6) * 0.3;
    const wh = clamp01((l - 0.45) * 2.2) * 0.85;
    const wm = clamp01(1 - Math.abs(l - 0.5) * 2.2);
    const shift = [0, 1, 2].map((c) => (shadows[c] * ws + midtones[c] * wm + highlights[c] * wh) * 0.9);
    let nr = r + shift[0];
    let ng = g + shift[1];
    let nb = b + shift[2];
    if (preserve) {
      const d = lum(r, g, b) - lum(nr, ng, nb);
      nr += d;
      ng += d;
      nb += d;
    }
    return [nr, ng, nb];
  });
}

/** Black and white with a weight per hue range (in percent, like a filter in front of a camera). */
export function blackWhite(img, { reds = 40, yellows = 60, greens = 40, cyans = 60, blues = 20, magentas = 80, tint = false, tintHue = 35, tintSat = 15 } = {}) {
  const w = [reds, yellows, greens, cyans, blues, magentas].map((v) => v / 100);
  return mapPixels(img, (r, g, b) => {
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const [h] = rgbToHsl(r, g, b);
    // blend the two nearest hue weights, scaled by how colorful the pixel is
    const pos = h / 60;
    const i0 = Math.floor(pos) % 6;
    const i1 = (i0 + 1) % 6;
    const t = pos - Math.floor(pos);
    const weight = w[i0] * (1 - t) + w[i1] * t;
    const gray = mn + (mx - mn) * weight;
    const base = lum(r, g, b);
    const chroma = (mx - mn) / 255;
    const v = base * (1 - chroma) + gray * chroma;
    if (!tint) return [v, v, v];
    return hslToRgb(tintHue, tintSat / 100, clamp01(v / 255));
  });
}

export function photoFilter(img, { color = '#ec8a00', density = 25, preserve = true } = {}) {
  const [cr, cg, cb] = hexToRgb(color);
  const d = density / 100;
  return mapPixels(img, (r, g, b) => {
    let nr = r * (1 - d) + ((r * cr) / 255) * d;
    let ng = g * (1 - d) + ((g * cg) / 255) * d;
    let nb = b * (1 - d) + ((b * cb) / 255) * d;
    if (preserve) {
      const l0 = lum(r, g, b);
      const l1 = lum(nr, ng, nb) || 1;
      const k = l0 / l1;
      nr *= k;
      ng *= k;
      nb *= k;
    }
    return [nr, ng, nb];
  });
}

/** Channel mixer: each output channel is a mix of the inputs, in percent, plus a constant. */
export function channelMixer(img, { red = [100, 0, 0, 0], green = [0, 100, 0, 0], blue = [0, 0, 100, 0], monochrome = false } = {}) {
  const rows = [red, green, blue];
  return mapPixels(img, (r, g, b) => {
    const out = rows.map((m) => (r * m[0] + g * m[1] + b * m[2]) / 100 + (m[3] ?? 0) * 2.55);
    return monochrome ? [out[0], out[0], out[0]] : out;
  });
}

export const invert = (img) => mapPixels(img, (r, g, b) => [255 - r, 255 - g, 255 - b]);

export function posterize(img, { levels: n = 4 } = {}) {
  const k = Math.max(2, Math.round(n));
  const t = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) t[i] = Math.round(Math.round((i / 255) * (k - 1)) * (255 / (k - 1)));
  return applyLut(img, t);
}

export function threshold(img, { level = 128 } = {}) {
  return mapPixels(img, (r, g, b) => {
    const v = lum(r, g, b) >= level ? 255 : 0;
    return [v, v, v];
  });
}

/** Gradient map: luminance picks a color from a list of stops [{ at (0..1), color }]. */
export function gradientMap(img, { stops = [{ at: 0, color: '#120d0a' }, { at: 1, color: '#f3e3c8' }], reverse = false } = {}) {
  const s = [...stops].map((x) => ({ at: clamp01(Number(x.at)), c: hexToRgb(x.color) })).sort((a, b) => a.at - b.at);
  const table = [];
  for (let i = 0; i < 256; i++) {
    let t = i / 255;
    if (reverse) t = 1 - t;
    let k = 0;
    while (k < s.length - 1 && s[k + 1].at < t) k++;
    const a = s[k];
    const b = s[Math.min(k + 1, s.length - 1)];
    const f = b.at > a.at ? clamp01((t - a.at) / (b.at - a.at)) : 0;
    table.push([0, 1, 2].map((c) => a.c[c] + (b.c[c] - a.c[c]) * f));
  }
  return mapPixels(img, (r, g, b) => table[clamp255(lum(r, g, b))]);
}

/**
 * Selective color, simplified: for pixels in a hue range (or neutrals, whites, blacks), add or
 * remove cyan, magenta, yellow and black ink, in percent of what is there.
 */
export function selectiveColor(img, { range = 'reds', cyan = 0, magenta = 0, yellow = 0, black = 0 } = {}) {
  const centers = { reds: 0, yellows: 60, greens: 120, cyans: 180, blues: 240, magentas: 300 };
  return mapPixels(img, (r, g, b) => {
    const [h, s, l] = rgbToHsl(r, g, b);
    let w;
    if (range in centers) {
      const d = Math.min(Math.abs(h - centers[range]), 360 - Math.abs(h - centers[range]));
      w = clamp01(1 - d / 60) * s;
    } else if (range === 'whites') w = clamp01((l - 0.5) * 2);
    else if (range === 'blacks') w = clamp01((0.5 - l) * 2);
    else w = (1 - s) * (1 - Math.abs(l - 0.5) * 2);
    if (w <= 0) return [r, g, b];
    const ink = [1 - r / 255, 1 - g / 255, 1 - b / 255];
    const add = [cyan, magenta, yellow].map((v) => v / 100);
    const out = ink.map((c, i) => clamp01(c + (add[i] >= 0 ? (1 - c) * add[i] : c * add[i]) * w));
    const k = (black / 100) * w;
    return out.map((c) => (1 - clamp01(c + (k >= 0 ? (1 - c) * k : c * k))) * 255);
  });
}
