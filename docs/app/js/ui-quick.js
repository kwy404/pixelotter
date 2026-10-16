// The Quick workspace and the features it shows first: one tap looks, auto enhance, simple
// sliders, background removal with a refine brush and feather, the sticker maker, text
// presets, shapes and resizing to a template. Also the inline text editor and the samples.

import { makeLayer, newId, findLayer } from '../lib/doc.js';
import { LOOK_NAMES, combineLook } from '../lib/filters/looks.js';
import { applyAdjustments, normalizeAdjustments } from '../lib/filters/adjust.js';
import { STICKER, captionSize, fitBudget, outlineMask, stickerLayout } from '../lib/sticker.js';
import { maskBounds } from '../lib/mask.js';
import { MODEL, coverage } from '../lib/segment.js';
import { imageSizeOps, canvasSizeOps } from '../lib/geometry.js';
import { makeCanvas } from './engine/assets.js';
import { TEXT_PRESETS, FONTS, ensureFont } from './engine/text.js';
import { Segmenter, DOWNLOAD_MB } from './segmenter.js';
import { openFile, download } from './files.js';

export function installQuick(ctx) {
  const { app, S, t, globals, ui } = ctx;
  const seg = new Segmenter();
  ctx.segmenter = seg;
  S.model = { state: 'idle', progress: 0, error: '', mb: DOWNLOAD_MB };
  seg.on((s) => (S.model = { ...S.model, state: s.state, progress: s.progress, error: s.error ? ctx.modelError({ message: s.error }) : '' }));
  S.modelName = MODEL.name;
  S.modelLicense = MODEL.license;
  S.textPresets = TEXT_PRESETS;
  S.fonts = FONTS.map((f) => f.family);

  ctx.modelError = (err) => {
    const m = String(err?.message ?? err);
    return t('model.error', { reason: m });
  };
  // the quick select tool asks the app for these
  app.modelError = (err) => ctx.modelError(err);
  app.subjectMask = () => ctx.subjectMask();

  /** A mask (document sized) of the main subject of the whole picture. */
  ctx.subjectMask = async () => {
    const px = await app.samplePixels(true);
    return seg.segment(px.data, px.width, px.height);
  };

  // ---------- looks ----------
  const lookThumbs = async () => {
    // thumbnails of the active photo through each look
    const l = app.edoc?.activeLayer;
    let base;
    if (l?.type === 'raster') {
      const a = app.edoc.assets.get(l.asset);
      const k = 84 / Math.min(a.w, a.h);
      const w = Math.round(a.w * k);
      const h = Math.round(a.h * k);
      const c = makeCanvas(84, 84);
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(a.canvas, (84 - w) / 2, (84 - h) / 2, w, h);
      base = g.getImageData(0, 0, 84, 84);
    } else {
      const c = makeCanvas(84, 84);
      const g = c.getContext('2d', { willReadFrequently: true });
      const grad = g.createLinearGradient(0, 0, 84, 84);
      grad.addColorStop(0, '#6d5a52');
      grad.addColorStop(1, '#c48d63');
      g.fillStyle = grad;
      g.fillRect(0, 0, 84, 84);
      base = g.getImageData(0, 0, 84, 84);
    }
    const out = [];
    for (const id of LOOK_NAMES) {
      const img = applyAdjustments({ data: base.data, width: 84, height: 84 }, combineLook({}, id));
      const c = document.createElement('canvas');
      c.width = c.height = 84;
      c.getContext('2d').putImageData(new ImageData(img.data, 84, 84), 0, 0);
      out.push({ id, thumb: c.toDataURL('image/jpeg', 0.8) });
    }
    S.looks = out;
  };
  ctx.lookThumbs = lookThumbs;
  let lookTimer = null;
  ctx.onActiveChanged = () => {
    clearTimeout(lookTimer);
    lookTimer = setTimeout(lookThumbs, 400);
  };
  const photo = () => {
    const l = app.edoc?.activeLayer;
    if (l?.type === 'raster') return l;
    // in Quick, the topmost photo is the subject of every button
    const r = [...(app.edoc?.doc.layers ?? [])].reverse().find((x) => x.type === 'raster');
    if (r) app.selectLayer(r.id);
    return r ?? null;
  };
  globals.quickLook = (id) => {
    const l = photo();
    if (!l) return ctx.toast(t('quick.pickPhoto'), 'warning');
    app.edoc.commit(t('history.look'), [{ t: 'set', id: l.id, props: { look: l.look === id ? 'none' : id } }], { icon: 'filters' });
  };
  globals.quickAuto = () => {
    const l = photo();
    if (!l) return ctx.toast(t('quick.pickPhoto'), 'warning');
    app.run('image.autoTone');
  };
  globals.quickAdjust = (k, v) => {
    const l = photo();
    if (!l) return;
    const adjust = { ...normalizeAdjustments(l.adjust), [k]: Number(v) };
    app.edoc.commit(t(`adjust.${k}`), [{ t: 'set', id: l.id, props: { adjust } }], { merge: `adjust:${k}:${l.id}`, icon: 'adjust' });
  };
  globals.quickAdjustReset = () => {
    const l = photo();
    if (l) app.edoc.commit(t('quick.reset'), [{ t: 'set', id: l.id, props: { adjust: normalizeAdjustments({}), look: 'none' } }], { icon: 'adjust' });
  };
  globals.quickText = async (presetId) => {
    if (!app.edoc) return;
    const p = TEXT_PRESETS.find((x) => x.id === presetId);
    const d = app.edoc.doc;
    const id = newId();
    const size = Math.round(Math.min(d.width, d.height) * 0.09);
    const layer = makeLayer('text', { id, name: t(`preset.${presetId}`), text: t('text.placeholder'), x: d.width / 2, y: d.height * 0.8, ...p.props, size: Math.max(16, Math.round((p.props.size ?? 96) * (size / 96))) });
    await ensureFont(layer);
    app.edoc.commit(t('history.addText'), [{ t: 'add', layer, index: app.edoc.doc.layers.length }], { icon: 'text' });
    app.selectLayer(id);
    app.editText(id, true);
  };
  globals.quickShape = (shape) => {
    if (!app.edoc) return;
    const d = app.edoc.doc;
    const s = Math.min(d.width, d.height) * 0.3;
    const id = newId();
    const layer = makeLayer('shape', { id, name: t(`shape.${shape}`), shape, w: shape === 'arrow' ? s * 1.4 : s, h: shape === 'arrow' ? s * 0.25 : s, x: d.width / 2, y: d.height / 2, fillColor: shape === 'arrow' ? null : S.colors.fg, stroke: shape === 'arrow' ? S.colors.fg : null, strokeWidth: shape === 'arrow' ? Math.max(6, s * 0.04) : 0 });
    app.edoc.commit(t('history.addShape'), [{ t: 'add', layer, index: app.edoc.doc.layers.length }], { icon: 'shape' });
    app.selectLayer(id);
    app.setTool('move');
  };
  globals.quickResize = async (tp) => {
    if (!app.edoc) return globals.newFromTemplate(tp);
    const d = app.edoc.doc;
    // keep the picture centered and covering the new frame
    const ops = canvasSizeOps(d, tp.w, tp.h);
    app.edoc.commit(t('history.canvasSize'), ops, { icon: 'frame' });
    const l = photo();
    if (l) {
      const size = app.renderer.size(l);
      const k = Math.max(tp.w / size.w, tp.h / size.h);
      app.edoc.commit(t('history.scale'), [{ t: 'set', id: l.id, props: { x: tp.w / 2, y: tp.h / 2, scaleX: k * Math.sign(l.scaleX), scaleY: k * Math.sign(l.scaleY) } }]);
    }
    app.vp.fit();
    void imageSizeOps;
  };

  // ---------- remove background ----------
  ui.removeBackground = async () => {
    const l = app.edoc?.activeLayer;
    if (!l || l.type !== 'raster') return ctx.toast(t('quick.pickPhoto'), 'warning');
    const cached = await seg.isCached();
    if (!cached) app.status(t('model.downloading', { mb: DOWNLOAD_MB }));
    try {
      const rgba = app.edoc.assets.read(l.asset);
      const mask = await seg.segment(rgba, l.w, l.h);
      if (coverage(mask) < 0.005) {
        ctx.toast(t('cutout.nothing'), 'warning');
        return;
      }
      const data = new Uint8ClampedArray(l.w * l.h * 4);
      for (let i = 0; i < mask.length; i++) {
        data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 255;
        data[i * 4 + 3] = mask[i];
      }
      const asset = newId('a');
      app.edoc.commit(t('cmd.layer.removeBackground'), [{ t: 'asset', id: asset, w: l.w, h: l.h, data }, { t: 'set', id: l.id, props: { mask: { asset, enabled: true, feather: l.mask?.feather ?? 1 } } }], { icon: 'cutout' });
      ctx.toast(t('cutout.done'), 'success');
      if (S.workspace === 'quick') S.quickTab = 'cutout';
    } catch (err) {
      ctx.toast(ctx.modelError(err), 'danger');
    } finally {
      app.status('');
    }
  };
  globals.refineBrush = (mode) => {
    const l = app.edoc?.activeLayer;
    if (!l?.mask) return;
    S.refine = mode;
    app.maskEdit = true;
    S.maskEdit = true;
    app.setColor('fg', mode === 'keep' ? '#ffffff' : '#000000');
    globals.setTool('brush');
    app.syncLayers();
  };

  // ---------- sticker maker ----------
  let stickerSource = null;
  ui.stickerDialog = async () => {
    const edoc = app.edoc;
    S.dlg.sticker = { outline: 12, outlineColor: '#ffffff', caption: '', font: 'Baloo 2', status: '', error: '', working: true };
    S.canShareFiles = !!navigator.canShare;
    ui.openDialog('dlg-sticker');
    try {
      // the subject: the active photo cut out with its mask, or a fresh cutout of the picture
      const d = edoc.doc;
      const full = app.renderer.render({ scale: Math.min(1, 1024 / Math.max(d.width, d.height)), background: false });
      const w = full.width;
      const h = full.height;
      let data = full.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
      const hasMask = edoc.doc.layers.some((l) => l.mask?.enabled);
      const opaque = (() => {
        for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return false;
        return true;
      })();
      if (!hasMask && opaque) {
        const mask = await seg.segment(data, w, h);
        data = new Uint8ClampedArray(data);
        for (let i = 0; i < mask.length; i++) data[i * 4 + 3] = mask[i];
      }
      stickerSource = { data, width: w, height: h };
      S.dlg.sticker.working = false;
      await ensureFont({ font: S.dlg.sticker.font, weight: 800, italic: false, text: 'A' });
      await globals.stickerDraw();
    } catch (err) {
      S.dlg.sticker.working = false;
      S.dlg.sticker.error = ctx.modelError(err);
    }
  };
  let stickerBlob = null;
  globals.stickerDraw = async () => {
    const src = stickerSource;
    const c = document.getElementById('sticker-canvas');
    if (!src || !c) return;
    const o = S.dlg.sticker;
    await ensureFont({ font: o.font, weight: 800, italic: false, text: o.caption || 'A' });
    const alpha = new Uint8Array(src.width * src.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = src.data[i * 4 + 3];
    const b = maskBounds(alpha, src.width, src.height, 24) ?? { x: 0, y: 0, w: src.width, h: src.height };
    const g = c.getContext('2d', { willReadFrequently: true });
    g.clearRect(0, 0, 512, 512);
    const measure = (text, px) => {
      g.font = `800 ${px}px "${o.font}", system-ui, sans-serif`;
      return g.measureText(text).width;
    };
    const capPx = captionSize(measure, o.caption);
    const lay = stickerLayout(b, { outline: o.outline, caption: capPx ? capPx * 1.25 : 0 });
    // subject scaled into a 512 canvas
    const subj = makeCanvas(512, 512);
    const sg = subj.getContext('2d', { willReadFrequently: true });
    const tmp = makeCanvas(src.width, src.height);
    tmp.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(src.data), src.width, src.height), 0, 0);
    sg.imageSmoothingQuality = 'high';
    sg.drawImage(tmp, b.x, b.y, b.w, b.h, lay.x, lay.y, lay.w, lay.h);
    // the white outline from the subject's alpha
    if (o.outline > 0) {
      const sa = sg.getImageData(0, 0, 512, 512).data;
      const a = new Uint8Array(512 * 512);
      for (let i = 0; i < a.length; i++) a[i] = sa[i * 4 + 3];
      const ring = outlineMask(a, 512, 512, o.outline);
      const img = g.createImageData(512, 512);
      const [r, gg, bb] = [1, 3, 5].map((k) => parseInt(o.outlineColor.slice(k, k + 2), 16));
      for (let i = 0; i < ring.length; i++) img.data.set([r, gg, bb, ring[i]], i * 4);
      g.putImageData(img, 0, 0);
    }
    g.drawImage(subj, 0, 0);
    if (capPx) {
      g.font = `800 ${capPx}px "${o.font}", system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'alphabetic';
      g.lineJoin = 'round';
      g.lineWidth = Math.max(6, capPx * 0.22);
      g.strokeStyle = '#141414';
      const y = 512 - STICKER.margin - capPx * 0.3;
      g.strokeText(o.caption, 256, y);
      g.fillStyle = '#ffffff';
      g.fillText(o.caption, 256, y);
    }
    // encode under the size budget
    const encode = (q) => new Promise((resolve) => c.toBlob(resolve, 'image/webp', q));
    const probe = await encode(0.9);
    if (!probe || probe.type !== 'image/webp') {
      stickerBlob = await new Promise((r) => c.toBlob(r, 'image/png'));
      o.status = t('sticker.noWebp');
      o.format = 'png';
      return;
    }
    const res = await fitBudget(encode, { budget: STICKER.budget });
    stickerBlob = res.result;
    o.format = 'webp';
    o.status = res.ok ? t('sticker.size', { kb: (res.size / 1000).toFixed(1), q: Math.round(res.quality * 100) }) : t('sticker.tooBig', { kb: (res.size / 1000).toFixed(1) });
    o.size = res.size;
  };
  globals.stickerDownload = async () => {
    if (!stickerBlob) return;
    const name = `${(app.edoc.doc.name || 'sticker').replace(/[^\w-]+/g, '-')}-sticker.${S.dlg.sticker.format}`;
    download(new Uint8Array(await stickerBlob.arrayBuffer()), name, stickerBlob.type);
    ctx.toast(t('toast.exported', { name }), 'success');
  };
  globals.stickerShare = async () => {
    if (!stickerBlob) return;
    const file = new File([stickerBlob], `sticker.${S.dlg.sticker.format}`, { type: stickerBlob.type });
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'Sticker' });
      else await globals.stickerDownload();
    } catch (err) {
      if (err?.name !== 'AbortError') await globals.stickerDownload();
    }
  };

  // ---------- inline text editor ----------
  // A transparent textarea over the text layer gives the caret, selection, typing, arrows,
  // Backspace and Enter for new lines; the canvas draws the text live under it. Escape, a click
  // outside or another tool commits the edit as one undoable step.
  const ta = document.getElementById('text-editor');
  let editing = null;
  /** The layer name that follows the text: its first line, shortened. */
  const nameFor = (text) => text.split('\n').find((x) => x.trim())?.trim().slice(0, 40) || t('layer.text');
  app.textEditor = {
    isOpen: () => !!editing,
    editingId: () => editing?.id ?? null,
    open(id, selectAll) {
      if (editing) this.close();
      const l = findLayer(app.edoc.doc, id);
      if (!l || l.type !== 'text') return;
      editing = { id, before: l.text, ready: false };
      ta.hidden = false;
      ta.value = l.text;
      place();
      // the click that opened the editor moves the focus to the canvas after this handler
      // runs, so the textarea takes the focus once that click is done
      setTimeout(() => {
        if (editing?.id !== id) return;
        editing.ready = true;
        ta.focus({ preventScroll: true });
        if (selectAll) ta.select();
        else ta.setSelectionRange(ta.value.length, ta.value.length);
      }, 0);
    },
    close() {
      if (!editing) return;
      const { id, before } = editing;
      editing = null;
      ta.hidden = true;
      const l = findLayer(app.edoc?.doc ?? { layers: [] }, id);
      if (!l) return;
      if (!l.text.trim()) {
        // an empty text layer is removed
        app.edoc.apply([{ t: 'set', id, props: { text: before } }]);
        app.edoc.commit(t('cmd.layer.delete'), [{ t: 'remove', id }]);
        return;
      }
      if (l.text !== before) {
        const text = l.text;
        const props = { text };
        // the name follows the text until the layer is renamed by hand
        if (l.name === nameFor(before) || l.name === t('layer.text') || l.name === t('text.placeholder')) props.name = nameFor(text);
        app.edoc.apply([{ t: 'set', id, props: { text: before } }]);
        app.edoc.commit(t('history.editText'), [{ t: 'set', id, props }], { icon: 'text' });
      }
    },
  };
  const place = () => {
    if (!editing) return;
    const l = findLayer(app.edoc.doc, editing.id);
    if (!l) return;
    const s = app.vp.toScreen(l.x, l.y);
    const box = app.renderer.size(l);
    const z = app.vp.view.zoom * Math.abs(l.scaleX);
    ta.style.left = `${s.x}px`;
    ta.style.top = `${s.y}px`;
    ta.style.width = `${Math.max(120, box.w * z + 8)}px`;
    ta.style.height = `${Math.max(40, box.h * z + 8)}px`;
    ta.style.transform = `translate(-50%, -50%) rotate(${l.rotation}deg)`;
    ta.style.font = `${l.italic ? 'italic ' : ''}${l.weight} ${Math.max(10, l.size * z)}px "${l.font}"`;
    ta.style.textAlign = l.align;
    ta.style.lineHeight = String(l.lineHeight);
  };
  app.textEditor.place = place;
  ta.addEventListener('input', () => {
    if (!editing) return;
    app.edoc.apply([{ t: 'set', id: editing.id, props: { text: ta.value } }]);
    place();
  });
  ta.addEventListener('blur', () => {
    if (editing?.ready) app.textEditor.close();
  });
  ta.addEventListener('keydown', (e) => {
    // keys typed into the text never reach the editor's shortcuts
    e.stopPropagation();
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && (k === 'b' || k === 'i')) {
      e.preventDefault();
      const o = S.options.text;
      if (k === 'b') o.weight = o.weight >= 600 ? 400 : 700;
      else o.italic = !o.italic;
      globals.textOpt(k === 'b' ? 'weight' : 'italic');
      return;
    }
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      app.textEditor.close();
      ta.blur();
    }
  });
  globals.textOpt = (key) => {
    const l = app.edoc?.activeLayer;
    const o = S.options.text;
    if (key === 'preset' && o.preset) {
      const p = TEXT_PRESETS.find((x) => x.id === o.preset);
      if (p) {
        Object.assign(o, { font: p.props.font, weight: p.props.weight ?? o.weight });
        if (l?.type === 'text') {
          app.edoc.commit(t('history.textStyle'), [{ t: 'set', id: l.id, props: p.props }], { icon: 'text' });
          app.applyFontLater(app.edoc.layer(l.id));
        }
      }
      return;
    }
    if (l?.type === 'text' && key in o && o[key] !== null && o[key] !== '' && o[key] !== l[key]) {
      if (key === 'size' && !(Number(o.size) >= 4)) return;
      app.edoc.commit(t('history.textStyle'), [{ t: 'set', id: l.id, props: { [key]: o[key] } }], { merge: `text:${key}:${l.id}`, icon: 'text' });
      if (key === 'font' || key === 'weight' || key === 'italic') app.applyFontLater(app.edoc.layer(l.id));
      app.textEditor.place();
    }
  };
  // the options bar shows the style of the selected text layer
  const onActive = ctx.onActiveChanged;
  ctx.onActiveChanged = () => {
    onActive?.();
    const l = app.edoc?.activeLayer;
    if (l?.type !== 'text') return;
    const o = S.options.text;
    for (const k of ['font', 'size', 'weight', 'italic', 'color', 'align']) if (o[k] !== l[k]) o[k] = l[k];
  };

  // ---------- samples ----------
  globals.openSample = async (name = 'otter-desk') => {
    const res = await fetch(`samples/${name}.jpg`);
    const blob = await res.blob();
    const file = new File([blob], `${name}.jpg`, { type: 'image/jpeg' });
    const edoc = await openFile(file);
    edoc.doc.name = t('sample.name');
    edoc.history.markSaved();
    app.add(edoc);
    return edoc;
  };
}
