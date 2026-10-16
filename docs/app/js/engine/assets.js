// Pixel assets backed by canvases: the browser twin of lib/pixels.js. Layer pixels and masks
// live here, changed only through the asset, patch and replace operations, so undo, autosave
// and live sessions all see the same pixels. Every change bumps a version number that the
// renderer uses to know when a cached result is stale.

export function makeCanvas(w, h) {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(Math.max(1, w), Math.max(1, h)) : Object.assign(document.createElement('canvas'), { width: Math.max(1, w), height: Math.max(1, h) });
  return c;
}

export const ctx2d = (c, read = false) => c.getContext('2d', read ? { willReadFrequently: true } : undefined);

export async function canvasToBlob(c, type = 'image/png', quality) {
  if (c.convertToBlob) return c.convertToBlob({ type, quality });
  return new Promise((resolve) => c.toBlob(resolve, type, quality));
}

export class AssetStore {
  constructor() {
    this.images = new Map(); // id -> { canvas, ctx, w, h, version }
    this.encoded = new Map(); // id -> { version, bytes }
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  touched(id, rect = null) {
    for (const fn of this.listeners) fn(id, rect);
  }

  has(id) {
    return this.images.has(id);
  }

  get(id) {
    return this.images.get(id) ?? null;
  }

  size(id) {
    const a = this.images.get(id);
    return a ? { w: a.w, h: a.h } : null;
  }

  version(id) {
    return this.images.get(id)?.version ?? -1;
  }

  canvas(id) {
    return this.images.get(id)?.canvas ?? null;
  }

  /** RGBA of the whole asset or a rectangle. */
  read(id, r = null) {
    const a = this.images.get(id);
    if (!a) throw new Error(`No asset ${id}`);
    const rect = r ?? { x: 0, y: 0, w: a.w, h: a.h };
    if (rect.w <= 0 || rect.h <= 0) return new Uint8ClampedArray(0);
    return a.ctx.getImageData(rect.x, rect.y, rect.w, rect.h).data;
  }

  create(id, w, h, data = null) {
    const canvas = makeCanvas(w, h);
    const ctx = ctx2d(canvas, true);
    if (data) ctx.putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
    this.images.set(id, { canvas, ctx, w, h, version: (this.images.get(id)?.version ?? 0) + 1 });
    this.touched(id);
  }

  /** Creates an asset from any drawable (image bitmap, canvas) without a pixel round trip. */
  createFrom(id, source, w = source.width, h = source.height) {
    const canvas = makeCanvas(w, h);
    const ctx = ctx2d(canvas, true);
    ctx.drawImage(source, 0, 0, w, h);
    this.images.set(id, { canvas, ctx, w, h, version: (this.images.get(id)?.version ?? 0) + 1 });
    this.touched(id);
  }

  /** Applies a pixel operation and returns its inverse (or null). */
  apply(op) {
    if (op.t === 'asset') {
      if (op.data && op.data.length !== op.w * op.h * 4) throw new Error('Asset size does not match its pixels');
      this.create(op.id, op.w, op.h, op.data ?? null);
      return null;
    }
    const a = this.images.get(op.id);
    if (!a) throw new Error(`No asset ${op.id}`);
    if (op.t === 'patch') {
      if (op.x < 0 || op.y < 0 || op.x + op.w > a.w || op.y + op.h > a.h) throw new Error('Patch outside the image');
      const before = a.ctx.getImageData(op.x, op.y, op.w, op.h).data;
      a.ctx.putImageData(new ImageData(new Uint8ClampedArray(op.data), op.w, op.h), op.x, op.y);
      a.version++;
      this.touched(op.id, { x: op.x, y: op.y, w: op.w, h: op.h });
      return { t: 'patch', id: op.id, x: op.x, y: op.y, w: op.w, h: op.h, data: before };
    }
    if (op.t === 'replace') {
      const before = { t: 'replace', id: op.id, w: a.w, h: a.h, data: a.ctx.getImageData(0, 0, a.w, a.h).data };
      const canvas = makeCanvas(op.w, op.h);
      const ctx = ctx2d(canvas, true);
      ctx.putImageData(new ImageData(new Uint8ClampedArray(op.data), op.w, op.h), 0, 0);
      this.images.set(op.id, { canvas, ctx, w: op.w, h: op.h, version: a.version + 1 });
      this.touched(op.id);
      return before;
    }
    throw new Error(`Unknown pixel operation ${op.t}`);
  }

  /** PNG bytes of an asset, cached per version. */
  async png(id) {
    const a = this.images.get(id);
    if (!a) throw new Error(`No asset ${id}`);
    const hit = this.encoded.get(id);
    if (hit && hit.version === a.version) return hit.bytes;
    const blob = await canvasToBlob(a.canvas, 'image/png');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    this.encoded.set(id, { version: a.version, bytes });
    return bytes;
  }

  /** Loads an asset from encoded bytes (PNG, JPEG...). */
  async load(id, bytes, mime = 'image/png') {
    const bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
    this.createFrom(id, bmp);
    bmp.close?.();
  }

  clear() {
    this.images.clear();
    this.encoded.clear();
  }
}
