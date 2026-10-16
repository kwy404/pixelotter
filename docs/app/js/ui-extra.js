// The rest of the workspace: the animation timeline (frames show chosen layers, with a delay
// each), actions (record a series of commands and play it back on any document), the
// first run tour, path actions, the crop controls and the status bar readouts.

import { newId } from '../lib/doc.js';
import { flatten as flatPath, polygonMask } from '../lib/paths.js';
import { patchOp } from '../lib/pixels.js';
import { rgbToCmyk } from '../lib/color/cmyk.js';
import { fromHex } from '../lib/color/convert.js';
import { makeCanvas } from './engine/assets.js';
import { press } from './engine/render.js';

export function installExtra(ctx) {
  const { app, S, t, globals, ui } = ctx;

  // ---------- channels ----------
  // RGB documents show red, green and blue (each can be hidden or viewed alone on the canvas,
  // through an SVG color matrix on the display); CMYK documents show the four simulated plates
  // from the approximate press model; any channel loads as a selection.
  const PLANES = { rgb: ['r', 'g', 'b'], gray: ['gray'], cmyk: ['c', 'm', 'y', 'k'] };
  S.channels = { list: [], solo: null, hidden: [], mode: 'rgb' };
  const ns = 'http://www.w3.org/2000/svg';
  const fx = document.createElementNS(ns, 'svg');
  fx.setAttribute('width', '0');
  fx.setAttribute('height', '0');
  fx.setAttribute('aria-hidden', 'true');
  fx.style.position = 'absolute';
  fx.innerHTML = '<filter id="po-channels" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"/></filter>';
  document.body.append(fx);
  const applyChannelView = () => {
    const display = document.querySelector('.vp-display');
    if (!display) return;
    const { solo, hidden, mode } = S.channels;
    if (mode !== 'rgb' || (!solo && !hidden.length)) {
      display.style.filter = '';
      return;
    }
    const row = (c) => (c === 'r' ? '1 0 0 0 0' : c === 'g' ? '0 1 0 0 0' : '0 0 1 0 0');
    const zero = '0 0 0 0 0';
    const rows = solo ? [row(solo), row(solo), row(solo)] : ['r', 'g', 'b'].map((c) => (hidden.includes(c) ? zero : row(c)));
    fx.querySelector('feColorMatrix').setAttribute('values', `${rows.join(' ')} 0 0 0 1 0`);
    display.style.filter = 'url(#po-channels)';
  };
  /** The values of one channel (0 to 255, 255 = full ink or full light) for an RGBA buffer. */
  const plane = (data, ch, mode) => {
    const n = data.length / 4;
    const out = new Uint8Array(n);
    if (mode === 'cmyk') {
      const onWhite = new Uint8ClampedArray(data);
      for (let i = 0; i < onWhite.length; i += 4) {
        const a = onWhite[i + 3] / 255;
        for (let c = 0; c < 3; c++) onWhite[i + c] = onWhite[i + c] * a + 255 * (1 - a);
      }
      const ink = press().toCmyk(onWhite);
      const k = 'cmyk'.indexOf(ch);
      for (let i = 0; i < n; i++) out[i] = ink[i * 4 + k];
      return out;
    }
    const k = ch === 'r' ? 0 : ch === 'g' ? 1 : ch === 'b' ? 2 : -1;
    for (let i = 0; i < n; i++) out[i] = k >= 0 ? data[i * 4 + k] : Math.round(0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]);
    return out;
  };
  let channelTimer = 0;
  ctx.syncChannels = (now = false) => {
    clearTimeout(channelTimer);
    if (!now) {
      channelTimer = setTimeout(() => ctx.syncChannels(true), 300);
      return;
    }
    const edoc = app.edoc;
    const mode = edoc?.doc.mode ?? 'rgb';
    if (!edoc) {
      S.channels = { ...S.channels, list: [] };
      return;
    }
    const d = edoc.doc;
    const k = Math.min(1, 84 / Math.max(d.width, d.height));
    const c = edoc.renderer.render({ scale: k, proof: false });
    const px = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
    const dom = () => {
      const el = document.createElement('canvas');
      el.width = c.width;
      el.height = c.height;
      return el;
    };
    const thumb = (values, ink) => {
      const t2 = dom();
      const g = t2.getContext('2d');
      const img = g.createImageData(c.width, c.height);
      for (let i = 0; i < values.length; i++) {
        const v = ink ? 255 - values[i] : values[i];
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      return t2.toDataURL();
    };
    const list = PLANES[mode].map((ch) => ({ id: ch, label: t(`channel.${ch}`), thumb: thumb(plane(px.data, ch, mode), mode === 'cmyk') }));
    if (mode === 'rgb') {
      const full = dom();
      full.getContext('2d').putImageData(px, 0, 0);
      list.unshift({ id: 'rgb', label: 'RGB', thumb: full.toDataURL() });
    }
    const keep = mode === S.channels.mode;
    S.channels = { list, mode, solo: keep ? S.channels.solo : null, hidden: keep ? S.channels.hidden : [] };
    applyChannelView();
  };
  globals.syncChannelsNow = () => setTimeout(() => ctx.syncChannels(true), 0);
  globals.soloChannel = (ch) => {
    S.channels = { ...S.channels, solo: ch === 'rgb' || S.channels.solo === ch ? null : ch, hidden: [] };
    applyChannelView();
  };
  globals.toggleChannel = (ch) => {
    if (ch === 'rgb') S.channels = { ...S.channels, hidden: [], solo: null };
    else {
      const h = S.channels.hidden.includes(ch) ? S.channels.hidden.filter((x) => x !== ch) : [...S.channels.hidden, ch];
      S.channels = { ...S.channels, hidden: h.length === 3 ? [] : h, solo: null };
    }
    applyChannelView();
  };
  globals.channelVisible = (ch) => (ch === 'rgb' ? !S.channels.hidden.length && !S.channels.solo : S.channels.solo ? S.channels.solo === ch : !S.channels.hidden.includes(ch));
  globals.channelSelection = (ch) => {
    const edoc = app.edoc;
    if (!edoc) return;
    const mode = edoc.doc.mode;
    const c = edoc.renderer.render({ scale: 1, proof: false });
    const px = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
    const m = plane(px, ch === 'rgb' ? 'gray' : ch, mode === 'cmyk' && ch !== 'rgb' ? 'cmyk' : 'rgb');
    edoc.commit(t('history.channelSelection'), [{ t: 'sel', data: m }], { icon: 'marquee' });
  };

  // ---------- timeline ----------
  const frameThumb = (show) => {
    const d = app.edoc.doc;
    const k = 72 / Math.max(d.width, d.height);
    const all = new Set(d.frames.flatMap((f) => f.show));
    const hidden = new Set(d.layers.filter((l) => all.has(l.id) && !show.includes(l.id)).map((l) => l.id));
    const c = app.renderer.render({ scale: k, hidden });
    const el = document.createElement('canvas');
    el.width = c.width;
    el.height = c.height;
    el.getContext('2d').drawImage(c, 0, 0);
    return el.toDataURL('image/jpeg', 0.7);
  };
  ctx.syncFrames = () => {
    const d = app.edoc?.doc;
    if (!d || !S.panelsOpen.timeline) return;
    S.frames = d.frames.map((f) => ({ id: f.id, delay: f.delay, thumb: frameThumb(f.show) }));
  };
  const setFrames = (frames, label) => app.edoc.commit(label, [{ t: 'doc', props: { frames } }], { icon: 'timeline' });
  globals.addFrame = () => {
    const d = app.edoc.doc;
    // a new frame shows what is visible now
    const show = d.layers.filter((l) => l.visible && l.type !== 'group').map((l) => l.id);
    setFrames([...d.frames, { id: newId('f'), delay: 120, show }], t('timeline.add'));
    ctx.syncFrames();
  };
  globals.framesFromLayers = () => {
    const d = app.edoc.doc;
    const layers = d.layers.filter((l) => l.type === 'raster' || l.type === 'text' || l.type === 'shape');
    setFrames(layers.map((l) => ({ id: newId('f'), delay: 120, show: [l.id] })), t('timeline.fromLayers'));
    ctx.syncFrames();
  };
  globals.deleteFrame = (i) => {
    setFrames(app.edoc.doc.frames.filter((_, k) => k !== i), t('timeline.delete'));
    ctx.syncFrames();
  };
  globals.setFrameDelay = (i, v) => {
    const frames = app.edoc.doc.frames.map((f, k) => (k === i ? { ...f, delay: Math.max(10, +v || 100) } : f));
    setFrames(frames, t('timeline.delay'));
  };
  globals.showFrame = (i) => {
    const d = app.edoc.doc;
    const f = d.frames[i];
    if (!f) return;
    S.frameIndex = i;
    const all = new Set(d.frames.flatMap((x) => x.show));
    app.vp.hidden = new Set(d.layers.filter((l) => all.has(l.id) && !f.show.includes(l.id)).map((l) => l.id));
    app.vp.invalidate();
  };
  let playTimer = null;
  globals.playFrames = () => {
    if (S.playing) {
      clearTimeout(playTimer);
      S.playing = false;
      app.vp.hidden = null;
      app.vp.invalidate();
      return;
    }
    const d = app.edoc.doc;
    if (!d.frames.length) return;
    S.playing = true;
    let i = 0;
    const step = () => {
      if (!S.playing) return;
      globals.showFrame(i);
      const delay = d.frames[i]?.delay ?? 100;
      i = (i + 1) % d.frames.length;
      playTimer = setTimeout(step, delay);
    };
    step();
  };

  // ---------- actions ----------
  const loadActions = () => {
    try {
      return JSON.parse(localStorage.getItem('pixelotter:actions') || '[]');
    } catch {
      return [];
    }
  };
  S.actions = loadActions();
  let recording = null;
  ui.recordAction = async () => {
    const name = await ui.prompt(t('actions.nameTitle'), t('actions.nameText'), t('actions.default'));
    if (!name) return;
    recording = { id: newId('x'), name, steps: [] };
    S.recording = true;
    app.commands.recorder = (id, args) => recording.steps.push({ id, args: JSON.parse(JSON.stringify(args ?? [])) });
    ctx.toast(t('actions.recording'), 'info');
  };
  ui.stopAction = () => {
    app.commands.recorder = null;
    S.recording = false;
    if (recording?.steps.length) {
      S.actions = [...S.actions, recording];
      try {
        localStorage.setItem('pixelotter:actions', JSON.stringify(S.actions));
      } catch {
        // storage full
      }
    }
    recording = null;
  };
  ui.playAction = async (id) => {
    const a = S.actions.find((x) => x.id === id);
    if (!a) return;
    for (const s of a.steps) {
      // dialogs are skipped when played back: commands that need input run with their saved args
      if (/Dialog$|\.(new|open|place|export|settings)$/.test(s.id)) continue;
      await app.run(s.id, ...(s.args ?? []));
    }
    ctx.toast(t('actions.played', { name: a.name }), 'success');
  };

  // ---------- paths ----------
  globals.selectPath = (id) => {
    app.activePath = id;
    app.syncDocInfo();
    app.setTool('pen');
  };
  app.refreshPaths = () => app.syncDocInfo();
  globals.pathAction = (kind) => {
    const edoc = app.edoc;
    const p = edoc.doc.paths.find((x) => x.id === app.activePath) ?? edoc.doc.paths.at(-1);
    if (!p) return ctx.toast(t('paths.empty'), 'warning');
    if (kind === 'delete') {
      edoc.commit(t('path.delete'), [{ t: 'doc', props: { paths: edoc.doc.paths.filter((x) => x.id !== p.id) } }], { icon: 'pen' });
      return;
    }
    const target = app.paintTarget('bucket', { createDocSize: true });
    if (!target) return;
    const d = edoc.doc;
    const c = makeCanvas(d.width, d.height);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.beginPath();
    flatPath(p).forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    if (p.closed || kind === 'fill') g.closePath();
    if (kind === 'fill') {
      g.fillStyle = S.colors.fg;
      g.fill();
    } else {
      g.strokeStyle = S.colors.fg;
      g.lineWidth = app.opts('brush').size ?? 4;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.stroke();
    }
    const paint = g.getImageData(0, 0, d.width, d.height).data;
    const a = edoc.assets.get(target.asset);
    const before = edoc.assets.read(target.asset);
    // map the painted document pixels into the layer
    const plane = new Uint8Array(d.width * d.height);
    for (let i = 0; i < plane.length; i++) plane[i] = paint[i * 4 + 3];
    const local = app.docMaskInLayer(target, plane, { x: 0, y: 0, w: a.w, h: a.h });
    const [r, gg, b] = fromHex(S.colors.fg);
    const out = new Uint8ClampedArray(before);
    for (let i = 0; i < local.length; i++) {
      const k = local[i] / 255;
      if (!k) continue;
      out[i * 4] = out[i * 4] * (1 - k) + r * k;
      out[i * 4 + 1] = out[i * 4 + 1] * (1 - k) + gg * k;
      out[i * 4 + 2] = out[i * 4 + 2] * (1 - k) + b * k;
      out[i * 4 + 3] = Math.max(out[i * 4 + 3], 255 * k);
    }
    edoc.commit(t(`path.${kind}`), [patchOp(target.asset, { x: 0, y: 0, w: a.w, h: a.h }, out)], { icon: 'pen' });
    void polygonMask;
  };

  // ---------- crop controls ----------
  S.cropAngle = 0;
  globals.straighten = (v) => {
    const tool = app.tools.get('crop');
    if (!tool.rect) tool.activate(app);
    S.cropAngle = Math.round(+v * 10) / 10;
    tool.setAngle(app, S.cropAngle);
  };
  globals.cropCommit = () => {
    app.tools.get('crop').commit(app);
    S.cropAngle = 0;
  };
  globals.cropCancel = () => {
    app.tools.get('crop').key(app, { key: 'Escape' });
    S.cropAngle = 0;
  };

  // ---------- status bar ----------
  let statusTimer = null;
  ctx.onCursor = (p) => {
    if (!p || !app.edoc) {
      S.status.x = null;
      return;
    }
    S.status.x = Math.floor(p.x);
    S.status.y = Math.floor(p.y);
    clearTimeout(statusTimer);
    statusTimer = setTimeout(async () => {
      if (!app.edoc || S.status.x === null) return;
      const c = await app.colorAt(p.x, p.y, 1);
      if (!c) return;
      S.status.rgb = `R ${c[0]} G ${c[1]} B ${c[2]}`;
      const k = rgbToCmyk(c[0], c[1], c[2]).map(Math.round);
      S.status.cmyk = `C ${k[0]} M ${k[1]} Y ${k[2]} K ${k[3]}`;
    }, 120);
    app.live?.cursor(p.x, p.y);
  };

  // ---------- first run tour ----------
  const STEPS = [
    { key: 'welcome', sel: null },
    { key: 'tools', sel: '.toolbox', pro: true },
    { key: 'options', sel: '.optbar', pro: true },
    { key: 'layers', sel: '[data-panel-group="c"]', pro: true },
    { key: 'quick', sel: '.ws-switch' },
    { key: 'share', sel: '[data-action="share"]' },
    { key: 'export', sel: '[data-action="export"]' },
  ];
  let steps = [];
  ui.tour = () => {
    steps = STEPS.filter((s) => !s.pro || S.workspace === 'pro');
    S.tour = { on: true, i: 0, n: steps.length, key: steps[0].key, spot: {}, card: {} };
    placeTour();
  };
  const placeTour = () => {
    const s = steps[S.tour.i];
    S.tour.key = s.key;
    const el = s.sel ? document.querySelector(s.sel) : null;
    const r = el?.getBoundingClientRect();
    if (!r || !r.width) {
      S.tour.spot = { display: 'none' };
      S.tour.card = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
      return;
    }
    S.tour.spot = { display: 'block', left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` };
    const cardW = Math.min(340, window.innerWidth - 24);
    let left = r.right + 16;
    let top = r.top;
    if (left + cardW > window.innerWidth) left = Math.max(12, r.left - cardW - 16);
    if (left < 12 || r.width > window.innerWidth * 0.6) {
      left = Math.max(12, Math.min(window.innerWidth - cardW - 12, r.left));
      top = r.bottom + 14;
    }
    if (top + 220 > window.innerHeight) top = Math.max(12, r.top - 230);
    S.tour.card = { left: `${left}px`, top: `${top}px`, width: `${cardW}px` };
  };
  globals.tourNext = () => {
    if (S.tour.i + 1 >= S.tour.n) return globals.tourEnd();
    S.tour.i++;
    placeTour();
  };
  globals.tourEnd = () => {
    S.tour.on = false;
    try {
      localStorage.setItem('pixelotter:toured', '1');
    } catch {
      // private mode
    }
  };
  ctx.maybeTour = () => {
    let seen = false;
    try {
      seen = localStorage.getItem('pixelotter:toured') === '1';
    } catch {
      seen = true;
    }
    if (!seen && !navigator.webdriver) setTimeout(() => ui.tour(), 600);
  };
}
