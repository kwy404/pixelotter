// Shared test helpers: deterministic data, small images, an in memory document engine and an
// in memory relay broker.
import { applyOps, findLayer, isDocOp, normalizeDoc } from '../src/doc.js';
import { PixelStore, isPixelOp } from '../src/pixels.js';
import { Emitter } from '../src/emitter.js';

export function randomData(size, seed = 1) {
  const out = new Uint8Array(size);
  let s = (seed * 2654435761) >>> 0 || 1;
  for (let i = 0; i < size; i++) {
    // xorshift32: cheap, deterministic and not compressible
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    out[i] = s & 255;
  }
  return out;
}

/** A w by h RGBA image filled with one color, or with fn(x, y) => [r, g, b, a]. */
export function makeImage(w, h, fill = [128, 128, 128, 255]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = typeof fill === 'function' ? fill(x, y) : fill;
      data.set(c.length === 4 ? c : [...c, 255], (y * w + x) * 4);
    }
  }
  return { data, width: w, height: h };
}

export const pixel = (img, x, y) => Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

/** A document engine on plain arrays, the same contract the editor and the session use. */
export class MemoryEngine {
  constructor(doc) {
    this.doc = doc;
    this.pixels = new PixelStore();
  }
  apply(ops) {
    const inverse = [];
    for (const op of ops) {
      if (isPixelOp(op)) {
        const inv = this.pixels.apply(op);
        if (inv) inverse.push(inv);
      } else if (isDocOp(op)) {
        inverse.push(...applyOps(this.doc, [op]));
      } else throw new Error(`Unknown op ${op?.t}`);
    }
    return inverse;
  }
  async snapshot() {
    const assets = [...this.pixels.images].map(([id, img]) => ({ id, w: img.width, h: img.height, data: new Uint8ClampedArray(img.data) }));
    return { doc: JSON.parse(JSON.stringify(this.doc)), assets };
  }
  async load(snap) {
    this.doc = normalizeDoc(snap.doc);
    this.pixels = new PixelStore();
    for (const a of snap.assets) this.pixels.apply({ t: 'asset', id: a.id, w: a.w, h: a.h, data: a.data });
  }
  layerOf(asset) {
    return this.doc.layers.find((l) => l.asset === asset || l.mask?.asset === asset)?.id ?? null;
  }
  hasLayer(id) {
    return !!findLayer(this.doc, id);
  }
  /** A stable fingerprint of the document and every pixel, to compare two engines. */
  fingerprint() {
    const assets = [...this.pixels.images.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, img]) => [id, img.width, img.height, Array.from(img.data).join(',')]);
    return JSON.stringify({ layers: this.doc.layers, w: this.doc.width, h: this.doc.height, assets });
  }
}

/** An in memory MQTT like broker: hubs on the same topic hear each other. */
export class FakeBroker {
  constructor() {
    this.hubs = new Set();
  }
  hub(topic) {
    const broker = this;
    const h = new (class extends Emitter {
      constructor() {
        super();
        this.topic = topic;
      }
      async start() {
        broker.hubs.add(this);
        return this;
      }
      status() {
        return { connected: ['memory'], total: 1 };
      }
      publish(payload) {
        for (const other of broker.hubs) if (other.topic === this.topic) setTimeout(() => other.emit('message', { payload: payload.slice(), broker: 'memory' }), 1);
        return 1;
      }
      close() {
        broker.hubs.delete(this);
      }
    })();
    return h;
  }
}

/** Two ports that deliver messages to each other asynchronously, in order. */
export function portPair() {
  const a = { inbox: null, send: (m) => setTimeout(() => b.inbox?.(structuredClone(m)), 0) };
  const b = { inbox: null, send: (m) => setTimeout(() => a.inbox?.(structuredClone(m)), 0) };
  return [a, b];
}

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

export async function until(fn, timeout = 5000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error('Timed out waiting');
    await tick(5);
  }
}
