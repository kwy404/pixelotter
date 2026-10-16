// The cutout model on the page side: downloads it once (with progress), checks its SHA-256,
// keeps it in the browser's cache storage for offline use, and runs it in a worker.
// If anything fails, the error says in plain words what happened and what to try.

import { DOWNLOAD_BYTES, MODEL, RUNTIME } from '../lib/segment.js';
import { sha256Hex } from '../lib/transfer.js';

const CACHE = 'pixelotter-model-v1';

export class ModelError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export class Segmenter {
  constructor() {
    this.state = 'idle';
    this.worker = null;
    this.ready = null;
    this.calls = new Map();
    this.next = 1;
    this.listeners = new Set();
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(info) {
    Object.assign(this, info);
    for (const fn of this.listeners) fn({ state: this.state, progress: this.progress ?? 0, error: this.error ?? null });
  }

  /** True when the model file is already in the cache (no download needed). */
  async isCached() {
    try {
      const c = await caches.open(CACHE);
      return !!(await c.match(MODEL.urls[0]));
    } catch {
      return false;
    }
  }

  async fetchModel() {
    let cache = null;
    try {
      cache = await caches.open(CACHE);
      const hit = await cache.match(MODEL.urls[0]);
      if (hit) {
        const bytes = new Uint8Array(await hit.arrayBuffer());
        if ((await sha256Hex(bytes)) === MODEL.sha256) return bytes;
        await cache.delete(MODEL.urls[0]);
      }
    } catch {
      cache = null;
    }
    if (!navigator.onLine) throw new ModelError('offline', 'The cutout model has not been downloaded yet, and this device is offline. Connect once to download it (about 16 MB); after that it works offline.');
    let lastErr = null;
    for (const url of MODEL.urls) {
      try {
        const res = await fetch(url, { mode: 'cors' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const total = Number(res.headers.get('content-length')) || MODEL.bytes;
        const reader = res.body.getReader();
        const parts = [];
        let got = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parts.push(value);
          got += value.length;
          this.emit({ state: 'loading', progress: Math.min(0.95, (got / total) * 0.8) });
        }
        const bytes = new Uint8Array(got);
        let o = 0;
        for (const p of parts) {
          bytes.set(p, o);
          o += p.length;
        }
        if ((await sha256Hex(bytes)) !== MODEL.sha256) throw new Error('checksum mismatch');
        if (cache) await cache.put(MODEL.urls[0], new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } }));
        return bytes;
      } catch (err) {
        lastErr = err;
      }
    }
    throw new ModelError('download', `The cutout model could not be downloaded (${lastErr?.message ?? 'network error'}). Check the connection and try again.`);
  }

  /** Loads everything once. Resolves when the model can run. */
  ensure() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      this.emit({ state: 'loading', progress: 0.02, error: null });
      if (typeof WebAssembly === 'undefined') throw new ModelError('wasm', 'This browser cannot run WebAssembly, which the cutout model needs. Try a current version of your browser.');
      const bytes = await this.fetchModel();
      this.emit({ state: 'loading', progress: 0.85 });
      try {
        this.worker = new Worker(new URL('./segment-worker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = ({ data }) => {
          const call = this.calls.get(data.id);
          if (!call) return;
          this.calls.delete(data.id);
          if (data.ok) call.resolve(data);
          else call.reject(new ModelError('run', data.error));
        };
        this.worker.onerror = (e) => {
          for (const c of this.calls.values()) c.reject(new ModelError('worker', e.message || 'The model worker stopped'));
          this.calls.clear();
        };
        await this.call({ type: 'init', bytes }, [bytes.buffer]);
      } catch (err) {
        throw new ModelError('runtime', `The model runtime could not start (${err.message}). It loads once from the internet (${RUNTIME.name} ${RUNTIME.version}); check the connection, or try another browser.`);
      }
      this.emit({ state: 'ready', progress: 1 });
    })().catch((err) => {
      this.ready = null;
      this.emit({ state: 'error', error: err.message });
      throw err;
    });
    return this.ready;
  }

  call(msg, transfer = []) {
    return new Promise((resolve, reject) => {
      const id = this.next++;
      this.calls.set(id, { resolve, reject });
      this.worker.postMessage({ ...msg, id }, transfer);
    });
  }

  /** A mask (one byte per pixel) of the main subject of an RGBA image. */
  async segment(rgba, width, height) {
    await this.ensure();
    const copy = new Uint8ClampedArray(rgba);
    const res = await this.call({ type: 'run', rgba: copy, width, height }, [copy.buffer]);
    return res.mask;
  }
}

export const DOWNLOAD_MB = Math.round(DOWNLOAD_BYTES / 1e6);
