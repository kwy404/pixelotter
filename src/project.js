// The .pxo project file: one binary file that keeps every layer, mask and setting.
//   bytes 0..3   "PXO" and a format version byte (1)
//   bytes 4..7   manifest length, unsigned 32 bit big endian
//   manifest     UTF-8 JSON: { format, version, app, saved, doc, assets: [...], thumbnail }
//   payload      the asset files back to back (PNG for pixels), at the offsets in the manifest
// Every asset carries its SHA-256, checked on open, so a damaged file is reported instead of
// opening with broken layers. The same container is used for autosave and recovery.

import { fromUtf8, utf8 } from './bytes.js';
import { Sha256 } from './sha256.js';
import { assetIds, normalizeDoc } from './doc.js';

export const PXO_MAGIC = [0x50, 0x58, 0x4f];
export const PXO_VERSION = 1;
export const PROJECT_FORMAT = 'pixelotter-project';
export const PROJECT_EXT = '.pxo';
export const PROJECT_MIME = 'application/x-pixelotter';
const MAX_MANIFEST = 8 * 1024 * 1024;

export class ProjectError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const hex = (bytes) => new Sha256().update(bytes).hex();

/** True when the bytes start like a .pxo file. */
export const isProject = (bytes) => bytes?.length >= 8 && PXO_MAGIC.every((b, i) => bytes[i] === b);

/**
 * Packs a document and its assets.
 * assets: [{ id, w, h, mime, bytes }], thumbnail: { mime, bytes } or null.
 */
export function packProject({ doc, assets = [], thumbnail = null, app = '0.1.0', saved = Date.now() }) {
  const needed = new Set(assetIds(doc));
  const list = assets.filter((a) => needed.has(a.id));
  for (const id of needed) if (!list.some((a) => a.id === id)) throw new ProjectError('missing', `Asset ${id} is missing`);
  let offset = 0;
  const entries = list.map((a) => {
    const e = { id: a.id, w: a.w, h: a.h, mime: a.mime || 'image/png', offset, length: a.bytes.length, sha256: hex(a.bytes) };
    offset += a.bytes.length;
    return e;
  });
  let thumb = null;
  if (thumbnail?.bytes?.length) {
    thumb = { mime: thumbnail.mime || 'image/jpeg', offset, length: thumbnail.bytes.length };
    offset += thumbnail.bytes.length;
  }
  const manifest = utf8(JSON.stringify({ format: PROJECT_FORMAT, version: PXO_VERSION, app, saved, doc, assets: entries, thumbnail: thumb }));
  const out = new Uint8Array(8 + manifest.length + offset);
  out.set(PXO_MAGIC, 0);
  out[3] = PXO_VERSION;
  new DataView(out.buffer).setUint32(4, manifest.length);
  out.set(manifest, 8);
  let at = 8 + manifest.length;
  for (const a of list) {
    out.set(a.bytes, at);
    at += a.bytes.length;
  }
  if (thumb) out.set(thumbnail.bytes, at);
  return out;
}

/** Reads a .pxo file. Returns { doc, assets, thumbnail, saved, app }. Throws ProjectError. */
export function unpackProject(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!isProject(bytes)) throw new ProjectError('format', 'This is not a pixelotter project file');
  if (bytes[3] > PXO_VERSION) throw new ProjectError('version', 'This project was saved by a newer version of pixelotter');
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4);
  if (length > MAX_MANIFEST || 8 + length > bytes.length) throw new ProjectError('damaged', 'The project file is damaged or incomplete');
  let manifest;
  try {
    manifest = JSON.parse(fromUtf8(bytes.subarray(8, 8 + length)));
  } catch {
    throw new ProjectError('damaged', 'The project file is damaged or incomplete');
  }
  if (manifest?.format !== PROJECT_FORMAT) throw new ProjectError('format', 'This is not a pixelotter project file');
  const base = 8 + length;
  const payload = bytes.length - base;
  let doc;
  try {
    doc = normalizeDoc(manifest.doc);
  } catch (err) {
    throw new ProjectError('damaged', err.message);
  }
  const assets = [];
  for (const e of Array.isArray(manifest.assets) ? manifest.assets : []) {
    if (!Number.isInteger(e.offset) || !Number.isInteger(e.length) || e.offset < 0 || e.length < 0 || e.offset + e.length > payload) {
      throw new ProjectError('damaged', 'The project file is damaged or incomplete');
    }
    const data = bytes.slice(base + e.offset, base + e.offset + e.length);
    if (hex(data) !== e.sha256) throw new ProjectError('hash', `Layer data ${e.id} is damaged (checksum mismatch)`);
    assets.push({ id: String(e.id), w: e.w | 0, h: e.h | 0, mime: String(e.mime || 'image/png'), bytes: data });
  }
  for (const id of assetIds(doc)) if (!assets.some((a) => a.id === id)) throw new ProjectError('missing', `Layer data ${id} is missing`);
  let thumbnail = null;
  const t = manifest.thumbnail;
  if (t && Number.isInteger(t.offset) && Number.isInteger(t.length) && t.offset + t.length <= payload) {
    thumbnail = { mime: String(t.mime || 'image/jpeg'), bytes: bytes.slice(base + t.offset, base + t.offset + t.length) };
  }
  return { doc, assets, thumbnail, saved: Number(manifest.saved) || 0, app: String(manifest.app || '') };
}

/** A file name for saving: the document name without characters file systems reject. */
export function projectFileName(name, ext = PROJECT_EXT) {
  const base = String(name || 'Untitled')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'Untitled';
  return base.toLowerCase().endsWith(ext) ? base : `${base}${ext}`;
}
