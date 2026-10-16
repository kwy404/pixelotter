// Dialog behavior: new document, export with a size preview, image and canvas size, every
// filter (built from the registry, with live preview on the canvas), curves and levels,
// layer styles, fill, stroke, selection changes, color range, refine edge, content aware fill,
// liquify, guides, settings, shortcuts, about, and the confirm and prompt helpers.

import { createDoc, newId, findLayer } from '../lib/doc.js';
import { FORMATS, WRITABLE } from '../lib/formats/index.js';
import { getFilter, defaults as filterDefaults, normalizeParams, runFilter } from '../lib/filters/registry.js';
import { curveTable } from '../lib/filters/tone.js';
import { STYLE_DEFAULTS, normalizeStyles } from '../lib/styles.js';
import { imageSizeOps, canvasSizeOps } from '../lib/geometry.js';
import { patchOp } from '../lib/pixels.js';
import { contentAwareFill } from '../lib/filters/inpaint.js';
import { createField, dab, applyField, isIdentity } from '../lib/filters/liquify.js';
import { expandMask, contractMask, featherMask, connectedRegion } from '../lib/mask.js';
import { fromHex } from '../lib/color/convert.js';
import { MODEL, RUNTIME } from '../lib/segment.js';
import { EditorDocument } from './engine/document.js';
import { makeCanvas } from './engine/assets.js';
import { exportDocument, saveExport, saveProject } from './files.js';
import { filterLayerOps } from './commands.js';
import { press } from './engine/render.js';
import { keyLabel, MENUS } from './commands.js';
import { stunCheck } from './live.js';

export const PRESETS = [
  { id: 'post', w: 1080, h: 1080, dpi: 72 },
  { id: 'story', w: 1080, h: 1920, dpi: 72 },
  { id: 'portrait', w: 1080, h: 1350, dpi: 72 },
  { id: 'thumbnail', w: 1280, h: 720, dpi: 72 },
  { id: 'sticker', w: 512, h: 512, dpi: 72 },
  { id: 'hd', w: 1920, h: 1080, dpi: 72 },
  { id: 'uhd', w: 3840, h: 2160, dpi: 72 },
  { id: 'a4', w: 2480, h: 3508, dpi: 300 },
  { id: 'letter', w: 2550, h: 3300, dpi: 300 },
  { id: 'postcard', w: 1800, h: 1200, dpi: 300 },
  { id: 'icon', w: 1024, h: 1024, dpi: 72 },
  { id: 'custom', w: 1200, h: 800, dpi: 72 },
];

export function installDialogs(ctx) {
  const { app, S, t, globals, ui } = ctx;
  const $ = (id) => document.getElementById(id);

  ui.openDialog = (id) => {
    const d = $(id);
    if (d && !d.open) d.showModal();
    return d;
  };
  ui.closeDialog = (id) => {
    const d = $(id);
    if (d?.open) d.close();
  };
  globals.closeDialog = (id) => {
    if (id === 'dlg-filter') return globals.filterCancel();
    if (id === 'dlg-liquify') ctx.liquify = null;
    if (id === 'dlg-settings') globals.saveSettings();
    ui.closeDialog(id);
  };
  // closing with Escape goes through the same paths
  document.addEventListener('cancel', (e) => {
    if (e.target.id === 'dlg-filter') {
      e.preventDefault();
      globals.filterCancel();
    }
  }, true);

  // ---------- confirm and prompt ----------
  let answer = null;
  ui.confirm = (title, text, { yes = null, no = null, third = null } = {}) =>
    new Promise((resolve) => {
      S.dlg.confirm = { title, text, yes, no, third, input: null };
      answer = resolve;
      ui.openDialog('dlg-confirm');
    });
  ui.prompt = (title, text, value = '') =>
    new Promise((resolve) => {
      S.dlg.confirm = { title, text, yes: null, no: null, third: null, input: value };
      answer = (ok) => resolve(ok === true ? S.dlg.confirm.input : null);
      ui.openDialog('dlg-confirm');
      setTimeout(() => $('confirm-input')?.select(), 30);
    });
  globals.confirmAnswer = (v) => {
    ui.closeDialog('dlg-confirm');
    answer?.(v === 'third' ? 'third' : v);
    answer = null;
  };

  // ---------- new document ----------
  S.presets = PRESETS;
  ui.newDocument = (preset = null) => {
    const p = preset ?? PRESETS[0];
    S.dlg.new = { preset: p.id, name: t('doc.untitled'), w: p.w, h: p.h, dpi: p.dpi, bg: 'white', mode: 'rgb' };
    ui.openDialog('dlg-new');
  };
  globals.pickPreset = (p) => Object.assign(S.dlg.new, { preset: p.id, w: p.w, h: p.h, dpi: p.dpi });
  globals.createDocument = () => {
    const n = S.dlg.new;
    const bg = { white: '#ffffff', black: '#000000', paper: '#f3efe6', transparent: null, fg: S.colors.fg }[n.bg];
    const doc = createDoc({ name: n.name || t('doc.untitled'), width: n.w, height: n.h, background: bg });
    doc.dpi = Math.max(1, Math.min(4800, n.dpi || 72));
    doc.mode = n.mode;
    const edoc = new EditorDocument(doc);
    edoc.history.markSaved();
    app.add(edoc);
    ui.closeDialog('dlg-new');
    if (S.workspace === 'pro') app.run('layer.new');
  };
  globals.newFromTemplate = (tp) => {
    const doc = createDoc({ name: t(`template.${tp.id}`), width: tp.w, height: tp.h, background: tp.id === 'sticker' ? null : '#ffffff' });
    const edoc = new EditorDocument(doc);
    edoc.history.markSaved();
    app.add(edoc);
  };

  // ---------- save, revert, mode, duplicate ----------
  ui.save = async (edoc, as = false) => {
    try {
      const r = await saveProject(edoc, { as });
      if (!r) return false;
      edoc.history.markSaved();
      app.syncTabs();
      ctx.autosaver?.markClean(edoc);
      S.saved = t('status.saved', { name: r.name });
      ctx.toast(r.inPlace ? t('toast.savedInPlace', { name: r.name }) : t('toast.savedDownload', { name: r.name }), 'success');
      return true;
    } catch (err) {
      ctx.toast(t('toast.saveFailed', { error: err.message }), 'danger');
      return false;
    }
  };
  ui.revert = async (edoc) => {
    const ok = await ui.confirm(t('revert.title'), t('revert.text'));
    if (!ok) return;
    const { unpackProject } = await import('../lib/project.js');
    const bytes = edoc.file.saved;
    if (!bytes) return;
    const p = unpackProject(bytes);
    await edoc.load({ doc: p.doc, assets: p.assets });
    edoc.history.clear();
    app.syncAll();
  };
  ui.setMode = async (mode) => {
    const edoc = app.edoc;
    if (mode === 'cmyk') {
      app.status(t('status.buildingPress'));
      await new Promise((r) => setTimeout(r, 20));
      press();
      app.status('');
      ctx.toast(t('cmyk.honest'), 'info');
    }
    if (mode === 'gray' && edoc.doc.mode !== 'gray') {
      const ok = await ui.confirm(t('mode.grayTitle'), t('mode.grayText'));
      if (!ok) return;
      // gray: convert the pixels of every raster layer (undoable)
      const ops = [];
      for (const l of edoc.doc.layers) {
        if (l.type !== 'raster') continue;
        const data = new Uint8ClampedArray(edoc.assets.read(l.asset));
        for (let i = 0; i < data.length; i += 4) data[i] = data[i + 1] = data[i + 2] = Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
        ops.push(patchOp(l.asset, { x: 0, y: 0, w: l.w, h: l.h }, data));
      }
      ops.push({ t: 'doc', props: { mode } });
      edoc.commit(t('history.mode'), ops, { icon: 'adjust' });
      return;
    }
    edoc.commit(t('history.mode'), [{ t: 'doc', props: { mode } }], { icon: 'cmyk' });
  };
  ui.duplicateDocument = async (edoc) => {
    const snap = await edoc.snapshot();
    const copy = new EditorDocument(createDoc());
    await copy.load({ ...snap, doc: { ...snap.doc, id: newId('d'), name: `${snap.doc.name} ${t('layer.copy')}` } });
    app.add(copy);
  };

  // ---------- export ----------
  S.exportFormats = WRITABLE.map((id) => ({ id, label: FORMATS[id].label }));
  let exportTimer = null;
  let exportResult = null;
  ui.exportDialog = (format = null) => {
    const f = format ?? (S.dlg.export.format || 'png');
    S.dlg.export = { ...S.dlg.export, format: f, quality: S.dlg.export.quality ?? 0.9, scale: 1, cmyk: app.edoc.doc.mode === 'cmyk', animated: app.edoc.doc.frames.length > 1, pages: false, error: '', note: '', sizeText: '', previewUrl: '' };
    globals.exportChanged();
    ui.openDialog('dlg-export');
  };
  globals.exportChanged = () => {
    const e = S.dlg.export;
    const f = FORMATS[e.format];
    e.hasQuality = !!f.quality;
    e.canCmyk = !!f.cmyk;
    e.canAnimate = !!f.frames && app.edoc.doc.frames.length > 1;
    e.canPages = !!f.pages && app.edoc.doc.layers.length > 1;
    if (!e.canCmyk) e.cmyk = false;
    e.note = e.format === 'psd' || e.format === 'psb' ? t('export.psdNote') : e.format === 'jpeg' && !app.edoc.doc.background ? t('export.jpegNote') : e.format === 'gif' ? t('export.gifNote') : '';
    e.busy = true;
    clearTimeout(exportTimer);
    exportTimer = setTimeout(measure, 250);
  };
  async function measure() {
    const e = S.dlg.export;
    try {
      // the size preview encodes the real file at a small scale for big documents, then scales the estimate
      const d = app.edoc.doc;
      const pixels = d.width * d.height * e.scale * e.scale;
      const probeScale = pixels > 6e6 ? Math.sqrt(6e6 / (d.width * d.height)) : e.scale;
      const r = await exportDocument(app.edoc, { format: e.format, quality: e.quality, scale: probeScale, cmyk: e.cmyk, animated: e.animated, pages: e.pages, sizes: [16, 32, 48, 256] });
      const estimate = r.bytes.length * ((e.scale * e.scale) / (probeScale * probeScale));
      e.sizeText = `${probeScale === e.scale ? '' : t('export.about')} ${formatBytes(estimate)} (${Math.round(d.width * e.scale)} x ${Math.round(d.height * e.scale)} px)`;
      if (['png', 'jpeg', 'webp', 'avif', 'gif', 'bmp'].includes(e.format)) {
        if (e.previewUrl) URL.revokeObjectURL(e.previewUrl);
        e.previewUrl = URL.createObjectURL(new Blob([r.bytes], { type: r.mime }));
      } else {
        const c = app.renderer.render({ scale: Math.min(1, 480 / Math.max(d.width, d.height)) });
        e.previewUrl = c.convertToBlob ? URL.createObjectURL(await c.convertToBlob()) : c.toDataURL();
      }
      e.error = '';
      exportResult = probeScale === e.scale ? r : null;
    } catch (err) {
      e.error = err.message;
      e.sizeText = '';
    }
    e.busy = false;
  }
  const buildExport = async () => {
    const e = S.dlg.export;
    if (exportResult) return exportResult;
    return exportDocument(app.edoc, { format: e.format, quality: e.quality, scale: e.scale, cmyk: e.cmyk, animated: e.animated, pages: e.pages, sizes: [16, 32, 48, 256] });
  };
  globals.doExport = async () => {
    try {
      const r = await buildExport();
      const name = await saveExport(r);
      if (name) ctx.toast(t('toast.exported', { name }), 'success');
      ui.closeDialog('dlg-export');
    } catch (err) {
      S.dlg.export.error = err.message;
    }
  };
  globals.exportAndSend = async () => {
    try {
      const r = await buildExport();
      ui.closeDialog('dlg-export');
      await ctx.startSend(r);
    } catch (err) {
      S.dlg.export.error = err.message;
    }
  };
  ui.quickExport = async () => {
    const r = await exportDocument(app.edoc, { format: 'png', scale: 1 });
    const name = await saveExport(r);
    if (name) ctx.toast(t('toast.exported', { name }), 'success');
  };

  // ---------- image and canvas size ----------
  ui.imageSizeDialog = () => {
    const d = app.edoc.doc;
    S.dlg.size = { w: d.width, h: d.height, dpi: d.dpi, keep: true, ratio: d.width / d.height };
    ui.openDialog('dlg-imagesize');
  };
  globals.sizeInput = (axis, v) => {
    const s = S.dlg.size;
    s[axis] = Math.max(1, Math.round(+v || 1));
    if (s.keep) {
      if (axis === 'w') s.h = Math.max(1, Math.round(s.w / s.ratio));
      else s.w = Math.max(1, Math.round(s.h * s.ratio));
    }
  };
  globals.applyImageSize = () => {
    const s = S.dlg.size;
    app.edoc.commit(t('history.imageSize'), [...imageSizeOps(app.edoc.doc, s.w, s.h), { t: 'doc', props: { dpi: s.dpi } }], { icon: 'frame' });
    ui.closeDialog('dlg-imagesize');
    app.vp.fit();
  };
  ui.canvasSizeDialog = () => {
    const d = app.edoc.doc;
    S.dlg.canvas = { w: d.width, h: d.height, anchor: 4 };
    ui.openDialog('dlg-canvassize');
  };
  globals.applyCanvasSize = () => {
    const c = S.dlg.canvas;
    const anchor = [(c.anchor % 3) / 2, Math.floor(c.anchor / 3) / 2];
    app.edoc.commit(t('history.canvasSize'), canvasSizeOps(app.edoc.doc, c.w, c.h, anchor), { icon: 'frame' });
    ui.closeDialog('dlg-canvassize');
    app.vp.fit();
  };

  // ---------- filters ----------
  let previewTimer = null;
  ui.filterDialog = (id, { destructive = false, params = null, instant = false, layerId = null } = {}) => {
    const f = getFilter(id);
    const edoc = app.edoc;
    const l = edoc.activeLayer;
    const adjustLayer = layerId ? findLayer(edoc.doc, layerId) : null;
    const values = normalizeParams(id, params ?? adjustLayer?.params ?? filterDefaults(id));
    S.dlg.filter = { id, title: adjustLayer ? `${t(`filter.${id}`)} (${adjustLayer.name})` : t(`filter.${id}`), params: f.params.map((p) => ({ ...p, label: t(`param.${id}.${p.key}`) !== `param.${id}.${p.key}` ? t(`param.${id}.${p.key}`) : t(`param.${p.key}`) })), values, preview: true, channel: f.params[0]?.type === 'levels' ? 'master' : 'rgb', layerId: adjustLayer?.id ?? l?.id, adjustLayer: !!adjustLayer, original: adjustLayer ? JSON.parse(JSON.stringify(adjustLayer.params)) : null, destructive };
    if (f.instant || instant) {
      // no settings to ask for: apply at once
      return applyFilter(id, values);
    }
    ui.openDialog('dlg-filter');
    setTimeout(() => {
      globals.drawCurves();
      drawHistogram();
      globals.filterPreview();
    }, 30);
  };
  globals.editAdjustment = () => {
    const l = app.edoc.activeLayer;
    if (l?.type === 'adjust') ui.filterDialog(l.filter, { layerId: l.id });
  };
  globals.filterParam = (key, v) => {
    S.dlg.filter.values = { ...S.dlg.filter.values, [key]: v };
    schedulePreview();
  };
  globals.filterTriple = (key, k, v) => {
    const arr = [...S.dlg.filter.values[key]];
    arr[k] = v;
    globals.filterParam(key, arr);
  };
  globals.filterStop = (key, i, color) => {
    const stops = S.dlg.filter.values[key].map((s) => ({ ...s }));
    stops[i < 0 ? stops.length - 1 : i].color = color;
    globals.filterParam(key, stops);
  };
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(globals.filterPreview, 60);
  }
  globals.filterPreview = () => {
    const F = S.dlg.filter;
    const r = app.renderer;
    if (F.adjustLayer) {
      // an adjustment layer previews by itself: change its parameters live
      app.edoc.apply([{ t: 'set', id: F.layerId, props: { params: F.values } }]);
      return;
    }
    r.overrides ??= new Map();
    r.overrides.delete(F.layerId);
    const l = findLayer(app.edoc.doc, F.layerId);
    if (!F.preview || !l || l.type !== 'raster') {
      app.vp.invalidate();
      return;
    }
    const a = app.edoc.assets.get(l.asset);
    // preview on a copy no bigger than about 1.5 megapixels
    const k = Math.min(1, Math.sqrt(1.5e6 / (a.w * a.h)));
    const w = Math.max(1, Math.round(a.w * k));
    const h = Math.max(1, Math.round(a.h * k));
    const c = makeCanvas(w, h);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(a.canvas, 0, 0, w, h);
    const img = g.getImageData(0, 0, w, h);
    const out = runFilter(F.id, { data: img.data, width: w, height: h }, F.values, { scale: k });
    g.putImageData(new ImageData(out.data, w, h), 0, 0);
    r.overrides.set(F.layerId, c);
    app.vp.invalidate();
  };
  const clearPreview = () => {
    app.renderer.overrides?.clear();
    app.vp.invalidate();
  };
  globals.filterReset = () => {
    S.dlg.filter.values = filterDefaults(S.dlg.filter.id);
    globals.drawCurves();
    globals.filterPreview();
  };
  globals.filterCancel = () => {
    const F = S.dlg.filter;
    if (F.adjustLayer && F.original) app.edoc.apply([{ t: 'set', id: F.layerId, props: { params: F.original } }]);
    clearPreview();
    ui.closeDialog('dlg-filter');
  };
  globals.filterOk = async () => {
    const F = S.dlg.filter;
    clearPreview();
    ui.closeDialog('dlg-filter');
    if (F.adjustLayer) {
      // record the change as one step from the original parameters
      app.edoc.apply([{ t: 'set', id: F.layerId, props: { params: F.original } }]);
      app.edoc.commit(t('history.adjustment'), [{ t: 'set', id: F.layerId, props: { params: F.values } }], { icon: 'adjust-layer' });
      return;
    }
    await applyFilter(F.id, F.values);
  };
  async function applyFilter(id, values) {
    const l = app.edoc.activeLayer;
    if (!l || l.type !== 'raster') return ctx.toast(t('toast.needPixels'), 'warning');
    app.status(t('status.applying', { name: t(`filter.${id}`) }));
    await new Promise((r) => setTimeout(r, 16));
    try {
      app.edoc.commit(t(`filter.${id}`), filterLayerOps(app, id, values), { icon: 'filters' });
      app.commands.lastFilter = { id, params: values };
    } finally {
      app.status('');
    }
  }

  // curves editor
  let curveDrag = null;
  const curvePoints = () => {
    const F = S.dlg.filter;
    const all = F.values.curves ?? { rgb: [[0, 0], [255, 255]] };
    return all[F.channel] ?? [[0, 0], [255, 255]];
  };
  const setCurvePoints = (pts) => {
    const F = S.dlg.filter;
    const all = { ...(F.values.curves ?? {}) };
    all[F.channel] = pts;
    globals.filterParam('curves', all);
    globals.drawCurves();
  };
  globals.drawCurves = () => {
    const c = $('curves-canvas');
    if (!c || S.dlg.filter.id !== 'curves') return;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 256, 256);
    g.fillStyle = 'rgba(128,128,128,0.08)';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(128,128,128,0.35)';
    g.beginPath();
    for (let i = 64; i < 256; i += 64) {
      g.moveTo(i + 0.5, 0);
      g.lineTo(i + 0.5, 256);
      g.moveTo(0, i + 0.5);
      g.lineTo(256, i + 0.5);
    }
    g.stroke();
    const pts = curvePoints();
    const tab = curveTable(pts);
    g.strokeStyle = { rgb: '#c08a4e', red: '#d06a5a', green: '#6aa36a', blue: '#5a7ad0' }[S.dlg.filter.channel];
    g.lineWidth = 2;
    g.beginPath();
    for (let x = 0; x < 256; x++) (x ? g.lineTo : g.moveTo).call(g, x, 255 - tab[x]);
    g.stroke();
    g.fillStyle = '#f3f1ec';
    for (const [x, y] of pts) {
      g.beginPath();
      g.arc(x, 255 - y, 4, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  };
  const curvePos = (e) => {
    const r = e.target.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / r.width) * 255), Math.round(255 - ((e.clientY - r.top) / r.height) * 255)];
  };
  globals.curveDown = (e) => {
    const [x, y] = curvePos(e);
    const pts = curvePoints().map((p) => [...p]);
    let i = pts.findIndex(([px, py]) => Math.abs(px - x) < 10 && Math.abs(py - y) < 10);
    if (i < 0) {
      pts.push([x, y]);
      pts.sort((a, b) => a[0] - b[0]);
      i = pts.findIndex(([px, py]) => px === x && py === y);
    }
    curveDrag = i;
    e.target.setPointerCapture(e.pointerId);
    setCurvePoints(pts);
  };
  globals.curveMove = (e) => {
    if (curveDrag === null) return;
    const [x, y] = curvePos(e);
    const pts = curvePoints().map((p) => [...p]);
    const lo = curveDrag > 0 ? pts[curveDrag - 1][0] + 1 : 0;
    const hi = curveDrag < pts.length - 1 ? pts[curveDrag + 1][0] - 1 : 255;
    pts[curveDrag] = [Math.max(lo, Math.min(hi, x)), Math.max(0, Math.min(255, y))];
    setCurvePoints(pts);
  };
  globals.curveUp = () => (curveDrag = null);
  globals.curveRemove = (e) => {
    const [x] = curvePos(e);
    const pts = curvePoints();
    if (pts.length <= 2) return;
    const i = pts.findIndex(([px]) => Math.abs(px - x) < 10);
    if (i > 0 && i < pts.length - 1) setCurvePoints(pts.filter((_, k) => k !== i));
  };
  // levels
  globals.levelsVal = (key, def) => S.dlg.filter.values?.levels?.[S.dlg.filter.channel]?.[key] ?? def;
  globals.levelsParam = (key, v) => {
    const all = { ...(S.dlg.filter.values.levels ?? {}) };
    all[S.dlg.filter.channel] = { ...(all[S.dlg.filter.channel] ?? {}), [key]: v };
    globals.filterParam('levels', all);
  };
  function drawHistogram() {
    const c = $('levels-hist');
    const l = app.edoc?.activeLayer;
    if (!c || S.dlg.filter.id !== 'levels' || l?.type !== 'raster') return;
    const a = app.edoc.assets.get(l.asset);
    const k = Math.min(1, Math.sqrt(4e5 / (a.w * a.h)));
    const w = Math.max(1, Math.round(a.w * k));
    const h = Math.max(1, Math.round(a.h * k));
    const tmp = makeCanvas(w, h);
    const g = tmp.getContext('2d', { willReadFrequently: true });
    g.drawImage(a.canvas, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) if (d[i + 3]) hist[Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])]++;
    const max = Math.max(...hist) || 1;
    const cg = c.getContext('2d');
    cg.clearRect(0, 0, 256, 90);
    cg.fillStyle = '#9b968e';
    for (let x = 0; x < 256; x++) cg.fillRect(x, 90 - (hist[x] / max) * 90, 1, (hist[x] / max) * 90);
  }

  // ---------- layer styles ----------
  const STYLE_FIELDS = {
    shadow: [{ key: 'color', type: 'color' }, { key: 'opacity', type: 'range', min: 0, max: 1, step: 0.01 }, { key: 'angle', type: 'range', min: 0, max: 360 }, { key: 'distance', type: 'range', min: 0, max: 200 }, { key: 'size', type: 'range', min: 0, max: 200 }, { key: 'spread', type: 'range', min: 0, max: 100 }],
    outerGlow: [{ key: 'color', type: 'color' }, { key: 'opacity', type: 'range', min: 0, max: 1, step: 0.01 }, { key: 'size', type: 'range', min: 0, max: 200 }, { key: 'spread', type: 'range', min: 0, max: 100 }],
    stroke: [{ key: 'color', type: 'color' }, { key: 'opacity', type: 'range', min: 0, max: 1, step: 0.01 }, { key: 'size', type: 'range', min: 1, max: 100 }, { key: 'position', type: 'select', options: ['outside', 'inside', 'center'] }],
    innerGlow: [{ key: 'color', type: 'color' }, { key: 'opacity', type: 'range', min: 0, max: 1, step: 0.01 }, { key: 'size', type: 'range', min: 1, max: 200 }],
    bevel: [{ key: 'depth', type: 'range', min: 1, max: 1000 }, { key: 'size', type: 'range', min: 1, max: 100 }, { key: 'angle', type: 'range', min: 0, max: 360 }, { key: 'altitude', type: 'range', min: 0, max: 90 }, { key: 'highlight', type: 'range', min: 0, max: 1, step: 0.01 }, { key: 'shadow', type: 'range', min: 0, max: 1, step: 0.01 }, { key: 'soften', type: 'range', min: 0, max: 16 }],
    overlay: [{ key: 'color', type: 'color' }, { key: 'opacity', type: 'range', min: 0, max: 1, step: 0.01 }, { key: 'blend', type: 'select', options: ['normal', 'multiply', 'screen', 'overlay', 'soft-light', 'color'] }],
  };
  globals.styleFields = (k) => STYLE_FIELDS[k] ?? [];
  ui.layerStyleDialog = () => {
    const l = app.edoc.activeLayer;
    const values = JSON.parse(JSON.stringify(normalizeStyles(l.styles ?? {}) ?? STYLE_DEFAULTS));
    S.dlg.style = { tab: 'shadow', values, original: l.styles ? JSON.parse(JSON.stringify(l.styles)) : null, id: l.id };
    ui.openDialog('dlg-style');
  };
  globals.styleSet = (k, key, v) => {
    const values = JSON.parse(JSON.stringify(S.dlg.style.values));
    values[k][key] = v;
    if (key !== 'enabled' && !values[k].enabled) values[k].enabled = true;
    S.dlg.style.values = values;
    app.edoc.apply([{ t: 'set', id: S.dlg.style.id, props: { styles: values } }]);
  };
  globals.styleOk = () => {
    const st = S.dlg.style;
    app.edoc.apply([{ t: 'set', id: st.id, props: { styles: st.original } }]);
    app.edoc.commit(t('history.style'), [{ t: 'set', id: st.id, props: { styles: st.values } }], { icon: 'fx' });
    st.original = st.values;
    ui.closeDialog('dlg-style');
  };
  $('dlg-style')?.addEventListener('close', () => {
    const st = S.dlg.style;
    if (st?.id && JSON.stringify(findLayer(app.edoc?.doc ?? { layers: [] }, st.id)?.styles) !== JSON.stringify(st.original)) app.edoc?.apply([{ t: 'set', id: st.id, props: { styles: st.original } }]);
  });

  // ---------- fill and stroke ----------
  ui.fillDialog = () => {
    S.dlg.fill = { source: 'fg', pattern: 'grain', opacity: 100 };
    ui.openDialog('dlg-fill');
  };
  globals.fillOk = async () => {
    ui.closeDialog('dlg-fill');
    const f = S.dlg.fill;
    if (f.source === 'content') return globals.contentAwareOk();
    const target = app.paintTarget('bucket', { createDocSize: true });
    if (!target) return;
    const a = app.edoc.assets.get(target.asset);
    const before = app.edoc.assets.read(target.asset);
    const sel = app.selectionInLayer(target, { x: 0, y: 0, w: a.w, h: a.h });
    const pat = f.source === 'pattern' ? app.patternPixels(f.pattern) : null;
    const color = { fg: fromHex(S.colors.fg), bg: fromHex(S.colors.bg), white: [255, 255, 255], black: [0, 0, 0], gray: [128, 128, 128] }[f.source];
    const out = new Uint8ClampedArray(before);
    const op = f.opacity / 100;
    for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
        const i = y * a.w + x;
        const k = (sel[i] / 255) * op;
        if (!k) continue;
        const c = pat ? pat.at(x, y) : color;
        for (let ch = 0; ch < 3; ch++) out[i * 4 + ch] = out[i * 4 + ch] * (1 - k) + c[ch] * k;
        out[i * 4 + 3] = Math.max(out[i * 4 + 3], 255 * k);
      }
    app.edoc.commit(t('cmd.edit.fill'), [patchOp(target.asset, { x: 0, y: 0, w: a.w, h: a.h }, out)], { icon: 'bucket' });
  };
  ui.strokeDialog = () => {
    S.dlg.stroke = { width: 4, position: 'center' };
    ui.openDialog('dlg-stroke');
  };
  globals.strokeOk = () => {
    ui.closeDialog('dlg-stroke');
    const s = S.dlg.stroke;
    const edoc = app.edoc;
    const sel = edoc.selection;
    const inner = sel.shrink(s.position === 'inside' ? s.width : s.position === 'center' ? s.width / 2 : 0) ?? sel.mask;
    const outer = s.position === 'inside' ? sel.mask : sel.grow(s.position === 'outside' ? s.width : s.width / 2);
    const ring = new Uint8Array(outer.length);
    for (let i = 0; i < ring.length; i++) ring[i] = Math.max(0, outer[i] - (s.position === 'outside' ? sel.mask[i] : inner[i]));
    const target = app.paintTarget('bucket', { createDocSize: true });
    if (!target) return;
    const a = edoc.assets.get(target.asset);
    const before = edoc.assets.read(target.asset);
    const local = app.docMaskInLayer(target, ring, { x: 0, y: 0, w: a.w, h: a.h });
    const c = fromHex(S.colors.fg);
    const out = new Uint8ClampedArray(before);
    for (let i = 0; i < local.length; i++) {
      const k = local[i] / 255;
      if (!k) continue;
      for (let ch = 0; ch < 3; ch++) out[i * 4 + ch] = out[i * 4 + ch] * (1 - k) + c[ch] * k;
      out[i * 4 + 3] = Math.max(out[i * 4 + 3], 255 * k);
    }
    edoc.commit(t('cmd.edit.stroke'), [patchOp(target.asset, { x: 0, y: 0, w: a.w, h: a.h }, out)], { icon: 'brush' });
  };

  // ---------- selection changes ----------
  ui.modifySelection = (kind) => {
    S.dlg.modify = { kind, radius: kind === 'feather' ? 8 : 4 };
    ui.openDialog('dlg-modify');
  };
  globals.modifyOk = () => {
    ui.closeDialog('dlg-modify');
    const { kind, radius } = S.dlg.modify;
    const sel = app.edoc.selection;
    const m = kind === 'feather' ? sel.feather(radius) : kind === 'expand' ? sel.grow(radius) : sel.shrink(radius);
    app.edoc.commit(t(`cmd.select.${kind}`), [{ t: 'sel', data: m }], { icon: 'marquee' });
  };
  ui.selectSubject = async () => {
    try {
      app.status(t('status.findingSubject'));
      const mask = await ctx.subjectMask();
      app.edoc.commit(t('cmd.select.subject'), [{ t: 'sel', data: mask }], { icon: 'subject' });
    } catch (err) {
      ctx.toast(ctx.modelError(err), 'warning');
    } finally {
      app.status('');
    }
  };
  // color range
  ui.colorRangeDialog = () => {
    S.dlg.colorRange = { color: S.colors.fg, fuzz: 40 };
    ui.openDialog('dlg-colorrange');
    globals.colorRangePreview();
  };
  globals.colorRangeUseFg = () => {
    S.dlg.colorRange.color = S.colors.fg;
    globals.colorRangePreview();
  };
  const colorRangeMask = async () => {
    const px = await app.samplePixels(true);
    const [r, g, b] = fromHex(S.dlg.colorRange.color);
    const f = S.dlg.colorRange.fuzz;
    const m = new Uint8Array(px.width * px.height);
    for (let i = 0; i < m.length; i++) {
      const d = Math.hypot(px.data[i * 4] - r, px.data[i * 4 + 1] - g, px.data[i * 4 + 2] - b);
      m[i] = Math.max(0, Math.min(255, Math.round(255 * (1 - (d - f * 0.5) / Math.max(1, f)))));
    }
    return { m, w: px.width, h: px.height };
  };
  globals.colorRangePreview = async () => {
    const c = $('colorrange-preview');
    if (!c || !app.edoc) return;
    const { m, w, h } = await colorRangeMask();
    const k = Math.min(c.width / w, c.height / h);
    const tmp = makeCanvas(w, h);
    const g = tmp.getContext('2d');
    const img = g.createImageData(w, h);
    for (let i = 0; i < m.length; i++) img.data.set([m[i], m[i], m[i], 255], i * 4);
    g.putImageData(img, 0, 0);
    const cg = c.getContext('2d');
    cg.clearRect(0, 0, c.width, c.height);
    cg.drawImage(tmp, 0, 0, w * k, h * k);
  };
  globals.colorRangeOk = async () => {
    const { m } = await colorRangeMask();
    ui.closeDialog('dlg-colorrange');
    app.edoc.commit(t('cmd.select.colorRange'), [{ t: 'sel', data: m }], { icon: 'wand' });
  };
  // refine edge
  ui.refineDialog = () => {
    S.dlg.refine = { subject: false, smooth: 2, feather: 1, contrast: 0, shift: 0, output: 'selection', original: app.edoc.selection.mask };
    ui.openDialog('dlg-refine');
  };
  const refined = async () => {
    const R = S.dlg.refine;
    const sel = app.edoc.selection;
    const w = sel.w;
    const h = sel.h;
    let m = new Uint8Array(R.original);
    if (R.subject) {
      // pull the edge onto the subject the model sees, inside a band around the current edge
      const subject = await ctx.subjectMask();
      const band = expandMask(m, w, h, 24);
      const core = contractMask(m, w, h, 24);
      for (let i = 0; i < m.length; i++) if (band[i] > 128 && core[i] < 128) m[i] = subject[i];
    }
    if (R.smooth) m = featherMask(m, w, h, R.smooth);
    if (R.smooth) for (let i = 0; i < m.length; i++) m[i] = m[i] >= 128 ? 255 : 0;
    if (R.shift > 0) m = expandMask(m, w, h, R.shift);
    if (R.shift < 0) m = contractMask(m, w, h, -R.shift);
    if (R.feather) m = featherMask(m, w, h, R.feather);
    if (R.contrast) {
      const k = 1 + R.contrast / 20;
      for (let i = 0; i < m.length; i++) m[i] = Math.max(0, Math.min(255, Math.round((m[i] - 128) * k + 128)));
    }
    return m;
  };
  globals.refinePreview = async () => {
    const m = await refined();
    app.edoc.selection.set(m);
    app.vp.needsOverlay = true;
  };
  globals.refineOk = async () => {
    const R = S.dlg.refine;
    const m = await refined();
    app.edoc.selection.set(R.original);
    R.done = true;
    ui.closeDialog('dlg-refine');
    if (R.output === 'mask' && app.edoc.activeLayer) {
      app.edoc.commit(t('cmd.select.refine'), [{ t: 'sel', data: m }]);
      app.run('layer.addMask', 'selection');
    } else app.edoc.commit(t('cmd.select.refine'), [{ t: 'sel', data: m }], { icon: 'marquee' });
  };
  $('dlg-refine')?.addEventListener('close', () => {
    // closed without OK: the preview changed the selection, so put it back
    const R = S.dlg.refine;
    if (R && !R.done && app.edoc) app.edoc.selection.set(R.original);
    app.vp.needsOverlay = true;
  });

  // ---------- content aware fill ----------
  ui.contentAwareDialog = () => {
    S.dlg.content = { patch: 7, busy: false };
    ui.openDialog('dlg-content');
  };
  globals.contentAwareOk = async () => {
    const edoc = app.edoc;
    const l = edoc.activeLayer;
    if (!l || l.type !== 'raster') return;
    S.dlg.content.busy = true;
    await new Promise((r) => setTimeout(r, 30));
    try {
      const target = { layer: l, size: { w: l.w, h: l.h }, mask: false };
      const region = { x: 0, y: 0, w: l.w, h: l.h };
      const mask = app.selectionInLayer(target, region);
      const before = edoc.assets.read(l.asset);
      const out = contentAwareFill(before, l.w, l.h, mask, { patch: S.dlg.content.patch ?? 7 });
      edoc.commit(t('cmd.edit.contentAware'), [patchOp(l.asset, region, out), { t: 'sel', data: null }], { icon: 'heal' });
    } finally {
      S.dlg.content.busy = false;
      ui.closeDialog('dlg-content');
    }
  };

  // ---------- liquify ----------
  ui.liquifyDialog = () => {
    const l = app.edoc.activeLayer;
    const a = app.edoc.assets.get(l.asset);
    const k = Math.min(1, 1600 / Math.max(a.w, a.h));
    const w = Math.round(a.w * k);
    const h = Math.round(a.h * k);
    const src = makeCanvas(w, h);
    const g = src.getContext('2d', { willReadFrequently: true });
    g.drawImage(a.canvas, 0, 0, w, h);
    ctx.liquify = { l, k, img: { width: w, height: h, data: g.getImageData(0, 0, w, h).data }, field: createField(w, h, 4), last: null };
    S.dlg.liquify = { tool: 'push', size: 120, pressure: 0.5 };
    ui.openDialog('dlg-liquify');
    setTimeout(drawLiquify, 30);
  };
  function drawLiquify() {
    const L = ctx.liquify;
    const c = $('liquify-canvas');
    if (!L || !c) return;
    c.width = L.img.width;
    c.height = L.img.height;
    const out = applyField(L.img, L.field);
    c.getContext('2d').putImageData(new ImageData(out.data, out.width, out.height), 0, 0);
  }
  const lqPos = (e) => {
    const c = e.target;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  };
  let lqFrame = 0;
  globals.lqDown = (e) => {
    const L = ctx.liquify;
    if (!L) return;
    e.target.setPointerCapture(e.pointerId);
    L.last = lqPos(e);
  };
  globals.lqMove = (e) => {
    const L = ctx.liquify;
    if (!L?.last) return;
    const p = lqPos(e);
    const o = S.dlg.liquify;
    dab(L.field, o.tool, p.x, p.y, { radius: o.size / 2, pressure: o.pressure, mx: p.x - L.last.x, my: p.y - L.last.y });
    L.last = p;
    if (!lqFrame) lqFrame = requestAnimationFrame(() => {
        lqFrame = 0;
        drawLiquify();
      });
  };
  globals.lqUp = () => {
    if (ctx.liquify) ctx.liquify.last = null;
  };
  globals.liquifyResetAll = () => {
    const L = ctx.liquify;
    L.field = createField(L.img.width, L.img.height, 4);
    drawLiquify();
  };
  globals.liquifyOk = () => {
    const L = ctx.liquify;
    ui.closeDialog('dlg-liquify');
    if (!L || isIdentity(L.field)) return;
    const l = L.l;
    const full = { width: l.w, height: l.h, data: app.edoc.assets.read(l.asset) };
    // scale the field up to full size
    const big = createField(l.w, l.h, L.field.scale / L.k);
    big.dx = L.field.dx.map((v) => v / L.k);
    big.dy = L.field.dy.map((v) => v / L.k);
    big.fw = L.field.fw;
    big.fh = L.field.fh;
    const out = applyField(full, big);
    app.edoc.commit(t('cmd.filter.liquify'), [patchOp(l.asset, { x: 0, y: 0, w: l.w, h: l.h }, out.data)], { icon: 'smudge' });
    ctx.liquify = null;
  };

  // ---------- guides ----------
  ui.newGuideDialog = () => {
    S.dlg.guide = { axis: 'x', pos: Math.round(app.edoc.doc.width / 2) };
    ui.openDialog('dlg-guide');
  };
  globals.guideOk = () => {
    ui.closeDialog('dlg-guide');
    const g = S.dlg.guide;
    app.edoc.commit(t('history.guide'), [{ t: 'doc', props: { guides: [...app.edoc.doc.guides, { axis: g.axis, pos: g.pos }] } }]);
  };

  // ---------- settings ----------
  ui.settingsDialog = async () => {
    ui.openDialog('dlg-settings');
    globals.checkStun();
    try {
      const list = await navigator.mediaDevices?.enumerateDevices?.();
      const map = (kind) => (list ?? []).filter((d) => d.kind === kind).map((d, i) => ({ id: d.deviceId, label: d.label || `${kind} ${i + 1}` }));
      S.devices = { inputs: map('audioinput'), outputs: map('audiooutput'), cameras: map('videoinput') };
    } catch {
      // no device list
    }
  };
  globals.checkStun = async () => {
    S.stun = { ...S.stun, checked: false };
    const r = await stunCheck();
    S.stun = { checked: true, ok: r.ok, answered: r.answered };
  };
  globals.saveSettings = () => {
    ctx.saveLocal();
    // a new microphone or noise mode applies to a running call right away
    if (app.live?.call.inCall) app.live.call.setInput(undefined, app.live.mediaLinks());
    if (S.micTest) globals.micTest();
    ui.closeDialog('dlg-settings');
  };
  let meterTimer = null;
  globals.micTest = async () => {
    const call = app.live.call;
    if (S.micTest) {
      call.stopMicTest();
      S.micTest = false;
      clearInterval(meterTimer);
      return;
    }
    try {
      await call.startMicTest();
      S.micTest = true;
      meterTimer = setInterval(() => (S.micLevel = Math.min(1, call.level('test') * 6)), 100);
    } catch {
      ctx.toast(t('call.error.mic-denied'), 'warning');
    }
  };
  globals.setGate = () => app.live.call.setSensitivity(S.settings.call.gateSensitivity);

  // ---------- shortcuts and about ----------
  ui.shortcutsDialog = () => {
    const sections = MENUS.map(([label, items]) => ({
      title: label,
      rows: items
        .flat(2)
        .filter((x) => typeof x === 'string' && x !== '-' && !x.startsWith('menu.'))
        .map((id) => ({ id, c: app.commands.list.get(id.split(':')[0]) }))
        .filter((r) => r.c?.key)
        .map((r) => ({ id: r.id, label: t(`cmd.${r.id}`), key: keyLabel(r.c.key.split(' | ')[0]) })),
    })).filter((s) => s.rows.length);
    sections.push({ title: 'menu.tools', rows: [...app.tools.values()].filter((x) => x.key).map((x) => ({ id: x.id, label: t(`tool.${x.id}`), key: x.key.toUpperCase() })) });
    S.shortcutList = sections;
    ui.openDialog('dlg-shortcuts');
  };
  ui.aboutDialog = () => {
    S.modelMb = (MODEL.bytes / 1e6).toFixed(1);
    S.runtimeMb = (RUNTIME.bytes / 1e6).toFixed(1);
    S.runtimeVersion = RUNTIME.version;
    S.modelUpstream = MODEL.upstream;
    ui.openDialog('dlg-about');
  };
}

export function formatBytes(n) {
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export { connectedRegion };
