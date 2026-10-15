import { describe, expect, it } from 'vitest';
import { STICKER, captionSize, fitBudget, outlineMask, stickerLayout } from '../src/sticker.js';
import { MODEL, coverage, postprocess, preprocess, resizeRgba, upscaleMask } from '../src/segment.js';
import { arcRadius, glyphBounds, layoutArc, splitLines } from '../src/textlayout.js';
import { makeImage } from './unit-helpers.js';

describe('sticker size budget', () => {
  it('uses the best quality that fits under 100 kB', async () => {
    // A fake encoder whose size grows with quality, like a real one.
    const encode = async (q) => Math.round(30000 + q * 120000);
    const r = await fitBudget(encode);
    expect(r.ok).toBe(true);
    expect(r.size).toBeLessThanOrEqual(STICKER.budget);
    expect(r.quality).toBeGreaterThan(0.5);
    expect(r.size).toBeGreaterThan(STICKER.budget * 0.95);
    expect(r.tries).toBeLessThanOrEqual(9);
  });

  it('keeps the top quality when it already fits', async () => {
    const r = await fitBudget(async () => 40000);
    expect(r).toMatchObject({ ok: true, quality: 0.95, tries: 1 });
  });

  it('reports a sticker that cannot fit', async () => {
    const r = await fitBudget(async () => 250000);
    expect(r.ok).toBe(false);
    expect(r.size).toBe(250000);
  });

  it('accepts Blobs from the encoder', async () => {
    const r = await fitBudget(async (q) => new Blob([new Uint8Array(Math.round(q * 150000))]));
    expect(r.result).toBeInstanceOf(Blob);
    expect(r.size).toBeLessThanOrEqual(100000);
  });

  it('lays the subject out inside 512 with margin, outline and caption', () => {
    const l = stickerLayout({ x: 0, y: 0, w: 1000, h: 500 }, { outline: 12, caption: 60 });
    expect(l.x).toBeGreaterThanOrEqual(STICKER.margin + 12 - 0.001);
    expect(l.x + l.w).toBeLessThanOrEqual(512 - STICKER.margin - 12 + 0.001);
    expect(l.y + l.h).toBeLessThanOrEqual(512 - STICKER.margin - 12 - 60 + 0.001);
    const tall = stickerLayout({ x: 0, y: 0, w: 100, h: 900 });
    expect(tall.h).toBeCloseTo(512 - 2 * 28, 6);
  });

  it('draws an outline ring of the requested width', () => {
    const w = 21;
    const alpha = new Uint8Array(w * w);
    alpha[10 * w + 10] = 255;
    const ring = outlineMask(alpha, w, w, 5);
    expect(ring[10 * w + 14]).toBe(255);
    expect(ring[10 * w + 15]).toBeGreaterThan(0);
    expect(ring[10 * w + 15]).toBeLessThan(255);
    expect(ring[10 * w + 16]).toBe(0);
    expect(ring[10 * w + 10]).toBe(255);
  });

  it('caption size shrinks to fit', () => {
    const measure = (text, px) => text.length * px * 0.6;
    expect(captionSize(measure, 'Hi')).toBe(64);
    expect(captionSize(measure, 'A rather long caption here')).toBeLessThan(64);
    expect(captionSize(measure, '')).toBe(0);
  });
});

describe('segmentation pre and post processing', () => {
  it('builds a normalized 3x320x320 tensor', () => {
    const img = makeImage(64, 48, [255, 128, 0]);
    const t = preprocess(img.data, 64, 48);
    const n = MODEL.input * MODEL.input;
    expect(t).toHaveLength(3 * n);
    expect(t[0]).toBeCloseTo((1 - 0.485) / 0.229, 3);
    expect(t[n]).toBeCloseTo((128 / 255 - 0.456) / 0.224, 2);
    expect(t[2 * n]).toBeCloseTo((0 - 0.406) / 0.225, 3);
  });

  it('min max normalizes the output and upsamples it', () => {
    const out = new Float32Array(4).fill(0.2);
    out[3] = 0.9;
    const m = postprocess(out, 2);
    expect(Array.from(m)).toEqual([0, 0, 0, 255]);
    const big = upscaleMask(m, 2, 2, 8, 8);
    expect(big[63]).toBe(255);
    expect(big[0]).toBe(0);
    expect(coverage(new Uint8Array([255, 0]))).toBe(0.5);
  });

  it('resizes RGBA with bilinear filtering', () => {
    const img = makeImage(2, 1, (x) => (x ? [200, 200, 200] : [0, 0, 0]));
    const r = resizeRgba(img.data, 2, 1, 4, 1);
    expect(r[0]).toBe(0);
    expect(r[12]).toBe(200);
    expect(r[4]).toBeGreaterThan(0);
    expect(r[4]).toBeLessThan(200);
  });

  it('documents the model and its license', () => {
    expect(MODEL.license).toBe('Apache-2.0');
    expect(MODEL.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(MODEL.urls.every((u) => u.startsWith('https://cdn.jsdelivr.net/'))).toBe(true);
  });
});

describe('curved text layout', () => {
  it('straight text sits on the baseline, centered', () => {
    const g = layoutArc([10, 20, 10], 0);
    expect(g.map((p) => p.x)).toEqual([-15, 0, 15]);
    expect(g.every((p) => p.y === 0 && p.angle === 0)).toBe(true);
  });

  it('an arch drops the ends and turns the glyphs', () => {
    const g = layoutArc([10, 10, 10, 10], 60);
    expect(g[0].y).toBeGreaterThan(0);
    expect(g[0].angle).toBeLessThan(0);
    expect(g[3].angle).toBeGreaterThan(0);
    expect(g[0].x).toBeCloseTo(-g[3].x, 9);
    const smile = layoutArc([10, 10, 10, 10], -60);
    expect(smile[0].y).toBeLessThan(0);
    expect(arcRadius(40, 0)).toBe(Infinity);
    expect(glyphBounds(g, [10, 10, 10, 10], 20).w).toBeGreaterThan(0);
    expect(splitLines('a\r\nb')).toEqual(['a', 'b']);
  });
});
