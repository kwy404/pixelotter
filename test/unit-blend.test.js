import { describe, expect, it } from 'vitest';
import { BLEND_GROUPS, BLEND_MODES, blendColor, canvasOp, compositeOver, flatten } from '../src/blend.js';

const px = (...c) => new Uint8ClampedArray(c);

describe('layer compositing on known pixels', () => {
  it('normal at full opacity replaces, at half opacity mixes', () => {
    expect(Array.from(compositeOver(px(0, 0, 255, 255), px(255, 0, 0, 255)))).toEqual([255, 0, 0, 255]);
    expect(Array.from(compositeOver(px(0, 0, 255, 255), px(255, 0, 0, 255), 'normal', 0.5))).toEqual([128, 0, 128, 255]);
  });

  it('source over transparency keeps the source color and alpha', () => {
    expect(Array.from(compositeOver(px(0, 0, 0, 0), px(10, 20, 30, 128)))).toEqual([10, 20, 30, 128]);
    // Blend modes need a backdrop: over transparency they act like normal.
    expect(Array.from(compositeOver(px(0, 0, 0, 0), px(10, 20, 30, 255), 'multiply'))).toEqual([10, 20, 30, 255]);
  });

  it('two half transparent layers', () => {
    const out = compositeOver(px(0, 0, 255, 128), px(255, 0, 0, 128));
    expect(out[3]).toBe(192);
    expect(out[0]).toBeGreaterThan(out[2]);
  });

  it('multiply, screen, darken, lighten, difference', () => {
    const b = px(200, 100, 50, 255);
    const s = [100, 200, 50, 255];
    expect(Array.from(compositeOver(b.slice(), px(...s), 'multiply'))).toEqual([78, 78, 10, 255]);
    expect(Array.from(compositeOver(b.slice(), px(...s), 'screen'))).toEqual([222, 222, 90, 255]);
    expect(Array.from(compositeOver(b.slice(), px(...s), 'darken'))).toEqual([100, 100, 50, 255]);
    expect(Array.from(compositeOver(b.slice(), px(...s), 'lighten'))).toEqual([200, 200, 50, 255]);
    expect(Array.from(compositeOver(b.slice(), px(...s), 'difference'))).toEqual([100, 100, 0, 255]);
  });

  it('overlay is hard light with the layers swapped', () => {
    const cb = [0.2, 0.7, 0.5];
    const cs = [0.9, 0.1, 0.5];
    const o = blendColor('overlay', cb, cs);
    const h = blendColor('hard-light', cs, cb);
    o.forEach((v, i) => expect(v).toBeCloseTo(h[i], 10));
  });

  it('luminosity keeps the backdrop color, color keeps the backdrop light', () => {
    const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
    const cb = [0.8, 0.2, 0.2];
    const cs = [0.1, 0.5, 0.9];
    expect(lum(blendColor('luminosity', cb, cs))).toBeCloseTo(lum(cs), 5);
    expect(lum(blendColor('color', cb, cs))).toBeCloseTo(lum(cb), 5);
    const gray = blendColor('saturation', cb, [0.5, 0.5, 0.5]);
    expect(gray[0]).toBeCloseTo(gray[1], 5);
  });

  it('a layer mask scales the source alpha', () => {
    const out = compositeOver(px(0, 0, 0, 255, 0, 0, 0, 255), px(255, 255, 255, 255, 255, 255, 255, 255), 'normal', 1, new Uint8Array([255, 0]));
    expect(Array.from(out)).toEqual([255, 255, 255, 255, 0, 0, 0, 255]);
  });

  it('flatten honors order, visibility and the background', () => {
    const red = px(255, 0, 0, 255);
    const blue = px(0, 0, 255, 255);
    expect(Array.from(flatten(1, 1, [{ data: red }, { data: blue }]))).toEqual([0, 0, 255, 255]);
    expect(Array.from(flatten(1, 1, [{ data: red }, { data: blue, visible: false }]))).toEqual([255, 0, 0, 255]);
    expect(Array.from(flatten(1, 1, [{ data: px(0, 0, 0, 0) }], [255, 255, 255]))).toEqual([255, 255, 255, 255]);
  });

  it('every mode maps to a canvas operation and appears in the menu groups', () => {
    for (const m of BLEND_MODES) expect(typeof canvasOp(m)).toBe('string');
    expect(canvasOp('normal')).toBe('source-over');
    expect(BLEND_GROUPS.flat().sort()).toEqual([...BLEND_MODES].sort());
  });
});
