// PSD and PSB (the large document variant), read and write, in plain code.
// Reading keeps layers, layer masks, blend modes, opacity, visibility, names (Unicode) and
// groups, in RGB, CMYK, grayscale, indexed, bitmap and Lab documents at 8 or 16 bits. Smart
// objects, text and vector data are opened as their pixel previews (the layer pixels the file
// stores), and 32 bit documents are reported as unsupported.
// Writing produces RGB or CMYK documents, 8 bits, with the same layer features, run length
// compressed, plus the flattened composite that every reader expects.

import { FormatError, Reader, Writer, image, packBits, startsWith, unpackBits, zlibInflate } from './binary.js';
import { cmykToRgb } from '../color/cmyk.js';
import { labToRgb } from '../color/convert.js';

export const isPsd = (b) => startsWith(b, [0x38, 0x42, 0x50, 0x53]);

export const BLEND_KEYS = {
  norm: 'normal',
  pass: 'normal',
  'mul ': 'multiply',
  scrn: 'screen',
  over: 'overlay',
  dark: 'darken',
  lite: 'lighten',
  'div ': 'color-dodge',
  idiv: 'color-burn',
  hLit: 'hard-light',
  sLit: 'soft-light',
  diff: 'difference',
  smud: 'exclusion',
  'hue ': 'hue',
  'sat ': 'saturation',
  colr: 'color',
  'lum ': 'luminosity',
};
const KEY_FOR = Object.fromEntries(Object.entries(BLEND_KEYS).filter(([k]) => k !== 'pass').map(([k, v]) => [v, k]));

const MODES = { 0: 'bitmap', 1: 'gray', 2: 'indexed', 3: 'rgb', 4: 'cmyk', 7: 'multichannel', 8: 'duotone', 9: 'lab' };

function pascal(r, pad) {
  const n = r.u8();
  const s = r.ascii(n);
  const total = n + 1;
  const extra = (pad - (total % pad)) % pad;
  r.skip(extra);
  return s;
}

/** Reads one channel's pixels (compression, then data) into a byte plane of w*h. */
async function readChannel(r, w, h, depth, psb, length = null) {
  const start = r.pos;
  const comp = r.u16();
  const bytesPer = depth === 16 ? 2 : 1;
  const rowLen = depth === 1 ? Math.ceil(w / 8) : w * bytesPer;
  const size = rowLen * h;
  let raw;
  if (comp === 0) raw = r.bytesAt(Math.min(size, r.left));
  else if (comp === 1) {
    const counts = [];
    for (let y = 0; y < h; y++) counts.push(psb ? r.u32() : r.u16());
    raw = new Uint8Array(size);
    for (let y = 0; y < h; y++) raw.set(unpackBits(r.bytesAt(counts[y]), rowLen), y * rowLen);
  } else if (comp === 2 || comp === 3) {
    const len = length !== null ? length - 2 : r.left;
    raw = await zlibInflate(r.bytesAt(len));
    if (comp === 3) {
      if (depth === 8) for (let y = 0; y < h; y++) for (let x = 1; x < w; x++) raw[y * rowLen + x] = (raw[y * rowLen + x] + raw[y * rowLen + x - 1]) & 255;
      else if (depth === 16)
        for (let y = 0; y < h; y++)
          for (let x = 1; x < w; x++) {
            const a = y * rowLen + x * 2;
            const v = ((raw[a] << 8) | raw[a + 1]) + ((raw[a - 2] << 8) | raw[a - 1]);
            raw[a] = (v >> 8) & 255;
            raw[a + 1] = v & 255;
          }
    }
  } else throw new FormatError('This PSD uses an unknown compression', 'unsupported');
  if (length !== null) r.seek(start + length);
  // to 8 bit per pixel
  const out = new Uint8Array(w * h);
  if (depth === 8) out.set(raw.subarray(0, w * h));
  else if (depth === 16) for (let i = 0; i < w * h; i++) out[i] = raw[i * 2];
  else for (let i = 0; i < w * h; i++) {
      const x = i % w;
      const y = (i - x) / w;
      out[i] = (raw[y * rowLen + (x >> 3)] >> (7 - (x & 7))) & 1 ? 0 : 255;
    }
  return out;
}

function toRgba(mode, planes, n, palette) {
  const out = new Uint8ClampedArray(n * 4);
  const cache = new Map();
  for (let i = 0; i < n; i++) {
    let r;
    let g;
    let b;
    if (mode === 'rgb') [r, g, b] = [planes[0][i], planes[1][i], planes[2][i]];
    else if (mode === 'cmyk') {
      // PSD stores CMYK inverted: 255 is no ink
      const key = (planes[0][i] << 24) | (planes[1][i] << 16) | (planes[2][i] << 8) | planes[3][i];
      let rgb = cache.get(key);
      if (!rgb) {
        rgb = cmykToRgb(...[0, 1, 2, 3].map((c) => ((255 - planes[c][i]) / 255) * 100));
        if (cache.size < 100000) cache.set(key, rgb);
      }
      [r, g, b] = rgb;
    } else if (mode === 'lab') [r, g, b] = labToRgb((planes[0][i] / 255) * 100, planes[1][i] - 128, planes[2][i] - 128);
    else if (mode === 'indexed') {
      const k = planes[0][i];
      [r, g, b] = palette ? [palette[k], palette[256 + k], palette[512 + k]] : [k, k, k];
    } else r = g = b = planes[0][i];
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * Decodes a PSD or PSB. Returns { width, height, data (the composite), colorMode, layers },
 * layers from bottom to top: { kind: 'raster' | 'group', name, x, y, width, height, data,
 * opacity, blend, visible, mask, id, parent }.
 */
export async function decodePsd(bytes) {
  if (!isPsd(bytes)) throw new FormatError('Not a PSD file');
  const r = new Reader(bytes);
  r.skip(4);
  const version = r.u16();
  if (version !== 1 && version !== 2) throw new FormatError('Unknown PSD version', 'unsupported');
  const psb = version === 2;
  r.skip(6);
  const channels = r.u16();
  const height = r.u32();
  const width = r.u32();
  const depth = r.u16();
  const mode = MODES[r.u16()] ?? 'unknown';
  if (depth === 32) throw new FormatError('32 bit PSD documents are not supported', 'unsupported');
  if (!['rgb', 'cmyk', 'gray', 'indexed', 'bitmap', 'lab', 'duotone', 'multichannel'].includes(mode)) throw new FormatError('This PSD color mode is not supported', 'unsupported');
  const cmLen = r.u32();
  const palette = mode === 'indexed' ? r.bytesAt(cmLen) : (r.skip(cmLen), null);
  const resLen = r.u32();
  r.skip(resLen);
  const colorCount = { rgb: 3, cmyk: 4, lab: 3 }[mode] ?? 1;
  const effectiveMode = mode === 'duotone' || mode === 'multichannel' ? 'gray' : mode;
  const lmLen = psb ? r.u64() : r.u32();
  const lmEnd = r.pos + lmLen;
  const layers = [];
  let mergedAlpha = false;
  if (lmLen > 0) {
    const liLen = psb ? r.u64() : r.u32();
    const liEnd = r.pos + liLen;
    if (liLen > 0) {
      let count = r.i16();
      if (count < 0) {
        mergedAlpha = true;
        count = -count;
      }
      const recs = [];
      for (let i = 0; i < count; i++) {
        const top = r.i32();
        const left = r.i32();
        const bottom = r.i32();
        const right = r.i32();
        const nch = r.u16();
        const chans = [];
        for (let c = 0; c < nch; c++) chans.push({ id: r.i16(), length: psb ? r.u64() : r.u32() });
        if (r.ascii(4) !== '8BIM') throw new FormatError('The PSD layer records are damaged', 'damaged');
        const key = r.ascii(4);
        const opacity = r.u8();
        r.u8(); // clipping
        const flags = r.u8();
        r.u8();
        const extraLen = r.u32();
        const extraEnd = r.pos + extraLen;
        const mLen = r.u32();
        let mask = null;
        if (mLen >= 20) {
          const mt = r.i32();
          const ml = r.i32();
          const mb = r.i32();
          const mr = r.i32();
          const def = r.u8();
          const mflags = r.u8();
          mask = { y: mt, x: ml, width: mr - ml, height: mb - mt, default: def, disabled: (mflags & 2) !== 0, relative: (mflags & 1) !== 0 };
          r.skip(mLen - 18);
        } else r.skip(mLen);
        r.skip(r.u32()); // blending ranges
        let name = pascal(r, 4);
        let section = 0;
        while (r.pos + 12 <= extraEnd) {
          const sig = r.ascii(4);
          if (sig !== '8BIM' && sig !== '8B64') break;
          const k = r.ascii(4);
          const longKeys = ['LMsk', 'Lr16', 'Lr32', 'Layr', 'Mt16', 'Mt32', 'Mtrn', 'Alph', 'FMsk', 'lnk2', 'FEid', 'FXid', 'PxSD'];
          const len = psb && longKeys.includes(k) ? r.u64() : r.u32();
          const at = r.pos;
          if (k === 'luni') {
            const n = r.u32();
            let s = '';
            for (let q = 0; q < n; q++) s += String.fromCharCode(r.u16());
            name = s.replace(/\u0000+$/, '');
          } else if (k === 'lsct' || k === 'lsdk') section = r.u32();
          r.seek(Math.min(extraEnd, at + len + (len & 1 && k !== 'luni' ? 0 : 0)));
        }
        r.seek(extraEnd);
        recs.push({ top, left, bottom, right, chans, key, opacity, visible: !(flags & 2), mask, name, section });
      }
      // channel image data follows the records, in the same order
      for (const rec of recs) {
        const w = rec.right - rec.left;
        const h = rec.bottom - rec.top;
        const planes = {};
        for (const ch of rec.chans) {
          const isMask = ch.id === -2 || ch.id === -3;
          const cw = isMask && rec.mask ? rec.mask.width : w;
          const chh = isMask && rec.mask ? rec.mask.height : h;
          if (cw <= 0 || chh <= 0) {
            r.skip(ch.length);
            continue;
          }
          planes[ch.id] = await readChannel(r, cw, chh, depth, psb, ch.length);
        }
        rec.planes = planes;
      }
      r.seek(liEnd);
      // build layers and groups, bottom to top
      const stack = [null];
      let gid = 0;
      for (const rec of recs) {
        const parent = stack[stack.length - 1];
        if (rec.section === 3) {
          // the bottom marker of a group: everything above it, up to the group record, is inside
          stack.push(`g${++gid}`);
          continue;
        }
        if (rec.section === 1 || rec.section === 2) {
          const id = stack.length > 1 ? stack.pop() : `g${++gid}`;
          layers.push({ kind: 'group', id, name: rec.name || 'Group', opacity: rec.opacity / 255, blend: BLEND_KEYS[rec.key] ?? 'normal', visible: rec.visible, collapsed: rec.section === 2, parent: stack[stack.length - 1] });
          continue;
        }
        const w = rec.right - rec.left;
        const h = rec.bottom - rec.top;
        if (w <= 0 || h <= 0) continue;
        const color = [0, 1, 2, 3].slice(0, colorCount).map((c) => rec.planes[c] ?? new Uint8Array(w * h).fill(effectiveMode === 'cmyk' ? 255 : 0));
        const data = toRgba(effectiveMode, color, w * h, palette);
        const alpha = rec.planes[-1];
        if (alpha) for (let i = 0; i < w * h; i++) data[i * 4 + 3] = alpha[i];
        let mask = null;
        const mp = rec.planes[-2] ?? rec.planes[-3];
        if (rec.mask && mp) mask = { ...rec.mask, data: mp };
        layers.push({ kind: 'raster', name: rec.name || 'Layer', x: rec.left, y: rec.top, width: w, height: h, data, opacity: rec.opacity / 255, blend: BLEND_KEYS[rec.key] ?? 'normal', visible: rec.visible, mask, parent });
      }
    }
  }
  r.seek(lmEnd);
  // the merged composite
  const comp = r.u16();
  const n = width * height;
  const planes = [];
  const total = Math.min(channels, colorCount + (mergedAlpha || channels > colorCount ? 1 : 0));
  if (comp === 1) {
    const rowLen = depth === 1 ? Math.ceil(width / 8) : width * (depth === 16 ? 2 : 1);
    const counts = [];
    for (let i = 0; i < channels * height; i++) counts.push(psb ? r.u32() : r.u16());
    for (let c = 0; c < total; c++) {
      const raw = new Uint8Array(rowLen * height);
      for (let y = 0; y < height; y++) raw.set(unpackBits(r.bytesAt(counts[c * height + y]), rowLen), y * rowLen);
      planes.push(squeeze(raw, width, height, depth, rowLen));
    }
  } else if (comp === 0) {
    const rowLen = depth === 1 ? Math.ceil(width / 8) : width * (depth === 16 ? 2 : 1);
    for (let c = 0; c < total; c++) planes.push(squeeze(r.bytesAt(rowLen * height), width, height, depth, rowLen));
  } else throw new FormatError('This PSD composite compression is not supported', 'unsupported');
  const data = toRgba(effectiveMode, planes, n, palette);
  if (planes.length > colorCount && (mergedAlpha || layers.length)) for (let i = 0; i < n; i++) data[i * 4 + 3] = planes[colorCount][i];
  const out = image(width, height, data);
  return { ...out, colorMode: mode, depth, psb, layers };
}

function squeeze(raw, w, h, depth, rowLen) {
  const out = new Uint8Array(w * h);
  if (depth === 8) out.set(raw.subarray(0, w * h));
  else if (depth === 16) for (let i = 0; i < w * h; i++) out[i] = raw[i * 2];
  else for (let i = 0; i < w * h; i++) {
      const x = i % w;
      const y = (i - x) / w;
      out[i] = (raw[y * rowLen + (x >> 3)] >> (7 - (x & 7))) & 1 ? 0 : 255;
    }
  return out;
}

function rleChannel(plane, w, h, psb) {
  const rows = [];
  for (let y = 0; y < h; y++) rows.push(packBits(plane.subarray(y * w, (y + 1) * w)));
  const total = rows.reduce((a, b) => a + b.length, 0);
  const out = new Writer(2 + h * (psb ? 4 : 2) + total);
  out.u16(1);
  for (const row of rows) psb ? out.u32(row.length) : out.u16(row.length);
  for (const row of rows) out.bytes(row);
  return out.done();
}

function planesOf(data, n, cmyk) {
  if (cmyk) {
    // inverted, 255 is no ink
    return [0, 1, 2, 3].map((c) => {
      const p = new Uint8Array(n);
      for (let i = 0; i < n; i++) p[i] = 255 - cmyk[i * 4 + c];
      return p;
    });
  }
  return [0, 1, 2].map((c) => {
    const p = new Uint8Array(n);
    for (let i = 0; i < n; i++) p[i] = data[i * 4 + c];
    return p;
  });
}

/**
 * Encodes a PSD (or PSB with { psb: true }).
 * doc: { width, height, composite (RGBA), compositeCmyk?, layers }
 * layers bottom to top: { kind: 'raster', name, x, y, width, height, data, cmyk?, opacity,
 * blend, visible, mask?: { x, y, width, height, data, default, disabled }, parent } and
 * { kind: 'group', id, name, opacity, blend, visible, collapsed, parent }.
 * With { cmyk: true } every raster layer and the composite need `cmyk` ink bytes.
 */
export function encodePsd(doc, { psb = false, cmyk = false } = {}) {
  const { width, height } = doc;
  if (!psb && (width > 30000 || height > 30000)) throw new FormatError('Documents larger than 30,000 px need the PSB format', 'too-large');
  const w = new Writer(1 << 20);
  w.ascii('8BPS').u16(psb ? 2 : 1).pad(6).u16(cmyk ? 5 : 4).u32(height).u32(width).u16(8).u16(cmyk ? 4 : 3);
  w.u32(0); // color mode data
  // image resources: resolution info (72 dpi)
  const res = new Writer(64);
  res.ascii('8BIM').u16(1005).u16(0).u32(16).u32(72 << 16).u16(1).u16(1).u32(72 << 16).u16(1).u16(1);
  const resBytes = res.done();
  w.u32(resBytes.length).bytes(resBytes);
  const fixLm = psb ? w.later64() : w.later32();
  const lmStart = w.pos;
  const fixLi = psb ? w.later64() : w.later32();
  const liStart = w.pos;
  // groups become a bottom marker, the children, then the group record above them
  const ordered = [];
  const walk = (parent) => {
    for (const l of doc.layers.filter((x) => (x.parent ?? null) === parent)) {
      if (l.kind === 'group') {
        ordered.push({ marker: true, name: '</Layer group>' });
        walk(l.id);
        ordered.push(l);
      } else ordered.push(l);
    }
  };
  walk(null);
  w.i16(-ordered.length);
  const channelData = [];
  for (const l of ordered) {
    const isGroup = l.kind === 'group' || l.marker;
    const x = isGroup ? 0 : l.x;
    const y = isGroup ? 0 : l.y;
    const lw = isGroup ? 0 : l.width;
    const lh = isGroup ? 0 : l.height;
    const n = lw * lh;
    const chans = [];
    if (isGroup) {
      for (const id of cmyk ? [-1, 0, 1, 2, 3] : [-1, 0, 1, 2]) chans.push({ id, data: Uint8Array.of(0, 0) });
    } else {
      const alpha = new Uint8Array(n);
      for (let i = 0; i < n; i++) alpha[i] = l.data[i * 4 + 3];
      chans.push({ id: -1, data: rleChannel(alpha, lw, lh, psb) });
      planesOf(l.data, n, cmyk ? l.cmyk : null).forEach((p, c) => chans.push({ id: c, data: rleChannel(p, lw, lh, psb) }));
      if (l.mask?.data && l.mask.width > 0 && l.mask.height > 0) chans.push({ id: -2, data: rleChannel(l.mask.data, l.mask.width, l.mask.height, psb) });
    }
    w.i32(y).i32(x).i32(y + lh).i32(x + lw).u16(chans.length);
    for (const c of chans) {
      w.i16(c.id);
      psb ? w.u64(c.data.length) : w.u32(c.data.length);
    }
    w.ascii('8BIM').ascii(l.marker ? 'norm' : l.kind === 'group' ? 'pass' : KEY_FOR[l.blend] ?? 'norm');
    w.u8(Math.round((l.marker ? 1 : l.opacity ?? 1) * 255)).u8(0);
    w.u8((l.marker || l.visible !== false ? 0 : 2) | 8).u8(0);
    const fixExtra = w.later32();
    const exStart = w.pos;
    if (!isGroup && l.mask?.data) {
      w.u32(20).i32(l.mask.y).i32(l.mask.x).i32(l.mask.y + l.mask.height).i32(l.mask.x + l.mask.width).u8(l.mask.default ?? 0).u8(l.mask.disabled ? 2 : 0).u16(0);
    } else w.u32(0);
    w.u32(0); // blending ranges
    const name = String(l.name ?? '').slice(0, 255);
    const ascii = name.replace(/[^\x20-\x7e]/g, '_');
    const nameLen = Math.min(ascii.length, 255);
    w.u8(nameLen).ascii(ascii.slice(0, nameLen));
    w.pad((4 - ((nameLen + 1) % 4)) % 4);
    // Unicode name
    w.ascii('8BIM').ascii('luni');
    const uLen = 4 + name.length * 2;
    const padded = uLen + (uLen & 2 ? 2 : 0);
    w.u32(padded).u32(name.length);
    for (const ch of name) w.u16(ch.charCodeAt(0));
    w.pad(padded - uLen);
    if (isGroup) {
      w.ascii('8BIM').ascii('lsct').u32(12).u32(l.marker ? 3 : l.collapsed ? 2 : 1).ascii('8BIM').ascii(l.marker ? 'norm' : 'pass');
    }
    fixExtra(w.pos - exStart);
    channelData.push(chans);
  }
  for (const chans of channelData) for (const c of chans) w.bytes(c.data);
  if ((w.pos - liStart) & 1) w.u8(0);
  fixLi(w.pos - liStart);
  w.u32(0); // global layer mask info
  fixLm(w.pos - lmStart);
  // composite: color channels plus alpha, RLE
  const n = width * height;
  const comp = planesOf(doc.composite, n, cmyk ? doc.compositeCmyk : null);
  const alpha = new Uint8Array(n);
  for (let i = 0; i < n; i++) alpha[i] = doc.composite[i * 4 + 3];
  comp.push(alpha);
  const rows = comp.map((p) => {
    const list = [];
    for (let y = 0; y < height; y++) list.push(packBits(p.subarray(y * width, (y + 1) * width)));
    return list;
  });
  w.u16(1);
  for (const list of rows) for (const row of list) psb ? w.u32(row.length) : w.u16(row.length);
  for (const list of rows) for (const row of list) w.bytes(row);
  return w.done();
}
