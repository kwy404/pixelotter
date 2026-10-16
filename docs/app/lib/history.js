// Generated from src/history.js by scripts/build-app.mjs. Edit the source, not this copy.
// Unlimited undo and redo. Each entry holds the operations of one user action and their
// inverses. Undo hands back the inverses (applied newest first), redo the operations again.
// There is no step limit: the history keeps growing until the document is closed, bounded only
// by memory. Pixel edits store just the changed rectangle, so long painting sessions stay small.
// Rapid changes of the same control (a slider drag, arrow key nudges) merge into one entry.

import { opBytes } from './pixels.js';

export const MERGE_WINDOW_MS = 1200;

/** Merges consecutive 'set' ops on the same layer: the first inverse and the last value win. */
export function compactSets(ops, inverse) {
  const outOps = [];
  for (const op of ops) {
    const prev = outOps[outOps.length - 1];
    if (prev && op.t === 'set' && prev.t === 'set' && prev.id === op.id) prev.props = { ...prev.props, ...op.props };
    else outOps.push(op.t === 'set' ? { ...op, props: { ...op.props } } : op);
  }
  const outInv = [];
  for (const inv of inverse) {
    const prev = outInv[outInv.length - 1];
    // Inverses are applied in reverse, so for the same layer the earliest one must win.
    if (prev && inv.t === 'set' && prev.t === 'set' && prev.id === inv.id) prev.props = { ...inv.props, ...prev.props };
    else outInv.push(inv.t === 'set' ? { ...inv, props: { ...inv.props } } : inv);
  }
  return { ops: outOps, inverse: outInv };
}

export class UndoStack {
  constructor({ now = () => Date.now() } = {}) {
    this.entries = [];
    this.index = 0; // number of entries currently applied
    this.now = now;
    this.savedAt = 0; // index that matches the last save
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  changed() {
    for (const fn of this.listeners) fn(this);
  }

  get canUndo() {
    return this.index > 0;
  }

  get canRedo() {
    return this.index < this.entries.length;
  }

  get dirty() {
    return this.index !== this.savedAt;
  }

  markSaved() {
    this.savedAt = this.index;
    this.changed();
  }

  /**
   * Records an action that was already applied. entry: { label, ops, inverse, merge? }
   * inverse is in application order of ops (undo walks it backwards).
   */
  push({ label, ops, inverse, merge = null, icon = null }) {
    if (!ops?.length) return null;
    if (this.index < this.entries.length) {
      this.entries.length = this.index;
      if (this.savedAt > this.index) this.savedAt = -1; // the saved state can no longer be reached
    }
    const t = this.now();
    const top = this.entries[this.index - 1];
    if (merge && top && top.merge === merge && t - top.time < MERGE_WINDOW_MS && this.savedAt !== this.index) {
      const compact = compactSets([...top.ops, ...ops], [...top.inverse, ...inverse]);
      top.ops = compact.ops;
      top.inverse = compact.inverse;
      top.time = t;
      top.bytes = [...top.ops, ...top.inverse].reduce((n, o) => n + opBytes(o), 0);
      this.changed();
      return top;
    }
    const entry = { id: this.entries.length + 1, label, icon, ops, inverse, merge, time: t, bytes: [...ops, ...inverse].reduce((n, o) => n + opBytes(o), 0) };
    this.entries.push(entry);
    this.index = this.entries.length;
    this.changed();
    return entry;
  }

  /** Steps back one entry. Returns the operations to apply, or null. */
  undo() {
    if (!this.canUndo) return null;
    const entry = this.entries[--this.index];
    this.changed();
    return { entry, ops: [...entry.inverse].reverse() };
  }

  redo() {
    if (!this.canRedo) return null;
    const entry = this.entries[this.index++];
    this.changed();
    return { entry, ops: entry.ops };
  }

  /** Every operation needed to reach the state after `count` entries (the History panel). */
  goTo(count) {
    const target = Math.max(0, Math.min(this.entries.length, count));
    const steps = [];
    while (this.index > target) steps.push(...this.undo().ops);
    while (this.index < target) steps.push(...this.redo().ops);
    return steps;
  }

  clear() {
    this.entries = [];
    this.index = 0;
    this.savedAt = 0;
    this.changed();
  }

  get bytes() {
    return this.entries.reduce((n, e) => n + e.bytes, 0);
  }
}
