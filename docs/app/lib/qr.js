// Generated from src/qr.js by scripts/build-app.mjs. Edit the source, not this copy.
// QR code encoder written from the ISO/IEC 18004 rules: byte mode, versions 1 to 40,
// error correction levels L, M, Q and H, Reed-Solomon codes over GF(256), all eight masks
// scored with the standard penalty rules. No dependencies.

import { utf8 } from './bytes.js';

export const ECC = {
  L: { ordinal: 0, formatBits: 1 },
  M: { ordinal: 1, formatBits: 0 },
  Q: { ordinal: 2, formatBits: 3 },
  H: { ordinal: 3, formatBits: 2 },
};

// Error correction codewords per block, indexed [level][version].
const ECC_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];

// Number of error correction blocks, indexed [level][version].
const NUM_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

/** Modules available for data and error correction bits in a version, after function patterns. */
export function rawDataModules(ver) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

export function dataCodewords(ver, ecl) {
  return Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ecl.ordinal][ver] * NUM_BLOCKS[ecl.ordinal][ver];
}

/** Largest byte payload that fits in a version and level, in byte mode. */
export function byteCapacity(ver, ecl) {
  const bits = dataCodewords(ver, ecl) * 8 - 4 - (ver < 10 ? 8 : 16);
  return Math.floor(bits / 8);
}

// GF(256) with the QR polynomial x^8 + x^4 + x^3 + x^2 + 1.
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

export function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/** Generator polynomial coefficients (highest degree term omitted) for `degree` ECC codewords. */
export function rsGenerator(degree) {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 2);
  }
  return result;
}

/** Reed-Solomon remainder: the error correction codewords for `data`. */
export function rsRemainder(data, generator) {
  const result = new Uint8Array(generator.length);
  for (const b of data) {
    const factor = b ^ result[0];
    result.copyWithin(0, 1);
    result[result.length - 1] = 0;
    for (let i = 0; i < result.length; i++) result[i] ^= gfMul(generator[i], factor);
  }
  return result;
}

function alignmentPositions(ver) {
  if (ver === 1) return [];
  const count = Math.floor(ver / 7) + 2;
  const size = ver * 4 + 17;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (count * 2 - 2)) * 2;
  const out = [6];
  for (let pos = size - 7; out.length < count; pos -= step) out.splice(1, 0, pos);
  return out;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

class Matrix {
  constructor(ver) {
    this.ver = ver;
    this.size = ver * 4 + 17;
    this.dark = new Uint8Array(this.size * this.size);
    this.fn = new Uint8Array(this.size * this.size);
  }
  get(x, y) {
    return this.dark[y * this.size + x] === 1;
  }
  set(x, y, dark, isFunction = true) {
    this.dark[y * this.size + x] = dark ? 1 : 0;
    if (isFunction) this.fn[y * this.size + x] = 1;
  }
}

function drawFunctionPatterns(m) {
  const { size, ver } = m;
  for (let i = 0; i < size; i++) {
    m.set(6, i, i % 2 === 0);
    m.set(i, 6, i % 2 === 0);
  }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        m.set(x, y, d !== 2 && d !== 4);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  const align = alignmentPositions(ver);
  const n = align.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) m.set(align[i] + dx, align[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }
  drawFormat(m, ECC.L, 0); // reserve the area, overwritten later
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      m.set(a, b, bit);
      m.set(b, a, bit);
    }
  }
}

export function formatBits(ecl, mask) {
  const data = (ecl.formatBits << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function drawFormat(m, ecl, mask) {
  const bits = formatBits(ecl, mask);
  const bit = (i) => ((bits >>> i) & 1) === 1;
  const { size } = m;
  for (let i = 0; i <= 5; i++) m.set(8, i, bit(i));
  m.set(8, 7, bit(6));
  m.set(8, 8, bit(7));
  m.set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) m.set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) m.set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) m.set(8, size - 15 + i, bit(i));
  m.set(8, size - 8, true);
}

function buildCodewords(data, ver, ecl) {
  const blocks = NUM_BLOCKS[ecl.ordinal][ver];
  const eccLen = ECC_PER_BLOCK[ecl.ordinal][ver];
  const raw = Math.floor(rawDataModules(ver) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLen = Math.floor(raw / blocks);
  const gen = rsGenerator(eccLen);
  const all = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const len = shortLen - eccLen + (i < shortBlocks ? 0 : 1);
    const dat = Array.from(data.subarray(k, k + len));
    k += len;
    const ecc = rsRemainder(dat, gen);
    if (i < shortBlocks) dat.push(0);
    all.push(dat.concat(Array.from(ecc)));
  }
  const out = [];
  for (let i = 0; i < all[0].length; i++) {
    for (let j = 0; j < all.length; j++) {
      if (i !== shortLen - eccLen || j >= shortBlocks) out.push(all[j][i]);
    }
  }
  return out;
}

function placeData(m, codewords) {
  const { size } = m;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (m.fn[y * size + x]) continue;
        if (i < codewords.length * 8) {
          m.set(x, y, ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1, false);
          i++;
        }
      }
    }
  }
}

function applyMask(m, mask) {
  const f = MASKS[mask];
  const { size } = m;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const k = y * size + x;
      if (!m.fn[k] && f(x, y)) m.dark[k] ^= 1;
    }
  }
}

/** Penalty score from the four standard rules. Lower is better. */
export function penalty(m) {
  const { size, dark } = m;
  let score = 0;
  const line = (get) => {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && get(i) === get(i - 1)) run++;
      else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    // Finder-like 1:1:3:1:1 with four light modules on one side.
    for (let i = 0; i + 7 <= size; i++) {
      if (get(i) && !get(i + 1) && get(i + 2) && get(i + 3) && get(i + 4) && !get(i + 5) && get(i + 6)) {
        let before = true;
        let after = true;
        for (let k = 1; k <= 4; k++) {
          if (i - k >= 0 && get(i - k)) before = false;
          if (i + 6 + k < size && get(i + 6 + k)) after = false;
        }
        if (before || after) score += 40;
      }
    }
  };
  for (let y = 0; y < size; y++) line((x) => dark[y * size + x]);
  for (let x = 0; x < size; x++) line((y) => dark[y * size + x]);
  for (let y = 0; y + 1 < size; y++) {
    for (let x = 0; x + 1 < size; x++) {
      const c = dark[y * size + x];
      if (c === dark[y * size + x + 1] && c === dark[(y + 1) * size + x] && c === dark[(y + 1) * size + x + 1]) score += 3;
    }
  }
  let darkCount = 0;
  for (let i = 0; i < dark.length; i++) darkCount += dark[i];
  const total = dark.length;
  const k = Math.ceil(Math.abs(darkCount * 20 - total * 10) / total) - 1;
  score += Math.max(0, k) * 10;
  return score;
}

/**
 * Encodes text (UTF-8) or bytes in byte mode.
 * Options: ecl ('L' | 'M' | 'Q' | 'H', default 'M'), minVersion, maxVersion, mask (0 to 7, default automatic),
 * boostEcl (raise the level when it still fits in the same version, default true).
 * Returns { version, size, ecl, mask, modules } where modules[y * size + x] is 1 for dark.
 */
export function encodeQr(input, options = {}) {
  const bytes = typeof input === 'string' ? utf8(input) : input;
  let ecl = ECC[options.ecl ?? 'M'];
  if (!ecl) throw new Error('Unknown error correction level');
  const minVersion = options.minVersion ?? 1;
  const maxVersion = options.maxVersion ?? 40;
  let ver = minVersion;
  for (; ver <= maxVersion; ver++) if (bytes.length <= byteCapacity(ver, ecl)) break;
  if (ver > maxVersion) throw new RangeError(`Data too long for a QR code: ${bytes.length} bytes`);
  if (options.boostEcl !== false) {
    for (const next of [ECC.M, ECC.Q, ECC.H]) if (next.ordinal > ecl.ordinal && bytes.length <= byteCapacity(ver, next)) ecl = next;
  }

  const capacityBits = dataCodewords(ver, ecl) * 8;
  const bits = [];
  const push = (value, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, capacityBits - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data = new Uint8Array(bits.length / 8);
  for (let i = 0; i < bits.length; i++) data[i >>> 3] |= bits[i] << (7 - (i & 7));

  const codewords = buildCodewords(data, ver, ecl);
  const base = new Matrix(ver);
  drawFunctionPatterns(base);
  placeData(base, codewords);

  let best = null;
  let bestMask = options.mask ?? -1;
  if (bestMask < 0) {
    let bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const m = new Matrix(ver);
      m.dark.set(base.dark);
      m.fn.set(base.fn);
      applyMask(m, mask);
      drawFormat(m, ecl, mask);
      const score = penalty(m);
      if (score < bestScore) {
        bestScore = score;
        best = m;
        bestMask = mask;
      }
    }
  } else {
    best = base;
    applyMask(best, bestMask);
    drawFormat(best, ecl, bestMask);
  }
  const level = Object.keys(ECC).find((k) => ECC[k] === ecl);
  return { version: ver, size: best.size, ecl: level, mask: bestMask, modules: best.dark };
}

/** An SVG path (one unit per module) with a quiet zone of `margin` modules. */
export function qrPath(qr, margin = 4) {
  let d = '';
  for (let y = 0; y < qr.size; y++) {
    let x = 0;
    while (x < qr.size) {
      if (!qr.modules[y * qr.size + x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < qr.size && qr.modules[y * qr.size + x]) x++;
      d += `M${start + margin} ${y + margin}h${x - start}v1h${start - x}z`;
    }
  }
  return d;
}

/** A standalone SVG string. Colors default to black on white for reliable scanning. */
export function qrSvg(qr, { margin = 4, dark = '#000', light = '#fff', title = '' } = {}) {
  const n = qr.size + margin * 2;
  const label = title ? `<title>${title.replace(/[<&>]/g, '')}</title>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img">${label}<rect width="${n}" height="${n}" fill="${light}"/><path fill="${dark}" d="${qrPath(qr, margin)}"/></svg>`;
}
