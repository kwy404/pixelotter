// Generated from src/filters/effects.js by scripts/build-app.mjs. Edit the source, not this copy.
// The classic filter groups, as pure functions (image, params) => image:
//   Blur:     gaussian, box, motion, radial (spin and zoom), surface, median
//   Sharpen:  unsharp mask, high pass
//   Noise:    add noise, reduce noise, dust and scratches
//   Stylize:  emboss, find edges, solarize, oil paint
//   Distort:  twirl, pinch, spherize, ripple, wave, polar coordinates, offset
//   Pixelate: mosaic, crystallize, color halftone
//   Render:   clouds, difference clouds, vignette
//   Other:    minimum, maximum
// Radius values are in pixels of the image they run on; the app scales them when it previews
// a smaller copy, so the preview matches the full size result.

import { blank, clamp255, copy, hexToRgb, lum, makeNoise, remap, rng, sample } from './core.js';
import { blurImage, sharpenImage } from './adjust.js';

export const gaussianBlur = (img, { radius = 4 } = {}) => blurImage(img, Math.max(0, radius) / 2);

export function boxBlur(img, { radius = 4 } = {}) {
  const r = Math.max(0, Math.round(radius));
  if (!r) return copy(img);
  const { width: w, height: h } = img;
  const tmp = new Float32Array(w * h * 4);
  const out = blank(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < 4; c++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += d[(y * w + Math.min(w - 1, Math.max(0, k))) * 4 + c];
      for (let x = 0; x < w; x++) {
        tmp[(y * w + x) * 4 + c] = acc / (2 * r + 1);
        acc += d[(y * w + Math.min(w - 1, x + r + 1)) * 4 + c] - d[(y * w + Math.max(0, x - r)) * 4 + c];
      }
    }
  }
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 4; c++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += tmp[(Math.min(h - 1, Math.max(0, k)) * w + x) * 4 + c];
      for (let y = 0; y < h; y++) {
        out.data[(y * w + x) * 4 + c] = clamp255(acc / (2 * r + 1));
        acc += tmp[(Math.min(h - 1, y + r + 1) * w + x) * 4 + c] - tmp[(Math.max(0, y - r) * w + x) * 4 + c];
      }
    }
  }
  return out;
}

/** Motion blur: averages samples along a line at an angle. */
export function motionBlur(img, { angle = 0, distance = 20 } = {}) {
  const n = Math.max(1, Math.round(distance));
  const a = (angle * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = -Math.sin(a);
  const out = blank(img.width, img.height);
  const px = [0, 0, 0, 0];
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let al = 0;
      for (let k = 0; k <= n; k++) {
        const t = k - n / 2;
        sample(img, x + dx * t, y + dy * t, px);
        const w = px[3] / 255;
        r += px[0] * w;
        g += px[1] * w;
        b += px[2] * w;
        al += px[3];
      }
      const i = (y * img.width + x) * 4;
      const aw = al / 255 || 1;
      out.data[i] = r / aw;
      out.data[i + 1] = g / aw;
      out.data[i + 2] = b / aw;
      out.data[i + 3] = al / (n + 1);
    }
  }
  return out;
}

/** Radial blur around a center: spin (rotation) or zoom (along the radius). */
export function radialBlur(img, { amount = 10, mode = 'spin', cx = 0.5, cy = 0.5, quality = 24 } = {}) {
  const ox = cx * img.width;
  const oy = cy * img.height;
  const steps = Math.max(4, Math.round(quality));
  const out = blank(img.width, img.height);
  const px = [0, 0, 0, 0];
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const vx = x - ox;
      const vy = y - oy;
      const acc = [0, 0, 0, 0];
      for (let k = 0; k < steps; k++) {
        const t = (k / (steps - 1) - 0.5) * (amount / 100);
        let sx;
        let sy;
        if (mode === 'zoom') {
          sx = ox + vx * (1 - t * 0.6);
          sy = oy + vy * (1 - t * 0.6);
        } else {
          const ang = t * 0.5;
          sx = ox + vx * Math.cos(ang) - vy * Math.sin(ang);
          sy = oy + vx * Math.sin(ang) + vy * Math.cos(ang);
        }
        sample(img, sx, sy, px);
        for (let c = 0; c < 4; c++) acc[c] += px[c];
      }
      const i = (y * img.width + x) * 4;
      for (let c = 0; c < 4; c++) out.data[i + c] = acc[c] / steps;
    }
  }
  return out;
}

/** Surface blur: smooths areas while keeping edges (a bilateral filter on a window). */
export function surfaceBlur(img, { radius = 5, threshold = 25 } = {}) {
  const r = Math.max(1, Math.round(radius));
  const t2 = 2 * Math.max(1, threshold) ** 2;
  const s2 = 2 * (r / 2) ** 2;
  const { width: w, height: h, data: d } = img;
  const out = copy(img);
  const step = r > 6 ? 2 : 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const c0 = [d[i], d[i + 1], d[i + 2]];
      const acc = [0, 0, 0];
      let wsum = 0;
      for (let ky = -r; ky <= r; ky += step) {
        const yy = Math.min(h - 1, Math.max(0, y + ky));
        for (let kx = -r; kx <= r; kx += step) {
          const xx = Math.min(w - 1, Math.max(0, x + kx));
          const j = (yy * w + xx) * 4;
          const dc = (d[j] - c0[0]) ** 2 + (d[j + 1] - c0[1]) ** 2 + (d[j + 2] - c0[2]) ** 2;
          const wt = Math.exp(-(kx * kx + ky * ky) / s2 - dc / (t2 * 3));
          acc[0] += d[j] * wt;
          acc[1] += d[j + 1] * wt;
          acc[2] += d[j + 2] * wt;
          wsum += wt;
        }
      }
      out.data[i] = acc[0] / wsum;
      out.data[i + 1] = acc[1] / wsum;
      out.data[i + 2] = acc[2] / wsum;
    }
  }
  return out;
}

/** Median of a square window per channel, with a histogram that slides along each row. */
export function median(img, { radius = 2, threshold = 0 } = {}) {
  const r = Math.max(1, Math.round(radius));
  const { width: w, height: h, data: d } = img;
  const out = copy(img);
  const half = ((2 * r + 1) ** 2) >> 1;
  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < h; y++) {
      const hist = new Uint16Array(256);
      for (let ky = -r; ky <= r; ky++) for (let kx = -r; kx <= r; kx++) hist[d[(Math.min(h - 1, Math.max(0, y + ky)) * w + Math.min(w - 1, Math.max(0, kx))) * 4 + c]]++;
      for (let x = 0; x < w; x++) {
        let acc = 0;
        let m = 0;
        while (m < 255 && acc + hist[m] <= half) acc += hist[m++];
        const i = (y * w + x) * 4 + c;
        if (Math.abs(d[i] - m) > threshold) out.data[i] = m;
        // slide the window one pixel right
        const xo = Math.max(0, x - r);
        const xn = Math.min(w - 1, x + r + 1);
        for (let ky = -r; ky <= r; ky++) {
          const yy = Math.min(h - 1, Math.max(0, y + ky));
          hist[d[(yy * w + xo) * 4 + c]]--;
          hist[d[(yy * w + xn) * 4 + c]]++;
        }
      }
    }
  }
  return out;
}

export const reduceNoise = (img, { radius = 1 } = {}) => median(img, { radius, threshold: 0 });
export const dustAndScratches = (img, { radius = 2, threshold = 20 } = {}) => median(img, { radius, threshold });

export function unsharpMask(img, { amount = 80, radius = 1.5, threshold = 0 } = {}) {
  const soft = blurImage(img, Math.max(0.3, radius) / 1.5);
  const k = amount / 100;
  const out = copy(img);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const diff = d[i + c] - soft.data[i + c];
      if (Math.abs(diff) >= threshold) out.data[i + c] = clamp255(d[i + c] + diff * k);
    }
  }
  return out;
}

export const sharpen = (img, { amount = 50 } = {}) => sharpenImage(img, amount / 100);

export function highPass(img, { radius = 6 } = {}) {
  const soft = blurImage(img, Math.max(0.3, radius) / 2);
  const out = copy(img);
  for (let i = 0; i < img.data.length; i += 4) for (let c = 0; c < 3; c++) out.data[i + c] = clamp255(img.data[i + c] - soft.data[i + c] + 128);
  return out;
}

export function addNoise(img, { amount = 12, distribution = 'gaussian', monochrome = true, seed = 7 } = {}) {
  const rand = rng(seed);
  const gauss = () => {
    const u = Math.max(1e-9, rand());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };
  const k = (amount / 100) * 255 * (distribution === 'gaussian' ? 0.5 : 1);
  const n = () => (distribution === 'gaussian' ? gauss() : rand() * 2 - 1) * k;
  const out = copy(img);
  for (let i = 0; i < out.data.length; i += 4) {
    const v = n();
    for (let c = 0; c < 3; c++) out.data[i + c] = clamp255(out.data[i + c] + (monochrome ? v : n()));
  }
  return out;
}

function convolve(img, kernel, { bias = 0, gray = false } = {}) {
  const { width: w, height: h, data: d } = img;
  const out = copy(img);
  const k = Math.sqrt(kernel.length);
  const r = (k - 1) / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const acc = [0, 0, 0];
      for (let ky = -r; ky <= r; ky++) {
        const yy = Math.min(h - 1, Math.max(0, y + ky));
        for (let kx = -r; kx <= r; kx++) {
          const xx = Math.min(w - 1, Math.max(0, x + kx));
          const wt = kernel[(ky + r) * k + kx + r];
          const j = (yy * w + xx) * 4;
          acc[0] += d[j] * wt;
          acc[1] += d[j + 1] * wt;
          acc[2] += d[j + 2] * wt;
        }
      }
      const i = (y * w + x) * 4;
      if (gray) {
        const v = clamp255(lum(acc[0], acc[1], acc[2]) + bias);
        out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
      } else for (let c = 0; c < 3; c++) out.data[i + c] = clamp255(acc[c] + bias);
    }
  }
  return out;
}

export function emboss(img, { angle = 135, height = 2, amount = 100 } = {}) {
  const a = (angle * Math.PI) / 180;
  const dx = Math.round(Math.cos(a));
  const dy = Math.round(-Math.sin(a));
  const s = (amount / 100) * height;
  const kernel = new Array(9).fill(0);
  kernel[(1 - dy) * 3 + 1 - dx] = -s;
  kernel[(1 + dy) * 3 + 1 + dx] = s;
  return convolve(img, kernel, { bias: 128, gray: true });
}

export function findEdges(img) {
  const { width: w, height: h, data: d } = img;
  const out = copy(img);
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = lum(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (xx, yy) => L[Math.min(h - 1, Math.max(0, yy)) * w + Math.min(w - 1, Math.max(0, xx))];
      const gx = p(x + 1, y - 1) + 2 * p(x + 1, y) + p(x + 1, y + 1) - p(x - 1, y - 1) - 2 * p(x - 1, y) - p(x - 1, y + 1);
      const gy = p(x - 1, y + 1) + 2 * p(x, y + 1) + p(x + 1, y + 1) - p(x - 1, y - 1) - 2 * p(x, y - 1) - p(x + 1, y - 1);
      const v = clamp255(255 - Math.hypot(gx, gy));
      const i = (y * w + x) * 4;
      out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
    }
  }
  return out;
}

export function solarize(img, { threshold: t = 128 } = {}) {
  const out = copy(img);
  for (let i = 0; i < out.data.length; i += 4) for (let c = 0; c < 3; c++) if (out.data[i + c] > t) out.data[i + c] = 255 - out.data[i + c];
  return out;
}

/** Oil paint: the Kuwahara filter (each pixel takes the mean of its calmest quadrant). */
export function oilPaint(img, { radius = 4 } = {}) {
  const r = Math.max(1, Math.round(radius));
  const { width: w, height: h, data: d } = img;
  const out = copy(img);
  // summed area tables for value and squared value per channel
  const S = [0, 1, 2].map(() => new Float64Array((w + 1) * (h + 1)));
  const Q = [0, 1, 2].map(() => new Float64Array((w + 1) * (h + 1)));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        const v = d[(y * w + x) * 4 + c];
        const o = (y + 1) * (w + 1) + x + 1;
        S[c][o] = v + S[c][o - 1] + S[c][o - w - 1] - S[c][o - w - 2];
        Q[c][o] = v * v + Q[c][o - 1] + Q[c][o - w - 1] - Q[c][o - w - 2];
      }
    }
  }
  const box = (T, x0, y0, x1, y1) => T[(y1 + 1) * (w + 1) + x1 + 1] - T[y0 * (w + 1) + x1 + 1] - T[(y1 + 1) * (w + 1) + x0] + T[y0 * (w + 1) + x0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let best = Infinity;
      let mean = [0, 0, 0];
      for (const [qx, qy] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        const x0 = Math.max(0, Math.min(x, x + qx * r));
        const x1 = Math.min(w - 1, Math.max(x, x + qx * r));
        const y0 = Math.max(0, Math.min(y, y + qy * r));
        const y1 = Math.min(h - 1, Math.max(y, y + qy * r));
        const n = (x1 - x0 + 1) * (y1 - y0 + 1);
        let v = 0;
        const m = [0, 1, 2].map((c) => {
          const mu = box(S[c], x0, y0, x1, y1) / n;
          v += box(Q[c], x0, y0, x1, y1) / n - mu * mu;
          return mu;
        });
        if (v < best) {
          best = v;
          mean = m;
        }
      }
      const i = (y * w + x) * 4;
      out.data[i] = mean[0];
      out.data[i + 1] = mean[1];
      out.data[i + 2] = mean[2];
    }
  }
  return out;
}

export function twirl(img, { angle = 90, radius = 1 } = {}) {
  const cx = img.width / 2;
  const cy = img.height / 2;
  const R = (Math.min(img.width, img.height) / 2) * radius;
  const a = (angle * Math.PI) / 180;
  return remap(img, (x, y, p) => {
    const dx = x - cx;
    const dy = y - cy;
    const d = Math.hypot(dx, dy);
    if (d >= R) {
      p.x = x;
      p.y = y;
      return;
    }
    const t = a * (1 - d / R) ** 2;
    p.x = cx + dx * Math.cos(t) - dy * Math.sin(t);
    p.y = cy + dx * Math.sin(t) + dy * Math.cos(t);
  });
}

export function pinch(img, { amount = 50 } = {}) {
  const cx = img.width / 2;
  const cy = img.height / 2;
  const R = Math.min(img.width, img.height) / 2;
  const k = amount / 100; // positive pinches in, negative bulges out
  return remap(img, (x, y, p) => {
    const dx = x - cx;
    const dy = y - cy;
    const d = Math.hypot(dx, dy) / R;
    const s = d > 0 && d < 1 ? Math.pow(Math.sin((Math.PI / 2) * d), -k) : 1;
    p.x = cx + dx * s;
    p.y = cy + dy * s;
  });
}

export function spherize(img, { amount = 60 } = {}) {
  const cx = img.width / 2;
  const cy = img.height / 2;
  const R = Math.min(img.width, img.height) / 2;
  const k = amount / 100;
  return remap(img, (x, y, p) => {
    const dx = (x - cx) / R;
    const dy = (y - cy) / R;
    const d = Math.hypot(dx, dy);
    if (d >= 1 || d === 0) {
      p.x = x;
      p.y = y;
      return;
    }
    const z = Math.asin(d) / (Math.PI / 2);
    const nd = d * (1 - k) + z * k;
    p.x = cx + (dx / d) * nd * R;
    p.y = cy + (dy / d) * nd * R;
  });
}

export function ripple(img, { amount = 8, size = 24 } = {}) {
  return remap(img, (x, y, p) => {
    p.x = x + Math.sin((y / size) * Math.PI * 2) * amount;
    p.y = y + Math.sin((x / size) * Math.PI * 2) * amount * 0.3;
  });
}

export function wave(img, { amplitudeX = 10, amplitudeY = 0, wavelength = 60 } = {}) {
  return remap(img, (x, y, p) => {
    p.x = x + Math.sin((y / wavelength) * Math.PI * 2) * amplitudeX;
    p.y = y + Math.sin((x / wavelength) * Math.PI * 2) * amplitudeY;
  });
}

export function polarCoordinates(img, { mode = 'rect-to-polar' } = {}) {
  const w = img.width;
  const h = img.height;
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) / 2;
  return remap(img, (x, y, p) => {
    if (mode === 'rect-to-polar') {
      const dx = (x - cx) / (w / 2);
      const dy = (y - cy) / (h / 2);
      const ang = Math.atan2(dx, -dy);
      p.x = ((ang / (2 * Math.PI) + 1) % 1) * w;
      p.y = Math.min(1, Math.hypot(dx, dy)) * h;
    } else {
      const ang = (x / w) * 2 * Math.PI;
      const r = (y / h) * R;
      p.x = cx + Math.sin(ang) * r;
      p.y = cy - Math.cos(ang) * r;
    }
  });
}

export function offset(img, { dx = 50, dy = 50 } = {}) {
  return remap(img, (x, y, p) => {
    p.x = x - dx;
    p.y = y - dy;
  }, { wrap: true });
}

export function mosaic(img, { size = 12 } = {}) {
  const s = Math.max(2, Math.round(size));
  const out = copy(img);
  const { width: w, height: h, data: d } = img;
  for (let by = 0; by < h; by += s) {
    for (let bx = 0; bx < w; bx += s) {
      const acc = [0, 0, 0, 0];
      let n = 0;
      for (let y = by; y < Math.min(h, by + s); y++) for (let x = bx; x < Math.min(w, bx + s); x++) {
          const i = (y * w + x) * 4;
          for (let c = 0; c < 4; c++) acc[c] += d[i + c];
          n++;
        }
      for (let y = by; y < Math.min(h, by + s); y++) for (let x = bx; x < Math.min(w, bx + s); x++) {
          const i = (y * w + x) * 4;
          for (let c = 0; c < 4; c++) out.data[i + c] = acc[c] / n;
        }
    }
  }
  return out;
}

/** Crystallize: each pixel takes the color of its nearest random seed (Voronoi cells). */
export function crystallize(img, { size = 16, seed = 3 } = {}) {
  const s = Math.max(3, Math.round(size));
  const rand = rng(seed);
  const { width: w, height: h, data: d } = img;
  const gw = Math.ceil(w / s);
  const gh = Math.ceil(h / s);
  const seeds = [];
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) seeds.push([(gx + rand()) * s, (gy + rand()) * s]);
  const color = seeds.map(([x, y]) => {
    const i = (Math.min(h - 1, Math.floor(y)) * w + Math.min(w - 1, Math.floor(x))) * 4;
    return [d[i], d[i + 1], d[i + 2], d[i + 3]];
  });
  const out = copy(img);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = Math.floor(x / s);
      const gy = Math.floor(y / s);
      let best = 0;
      let bd = Infinity;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const cx = gx + ox;
          const cy = gy + oy;
          if (cx < 0 || cy < 0 || cx >= gw || cy >= gh) continue;
          const k = cy * gw + cx;
          const dd = (seeds[k][0] - x) ** 2 + (seeds[k][1] - y) ** 2;
          if (dd < bd) {
            bd = dd;
            best = k;
          }
        }
      out.data.set(color[best], (y * w + x) * 4);
    }
  }
  return out;
}

/** Color halftone: a dot screen per channel at the classic screen angles. */
export function colorHalftone(img, { size = 8 } = {}) {
  const s = Math.max(3, size);
  const angles = [15, 75, 0].map((a) => (a * Math.PI) / 180);
  const { width: w, height: h, data: d } = img;
  const out = copy(img);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const a = angles[c];
        const u = x * Math.cos(a) + y * Math.sin(a);
        const v = -x * Math.sin(a) + y * Math.cos(a);
        const cu = (Math.floor(u / s) + 0.5) * s;
        const cv = (Math.floor(v / s) + 0.5) * s;
        // the cell center back in image space, to read the ink amount there
        const sx = Math.min(w - 1, Math.max(0, Math.round(cu * Math.cos(a) - cv * Math.sin(a))));
        const sy = Math.min(h - 1, Math.max(0, Math.round(cu * Math.sin(a) + cv * Math.cos(a))));
        const ink = 1 - d[(sy * w + sx) * 4 + c] / 255;
        const r = Math.sqrt(ink) * s * 0.72;
        out.data[i + c] = Math.hypot(u - cu, v - cv) <= r ? 0 : 255;
      }
    }
  }
  return out;
}

export function clouds(img, { scale = 140, foreground = '#1c1714', background = '#e8dcc8', seed = 5, difference = false } = {}) {
  const n = makeNoise(seed);
  const fg = hexToRgb(foreground);
  const bg = hexToRgb(background);
  const out = copy(img);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const t = n(x / scale, y / scale, 6);
      const i = (y * img.width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v = fg[c] * (1 - t) + bg[c] * t;
        out.data[i + c] = difference ? Math.abs(out.data[i + c] - v) : v;
      }
      if (!difference) out.data[i + 3] = 255;
    }
  }
  return out;
}

export function vignette(img, { amount = 50, roundness = 1, color = '#000000' } = {}) {
  const k = amount / 100;
  const c = hexToRgb(color);
  const out = copy(img);
  const cx = img.width / 2;
  const cy = img.height / 2;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const dx = (x - cx) / cx;
      const dy = ((y - cy) / cy) * roundness;
      const t = Math.max(0, Math.min(1, (Math.hypot(dx, dy) - 0.45) / 0.9));
      const f = k * t * t;
      const i = (y * img.width + x) * 4;
      for (let ch = 0; ch < 3; ch++) out.data[i + ch] = out.data[i + ch] * (1 - f) + c[ch] * f;
    }
  }
  return out;
}

function morph(img, radius, pick) {
  const r = Math.max(1, Math.round(radius));
  const { width: w, height: h, data: d } = img;
  const tmp = copy(img);
  const out = copy(img);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
        let v = d[(y * w + x) * 4 + c];
        for (let k = -r; k <= r; k++) v = pick(v, d[(y * w + Math.min(w - 1, Math.max(0, x + k))) * 4 + c]);
        tmp.data[(y * w + x) * 4 + c] = v;
      }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
        let v = tmp.data[(y * w + x) * 4 + c];
        for (let k = -r; k <= r; k++) v = pick(v, tmp.data[(Math.min(h - 1, Math.max(0, y + k)) * w + x) * 4 + c]);
        out.data[(y * w + x) * 4 + c] = v;
      }
  return out;
}

export const minimum = (img, { radius = 1 } = {}) => morph(img, radius, Math.min);
export const maximum = (img, { radius = 1 } = {}) => morph(img, radius, Math.max);
