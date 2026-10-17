// The clipboard, shared with the system. Copy writes a PNG with the async clipboard API and
// keeps an exact copy inside the app (pixels, position, name, opacity, blend), so a picture
// copied here pastes back at the same pixel position. Paste reads the paste event (no
// permission prompt), or the async API from the menus:
//   images and image files       a layer, centered in the view or under the pointer
//   PSD and TIFF files           open as a document, or place their layers
//   HTML with an <img>           the image, when the page allows it to be fetched
//   a hex color (#ff8800)        the foreground color
//   other text                   a text layer in the current text style
// With no document open, a pasted image becomes a new document. Drag and drop works the same.

import { makeLayer, newId } from '../lib/doc.js';
import { decodeForPlace } from './files.js';
import { makeCanvas } from './engine/assets.js';

const HEX = /^\s*#?([0-9a-f]{6}|[0-9a-f]{3})\s*$/i;
const LAYERED = /\.(psd|psb|tif|tiff)$/i;
const IMAGE = /^image\//;
const LIVE_MAX_SIDE = 4096; // pictures shared in a live session are kept below this
const WAIT_PASTE_MS = 150; // Ctrl+V waits this long for the browser's paste event

/** A fast fingerprint of pixels, to know our own copy when it comes back from the system. */
export function pixelHash(data) {
  let h = 2166136261;
  for (let i = 0; i < data.length; i += 1) h = Math.imul(h ^ data[i], 16777619);
  return h >>> 0;
}

/** The box of pixels that are not fully transparent, or null. */
function opaqueBounds(data, w, h) {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!data[(y * w + x) * 4 + 3]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

const imgSrcOf = (html) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.querySelector('img[src]')?.getAttribute('src') ?? null;
};

export function installClipboard(ctx) {
  const { app, S, t, ui, globals } = ctx;
  let internal = null; // { hash, w, h, x, y, name, opacity, blend }
  let pending = null; // a Ctrl+V waiting for its paste event: { mode, timer }
  ctx.clipboard = null;

  // ---------- copy ----------

  /** The pixels to copy: the selection of the active layer (or of all layers), else the layer. */
  const grab = (merged) => {
    const edoc = app.edoc;
    const d = edoc.doc;
    const l = edoc.activeLayer;
    let canvas;
    if (merged) canvas = app.renderer.render({ scale: 1 });
    else {
      if (!l) return null;
      canvas = makeCanvas(d.width, d.height);
      app.renderer.drawContent(canvas.getContext('2d'), l, 1);
    }
    const g = canvas.getContext('2d', { willReadFrequently: true });
    const sel = edoc.selection;
    const b = sel.empty ? opaqueBounds(g.getImageData(0, 0, d.width, d.height).data, d.width, d.height) : sel.bounds();
    if (!b || !b.w || !b.h) return null;
    const img = g.getImageData(b.x, b.y, b.w, b.h);
    if (!sel.empty) {
      for (let y = 0; y < b.h; y++) {
        for (let x = 0; x < b.w; x++) {
          const i = (y * b.w + x) * 4 + 3;
          img.data[i] = Math.round((img.data[i] * sel.mask[(b.y + y) * d.width + b.x + x]) / 255);
        }
      }
    }
    return { img, b, name: merged ? t('layer.merged') : l.name, opacity: merged ? 1 : l.opacity, blend: merged ? 'normal' : l.blend };
  };

  ui.copy = async (merged = false) => {
    if (!app.edoc) return false;
    const got = grab(merged);
    if (!got) {
      ctx.toast(t('clip.nothingToCopy'), 'warning');
      return false;
    }
    const { img, b } = got;
    const out = makeCanvas(b.w, b.h);
    out.getContext('2d').putImageData(img, 0, 0);
    const blob = out.convertToBlob ? out.convertToBlob({ type: 'image/png' }) : new Promise((r) => out.toBlob(r, 'image/png'));
    internal = { hash: pixelHash(img.data), w: b.w, h: b.h, x: b.x, y: b.y, name: got.name, opacity: got.opacity, blend: got.blend };
    ctx.clipboard = { blob: await blob, ...internal };
    let system = false;
    try {
      // the promise keeps the click or key press that asked for the copy
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      system = true;
    } catch {
      // the browser said no: the copy stays inside pixelotter
    }
    ctx.toast(system ? t('clip.copied', { w: b.w, h: b.h }) : t('clip.copiedInside'), system ? 'success' : 'info');
    return true;
  };

  /** Cut: copy, then remove what was copied, in one step. */
  ui.cut = async () => {
    const edoc = app.edoc;
    const l = edoc?.activeLayer;
    if (!l) return;
    if (!(await ui.copy(false))) return;
    if (!edoc.selection.empty && l.type === 'raster') await app.run('edit.clear');
    else await app.run('layer.delete');
  };

  // ---------- paste ----------

  /** Where a pasted picture goes: under the pointer on the canvas, else the middle of the view. */
  const target = (at) => {
    if (at) return at;
    const vp = app.vp;
    if (vp.hoverAt && vp.cursorPos) return { x: vp.cursorPos.x, y: vp.cursorPos.y };
    return { x: vp.view.cx, y: vp.view.cy };
  };

  /** Pixels { w, h, data } as a new layer. */
  const placePixels = ({ w, h, data }, { name, mode = 'normal', at = null } = {}) => {
    const edoc = app.edoc;
    const d = edoc.doc;
    let props = { name: name || t('clip.layerName') };
    const mine = internal && internal.w === w && internal.h === h && internal.hash === pixelHash(data);
    let center;
    let k = 1;
    if (mine) {
      // our own copy goes back exactly where it came from
      center = { x: internal.x + w / 2, y: internal.y + h / 2 };
      props = { name: internal.name, opacity: internal.opacity, blend: internal.blend };
    } else {
      center = target(at);
      if (mode !== 'into') k = Math.min(1, (d.width * 0.9) / w, (d.height * 0.9) / h);
    }
    // a live session shares the picture with everyone: keep it a sensible size
    if (app.live?.session && Math.max(w, h) > LIVE_MAX_SIDE) {
      const s = LIVE_MAX_SIDE / Math.max(w, h);
      const src = makeCanvas(w, h);
      src.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
      const nw = Math.max(1, Math.round(w * s));
      const nh = Math.max(1, Math.round(h * s));
      const dst = makeCanvas(nw, nh);
      const g = dst.getContext('2d', { willReadFrequently: true });
      g.imageSmoothingQuality = 'high';
      g.drawImage(src, 0, 0, nw, nh);
      data = g.getImageData(0, 0, nw, nh).data;
      k /= s;
      w = nw;
      h = nh;
      ctx.toast(t('clip.shrunk', { n: LIVE_MAX_SIDE }), 'info');
    }
    const asset = newId('a');
    const id = newId();
    const layer = makeLayer('raster', { id, asset, w, h, x: center.x, y: center.y, scaleX: k, scaleY: k, ...props });
    const ops = [{ t: 'asset', id: asset, w, h, data }, { t: 'add', layer, index: app.insertIndex() }];
    if (mode === 'into' && !edoc.selection.empty) {
      // paste into the selection: the layer gets a mask cut from it, in its own pixels
      const sel = edoc.selection.mask;
      const x0 = Math.round(center.x - w / 2);
      const y0 = Math.round(center.y - h / 2);
      const m = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const X = x0 + x;
          const Y = y0 + y;
          const i = (y * w + x) * 4;
          m[i] = m[i + 1] = m[i + 2] = 255;
          m[i + 3] = X >= 0 && Y >= 0 && X < d.width && Y < d.height ? sel[Y * d.width + X] : 0;
        }
      }
      const ma = newId('a');
      ops.splice(1, 0, { t: 'asset', id: ma, w, h, data: m });
      layer.mask = { asset: ma, enabled: true, feather: 0, invert: false, space: 'layer' };
      ops.push({ t: 'sel', data: null });
    }
    if (!edoc.commit(t('history.paste'), ops, { icon: 'image', kind: 'paste' })) return false;
    app.selectLayer(id);
    ctx.toast(mode === 'into' ? t('clip.pastedInto') : t('clip.pastedImage'), 'success');
    return true;
  };

  /** Text: a hex color sets the foreground, anything else becomes a text layer. */
  const pasteText = (text, at = null) => {
    const hex = HEX.exec(text);
    if (hex) {
      let v = hex[1].toLowerCase();
      if (v.length === 3) v = [...v].map((c) => c + c).join('');
      app.setColor('fg', `#${v}`);
      ctx.toast(t('clip.color', { hex: `#${v}` }), 'success');
      return true;
    }
    const clean = text.replace(/\r\n?/g, '\n').trim().slice(0, 5000);
    if (!clean) return false;
    if (!app.edoc) {
      ctx.toast(t('clip.textNeedsDoc'), 'warning');
      return false;
    }
    const o = app.opts('text');
    const p = target(at);
    const id = newId();
    const name = clean.split('\n').find((x) => x.trim())?.trim().slice(0, 40) || t('layer.text');
    const layer = makeLayer('text', { id, name, text: clean, font: o.font, size: o.size, weight: o.weight, italic: !!o.italic, align: o.align, color: o.color ?? app.fg, x: p.x, y: p.y });
    if (!app.edoc.commit(t('history.paste'), [{ t: 'add', layer, index: app.insertIndex() }], { icon: 'text', kind: 'pasteText' })) return false;
    app.selectLayer(id);
    app.applyFontLater?.(app.edoc.layer(id));
    ctx.toast(t('clip.pastedText'), 'success');
    return true;
  };

  /** Files: images become layers; PSD and TIFF ask; with no document they open. */
  const pasteFiles = async (files, mode = 'normal', at = null) => {
    const list = files.filter((f) => IMAGE.test(f.type) || LAYERED.test(f.name) || /\.(png|jpe?g|webp|gif|bmp|svg|avif|ico|tga)$/i.test(f.name));
    if (!list.length) return false;
    if (!app.edoc || mode === 'newDoc') {
      await ctx.openFiles(list.map((f) => (f.name && f.name !== 'image.png' ? f : new File([f], `${t('clip.docName')}.png`, { type: f.type }))));
      if (app.edoc) ctx.toast(t('clip.newDoc'), 'success');
      return true;
    }
    for (const f of list) {
      if (LAYERED.test(f.name)) {
        const how = await ui.confirm(t('clip.layeredTitle'), t('clip.layeredText', { name: f.name }), { yes: t('clip.placeLayers'), no: t('dialog.cancel'), third: t('clip.openDoc') });
        if (how === 'third') {
          await ctx.openFiles([f]);
          continue;
        }
        if (how !== true) continue;
        try {
          const dec = await decodeForPlace(f);
          for (const l of dec.layers.filter((x) => x.kind === 'raster')) placePixels({ w: l.width, h: l.height, data: l.data }, { name: l.name, mode, at: { x: l.x + l.width / 2, y: l.y + l.height / 2 } });
        } catch (err) {
          ctx.toast(t('open.failed', { name: f.name, error: err.message }), 'danger');
        }
        continue;
      }
      try {
        const dec = await decodeForPlace(f);
        const src = dec.layers.find((l) => l.kind === 'raster') ?? dec.layers[0];
        placePixels({ w: src.width, h: src.height, data: src.data }, { name: f.name && f.name !== 'image.png' ? f.name.replace(/\.[^.]+$/, '') : '', mode, at });
      } catch (err) {
        ctx.toast(t('open.failed', { name: f.name || 'image', error: err.message }), 'danger');
      }
    }
    return true;
  };

  /** An <img> from copied HTML: a data URL, or a fetch the page allows. */
  const pasteUrl = async (src, mode, at) => {
    try {
      const res = await fetch(src, { mode: 'cors' });
      const blob = await res.blob();
      if (!IMAGE.test(blob.type)) throw new Error('not an image');
      return pasteFiles([new File([blob], 'image.png', { type: blob.type })], mode, at);
    } catch {
      ctx.toast(t('clip.htmlFailed'), 'warning');
      return false;
    }
  };

  /**
   * What a paste event or a drop carries. The browser empties the DataTransfer once the event
   * is over, so everything is read at once, before any waiting.
   */
  const snapshot = (dt) => {
    const files = [...(dt.files ?? [])];
    if (!files.length) for (const it of dt.items ?? []) if (it.kind === 'file') files.push(it.getAsFile());
    return { files: files.filter(Boolean), html: dt.getData('text/html'), uri: dt.getData('text/uri-list'), text: dt.getData('text/plain') };
  };

  /** Pastes a snapshot, in order of preference: files, an HTML image, a link, text. */
  const fromTransfer = async (data, mode = 'normal', at = null) => {
    const { files, html, uri, text } = data.getData ? snapshot(data) : data;
    if (files.length && (await pasteFiles(files, mode, at))) return true;
    const src = html ? imgSrcOf(html) : null;
    if (src) return pasteUrl(src, mode, at);
    if (uri && /\.(png|jpe?g|webp|gif|svg|bmp)(\?|$)/i.test(uri)) return pasteUrl(uri.split('\n')[0], mode, at);
    if (text) return pasteText(text, at);
    ctx.toast(t('toast.nothingToPaste'), 'warning');
    return false;
  };

  /** The async clipboard API (menus, buttons): images first, then HTML and text. */
  const fromSystem = async (mode = 'normal') => {
    let items = null;
    try {
      items = await navigator.clipboard.read();
    } catch {
      items = null;
    }
    if (items) {
      for (const it of items) {
        const type = it.types.find((x) => IMAGE.test(x));
        if (type) {
          const blob = await it.getType(type);
          return pasteFiles([new File([blob], 'image.png', { type })], mode);
        }
      }
      for (const it of items) {
        if (it.types.includes('text/html')) {
          const src = imgSrcOf(await (await it.getType('text/html')).text());
          if (src) return pasteUrl(src, mode);
        }
        if (it.types.includes('text/plain') && mode !== 'newDoc') return pasteText(await (await it.getType('text/plain')).text());
      }
    }
    // the browser would not let us read: our own copy still pastes
    if (ctx.clipboard?.blob) return pasteFiles([new File([ctx.clipboard.blob], 'image.png', { type: 'image/png' })], mode);
    ctx.toast(items ? t('toast.nothingToPaste') : t('clip.readBlocked'), 'warning');
    return false;
  };

  /** Edit > Paste (and Ctrl+V when no paste event comes). mode: normal, inPlace or into. */
  ui.paste = (mode = 'normal') => fromSystem(mode === true ? 'inPlace' : mode === false ? 'normal' : mode);

  /** Ctrl+V: the browser fires a paste event with the data; wait for it a moment. */
  ui.expectPaste = (mode) => {
    clearTimeout(pending?.timer);
    pending = { mode, timer: setTimeout(() => {
      const m = pending?.mode;
      pending = null;
      if (m) fromSystem(m);
    }, WAIT_PASTE_MS) };
  };

  window.addEventListener('paste', (e) => {
    // typing into a field or the text editor: the browser pastes the text there
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if (document.querySelector('dialog[open]')) return;
    const mode = pending?.mode ?? 'normal';
    clearTimeout(pending?.timer);
    pending = null;
    if (!e.clipboardData) return;
    e.preventDefault();
    fromTransfer(snapshot(e.clipboardData), mode);
  });

  /** File > New from clipboard: a document the size of the copied picture. */
  ui.newFromClipboard = () => fromSystem('newDoc');

  // ---------- drag and drop: the same as paste, at the drop point ----------
  let depth = 0;
  const carries = (e) => {
    const types = [...(e.dataTransfer?.types ?? [])];
    return types.includes('Files') || types.includes('text/plain') || types.includes('text/uri-list') || types.includes('text/html');
  };
  window.addEventListener('dragenter', (e) => {
    if (!carries(e)) return;
    depth++;
    S.dragging = true;
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) S.dragging = false;
  });
  window.addEventListener('dragover', (e) => {
    if (carries(e) && !e.target.closest?.('input, textarea')) e.preventDefault();
  });
  window.addEventListener('drop', async (e) => {
    depth = 0;
    S.dragging = false;
    if (!e.dataTransfer || e.target.closest?.('input, textarea')) return;
    const files = [...e.dataTransfer.files];
    const onCanvas = !!e.target.closest?.('.vp-stage') && !!app.edoc;
    if (!files.length && !onCanvas) return;
    e.preventDefault();
    // projects and drops outside the canvas open as documents
    if (files.length && (!onCanvas || files.some((f) => /\.pxo$/i.test(f.name)))) return ctx.openFiles(files);
    const data = snapshot(e.dataTransfer);
    const r = app.vp.stage.getBoundingClientRect();
    await fromTransfer(data, 'normal', app.vp.toDoc(e.clientX - r.left, e.clientY - r.top));
  });

  globals.newFromClipboard = () => ui.newFromClipboard();
  ctx.pasteTransfer = fromTransfer;
}
