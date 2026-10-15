import { describe, expect, it } from 'vitest';
import { apply, corners, cropOps, fitScale, flipCanvasOps, handlePoints, hitTest, invert, layerBounds, layerMatrix, multiply, resizeByHandle, rotateCanvasOps, rotationFromDrag, straightenScale } from '../src/geometry.js';
import { applyOps, createDoc, findLayer, makeLayer } from '../src/doc.js';

const L = (props = {}) => ({ x: 100, y: 50, rotation: 0, scaleX: 1, scaleY: 1, ...props });
const size = { w: 40, h: 20 };
const close = (p, q) => {
  expect(p.x).toBeCloseTo(q.x, 6);
  expect(p.y).toBeCloseTo(q.y, 6);
};

describe('layer transforms', () => {
  it('centers the local box on the layer position', () => {
    const c = corners(L(), size);
    close(c[0], { x: 80, y: 40 });
    close(c[2], { x: 120, y: 60 });
  });

  it('rotates and scales around the center', () => {
    const b = layerBounds(L({ rotation: 90, scaleX: 2 }), size);
    expect(b.w).toBeCloseTo(20, 6);
    expect(b.h).toBeCloseTo(80, 6);
    close({ x: b.x + b.w / 2, y: b.y + b.h / 2 }, { x: 100, y: 50 });
  });

  it('inverts matrices', () => {
    const m = layerMatrix(L({ rotation: 33, scaleX: 1.7, scaleY: -0.4 }), size);
    const id = multiply(m, invert(m));
    [1, 0, 0, 1, 0, 0].forEach((v, i) => expect(id[i]).toBeCloseTo(v, 9));
    close(apply(invert(m), apply(m, { x: 3, y: 4 })), { x: 3, y: 4 });
  });

  it('hit tests inside the rotated box only', () => {
    const l = L({ rotation: 45 });
    expect(hitTest(l, size, { x: 100, y: 50 })).toBe(true);
    expect(hitTest(l, size, { x: 80, y: 40 })).toBe(false);
  });

  it('dragging a corner keeps the opposite corner in place', () => {
    const start = L({ rotation: 30 });
    const before = handlePoints(start, size);
    const next = resizeByHandle(start, size, 'se', { x: before.se.x + 30, y: before.se.y + 10 });
    const after = handlePoints({ ...start, ...next }, size);
    close(after.nw, before.nw);
    expect(next.scaleX).toBeGreaterThan(1);
  });

  it('keeps the aspect ratio when asked and scales from the center', () => {
    const start = L();
    const next = resizeByHandle(start, size, 'se', { x: 160, y: 61 }, { keepAspect: true });
    expect(next.scaleX).toBeCloseTo(next.scaleY, 9);
    const c = resizeByHandle(start, size, 'e', { x: 140, y: 50 }, { fromCenter: true });
    expect(c.x).toBeCloseTo(100, 9);
    expect(c.scaleX).toBeCloseTo(2, 9);
  });

  it('dragging an edge past the anchor flips the layer', () => {
    const next = resizeByHandle(L(), size, 'e', { x: 60, y: 50 });
    expect(next.scaleX).toBeLessThan(0);
  });

  it('rotation follows the pointer and snaps to 15 degrees', () => {
    const start = L();
    expect(rotationFromDrag(start, { x: 100, y: 0 }, { x: 150, y: 50 })).toBeCloseTo(90, 6);
    expect(rotationFromDrag(start, { x: 100, y: 0 }, { x: 140, y: 30 }, true) % 15).toBe(0);
  });

  it('fit and straighten scales', () => {
    expect(fitScale(200, 100, 100, 100)).toBe(0.5);
    expect(fitScale(200, 100, 100, 100, 'cover')).toBe(1);
    expect(straightenScale(100, 100, 0)).toBe(1);
    expect(straightenScale(100, 100, 45)).toBeCloseTo(Math.SQRT2, 9);
    expect(straightenScale(300, 200, 10)).toBeGreaterThan(1);
  });
});

describe('canvas operations', () => {
  const doc = () => {
    const d = createDoc({ width: 200, height: 100 });
    applyOps(d, [{ t: 'add', layer: makeLayer('raster', { id: 'a', w: 200, h: 100, x: 100, y: 50, asset: 'x' }) }]);
    return d;
  };

  it('crop moves layers and resizes the canvas', () => {
    const d = doc();
    applyOps(d, cropOps(d, { x: 50, y: 10, w: 100, h: 60 }));
    expect([d.width, d.height]).toEqual([100, 60]);
    expect(findLayer(d, 'a')).toMatchObject({ x: 50, y: 40 });
  });

  it('rotating four times or flipping twice comes back', () => {
    const d = doc();
    const before = JSON.stringify(d);
    for (let i = 0; i < 4; i++) applyOps(d, rotateCanvasOps(d, 1));
    expect(JSON.stringify(d).replace(/-0\b/g, '0')).toBe(before);
    applyOps(d, flipCanvasOps(d, 'x'));
    expect(findLayer(d, 'a').scaleX).toBe(-1);
    applyOps(d, flipCanvasOps(d, 'x'));
    expect(JSON.stringify(d)).toBe(before);
  });

  it('rotating swaps the canvas sides', () => {
    const d = doc();
    applyOps(d, rotateCanvasOps(d, 1));
    expect([d.width, d.height]).toEqual([100, 200]);
    expect(findLayer(d, 'a')).toMatchObject({ x: 50, y: 100, rotation: 90 });
  });
});
