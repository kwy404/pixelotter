// Magic byte checks for every format, kept apart from the codecs so the app can recognize a
// file without loading the code that reads it (the codecs load on first use).

import { startsWith } from './binary.js';

export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const isPng = (b) => startsWith(b, PNG_SIGNATURE);
export const isGif = (b) => startsWith(b, [0x47, 0x49, 0x46, 0x38]);
export const isBmp = (b) => startsWith(b, [0x42, 0x4d]);
export const isIco = (b) => startsWith(b, [0, 0, 1, 0]) && b.length > 22 && b[4] + b[5] * 256 > 0;
export const isHdr = (b) => startsWith(b, [0x23, 0x3f]); // "#?"
export const isExr = (b) => startsWith(b, [0x76, 0x2f, 0x31, 0x01]);
export const isPdf = (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46]);
export const isPsd = (b) => startsWith(b, [0x38, 0x42, 0x50, 0x53]);
export const isTiff = (b) => startsWith(b, [0x49, 0x49, 0x2a, 0x00]) || startsWith(b, [0x4d, 0x4d, 0x00, 0x2a]);
export const isPnm = (b) => b[0] === 0x50 && b[1] >= 0x31 && b[1] <= 0x37 && [0x0a, 0x0d, 0x20, 0x09].includes(b[2]);

/** TGA has no magic number; this checks that the header makes sense. */
export function looksLikeTga(b) {
  if (b.length < 18) return false;
  const cmapType = b[1];
  const type = b[2];
  const depth = b[16];
  return cmapType <= 1 && [1, 2, 3, 9, 10, 11].includes(type) && [8, 15, 16, 24, 32].includes(depth) && b[12] + b[13] * 256 > 0 && b[14] + b[15] * 256 > 0;
}

export const RAW_EXTENSIONS = ['cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'dng', 'orf', 'rw2', 'raf', 'pef', 'srw', 'raw', 'rwl', '3fr', 'erf', 'kdc', 'mrw', 'x3f'];

export function isRaw(bytes, name = '') {
  const ext = String(name).toLowerCase().split('.').pop();
  if (RAW_EXTENSIONS.includes(ext)) return true;
  const s = String.fromCharCode(...bytes.subarray(0, 16));
  return s.startsWith('FUJIFILMCCD-RAW') || s.startsWith('IIRO') || s.startsWith('IIU\0') || (s.slice(4, 12) === 'ftypcrx ');
}
