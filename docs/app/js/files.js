// Opening, saving and exporting: the .pxo project file, every format of lib/formats, the
// browser's own codecs (JPEG, WebP, AVIF, HEIC where supported, SVG), pdf.js for PDFs (loaded on
// demand), the File System Access API where the browser has it (so Save writes back to the same
// file), and a plain download everywhere else.

import { decode, encode, FORMATS, sniff } from '../lib/formats/index.js';
import { isProject, packProject, projectFileName, unpackProject, PROJECT_EXT } from '../lib/project.js';
import { createDoc, makeLayer, newId } from '../lib/doc.js';
import { EditorDocument } from './engine/document.js';
import { makeCanvas, canvasToBlob } from './engine/assets.js';
import { press } from './engine/render.js';

export const PDFJS = { version: '4.10.38', base: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/', license: 'Apache-2.0' };

// ---------- browser codecs for lib/formats ----------

async function bitmapToImage(bmp, w = bmp.width, h = bmp.height) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  return { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data };
}

export const platform = {
  async decodeBitmap(bytes, mime) {
    const bmp = await createImageBitmap(new Blob([bytes], { type: mime }), { colorSpaceConversion: 'default' });
    try {
      return await bitmapToImage(bmp);
    } finally {
      bmp.close?.();
    }
  },
  async encodeBitmap(img, mime, quality) {
    const c = makeCanvas(img.width, img.height);
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
    const blob = await canvasToBlob(c, mime, quality);
    if (!blob || blob.type !== mime) return null; // the browser fell back to PNG: not supported
    return new Uint8Array(await blob.arrayBuffer());
  },
  async renderSvg(bytes) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'image/svg+xml' }));
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      let w = img.naturalWidth || 1024;
      let h = img.naturalHeight || 1024;
      // vector art opens at a comfortable size
      const k = Math.max(1, 1024 / Math.max(w, h));
      w = Math.round(w * k);
      h = Math.round(h * k);
      return await bitmapToImage(img, w, h);
    } finally {
      URL.revokeObjectURL(url);
    }
  },
  async renderPdf(bytes) {
    const pdfjs = await import(`${PDFJS.base}pdf.min.mjs`);
    pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS.base}pdf.worker.min.mjs`;
    const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    const pages = [];
    for (let i = 1; i <= Math.min(pdf.numPages, 30); i++) {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 2 });
      const c = document.createElement('canvas');
      c.width = Math.ceil(vp.width);
      c.height = Math.ceil(vp.height);
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      pages.push(await bitmapToImage(c));
    }
    return pages;
  },
};

// ---------- reading ----------

export const ACCEPT = '.pxo,image/*,.psd,.psb,.tif,.tiff,.tga,.ico,.cur,.bmp,.pdf,.exr,.hdr,.pbm,.pgm,.ppm,.pnm,.pam,.heic,.heif,.avif,.svg,.cr2,.cr3,.nef,.arw,.dng,.orf,.rw2,.raf,.pef,.srw';

const TEXT_KEYS = ['text', 'font', 'size', 'weight', 'italic', 'color', 'align', 'lineHeight', 'letterSpacing', 'outline', 'shadow', 'curve', 'bubble', 'x', 'y', 'rotation', 'scaleX', 'scaleY'];
const textProps = (l) => Object.fromEntries(TEXT_KEYS.filter((k) => k in l).map((k) => [k, l[k]]));

/** The editable text a PSD layer written by pixelotter carries, or null. */
function textFromMeta(meta) {
  if (typeof meta !== 'string') return null;
  try {
    const m = JSON.parse(meta);
    return m?.type === 'text' && m.layer && typeof m.layer.text === 'string' ? textProps(m.layer) : null;
  } catch {
    return null;
  }
}

/** Names the interface gives to layers made on open, in its language. */
export const LAYER_NAMES = { background: 'Background' };

/** Turns decoded layers (from lib/formats) into a document with assets. */
export function documentFromDecoded(dec, name) {
  const doc = createDoc({ name: name.replace(/\.[^.]+$/, '') || 'Untitled', width: dec.width, height: dec.height, background: null });
  const edoc = new EditorDocument(doc);
  const ops = [];
  const groupIds = new Map();
  for (const l of dec.layers) if (l.kind === 'group') groupIds.set(l.id, newId());
  for (const l of dec.layers) {
    const parent = l.parent ? groupIds.get(l.parent) ?? null : null;
    if (l.kind === 'group') {
      ops.push({ t: 'add', layer: makeLayer('group', { id: groupIds.get(l.id), name: l.name, opacity: l.opacity, blend: l.blend, visible: l.visible, collapsed: l.collapsed, parent }) });
      continue;
    }
    const text = textFromMeta(l.meta);
    if (text) {
      ops.push({ t: 'add', layer: makeLayer('text', { ...text, id: newId(), name: l.name, opacity: l.opacity ?? 1, blend: l.blend ?? 'normal', visible: l.visible !== false, parent }) });
      continue;
    }
    const asset = newId('a');
    ops.push({ t: 'asset', id: asset, w: l.width, h: l.height, data: l.data });
    const layer = { id: newId(), name: l.name === 'Background' ? LAYER_NAMES.background : l.name, asset, w: l.width, h: l.height, x: l.x + l.width / 2, y: l.y + l.height / 2, opacity: l.opacity ?? 1, blend: l.blend ?? 'normal', visible: l.visible !== false, parent };
    if (l.mask?.data) {
      // a document space mask from the file's mask rectangle
      const m = newId('a');
      const full = new Uint8ClampedArray(dec.width * dec.height * 4);
      for (let i = 0; i < dec.width * dec.height; i++) {
        full[i * 4] = full[i * 4 + 1] = full[i * 4 + 2] = 255;
        full[i * 4 + 3] = l.mask.default ?? 0;
      }
      for (let y = 0; y < l.mask.height; y++) {
        for (let x = 0; x < l.mask.width; x++) {
          const X = l.mask.x + x;
          const Y = l.mask.y + y;
          if (X < 0 || Y < 0 || X >= dec.width || Y >= dec.height) continue;
          full[(Y * dec.width + X) * 4 + 3] = l.mask.data[y * l.mask.width + x];
        }
      }
      // masks of raster layers live in layer pixels
      const local = new Uint8ClampedArray(l.width * l.height * 4);
      for (let y = 0; y < l.height; y++) {
        for (let x = 0; x < l.width; x++) {
          const X = l.x + x;
          const Y = l.y + y;
          const v = X < 0 || Y < 0 || X >= dec.width || Y >= dec.height ? l.mask.default ?? 0 : full[(Y * dec.width + X) * 4 + 3];
          const i = (y * l.width + x) * 4;
          local[i] = local[i + 1] = local[i + 2] = 255;
          local[i + 3] = v;
        }
      }
      ops.push({ t: 'asset', id: m, w: l.width, h: l.height, data: local });
      layer.mask = { asset: m, enabled: !l.mask.disabled };
    }
    ops.push({ t: 'add', layer: makeLayer('raster', layer) });
  }
  if (dec.frames?.length) {
    const layerIds = ops.filter((o) => o.t === 'add').map((o) => o.layer.id);
    ops.push({ t: 'doc', props: { frames: dec.frames.map((f) => ({ delay: f.delay, show: [layerIds[f.layer]] })) } });
  }
  if (dec.colorMode === 'cmyk') ops.push({ t: 'doc', props: { mode: 'cmyk' } });
  else if (dec.colorMode === 'gray') ops.push({ t: 'doc', props: { mode: 'gray' } });
  edoc.apply(ops, 'load');
  edoc.active = edoc.doc.layers.at(-1)?.id ?? null;
  edoc.notes = dec.notes ?? [];
  return edoc;
}

/** Opens a File or bytes: a .pxo project or any image format. */
export async function openFile(file, { name = file.name } = {}) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isProject(bytes)) {
    const p = unpackProject(bytes);
    const edoc = new EditorDocument(createDoc());
    await edoc.load({ doc: p.doc, assets: p.assets });
    edoc.file = { name, handle: file.handle ?? null, format: 'pxo', saved: bytes };
    edoc.history.markSaved();
    return edoc;
  }
  const dec = await decode(bytes, { name, platform });
  const edoc = documentFromDecoded(dec, name);
  edoc.file = { name, handle: null, format: dec.format, saved: null, source: bytes };
  edoc.history.markSaved();
  return edoc;
}

export async function decodeForPlace(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isProject(bytes)) throw new Error('Open projects with File > Open');
  return decode(bytes, { name: file.name, platform });
}

// ---------- writing ----------

export async function packDocument(edoc, thumbnail = true) {
  const snap = await edoc.snapshot();
  let thumb = null;
  if (thumbnail) {
    const d = edoc.doc;
    const k = Math.min(1, 320 / Math.max(d.width, d.height));
    const c = edoc.renderer.render({ scale: k });
    const blob = await canvasToBlob(c, 'image/jpeg', 0.8);
    if (blob) thumb = { mime: 'image/jpeg', bytes: new Uint8Array(await blob.arrayBuffer()) };
  }
  return packProject({ doc: snap.doc, assets: snap.assets, thumbnail: thumb });
}

export const canSaveInPlace = () => typeof window.showSaveFilePicker === 'function';

/** Saves a .pxo. With the File System Access API, Save writes back to the same file. */
export async function saveProject(edoc, { as = false } = {}) {
  const bytes = await packDocument(edoc);
  const name = projectFileName(edoc.doc.name, PROJECT_EXT);
  let handle = !as && edoc.file.format === 'pxo' ? edoc.file.handle : null;
  if (canSaveInPlace()) {
    if (!handle) {
      try {
        handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'pixelotter project', accept: { 'application/x-pixelotter': [PROJECT_EXT] } }] });
      } catch (err) {
        if (err?.name === 'AbortError') return null;
        handle = null;
      }
    }
    if (handle) {
      const w = await handle.createWritable();
      await w.write(bytes);
      await w.close();
      edoc.file = { name: handle.name, handle, format: 'pxo', saved: bytes };
      return { name: handle.name, bytes, inPlace: true };
    }
  }
  download(bytes, name, 'application/x-pixelotter');
  edoc.file = { ...edoc.file, name, format: 'pxo', saved: bytes };
  return { name, bytes, inPlace: false };
}

export function download(bytes, name, mime = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** Resizes RGBA with the browser's high quality scaler. */
export async function resizeImage(img, w, h) {
  const c = makeCanvas(img.width, img.height);
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  const out = makeCanvas(w, h);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(c, 0, 0, w, h);
  return { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data };
}

/** Flattened pixels of the document at a scale (the proof is not applied: real colors). */
export function flatten(edoc, scale = 1, { background = true, hidden = null } = {}) {
  const c = edoc.renderer.render({ scale, proof: edoc.doc.mode === 'gray' ? true : false, background, hidden });
  return { width: c.width, height: c.height, data: c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data };
}

/** PSD layer records: every pixel layer rendered in place, masks and groups kept. */
function psdLayers(edoc, scale) {
  const d = edoc.doc;
  const W = Math.round(d.width * scale);
  const H = Math.round(d.height * scale);
  const r = edoc.renderer;
  const out = [];
  for (const l of d.layers) {
    if (l.type === 'group') {
      out.push({ kind: 'group', id: l.id, name: l.name, opacity: l.opacity, blend: l.blend, visible: l.visible, collapsed: l.collapsed, parent: l.parent });
      continue;
    }
    if (l.type === 'adjust') continue; // merged into the composite only
    const c = makeCanvas(W, H);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    r.drawContent(ctx, l, scale);
    const data = ctx.getImageData(0, 0, W, H).data;
    // trim to the pixels in use
    let x0 = W;
    let y0 = H;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (data[(y * W + x) * 4 + 3]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    if (x1 < 0) {
      x0 = y0 = 0;
      x1 = y1 = 0;
    }
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const crop = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) crop.set(data.subarray(((y0 + y) * W + x0) * 4, ((y0 + y) * W + x0 + w) * 4), y * w * 4);
    const rec = { kind: 'raster', name: l.name, x: x0, y: y0, width: w, height: h, data: crop, opacity: l.opacity, blend: l.blend, visible: l.visible, parent: l.parent };
    // other editors show the text as pixels; pixelotter opens it as editable text again
    if (l.type === 'text') rec.meta = JSON.stringify({ type: 'text', layer: { ...textProps(l), x: l.x * scale, y: l.y * scale, size: l.size * scale } });
    if (l.mask) {
      const m = r.maskCanvas({ ...l, mask: { ...l.mask, enabled: true } }, scale, W, H);
      if (m) {
        const md = m.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
        const plane = new Uint8Array(W * H);
        for (let i = 0; i < W * H; i++) plane[i] = md[i * 4 + 3];
        rec.mask = { x: 0, y: 0, width: W, height: H, data: plane, default: 0, disabled: !l.mask.enabled };
      }
    }
    out.push(rec);
  }
  return out;
}

/**
 * Exports the document. options: { format, quality, scale, cmyk, animated, pages, dpi }
 * Returns { bytes, name, mime }.
 */
export async function exportDocument(edoc, options) {
  const { format, scale = 1 } = options;
  const d = edoc.doc;
  const f = FORMATS[format];
  const opaque = format === 'jpeg';
  const flat = flatten(edoc, scale, { background: true });
  if (opaque && !d.background) {
    // JPEG has no transparency: put the picture on white
    for (let i = 0; i < flat.data.length; i += 4) {
      const a = flat.data[i + 3] / 255;
      flat.data[i] = flat.data[i] * a + 255 * (1 - a);
      flat.data[i + 1] = flat.data[i + 1] * a + 255 * (1 - a);
      flat.data[i + 2] = flat.data[i + 2] * a + 255 * (1 - a);
      flat.data[i + 3] = 255;
    }
  }
  const input = { width: flat.width, height: flat.height, composite: flat.data };
  const wantCmyk = options.cmyk && f.cmyk;
  if (wantCmyk) {
    // CMYK pages are printed on white: flatten transparency first
    const onWhite = new Uint8ClampedArray(flat.data);
    for (let i = 0; i < onWhite.length; i += 4) {
      const a = onWhite[i + 3] / 255;
      for (let c = 0; c < 3; c++) onWhite[i + c] = onWhite[i + c] * a + 255 * (1 - a);
      onWhite[i + 3] = 255;
    }
    input.cmyk = press().toCmyk(onWhite);
  }
  if (format === 'psd' || format === 'psb') {
    input.layers = psdLayers(edoc, scale);
    if (wantCmyk) for (const l of input.layers) if (l.data) l.cmyk = press().toCmyk(l.data);
  }
  if ((format === 'gif' || format === 'png') && options.animated && d.frames.length) {
    input.frames = d.frames.map((fr) => {
      const show = new Set(fr.show);
      const hidden = new Set(d.layers.filter((l) => l.type !== 'group' && !show.has(l.id) && d.frames.some((x) => x.show.includes(l.id))).map((l) => l.id));
      const img = flatten(edoc, scale, { hidden });
      return { data: img.data, delay: fr.delay };
    });
  }
  if ((format === 'tiff' || format === 'pdf') && options.pages) {
    input.pages = d.layers
      .filter((l) => l.type !== 'group' && l.type !== 'adjust')
      .map((l) => {
        const c = makeCanvas(flat.width, flat.height);
        edoc.renderer.drawContent(c.getContext('2d'), l, scale);
        const data = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, flat.width, flat.height).data;
        return wantCmyk ? { width: flat.width, height: flat.height, cmyk: press().toCmyk(data), name: l.name } : { width: flat.width, height: flat.height, data, name: l.name };
      });
  }
  let jpeg = null;
  if (format === 'pdf' && options.compressPdf && !wantCmyk) jpeg = await platform.encodeBitmap(flat, 'image/jpeg', options.quality ?? 0.9);
  const res = await encode(input, format, { quality: options.quality, cmyk: wantCmyk, animated: options.animated, pages: options.pages, dpi: options.dpi ?? d.dpi, title: d.name, jpeg, resize: resizeImage, sizes: options.sizes }, platform);
  const base = projectFileName(d.name, '').replace(/\.$/, '');
  return { bytes: res.bytes, name: `${base}.${res.ext}`, mime: res.mime };
}

/** Writes an export with a save dialog where available. */
export async function saveExport({ bytes, name, mime }) {
  if (canSaveInPlace()) {
    try {
      const ext = `.${name.split('.').pop()}`;
      const handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: ext.slice(1).toUpperCase(), accept: { [mime === 'application/octet-stream' ? 'application/x-binary' : mime]: [ext] } }] });
      const w = await handle.createWritable();
      await w.write(bytes);
      await w.close();
      return handle.name;
    } catch (err) {
      if (err?.name === 'AbortError') return null;
    }
  }
  download(bytes, name, mime);
  return name;
}

export { sniff, FORMATS };
