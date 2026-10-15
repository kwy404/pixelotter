import { describe, expect, it } from 'vitest';
import { ancestors, applyOp, applyOps, assetIds, createDoc, findLayer, isLocked, isShown, layerTree, makeLayer, normalizeDoc, subtree } from '../src/doc.js';
import { UndoStack, compactSets } from '../src/history.js';
import { PixelStore, clipRect, patchOp, unionRect } from '../src/pixels.js';

const sample = () => {
  const doc = createDoc({ name: 'Test', width: 100, height: 80 });
  applyOp(doc, { t: 'add', layer: makeLayer('raster', { id: 'bg', asset: 'a1', w: 100, h: 80, x: 50, y: 40 }) });
  applyOp(doc, { t: 'add', layer: makeLayer('group', { id: 'g1', name: 'Group' }) });
  applyOp(doc, { t: 'add', layer: makeLayer('text', { id: 't1', text: 'Hi', parent: 'g1' }) });
  return doc;
};

describe('document operations', () => {
  it('creates documents with clamped sizes', () => {
    const d = createDoc({ width: 0, height: 99999 });
    expect(d.width).toBe(1);
    expect(d.height).toBe(12000);
    expect(d.layers).toEqual([]);
  });

  it('every operation has an inverse that restores the document', () => {
    const doc = sample();
    const before = JSON.stringify(doc);
    const ops = [
      { t: 'set', id: 'bg', props: { opacity: 0.4, blend: 'multiply', x: 10 } },
      { t: 'move', id: 'bg', index: 2 },
      { t: 'add', layer: makeLayer('shape', { id: 's1', shape: 'star' }), index: 0 },
      { t: 'remove', id: 'g1' },
      { t: 'doc', props: { width: 300, background: null } },
    ];
    const inverse = applyOps(doc, ops);
    expect(findLayer(doc, 'g1')).toBeNull();
    expect(findLayer(doc, 't1').parent).toBeNull();
    expect(doc.width).toBe(300);
    applyOps(doc, [...inverse].reverse());
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('rejects bad operations', () => {
    const doc = sample();
    expect(() => applyOp(doc, { t: 'set', id: 'nope', props: {} })).toThrow();
    expect(() => applyOp(doc, { t: 'add', layer: { type: 'nonsense' } })).toThrow();
    expect(() => applyOp(doc, { t: 'set', id: 'g1', props: { parent: 'g1' } })).toThrow();
    expect(() => applyOp(doc, { t: 'warp' })).toThrow();
    expect(() => applyOp(doc, { t: 'add', layer: makeLayer('text', { id: 't1' }) })).toThrow();
  });

  it('groups: tree, ancestors, visibility and locks', () => {
    const doc = sample();
    expect(layerTree(doc).map((n) => n.layer.id)).toEqual(['bg', 'g1']);
    expect(layerTree(doc)[1].children.map((n) => n.layer.id)).toEqual(['t1']);
    expect(ancestors(doc, 't1')).toEqual(['g1']);
    expect(subtree(doc, 'g1')).toEqual(['g1', 't1']);
    applyOp(doc, { t: 'set', id: 'g1', props: { visible: false, locked: true } });
    expect(isShown(doc, 't1')).toBe(false);
    expect(isLocked(doc, 't1')).toBe(true);
    expect(isShown(doc, 'bg')).toBe(true);
  });

  it('normalizes untrusted documents', () => {
    const doc = normalizeDoc({
      format: 'pixelotter',
      version: 1,
      width: 10,
      height: 10,
      layers: [
        { type: 'text', id: 'x', parent: 'missing', opacity: 9, blend: 'warp', size: -5 },
        { type: 'text', id: 'x' },
      ],
    });
    expect(doc.layers[0].parent).toBeNull();
    expect(doc.layers[0].opacity).toBe(1);
    expect(doc.layers[0].blend).toBe('normal');
    expect(doc.layers[0].size).toBe(4);
    expect(doc.layers[1].id).not.toBe('x');
    expect(() => normalizeDoc({ format: 'other' })).toThrow();
    expect(() => normalizeDoc({ format: 'pixelotter', version: 99 })).toThrow(/newer/);
  });

  it('lists assets of raster layers and masks', () => {
    const doc = sample();
    applyOp(doc, { t: 'set', id: 'bg', props: { mask: { asset: 'm1' } } });
    expect(assetIds(doc).sort()).toEqual(['a1', 'm1']);
  });
});

describe('pixel store', () => {
  it('patches return an inverse that restores the pixels', () => {
    const s = new PixelStore();
    s.apply({ t: 'asset', id: 'a', w: 4, h: 4, data: null });
    const red = new Uint8ClampedArray(2 * 2 * 4).fill(255);
    const inv = s.apply(patchOp('a', { x: 1, y: 1, w: 2, h: 2 }, red));
    expect(s.read('a', { x: 1, y: 1, w: 1, h: 1 })[0]).toBe(255);
    s.apply(inv);
    expect(Array.from(s.read('a')).every((v) => v === 0)).toBe(true);
    expect(() => s.apply(patchOp('a', { x: 3, y: 3, w: 2, h: 2 }, red))).toThrow();
  });

  it('replace can resize and undo', () => {
    const s = new PixelStore();
    s.apply({ t: 'asset', id: 'a', w: 2, h: 2, data: new Uint8ClampedArray(16).fill(9) });
    const inv = s.apply({ t: 'replace', id: 'a', w: 1, h: 1, data: new Uint8ClampedArray(4) });
    expect(s.size('a')).toEqual({ w: 1, h: 1 });
    s.apply(inv);
    expect(s.size('a')).toEqual({ w: 2, h: 2 });
    expect(s.read('a')[0]).toBe(9);
  });

  it('rect helpers', () => {
    expect(clipRect({ x: -5, y: 2, w: 10, h: 100 }, 8, 8)).toEqual({ x: 0, y: 2, w: 5, h: 6 });
    expect(clipRect({ x: 9, y: 0, w: 2, h: 2 }, 8, 8)).toBeNull();
    expect(unionRect({ x: 0, y: 0, w: 2, h: 2 }, { x: 5, y: 1, w: 1, h: 4 })).toEqual({ x: 0, y: 0, w: 6, h: 5 });
  });
});

describe('undo stack', () => {
  const doc0 = () => sample();

  it('undo and redo walk the entries, a new action drops the redo branch', () => {
    const doc = doc0();
    const h = new UndoStack();
    const act = (label, ops) => h.push({ label, ops, inverse: applyOps(doc, ops) });
    act('Fade', [{ t: 'set', id: 'bg', props: { opacity: 0.5 } }]);
    act('Hide', [{ t: 'set', id: 'bg', props: { visible: false } }]);
    expect(h.canUndo).toBe(true);
    applyOps(doc, h.undo().ops);
    expect(findLayer(doc, 'bg').visible).toBe(true);
    expect(findLayer(doc, 'bg').opacity).toBe(0.5);
    applyOps(doc, h.undo().ops);
    expect(findLayer(doc, 'bg').opacity).toBe(1);
    expect(h.undo()).toBeNull();
    applyOps(doc, h.redo().ops);
    expect(findLayer(doc, 'bg').opacity).toBe(0.5);
    act('Move', [{ t: 'set', id: 'bg', props: { x: 1 } }]);
    expect(h.canRedo).toBe(false);
    expect(h.entries.map((e) => e.label)).toEqual(['Fade', 'Move']);
  });

  it('has no step limit', () => {
    const doc = doc0();
    const h = new UndoStack();
    for (let i = 0; i < 5000; i++) h.push({ label: 'x', ops: [{ t: 'set', id: 'bg', props: { x: i } }], inverse: applyOps(doc, [{ t: 'set', id: 'bg', props: { x: i } }]) });
    expect(h.entries).toHaveLength(5000);
    applyOps(doc, h.goTo(0));
    expect(findLayer(doc, 'bg').x).toBe(50);
    applyOps(doc, h.goTo(1234));
    expect(findLayer(doc, 'bg').x).toBe(1233);
  });

  it('merges a slider drag into one entry', () => {
    let now = 0;
    const doc = doc0();
    const h = new UndoStack({ now: () => now });
    for (const v of [0.9, 0.7, 0.5, 0.2]) {
      const ops = [{ t: 'set', id: 'bg', props: { opacity: v } }];
      h.push({ label: 'Opacity', ops, inverse: applyOps(doc, ops), merge: 'opacity:bg' });
      now += 100;
    }
    expect(h.entries).toHaveLength(1);
    expect(h.entries[0].ops).toEqual([{ t: 'set', id: 'bg', props: { opacity: 0.2 } }]);
    applyOps(doc, h.undo().ops);
    expect(findLayer(doc, 'bg').opacity).toBe(1);
    now += 5000;
    const ops = [{ t: 'set', id: 'bg', props: { opacity: 0.3 } }];
    h.push({ label: 'Opacity', ops, inverse: applyOps(doc, ops), merge: 'opacity:bg' });
    expect(h.entries).toHaveLength(1);
  });

  it('undoes pixel edits through their stored rectangles', () => {
    const s = new PixelStore();
    s.apply({ t: 'asset', id: 'a', w: 3, h: 1, data: null });
    const h = new UndoStack();
    const op = patchOp('a', { x: 1, y: 0, w: 1, h: 1 }, new Uint8ClampedArray([1, 2, 3, 4]));
    h.push({ label: 'Brush', ops: [op], inverse: [s.apply(op)] });
    for (const o of h.undo().ops) s.apply(o);
    expect(Array.from(s.read('a'))).toEqual(new Array(12).fill(0));
    for (const o of h.redo().ops) s.apply(o);
    expect(Array.from(s.read('a', { x: 1, y: 0, w: 1, h: 1 }))).toEqual([1, 2, 3, 4]);
    expect(h.bytes).toBeGreaterThan(8);
  });

  it('tracks the saved state', () => {
    const h = new UndoStack();
    expect(h.dirty).toBe(false);
    h.push({ label: 'a', ops: [{ t: 'doc', props: {} }], inverse: [] });
    expect(h.dirty).toBe(true);
    h.markSaved();
    expect(h.dirty).toBe(false);
    h.undo();
    expect(h.dirty).toBe(true);
  });

  it('compacts consecutive sets', () => {
    const r = compactSets(
      [{ t: 'set', id: 'a', props: { x: 1 } }, { t: 'set', id: 'a', props: { x: 2, y: 3 } }],
      [{ t: 'set', id: 'a', props: { x: 0 } }, { t: 'set', id: 'a', props: { x: 1, y: 0 } }],
    );
    expect(r.ops).toEqual([{ t: 'set', id: 'a', props: { x: 2, y: 3 } }]);
    expect(r.inverse).toEqual([{ t: 'set', id: 'a', props: { x: 0, y: 0 } }]);
  });
});
