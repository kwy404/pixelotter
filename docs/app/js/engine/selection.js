// The selection: a document sized mask (one byte per pixel, 0 to 255) with the outlines for the
// marching ants. Changes go through the document as local 'sel' operations, so selecting is
// undoable like everything else, but selections are never sent to friends in a live session.

import { combineMasks, contractMask, expandMask, featherMask, invertMask, isEmptyMask, maskBounds, maskOutlines } from '../../lib/mask.js';
import { polygonMask } from '../../lib/paths.js';

export class Selection {
  constructor(w, h) {
    this.resize(w, h);
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
    this.mask = null; // null means nothing is selected
    this.version = (this.version ?? 0) + 1;
    this.outlineCache = null;
  }

  get empty() {
    return !this.mask;
  }

  /** Replaces the whole mask (null clears). Used by the 'sel' operation. */
  set(mask) {
    this.mask = mask && !isEmptyMask(mask) ? mask : null;
    this.version++;
    this.outlineCache = null;
  }

  bounds() {
    return this.mask ? maskBounds(this.mask, this.w, this.h) : null;
  }

  /** The mask a new selection would produce, combined with the current one. */
  combine(mask, mode = 'replace') {
    return combineMasks(this.mask, mask, mode);
  }

  rect(x, y, w, h) {
    const m = new Uint8Array(this.w * this.h);
    const x0 = Math.max(0, Math.round(Math.min(x, x + w)));
    const y0 = Math.max(0, Math.round(Math.min(y, y + h)));
    const x1 = Math.min(this.w, Math.round(Math.max(x, x + w)));
    const y1 = Math.min(this.h, Math.round(Math.max(y, y + h)));
    for (let yy = y0; yy < y1; yy++) m.fill(255, yy * this.w + x0, yy * this.w + x1);
    return m;
  }

  ellipse(x, y, w, h) {
    const pts = [];
    const cx = x + w / 2;
    const cy = y + h / 2;
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      pts.push([cx + (Math.cos(a) * Math.abs(w)) / 2, cy + (Math.sin(a) * Math.abs(h)) / 2]);
    }
    return polygonMask(pts, this.w, this.h);
  }

  polygon(points) {
    return polygonMask(points, this.w, this.h);
  }

  all() {
    return new Uint8Array(this.w * this.h).fill(255);
  }

  inverse() {
    return this.mask ? invertMask(this.mask) : this.all();
  }

  feather(r) {
    return this.mask ? featherMask(this.mask, this.w, this.h, r) : null;
  }

  grow(r) {
    return this.mask ? expandMask(this.mask, this.w, this.h, r) : null;
  }

  shrink(r) {
    return this.mask ? contractMask(this.mask, this.w, this.h, r) : null;
  }

  /** Mask value (0..255) at a document pixel, 255 everywhere when nothing is selected. */
  at(x, y) {
    if (!this.mask) return 255;
    const xx = Math.floor(x);
    const yy = Math.floor(y);
    if (xx < 0 || yy < 0 || xx >= this.w || yy >= this.h) return 0;
    return this.mask[yy * this.w + xx];
  }

  /**
   * Outlines for the marching ants, in document pixels, computed on a reduced copy for big
   * documents and cached until the selection changes.
   */
  outlines() {
    if (!this.mask) return [];
    if (this.outlineCache?.version === this.version) return this.outlineCache.loops;
    const max = 1400;
    const k = Math.max(1, Math.ceil(Math.max(this.w, this.h) / max));
    let loops;
    if (k === 1) loops = maskOutlines(this.mask, this.w, this.h);
    else {
      const w = Math.ceil(this.w / k);
      const h = Math.ceil(this.h / k);
      const small = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) small[y * w + x] = this.mask[Math.min(this.h - 1, y * k + (k >> 1)) * this.w + Math.min(this.w - 1, x * k + (k >> 1))];
      loops = maskOutlines(small, w, h).map((loop) => loop.map(([x, y]) => [x * k, y * k]));
    }
    this.outlineCache = { version: this.version, loops };
    return loops;
  }

  /** The selection as an alpha mask canvas (white, alpha = selection), for clipping draws. */
  toCanvas(makeCanvas) {
    const c = makeCanvas(this.w, this.h);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(this.w, this.h);
    const m = this.mask ?? this.all();
    for (let i = 0; i < m.length; i++) {
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
      img.data[i * 4 + 3] = m[i];
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }
}
