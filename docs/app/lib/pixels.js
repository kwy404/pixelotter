// Generated from src/pixels.js by scripts/build-app.mjs. Edit the source, not this copy.
// Pixel assets: RGBA images keyed by id, changed only through three operations so undo, redo,
// autosave and live sessions all see the same pixels:
//   { t: 'asset', id, w, h, data }                 create (data: RGBA bytes, or null for clear)
//   { t: 'patch', id, x, y, w, h, data }           replace a rectangle with new RGBA bytes
//   { t: 'replace', id, w, h, data }               replace the whole image, possibly resized
// This is the plain array store used by the tests and by workers. The editor uses a canvas
// backed store with the same methods (docs/app/assets.js).

export const isPixelOp = (op) => op?.t === 'asset' || op?.t === 'patch' || op?.t === 'replace';

/** Clips a rectangle to an image. Returns null when nothing is left. */
export function clipRect(r, w, h) {
  const x0 = Math.max(0, Math.floor(r.x));
  const y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(w, Math.ceil(r.x + r.w));
  const y1 = Math.min(h, Math.ceil(r.y + r.h));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function unionRect(a, b) {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** Copies a rectangle out of an RGBA buffer. */
export function readRect(data, width, r) {
  const out = new Uint8ClampedArray(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) {
    const from = ((r.y + y) * width + r.x) * 4;
    out.set(data.subarray(from, from + r.w * 4), y * r.w * 4);
  }
  return out;
}

/** Writes an RGBA rectangle into a buffer. */
export function writeRect(data, width, r, src) {
  for (let y = 0; y < r.h; y++) data.set(src.subarray(y * r.w * 4, (y + 1) * r.w * 4), ((r.y + y) * width + r.x) * 4);
}

export class PixelStore {
  constructor() {
    this.images = new Map();
  }
  has(id) {
    return this.images.has(id);
  }
  get(id) {
    return this.images.get(id) ?? null;
  }
  size(id) {
    const img = this.images.get(id);
    return img ? { w: img.width, h: img.height } : null;
  }
  read(id, r = null) {
    const img = this.images.get(id);
    if (!img) throw new Error(`No asset ${id}`);
    if (!r) return new Uint8ClampedArray(img.data);
    return readRect(img.data, img.width, r);
  }
  /** Applies a pixel operation and returns its inverse (or null when there is none). */
  apply(op) {
    if (op.t === 'asset') {
      const data = op.data ? new Uint8ClampedArray(op.data) : new Uint8ClampedArray(op.w * op.h * 4);
      if (data.length !== op.w * op.h * 4) throw new Error('Asset size does not match its pixels');
      this.images.set(op.id, { width: op.w, height: op.h, data });
      return null; // assets are never deleted during a session, so undo needs nothing here
    }
    const img = this.images.get(op.id);
    if (!img) throw new Error(`No asset ${op.id}`);
    if (op.t === 'patch') {
      const r = clipRect(op, img.width, img.height);
      if (!r || r.w !== op.w || r.h !== op.h) throw new Error('Patch outside the image');
      const before = readRect(img.data, img.width, r);
      writeRect(img.data, img.width, r, new Uint8ClampedArray(op.data));
      return { t: 'patch', id: op.id, ...r, data: before };
    }
    if (op.t === 'replace') {
      const data = new Uint8ClampedArray(op.data);
      if (data.length !== op.w * op.h * 4) throw new Error('Replacement size does not match its pixels');
      const before = { t: 'replace', id: op.id, w: img.width, h: img.height, data: img.data };
      this.images.set(op.id, { width: op.w, height: op.h, data });
      return before;
    }
    throw new Error(`Unknown pixel operation ${op.t}`);
  }
}

/** Builds a patch operation from the pixels before and after an edit inside a rectangle. */
export function patchOp(id, rect, data) {
  return { t: 'patch', id, x: rect.x, y: rect.y, w: rect.w, h: rect.h, data };
}

/** Bytes used by an operation's pixel payload, for history memory accounting. */
export const opBytes = (op) => (op?.data?.byteLength ?? 0) + 64;
