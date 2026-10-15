// Layer compositing. The editor draws with the canvas 2D context, whose composite operations
// follow the W3C Compositing and Blending spec. This module is that spec in plain code: the
// list of modes the layer panel offers, their canvas names, and a reference compositor for
// RGBA pixel arrays. The tests use it on known pixels, and the end to end test checks that
// the browser canvas gives the same result.

export const BLEND_MODES = Object.freeze([
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
]);

/** Groups of modes for the blend menu, the way photo editors usually order them. */
export const BLEND_GROUPS = Object.freeze([
  ['normal'],
  ['darken', 'multiply', 'color-burn'],
  ['lighten', 'screen', 'color-dodge'],
  ['overlay', 'soft-light', 'hard-light'],
  ['difference', 'exclusion'],
  ['hue', 'saturation', 'color', 'luminosity'],
]);

/** The canvas globalCompositeOperation for a blend mode. */
export const canvasOp = (mode) => (mode === 'normal' || !BLEND_MODES.includes(mode) ? 'source-over' : mode);

const sep = {
  normal: (b, s) => s,
  multiply: (b, s) => b * s,
  screen: (b, s) => b + s - b * s,
  overlay: (b, s) => sep['hard-light'](s, b),
  darken: (b, s) => Math.min(b, s),
  lighten: (b, s) => Math.max(b, s),
  'color-dodge': (b, s) => (b === 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s))),
  'color-burn': (b, s) => (b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s)),
  'hard-light': (b, s) => (s <= 0.5 ? b * 2 * s : sep.screen(b, 2 * s - 1)),
  'soft-light': (b, s) => {
    if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b);
    const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
    return b + (2 * s - 1) * (d - b);
  },
  difference: (b, s) => Math.abs(b - s),
  exclusion: (b, s) => b + s - 2 * b * s,
};

// Non separable helpers (spec section 9.2).
const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
function clipColor(c) {
  const l = lum(c);
  const n = Math.min(c[0], c[1], c[2]);
  const x = Math.max(c[0], c[1], c[2]);
  let out = c;
  if (n < 0) out = out.map((v) => l + ((v - l) * l) / (l - n));
  if (x > 1) out = out.map((v) => l + ((v - l) * (1 - l)) / (x - l));
  return out;
}
const setLum = (c, l) => {
  const d = l - lum(c);
  return clipColor([c[0] + d, c[1] + d, c[2] + d]);
};
const sat = (c) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
function setSat(c, s) {
  const idx = [0, 1, 2].sort((a, b) => c[a] - c[b]);
  const [mn, md, mx] = idx;
  const out = [0, 0, 0];
  if (c[mx] > c[mn]) {
    out[md] = ((c[md] - c[mn]) * s) / (c[mx] - c[mn]);
    out[mx] = s;
  }
  out[mn] = 0;
  return out;
}
const nonSep = {
  hue: (b, s) => setLum(setSat(s, sat(b)), lum(b)),
  saturation: (b, s) => setLum(setSat(b, sat(s)), lum(b)),
  color: (b, s) => setLum(s, lum(b)),
  luminosity: (b, s) => setLum(b, lum(s)),
};

/** The blended color B(Cb, Cs) for one pixel, channels 0 to 1. */
export function blendColor(mode, cb, cs) {
  if (nonSep[mode]) return nonSep[mode](cb, cs);
  const f = sep[mode] ?? sep.normal;
  return [f(cb[0], cs[0]), f(cb[1], cs[1]), f(cb[2], cs[2])];
}

/**
 * Composites src over dst in place (both RGBA Uint8ClampedArray of the same size, not
 * premultiplied), with a blend mode and a layer opacity from 0 to 1:
 *   Cs' = (1 - ab) * Cs + ab * B(Cb, Cs)
 *   co  = as * Cs' + ab * Cb * (1 - as)       ao = as + ab * (1 - as)
 * An optional mask (one byte per pixel) scales the source alpha, like a layer mask.
 */
export function compositeOver(dst, src, mode = 'normal', opacity = 1, mask = null) {
  if (dst.length !== src.length) throw new RangeError('Layers must be the same size');
  const op = Math.max(0, Math.min(1, opacity));
  for (let i = 0, p = 0; i < dst.length; i += 4, p++) {
    let as = (src[i + 3] / 255) * op;
    if (mask) as *= mask[p] / 255;
    if (as <= 0) continue;
    const ab = dst[i + 3] / 255;
    const cs = [src[i] / 255, src[i + 1] / 255, src[i + 2] / 255];
    const cb = [dst[i] / 255, dst[i + 1] / 255, dst[i + 2] / 255];
    const mixed = ab > 0 && mode !== 'normal' ? blendColor(mode, cb, cs) : cs;
    const ao = as + ab * (1 - as);
    for (let c = 0; c < 3; c++) {
      const csp = (1 - ab) * cs[c] + ab * mixed[c];
      const co = as * csp + ab * cb[c] * (1 - as);
      dst[i + c] = Math.round((co / ao) * 255);
    }
    dst[i + 3] = Math.round(ao * 255);
  }
  return dst;
}

/**
 * Composites a stack of layers (bottom first) onto a background color or transparency.
 * layers: [{ data, visible = true, opacity = 1, blend = 'normal', mask }]
 */
export function flatten(width, height, layers, background = null) {
  const out = new Uint8ClampedArray(width * height * 4);
  if (background) {
    for (let i = 0; i < out.length; i += 4) {
      out[i] = background[0];
      out[i + 1] = background[1];
      out[i + 2] = background[2];
      out[i + 3] = background[3] ?? 255;
    }
  }
  for (const layer of layers) {
    if (layer.visible === false) continue;
    compositeOver(out, layer.data, layer.blend ?? 'normal', layer.opacity ?? 1, layer.mask ?? null);
  }
  return out;
}
