// Generated from src/formats/raw.js by scripts/build-app.mjs. Edit the source, not this copy.
// Camera raw files, read only, through their embedded preview. Decoding raw sensor data
// (demosaicing, white balance, camera color matrices) needs a full raw developer; there is no
// small permissively licensed one we can ship, so pixelotter opens the largest JPEG preview the
// camera stored in the file, which is usually full size or close to it. The app says so.

import { Reader } from './binary.js';
import { readIfds } from './tiff.js';
import { RAW_EXTENSIONS, isRaw } from './magic.js';

export { RAW_EXTENSIONS, isRaw };


/** The end of a JPEG that starts at `start`, walking its segments; -1 if it is not valid. */
export function jpegEnd(bytes, start) {
  if (bytes[start] !== 0xff || bytes[start + 1] !== 0xd8) return -1;
  let p = start + 2;
  while (p + 2 <= bytes.length) {
    if (bytes[p] !== 0xff) return -1;
    const marker = bytes[p + 1];
    if (marker === 0xd9) return p + 2;
    if (marker === 0xff) {
      p++;
      continue;
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      p += 2;
      continue;
    }
    const len = (bytes[p + 2] << 8) | bytes[p + 3];
    if (len < 2) return -1;
    p += 2 + len;
    if (marker === 0xda) {
      // entropy coded data until the next marker that is not a restart or a stuffed byte
      while (p + 1 < bytes.length) {
        if (bytes[p] === 0xff && bytes[p + 1] !== 0 && !(bytes[p + 1] >= 0xd0 && bytes[p + 1] <= 0xd7)) break;
        p++;
      }
    }
  }
  return -1;
}

/** Candidate embedded JPEG previews, largest first: [{ offset, length }]. */
export function findPreviews(bytes) {
  const found = new Map();
  const addAt = (off, len = 0) => {
    if (off <= 0 || off >= bytes.length) return;
    const end = len ? off + len : jpegEnd(bytes, off);
    if (end > off && bytes[off] === 0xff && bytes[off + 1] === 0xd8) found.set(off, Math.min(bytes.length, end) - off);
  };
  const head = String.fromCharCode(...bytes.subarray(0, 16));
  if (head.startsWith('FUJIFILMCCD-RAW')) {
    const r = new Reader(bytes);
    r.seek(84);
    addAt(r.u32(), r.u32());
  }
  const tiffLike = (bytes[0] === 0x49 && bytes[1] === 0x49) || (bytes[0] === 0x4d && bytes[1] === 0x4d);
  if (tiffLike) {
    try {
      const ifds = readIfds(bytes, { subIfds: true, anyMagic: true });
      for (const { tags } of ifds) {
        if (tags.has(513)) addAt(tags.get(513)[0], tags.get(514)?.[0] ?? 0);
        const comp = tags.get(259)?.[0];
        if ((comp === 6 || comp === 7) && tags.get(273)?.length === 1) addAt(tags.get(273)[0], tags.get(279)?.[0] ?? 0);
      }
    } catch {
      // fall through to scanning
    }
  }
  if (!found.size) {
    // scan for JPEG streams anywhere in the file
    for (let i = 0; i + 3 < bytes.length; i++) {
      if (bytes[i] === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff) {
        const end = jpegEnd(bytes, i);
        if (end > 0) {
          found.set(i, end - i);
          i = end - 1;
        }
      }
    }
  }
  return [...found.entries()].map(([offset, length]) => ({ offset, length })).sort((a, b) => b.length - a.length);
}
