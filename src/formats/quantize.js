// Color quantization for GIF and indexed color: median cut over a 5 bit per channel histogram,
// then nearest color mapping with an optional Floyd Steinberg dither. Pixels with alpha below
// 128 map to a reserved transparent index.

/**
 * Builds a palette of up to maxColors from one or more RGBA buffers.
 * Returns an array of [r, g, b].
 */
export function medianCut(buffers, maxColors = 256) {
  // few distinct colors: use them exactly
  const exact = new Map();
  for (const data of buffers) {
    for (let i = 0; i < data.length && exact.size <= maxColors; i += 4) {
      if (data[i + 3] < 128) continue;
      exact.set((data[i] << 16) | (data[i + 1] << 8) | data[i + 2], 1);
    }
  }
  if (exact.size && exact.size <= maxColors) return [...exact.keys()].map((k) => [(k >> 16) & 255, (k >> 8) & 255, k & 255]);
  const hist = new Uint32Array(32768);
  for (const data of buffers) {
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      hist[((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3)]++;
    }
  }
  const colors = [];
  for (let k = 0; k < hist.length; k++) if (hist[k]) colors.push([(k >> 10) & 31, (k >> 5) & 31, k & 31, hist[k]]);
  if (!colors.length) return [[0, 0, 0]];
  if (colors.length <= maxColors) return colors.map(([r, g, b]) => [(r << 3) | (r >> 2), (g << 3) | (g >> 2), (b << 3) | (b >> 2)]);
  let boxes = [colors];
  while (boxes.length < maxColors) {
    // split the box with the largest range times population
    let best = -1;
    let bestScore = -1;
    let bestAxis = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      const ranges = [0, 1, 2].map((c) => {
        let mn = 31;
        let mx = 0;
        for (const col of box) {
          if (col[c] < mn) mn = col[c];
          if (col[c] > mx) mx = col[c];
        }
        return mx - mn;
      });
      const axis = ranges.indexOf(Math.max(...ranges));
      const pop = box.reduce((a, col) => a + col[3], 0);
      const score = ranges[axis] * Math.sqrt(pop);
      if (score > bestScore) {
        bestScore = score;
        best = i;
        bestAxis = axis;
      }
    });
    if (best < 0) break;
    const box = boxes[best].sort((a, b) => a[bestAxis] - b[bestAxis]);
    const total = box.reduce((a, col) => a + col[3], 0);
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < box.length - 1; i++) {
      acc += box[i][3];
      if (acc >= total / 2) {
        cut = i + 1;
        break;
      }
    }
    boxes.splice(best, 1, box.slice(0, cut), box.slice(cut));
  }
  return boxes.map((box) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (const [cr, cg, cb, c] of box) {
      r += cr * c;
      g += cg * c;
      b += cb * c;
      n += c;
    }
    const to8 = (v) => Math.min(255, Math.round(((v / n) * 255) / 31));
    return [to8(r), to8(g), to8(b)];
  });
}

/**
 * Maps RGBA pixels to palette indices. transparentIndex receives pixels with alpha < 128.
 * Returns a Uint8Array of indices.
 */
export function mapToPalette(data, width, height, palette, { dither = true, transparentIndex = -1 } = {}) {
  const out = new Uint8Array(width * height);
  const cache = new Map();
  const nearest = (r, g, b) => {
    const key = (r << 16) | (g << 8) | b;
    let hit = cache.get(key);
    if (hit !== undefined) return hit;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < palette.length; i++) {
      if (i === transparentIndex) continue;
      const p = palette[i];
      const d = (p[0] - r) ** 2 * 2 + (p[1] - g) ** 2 * 4 + (p[2] - b) ** 2 * 3;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (cache.size < 200000) cache.set(key, best);
    return best;
  };
  const err = dither ? new Float32Array(width * height * 3) : null;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const i = p * 4;
      if (transparentIndex >= 0 && data[i + 3] < 128) {
        out[p] = transparentIndex;
        continue;
      }
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];
      if (err) {
        r = Math.max(0, Math.min(255, Math.round(r + err[p * 3])));
        g = Math.max(0, Math.min(255, Math.round(g + err[p * 3 + 1])));
        b = Math.max(0, Math.min(255, Math.round(b + err[p * 3 + 2])));
      }
      const idx = nearest(r, g, b);
      out[p] = idx;
      if (err) {
        const c = palette[idx];
        const e = [r - c[0], g - c[1], b - c[2]];
        const spread = (dx, dy, k) => {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || xx >= width || yy >= height) return;
          const q = (yy * width + xx) * 3;
          err[q] += e[0] * k;
          err[q + 1] += e[1] * k;
          err[q + 2] += e[2] * k;
        };
        spread(1, 0, 7 / 16);
        spread(-1, 1, 3 / 16);
        spread(0, 1, 5 / 16);
        spread(1, 1, 1 / 16);
      }
    }
  }
  return out;
}
