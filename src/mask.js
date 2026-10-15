// Single channel masks (one byte per pixel, 0 to 255) for selections, layer masks and cutouts:
// combining, inverting, feathering, growing and shrinking, bounds, outlines for the marching
// ants, and a color flood fill for the magic wand.

import { blurPlane } from './filters/adjust.js';

const INF = 1e20;

/** 1D squared distance transform (Felzenszwalb and Huttenlocher). */
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/**
 * Squared Euclidean distance from every pixel to the nearest "inside" pixel (where inside(i) is
 * true). Inside pixels get 0. Exact, linear time.
 */
export function distanceField(w, h, inside) {
  const grid = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) grid[i] = inside(i) ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) grid[y * w + x] = d[x];
  }
  return grid;
}

/** Grows a mask by r pixels with a soft, anti aliased edge. */
export function expandMask(mask, w, h, r, threshold = 128) {
  if (r <= 0) return new Uint8Array(mask);
  const dist = distanceField(w, h, (i) => mask[i] >= threshold);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) {
    const d = Math.sqrt(dist[i]);
    const edge = Math.max(0, Math.min(1, r + 0.5 - d));
    out[i] = Math.max(mask[i], Math.round(edge * 255));
  }
  return out;
}

/** Shrinks a mask by r pixels. */
export function contractMask(mask, w, h, r, threshold = 128) {
  if (r <= 0) return new Uint8Array(mask);
  const inv = invertMask(mask);
  return invertMask(expandMask(inv, w, h, r, 256 - threshold));
}

export const invertMask = (mask) => {
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = 255 - mask[i];
  return out;
};

/** Combines a new selection b with an existing one a: replace, add, subtract or intersect. */
export function combineMasks(a, b, mode = 'replace') {
  if (mode === 'replace' || !a) return new Uint8Array(b);
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) {
    if (mode === 'add') out[i] = Math.max(a[i], b[i]);
    else if (mode === 'subtract') out[i] = Math.max(0, a[i] - b[i]);
    else out[i] = Math.min(a[i], b[i]);
  }
  return out;
}

/** Gaussian feather of a mask edge. */
export function featherMask(mask, w, h, radius) {
  if (radius <= 0) return new Uint8Array(mask);
  const plane = Float32Array.from(mask);
  blurPlane(plane, w, h, radius / 2);
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(plane[i])));
  return out;
}

/** Bounding box of the pixels at or above threshold, or null for an empty mask. */
export function maskBounds(mask, w, h, threshold = 1) {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] >= threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export const isEmptyMask = (mask) => {
  for (let i = 0; i < mask.length; i++) if (mask[i]) return false;
  return true;
};

/**
 * Outlines of a mask as closed polygons in pixel coordinates (marching squares on the pixel
 * grid, merged into loops). Used to draw the marching ants around a selection.
 */
export function maskOutlines(mask, w, h, threshold = 128) {
  const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] >= threshold;
  // Directed boundary edges with the inside on the left; keyed by start vertex.
  const edges = new Map();
  const key = (x, y) => y * (w + 1) + x;
  const add = (x0, y0, x1, y1) => {
    const k = key(x0, y0);
    if (!edges.has(k)) edges.set(k, []);
    edges.get(k).push([x1, y1]);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!on(x, y)) continue;
      if (!on(x, y - 1)) add(x, y, x + 1, y);
      if (!on(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!on(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!on(x - 1, y)) add(x, y + 1, x, y);
    }
  }
  const loops = [];
  for (const [startKey, list] of edges) {
    while (list.length) {
      const sx = startKey % (w + 1);
      const sy = Math.floor(startKey / (w + 1));
      const loop = [[sx, sy]];
      let [cx, cy] = list.pop();
      let guard = 0;
      while ((cx !== sx || cy !== sy) && guard++ < 4 * w * h + 8) {
        const prev = loop[loop.length - 1];
        // Drop collinear points to keep the outlines short.
        const before = loop[loop.length - 2];
        if (before && ((before[0] === prev[0] && prev[0] === cx) || (before[1] === prev[1] && prev[1] === cy))) loop.pop();
        loop.push([cx, cy]);
        const next = edges.get(key(cx, cy));
        if (!next?.length) break;
        [cx, cy] = next.pop();
      }
      // The last point may sit on the line from its neighbor back to the start.
      const collinear = (a, b, c) => (a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1]);
      if (loop.length > 3 && collinear(loop[loop.length - 2], loop[loop.length - 1], loop[0])) loop.pop();
      if (loop.length > 3 && collinear(loop[loop.length - 1], loop[0], loop[1])) loop.shift();
      if (loop.length > 2) loops.push(loop);
    }
  }
  return loops;
}

/**
 * Magic wand: pixels connected to (x, y) whose color is within tolerance (0 to 255, the
 * largest channel difference) of the seed color. contiguous false selects every match.
 */
export function floodSelect(rgba, w, h, x, y, tolerance = 32, contiguous = true) {
  const out = new Uint8Array(w * h);
  const sx = Math.floor(x);
  const sy = Math.floor(y);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return out;
  const s = (sy * w + sx) * 4;
  const seed = [rgba[s], rgba[s + 1], rgba[s + 2], rgba[s + 3]];
  const match = (p) => {
    const i = p * 4;
    return (
      Math.max(Math.abs(rgba[i] - seed[0]), Math.abs(rgba[i + 1] - seed[1]), Math.abs(rgba[i + 2] - seed[2]), Math.abs(rgba[i + 3] - seed[3])) <= tolerance
    );
  };
  if (!contiguous) {
    for (let p = 0; p < w * h; p++) if (match(p)) out[p] = 255;
    return out;
  }
  const stack = [sy * w + sx];
  out[sy * w + sx] = 255;
  while (stack.length) {
    const p = stack.pop();
    const px = p % w;
    const py = (p - px) / w;
    const next = [px > 0 ? p - 1 : -1, px < w - 1 ? p + 1 : -1, py > 0 ? p - w : -1, py < h - 1 ? p + w : -1];
    for (const q of next) {
      if (q >= 0 && !out[q] && match(q)) {
        out[q] = 255;
        stack.push(q);
      }
    }
  }
  return out;
}

/** Keeps only the connected region of a mask that contains (x, y). */
export function connectedRegion(mask, w, h, x, y, threshold = 128) {
  const out = new Uint8Array(w * h);
  const sx = Math.floor(x);
  const sy = Math.floor(y);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h || mask[sy * w + sx] < threshold) return out;
  const stack = [sy * w + sx];
  out[stack[0]] = mask[stack[0]];
  while (stack.length) {
    const p = stack.pop();
    const px = p % w;
    for (const q of [px > 0 ? p - 1 : -1, px < w - 1 ? p + 1 : -1, p - w, p + w]) {
      if (q >= 0 && q < w * h && !out[q] && mask[q] >= threshold) {
        out[q] = mask[q];
        stack.push(q);
      }
    }
  }
  // Keep the soft edge pixels that touch the region.
  for (let p = 0; p < w * h; p++) {
    if (out[p] || !mask[p]) continue;
    const px = p % w;
    if ((px > 0 && out[p - 1]) || (px < w - 1 && out[p + 1]) || (p >= w && out[p - w]) || (p + w < w * h && out[p + w])) out[p] = mask[p];
  }
  return out;
}
