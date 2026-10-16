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
  // Each step points at a part of the screen. Steps whose part is not showing (the toolbox on
  // the home screen, the panels on a phone) are left out, the card is placed beside its target
  // and kept inside the window, and the tour follows resizes. Escape skips it, the arrow keys
  // step through it, and focus stays in the card until it closes.
  const STEPS = [
    { key: 'welcome', sel: null },
    { key: 'tools', sel: '.toolbox' },
    { key: 'options', sel: '.optbar' },
    { key: 'layers', sel: '[data-panel-group="c"]' },
    { key: 'quick', sel: '.ws-switch' },
    { key: 'share', sel: '[data-action="share"]' },
    { key: 'export', sel: '[data-action="export"]' },
  ];
  const MARGIN = 12;
  const GAP = 14;
  /** The target's box when it is on screen, or null. */
  const shown = (sel) => {
    const el = sel ? document.querySelector(sel) : null;
    if (!el || el.closest('[hidden]') || getComputedStyle(el).visibility === 'hidden') return null;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return null;
    // a phone's panel sheet keeps its size while it waits below the screen
    if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return null;
    return r;
  };
  const tourEl = () => document.querySelector('.tour');
  let steps = [];
  let returnFocus = null;
  let frame = 0;

  /** Where the card goes: beside the target where it fits, else below or above, else centered. */
  const cardSpot = (r, w, h) => {
    const vw = innerWidth;
    const vh = innerHeight;
    const clampX = (x) => Math.max(MARGIN, Math.min(vw - w - MARGIN, x));
    const clampY = (y) => Math.max(MARGIN, Math.min(vh - h - MARGIN, y));
    if (!r) return { left: (vw - w) / 2, top: Math.max(MARGIN, (vh - h) / 2) };
    const options = [
      [r.right + GAP + w + MARGIN <= vw, () => ({ left: r.right + GAP, top: clampY(r.top) })],
      [r.left - GAP - w - MARGIN >= 0, () => ({ left: r.left - GAP - w, top: clampY(r.top) })],
      [r.bottom + GAP + h + MARGIN <= vh, () => ({ left: clampX(r.left), top: r.bottom + GAP })],
      [r.top - GAP - h - MARGIN >= 0, () => ({ left: clampX(r.left), top: r.top - GAP - h })],
    ];
    // a target as wide as the window reads better with the card under it
    if (r.width > vw * 0.6) options.unshift(options.splice(2, 1)[0]);
    const fit = options.find(([ok]) => ok);
    return fit ? fit[1]() : { left: clampX((vw - w) / 2), top: clampY(vh - h - MARGIN) };
  };

  const placeTour = () => {
    if (!S.tour.on) return;
    const s = steps[S.tour.i];
    S.tour.key = s.key;
    const r = shown(s.sel);
    const w = Math.min(340, innerWidth - MARGIN * 2);
    S.tour.spot = r
      ? { display: 'block', left: `${Math.max(2, r.left - 6)}px`, top: `${Math.max(2, r.top - 6)}px`, width: `${Math.min(innerWidth - 4, r.right + 6) - Math.max(2, r.left - 6)}px`, height: `${Math.min(innerHeight - 4, r.bottom + 6) - Math.max(2, r.top - 6)}px` }
      : { display: 'none' };
    // measure the card with this step's text before placing it
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const card = document.querySelector('.tour-card');
      const h = card?.offsetHeight || 220;
      const at = cardSpot(r, w, h);
      S.tour.card = { left: `${Math.round(at.left)}px`, top: `${Math.round(at.top)}px`, width: `${w}px`, transform: 'none' };
    });
  };

  const onKey = (e) => {
    if (!S.tour.on) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      globals.tourEnd();
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === 'ArrowRight') globals.tourNext();
      else globals.tourBack();
    } else if (e.key === 'Tab') {
      // keep focus on the card's buttons
      const buttons = [...(tourEl()?.querySelectorAll('button') ?? [])].filter((b) => b.offsetParent);
      if (!buttons.length) return;
      const i = buttons.indexOf(document.activeElement);
      const next = e.shiftKey ? (i <= 0 ? buttons.length - 1 : i - 1) : i < 0 || i === buttons.length - 1 ? 0 : i + 1;
      e.preventDefault();
      e.stopImmediatePropagation();
      buttons[next].focus();
    } else {
      // the editor's shortcuts wait until the tour is over (Enter and Space still press the
      // focused button: that is the browser's default, not a listener)
      e.stopImmediatePropagation();
    }
  };
  const focusNext = () => requestAnimationFrame(() => tourEl()?.querySelector('[data-action="tour-next"]')?.focus());

  ui.tour = () => {
    // only the steps whose part of the screen shows right now
    steps = STEPS.filter((s) => !s.sel || shown(s.sel));
    if (!S.tour.on) returnFocus = document.activeElement;
    S.tour = { on: true, i: 0, n: steps.length, key: steps[0].key, spot: { display: 'none' }, card: { left: '50%', top: '50%', width: `${Math.min(340, innerWidth - MARGIN * 2)}px`, transform: 'translate(-50%, -50%)' } };
    placeTour();
    window.addEventListener('resize', placeTour);
    window.addEventListener('keydown', onKey, true);
    focusNext();
  };
  globals.tourNext = () => {
    if (S.tour.i + 1 >= S.tour.n) return globals.tourEnd();
    S.tour.i++;
    placeTour();
    focusNext();
  };
  globals.tourBack = () => {
    if (S.tour.i <= 0) return;
    S.tour.i--;
    placeTour();
    focusNext();
  };
  globals.tourEnd = () => {
    if (!S.tour.on) return;
    S.tour.on = false;
    cancelAnimationFrame(frame);
    window.removeEventListener('resize', placeTour);
    window.removeEventListener('keydown', onKey, true);
    try {
      localStorage.setItem('pixelotter:toured', '1');
    } catch {
      // private mode
    }
    const back = returnFocus;
    returnFocus = null;
    if (back?.isConnected && back !== document.body) back.focus?.();
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
