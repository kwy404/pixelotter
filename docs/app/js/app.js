// The editor hub: open documents (tabs), the current tool and its options, colors, and the
// helpers tools and commands share. It keeps the reactive UI store (S) in step with the
// documents: layers, history, document info, status and selection.

import { createDoc, layerTree, makeLayer, newId, isLocked } from '../lib/doc.js';
import { apply, corners, boundsOf, layerMatrix, invert, hitTest } from '../lib/geometry.js';
import { fromHex, rgbToHsv, toHex } from '../lib/color/convert.js';
import { rgbToCmyk } from '../lib/color/cmyk.js';
import { EditorDocument } from './engine/document.js';
import { Renderer, press } from './engine/render.js';
import { makeCanvas } from './engine/assets.js';
import { TEXT_PRESETS, ensureFont } from './engine/text.js';
import { patternTile } from './engine/patterns.js';
import { PAINT_TOOLS } from './tools/paint.js';
import { SELECT_TOOLS } from './tools/select.js';
import { move, crop, hand, zoom, layerAt } from './tools/transform.js';
import { CREATE_TOOLS } from './tools/create.js';

export const TOOLS = [move, ...SELECT_TOOLS, crop, ...CREATE_TOOLS.filter((t) => t.id === 'eyedropper'), ...PAINT_TOOLS.filter((t) => ['spot-heal', 'heal'].includes(t.id)), CREATE_TOOLS.find((t) => t.id === 'patch'), ...PAINT_TOOLS.filter((t) => !['spot-heal', 'heal'].includes(t.id)), ...CREATE_TOOLS.filter((t) => ['gradient', 'bucket', 'pen', 'text', 'shape'].includes(t.id)), hand, zoom];

/** The toolbox: groups in order, each with its tools (the first is shown, the rest fly out). */
export const TOOL_GROUPS = [
  ['move', ['move']],
  ['marquee', ['marquee', 'marquee-ellipse']],
  ['lasso', ['lasso', 'lasso-poly']],
  ['select', ['quick-select', 'wand']],
  ['crop', ['crop']],
  ['eyedropper', ['eyedropper']],
  ['heal', ['spot-heal', 'heal', 'patch']],
  ['brush', ['brush', 'pencil']],
  ['clone', ['clone']],
  ['eraser', ['eraser']],
  ['fill', ['gradient', 'bucket']],
  ['focus', ['blur', 'sharpen', 'smudge']],
  ['tone', ['dodge', 'burn', 'sponge']],
  ['pen', ['pen']],
  ['text', ['text']],
  ['shape', ['shape']],
  ['hand', ['hand']],
  ['zoom', ['zoom']],
];

export class App {
  constructor(S, { t, toast, vp }) {
    this.S = S;
    this.t = t;
    this.toastFn = toast;
    this.vp = vp;
    this.docs = [];
    this.edoc = null;
    this.renderer = null;
    this.tools = new Map(TOOLS.map((tool) => [tool.id, tool]));
    for (const tool of TOOLS) if (!S.options[tool.id]) S.options[tool.id] = { ...(tool.defaults ?? {}) };
    this.toolId = 'move';
    this.cloneSource = null;
    this.activePath = null;
    this.maskEdit = false;
    this.pixelCache = null;
    this.thumbTimer = null;
    this.live = null;
    // the brush outline follows the size of the current tool; tools draw their own guides
    vp.cursorSize = () => this.opts(this.toolId).size ?? 0;
    vp.toolOverlay = (ctx, view) => this.edoc && this.tool?.overlay?.(ctx, view, this);
    vp.onDouble = (p) => this.doubleClick(p);
  }

  // ---------- documents and tabs ----------

  newDocument(opts = {}) {
    const doc = createDoc(opts);
    const edoc = new EditorDocument(doc);
    this.add(edoc);
    return edoc;
  }

  add(edoc) {
    this.docs.push(edoc);
    edoc.on('change', (e) => this.onChange(edoc, e));
    edoc.on('pixels', () => {
      if (edoc === this.edoc) this.scheduleThumbs();
    });
    edoc.on('history', () => edoc === this.edoc && this.syncHistory());
    edoc.on('selection', () => {
      if (edoc !== this.edoc) return;
      this.vp.needsOverlay = true;
      this.S.selection = { active: !edoc.selection.empty };
    });
    edoc.on('active', () => edoc === this.edoc && this.syncLayers());
    edoc.on('refused', (reason) => this.toast(this.t(`live.refused.${reason}`) || reason, 'warning'));
    edoc.renderer = new Renderer(edoc);
    this.activate(edoc.uid);
    return edoc;
  }

  activate(uid) {
    const edoc = this.docs.find((d) => d.uid === uid);
    if (!edoc) return;
    this.tool?.deactivate?.(this);
    this.edoc = edoc;
    this.renderer = edoc.renderer;
    this.vp.attach(edoc, edoc.renderer);
    this.vp.gamutFn = (data) => press().gamut(data, 8);
    this.pixelCache = null;
    this.S.screen = 'editor';
    this.syncAll();
    this.tool?.activate?.(this);
  }

  closeDoc(uid) {
    const i = this.docs.findIndex((d) => d.uid === uid);
    if (i < 0) return;
    const [d] = this.docs.splice(i, 1);
    if (d.session) this.live?.leave?.();
    if (this.edoc === d) {
      this.edoc = null;
      const next = this.docs[Math.min(i, this.docs.length - 1)];
      if (next) this.activate(next.uid);
      else {
        this.vp.attach(null, null);
        this.S.screen = 'home';
        this.syncTabs();
      }
    } else this.syncTabs();
  }

  onChange(edoc, e) {
    if (edoc !== this.edoc) return;
    this.pixelCache = null;
    // drop caches of layers that changed
    for (const op of e.ops) if (op.t === 'set' || op.t === 'remove') this.renderer.cache.forEach((_, k) => k.startsWith(`${op.id}:`) && this.renderer.cache.delete(k));
    this.vp.invalidate();
    if (e.structural || e.source !== 'local' || e.ops.some((o) => o.t === 'set')) this.syncLayers();
    this.syncDocInfo();
    this.syncTabs();
    this.scheduleThumbs();
    this.autosave?.(edoc);
  }

  // ---------- UI sync ----------

  syncAll() {
    this.syncTabs();
    this.syncDocInfo();
    this.syncLayers();
    this.syncHistory();
    this.S.selection = { active: !!this.edoc && !this.edoc.selection.empty };
    this.scheduleThumbs(0);
  }

  syncTabs() {
    this.S.tabs = this.docs.map((d) => ({ uid: d.uid, name: d.doc.name, dirty: d.dirty, active: d === this.edoc, shared: !!d.session }));
  }

  syncDocInfo() {
    const d = this.edoc?.doc;
    if (!d) return;
    this.S.doc = { name: d.name, width: d.width, height: d.height, mode: d.mode, dpi: d.dpi, background: d.background, zoom: Math.round(this.vp.view.zoom * 1000) / 10, frames: d.frames.length, guides: d.guides.length, paths: d.paths.map((p) => ({ id: p.id, name: p.name, closed: p.closed, points: p.points.length, active: p.id === this.activePath })) };
  }

  syncLayers() {
    const edoc = this.edoc;
    if (!edoc) return;
    const doc = edoc.doc;
    const rows = [];
    const locks = this.live?.lockTable?.() ?? {};
    const peers = this.live?.peerMap?.() ?? {};
    const walk = (nodes, depth) => {
      // the panel lists top first
      for (let i = nodes.length - 1; i >= 0; i--) {
        const { layer: l, children } = nodes[i];
        const holder = locks[l.id] && locks[l.id] !== this.live?.myId ? peers[locks[l.id]] : null;
        rows.push({
          id: l.id,
          name: l.name,
          type: l.type,
          depth,
          visible: l.visible,
          locked: l.locked,
          opacity: Math.round(l.opacity * 100),
          fill: Math.round(l.fill * 100),
          blend: l.blend,
          clip: l.clip,
          hasMask: !!l.mask,
          maskEnabled: !!l.mask?.enabled,
          maskActive: this.maskEdit && l.id === edoc.active,
          collapsed: !!l.collapsed,
          styled: !!l.styles && Object.values(l.styles).some((s) => s?.enabled),
          active: l.id === edoc.active,
          thumb: this.thumbs?.get(l.id) ?? '',
          maskThumb: this.thumbs?.get(`${l.id}:mask`) ?? '',
          holder: holder ? { name: holder.name, color: holder.color } : null,
          editors: this.live?.editorsOf?.(l.id) ?? [],
        });
        if (l.type === 'group' && !l.collapsed) walk(children, depth + 1);
      }
    };
    walk(layerTree(doc), 0);
    this.S.layers = rows;
    const a = edoc.activeLayer;
    this.S.active = a ? JSON.parse(JSON.stringify(a)) : null;
    if (this.S.active) this.S.active.size = this.renderer.size(a);
  }

  syncHistory() {
    const h = this.edoc?.history;
    if (!h) return;
    this.S.history = [{ i: 0, label: this.t('history.open'), icon: 'file' }, ...h.entries.map((e, i) => ({ i: i + 1, label: e.label, icon: e.icon ?? 'history', author: e.author?.color ?? '', by: e.author?.name ?? '' }))];
    this.S.historyIndex = h.index;
    this.S.canUndo = h.canUndo;
    this.S.canRedo = h.canRedo;
    this.syncTabs();
  }

  /** Layer thumbnails for the panel, made in small batches after changes settle. */
  scheduleThumbs(delay = 250) {
    clearTimeout(this.thumbTimer);
    this.thumbTimer = setTimeout(() => this.makeThumbs(), delay);
  }

  makeThumbs() {
    const edoc = this.edoc;
    if (!edoc) return;
    this.thumbs ??= new Map();
    const d = edoc.doc;
    const T = 40;
    const k = Math.min(T / d.width, T / d.height);
    const w = Math.max(1, Math.round(d.width * k));
    const h = Math.max(1, Math.round(d.height * k));
    for (const l of d.layers) {
      if (l.type === 'group' || l.type === 'adjust') continue;
      const c = makeCanvas(w, h);
      const ctx = c.getContext('2d');
      this.renderer.drawContent(ctx, l, k);
      this.thumbs.set(l.id, canvasUrl(c));
      if (l.mask) {
        const mc = makeCanvas(w, h);
        const m = this.renderer.maskCanvas({ ...l, mask: { ...l.mask, enabled: true, feather: 0 } }, k, w, h);
        const mctx = mc.getContext('2d');
        mctx.fillStyle = '#000';
        mctx.fillRect(0, 0, w, h);
        if (m) {
          const white = makeCanvas(w, h);
          const wctx = white.getContext('2d');
          wctx.drawImage(m, 0, 0);
          wctx.globalCompositeOperation = 'source-in';
          wctx.fillStyle = '#fff';
          wctx.fillRect(0, 0, w, h);
          mctx.drawImage(white, 0, 0);
        }
        this.thumbs.set(`${l.id}:mask`, canvasUrl(mc));
        this.renderer.cache.delete(`${l.id}:mask`);
      }
    }
    this.syncLayers();
  }

  // ---------- tools ----------

  get tool() {
    return this.tools.get(this.toolId);
  }

  setTool(id) {
    if (!this.tools.has(id)) return;
    this.textEditor?.close?.();
    if (this.edoc) this.tool?.deactivate?.(this);
    this.toolId = id;
    this.vp.toolId = id;
    this.S.tool = id;
    this.setCursor(this.tool.cursor ?? 'default');
    if (this.edoc) this.tool.activate?.(this);
    this.vp.needsOverlay = true;
  }

  opts(id) {
    return this.S.options[id] ?? {};
  }

  setCursor(c) {
    this.vp.setCursor(c);
  }

  /** Pointer events from the viewport, routed to the current tool. */
  pointer(kind, p) {
    const tool = this.tool;
    if (!this.edoc || !tool) return;
    try {
      if (kind === 'cancel') tool.cancel?.(this);
      else tool[kind]?.(this, p);
    } catch (err) {
      console.warn(err);
      this.toast(String(err?.message ?? err), 'danger');
    }
  }

  // ---------- colors ----------

  get fg() {
    return this.S.colors.fg;
  }

  get bg() {
    return this.S.colors.bg;
  }

  setColor(which, hex) {
    this.S.colors[which] = hex;
    if (which === 'fg') this.syncColorInfo();
  }

  syncColorInfo() {
    const [r, g, b] = fromHex(this.fg);
    const [h, s, v] = rgbToHsv(r, g, b);
    this.S.colorInfo = { r, g, b, h: Math.round(h), s: Math.round(s * 100), v: Math.round(v * 100), hex: this.fg, cmyk: rgbToCmyk(r, g, b).map(Math.round) };
  }

  // ---------- helpers for tools and commands ----------

  toast(msg, kind = 'info', action = null) {
    this.toastFn(msg, kind, action);
  }

  status(msg) {
    this.S.status.message = msg;
  }

  textPreset(id) {
    return TEXT_PRESETS.find((p) => p.id === id)?.props ?? {};
  }

  /** Index to insert a new layer at: above the active one, inside its group. */
  insertIndex() {
    const d = this.edoc.doc;
    const i = d.layers.findIndex((l) => l.id === this.edoc.active);
    return i < 0 ? d.layers.length : i + 1;
  }

  selectLayer(id) {
    if (!this.edoc) return;
    this.maskEdit = false;
    this.edoc.setActive(id);
    this.syncLayers();
    this.vp.needsOverlay = true;
  }

  layerAt(x, y) {
    return layerAt(this, x, y);
  }

  alphaAt(l, x, y) {
    if (l.type !== 'raster') return 255;
    const q = apply(invert(layerMatrix(l, { w: l.w, h: l.h })), { x, y });
    const px = Math.floor(q.x);
    const py = Math.floor(q.y);
    if (px < 0 || py < 0 || px >= l.w || py >= l.h) return 0;
    try {
      return this.edoc.assets.read(l.asset, { x: px, y: py, w: 1, h: 1 })[3];
    } catch {
      return 0;
    }
  }

  /**
   * The pixels a painting tool works on: the active raster layer (or its mask while editing the
   * mask). For a missing or non raster layer it makes a new transparent layer, sized to the
   * document, after asking nothing (painting on text needs Rasterize first).
   */
  paintTarget(toolId, { createDocSize = true } = {}) {
    const edoc = this.edoc;
    let l = edoc.activeLayer;
    if (l && isLocked(edoc.doc, l.id)) {
      this.toast(this.t('toast.locked'), 'warning');
      return null;
    }
    if (l && this.maskEdit && l.mask) return { layer: l, asset: l.mask.asset, mask: true, size: l.mask.space === 'layer' ? { w: l.w, h: l.h } : { w: edoc.doc.width, h: edoc.doc.height } };
    if (l && (l.type === 'text' || l.type === 'shape') && ['eraser', 'clone', 'spot-heal', 'heal', 'dodge', 'burn', 'sponge', 'blur', 'sharpen', 'smudge', 'patch'].includes(toolId)) {
      this.toast(this.t('toast.rasterizeFirst'), 'warning', { label: this.t('menu.layer.rasterize'), run: () => this.run('layer.rasterize') });
      return null;
    }
    if (!l || l.type !== 'raster') {
      if (!createDocSize || ['eraser', 'clone', 'spot-heal', 'heal', 'dodge', 'burn', 'sponge', 'blur', 'sharpen', 'smudge', 'patch'].includes(toolId)) {
        this.toast(this.t('toast.needPixels'), 'warning');
        return null;
      }
      const d = edoc.doc;
      const id = newId();
      const asset = newId('a');
      const layer = makeLayer('raster', { id, name: this.t('layer.paint'), asset, w: d.width, h: d.height, x: d.width / 2, y: d.height / 2 });
      edoc.commit(this.t('history.newLayer'), [{ t: 'asset', id: asset, w: d.width, h: d.height, data: null }, { t: 'add', layer, index: this.insertIndex() }], { icon: 'layers' });
      this.selectLayer(id);
      l = edoc.layer(id);
    }
    return { layer: l, asset: l.asset, mask: false, size: { w: l.w, h: l.h } };
  }

  /** Repaints the part of the canvas a changed rectangle of layer pixels covers. */
  invalidateLayerRect(target, r) {
    const l = target.layer;
    let rect = r;
    if (!(target.mask && l.mask.space === 'doc')) {
      const m = layerMatrix(l, target.size);
      rect = boundsOf([
        apply(m, { x: r.x, y: r.y }),
        apply(m, { x: r.x + r.w, y: r.y }),
        apply(m, { x: r.x, y: r.y + r.h }),
        apply(m, { x: r.x + r.w, y: r.y + r.h }),
      ]);
    }
    this.renderer.cache.delete(`${l.id}:src`);
    if (target.mask) this.renderer.cache.delete(`${l.id}:mask`);
    this.pixelCache = null;
    this.vp.invalidate(rect);
    this.scheduleThumbs(400);
  }

  /** The selection (document space) sampled at each pixel of a layer region. */
  selectionInLayer(target, region) {
    return this.docMaskInLayer(target, this.edoc.selection.mask, region);
  }

  docMaskInLayer(target, mask, region) {
    const out = new Uint8Array(region.w * region.h);
    if (!mask) return out.fill(255);
    const sel = this.edoc.selection;
    const m = layerMatrix(target.layer, target.size);
    const docSpace = target.mask && target.layer.mask.space === 'doc';
    for (let y = 0; y < region.h; y++) {
      for (let x = 0; x < region.w; x++) {
        const p = docSpace ? { x: region.x + x + 0.5, y: region.y + y + 0.5 } : apply(m, { x: region.x + x + 0.5, y: region.y + y + 0.5 });
        const xx = Math.floor(p.x);
        const yy = Math.floor(p.y);
        out[y * region.w + x] = xx < 0 || yy < 0 || xx >= sel.w || yy >= sel.h ? 0 : mask[yy * sel.w + xx];
      }
    }
    return out;
  }

  /** Full size pixels of the composite (or of the active layer), cached until the next change. */
  async samplePixels(all = true) {
    const edoc = this.edoc;
    const key = `${edoc.uid}:${edoc.revision}:${all}`;
    if (this.pixelCache?.key === key) return this.pixelCache.value;
    const d = edoc.doc;
    let canvas;
    if (all) canvas = this.renderer.render({ scale: 1, background: true });
    else {
      canvas = makeCanvas(d.width, d.height);
      const l = edoc.activeLayer;
      if (l) this.renderer.drawContent(canvas.getContext('2d'), l, 1);
    }
    const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, d.width, d.height).data;
    const value = { data, width: d.width, height: d.height };
    this.pixelCache = { key, value };
    return value;
  }

  async colorAt(x, y, sample = 1) {
    const px = await this.samplePixels(this.opts('eyedropper').layers !== 'current');
    const r = Math.floor(sample / 2);
    const acc = [0, 0, 0, 0];
    let n = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const xx = Math.floor(x) + dx;
        const yy = Math.floor(y) + dy;
        if (xx < 0 || yy < 0 || xx >= px.width || yy >= px.height) continue;
        const i = (yy * px.width + xx) * 4;
        for (let c = 0; c < 4; c++) acc[c] += px.data[i + c];
        n++;
      }
    return n ? acc.map((v) => Math.round(v / n)) : null;
  }

  patternPixels(id) {
    const tile = patternTile(id);
    const data = tile.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, tile.width, tile.height).data;
    return { at: (x, y) => { const i = ((y % tile.height) * tile.width + (x % tile.width)) * 4; return [data[i], data[i + 1], data[i + 2]]; } };
  }

  /** Snaps a moving layer's edges and center to guides and the canvas, within 6 screen pixels. */
  snap(layer, size, dx, dy) {
    if (!this.vp.snap) return { dx, dy };
    const tol = 6 / this.vp.view.zoom;
    const d = this.edoc.doc;
    const b = boundsOf(corners({ ...layer, x: layer.x + dx, y: layer.y + dy }, size));
    const xs = [0, d.width / 2, d.width, ...d.guides.filter((g) => g.axis === 'x').map((g) => g.pos)];
    const ys = [0, d.height / 2, d.height, ...d.guides.filter((g) => g.axis === 'y').map((g) => g.pos)];
    let bestX = null;
    for (const edge of [b.x, b.x + b.w / 2, b.x + b.w]) for (const t of xs) if (Math.abs(edge - t) < tol && (bestX === null || Math.abs(edge - t) < Math.abs(bestX))) bestX = t - edge;
    let bestY = null;
    for (const edge of [b.y, b.y + b.h / 2, b.y + b.h]) for (const t of ys) if (Math.abs(edge - t) < tol && (bestY === null || Math.abs(edge - t) < Math.abs(bestY))) bestY = t - edge;
    return { dx: dx + (bestX ?? 0), dy: dy + (bestY ?? 0) };
  }

  /** Opens the inline text editor over a text layer. */
  editText(id, selectAll = false) {
    this.textEditor?.open(id, selectAll);
  }

  /** The topmost visible, unlocked text layer under a document point. */
  textLayerAt(p) {
    if (!this.edoc) return null;
    const d = this.edoc.doc;
    return [...d.layers].reverse().find((l) => l.type === 'text' && this.renderer.shown(l.id) && !isLocked(d, l.id) && hitTest(l, this.renderer.size(l), p)) ?? null;
  }

  /** Double click on the canvas: text opens for editing with the Text tool. */
  doubleClick(p) {
    const hit = this.textLayerAt(p);
    if (!hit) return;
    this.selectLayer(hit.id);
    if (this.toolId !== 'text') this.setTool('text');
    this.editText(hit.id, true);
  }

  async applyFontLater(l) {
    await ensureFont(l);
    this.renderer.forget(l.id);
    this.vp.invalidate();
  }

  run(cmd, ...args) {
    return this.commands?.run(cmd, ...args);
  }

  hexOf(c) {
    return toHex(c[0], c[1], c[2]);
  }
}

function canvasUrl(c) {
  if (c.convertToBlob) {
    // OffscreenCanvas has no toDataURL: copy it to a small regular canvas
    const el = document.createElement('canvas');
    el.width = c.width;
    el.height = c.height;
    el.getContext('2d').drawImage(c, 0, 0);
    return el.toDataURL();
  }
  return c.toDataURL();
}
