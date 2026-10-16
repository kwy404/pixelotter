// One open document: the JSON model, its pixel assets, unlimited undo, the selection and the
// view. Every change is a list of operations applied through apply(), recorded by commit()
// for undo and passed to a live session when one is running. The class also implements the
// engine contract the live session expects (apply, snapshot, load, layerOf, hasLayer).

import { Emitter } from '../../lib/emitter.js';
import { applyOps, assetIds, createDoc, findLayer, isDocOp, newId, normalizeDoc } from '../../lib/doc.js';
import { UndoStack } from '../../lib/history.js';
import { isPixelOp } from '../../lib/pixels.js';
import { AssetStore } from './assets.js';
import { Selection } from './selection.js';

export class EditorDocument extends Emitter {
  constructor(doc = createDoc(), assets = new AssetStore()) {
    super();
    this.uid = newId('t');
    this.doc = doc;
    this.assets = assets;
    this.history = new UndoStack();
    this.selection = new Selection(doc.width, doc.height);
    this.view = { zoom: 0, cx: doc.width / 2, cy: doc.height / 2, fit: true };
    this.active = null;
    this.file = { name: null, handle: null, format: null, saved: null }; // where it was opened or saved
    this.session = null; // a live session adapter while sharing
    this.revision = 0;
    this.history.onChange(() => this.emit('history', this.history));
    assets.onChange((id, rect) => this.emit('pixels', { id, rect }));
  }

  get layers() {
    return this.doc.layers;
  }

  layer(id) {
    return findLayer(this.doc, id);
  }

  get activeLayer() {
    return this.active ? this.layer(this.active) : null;
  }

  setActive(id) {
    if (id && !this.layer(id)) return;
    this.active = id ?? null;
    this.emit('active', this.active);
    this.session?.lock?.(this.active ? [this.active] : []);
  }

  get dirty() {
    return this.history.dirty;
  }

  /** Applies operations and returns their inverses in application order. */
  apply(ops, source = 'local') {
    const inverse = [];
    let structural = false;
    let resized = false;
    for (const op of ops) {
      if (op.t === 'sel') {
        inverse.push({ t: 'sel', data: this.selection.mask });
        this.selection.set(op.data ? new Uint8Array(op.data) : null);
        this.emit('selection', this.selection);
        continue;
      }
      if (isPixelOp(op)) {
        const inv = this.assets.apply(op);
        if (inv) inverse.push(inv);
        continue;
      }
      if (!isDocOp(op)) throw new Error(`Unknown operation ${op?.t}`);
      if (op.t === 'doc' && ('width' in (op.props ?? {}) || 'height' in (op.props ?? {}))) resized = true;
      if (op.t !== 'set') structural = true;
      inverse.push(...applyOps(this.doc, [op]));
    }
    if (resized && (this.selection.w !== this.doc.width || this.selection.h !== this.doc.height)) {
      this.selection.resize(this.doc.width, this.doc.height);
      this.emit('selection', this.selection);
    }
    if (this.active && !this.layer(this.active)) this.active = this.doc.layers.at(-1)?.id ?? null;
    this.revision++;
    this.emit('change', { ops, source, structural });
    return inverse;
  }

  /** Whether the live session (if any) allows these operations right now. */
  allowed(ops) {
    if (!this.session) return { ok: true };
    const shared = ops.filter((o) => o.t !== 'sel');
    if (!shared.length) return { ok: true };
    return this.session.allowed(shared);
  }

  /**
   * Applies and records one user action. Returns false when a live session refuses it (the
   * reason is emitted as 'refused').
   */
  commit(label, ops, { merge = null, icon = null } = {}) {
    if (!ops?.length) return false;
    const ok = this.allowed(ops);
    if (!ok.ok) {
      this.emit('refused', ok.reason);
      return false;
    }
    const inverse = this.apply(ops, 'local');
    this.history.push({ label, ops, inverse, merge, icon });
    this.share(ops, inverse);
    this.emit('recorded', { label, icon, ops, inverse });
    return true;
  }

  /** Records ops that were already applied (for interactive edits like a drag). */
  record(label, ops, inverse, { merge = null, icon = null } = {}) {
    if (!ops?.length) return;
    this.history.push({ label, ops, inverse, merge, icon });
    this.share(ops, inverse);
    this.emit('recorded', { label, icon, ops, inverse });
  }

  share(ops, inverse) {
    if (!this.session) return;
    const shared = ops.filter((o) => o.t !== 'sel');
    if (shared.length) this.session.local(shared, inverse.filter((o) => o.t !== 'sel'));
  }

  undo() {
    const step = this.history.undo();
    if (!step) return null;
    const inv = this.apply(step.ops, 'history');
    this.share(step.ops, inv);
    this.emit('undone', step.entry);
    return step.entry;
  }

  redo() {
    const step = this.history.redo();
    if (!step) return null;
    const inv = this.apply(step.ops, 'history');
    this.share(step.ops, inv);
    this.emit('redone', step.entry);
    return step.entry;
  }

  /** Jumps to a history state (the History panel). */
  goTo(count) {
    const ops = this.history.goTo(count);
    if (ops.length) {
      const inv = this.apply(ops, 'history');
      this.share(ops, inv);
    }
  }

  layerOf(asset) {
    return this.doc.layers.find((l) => l.asset === asset || l.mask?.asset === asset)?.id ?? null;
  }

  hasLayer(id) {
    return !!this.layer(id);
  }

  /** Everything a late joiner or an autosave needs: the JSON and every asset as PNG. */
  async snapshot() {
    const assets = [];
    for (const id of assetIds(this.doc)) {
      const a = this.assets.get(id);
      if (!a) continue;
      assets.push({ id, w: a.w, h: a.h, mime: 'image/png', bytes: await this.assets.png(id) });
    }
    return { doc: JSON.parse(JSON.stringify(this.doc)), assets };
  }

  /** Replaces the document with a snapshot. */
  async load(snapshot) {
    const doc = normalizeDoc(snapshot.doc);
    const store = new AssetStore();
    for (const a of snapshot.assets ?? []) {
      if (a.bytes) await store.load(a.id, a.bytes, a.mime || 'image/png');
      else store.create(a.id, a.w, a.h, a.data);
    }
    this.assets.clear();
    for (const [id, img] of store.images) this.assets.images.set(id, img);
    this.doc = doc;
    this.selection.resize(doc.width, doc.height);
    this.active = doc.layers.at(-1)?.id ?? null;
    this.revision++;
    this.emit('change', { ops: [], source: 'load', structural: true });
    this.emit('selection', this.selection);
  }
}
