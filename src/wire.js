// Messages over a WebRTC data channel. A message is a JSON object that may hold binary values
// (Uint8Array or Uint8ClampedArray) anywhere inside it. Each message is cut into frames no larger
// than FRAME_BYTES, because data channels limit the size of one send:
//   byte 0      frame kind: 1 = message frame
//   bytes 1..4  message id (uint32)
//   bytes 5..8  frame index, bytes 9..12 frame count
//   rest        a slice of the body
// The body is: uint32 JSON length, the JSON (binary values replaced by { $b: n }), then each
// binary value as uint32 length plus bytes. Large bodies are compressed with deflate-raw.

import { concatBytes, fromUtf8, utf8 } from './bytes.js';

export const FRAME_BYTES = 60 * 1024;
// messages of at least this many frames report their progress (about half a megabyte)
const PROGRESS_FRAMES = 8;
const HEAD = 13;
const MAX_MESSAGE = 512 * 1024 * 1024;

const isBin = (v) => v instanceof Uint8Array || v instanceof Uint8ClampedArray;

/** Splits a value into JSON with placeholders and a list of binary parts. */
export function extractBinary(value) {
  const parts = [];
  const walk = (v) => {
    if (isBin(v)) {
      parts.push({ bytes: v instanceof Uint8Array ? v : new Uint8Array(v.buffer, v.byteOffset, v.byteLength), clamped: v instanceof Uint8ClampedArray });
      return { $b: parts.length - 1, ...(v instanceof Uint8ClampedArray ? { $c: 1 } : {}) };
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v)) if (x !== undefined) o[k] = walk(x);
      return o;
    }
    return v;
  };
  return { json: walk(value), parts };
}

export function restoreBinary(json, parts) {
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      if (typeof v.$b === 'number' && Object.keys(v).every((k) => k === '$b' || k === '$c')) {
        const p = parts[v.$b];
        if (!p) throw new Error('Missing binary part');
        return v.$c ? new Uint8ClampedArray(p.buffer, p.byteOffset, p.byteLength) : p;
      }
      const o = {};
      for (const [k, x] of Object.entries(v)) o[k] = walk(x);
      return o;
    }
    return v;
  };
  return walk(json);
}

async function pipe(bytes, stream) {
  const out = await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(out);
}

/** Encodes a message body. Returns { body, compressed }. */
export async function encodeBody(message, { compressAbove = 16 * 1024 } = {}) {
  const { json, parts } = extractBinary(message);
  const text = utf8(JSON.stringify(json));
  const chunks = [];
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, text.length);
  chunks.push(len, text);
  for (const p of parts) {
    const l = new Uint8Array(4);
    new DataView(l.buffer).setUint32(0, p.bytes.length);
    chunks.push(l, p.bytes);
  }
  let body = concatBytes(chunks);
  let compressed = false;
  if (body.length > compressAbove && typeof CompressionStream !== 'undefined') {
    const small = await pipe(body, new CompressionStream('deflate-raw'));
    if (small.length < body.length * 0.9) {
      body = small;
      compressed = true;
    }
  }
  return { body, compressed };
}

export async function decodeBody(body, compressed) {
  const bytes = compressed ? await pipe(body, new DecompressionStream('deflate-raw')) : body;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jl = view.getUint32(0);
  const json = JSON.parse(fromUtf8(bytes.subarray(4, 4 + jl)));
  const parts = [];
  let at = 4 + jl;
  while (at < bytes.length) {
    const l = view.getUint32(at);
    parts.push(bytes.slice(at + 4, at + 4 + l));
    at += 4 + l;
  }
  return restoreBinary(json, parts);
}

/** Cuts a message into frames. */
export async function encodeFrames(id, message, opts = {}) {
  const { body, compressed } = await encodeBody(message, opts);
  const size = opts.frameBytes ?? FRAME_BYTES;
  const count = Math.max(1, Math.ceil(body.length / size));
  const frames = [];
  for (let i = 0; i < count; i++) {
    const slice = body.subarray(i * size, (i + 1) * size);
    const f = new Uint8Array(HEAD + slice.length);
    f[0] = compressed ? 2 : 1;
    const v = new DataView(f.buffer);
    v.setUint32(1, id >>> 0);
    v.setUint32(5, i);
    v.setUint32(9, count);
    f.set(slice, HEAD);
    frames.push(f);
  }
  return frames;
}

/** Puts frames back together. push(frame) resolves to the message once complete, else null. */
export class Assembler {
  constructor({ onProgress = null } = {}) {
    this.pending = new Map();
    this.onProgress = onProgress;
  }
  async push(frame) {
    const f = frame instanceof Uint8Array ? frame : new Uint8Array(frame);
    if (f.length < HEAD || (f[0] !== 1 && f[0] !== 2)) throw new Error('Not a message frame');
    const v = new DataView(f.buffer, f.byteOffset, f.byteLength);
    const id = v.getUint32(1);
    const index = v.getUint32(5);
    const count = v.getUint32(9);
    if (!count || index >= count || count * FRAME_BYTES > MAX_MESSAGE * 2) throw new Error('Bad frame header');
    let entry = this.pending.get(id);
    if (!entry) {
      entry = { parts: new Array(count), got: 0, compressed: f[0] === 2 };
      this.pending.set(id, entry);
    }
    if (!entry.parts[index]) {
      entry.parts[index] = f.slice(HEAD);
      entry.got++;
      if (count >= PROGRESS_FRAMES) this.onProgress?.({ dir: 'receive', id, done: entry.got, total: count });
    }
    if (entry.got < count) return null;
    this.pending.delete(id);
    return decodeBody(concatBytes(entry.parts), entry.compressed);
  }
}

/**
 * A message channel over a link { send(bytes), bufferedAmount(), drained() }. Messages are sent
 * in order; a large one waits for the send buffer to drain between frames.
 */
export class MessagePort {
  constructor(link, { highWater = 1024 * 1024, onProgress = null } = {}) {
    this.link = link;
    this.highWater = highWater;
    this.nextId = 1;
    this.queue = Promise.resolve();
    this.onProgress = onProgress;
    this.assembler = new Assembler({ onProgress });
  }
  send(message) {
    const id = this.nextId++;
    this.queue = this.queue.then(async () => {
      const frames = await encodeFrames(id, message);
      for (let i = 0; i < frames.length; i++) {
        if (this.link.bufferedAmount() > this.highWater) await this.link.drained();
        this.link.send(frames[i]);
        if (frames.length >= PROGRESS_FRAMES) this.onProgress?.({ dir: 'send', id, done: i + 1, total: frames.length });
      }
    });
    return this.queue;
  }
  /** Feed a received frame. Resolves to a complete message or null. */
  receive(frame) {
    return this.assembler.push(frame);
  }
}
