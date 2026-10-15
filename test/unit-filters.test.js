import { describe, expect, it } from 'vitest';
import { FILTERS, FILTER_GROUPS, defaults, getFilter, normalizeParams, runFilter } from '../src/filters/registry.js';
import { curveTable, levelsTable } from '../src/filters/tone.js';
import { contentAwareFill } from '../src/filters/inpaint.js';
import { applyField, createField, dab, isIdentity } from '../src/filters/liquify.js';
import { makeImage, pixel } from './unit-helpers.js';

const photo = () => makeImage(24, 18, (x, y) => [(x * 10) % 256, (y * 14) % 256, ((x + y) * 6) % 256, 255]);

describe('filter registry', () => {
  it('every filter runs, keeps the size and leaves the input alone', () => {
    for (const f of FILTERS) {
      const img = photo();
      const before = Array.from(img.data);
      const out = runFilter(f.id, img, {});
      expect([out.width, out.height]).toEqual([24, 18]);
      expect(out.data).toHaveLength(img.data.length);
      expect(Array.from(img.data)).toEqual(before);
    }
  });

  it('has the classic groups and sane parameters', () => {
    for (const g of FILTER_GROUPS) expect(FILTERS.some((f) => f.group === g)).toBe(true);
    for (const f of FILTERS) {
      for (const p of f.params) expect(p.default).not.toBeUndefined();
      expect(Object.keys(defaults(f.id))).toEqual(f.params.map((p) => p.key));
    }
    expect(FILTERS.filter((f) => f.adjustment).length).toBeGreaterThanOrEqual(15);
    expect(normalizeParams('gaussian-blur', { radius: 9999 }).radius).toBe(250);
    expect(normalizeParams('posterize', { levels: 'x' }).levels).toBe(4);
    expect(getFilter('nope')).toBeNull();
  });

  it('scales pixel sized parameters for previews', () => {
    const img = makeImage(40, 1, (x) => (x === 20 ? [255, 255, 255] : [0, 0, 0]));
    const full = runFilter('box-blur', img, { radius: 8 });
    const half = runFilter('box-blur', img, { radius: 8 }, { scale: 0.5 });
    expect(pixel(half, 25, 0)[0]).toBe(0);
    expect(pixel(full, 25, 0)[0]).toBeGreaterThan(0);
  });
});

describe('tone adjustments on known pixels', () => {
  it('levels map black and white points and gamma', () => {
    const t = levelsTable({ inBlack: 50, inWhite: 200 });
    expect([t[50], t[125], t[200], t[0], t[255]]).toEqual([0, 128, 255, 0, 255]);
    expect(levelsTable({ gamma: 2 })[64]).toBeGreaterThan(64);
    const out = runFilter('levels', makeImage(1, 1, [100, 100, 100]), { levels: { master: { outBlack: 20, outWhite: 220 }, red: { inWhite: 128 } } });
    expect(pixel(out, 0, 0)[1]).toBe(Math.round(20 + (100 / 255) * 200));
    expect(pixel(out, 0, 0)[0]).toBeGreaterThan(pixel(out, 0, 0)[1]);
  });

  it('curves pass through their points and never overshoot', () => {
    const t = curveTable([[0, 0], [64, 40], [192, 220], [255, 255]]);
    expect(t[64]).toBe(40);
    expect(t[192]).toBe(220);
    for (let i = 1; i < 256; i++) expect(t[i]).toBeGreaterThanOrEqual(t[i - 1]);
    expect(Array.from(curveTable())).toEqual(Array.from({ length: 256 }, (_, i) => i));
  });

  it('hue, invert, posterize, threshold and gradient map', () => {
    const red = makeImage(1, 1, [255, 0, 0]);
    expect(pixel(runFilter('hue-saturation', red, { hue: 120 }), 0, 0).slice(0, 3)).toEqual([0, 255, 0]);
    expect(pixel(runFilter('invert', red), 0, 0).slice(0, 3)).toEqual([0, 255, 255]);
    expect(pixel(runFilter('posterize', makeImage(1, 1, [100, 200, 30]), { levels: 2 }), 0, 0).slice(0, 3)).toEqual([0, 255, 0]);
    expect(pixel(runFilter('threshold', makeImage(1, 1, [200, 200, 200])), 0, 0).slice(0, 3)).toEqual([255, 255, 255]);
    const gm = runFilter('gradient-map', makeImage(2, 1, (x) => (x ? [255, 255, 255] : [0, 0, 0])), { stops: [{ at: 0, color: '#102030' }, { at: 1, color: '#ffeedd' }] });
    expect(pixel(gm, 0, 0).slice(0, 3)).toEqual([16, 32, 48]);
    expect(pixel(gm, 1, 0).slice(0, 3)).toEqual([255, 238, 221]);
  });

  it('black and white makes gray, photo filter warms', () => {
    const bw = runFilter('black-white', makeImage(1, 1, [200, 80, 40]));
    const [r, g, b] = pixel(bw, 0, 0);
    expect(r).toBe(g);
    expect(g).toBe(b);
    const warm = pixel(runFilter('photo-filter', makeImage(1, 1, [128, 128, 128]), { density: 60 }), 0, 0);
    expect(warm[0]).toBeGreaterThan(warm[2]);
  });

  it('channel mixer can swap channels', () => {
    const out = runFilter('channel-mixer', makeImage(1, 1, [10, 20, 30]), { red: [0, 0, 100, 0], blue: [100, 0, 0, 0] });
    expect(pixel(out, 0, 0).slice(0, 3)).toEqual([30, 20, 10]);
  });
});

describe('effects', () => {
  it('reduce noise removes a single hot pixel', () => {
    const img = makeImage(7, 7, (x, y) => (x === 3 && y === 3 ? [255, 255, 255] : [50, 50, 50]));
    expect(pixel(runFilter('reduce-noise', img, { radius: 1 }), 3, 3)[0]).toBe(50);
  });

  it('mosaic averages each cell', () => {
    const img = makeImage(4, 2, (x) => (x < 2 ? [0, 0, 0] : [200, 200, 200]));
    const out = runFilter('mosaic', img, { size: 4 });
    expect(pixel(out, 0, 0)[0]).toBe(100);
    expect(pixel(out, 3, 1)[0]).toBe(100);
  });

  it('offset wraps around, distortions at zero change nothing', () => {
    const img = photo();
    const out = runFilter('offset', img, { dx: 24, dy: 18 });
    expect(Array.from(out.data)).toEqual(Array.from(img.data));
    const tw = runFilter('twirl', img, { angle: 0 });
    expect(Array.from(tw.data)).toEqual(Array.from(img.data));
  });

  it('minimum and maximum spread dark and light', () => {
    const img = makeImage(5, 5, (x, y) => (x === 2 && y === 2 ? [0, 0, 0] : [200, 200, 200]));
    expect(pixel(runFilter('minimum', img, { radius: 1 }), 1, 1)[0]).toBe(0);
    expect(pixel(runFilter('maximum', img, { radius: 1 }), 2, 2)[0]).toBe(200);
  });

  it('find edges marks a boundary', () => {
    const img = makeImage(6, 6, (x) => (x < 3 ? [0, 0, 0] : [255, 255, 255]));
    const out = runFilter('find-edges', img);
    expect(pixel(out, 0, 3)[0]).toBe(255);
    expect(pixel(out, 3, 3)[0]).toBeLessThan(100);
  });
});

describe('content aware fill', () => {
  it('rebuilds a striped texture inside a hole', () => {
    const w = 64;
    const h = 48;
    const img = makeImage(w, h, (x) => ((x >> 2) % 2 ? [200, 180, 150] : [40, 50, 60]));
    const mask = new Uint8Array(w * h);
    for (let y = 18; y < 30; y++) for (let x = 26; x < 38; x++) mask[y * w + x] = 255;
    const broken = img.data.slice();
    for (let p = 0; p < w * h; p++) if (mask[p]) broken.set([255, 0, 255, 255], p * 4);
    const out = contentAwareFill(broken, w, h, mask, { seed: 3 });
    let err = 0;
    let n = 0;
    for (let p = 0; p < w * h; p++) {
      if (!mask[p]) continue;
      err += Math.abs(out[p * 4] - img.data[p * 4]);
      n++;
    }
    // no magenta left, and close to the true stripes
    expect(err / n).toBeLessThan(40);
    for (let p = 0; p < w * h; p++) if (!mask[p]) expect(out[p * 4]).toBe(img.data[p * 4]);
  });
});

describe('liquify', () => {
  it('an empty field is the identity, reconstruct brings a warp back', () => {
    const img = photo();
    const field = createField(24, 18, 2);
    expect(isIdentity(field)).toBe(true);
    expect(Array.from(applyField(img, field).data)).toEqual(Array.from(img.data));
    dab(field, 'push', 12, 9, { radius: 8, pressure: 1, mx: 4, my: 0 });
    expect(isIdentity(field)).toBe(false);
    for (let i = 0; i < 40; i++) dab(field, 'reconstruct', 12, 9, { radius: 12, pressure: 1 });
    expect(Math.max(...field.dx.map(Math.abs))).toBeLessThan(0.01);
  });

  it('push moves content along the stroke', () => {
    const img = makeImage(30, 10, (x) => (x === 10 ? [255, 255, 255] : [0, 0, 0]));
    const field = createField(30, 10, 1);
    dab(field, 'push', 12, 5, { radius: 6, pressure: 1, mx: 3, my: 0 });
    const out = applyField(img, field);
    // the bright column moved right, out of x = 10
    expect(pixel(out, 10, 5)[0]).toBe(0);
    expect(Math.max(...[12, 13, 14].map((x) => pixel(out, x, 5)[0]))).toBeGreaterThan(100);
  });
});
