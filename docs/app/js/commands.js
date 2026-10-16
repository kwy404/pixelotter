// Every menu item and keyboard shortcut is a command here. Menus (File, Edit, Image, Layer,
// Select, Filter, View, Window, Help) are built from MENUS; shortcuts are shown next to each
// item and handled in one place. Commands that need input open a dialog through `ui`.

import { makeLayer, newId, findLayer, subtree, indexOf, isLocked } from '../lib/doc.js';
import { patchOp } from '../lib/pixels.js';
import { canvasSizeOps, cropOps, flipCanvasOps, imageSizeOps, rotateCanvasOps, layerMatrix, invert, apply, corners, boundsOf } from '../lib/geometry.js';
import { FILTERS, FILTER_GROUPS, getFilter, runFilter, defaults as filterDefaults } from '../lib/filters/registry.js';
import { autoEnhance } from '../lib/filters/adjust.js';
import { maskBounds, invertMask } from '../lib/mask.js';
import { flatten as flatPath, polygonMask } from '../lib/paths.js';
import { makeCanvas } from './engine/assets.js';
import { definePattern } from './engine/patterns.js';

const isMac = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '');
export const MOD = isMac ? 'Cmd' : 'Ctrl';

/** Readable shortcut text for menus: "Ctrl+Shift+S" style, with the platform modifier. */
export const keyLabel = (k) => (k ? k.replace('Mod', MOD).replace('Alt', isMac ? 'Option' : 'Alt') : '');

export class Commands {
  constructor(app, ui) {
    this.app = app;
    this.ui = ui;
    this.list = new Map();
    this.lastFilter = null;
    this.recorder = null;
    define(this);
  }

  add(id, run, { key = null, enabled = null, label = null } = {}) {
    this.list.set(id, { id, run, key, enabled, label });
  }

  can(id) {
    const c = this.list.get(id);
    if (!c) return false;
    try {
      return c.enabled ? !!c.enabled(this.app) : true;
    } catch {
      return false;
    }
  }

  async run(id, ...args) {
    const c = this.list.get(id);
    if (!c) return undefined;
    if (!this.can(id)) return undefined;
    // Actions panel recording: commands with their arguments
    if (this.recorder && !['action.record', 'action.stop', 'action.play'].includes(id) && !id.startsWith('view.') && !id.startsWith('window.') && !id.startsWith('help.')) this.recorder(id, args);
    try {
      return await c.run(this.app, ...args);
    } catch (err) {
      console.warn(err);
      this.app.toast(String(err?.message ?? err), 'danger');
      return undefined;
    }
  }

  /** Finds the command for a keyboard event. */
  match(e) {
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('Mod');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    let k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    if (e.code?.startsWith('Digit')) k = e.code.slice(5);
    if (k === '+' || k === '=') k = '=';
    if (k === '_') k = '-';
    if (k === '{') k = '[';
    if (k === '}') k = ']';
    if (k === '"') k = "'";
    if (k === ':') k = ';';
    const combo = [...parts, k].join('+');
    // several commands may share a key (Duplicate and Layer via Copy): the first enabled one wins
    let first = null;
    for (const c of this.list.values()) {
      if (!c.key || !c.key.split(' | ').includes(combo)) continue;
      if (this.can(c.id)) return c.id;
      first ??= c.id;
    }
    return first;
  }
}

// ---------- helpers ----------

const doc = (app) => app.edoc.doc;
const active = (app) => app.edoc?.activeLayer ?? null;
const hasDoc = (app) => !!app.edoc;
const hasLayer = (app) => !!active(app);
const isRaster = (app) => active(app)?.type === 'raster';
const hasSel = (app) => hasDoc(app) && !app.edoc.selection.empty;
const editable = (app) => hasLayer(app) && !isLocked(doc(app), active(app).id);

function copyAssetOps(app, assetId) {
  const a = app.edoc.assets.get(assetId);
  const id = newId('a');
  return { id, op: { t: 'asset', id, w: a.w, h: a.h, data: app.edoc.assets.read(assetId) } };
}

/** Renders one layer (or a list) into document sized pixels. */
function renderLayers(app, layers, scale = 1) {
  const d = doc(app);
  const c = makeCanvas(Math.round(d.width * scale), Math.round(d.height * scale));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const r = app.renderer;
  for (const l of layers) {
    if (!l.visible) continue;
    const tmp = makeCanvas(c.width, c.height);
    const tctx = tmp.getContext('2d');
    r.drawContent(tctx, l, scale, l.fill);
    const m = r.maskCanvas(l, scale, c.width, c.height);
    if (m) {
      tctx.globalCompositeOperation = 'destination-in';
      tctx.drawImage(m, 0, 0);
    }
    ctx.globalAlpha = l.opacity;
    ctx.globalCompositeOperation = l.blend === 'normal' ? 'source-over' : l.blend;
    ctx.drawImage(tmp, 0, 0);
  }
  return { canvas: c, data: ctx.getImageData(0, 0, c.width, c.height).data };
}

/** A new raster layer from document sized pixels. Returns the ops and the new layer id. */
function rasterFromPixels(app, data, w, h, props = {}) {
  const asset = newId('a');
  const id = newId();
  return {
    id,
    ops: [
      { t: 'asset', id: asset, w, h, data },
      { t: 'add', layer: makeLayer('raster', { id, asset, w, h, x: w / 2, y: h / 2, ...props }), index: props.index ?? app.insertIndex() },
    ],
  };
}

function selectionCanvasLayerPixels(app, l) {
  // the selection inside the layer's own pixels
  const target = { layer: l, size: { w: l.w, h: l.h }, mask: false };
  return app.selectionInLayer(target, { x: 0, y: 0, w: l.w, h: l.h });
}

/** Applies a filter to the active raster layer (inside the selection when there is one). */
export function filterLayerOps(app, id, params) {
  const l = active(app);
  const edoc = app.edoc;
  const target = app.maskEdit && l.mask ? { asset: l.mask.asset, w: edoc.assets.get(l.mask.asset).w, h: edoc.assets.get(l.mask.asset).h } : { asset: l.asset, w: l.w, h: l.h };
  const before = edoc.assets.read(target.asset);
  const out = runFilter(id, { data: before, width: target.w, height: target.h }, params);
  let result = out.data;
  if (!edoc.selection.empty) {
    const sel = app.selectionInLayer({ layer: l, size: { w: l.w, h: l.h }, mask: app.maskEdit, asset: target.asset }, { x: 0, y: 0, w: target.w, h: target.h });
    result = new Uint8ClampedArray(before);
    for (let i = 0; i < sel.length; i++) {
      const a = sel[i] / 255;
      if (!a) continue;
      for (let c = 0; c < 4; c++) result[i * 4 + c] = before[i * 4 + c] * (1 - a) + out.data[i * 4 + c] * a;
    }
  }
  return [patchOp(target.asset, { x: 0, y: 0, w: target.w, h: target.h }, result)];
}

export const ADJUSTMENT_IDS = FILTERS.filter((f) => f.group === 'adjust' && f.id !== 'tone' && f.id !== 'look' && f.id !== 'auto').map((f) => f.id);

function define(C) {
  const { ui } = C;
  const add = (id, run, opts) => C.add(id, run, opts);

  // ---------- File ----------
  add('file.new', () => ui.newDocument(), { key: 'Mod+N' });
  add('file.open', () => ui.open(), { key: 'Mod+O' });
  add('file.place', () => ui.place(), { key: 'Mod+Shift+P', enabled: hasDoc });
  add('file.close', (app) => ui.closeDoc(app.edoc), { key: 'Mod+W', enabled: hasDoc });
  add('file.closeAll', async (app) => {
    for (const d of [...app.docs]) if (!(await ui.closeDoc(d))) return;
  }, { key: 'Mod+Alt+W', enabled: hasDoc });
  add('file.save', (app) => ui.save(app.edoc), { key: 'Mod+S', enabled: hasDoc });
  add('file.saveAs', (app) => ui.save(app.edoc, true), { key: 'Mod+Shift+S', enabled: hasDoc });
  add('file.export', () => ui.exportDialog(), { key: 'Mod+Alt+Shift+W | Mod+Shift+E', enabled: hasDoc });
  add('file.quickExport', () => ui.quickExport(), { key: "Mod+Shift+'", enabled: hasDoc });
  add('file.revert', (app) => ui.revert(app.edoc), { key: 'F12', enabled: (app) => hasDoc(app) && !!app.edoc.file?.saved });
  add('file.send', () => ui.sendDialog(), { enabled: hasDoc });
  add('file.share', () => ui.liveDialog(), { enabled: hasDoc });
  add('file.join', () => ui.joinDialog());
  add('file.sticker', () => ui.stickerDialog(), { enabled: hasDoc });

  // ---------- Edit ----------
  add('edit.undo', (app) => app.edoc.undo(), { key: 'Mod+Z', enabled: (app) => app.edoc?.history.canUndo });
  add('edit.redo', (app) => app.edoc.redo(), { key: 'Mod+Shift+Z', enabled: (app) => app.edoc?.history.canRedo });
  add('edit.cut', async (app) => {
    await C.run('edit.copy');
    await C.run('edit.clear');
  }, { key: 'Mod+X', enabled: (app) => hasSel(app) && isRaster(app) });
  add('edit.copy', (app) => ui.copy(false), { key: 'Mod+C', enabled: hasLayer });
  add('edit.copyMerged', (app) => ui.copy(true), { key: 'Mod+Shift+C', enabled: hasDoc });
  add('edit.paste', () => ui.paste(), { key: 'Mod+V' });
  add('edit.clear', (app) => {
    const l = active(app);
    const sel = selectionCanvasLayerPixels(app, l);
    const target = app.maskEdit && l.mask ? l.mask.asset : l.asset;
    const before = app.edoc.assets.read(target);
    const out = new Uint8ClampedArray(before);
    for (let i = 0; i < sel.length; i++) out[i * 4 + 3] = app.maskEdit ? Math.round(out[i * 4 + 3] * (1 - sel[i] / 255)) : Math.round(out[i * 4 + 3] * (1 - sel[i] / 255));
    app.edoc.commit(app.t('history.clear'), [patchOp(target, { x: 0, y: 0, w: l.w, h: l.h }, out)], { icon: 'eraser' });
  }, { key: 'Delete | Backspace', enabled: (app) => hasSel(app) && isRaster(app) && editable(app) });
  add('edit.fill', () => ui.fillDialog(), { key: 'Shift+F5', enabled: hasDoc });
  add('edit.stroke', () => ui.strokeDialog(), { enabled: hasSel });
  add('edit.contentAware', () => ui.contentAwareDialog(), { enabled: (app) => hasSel(app) && isRaster(app) });
  add('edit.freeTransform', (app) => {
    app.setTool('move');
    app.S.options.move.showTransform = true;
  }, { key: 'Mod+T', enabled: hasLayer });
  add('edit.rotate90', (app) => transformLayer(app, { rotate: 90 }), { enabled: editable });
  add('edit.rotate-90', (app) => transformLayer(app, { rotate: -90 }), { enabled: editable });
  add('edit.rotate180', (app) => transformLayer(app, { rotate: 180 }), { enabled: editable });
  add('edit.flipH', (app) => transformLayer(app, { flipX: true }), { enabled: editable });
  add('edit.flipV', (app) => transformLayer(app, { flipY: true }), { enabled: editable });
  add('edit.definePattern', (app) => {
    const b = app.edoc.selection.bounds() ?? { x: 0, y: 0, w: doc(app).width, h: doc(app).height };
    const full = app.renderer.render({ scale: 1 });
    const c = makeCanvas(Math.max(1, b.w), Math.max(1, b.h));
    c.getContext('2d').drawImage(full, -b.x, -b.y);
    const id = `custom-${Date.now().toString(36)}`;
    definePattern(id, c);
    app.S.patterns = [...app.S.patterns, id];
    app.toast(app.t('toast.patternDefined'));
  }, { enabled: hasDoc });
  add('edit.settings', () => ui.settingsDialog(), { key: 'Mod+K' });
  add('edit.shortcuts', () => ui.shortcutsDialog(), { key: 'Mod+/' });

  // ---------- Image ----------
  for (const mode of ['rgb', 'gray', 'cmyk']) add(`image.mode.${mode}`, (app) => ui.setMode(mode), { enabled: (app) => hasDoc(app) && doc(app).mode !== mode });
  for (const id of ADJUSTMENT_IDS) add(`adjust.${id}`, () => ui.filterDialog(id, { destructive: true }), { enabled: (app) => isRaster(app) && editable(app) });
  add('image.autoTone', (app) => {
    const l = active(app);
    const img = { data: app.edoc.assets.read(l.asset), width: l.w, height: l.h };
    const p = autoEnhance(img);
    const next = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, Math.max(-100, Math.min(100, (l.adjust?.[k] ?? 0) + v))]));
    app.edoc.commit(app.t('history.autoTone'), [{ t: 'set', id: l.id, props: { adjust: next } }], { icon: 'sparkle' });
  }, { key: 'Mod+Shift+L', enabled: isRaster });
  add('image.imageSize', () => ui.imageSizeDialog(), { key: 'Mod+Alt+I', enabled: hasDoc });
  add('image.canvasSize', () => ui.canvasSizeDialog(), { key: 'Mod+Alt+C', enabled: hasDoc });
  add('image.rotateCW', (app) => app.edoc.commit(app.t('history.rotateCanvas'), rotateCanvasOps(doc(app), 1)), { enabled: hasDoc });
  add('image.rotateCCW', (app) => app.edoc.commit(app.t('history.rotateCanvas'), rotateCanvasOps(doc(app), -1)), { enabled: hasDoc });
  add('image.rotate180', (app) => {
    const a = rotateCanvasOps(doc(app), 1);
    const temp = JSON.parse(JSON.stringify(doc(app)));
    for (const op of a) if (op.t === 'doc') Object.assign(temp, op.props);
    else Object.assign(temp.layers.find((l) => l.id === op.id), op.props);
    const b = rotateCanvasOps(temp, 1);
    app.edoc.commit(app.t('history.rotateCanvas'), [...a, ...b]);
  }, { enabled: hasDoc });
  add('image.flipH', (app) => app.edoc.commit(app.t('history.flipCanvas'), flipCanvasOps(doc(app), 'x')), { enabled: hasDoc });
  add('image.flipV', (app) => app.edoc.commit(app.t('history.flipCanvas'), flipCanvasOps(doc(app), 'y')), { enabled: hasDoc });
  add('image.cropToSelection', (app) => app.edoc.commit(app.t('history.crop'), [...cropOps(doc(app), app.edoc.selection.bounds()), { t: 'sel', data: null }]), { enabled: hasSel });
  add('image.trim', (app) => {
    const { data } = renderLayers(app, doc(app).layers);
    const d = doc(app);
    const alpha = new Uint8Array(d.width * d.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
    const b = maskBounds(alpha, d.width, d.height, 1);
    if (!b) return;
    app.edoc.commit(app.t('history.trim'), cropOps(d, b));
  }, { enabled: hasDoc });
  add('image.duplicate', (app) => ui.duplicateDocument(app.edoc), { enabled: hasDoc });

  // ---------- Layer ----------
  add('layer.new', (app) => {
    const d = doc(app);
    const { ops, id } = rasterFromPixels(app, null, d.width, d.height, { name: `${app.t('layer.layer')} ${d.layers.length + 1}` });
    app.edoc.commit(app.t('history.newLayer'), ops, { icon: 'layers' });
    app.selectLayer(id);
  }, { key: 'Mod+Shift+N', enabled: hasDoc });
  add('layer.newGroup', (app) => {
    const l = active(app);
    const id = newId();
    const ops = [{ t: 'add', layer: makeLayer('group', { id, name: `${app.t('layer.group')} ${doc(app).layers.filter((x) => x.type === 'group').length + 1}`, parent: l?.parent ?? null }), index: app.insertIndex() }];
    if (l) ops.push({ t: 'set', id: l.id, props: { parent: id } }, { t: 'move', id: l.id, index: indexOf(doc(app), l.id) });
    app.edoc.commit(app.t('history.group'), ops, { icon: 'folder' });
    app.selectLayer(id);
  }, { key: 'Mod+G', enabled: hasDoc });
  add('layer.ungroup', (app) => {
    const g = active(app);
    const kids = doc(app).layers.filter((x) => x.parent === g.id);
    app.edoc.commit(app.t('history.ungroup'), [...kids.map((k) => ({ t: 'set', id: k.id, props: { parent: g.parent } })), { t: 'remove', id: g.id }], { icon: 'folder' });
    if (kids.length) app.selectLayer(kids.at(-1).id);
  }, { key: 'Mod+Shift+G', enabled: (app) => active(app)?.type === 'group' });
  add('layer.duplicate', (app) => {
    const l = active(app);
    const ids = subtree(doc(app), l.id);
    const map = new Map(ids.map((id) => [id, newId()]));
    const ops = [];
    let index = indexOf(doc(app), l.id) + 1;
    for (const id of ids) {
      const src = findLayer(doc(app), id);
      const copy = JSON.parse(JSON.stringify(src));
      copy.id = map.get(id);
      copy.name = id === l.id ? `${src.name} ${app.t('layer.copy')}` : src.name;
      if (map.has(copy.parent)) copy.parent = map.get(copy.parent);
      if (src.asset) {
        const a = copyAssetOps(app, src.asset);
        ops.push(a.op);
        copy.asset = a.id;
      }
      if (src.mask) {
        const a = copyAssetOps(app, src.mask.asset);
        ops.push(a.op);
        copy.mask = { ...copy.mask, asset: a.id };
      }
      ops.push({ t: 'add', layer: copy, index: index++ });
    }
    // with a selection, Duplicate makes a layer from the selected pixels instead
    app.edoc.commit(app.t('history.duplicate'), ops, { icon: 'duplicate' });
    app.selectLayer(map.get(l.id));
  }, { key: 'Mod+J', enabled: (app) => hasLayer(app) && !(hasSel(app) && isRaster(app)) });
  add('layer.viaCopy', (app) => layerFromSelection(app, false), { key: 'Mod+J', enabled: (app) => hasSel(app) && isRaster(app) });
  add('layer.viaCut', (app) => layerFromSelection(app, true), { key: 'Mod+Shift+J', enabled: (app) => hasSel(app) && isRaster(app) && editable(app) });
  add('layer.delete', (app) => {
    const l = active(app);
    const ids = subtree(doc(app), l.id).reverse();
    app.edoc.commit(app.t('history.deleteLayer'), ids.map((id) => ({ t: 'remove', id })), { icon: 'trash' });
  }, { enabled: (app) => hasLayer(app) && editable(app) });
  add('layer.rename', () => ui.renameLayer(), { enabled: hasLayer });
  add('layer.rasterize', (app) => {
    const l = active(app);
    const d = doc(app);
    const { data } = renderLayers(app, [{ ...l, visible: true, opacity: 1, blend: 'normal', mask: null, fill: 1 }]);
    const { ops, id } = rasterFromPixels(app, data, d.width, d.height, { name: l.name, opacity: l.opacity, blend: l.blend, visible: l.visible, parent: l.parent, index: indexOf(d, l.id), mask: l.mask, styles: l.styles, clip: l.clip });
    app.edoc.commit(app.t('history.rasterize'), [{ t: 'remove', id: l.id }, ...ops], { icon: 'image' });
    app.selectLayer(id);
  }, { enabled: (app) => ['text', 'shape', 'fill'].includes(active(app)?.type) });
  add('layer.mergeDown', (app) => {
    const d = doc(app);
    const l = active(app);
    const i = indexOf(d, l.id);
    const below = d.layers.slice(0, i).reverse().find((x) => x.parent === l.parent && x.type !== 'group');
    if (!below) return;
    const { data } = renderLayers(app, [below, l]);
    const { ops, id } = rasterFromPixels(app, data, d.width, d.height, { name: below.name, parent: below.parent, index: indexOf(d, below.id) });
    app.edoc.commit(app.t('history.merge'), [{ t: 'remove', id: l.id }, { t: 'remove', id: below.id }, ...ops], { icon: 'layers' });
    app.selectLayer(id);
  }, { key: 'Mod+E', enabled: (app) => hasLayer(app) && active(app).type !== 'group' });
  add('layer.mergeVisible', (app) => mergeAll(app, true), { key: 'Mod+Shift+E', enabled: hasDoc });
  add('layer.flatten', (app) => mergeAll(app, false), { enabled: hasDoc });
  add('layer.hide', (app) => {
    const l = active(app);
    app.edoc.commit(l.visible ? app.t('history.hide') : app.t('history.show'), [{ t: 'set', id: l.id, props: { visible: !l.visible } }], { icon: 'eye' });
  }, { key: 'Mod+,', enabled: hasLayer });
  add('layer.lock', (app) => {
    const l = active(app);
    app.edoc.commit(app.t('history.lock'), [{ t: 'set', id: l.id, props: { locked: !l.locked } }], { icon: 'lock' });
  }, { enabled: hasLayer });
  add('layer.clip', (app) => {
    const l = active(app);
    app.edoc.commit(app.t('history.clip'), [{ t: 'set', id: l.id, props: { clip: !l.clip } }], { icon: 'link' });
  }, { key: 'Mod+Alt+G', enabled: hasLayer });
  const arrange = (app, where) => {
    const d = doc(app);
    const l = active(app);
    // siblings in stacking order (the array order among layers with the same parent)
    const siblings = d.layers.filter((x) => x.parent === l.parent);
    const pos = siblings.findIndex((x) => x.id === l.id);
    const target = where === 'up' ? siblings[pos + 1] : where === 'down' ? siblings[pos - 1] : where === 'top' ? siblings.at(-1) : siblings[0];
    if (!target || target.id === l.id) return;
    // a move removes the layer first, then inserts it: this index lands just above or below the target
    const index = indexOf(d, target.id);
    app.edoc.commit(app.t('history.arrange'), [{ t: 'move', id: l.id, index }], { icon: 'layers' });
  };
  add('layer.forward', (app) => arrange(app, 'up'), { key: 'Mod+]', enabled: hasLayer });
  add('layer.backward', (app) => arrange(app, 'down'), { key: 'Mod+[', enabled: hasLayer });
  add('layer.front', (app) => arrange(app, 'top'), { key: 'Mod+Shift+]', enabled: hasLayer });
  add('layer.back', (app) => arrange(app, 'bottom'), { key: 'Mod+Shift+[', enabled: hasLayer });
  add('layer.addMask', (app, from = 'auto') => {
    const l = active(app);
    const d = doc(app);
    const local = l.type === 'raster';
    const w = local ? l.w : d.width;
    const h = local ? l.h : d.height;
    const data = new Uint8ClampedArray(w * h * 4);
    let plane = null;
    if ((from === 'auto' || from === 'selection') && !app.edoc.selection.empty) plane = local ? selectionCanvasLayerPixels(app, l) : app.edoc.selection.mask;
    if (from === 'hide') plane = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 255;
      data[i * 4 + 3] = plane ? plane[i] : 255;
    }
    const asset = newId('a');
    app.edoc.commit(app.t('history.addMask'), [{ t: 'asset', id: asset, w, h, data }, { t: 'set', id: l.id, props: { mask: { asset, enabled: true, feather: 0 } } }, ...(plane && from !== 'hide' ? [{ t: 'sel', data: null }] : [])], { icon: 'mask' });
    app.maskEdit = true;
    app.syncLayers();
  }, { enabled: (app) => hasLayer(app) && !active(app).mask });
  add('layer.deleteMask', (app) => app.edoc.commit(app.t('history.deleteMask'), [{ t: 'set', id: active(app).id, props: { mask: null } }], { icon: 'mask' }), { enabled: (app) => !!active(app)?.mask });
  add('layer.toggleMask', (app) => {
    const l = active(app);
    app.edoc.commit(app.t('history.toggleMask'), [{ t: 'set', id: l.id, props: { mask: { ...l.mask, enabled: !l.mask.enabled } } }], { icon: 'mask' });
  }, { enabled: (app) => !!active(app)?.mask });
  add('layer.invertMask', (app) => {
    const l = active(app);
    const a = app.edoc.assets.get(l.mask.asset);
    const data = app.edoc.assets.read(l.mask.asset);
    const out = new Uint8ClampedArray(data);
    for (let i = 3; i < out.length; i += 4) out[i] = 255 - out[i];
    app.edoc.commit(app.t('history.invertMask'), [patchOp(l.mask.asset, { x: 0, y: 0, w: a.w, h: a.h }, out)], { icon: 'mask' });
  }, { key: 'Mod+I', enabled: (app) => !!active(app)?.mask && app.maskEdit });
  add('layer.applyMask', (app) => {
    const l = active(app);
    const data = app.edoc.assets.read(l.asset);
    const m = app.edoc.assets.read(l.mask.asset);
    const out = new Uint8ClampedArray(data);
    for (let i = 3; i < out.length; i += 4) out[i] = Math.round((out[i] * m[i]) / 255);
    app.edoc.commit(app.t('history.applyMask'), [patchOp(l.asset, { x: 0, y: 0, w: l.w, h: l.h }, out), { t: 'set', id: l.id, props: { mask: null } }], { icon: 'mask' });
  }, { enabled: (app) => isRaster(app) && !!active(app)?.mask && active(app).mask.space === 'layer' });
  add('layer.editMask', (app) => {
    app.maskEdit = !app.maskEdit;
    app.syncLayers();
  }, { key: '\\', enabled: (app) => !!active(app)?.mask });
  add('layer.newAdjustment', (app, filter = 'curves') => {
    const id = newId();
    const f = getFilter(filter);
    const layer = makeLayer('adjust', { id, name: app.t(`filter.${filter}`) || f.label, filter, params: filterDefaults(filter), parent: active(app)?.parent ?? null });
    app.edoc.commit(app.t('history.newAdjustment'), [{ t: 'add', layer, index: app.insertIndex() }], { icon: 'adjust-layer' });
    app.selectLayer(id);
    ui.openPanel?.('properties');
  }, { enabled: hasDoc });
  add('layer.newFill', (app, fillType = 'solid') => {
    const id = newId();
    const layer = makeLayer('fill', { id, name: app.t(`fill.${fillType}`), fillType, color: app.fg, gradient: { type: 'linear', angle: 90, stops: [{ at: 0, color: app.fg }, { at: 1, color: app.bg }] }, parent: active(app)?.parent ?? null });
    app.edoc.commit(app.t('history.newFill'), [{ t: 'add', layer, index: app.insertIndex() }], { icon: 'bucket' });
    app.selectLayer(id);
    ui.openPanel?.('properties');
  }, { enabled: hasDoc });
  add('layer.style', () => ui.layerStyleDialog(), { enabled: (app) => hasLayer(app) && !['group', 'adjust'].includes(active(app).type) });
  add('layer.removeBackground', () => ui.removeBackground(), { enabled: isRaster });
  add('layer.fromBackground', (app) => ui.newLayerFromImage?.(app), { enabled: hasDoc });

  // ---------- Select ----------
  const sel = (app) => app.edoc.selection;
  add('select.all', (app) => app.edoc.commit(app.t('history.selectAll'), [{ t: 'sel', data: sel(app).all() }], { icon: 'marquee' }), { key: 'Mod+A', enabled: hasDoc });
  add('select.none', (app) => {
    app.lastSelection = sel(app).mask;
    app.edoc.commit(app.t('history.deselect'), [{ t: 'sel', data: null }], { icon: 'marquee' });
  }, { key: 'Mod+D', enabled: hasSel });
  add('select.reselect', (app) => app.edoc.commit(app.t('history.reselect'), [{ t: 'sel', data: app.lastSelection }], { icon: 'marquee' }), { key: 'Mod+Shift+D', enabled: (app) => hasDoc(app) && !!app.lastSelection });
  add('select.inverse', (app) => app.edoc.commit(app.t('history.inverse'), [{ t: 'sel', data: sel(app).inverse() }], { icon: 'marquee' }), { key: 'Mod+Shift+I', enabled: hasDoc });
  add('select.subject', () => ui.selectSubject(), { enabled: hasDoc });
  add('select.colorRange', () => ui.colorRangeDialog(), { enabled: hasDoc });
  add('select.refine', () => ui.refineDialog(), { key: 'Mod+Alt+R', enabled: hasSel });
  add('select.feather', () => ui.modifySelection('feather'), { key: 'Shift+F6', enabled: hasSel });
  add('select.expand', () => ui.modifySelection('expand'), { enabled: hasSel });
  add('select.contract', () => ui.modifySelection('contract'), { enabled: hasSel });
  add('select.fromLayer', (app) => {
    const l = active(app);
    const { data } = renderLayers(app, [{ ...l, visible: true, opacity: 1, blend: 'normal' }]);
    const d = doc(app);
    const m = new Uint8Array(d.width * d.height);
    for (let i = 0; i < m.length; i++) m[i] = data[i * 4 + 3];
    app.edoc.commit(app.t('history.selectLayer'), [{ t: 'sel', data: m }], { icon: 'marquee' });
  }, { enabled: hasLayer });
  add('select.fromPath', (app) => {
    const p = doc(app).paths.find((x) => x.id === app.activePath) ?? doc(app).paths.at(-1);
    if (!p) return;
    const d = doc(app);
    app.edoc.commit(app.t('history.pathSelection'), [{ t: 'sel', data: polygonMask(flatPath({ ...p, closed: true }), d.width, d.height) }], { icon: 'pen' });
  }, { key: 'Mod+Enter', enabled: (app) => hasDoc(app) && doc(app).paths.length > 0 });
  add('select.toMask', (app) => C.run('layer.addMask', 'selection'), { enabled: (app) => hasSel(app) && hasLayer(app) && !active(app).mask });

  // ---------- Filter ----------
  add('filter.last', (app) => C.lastFilter && ui.filterDialog(C.lastFilter.id, { params: C.lastFilter.params, instant: true }), { key: 'Mod+Alt+F', enabled: (app) => isRaster(app) && !!C.lastFilter });
  for (const f of FILTERS.filter((x) => FILTER_GROUPS.includes(x.group))) add(`filter.${f.id}`, () => ui.filterDialog(f.id), { enabled: (app) => isRaster(app) && editable(app) });
  add('filter.liquify', () => ui.liquifyDialog(), { key: 'Mod+Shift+X', enabled: (app) => isRaster(app) && editable(app) });

  // ---------- View ----------
  add('view.zoomIn', (app) => app.vp.zoomStep(1, { x: app.vp.w / 2, y: app.vp.h / 2 }), { key: 'Mod+=', enabled: hasDoc });
  add('view.zoomOut', (app) => app.vp.zoomStep(-1, { x: app.vp.w / 2, y: app.vp.h / 2 }), { key: 'Mod+-', enabled: hasDoc });
  add('view.fit', (app) => app.vp.fit(), { key: 'Mod+0', enabled: hasDoc });
  add('view.actual', (app) => app.vp.setZoom(1), { key: 'Mod+1', enabled: hasDoc });
  add('view.rulers', (app) => toggleView(app, 'rulers'), { key: 'Mod+R' });
  add('view.grid', (app) => toggleView(app, 'grid'), { key: "Mod+'" });
  add('view.guides', (app) => toggleView(app, 'guides'), { key: 'Mod+;' });
  add('view.snap', (app) => toggleView(app, 'snap'), { key: 'Mod+Shift+;' });
  add('view.newGuide', () => ui.newGuideDialog(), { enabled: hasDoc });
  add('view.clearGuides', (app) => app.edoc.commit(app.t('history.clearGuides'), [{ t: 'doc', props: { guides: [] } }]), { enabled: (app) => hasDoc(app) && doc(app).guides.length > 0 });
  add('view.proof', (app) => {
    app.S.view.proof = !app.S.view.proof;
    app.renderer.forceProof = app.S.view.proof;
    app.vp.invalidate();
  }, { key: 'Mod+Y', enabled: hasDoc });
  add('view.gamut', (app) => {
    app.S.view.gamut = !app.S.view.gamut;
    app.vp.gamut = app.S.view.gamut;
    app.vp.requestDraw();
  }, { key: 'Mod+Shift+Y', enabled: hasDoc });
  add('view.fullscreen', () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()), { key: 'F' });

  // ---------- Window ----------
  for (const p of ['layers', 'properties', 'adjustments', 'history', 'color', 'swatches', 'paths', 'actions', 'timeline', 'live', 'info']) add(`window.${p}`, () => ui.togglePanel(p), { key: { layers: 'F7', color: 'F6', info: 'F8' }[p] ?? null });
  add('window.pro', () => ui.setWorkspace('pro'));
  add('window.quick', () => ui.setWorkspace('quick'));
  add('window.reset', () => ui.resetPanels());

  // ---------- Help ----------
  add('help.tour', () => ui.tour());
  add('help.shortcuts', () => ui.shortcutsDialog());
  add('help.about', () => ui.aboutDialog());
  add('help.english', () => ui.setLanguage('en'));
  add('help.portuguese', () => ui.setLanguage('pt-BR'));

  // ---------- Actions panel ----------
  add('action.record', () => ui.recordAction());
  add('action.stop', () => ui.stopAction());
  add('action.play', (app, id) => ui.playAction(id));
}

function toggleView(app, what) {
  const v = app.S.view;
  v[what] = !v[what];
  app.vp.showRulers = v.rulers;
  app.vp.showGrid = v.grid;
  app.vp.showGuides = v.guides;
  app.vp.snap = v.snap;
  app.vp.needsOverlay = true;
  setTimeout(() => app.vp.resize(), 0);
}

function transformLayer(app, { rotate = 0, flipX = false, flipY = false }) {
  const l = active(app);
  const ids = subtree(doc(app), l.id).map((id) => findLayer(doc(app), id)).filter((x) => !['group', 'adjust', 'fill'].includes(x.type));
  if (!ids.length) return;
  // around the center of the layer (or of the group)
  const b = boundsOf(ids.flatMap((x) => corners(x, app.renderer.size(x))));
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const a = (rotate * Math.PI) / 180;
  const ops = ids.map((x) => {
    let nx = x.x;
    let ny = x.y;
    const props = {};
    if (rotate) {
      nx = cx + (x.x - cx) * Math.cos(a) - (x.y - cy) * Math.sin(a);
      ny = cy + (x.x - cx) * Math.sin(a) + (x.y - cy) * Math.cos(a);
      props.rotation = ((x.rotation + rotate + 540) % 360) - 180;
    }
    if (flipX) {
      nx = 2 * cx - nx;
      props.scaleX = -x.scaleX;
      props.rotation = -(props.rotation ?? x.rotation);
    }
    if (flipY) {
      ny = 2 * cy - ny;
      props.scaleY = -x.scaleY;
      props.rotation = -(props.rotation ?? x.rotation);
    }
    return { t: 'set', id: x.id, props: { ...props, x: nx, y: ny } };
  });
  app.edoc.commit(app.t('history.transform'), ops, { icon: 'rotate' });
}

function layerFromSelection(app, cut) {
  const l = active(app);
  const sel = selectionCanvasLayerPixels(app, l);
  const src = app.edoc.assets.read(l.asset);
  const copy = new Uint8ClampedArray(src);
  for (let i = 0; i < sel.length; i++) copy[i * 4 + 3] = Math.round((copy[i * 4 + 3] * sel[i]) / 255);
  const asset = newId('a');
  const id = newId();
  const ops = [
    { t: 'asset', id: asset, w: l.w, h: l.h, data: copy },
    { t: 'add', layer: makeLayer('raster', { ...JSON.parse(JSON.stringify(l)), id, asset, name: `${l.name} ${app.t('layer.copy')}`, mask: null }), index: indexOf(doc(app), l.id) + 1 },
  ];
  if (cut) {
    const rest = new Uint8ClampedArray(src);
    for (let i = 0; i < sel.length; i++) rest[i * 4 + 3] = Math.round((rest[i * 4 + 3] * (255 - sel[i])) / 255);
    ops.unshift(patchOp(l.asset, { x: 0, y: 0, w: l.w, h: l.h }, rest));
  }
  ops.push({ t: 'sel', data: null });
  app.edoc.commit(app.t(cut ? 'history.viaCut' : 'history.viaCopy'), ops, { icon: 'duplicate' });
  app.selectLayer(id);
}

function mergeAll(app, visibleOnly) {
  const d = doc(app);
  const c = app.renderer.render({ scale: 1, background: !visibleOnly, proof: false });
  const data = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, d.width, d.height).data;
  const remove = d.layers.filter((l) => (visibleOnly ? app.renderer.shown(l.id) || l.type === 'group' : true)).map((l) => l.id).reverse();
  const { ops, id } = rasterFromPixels(app, data, d.width, d.height, { name: app.t(visibleOnly ? 'layer.merged' : 'layer.background'), index: 0 });
  app.edoc.commit(app.t(visibleOnly ? 'history.mergeVisible' : 'history.flatten'), [...remove.map((x) => ({ t: 'remove', id: x })), ...ops], { icon: 'layers' });
  app.selectLayer(id);
}

/**
 * Menu structure: [label key, [items]] where an item is a command id, '-' for a separator,
 * or [label key, [items]] for a submenu.
 */
export const MENUS = [
  ['menu.file', ['file.new', 'file.open', ['menu.file.recent', 'recent'], 'file.place', '-', 'file.close', 'file.closeAll', 'file.save', 'file.saveAs', 'file.revert', '-', 'file.export', 'file.quickExport', 'file.sticker', '-', 'file.send', 'file.share', 'file.join']],
  ['menu.edit', ['edit.undo', 'edit.redo', ['menu.edit.history', 'history'], '-', 'edit.cut', 'edit.copy', 'edit.copyMerged', 'edit.paste', 'edit.clear', '-', 'edit.fill', 'edit.stroke', 'edit.contentAware', '-', 'edit.freeTransform', ['menu.edit.transform', ['edit.rotate90', 'edit.rotate-90', 'edit.rotate180', 'edit.flipH', 'edit.flipV']], '-', 'edit.definePattern', '-', 'edit.shortcuts', 'edit.settings']],
  ['menu.image', [['menu.image.mode', ['image.mode.rgb', 'image.mode.gray', 'image.mode.cmyk']], '-', ['menu.image.adjustments', ADJUSTMENT_IDS.map((id) => `adjust.${id}`)], 'image.autoTone', '-', 'image.imageSize', 'image.canvasSize', ['menu.image.rotate', ['image.rotateCW', 'image.rotateCCW', 'image.rotate180', 'image.flipH', 'image.flipV']], 'image.cropToSelection', 'image.trim', '-', 'image.duplicate']],
  ['menu.layer', ['layer.new', 'layer.newGroup', 'layer.ungroup', 'layer.duplicate', 'layer.viaCopy', 'layer.viaCut', 'layer.delete', 'layer.rename', '-', ['menu.layer.adjustment', ADJUSTMENT_IDS.map((id) => `layer.newAdjustment:${id}`)], ['menu.layer.fill', ['layer.newFill:solid', 'layer.newFill:gradient', 'layer.newFill:pattern']], 'layer.style', '-', ['menu.layer.mask', ['layer.addMask:auto', 'layer.addMask:hide', 'layer.editMask', 'layer.toggleMask', 'layer.invertMask', 'layer.applyMask', 'layer.deleteMask']], 'layer.clip', '-', ['menu.layer.arrange', ['layer.front', 'layer.forward', 'layer.backward', 'layer.back']], 'layer.rasterize', 'layer.mergeDown', 'layer.mergeVisible', 'layer.flatten', '-', 'layer.removeBackground', 'layer.hide', 'layer.lock']],
  ['menu.select', ['select.all', 'select.none', 'select.reselect', 'select.inverse', '-', 'select.subject', 'select.colorRange', 'select.refine', '-', ['menu.select.modify', ['select.feather', 'select.expand', 'select.contract']], '-', 'select.fromLayer', 'select.fromPath', 'select.toMask']],
  ['menu.filter', ['filter.last', '-', ...FILTER_GROUPS.map((g) => [`filter.group.${g}`, FILTERS.filter((f) => f.group === g).map((f) => `filter.${f.id}`)]), '-', 'filter.liquify']],
  ['menu.view', ['view.zoomIn', 'view.zoomOut', 'view.fit', 'view.actual', '-', 'view.proof', 'view.gamut', '-', 'view.rulers', 'view.grid', 'view.guides', 'view.snap', 'view.newGuide', 'view.clearGuides', '-', 'view.fullscreen']],
  ['menu.window', ['window.pro', 'window.quick', 'window.reset', '-', 'window.layers', 'window.properties', 'window.adjustments', 'window.history', 'window.color', 'window.swatches', 'window.paths', 'window.actions', 'window.timeline', 'window.info', 'window.live']],
  ['menu.help', ['help.tour', 'help.shortcuts', '-', 'help.english', 'help.portuguese', '-', 'help.about']],
];

export { invert, apply, layerMatrix, invertMask };
