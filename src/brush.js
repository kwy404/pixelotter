// The painting engine shared by the brush, pencil, eraser, mask painting, dodge, burn, sponge,
// blur, sharpen, smudge, clone stamp and healing tools. It works on an RGBA working buffer that
// covers the area being painted, so the same code runs in the editor and in the tests.
//   Coverage tools (paint, erase, mask) build up a coverage plane: each dab adds flow, the
//   stroke never exceeds its opacity, and pixels are recomputed from the originals.
//   Retouch tools (dodge, burn, sponge, blur, sharpen, smudge, clone) change pixels dab by dab.

import { luma } from './filters/adjust.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * A round brush tip: a square of size x size coverage values (0..1). hardness 0..1 sets how
 * far the solid core reaches; roundness and angle squash and turn the tip.
 */
export function brushTip(diameter, hardness = 0.8, { roundness = 1, angle = 0 } = {}) {
  const size = Math.max(1, Math.ceil(diameter));
  const r = diameter / 2;
  const data = new Float32Array(size * size);
  const c = (size - 1) / 2;
  const cos = Math.cos((angle * Math.PI) / 180);
  const sin = Math.sin((angle * Math.PI) / 180);
  const core = clamp(hardness, 0, 1);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - c;
      const dy = y - c;
      const u = dx * cos + dy * sin;
      const v = (-dx * sin + dy * cos) / Math.max(0.05, roundness);
      const d = Math.hypot(u, v) / Math.max(0.5, r);
      let a;
      if (d >= 1) a = d < 1 + 1 / Math.max(1, r) ? (1 + 1 / Math.max(1, r) - d) * Math.max(1, r) : 0; // one pixel of anti aliasing
      else if (d <= core) a = 1;
      else {
        const t = (d - core) / (1 - core);
        a = 0.5 + 0.5 * Math.cos(Math.PI * t);
      }
      data[y * size + x] = clamp(a, 0, 1);
    }
  }
  if (diameter < 1.5) data.fill(1); // a one pixel pencil
  return { size, radius: r, data };
}

/**
 * Dab centers along a segment, every `spacing` pixels, continuing the leftover distance from
 * the previous segment. Returns { points: [[x, y, t]], carry }.
 */
export function dabPositions(x0, y0, x1, y1, spacing, carry = 0) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const step = Math.max(0.5, spacing);
  const points = [];
  let d = step - carry;
  if (carry === 0 && len === 0) return { points: [[x0, y0, 0]], carry: 0 };
  if (carry === 0) {
    points.push([x0, y0, 0]);
    d = step;
  }
  while (d <= len) {
    const t = d / len;
    points.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, t]);
    d += step;
  }
  return { points, carry: len - (d - step) };
}

/**
 * A painting session over a working region of an RGBA image.
 *   region: { x, y, w, h } in layer pixels, original: the RGBA pixels of that region before the
 *   stroke (kept untouched), buf: the RGBA buffer that receives the result.
 */
export class Stroke {
  constructor({ region, original, mode = 'paint', color = [0, 0, 0], opacity = 1, flow = 1, tip, selection = null, lockAlpha = false, options = {} }) {
    this.region = region;
    this.original = original;
    this.buf = new Uint8ClampedArray(original);
    this.cover = ['paint', 'erase', 'mask-reveal', 'mask-hide'].includes(mode) ? new Float32Array(region.w * region.h) : null;
    this.mode = mode;
    this.color = color;
    this.opacity = clamp(opacity, 0, 1);
    this.flow = clamp(flow, 0, 1);
    this.tip = tip;
    this.selection = selection; // optional one byte per pixel of the region (0..255)
    this.lockAlpha = lockAlpha;
    this.options = options;
    this.dirty = null;
    this.smudgeColor = null;
  }

  markDirty(x0, y0, x1, y1) {
    const r = { x0: Math.max(0, x0), y0: Math.max(0, y0), x1: Math.min(this.region.w, x1), y1: Math.min(this.region.h, y1) };
    if (r.x1 <= r.x0 || r.y1 <= r.y0) return null;
    this.dirty = this.dirty ? { x0: Math.min(this.dirty.x0, r.x0), y0: Math.min(this.dirty.y0, r.y0), x1: Math.max(this.dirty.x1, r.x1), y1: Math.max(this.dirty.y1, r.y1) } : { ...r };
    return r;
  }

  /** One dab at (cx, cy) in layer pixels, with an optional pressure (0..1). */
  dab(cx, cy, pressure = 1) {
    const tip = this.tip;
    const lx = cx - this.region.x - tip.size / 2;
    const ly = cy - this.region.y - tip.size / 2;
    const ix = Math.round(lx);
    const iy = Math.round(ly);
    const r = this.markDirty(ix, iy, ix + tip.size, iy + tip.size);
    if (!r) return null;
    const { w } = this.region;
    const strength = this.flow * pressure;
    const sel = this.selection;
    const buf = this.buf;
    const mode = this.mode;
    // smudge picks up the color under the tip first
    if (mode === 'smudge' && !this.smudgeColor) this.smudgeColor = this.average(ix, iy, tip);
    let smudgeNext = null;
    if (mode === 'smudge') smudgeNext = this.average(ix, iy, tip);
    for (let y = r.y0; y < r.y1; y++) {
      for (let x = r.x0; x < r.x1; x++) {
        let a = tip.data[(y - iy) * tip.size + (x - ix)];
        if (!a) continue;
        const p = y * w + x;
        if (sel) a *= sel[p] / 255;
        if (!a) continue;
        if (this.cover) {
          this.cover[p] += (1 - this.cover[p]) * a * strength;
          continue;
        }
        const i = p * 4;
        const k = a * strength * this.opacity;
        switch (mode) {
          case 'dodge':
          case 'burn': {
            const range = this.options.range ?? 'midtones';
            const l = luma(buf[i], buf[i + 1], buf[i + 2]) / 255;
            const wgt = range === 'shadows' ? (1 - l) ** 2 : range === 'highlights' ? l * l : 1 - Math.abs(l - 0.5) * 2;
            const e = (this.options.exposure ?? 0.5) * k * Math.max(0.15, wgt) * 0.5;
            for (let c = 0; c < 3; c++) buf[i + c] = clamp255(mode === 'dodge' ? buf[i + c] + (255 - buf[i + c]) * e : buf[i + c] * (1 - e));
            break;
          }
          case 'sponge': {
            const l = luma(buf[i], buf[i + 1], buf[i + 2]);
            const f = this.options.saturate === false ? 1 - k * 0.3 : 1 + k * 0.3;
            for (let c = 0; c < 3; c++) buf[i + c] = clamp255(l + (buf[i + c] - l) * f);
            break;
          }
          case 'blur':
          case 'sharpen': {
            const avg = [0, 0, 0];
            let n = 0;
            for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
                const xx = Math.min(this.region.w - 1, Math.max(0, x + ox));
                const yy = Math.min(this.region.h - 1, Math.max(0, y + oy));
                const j = (yy * w + xx) * 4;
                avg[0] += buf[j];
                avg[1] += buf[j + 1];
                avg[2] += buf[j + 2];
                n++;
              }
            for (let c = 0; c < 3; c++) {
              const m = avg[c] / n;
              buf[i + c] = clamp255(mode === 'blur' ? buf[i + c] + (m - buf[i + c]) * k : buf[i + c] + (buf[i + c] - m) * k * 0.8);
            }
            break;
          }
          case 'smudge': {
            const s = this.smudgeColor;
            for (let c = 0; c < 4; c++) buf[i + c] = clamp255(buf[i + c] + (s[c] - buf[i + c]) * k * 0.9);
            break;
          }
          case 'clone': {
            const src = this.options.source; // { data, width, height, dx, dy }: source pixels and offset
            if (!src) break;
            const sx = Math.round(x + this.region.x + src.dx);
            const sy = Math.round(y + this.region.y + src.dy);
            if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) break;
            const j = (sy * src.width + sx) * 4;
            for (let c = 0; c < 4; c++) buf[i + c] = clamp255(buf[i + c] + (src.data[j + c] - buf[i + c]) * k);
            break;
          }
          default:
        }
      }
    }
    if (mode === 'smudge' && smudgeNext) {
      const keep = this.options.strength ?? 0.6;
      this.smudgeColor = this.smudgeColor.map((v, c) => v * keep + smudgeNext[c] * (1 - keep));
    }
    if (this.cover) this.resolve(r);
    return r;
  }

  average(ix, iy, tip) {
    const acc = [0, 0, 0, 0];
    let n = 0;
    const { w, h } = this.region;
    for (let y = Math.max(0, iy); y < Math.min(h, iy + tip.size); y++) {
      for (let x = Math.max(0, ix); x < Math.min(w, ix + tip.size); x++) {
        const a = tip.data[(y - iy) * tip.size + (x - ix)];
        if (a < 0.5) continue;
        const i = (y * w + x) * 4;
        for (let c = 0; c < 4; c++) acc[c] += this.buf[i + c];
        n++;
      }
    }
    return n ? acc.map((v) => v / n) : [0, 0, 0, 0];
  }

  /** Recomputes pixels in a rectangle from the originals and the coverage plane. */
  resolve(r) {
    const { w } = this.region;
    const o = this.original;
    const buf = this.buf;
    const [cr, cg, cb] = this.color;
    for (let y = r.y0; y < r.y1; y++) {
      for (let x = r.x0; x < r.x1; x++) {
        const p = y * w + x;
        const c = this.cover[p] * this.opacity;
        const i = p * 4;
        if (!c) {
          buf[i] = o[i];
          buf[i + 1] = o[i + 1];
          buf[i + 2] = o[i + 2];
          buf[i + 3] = o[i + 3];
          continue;
        }
        if (this.mode === 'erase') {
          buf[i] = o[i];
          buf[i + 1] = o[i + 1];
          buf[i + 2] = o[i + 2];
          buf[i + 3] = o[i + 3] * (1 - c);
        } else if (this.mode === 'mask-reveal' || this.mode === 'mask-hide') {
          // masks keep their value in alpha, white color
          const target = this.mode === 'mask-reveal' ? 255 : 0;
          buf[i] = buf[i + 1] = buf[i + 2] = 255;
          buf[i + 3] = o[i + 3] + (target - o[i + 3]) * c;
        } else {
          const ab = o[i + 3] / 255;
          if (this.lockAlpha) {
            buf[i] = o[i] + (cr - o[i]) * c;
            buf[i + 1] = o[i + 1] + (cg - o[i + 1]) * c;
            buf[i + 2] = o[i + 2] + (cb - o[i + 2]) * c;
            buf[i + 3] = o[i + 3];
            continue;
          }
          const ao = c + ab * (1 - c);
          buf[i] = ao ? (cr * c + o[i] * ab * (1 - c)) / ao : 0;
          buf[i + 1] = ao ? (cg * c + o[i + 1] * ab * (1 - c)) / ao : 0;
          buf[i + 2] = ao ? (cb * c + o[i + 2] * ab * (1 - c)) / ao : 0;
          buf[i + 3] = ao * 255;
        }
      }
    }
  }

  /** The changed rectangle and its pixels, for a patch operation. */
  result() {
    if (!this.dirty) return null;
    const { x0, y0, x1, y1 } = this.dirty;
    const w = x1 - x0;
    const h = y1 - y0;
    const before = new Uint8ClampedArray(w * h * 4);
    const after = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      const from = ((y0 + y) * this.region.w + x0) * 4;
      before.set(this.original.subarray(from, from + w * 4), y * w * 4);
      after.set(this.buf.subarray(from, from + w * 4), y * w * 4);
    }
    return { rect: { x: this.region.x + x0, y: this.region.y + y0, w, h }, before, after };
  }
}

/** Linear or radial gradient into an RGBA buffer, blended over it with an opacity. */
export function fillGradient(buf, w, h, { type = 'linear', x0, y0, x1, y1, stops, opacity = 1, selection = null, reverse = false }) {
  const s = [...stops].sort((a, b) => a.at - b.at);
  const len2 = (x1 - x0) ** 2 + (y1 - y0) ** 2 || 1;
  const radius = Math.sqrt(len2);
  const colorAt = (t) => {
    t = clamp(reverse ? 1 - t : t, 0, 1);
    let k = 0;
    while (k < s.length - 1 && s[k + 1].at < t) k++;
    const a = s[k];
    const b = s[Math.min(k + 1, s.length - 1)];
    const f = b.at > a.at ? clamp((t - a.at) / (b.at - a.at), 0, 1) : 0;
    return [0, 1, 2, 3].map((c) => a.c[c] + (b.c[c] - a.c[c]) * f);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = type === 'radial' ? Math.hypot(x + 0.5 - x0, y + 0.5 - y0) / radius : ((x + 0.5 - x0) * (x1 - x0) + (y + 0.5 - y0) * (y1 - y0)) / len2;
      const c = colorAt(t);
      const p = y * w + x;
      let a = (c[3] / 255) * opacity;
      if (selection) a *= selection[p] / 255;
      if (!a) continue;
      const i = p * 4;
      const ab = buf[i + 3] / 255;
      const ao = a + ab * (1 - a);
      for (let k = 0; k < 3; k++) buf[i + k] = (c[k] * a + buf[i + k] * ab * (1 - a)) / ao;
      buf[i + 3] = ao * 255;
    }
  }
  return buf;
}
