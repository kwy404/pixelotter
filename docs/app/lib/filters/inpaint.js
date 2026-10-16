// Generated from src/filters/inpaint.js by scripts/build-app.mjs. Edit the source, not this copy.
// Content aware fill: fills a masked area with patches copied from the rest of the image,
// with the PatchMatch nearest neighbor search (random search and propagation) and patch voting,
// coarse to fine over an image pyramid (after Barnes et al. 2009 and Wexler et al. 2007).
// For speed the search runs on a copy no larger than WORK pixels across; the final pass copies
// full resolution pixels with the matches it found, so detail stays sharp.
// Also used by the spot healing brush and the patch tool's content aware mode.

import { rng } from './core.js';

const WORK = 360;

function downsample(src, w, h, ch) {
  const W = Math.max(1, w >> 1);
  const H = Math.max(1, h >> 1);
  const out = new Float32Array(W * H * ch);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (let c = 0; c < ch; c++) {
        let s = 0;
        let n = 0;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
            const xx = Math.min(w - 1, x * 2 + dx);
            const yy = Math.min(h - 1, y * 2 + dy);
            s += src[(yy * w + xx) * ch + c];
            n++;
          }
        out[(y * W + x) * ch + c] = s / n;
      }
    }
  }
  return { data: out, w: W, h: H };
}

function shrinkMask(mask, w, h) {
  const W = Math.max(1, w >> 1);
  const H = Math.max(1, h >> 1);
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let any = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) any |= mask[Math.min(h - 1, y * 2 + dy) * w + Math.min(w - 1, x * 2 + dx)];
      out[y * W + x] = any ? 1 : 0;
    }
  return out;
}

/**
 * One pyramid level: image (Float32 RGBA), hole (1 = unknown), a starting nearest neighbor
 * field (or null), returns the field after search and the image after voting.
 */
function solveLevel(img, w, h, hole, nnf, { patch, iterations, rand }) {
  const r = patch >> 1;
  const ch = 4;
  // valid source centers: whole patch inside the image and outside the hole
  const okSource = new Uint8Array(w * h);
  const sources = [];
  for (let y = r; y < h - r; y++) {
    for (let x = r; x < w - r; x++) {
      let ok = 1;
      for (let dy = -r; dy <= r && ok; dy++) for (let dx = -r; dx <= r; dx++) if (hole[(y + dy) * w + x + dx]) {
            ok = 0;
            break;
          }
      if (ok) {
        okSource[y * w + x] = 1;
        sources.push(y * w + x);
      }
    }
  }
  if (!sources.length) return { img, nnf };
  // targets: every pixel whose patch touches the hole
  const targets = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let touch = 0;
      for (let dy = -r; dy <= r && !touch; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w && hole[yy * w + xx]) {
            touch = 1;
            break;
          }
        }
      }
      if (touch) targets.push(y * w + x);
    }
  }
  const field = nnf ?? new Int32Array(w * h).fill(-1);
  const randomSource = () => sources[Math.floor(rand() * sources.length)];
  for (const t of targets) if (field[t] < 0 || !okSource[field[t]]) field[t] = randomSource();
  const dist = (t, s, limit = Infinity) => {
    const tx = t % w;
    const ty = (t - tx) / w;
    const sx = s % w;
    const sy = (s - sx) / w;
    let d = 0;
    for (let dy = -r; dy <= r; dy++) {
      const yy = ty + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -r; dx <= r; dx++) {
        const xx = tx + dx;
        if (xx < 0 || xx >= w) continue;
        const a = (yy * w + xx) * ch;
        const b = ((sy + dy) * w + sx + dx) * ch;
        const e0 = img[a] - img[b];
        const e1 = img[a + 1] - img[b + 1];
        const e2 = img[a + 2] - img[b + 2];
        const e3 = img[a + 3] - img[b + 3];
        d += e0 * e0 + e1 * e1 + e2 * e2 + e3 * e3 * 0.5;
      }
      if (d > limit) return d;
    }
    return d;
  };
  const cost = new Float64Array(w * h);
  for (const t of targets) cost[t] = dist(t, field[t]);
  const maxR = Math.max(w, h);
  for (let it = 0; it < iterations; it++) {
    const forward = it % 2 === 0;
    const order = forward ? targets : [...targets].reverse();
    const step = forward ? -1 : 1;
    for (const t of order) {
      const tx = t % w;
      const ty = (t - tx) / w;
      // propagation from the left (or right) and the top (or bottom) neighbor
      for (const [nx, ny] of [
        [tx + step, ty],
        [tx, ty + step],
      ]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (field[n] < 0) continue;
        // the neighbor's match, shifted back by the same offset
        const cx = (field[n] % w) - (nx - tx);
        const cy = Math.floor(field[n] / w) - (ny - ty);
        if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
        const c = cy * w + cx;
        if (!okSource[c]) continue;
        const d = dist(t, c, cost[t]);
        if (d < cost[t]) {
          cost[t] = d;
          field[t] = c;
        }
      }
      // random search in shrinking windows around the current match
      let R = maxR;
      const bx = field[t] % w;
      const by = Math.floor(field[t] / w);
      while (R >= 1) {
        const cx = Math.round(bx + (rand() * 2 - 1) * R);
        const cy = Math.round(by + (rand() * 2 - 1) * R);
        R = Math.floor(R / 2);
        if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
        const c = cy * w + cx;
        if (!okSource[c]) continue;
        const d = dist(t, c, cost[t]);
        if (d < cost[t]) {
          cost[t] = d;
          field[t] = c;
        }
      }
    }
    vote(img, w, h, hole, field, targets, r, cost);
    for (const t of targets) cost[t] = dist(t, field[t]);
  }
  return { img, nnf: field, targets };
}

/** Each hole pixel becomes the weighted mean of the pixels every overlapping patch suggests. */
function vote(img, w, h, hole, field, targets, r, cost) {
  const acc = new Float64Array(w * h * 5);
  let sigma = 0;
  let n = 0;
  for (const t of targets) {
    sigma += cost[t];
    n++;
  }
  sigma = Math.max(1, (sigma / Math.max(1, n)) * 1.5);
  for (const t of targets) {
    const s = field[t];
    if (s < 0) continue;
    const tx = t % w;
    const ty = (t - tx) / w;
    const sx = s % w;
    const sy = (s - sx) / w;
    const wt = Math.exp(-cost[t] / sigma) + 1e-6;
    for (let dy = -r; dy <= r; dy++) {
      const yy = ty + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -r; dx <= r; dx++) {
        const xx = tx + dx;
        if (xx < 0 || xx >= w) continue;
        const p = yy * w + xx;
        if (!hole[p]) continue;
        const q = ((sy + dy) * w + sx + dx) * 4;
        acc[p * 5] += img[q] * wt;
        acc[p * 5 + 1] += img[q + 1] * wt;
        acc[p * 5 + 2] += img[q + 2] * wt;
        acc[p * 5 + 3] += img[q + 3] * wt;
        acc[p * 5 + 4] += wt;
      }
    }
  }
  for (let p = 0; p < w * h; p++) {
    if (!hole[p] || !acc[p * 5 + 4]) continue;
    for (let c = 0; c < 4; c++) img[p * 4 + c] = acc[p * 5 + c] / acc[p * 5 + 4];
  }
}

/**
 * Fills pixels where mask >= 128. rgba: Uint8ClampedArray (w * h * 4). Returns a new array.
 * options: { patch = 7, iterations = 5, seed = 1, margin }
 */
export function contentAwareFill(rgba, w, h, mask, { patch = 7, iterations = 5, seed = 1, margin = null } = {}) {
  const rand = rng(seed);
  // work on the hole's neighborhood only
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x] >= 128) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  const out = new Uint8ClampedArray(rgba);
  if (x1 < 0) return out;
  const m = margin ?? Math.max(24, Math.round(Math.max(x1 - x0, y1 - y0) * 1.2));
  const cx0 = Math.max(0, x0 - m);
  const cy0 = Math.max(0, y0 - m);
  const cx1 = Math.min(w - 1, x1 + m);
  const cy1 = Math.min(h - 1, y1 + m);
  const CW = cx1 - cx0 + 1;
  const CH = cy1 - cy0 + 1;
  const full = new Float32Array(CW * CH * 4);
  const fullHole = new Uint8Array(CW * CH);
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
      const s = ((cy0 + y) * w + cx0 + x) * 4;
      for (let c = 0; c < 4; c++) full[(y * CW + x) * 4 + c] = rgba[s + c];
      fullHole[y * CW + x] = mask[(cy0 + y) * w + cx0 + x] >= 128 ? 1 : 0;
    }
  // working copy and pyramid
  let levels = [{ data: full, w: CW, h: CH, hole: fullHole }];
  while (levels[levels.length - 1].w > WORK || levels[levels.length - 1].h > WORK) {
    const top = levels[levels.length - 1];
    const d = downsample(top.data, top.w, top.h, 4);
    levels.push({ ...d, hole: shrinkMask(top.hole, top.w, top.h) });
  }
  const workIndex = levels.length - 1;
  let pyr = levels[workIndex];
  const coarse = [pyr];
  while (coarse[coarse.length - 1].w > 40 && coarse[coarse.length - 1].h > 40) {
    const top = coarse[coarse.length - 1];
    const d = downsample(top.data, top.w, top.h, 4);
    coarse.push({ ...d, hole: shrinkMask(top.hole, top.w, top.h) });
  }
  // start the coarsest level from the mean color of the known border
  const c0 = coarse[coarse.length - 1];
  {
    const mean = [0, 0, 0, 0];
    let n = 0;
    for (let p = 0; p < c0.w * c0.h; p++) if (!c0.hole[p]) {
        for (let c = 0; c < 4; c++) mean[c] += c0.data[p * 4 + c];
        n++;
      }
    for (let p = 0; p < c0.w * c0.h; p++) if (c0.hole[p]) for (let c = 0; c < 4; c++) c0.data[p * 4 + c] = n ? mean[c] / n : 0;
  }
  let nnf = null;
  for (let li = coarse.length - 1; li >= 0; li--) {
    const L = coarse[li];
    if (nnf && li < coarse.length - 1) {
      // upsample the field from the coarser level and vote once to start
      const prev = coarse[li + 1];
      const up = new Int32Array(L.w * L.h).fill(-1);
      for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
          const px = Math.min(prev.w - 1, x >> 1);
          const py = Math.min(prev.h - 1, y >> 1);
          const s = nnf[py * prev.w + px];
          if (s < 0) continue;
          const sx = Math.min(L.w - 1, (s % prev.w) * 2 + (x & 1));
          const sy = Math.min(L.h - 1, Math.floor(s / prev.w) * 2 + (y & 1));
          up[y * L.w + x] = sy * L.w + sx;
        }
      nnf = up;
    }
    const res = solveLevel(L.data, L.w, L.h, L.hole, nnf, { patch, iterations: li === 0 ? iterations : Math.max(2, iterations - 1), rand });
    nnf = res.nnf;
  }
  // carry the field up to full resolution: each hole pixel copies the pixel its match points at
  let field = nnf;
  let fw = coarse[0].w;
  let fh = coarse[0].h;
  for (let li = workIndex - 1; li >= 0; li--) {
    const L = levels[li];
    const up = new Int32Array(L.w * L.h).fill(-1);
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
        const px = Math.min(fw - 1, x >> 1);
        const py = Math.min(fh - 1, y >> 1);
        const s = field[py * fw + px];
        if (s < 0) continue;
        const sx = Math.min(L.w - 1, (s % fw) * 2 + (x & 1));
        const sy = Math.min(L.h - 1, Math.floor(s / fw) * 2 + (y & 1));
        up[y * L.w + x] = sy * L.w + sx;
      }
    field = up;
    fw = L.w;
    fh = L.h;
    // one voting pass at this level with the carried field
    const targets = [];
    for (let p = 0; p < L.w * L.h; p++) if (field[p] >= 0) targets.push(p);
    vote(L.data, L.w, L.h, L.hole, field, targets, patch >> 1, new Float64Array(L.w * L.h));
  }
  const final = levels[0];
  const src = workIndex === 0 ? coarse[0].data : final.data;
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
      const p = y * CW + x;
      const mv = mask[(cy0 + y) * w + cx0 + x];
      if (!mv) continue;
      const a = mv / 255;
      const o = ((cy0 + y) * w + cx0 + x) * 4;
      for (let c = 0; c < 4; c++) out[o + c] = Math.round(rgba[o + c] * (1 - a) + src[p * 4 + c] * a);
    }
  return out;
}
