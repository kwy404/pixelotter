// Generated from src/styles.js by scripts/build-app.mjs. Edit the source, not this copy.
// Layer styles: drop shadow, outer glow, stroke, inner glow, bevel and color overlay. They are
// computed from the layer's alpha, so they follow its shape whatever it is (pixels, text or
// shapes). renderStyles returns two RGBA buffers: what goes under the layer and what goes over.

import { distanceField } from './mask.js';
import { blurPlane } from './filters/adjust.js';
import { blendColor } from './blend.js';

export const STYLE_DEFAULTS = Object.freeze({
  shadow: { enabled: false, color: '#000000', opacity: 0.55, angle: 120, distance: 12, size: 18, spread: 0 },
  outerGlow: { enabled: false, color: '#f3c88b', opacity: 0.6, size: 24, spread: 0 },
  stroke: { enabled: false, color: '#ffffff', opacity: 1, size: 6, position: 'outside' },
  innerGlow: { enabled: false, color: '#f3c88b', opacity: 0.5, size: 16 },
  bevel: { enabled: false, depth: 100, size: 8, angle: 120, altitude: 30, highlight: 0.6, shadow: 0.5, soften: 2 },
  overlay: { enabled: false, color: '#c08a4e', opacity: 0.5, blend: 'normal' },
});

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const hex = (v, d) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : d);

/** Normalized styles, or null when none is enabled. */
export function normalizeStyles(input) {
  if (!input || typeof input !== 'object') return null;
  const out = {};
  let any = false;
  for (const [key, def] of Object.entries(STYLE_DEFAULTS)) {
    const s = input[key] ?? {};
    const v = { ...def };
    for (const k of Object.keys(def)) {
      if (s[k] === undefined) continue;
      if (typeof def[k] === 'boolean') v[k] = s[k] === true;
      else if (typeof def[k] === 'number') v[k] = num(s[k], def[k]);
      else if (k === 'color') v[k] = hex(s[k], def[k]);
      else v[k] = String(s[k]).slice(0, 20);
    }
    v.opacity = clamp(v.opacity ?? 1, 0, 1);
    if (key === 'stroke' && !['outside', 'inside', 'center'].includes(v.position)) v.position = 'outside';
    for (const k of ['size', 'distance', 'spread', 'depth', 'soften']) if (k in v) v[k] = clamp(v[k], 0, k === 'depth' ? 1000 : 500);
    out[key] = v;
    any ||= v.enabled;
  }
  return any ? out : out;
}

export const hasStyles = (styles) => !!styles && Object.values(styles).some((s) => s?.enabled);

const rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function paint(buf, alphaPlane, color, opacity) {
  const [r, g, b] = rgb(color);
  for (let i = 0; i < alphaPlane.length; i++) {
    const a = clamp(alphaPlane[i], 0, 255) * opacity;
    if (a <= 0) continue;
    // source over into buf
    const o = i * 4;
    const ab = buf[o + 3] / 255;
    const as = a / 255;
    const ao = as + ab * (1 - as);
    buf[o] = (r * as + buf[o] * ab * (1 - as)) / ao;
    buf[o + 1] = (g * as + buf[o + 1] * ab * (1 - as)) / ao;
    buf[o + 2] = (b * as + buf[o + 2] * ab * (1 - as)) / ao;
    buf[o + 3] = ao * 255;
  }
}

/**
 * Computes the styles of a layer. rgba: the layer as rendered (w * h * 4). scale: render scale,
 * so sizes given in document pixels shrink with a zoomed out view.
 * Returns { under, over } RGBA buffers (or null when that side is empty).
 */
export function renderStyles(rgba, w, h, styles, scale = 1) {
  if (!hasStyles(styles)) return { under: null, over: null };
  const n = w * h;
  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) alpha[i] = rgba[i * 4 + 3];
  let outside = null;
  let inside = null;
  const distOut = () => (outside ??= distanceField(w, h, (i) => alpha[i] >= 128));
  const distIn = () => (inside ??= distanceField(w, h, (i) => alpha[i] < 128));
  const under = new Uint8ClampedArray(n * 4);
  const over = new Uint8ClampedArray(n * 4);
  let usedUnder = false;
  let usedOver = false;
  const s = styles;
  if (s.outerGlow?.enabled) {
    const size = s.outerGlow.size * scale;
    const spread = (s.outerGlow.spread / 100) * size;
    const d = distOut();
    const plane = new Float32Array(n);
    for (let i = 0; i < n; i++) plane[i] = Math.sqrt(d[i]) <= spread ? 255 : alpha[i];
    blurPlane(plane, w, h, Math.max(0.5, (size - spread) / 2));
    paint(under, plane, s.outerGlow.color, s.outerGlow.opacity);
    usedUnder = true;
  }
  if (s.shadow?.enabled) {
    const size = s.shadow.size * scale;
    const dist = s.shadow.distance * scale;
    const a = ((180 - s.shadow.angle) * Math.PI) / 180;
    const dx = Math.round(Math.cos(a) * dist);
    const dy = Math.round(Math.sin(a) * dist);
    const plane = new Float32Array(n);
    const spread = (s.shadow.spread / 100) * size;
    const d = spread > 0 ? distOut() : null;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = x - dx;
        const sy = y - dy;
        if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
        const j = sy * w + sx;
        plane[y * w + x] = d && Math.sqrt(d[j]) <= spread ? 255 : alpha[j];
      }
    }
    if (size > 0) blurPlane(plane, w, h, Math.max(0.5, (size - spread) / 2));
    paint(under, plane, s.shadow.color, s.shadow.opacity);
    usedUnder = true;
  }
  if (s.overlay?.enabled) {
    const c = rgb(s.overlay.color).map((v) => v / 255);
    for (let i = 0; i < n; i++) {
      if (!alpha[i]) continue;
      const base = [rgba[i * 4] / 255, rgba[i * 4 + 1] / 255, rgba[i * 4 + 2] / 255];
      const mixed = blendColor(s.overlay.blend, base, c);
      const k = s.overlay.opacity;
      const o = i * 4;
      over[o] = (base[0] * (1 - k) + mixed[0] * k) * 255;
      over[o + 1] = (base[1] * (1 - k) + mixed[1] * k) * 255;
      over[o + 2] = (base[2] * (1 - k) + mixed[2] * k) * 255;
      over[o + 3] = alpha[i];
    }
    usedOver = true;
  }
  if (s.innerGlow?.enabled) {
    const size = Math.max(0.5, s.innerGlow.size * scale);
    const d = distIn();
    const plane = new Float32Array(n);
    for (let i = 0; i < n; i++) if (alpha[i]) plane[i] = (1 - clamp(Math.sqrt(d[i]) / size, 0, 1)) * alpha[i];
    paint(over, plane, s.innerGlow.color, s.innerGlow.opacity);
    usedOver = true;
  }
  if (s.bevel?.enabled) {
    const size = Math.max(1, s.bevel.size * scale);
    const height = new Float32Array(n);
    const d = distIn();
    for (let i = 0; i < n; i++) height[i] = alpha[i] ? Math.min(1, Math.sqrt(d[i]) / size) * 255 : 0;
    blurPlane(height, w, h, Math.max(0.5, s.bevel.soften * scale));
    const az = (s.bevel.angle * Math.PI) / 180;
    const el = (s.bevel.altitude * Math.PI) / 180;
    const L = [Math.cos(az) * Math.cos(el), -Math.sin(az) * Math.cos(el), Math.sin(el)];
    const k = (s.bevel.depth / 100) * 2;
    const hi = new Float32Array(n);
    const lo = new Float32Array(n);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!alpha[i]) continue;
        const gx = ((height[i + 1] - height[i - 1]) / 255) * k;
        const gy = ((height[i + w] - height[i - w]) / 255) * k;
        const len = Math.hypot(gx, gy, 1);
        const shade = (-gx * L[0] - gy * L[1] + L[2]) / len - L[2];
        if (shade > 0) hi[i] = shade * 255 * 2 * (alpha[i] / 255);
        else lo[i] = -shade * 255 * 2 * (alpha[i] / 255);
      }
    }
    paint(over, hi, '#ffffff', s.bevel.highlight);
    paint(over, lo, '#000000', s.bevel.shadow);
    usedOver = true;
  }
  if (s.stroke?.enabled) {
    const size = s.stroke.size * scale;
    const plane = new Float32Array(n);
    const pos = s.stroke.position;
    const dOut = pos !== 'inside' ? distOut() : null;
    const dIn = pos !== 'outside' ? distIn() : null;
    const outW = pos === 'outside' ? size : pos === 'center' ? size / 2 : 0;
    const inW = pos === 'inside' ? size : pos === 'center' ? size / 2 : 0;
    for (let i = 0; i < n; i++) {
      if (alpha[i] < 128) {
        if (dOut) plane[i] = clamp(outW + 0.5 - Math.sqrt(dOut[i]), 0, 1) * 255;
        if (alpha[i] > 0 && dOut) plane[i] = Math.max(plane[i], alpha[i]);
      } else if (dIn) plane[i] = clamp(inW + 0.5 - Math.sqrt(dIn[i]), 0, 1) * 255;
    }
    // the outside part goes under the layer edge, so anti aliased edges stay clean
    if (pos === 'outside') {
      paint(under, plane, s.stroke.color, s.stroke.opacity);
      usedUnder = true;
    } else {
      paint(over, plane, s.stroke.color, s.stroke.opacity);
      usedOver = true;
    }
  }
  return { under: usedUnder ? under : null, over: usedOver ? over : null };
}
