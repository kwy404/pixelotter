// Liquify: a displacement field (where each pixel takes its color from) edited with brushes,
// then applied with bilinear sampling. Tools: push (forward warp), twirl (clockwise or not),
// pucker, bloat, smooth and reconstruct. The field can be coarser than the image; it is
// sampled bilinearly, so strokes stay smooth on big photos.

import { blank, sample } from './core.js';

export function createField(width, height, scale = 1) {
  const fw = Math.max(2, Math.ceil(width / scale) + 1);
  const fh = Math.max(2, Math.ceil(height / scale) + 1);
  return { width, height, scale, fw, fh, dx: new Float32Array(fw * fh), dy: new Float32Array(fw * fh) };
}

export const isIdentity = (field) => field.dx.every((v) => v === 0) && field.dy.every((v) => v === 0);

/** The displacement at an image position (bilinear in the field). */
export function displacement(field, x, y) {
  const gx = Math.min(field.fw - 1.001, Math.max(0, x / field.scale));
  const gy = Math.min(field.fh - 1.001, Math.max(0, y / field.scale));
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const tx = gx - x0;
  const ty = gy - y0;
  const i = y0 * field.fw + x0;
  const lerp = (a) => (a[i] * (1 - tx) + a[i + 1] * tx) * (1 - ty) + (a[i + field.fw] * (1 - tx) + a[i + field.fw + 1] * tx) * ty;
  return [lerp(field.dx), lerp(field.dy)];
}

/**
 * One brush dab at (x, y) with a radius and a pressure (0..1).
 * tool: 'push' (needs the stroke direction mx, my), 'twirl', 'twirl-ccw', 'pucker', 'bloat',
 * 'smooth' or 'reconstruct'.
 */
export function dab(field, tool, x, y, { radius = 60, pressure = 0.5, mx = 0, my = 0 } = {}) {
  const s = field.scale;
  const r = radius / s;
  const cx = x / s;
  const cy = y / s;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(field.fw - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(field.fh - 1, Math.ceil(cy + r));
  const ndx = tool === 'smooth' ? field.dx.slice() : null;
  const ndy = tool === 'smooth' ? field.dy.slice() : null;
  for (let gy = y0; gy <= y1; gy++) {
    for (let gx = x0; gx <= x1; gx++) {
      const ox = gx - cx;
      const oy = gy - cy;
      const d = Math.hypot(ox, oy) / r;
      if (d >= 1) continue;
      const f = (1 - d * d) ** 2 * pressure; // smooth falloff
      const i = gy * field.fw + gx;
      const px = gx * s;
      const py = gy * s;
      switch (tool) {
        case 'push':
          // content moves with the stroke: sample from behind
          field.dx[i] -= mx * f;
          field.dy[i] -= my * f;
          break;
        case 'twirl':
        case 'twirl-ccw': {
          const a = (tool === 'twirl' ? 1 : -1) * f * 0.25;
          const vx = px + field.dx[i] - x;
          const vy = py + field.dy[i] - y;
          field.dx[i] += vx * Math.cos(a) - vy * Math.sin(a) - vx;
          field.dy[i] += vx * Math.sin(a) + vy * Math.cos(a) - vy;
          break;
        }
        case 'pucker':
        case 'bloat': {
          const k = (tool === 'pucker' ? 1 : -1) * f * 0.12;
          field.dx[i] += (px - x) * k;
          field.dy[i] += (py - y) * k;
          break;
        }
        case 'reconstruct':
          field.dx[i] *= 1 - f;
          field.dy[i] *= 1 - f;
          break;
        case 'smooth': {
          let sx = 0;
          let sy = 0;
          let n = 0;
          for (let k = -1; k <= 1; k++) for (let l = -1; l <= 1; l++) {
              const xx = Math.min(field.fw - 1, Math.max(0, gx + l));
              const yy = Math.min(field.fh - 1, Math.max(0, gy + k));
              sx += field.dx[yy * field.fw + xx];
              sy += field.dy[yy * field.fw + xx];
              n++;
            }
          ndx[i] = field.dx[i] + (sx / n - field.dx[i]) * f;
          ndy[i] = field.dy[i] + (sy / n - field.dy[i]) * f;
          break;
        }
        default:
      }
    }
  }
  if (ndx) {
    field.dx.set(ndx);
    field.dy.set(ndy);
  }
  return field;
}

/** Draws the image through the field. */
export function applyField(img, field) {
  const out = blank(img.width, img.height);
  const px = [0, 0, 0, 0];
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const [dx, dy] = displacement(field, x, y);
      sample(img, x + dx, y + dy, px);
      const i = (y * img.width + x) * 4;
      out.data[i] = px[0];
      out.data[i + 1] = px[1];
      out.data[i + 2] = px[2];
      out.data[i + 3] = px[3];
    }
  }
  return out;
}
