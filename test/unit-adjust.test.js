import { describe, expect, it } from 'vitest';
import { applyAdjustments, autoEnhance, blurImage, boxSizes, luma, neutralAdjustments, normalizeAdjustments, sharpenImage, toneTables, vignetteImage } from '../src/filters/adjust.js';
import { LOOKS, combineLook } from '../src/filters/looks.js';
import { makeImage, pixel } from './unit-helpers.js';

describe('adjustments on known pixels', () => {
  it('leaves pixels alone when every value is neutral', () => {
    const img = makeImage(3, 2, (x, y) => [x * 80, y * 100, 50, 200]);
    const out = applyAdjustments(img, neutralAdjustments());
    expect(Array.from(out.data)).toEqual(Array.from(img.data));
    expect(out.data).not.toBe(img.data);
  });

  it('brightness adds light evenly and never touches alpha', () => {
    const img = makeImage(1, 1, [100, 100, 100, 77]);
    const [r, g, b, a] = pixel(applyAdjustments(img, { brightness: 50 }), 0, 0);
    expect(r).toBe(140);
    expect(g).toBe(140);
    expect(b).toBe(140);
    expect(a).toBe(77);
    expect(pixel(applyAdjustments(img, { brightness: -100 }), 0, 0).slice(0, 3)).toEqual([20, 20, 20]);
  });

  it('contrast pivots around middle gray', () => {
    const img = makeImage(3, 1, (x) => [[64, 128, 192][x], 128, 128]);
    const out = applyAdjustments(img, { contrast: 100 });
    expect(pixel(out, 1, 0)[0]).toBe(128);
    expect(pixel(out, 0, 0)[0]).toBe(0); // (64 - 128) * 2.5 + 128 < 0
    expect(pixel(out, 2, 0)[0]).toBe(255);
    const flat = applyAdjustments(img, { contrast: -100 });
    expect(Math.abs(pixel(flat, 0, 0)[0] - 128)).toBeLessThan(10);
  });

  it('exposure doubles the light per stop', () => {
    const out = applyAdjustments(makeImage(1, 1, [50, 60, 70]), { exposure: 50 });
    expect(pixel(out, 0, 0).slice(0, 3)).toEqual([100, 120, 140]);
  });

  it('saturation -100 makes gray and +100 pushes colors apart', () => {
    const img = makeImage(1, 1, [200, 100, 50]);
    const [r, g, b] = pixel(applyAdjustments(img, { saturation: -100 }), 0, 0);
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(r).toBe(Math.round(luma(200, 100, 50)));
    const vivid = pixel(applyAdjustments(img, { saturation: 100 }), 0, 0);
    expect(vivid[0]).toBeGreaterThan(200);
    expect(vivid[2]).toBeLessThan(50);
  });

  it('warmth moves red up and blue down', () => {
    const [r, g, b] = pixel(applyAdjustments(makeImage(1, 1, [100, 100, 100]), { warmth: 100 }), 0, 0);
    expect(r).toBe(130);
    expect(g).toBe(100);
    expect(b).toBe(70);
  });

  it('shadows lift dark pixels much more than bright ones, highlights the reverse', () => {
    const img = makeImage(2, 1, (x) => (x ? [230, 230, 230] : [30, 30, 30]));
    const lifted = applyAdjustments(img, { shadows: 100 });
    expect(pixel(lifted, 0, 0)[0] - 30).toBeGreaterThan(50);
    expect(pixel(lifted, 1, 0)[0] - 230).toBeLessThan(5);
    const held = applyAdjustments(img, { highlights: -100 });
    expect(230 - pixel(held, 1, 0)[0]).toBeGreaterThan(50);
    expect(30 - pixel(held, 0, 0)[0]).toBeLessThan(5);
  });

  it('fade lifts the black point', () => {
    const t = toneTables({ ...neutralAdjustments(), fade: 100 });
    expect(t[0][0]).toBe(70);
    expect(t[0][255]).toBe(255);
  });

  it('blur keeps a flat image flat and spreads a single bright pixel', () => {
    const flat = blurImage(makeImage(9, 9, [90, 90, 90]), 2);
    expect(new Set(Array.from(flat.data).filter((_, i) => i % 4 === 0))).toEqual(new Set([90]));
    const dot = makeImage(9, 9, (x, y) => (x === 4 && y === 4 ? [255, 255, 255] : [0, 0, 0]));
    const soft = blurImage(dot, 1.5);
    expect(pixel(soft, 4, 4)[0]).toBeLessThan(255);
    expect(pixel(soft, 5, 4)[0]).toBeGreaterThan(0);
    expect(pixel(soft, 4, 5)[0]).toBe(pixel(soft, 5, 4)[0]);
  });

  it('blur does not bleed dark fringes from transparent pixels', () => {
    const img = makeImage(6, 1, (x) => (x < 3 ? [255, 0, 0, 255] : [0, 0, 0, 0]));
    const out = blurImage(img, 1.5);
    const edge = pixel(out, 2, 0);
    expect(edge[0]).toBe(255);
    expect(edge[3]).toBe(255);
  });

  it('box sizes approximate the requested sigma', () => {
    const sizes = boxSizes(3);
    expect(sizes).toHaveLength(3);
    const variance = sizes.reduce((v, r) => v + ((2 * r + 1) ** 2 - 1) / 12, 0);
    expect(Math.sqrt(variance)).toBeGreaterThan(2.5);
    expect(Math.sqrt(variance)).toBeLessThan(3.6);
  });

  it('sharpen leaves flat areas and steepens an edge', () => {
    const flat = sharpenImage(makeImage(5, 5, [100, 100, 100]), 1);
    expect(pixel(flat, 2, 2)[0]).toBe(100);
    const edge = makeImage(8, 1, (x) => (x < 4 ? [80, 80, 80] : [160, 160, 160]));
    const out = sharpenImage(edge, 1);
    expect(pixel(out, 3, 0)[0]).toBeLessThan(80);
    expect(pixel(out, 4, 0)[0]).toBeGreaterThan(160);
  });

  it('vignette darkens corners, not the center', () => {
    const out = vignetteImage(makeImage(21, 21, [200, 200, 200]), 1);
    expect(pixel(out, 10, 10)[0]).toBe(200);
    expect(pixel(out, 0, 0)[0]).toBeLessThan(80);
  });

  it('clamps and fills in values', () => {
    expect(normalizeAdjustments({ brightness: 500, contrast: 'x', nope: 3 })).toMatchObject({ brightness: 100, contrast: 0 });
    expect(normalizeAdjustments({}).nope).toBeUndefined();
  });

  it('auto enhance brightens a dark, flat photo and leaves a balanced one nearly alone', () => {
    const dark = makeImage(16, 16, (x, y) => [20 + x * 2, 18 + y * 2, 15 + x]);
    const p = autoEnhance(dark);
    expect(p.exposure).toBeGreaterThan(20);
    expect(p.contrast).toBeGreaterThan(10);
    expect(p.shadows).toBeGreaterThan(0);
    const balanced = makeImage(16, 16, (x, y) => [x * 16, y * 16, ((x + y) * 8) % 256]);
    const q = autoEnhance(balanced);
    expect(Math.abs(q.exposure)).toBeLessThan(15);
    const after = applyAdjustments(dark, p);
    const mean = (img) => Array.from(img.data).filter((_, i) => i % 4 !== 3).reduce((a, b) => a + b, 0) / (img.width * img.height * 3);
    expect(mean(after)).toBeGreaterThan(mean(dark) + 20);
  });

  it('looks add to manual adjustments and stay in range', () => {
    expect(combineLook({ warmth: 80 }, 'safelight').warmth).toBe(100);
    expect(combineLook({}, 'silver').saturation).toBe(-100);
    expect(combineLook({ brightness: 5 }, 'none').brightness).toBe(5);
    for (const name of Object.keys(LOOKS)) expect(Object.keys(combineLook({}, name)).length).toBeGreaterThan(5);
  });
});
