// Generated from src/formats/binary.js by scripts/build-app.mjs. Edit the source, not this copy.
// Byte level helpers shared by the file format readers and writers: a cursor over a DataView,
// a growable writer, PackBits, zlib and raw deflate through the platform streams, and CRC-32.

export class FormatError extends Error {
  constructor(message, code = 'format') {
    super(message);
    this.code = code;
  }
}

export class Reader {
  constructor(bytes, { little = false, offset = 0 } = {}) {
    this.bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.little = little;
    this.pos = offset;
  }
  get length() {
    return this.bytes.length;
  }
  get left() {
    return this.bytes.length - this.pos;
  }
  need(n) {
    if (n < 0 || this.pos + n > this.bytes.length) throw new FormatError('The file ends too early', 'truncated');
  }
  seek(p) {
    if (p < 0 || p > this.bytes.length) throw new FormatError('A pointer in the file goes outside it', 'damaged');
    this.pos = p;
    return this;
  }
  skip(n) {
    this.need(n);
    this.pos += n;
    return this;
  }
  u8() {
    this.need(1);
    return this.bytes[this.pos++];
  }
  i8() {
    this.need(1);
    return this.view.getInt8(this.pos++);
  }
  u16(little = this.little) {
    this.need(2);
    const v = this.view.getUint16(this.pos, little);
    this.pos += 2;
    return v;
  }
  i16(little = this.little) {
    this.need(2);
    const v = this.view.getInt16(this.pos, little);
    this.pos += 2;
    return v;
  }
  u32(little = this.little) {
    this.need(4);
    const v = this.view.getUint32(this.pos, little);
    this.pos += 4;
    return v;
  }
  i32(little = this.little) {
    this.need(4);
    const v = this.view.getInt32(this.pos, little);
    this.pos += 4;
    return v;
  }
  u64(little = this.little) {
    const a = this.u32(little);
    const b = this.u32(little);
    return little ? b * 2 ** 32 + a : a * 2 ** 32 + b;
  }
  f32(little = this.little) {
    this.need(4);
    const v = this.view.getFloat32(this.pos, little);
    this.pos += 4;
    return v;
  }
  f64(little = this.little) {
    this.need(8);
    const v = this.view.getFloat64(this.pos, little);
    this.pos += 8;
    return v;
  }
  bytesAt(n) {
    this.need(n);
    const out = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  ascii(n) {
    let s = '';
    for (const b of this.bytesAt(n)) s += String.fromCharCode(b);
    return s;
  }
  /** A NUL terminated ASCII string. */
  cstring(max = 1 << 20) {
    let s = '';
    while (this.pos < this.bytes.length && s.length < max) {
      const b = this.bytes[this.pos++];
      if (b === 0) return s;
      s += String.fromCharCode(b);
    }
    return s;
  }
}

export class Writer {
  constructor(size = 1 << 16, { little = false } = {}) {
    this.buf = new Uint8Array(size);
    this.view = new DataView(this.buf.buffer);
    this.pos = 0;
    this.little = little;
  }
  ensure(n) {
    if (this.pos + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.pos + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
  u8(v) {
    this.ensure(1);
    this.buf[this.pos++] = v & 255;
    return this;
  }
  i8(v) {
    this.ensure(1);
    this.view.setInt8(this.pos++, v);
    return this;
  }
  u16(v, little = this.little) {
    this.ensure(2);
    this.view.setUint16(this.pos, v, little);
    this.pos += 2;
    return this;
  }
  i16(v, little = this.little) {
    this.ensure(2);
    this.view.setInt16(this.pos, v, little);
    this.pos += 2;
    return this;
  }
  u32(v, little = this.little) {
    this.ensure(4);
    this.view.setUint32(this.pos, v >>> 0, little);
    this.pos += 4;
    return this;
  }
  i32(v, little = this.little) {
    this.ensure(4);
    this.view.setInt32(this.pos, v, little);
    this.pos += 4;
    return this;
  }
  u64(v, little = this.little) {
    const hi = Math.floor(v / 2 ** 32);
    const lo = v >>> 0;
    if (little) this.u32(lo, true).u32(hi, true);
    else this.u32(hi).u32(lo);
    return this;
  }
  f32(v, little = this.little) {
    this.ensure(4);
    this.view.setFloat32(this.pos, v, little);
    this.pos += 4;
    return this;
  }
  bytes(b) {
    this.ensure(b.length);
    this.buf.set(b, this.pos);
    this.pos += b.length;
    return this;
  }
  ascii(s) {
    this.ensure(s.length);
    for (let i = 0; i < s.length; i++) this.buf[this.pos++] = s.charCodeAt(i) & 255;
    return this;
  }
  pad(n, v = 0) {
    this.ensure(n);
    this.buf.fill(v, this.pos, this.pos + n);
    this.pos += n;
    return this;
  }
  /** Writes a placeholder and returns a function that fills it later (u32). */
  later32(little = this.little) {
    const at = this.pos;
    this.u32(0, little);
    return (v) => this.view.setUint32(at, v >>> 0, little);
  }
  later64(little = this.little) {
    const at = this.pos;
    this.u64(0, little);
    return (v) => {
      const save = this.pos;
      this.pos = at;
      this.u64(v, little);
      this.pos = save;
    };
  }
  done() {
    return this.buf.slice(0, this.pos);
  }
}

/** PackBits (used by PSD, TIFF and others). */
export function packBits(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    // a run of at least 3 equal bytes
    let run = 1;
    while (i + run < n && run < 128 && src[i + run] === src[i]) run++;
    if (run >= 3) {
      out.push(257 - run, src[i]);
      i += run;
      continue;
    }
    // literal bytes until a run of 3 starts
    let start = i;
    let len = 0;
    while (i < n && len < 128) {
      if (i + 2 < n && src[i] === src[i + 1] && src[i] === src[i + 2]) break;
      i++;
      len++;
    }
    out.push(len - 1);
    for (let k = start; k < start + len; k++) out.push(src[k]);
  }
  return Uint8Array.from(out);
}

export function unpackBits(src, size) {
  const out = new Uint8Array(size);
  let i = 0;
  let o = 0;
  while (o < size && i < src.length) {
    const h = src[i++];
    const n = h > 127 ? h - 256 : h;
    if (n >= 0) {
      const len = Math.min(n + 1, size - o, src.length - i);
      out.set(src.subarray(i, i + len), o);
      i += n + 1;
      o += len;
    } else if (n !== -128) {
      const len = Math.min(1 - n, size - o);
      out.fill(src[i++], o, o + len);
      o += len;
    }
  }
  return out;
}

async function pipe(bytes, stream) {
  const out = await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(out);
}

/** zlib (RFC 1950) compress and decompress. */
export const zlibDeflate = (bytes) => pipe(bytes, new CompressionStream('deflate'));
export async function zlibInflate(bytes) {
  try {
    return await pipe(bytes, new DecompressionStream('deflate'));
  } catch {
    throw new FormatError('Compressed data in the file is damaged', 'damaged');
  }
}
export const rawDeflate = (bytes) => pipe(bytes, new CompressionStream('deflate-raw'));
export async function rawInflate(bytes) {
  try {
    return await pipe(bytes, new DecompressionStream('deflate-raw'));
  } catch {
    throw new FormatError('Compressed data in the file is damaged', 'damaged');
  }
}

const CRC = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC[n] = c >>> 0;
}
export function crc32(bytes, start = 0xffffffff) {
  let c = start;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return c;
}
export const crcDone = (c) => (c ^ 0xffffffff) >>> 0;

export const ascii = (s) => Uint8Array.from(s, (ch) => ch.charCodeAt(0) & 255);
export const startsWith = (bytes, sig, at = 0) => sig.every((b, i) => bytes[at + i] === b);

/** Makes an empty RGBA image record. */
export function image(width, height, data = null) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new FormatError('The image has no size', 'damaged');
  if (width * height > 268435456) throw new FormatError('The image is too large to open in a browser', 'too-large');
  return { width, height, data: data ?? new Uint8ClampedArray(width * height * 4) };
}
