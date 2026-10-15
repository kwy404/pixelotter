import { describe, expect, it } from 'vitest';
import { combineMasks, connectedRegion, contractMask, distanceField, expandMask, featherMask, floodSelect, invertMask, isEmptyMask, maskBounds, maskOutlines } from '../src/mask.js';
import { inpaint, seamlessPatch } from '../src/filters/heal.js';
import { makeImage, pixel } from './unit-helpers.js';

const square = (w, h, x0, y0, x1, y1) => {
  const m = new Uint8Array(w * h);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = 255;
  return m;
};

describe('masks and selections', () => {
  it('distance field is exact', () => {
    const d = distanceField(5, 5, (i) => i === 12);
    expect(d[12]).toBe(0);
    expect(d[13]).toBe(1);
    expect(d[0]).toBe(8);
  });

  it('expand grows and contract shrinks by the radius', () => {
    const m = square(20, 20, 8, 8, 12, 12);
    const grown = expandMask(m, 20, 20, 3);
    expect(maskBounds(grown, 20, 20, 128)).toEqual({ x: 5, y: 5, w: 10, h: 10 });
    const shrunk = contractMask(m, 20, 20, 1);
    expect(maskBounds(shrunk, 20, 20, 128)).toEqual({ x: 9, y: 9, w: 2, h: 2 });
  });

  it('combines with add, subtract and intersect', () => {
    const a = new Uint8Array([255, 255, 0, 0]);
    const b = new Uint8Array([0, 255, 255, 0]);
    expect(Array.from(combineMasks(a, b, 'add'))).toEqual([255, 255, 255, 0]);
    expect(Array.from(combineMasks(a, b, 'subtract'))).toEqual([255, 0, 0, 0]);
    expect(Array.from(combineMasks(a, b, 'intersect'))).toEqual([0, 255, 0, 0]);
    expect(Array.from(combineMasks(a, b))).toEqual(Array.from(b));
    expect(Array.from(invertMask(a))).toEqual([0, 0, 255, 255]);
    expect(isEmptyMask(new Uint8Array(4))).toBe(true);
  });

  it('feather softens the edge but keeps the middle', () => {
    const m = square(30, 30, 10, 10, 20, 20);
    const f = featherMask(m, 30, 30, 4);
    expect(f[15 * 30 + 15]).toBeGreaterThan(240);
    expect(f[15 * 30 + 10]).toBeGreaterThan(60);
    expect(f[15 * 30 + 10]).toBeLessThan(200);
    expect(f[15 * 30 + 5]).toBeLessThan(m[15 * 30 + 10]);
  });

  it('outlines a selection as closed loops, holes included', () => {
    const m = square(10, 10, 2, 2, 8, 8);
    for (let y = 4; y < 6; y++) for (let x = 4; x < 6; x++) m[y * 10 + x] = 0;
    const loops = maskOutlines(m, 10, 10);
    expect(loops).toHaveLength(2);
    const outer = loops.find((l) => l.some(([x]) => x === 2));
    expect(outer).toHaveLength(4);
  });

  it('magic wand selects connected similar colors only', () => {
    const img = makeImage(6, 3, (x) => (x < 2 ? [250, 10, 10] : x < 4 ? [10, 10, 250] : [245, 15, 12]));
    const sel = floodSelect(img.data, 6, 3, 0, 0, 20);
    expect(maskBounds(sel, 6, 3)).toEqual({ x: 0, y: 0, w: 2, h: 3 });
    const all = floodSelect(img.data, 6, 3, 0, 0, 20, false);
    expect(maskBounds(all, 6, 3)).toEqual({ x: 0, y: 0, w: 6, h: 3 });
    expect(all[3]).toBe(0);
  });

  it('keeps the connected region under a point', () => {
    const m = new Uint8Array([255, 0, 255, 255]);
    expect(Array.from(connectedRegion(m, 4, 1, 3, 0))).toEqual([0, 0, 255, 255]);
  });
});

describe('healing', () => {
  it('inpaint fills a hole from a smooth gradient', () => {
    const img = makeImage(20, 1, (x) => [x * 10, 100, 50]);
    const hole = new Uint8Array(20);
    for (let x = 8; x < 12; x++) hole[x] = 255;
    const data = img.data.slice();
    for (let x = 8; x < 12; x++) data.set([0, 0, 0, 255], x * 4);
    const out = inpaint(data, 20, 1, hole, 2000);
    for (let x = 8; x < 12; x++) expect(Math.abs(out[x * 4] - x * 10)).toBeLessThan(3);
    expect(out[5 * 4]).toBe(50);
  });

  it('a patch takes on the brightness of its new place', () => {
    const w = 16;
    const target = makeImage(w, w, [180, 180, 180]).data;
    const source = makeImage(w, w, (x, y) => [60 + ((x + y) % 2) * 20, 60, 60]).data;
    const mask = square(w, w, 4, 4, 12, 12);
    const out = seamlessPatch(target, source, w, w, mask, 3000);
    const p = pixel({ data: out, width: w }, 8, 8);
    expect(Math.abs(p[1] - 180)).toBeLessThan(4);
    // The texture of the source survives as the difference between neighbors.
    const q = pixel({ data: out, width: w }, 9, 8);
    expect(Math.abs(p[0] - q[0])).toBeGreaterThan(10);
  });
});
