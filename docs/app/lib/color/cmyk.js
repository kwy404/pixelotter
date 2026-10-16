// Generated from src/color/cmyk.js by scripts/build-app.mjs. Edit the source, not this copy.
// Simulated CMYK. This is an approximation made for pixelotter, not a press profile: a simple
// model of a generic coated offset press with
//   * sixteen overprint colors (paper, C, M, Y, K and every combination), set in sRGB,
//   * the Yule-Nielsen modified spectral Neugebauer equations (n = 1.7) in linear light,
//   * 15 percent dot gain at 50 percent tint,
//   * gray component replacement for the black channel and a 300 percent total ink limit.
// RGB to CMYK solves the model backwards (damped Gauss Newton in L*a*b*), so a separation
// printed through the same model comes back close to the original when the color can be
// printed, and far from it when it cannot: that difference drives the gamut warning and the
// soft proof. It does not reproduce any print shop's exact output.

import { clamp01, deltaE, fromLinear, lin8, linToXyz, toLinear, xyzToLab } from './convert.js';

export const PRESS = Object.freeze({
  name: 'pixelotter generic coated press (simulated)',
  n: 1.7,
  dotGain: 0.15,
  tac: 3.0,
  // 8 bit sRGB of the solid overprints, indexed by ink bits c = 1, m = 2, y = 4, k = 8
  primaries: [
    [246, 244, 238], // paper
    [0, 160, 226], // C
    [228, 0, 126], // M
    [37, 52, 145], // CM (blue)
    [255, 238, 0], // Y
    [0, 152, 82], // CY (green)
    [231, 33, 38], // MY (red)
    [52, 46, 52], // CMY
    [38, 34, 35], // K
    [16, 34, 46], // CK
    [44, 16, 26], // MK
    [18, 18, 34], // CMK
    [44, 42, 18], // YK
    [14, 30, 22], // CYK
    [44, 18, 16], // MYK
    [16, 14, 16], // CMYK
  ],
});

const N = PRESS.n;
const P = PRESS.primaries.map((rgb) => rgb.map((v) => Math.pow(lin8(v), 1 / N)));

const gain = (v) => clamp01(v + PRESS.dotGain * 4 * v * (1 - v));

/** Inks 0..1 to linear RGB, through the press model. */
export function inkToLinear(c, m, y, k) {
  const a = [gain(c), gain(m), gain(y), gain(k)];
  let r = 0;
  let g = 0;
  let b = 0;
  for (let mask = 0; mask < 16; mask++) {
    let w = 1;
    for (let i = 0; i < 4; i++) w *= mask & (1 << i) ? a[i] : 1 - a[i];
    if (!w) continue;
    r += w * P[mask][0];
    g += w * P[mask][1];
    b += w * P[mask][2];
  }
  return [Math.pow(r, N), Math.pow(g, N), Math.pow(b, N)];
}

const inkToLab = (c, m, y, k) => xyzToLab(...linToXyz(...inkToLinear(c, m, y, k)));

/** Inks in percent (0..100) to 8 bit sRGB, as the simulated press would print them. */
export function cmykToRgb(c, m, y, k) {
  return inkToLinear(c / 100, m / 100, y / 100, k / 100).map((v) => Math.round(clamp01(fromLinear(clamp01(v))) * 255));
}

/** Black generation: how much K for a color, from its gray component. */
function blackFor(r, g, b) {
  const gray = 1 - Math.max(r, g, b) / 255;
  const t = clamp01((gray - 0.18) / 0.82);
  return clamp01(Math.pow(t, 1.25) * 0.98);
}

function solve3(A, v) {
  const det = A[0] * (A[4] * A[8] - A[5] * A[7]) - A[1] * (A[3] * A[8] - A[5] * A[6]) + A[2] * (A[3] * A[7] - A[4] * A[6]);
  if (Math.abs(det) < 1e-12) return [0, 0, 0];
  const inv = [
    A[4] * A[8] - A[5] * A[7],
    A[2] * A[7] - A[1] * A[8],
    A[1] * A[5] - A[2] * A[4],
    A[5] * A[6] - A[3] * A[8],
    A[0] * A[8] - A[2] * A[6],
    A[2] * A[3] - A[0] * A[5],
    A[3] * A[7] - A[4] * A[6],
    A[1] * A[6] - A[0] * A[7],
    A[0] * A[4] - A[1] * A[3],
  ];
  return [0, 1, 2].map((i) => (inv[i * 3] * v[0] + inv[i * 3 + 1] * v[1] + inv[i * 3 + 2] * v[2]) / det);
}

function limitInk(x, k) {
  const total = x[0] + x[1] + x[2] + k;
  if (total <= PRESS.tac) return x;
  const f = Math.max(0, PRESS.tac - k) / (x[0] + x[1] + x[2]);
  return x.map((v) => v * f);
}

/**
 * Separates one 8 bit sRGB color into inks (0..1). Returns { ink: [c, m, y, k], error }, where
 * error is the L*a*b* difference that remains (large for colors the press cannot print).
 */
export function separate(r, g, b, iterations = 14) {
  // r, g, b may be fractional (lookup table nodes), so no 8 bit table here
  const target = xyzToLab(...linToXyz(toLinear(r / 255), toLinear(g / 255), toLinear(b / 255)));
  const k = blackFor(r, g, b);
  // start from a naive separation under the black
  const kk = 1 - k;
  let x = [r, g, b].map((v) => clamp01((1 - v / 255 - k) / (kk || 1)));
  x = limitInk(x, k);
  let lab = inkToLab(x[0], x[1], x[2], k);
  let err = deltaE(lab, target);
  const h = 1e-3;
  let lambda = 1e-3;
  for (let it = 0; it < iterations && err > 0.05; it++) {
    const J = [];
    for (let j = 0; j < 3; j++) {
      const xp = x.slice();
      xp[j] = x[j] + h <= 1 ? x[j] + h : x[j] - h;
      const d = xp[j] - x[j];
      const lp = inkToLab(xp[0], xp[1], xp[2], k);
      J.push([(lp[0] - lab[0]) / d, (lp[1] - lab[1]) / d, (lp[2] - lab[2]) / d]);
    }
    const f = [lab[0] - target[0], lab[1] - target[1], lab[2] - target[2]];
    // (J^T J + lambda I) dx = -J^T f, with J[j] the column for ink j
    const A = new Array(9).fill(0);
    const v = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) A[i * 3 + j] = J[i][0] * J[j][0] + J[i][1] * J[j][1] + J[i][2] * J[j][2];
      A[i * 3 + i] += lambda * (1 + A[i * 3 + i]);
      v[i] = -(J[i][0] * f[0] + J[i][1] * f[1] + J[i][2] * f[2]);
    }
    const dx = solve3(A, v);
    const next = limitInk(x.map((xi, i) => clamp01(xi + dx[i])), k);
    const nlab = inkToLab(next[0], next[1], next[2], k);
    const nerr = deltaE(nlab, target);
    if (nerr < err) {
      x = next;
      lab = nlab;
      err = nerr;
      lambda = Math.max(1e-6, lambda / 4);
    } else lambda *= 8;
  }
  return { ink: [x[0], x[1], x[2], k], error: err, lab };
}

/** One color in percent, for the color panel and the eyedropper. */
export function rgbToCmyk(r, g, b) {
  return separate(r, g, b).ink.map((v) => Math.round(v * 1000) / 10);
}

/** True when the simulated press can print the color within a visible difference. */
export function inGamut(r, g, b, threshold = 5) {
  return separate(r, g, b).error <= threshold;
}

/**
 * A converter for whole images, with lookup tables built once (25 points per axis, trilinear
 * interpolation). toCmyk, toRgb, proof and gamut work on RGBA buffers.
 */
export function cmykConverter(size = 25) {
  const S = size;
  const step = 255 / (S - 1);
  const sep = new Float32Array(S * S * S * 4);
  const proof = new Float32Array(S * S * S * 3);
  const err = new Float32Array(S * S * S);
  for (let ri = 0; ri < S; ri++) {
    for (let gi = 0; gi < S; gi++) {
      for (let bi = 0; bi < S; bi++) {
        const n = (ri * S + gi) * S + bi;
        const s = separate(ri * step, gi * step, bi * step);
        sep.set(s.ink, n * 4);
        const lin = inkToLinear(...s.ink);
        for (let c = 0; c < 3; c++) proof[n * 3 + c] = clamp01(fromLinear(clamp01(lin[c]))) * 255;
        err[n] = s.error;
      }
    }
  }
  const sample = (table, ch, r, g, b, out) => {
    const fr = (r / 255) * (S - 1);
    const fg = (g / 255) * (S - 1);
    const fb = (b / 255) * (S - 1);
    const r0 = Math.min(S - 2, Math.floor(fr));
    const g0 = Math.min(S - 2, Math.floor(fg));
    const b0 = Math.min(S - 2, Math.floor(fb));
    const tr = fr - r0;
    const tg = fg - g0;
    const tb = fb - b0;
    for (let c = 0; c < ch; c++) {
      let acc = 0;
      for (let i = 0; i < 8; i++) {
        const dr = i & 4 ? 1 : 0;
        const dg = i & 2 ? 1 : 0;
        const db = i & 1 ? 1 : 0;
        const w = (dr ? tr : 1 - tr) * (dg ? tg : 1 - tg) * (db ? tb : 1 - tb);
        acc += w * table[(((r0 + dr) * S + g0 + dg) * S + b0 + db) * ch + c];
      }
      out[c] = acc;
    }
    return out;
  };
  const tmp = [0, 0, 0, 0];
  return {
    /** RGBA to 4 bytes per pixel of ink (0 = no ink, 255 = solid). */
    toCmyk(rgba) {
      const out = new Uint8Array((rgba.length / 4) * 4);
      for (let i = 0; i < rgba.length; i += 4) {
        sample(sep, 4, rgba[i], rgba[i + 1], rgba[i + 2], tmp);
        out[i] = Math.round(tmp[0] * 255);
        out[i + 1] = Math.round(tmp[1] * 255);
        out[i + 2] = Math.round(tmp[2] * 255);
        out[i + 3] = Math.round(tmp[3] * 255);
      }
      return out;
    },
    /** Ink bytes back to RGBA through the press model (alpha from the second argument or 255). */
    toRgb(cmyk, alpha = null) {
      const out = new Uint8ClampedArray(cmyk.length);
      const cache = new Map();
      for (let i = 0; i < cmyk.length; i += 4) {
        const key = (cmyk[i] << 24) | (cmyk[i + 1] << 16) | (cmyk[i + 2] << 8) | cmyk[i + 3];
        let rgb = cache.get(key);
        if (!rgb) {
          rgb = cmykToRgb((cmyk[i] / 255) * 100, (cmyk[i + 1] / 255) * 100, (cmyk[i + 2] / 255) * 100, (cmyk[i + 3] / 255) * 100);
          if (cache.size < 100000) cache.set(key, rgb);
        }
        out[i] = rgb[0];
        out[i + 1] = rgb[1];
        out[i + 2] = rgb[2];
        out[i + 3] = alpha ? alpha[i / 4] : 255;
      }
      return out;
    },
    /** Soft proof: how the RGBA image would print. Alpha is kept. */
    proof(rgba) {
      const out = new Uint8ClampedArray(rgba.length);
      for (let i = 0; i < rgba.length; i += 4) {
        sample(proof, 3, rgba[i], rgba[i + 1], rgba[i + 2], tmp);
        out[i] = tmp[0];
        out[i + 1] = tmp[1];
        out[i + 2] = tmp[2];
        out[i + 3] = rgba[i + 3];
      }
      return out;
    },
    /** One byte per pixel: 255 where the color is outside the press gamut. */
    gamut(rgba, threshold = 5) {
      const out = new Uint8Array(rgba.length / 4);
      for (let i = 0; i < rgba.length; i += 4) {
        sample(err, 1, rgba[i], rgba[i + 1], rgba[i + 2], tmp);
        if (tmp[0] > threshold) out[i / 4] = 255;
      }
      return out;
    },
  };
}
