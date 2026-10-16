import { describe, expect, it } from 'vitest';
import { STYLE_DEFAULTS, hasStyles, normalizeStyles, renderStyles } from '../src/styles.js';
import { flatten, hitAnchor, inside, makePoint, normalizePath, polygonMask, svgPathData } from '../src/paths.js';
import { Stroke, brushTip, dabPositions, fillGradient } from '../src/brush.js';
import { applyOp, createDoc, makeLayer, normalizeDoc } from '../src/doc.js';
import { makeImage } from './unit-helpers.js';

const square = (w, h, x0, y0, x1, y1) => makeImage(w, h, (x, y) => (x >= x0 && x < x1 && y >= y0 && y < y1 ? [200, 100, 50, 255] : [0, 0, 0, 0]));

describe('layer styles', () => {
  it('normalizes and reports enabled styles', () => {
    expect(hasStyles(normalizeStyles({}))).toBe(false);
    const s = normalizeStyles({ stroke: { enabled: true, size: 9999, position: 'weird' } });
    expect(s.stroke.size).toBe(500);
    expect(s.stroke.position).toBe('outside');
    expect(hasStyles(s)).toBe(true);
  });

  it('an outside stroke rings the shape, a shadow is offset', () => {
    const img = square(30, 30, 10, 10, 20, 20);
    const styles = normalizeStyles({ stroke: { enabled: true, size: 3, color: '#ffffff' }, shadow: { enabled: true, distance: 6, size: 0, angle: 90 } });
    const { under, over } = renderStyles(img.data, 30, 30, styles);
    expect(over).toBeNull();
    const at = (x, y) => under[(y * 30 + x) * 4 + 3];
    expect(at(8, 15)).toBe(255); // stroke left of the shape
    expect(at(5, 15)).toBe(0);
    expect(at(15, 24)).toBeGreaterThan(0); // the shadow falls below
    expect(at(15, 4)).toBe(0);
  });

  it('inner glow, bevel and overlay draw over the layer inside its shape only', () => {
    const img = square(30, 30, 5, 5, 25, 25);
    const styles = normalizeStyles({ innerGlow: { enabled: true, size: 4 }, overlay: { enabled: true, color: '#0000ff', opacity: 1 }, bevel: { enabled: true, size: 4 } });
    const { over } = renderStyles(img.data, 30, 30, styles);
    expect(over[(2 * 30 + 2) * 4 + 3]).toBe(0);
    expect(over[(15 * 30 + 15) * 4 + 2]).toBeGreaterThan(200); // blue overlay in the middle
    expect(Object.keys(STYLE_DEFAULTS)).toHaveLength(6);
  });
});

describe('pen paths', () => {
  it('flattens straight and curved segments and rasterizes a closed path', () => {
    const tri = normalizePath({ closed: true, points: [makePoint(2, 2), makePoint(18, 2), makePoint(10, 18)] });
    const poly = flatten(tri);
    expect(poly[0]).toEqual([2, 2]);
    expect(inside(poly, 10, 8)).toBe(true);
    expect(inside(poly, 1, 17)).toBe(false);
    const m = polygonMask(poly, 20, 20);
    expect(m[8 * 20 + 10]).toBe(255);
    expect(m[18 * 20 + 1]).toBe(0);
    const curve = normalizePath({ points: [makePoint(0, 0, 10, -10), { x: 20, y: 0, ix: 10, iy: -10, ox: 20, oy: 0 }] });
    const pts = flatten(curve);
    expect(pts.length).toBeGreaterThan(3);
    expect(Math.min(...pts.map((p) => p[1]))).toBeLessThan(-5);
    expect(svgPathData(curve)).toMatch(/^M0 0C10 -10 10 -10 20 0$/);
    expect(hitAnchor(curve, 19, 1)).toBe(1);
  });
});

describe('painting engine', () => {
  it('brush tips are solid in the middle and soft at the edge', () => {
    const tip = brushTip(21, 0.5);
    expect(tip.data[10 * tip.size + 10]).toBe(1);
    expect(tip.data[10 * tip.size + 19]).toBeLessThan(0.5);
    expect(tip.data[0]).toBe(0);
  });

  it('a stroke edge falls off once, with no ring, wherever the dabs land', () => {
    for (const hardness of [0.7, 1]) {
      const region = { x: 0, y: 0, w: 60, h: 40 };
      const original = new Uint8ClampedArray(60 * 40 * 4);
      const s = new Stroke({ region, original, mode: 'paint', color: [0, 0, 0], tip: brushTip(16, hardness) });
      // a slanted line of dabs at sub pixel positions, 15% of the diameter apart
      for (let x = 8; x <= 52; x += 2.4) s.dab(x, 20.3 + (x - 8) * 0.07);
      for (const col of [15, 30, 45]) {
        const a = [];
        for (let y = 0; y < 40; y++) a.push(s.buf[(y * 60 + col) * 4 + 3]);
        const peak = a.indexOf(Math.max(...a));
        for (let y = 1; y <= peak; y++) expect(a[y]).toBeGreaterThanOrEqual(a[y - 1] - 1);
        for (let y = peak + 1; y < 40; y++) expect(a[y]).toBeLessThanOrEqual(a[y - 1] + 1);
        expect(a[peak]).toBe(255);
      }
    }
  });

  it('a hard tip anti aliases one pixel at its rim and the pencil does not', () => {
    const hard = brushTip(10, 1);
    const edge = hard.at(5, 0);
    expect(edge).toBeGreaterThan(0.4);
    expect(edge).toBeLessThan(0.6);
    expect(hard.at(3, 0)).toBe(1);
    expect(hard.at(6, 0)).toBe(0);
    const pencil = brushTip(4, 1, { aliased: true });
    expect([...pencil.data].every((v) => v === 0 || v === 1)).toBe(true);
  });

  it('dabs are spaced evenly across segments', () => {
    const a = dabPositions(0, 0, 10, 0, 4);
    expect(a.points.map((p) => p[0])).toEqual([0, 4, 8]);
    const b = dabPositions(10, 0, 20, 0, 4, a.carry);
    expect(b.points[0][0]).toBe(12);
  });

  it('opacity caps a stroke no matter how many dabs overlap', () => {
    const region = { x: 0, y: 0, w: 20, h: 20 };
    const original = makeImage(20, 20, [255, 255, 255, 255]).data;
    const s = new Stroke({ region, original, mode: 'paint', color: [0, 0, 0], opacity: 0.5, flow: 0.3, tip: brushTip(10, 1) });
    for (let i = 0; i < 30; i++) s.dab(10, 10);
    const v = s.buf[(10 * 20 + 10) * 4];
    expect(Math.abs(v - 128)).toBeLessThanOrEqual(1);
    const r = s.result();
    expect(r.rect.w).toBeGreaterThan(5);
    expect(r.before[0]).toBe(255);
  });

  it('erase lowers alpha, dodge lightens, burn darkens', () => {
    const region = { x: 0, y: 0, w: 10, h: 10 };
    const grey = makeImage(10, 10, [100, 100, 100, 255]).data;
    const er = new Stroke({ region, original: grey, mode: 'erase', tip: brushTip(4, 1) });
    er.dab(5, 5);
    expect(er.buf[(5 * 10 + 5) * 4 + 3]).toBe(0);
    const dodge = new Stroke({ region, original: grey, mode: 'dodge', tip: brushTip(4, 1), options: { exposure: 1 } });
    dodge.dab(5, 5);
    expect(dodge.buf[(5 * 10 + 5) * 4]).toBeGreaterThan(100);
    const burn = new Stroke({ region, original: grey, mode: 'burn', tip: brushTip(4, 1), options: { exposure: 1 } });
    burn.dab(5, 5);
    expect(burn.buf[(5 * 10 + 5) * 4]).toBeLessThan(100);
  });

  it('the clone stamp copies from its source offset and a selection limits painting', () => {
    const src = makeImage(10, 10, (x) => (x < 5 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
    const s = new Stroke({ region: { x: 0, y: 0, w: 10, h: 10 }, original: src.data, mode: 'clone', tip: brushTip(3, 1), options: { source: { ...src, dx: -5, dy: 0 } } });
    s.dab(7, 5);
    expect(s.buf[(5 * 10 + 7) * 4]).toBe(255);
    const sel = new Uint8Array(100);
    const p = new Stroke({ region: { x: 0, y: 0, w: 10, h: 10 }, original: src.data, mode: 'paint', color: [0, 255, 0], tip: brushTip(10, 1), selection: sel });
    p.dab(5, 5);
    expect(p.buf[(5 * 10 + 5) * 4 + 1]).toBe(0);
  });

  it('gradients run from the first color to the last', () => {
    const buf = new Uint8ClampedArray(10 * 1 * 4);
    fillGradient(buf, 10, 1, { x0: 0, y0: 0, x1: 10, y1: 0, stops: [{ at: 0, c: [0, 0, 0, 255] }, { at: 1, c: [255, 255, 255, 255] }] });
    expect(buf[0]).toBeLessThan(20);
    expect(buf[9 * 4]).toBeGreaterThan(235);
  });
});

describe('document extras', () => {
  it('keeps guides, frames, paths, mode, fill layers and adjustment filters', () => {
    const d = createDoc({ width: 100, height: 100 });
    applyOp(d, { t: 'doc', props: { guides: [{ axis: 'x', pos: 50 }, { axis: 'q', pos: 1 }], mode: 'cmyk', frames: [{ delay: 5, show: ['a'] }], paths: [{ name: 'Edge', points: [makePoint(1, 1)] }] } });
    expect(d.guides).toEqual([{ axis: 'x', pos: 50 }]);
    expect(d.mode).toBe('cmyk');
    expect(d.frames[0].delay).toBe(10);
    expect(d.paths[0].name).toBe('Edge');
    applyOp(d, { t: 'add', layer: makeLayer('fill', { id: 'f', fillType: 'gradient' }) });
    applyOp(d, { t: 'add', layer: makeLayer('adjust', { id: 'a', filter: 'curves', params: { curves: { rgb: [[0, 0], [128, 160], [255, 255]] } } }) });
    const back = normalizeDoc(JSON.parse(JSON.stringify(d)));
    expect(back.layers[0].gradient.stops).toHaveLength(2);
    expect(back.layers[1].params.curves.rgb[1]).toEqual([128, 160]);
    expect(back.paths[0].points).toHaveLength(1);
  });
});
