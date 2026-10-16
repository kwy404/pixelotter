// Generated from src/filters/heal.js by scripts/build-app.mjs. Edit the source, not this copy.
// Healing tools on RGBA pixels.
//   inpaint: fills the masked pixels from their surroundings (a membrane: each hole pixel ends
//            up as the average of its neighbors, solved with Gauss Seidel sweeps). Used by the
//            spot healing brush on small blemishes.
//   seamlessPatch: copies a source area into the masked area and then blends the seam by
//            adding a membrane of the color difference along the border, so the patch takes on
//            the lighting of its new place (a fast stand in for Poisson cloning).
// Both work on a cropped region, so the cost follows the size of the hole, not of the photo.

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

function solveMembrane(values, hole, w, h, iterations) {
  // values: Float32Array per channel planes [3][w*h], hole: Uint8Array (1 = unknown)
  const idx = [];
  for (let i = 0; i < w * h; i++) if (hole[i]) idx.push(i);
  if (!idx.length) return;
  // Start from the mean of the known border so convergence is quick.
  for (const plane of values) {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < w * h; i++) {
      if (hole[i]) continue;
      const x = i % w;
      if ((x > 0 && hole[i - 1]) || (x < w - 1 && hole[i + 1]) || (i >= w && hole[i - w]) || (i + w < w * h && hole[i + w])) {
        sum += plane[i];
        n++;
      }
    }
    const mean = n ? sum / n : 0;
    for (const i of idx) plane[i] = mean;
  }
  for (let it = 0; it < iterations; it++) {
    for (const plane of values) {
      for (const i of idx) {
        const x = i % w;
        let s = 0;
        let n = 0;
        if (x > 0) (s += plane[i - 1]), n++;
        if (x < w - 1) (s += plane[i + 1]), n++;
        if (i >= w) (s += plane[i - w]), n++;
        if (i + w < w * h) (s += plane[i + w]), n++;
        plane[i] = s / n;
      }
    }
  }
}

/** Fills pixels where mask >= 128 from the surrounding pixels. Returns a new RGBA array. */
export function inpaint(rgba, w, h, mask, iterations = 0) {
  const n = w * h;
  const hole = new Uint8Array(n);
  let count = 0;
  for (let i = 0; i < n; i++) if (mask[i] >= 128) (hole[i] = 1), count++;
  const iters = iterations || Math.min(600, Math.max(40, Math.round(Math.sqrt(count) * 6)));
  const planes = [0, 1, 2, 3].map((c) => {
    const p = new Float32Array(n);
    for (let i = 0; i < n; i++) p[i] = rgba[i * 4 + c];
    return p;
  });
  solveMembrane(planes, hole, w, h, iters);
  const out = new Uint8ClampedArray(rgba);
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    const a = mask[i] / 255;
    for (let c = 0; c < 4; c++) out[i * 4 + c] = clamp255(rgba[i * 4 + c] * (1 - a) + planes[c][i] * a);
  }
  return out;
}

/**
 * Patches target with source (same size RGBA arrays) where mask is set. The difference between
 * target and source along the mask border is spread smoothly over the inside, then added to
 * the source, so the seam disappears.
 */
export function seamlessPatch(target, source, w, h, mask, iterations = 0) {
  const n = w * h;
  const hole = new Uint8Array(n);
  let count = 0;
  for (let i = 0; i < n; i++) if (mask[i] >= 16) (hole[i] = 1), count++;
  const iters = iterations || Math.min(800, Math.max(60, Math.round(Math.sqrt(count) * 8)));
  const diff = [0, 1, 2].map((c) => {
    const p = new Float32Array(n);
    for (let i = 0; i < n; i++) p[i] = target[i * 4 + c] - source[i * 4 + c];
    return p;
  });
  solveMembrane(diff, hole, w, h, iters);
  const out = new Uint8ClampedArray(target);
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    const a = mask[i] / 255;
    for (let c = 0; c < 3; c++) {
      const patched = source[i * 4 + c] + diff[c][i];
      out[i * 4 + c] = clamp255(target[i * 4 + c] * (1 - a) + patched * a);
    }
  }
  return out;
}
