// "Send to a friend in full quality": one file, byte for byte. The sender hashes the exact
// bytes with SHA-256 and sends them with the hash; the receiver hashes what arrived and only
// accepts the file when both hashes match. Nothing is recompressed or resized on the way.

import { toHex } from './bytes.js';
import { Sha256 } from './sha256.js';

export const MAX_FILE_BYTES = 512 * 1024 * 1024;

/** SHA-256 hex of bytes, with WebCrypto when it is there and the bundled hash otherwise. */
export async function sha256Hex(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) return toHex(new Uint8Array(await subtle.digest('SHA-256', bytes)));
  return new Sha256().update(bytes).hex();
}

const cleanName = (name) =>
  String(name || 'photo')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
    .slice(0, 120) || 'photo';

/** The message that carries a file. */
export async function fileMessage(bytes, { name, mime }) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data.length > MAX_FILE_BYTES) throw new Error('This file is too large to send in one piece');
  return { t: 'file', name: cleanName(name), mime: String(mime || 'application/octet-stream').slice(0, 80), size: data.length, sha256: await sha256Hex(data), data };
}

/**
 * Checks a received file message. Returns { ok, name, mime, size, sha256, expected, data }.
 * ok is false when the size or the hash differs from what the sender announced.
 */
export async function receiveFile(msg) {
  if (!msg || msg.t !== 'file' || !(msg.data instanceof Uint8Array)) throw new Error('Not a file message');
  const sha256 = await sha256Hex(msg.data);
  const ok = msg.data.length === msg.size && sha256 === msg.sha256;
  return { ok, name: cleanName(msg.name), mime: String(msg.mime || ''), size: msg.data.length, sha256, expected: String(msg.sha256), data: msg.data };
}

/** The receipt the receiver sends back, so the sender can show "delivered and verified". */
export const fileReceipt = (result) => ({ t: 'file-receipt', ok: result.ok, sha256: result.sha256, size: result.size });
