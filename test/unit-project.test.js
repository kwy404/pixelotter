import { describe, expect, it } from 'vitest';
import { applyOp, createDoc, makeLayer } from '../src/doc.js';
import { ProjectError, isProject, packProject, projectFileName, unpackProject } from '../src/project.js';
import { randomData } from './unit-helpers.js';

function project() {
  const doc = createDoc({ name: 'Trip', width: 640, height: 480, background: null });
  applyOp(doc, { t: 'add', layer: makeLayer('raster', { id: 'photo', asset: 'p1', w: 640, h: 480, x: 320, y: 240, mask: { asset: 'm1', feather: 4 } }) });
  applyOp(doc, { t: 'add', layer: makeLayer('text', { id: 'cap', text: 'Hello', font: 'Fraunces', outline: { width: 6, color: '#000000' }, curve: 40 }) });
  const assets = [
    { id: 'p1', w: 640, h: 480, mime: 'image/png', bytes: randomData(5000, 3) },
    { id: 'm1', w: 640, h: 480, mime: 'image/png', bytes: randomData(900, 4) },
    { id: 'unused', w: 1, h: 1, mime: 'image/png', bytes: randomData(10, 5) },
  ];
  return { doc, assets, thumbnail: { mime: 'image/jpeg', bytes: randomData(300, 6) } };
}

describe('the .pxo project format', () => {
  it('round trips the document, every layer and the assets', () => {
    const p = project();
    const bytes = packProject({ ...p, saved: 1700000000000 });
    expect(isProject(bytes)).toBe(true);
    const back = unpackProject(bytes);
    expect(back.doc).toEqual(p.doc);
    expect(back.assets.map((a) => a.id).sort()).toEqual(['m1', 'p1']);
    expect(Array.from(back.assets.find((a) => a.id === 'p1').bytes)).toEqual(Array.from(p.assets[0].bytes));
    expect(Array.from(back.thumbnail.bytes)).toEqual(Array.from(p.thumbnail.bytes));
    expect(back.saved).toBe(1700000000000);
    expect(back.doc.layers[1].curve).toBe(40);
  });

  it('starts with the magic bytes and a version', () => {
    const bytes = packProject(project());
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x50, 0x58, 0x4f, 1]);
    expect(isProject(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBe(false);
  });

  it('refuses a missing asset when saving', () => {
    const p = project();
    expect(() => packProject({ ...p, assets: p.assets.slice(1) })).toThrow(/missing/);
  });

  it('reports damage instead of opening broken layers', () => {
    const bytes = packProject(project());
    const flipped = bytes.slice();
    flipped[flipped.length - 400] ^= 0xff; // inside an asset
    expect(() => unpackProject(flipped)).toThrow(ProjectError);
    expect(() => unpackProject(flipped)).toThrow(/damaged/);
    expect(() => unpackProject(bytes.subarray(0, 50))).toThrow(/damaged|incomplete/);
    const newer = bytes.slice();
    newer[3] = 9;
    expect(() => unpackProject(newer)).toThrow(/newer/);
    expect(() => unpackProject(new TextEncoder().encode('PXO\u0001junkjunkjunk'))).toThrow(ProjectError);
  });

  it('makes safe file names', () => {
    expect(projectFileName('My: trip/2026?')).toBe('My trip 2026.pxo');
    expect(projectFileName('')).toBe('Untitled.pxo');
    expect(projectFileName('a.pxo')).toBe('a.pxo');
  });
});
