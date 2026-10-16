// Starts the editor: the loading screen with progress, the reactive store, the app, every
// part of the interface, fonts, the offline service worker, autosave and recovery, links with
// six words from a QR code, and the first run tour.

const fill = document.getElementById('loader-fill');
const stepEl = document.getElementById('loader-step');
const step = (text, p) => {
  if (stepEl) stepEl.textContent = text;
  if (fill) fill.style.width = `${Math.round(p * 100)}%`;
};

const help = (text) => {
  const el = document.getElementById('loader-help');
  if (!el) return;
  el.hidden = !text;
  el.textContent = text;
};

/** Waits for a script or stylesheet element to finish, with a time limit. Resolves true when it loaded. */
function loaded(el, ready, ms) {
  if (!el || ready()) return Promise.resolve(ready());
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(ready()), ms);
    el.addEventListener('load', () => {
      clearTimeout(t);
      resolve(true);
    }, { once: true });
    el.addEventListener('error', () => {
      clearTimeout(t);
      resolve(false);
    }, { once: true });
  });
}

// a slow connection gets a word of explanation instead of a silent wait
const slow = setTimeout(() => help('This is taking longer than usual. The first visit downloads the interface from a public CDN; after that the editor opens offline.'), 12000);

async function boot() {
  step('Opening the darkroom', 0.08);
  step('Downloading the interface', 0.12);
  const hasV = await loaded(document.getElementById('voodoo-js'), () => !!window.V, 60000);
  const V = window.V;
  if (!hasV || !V) throw new Error('The interface library did not load. Check the connection and try again; after the first visit the editor works offline.');
  step('Opening the darkroom', 0.2);
  // the component styles: the editor still works without them, so do not wait forever
  const css = document.getElementById('monsoon-css');
  const cssLoading = loaded(css, () => !!css?.sheet && css.media === 'all', 20000);
  const [{ App }, { Viewport }, { Commands }, { installShell }, { installDialogs, PRESETS }, { installQuick }, { installLive }, { installExtra }, { MESSAGES }, { DIALOGS_HTML }, { Autosaver, recoverable }, { packDocument }, { loadFonts }, { makeCanvas, canvasToBlob }, { APP_VERSION }] = await Promise.all([
    import('./app.js'),
    import('./view/viewport.js'),
    import('./commands.js'),
    import('./ui.js'),
    import('./ui-dialogs.js'),
    import('./ui-quick.js'),
    import('./ui-live.js'),
    import('./ui-extra.js'),
    import('./i18n.js'),
    import('./dialogs-html.js'),
    import('./projects.js'),
    import('./files.js'),
    import('./engine/text.js'),
    import('./engine/assets.js'),
    import('./version.js'),
  ]);
  const { installContext } = await import('./ui-context.js'); // preloaded with the rest
  step('Setting up the workspace', 0.45);
  document.getElementById('dialogs').innerHTML = DIALOGS_HTML;

  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem('pixelotter:settings') || '{}') || {};
    } catch {
      return {};
    }
  })();
  const phone = window.matchMedia('(max-width: 760px)').matches;
  const workspace = (() => {
    try {
      return localStorage.getItem('pixelotter:workspace') || (phone ? 'quick' : 'pro');
    } catch {
      return phone ? 'quick' : 'pro';
    }
  })();
  const defaultDock = () => [
    { id: 'a', tabs: ['color', 'swatches'], active: 'color', open: true, collapsed: false },
    { id: 'b', tabs: ['properties', 'adjustments', 'info'], active: 'properties', open: true, collapsed: false },
    { id: 'c', tabs: ['layers', 'channels', 'paths'], active: 'layers', open: true, collapsed: false, grow: true },
    { id: 'd', tabs: ['history', 'actions'], active: 'history', open: true, collapsed: false },
    { id: 'e', tabs: ['live'], active: 'live', open: false, collapsed: false },
  ];
  const lang = saved.lang || (navigator.language?.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en');
  const S = V.reactive({
    version: APP_VERSION,
    ready: false,
    screen: 'home',
    workspace,
    lang,
    tabs: [],
    doc: { name: '', width: 0, height: 0, mode: 'rgb', dpi: 72, zoom: 100, frames: 0, paths: [] },
    layers: [],
    active: null,
    history: [],
    historyIndex: 0,
    canUndo: false,
    canRedo: false,
    tool: 'move',
    options: {},
    toolGroups: [],
    colors: { fg: '#000000', bg: '#ffffff' },
    colorInfo: { r: 0, g: 0, b: 0, h: 0, s: 0, v: 0, hex: '#000000', cmyk: [0, 0, 0, 100], outOfGamut: false },
    swatches: saved.swatches ?? ['#000000', '#ffffff', '#1c1714', '#3a2a2e', '#6e4b33', '#c08a4e', '#e9e3d8', '#5d7386', '#7d8f6b', '#a2543a', '#6e4b63', '#c49a4a'],
    selection: { active: false },
    status: { x: null, y: null, rgb: '', cmyk: '', message: '' },
    saved: '',
    view: { rulers: true, grid: false, guides: true, snap: true, proof: false, gamut: false },
    dock: defaultDock(),
    panelsOpen: { timeline: false },
    menuBar: [],
    menuOpen: null,
    menuItems: [],
    menuX: 0,
    subOpen: null,
    subItems: [],
    subX: 0,
    subY: 0,
    flyout: null,
    flyoutX: 0,
    flyoutY: 0,
    maskEdit: false,
    toasts: [],
    dragging: false,
    recent: [],
    recover: [],
    templates: PRESETS.filter((p) => ['post', 'story', 'portrait', 'thumbnail', 'sticker', 'hd', 'a4'].includes(p.id)),
    presets: [],
    quickTab: 'looks',
    looks: [],
    refine: 'keep',
    patterns: ['grain', 'paper', 'linen', 'dots', 'stripes', 'checks', 'grid', 'halftone', 'herringbone'],
    fonts: [],
    textPresets: [],
    blendModes: [],
    adjustmentList: [],
    exportFormats: [],
    frames: [],
    frameIndex: 0,
    playing: false,
    actions: [],
    recording: false,
    live: { mode: 'off', step: 'idle', peers: [], words: [], qr: '', unread: 0 },
    liveTab: 'people',
    chat: [],
    replyTo: null,
    reactFor: null,
    call: { inCall: false, muted: false, camera: false, screen: false, processing: null, speaking: [], tiles: [] },
    callInfo: {},
    micTest: false,
    micLevel: 0,
    devices: { inputs: [], outputs: [], cameras: [] },
    stun: { checked: false, ok: false, answered: [] },
    model: { state: 'idle', progress: 0, error: '', mb: 16 },
    canShareFiles: false,
    shortcutList: [],
    tour: { on: false, i: 0, n: 1, key: 'welcome', spot: {}, card: {} },
    cropAngle: 0,
    settings: {
      name: saved.name || '',
      autosave: saved.autosave !== false,
      preloadModel: saved.preloadModel === true,
      defaultRole: saved.defaultRole === 'view' ? 'view' : 'edit',
      turn: { urls: saved.turn?.urls ?? '', username: saved.turn?.username ?? '', credential: saved.turn?.credential ?? '' },
      call: { noiseMode: saved.call?.noiseMode ?? 'strong', gateSensitivity: saved.call?.gateSensitivity ?? 50, inputId: saved.call?.inputId ?? '', outputId: saved.call?.outputId ?? '', cameraId: saved.call?.cameraId ?? '' },
    },
    dlg: {
      new: { preset: 'post', name: '', w: 1080, h: 1080, dpi: 72, bg: 'white', mode: 'rgb' },
      export: { format: 'png', quality: 0.9, scale: 1, cmyk: false, animated: false, pages: false, hasQuality: false, canCmyk: false, canAnimate: false, canPages: false, sizeText: '', previewUrl: '', note: '', error: '', busy: false },
      size: { w: 1, h: 1, dpi: 72, keep: true, ratio: 1 },
      canvas: { w: 1, h: 1, anchor: 4 },
      filter: { id: '', title: '', params: [], values: {}, preview: true, channel: 'rgb', adjustLayer: false },
      style: { tab: 'shadow', values: { shadow: {}, outerGlow: {}, stroke: {}, innerGlow: {}, bevel: {}, overlay: {} } },
      fill: { source: 'fg', pattern: 'grain', opacity: 100 },
      stroke: { width: 4, position: 'center' },
      modify: { kind: 'feather', radius: 4 },
      colorRange: { color: '#000000', fuzz: 40 },
      refine: { subject: false, smooth: 2, feather: 1, contrast: 0, shift: 0, output: 'selection' },
      content: { patch: 7, busy: false },
      liquify: { tool: 'push', size: 120, pressure: 0.5 },
      sticker: { outline: 12, outlineColor: '#ffffff', caption: '', font: 'Baloo 2', status: '', error: '', working: false },
      join: { error: '' },
      confirm: { title: '', text: '', input: null, yes: null, no: null, third: null },
      guide: { axis: 'x', pos: 0 },
    },
  });

  V.i18n({ locale: lang, fallback: 'en', messages: MESSAGES, persist: false, detect: false });
  const tt = (key, params) => V.i18n.t(key, params);

  const globals = { S };
  const ui = {};
  const ctx = { S, V, t: tt, globals, ui, defaultDock };
  ctx.saveLocal = () => {
    try {
      localStorage.setItem('pixelotter:settings', JSON.stringify({ ...JSON.parse(JSON.stringify(S.settings)), swatches: S.swatches, lang: S.lang }));
    } catch {
      // private mode
    }
  };

  const vp = new Viewport(document.getElementById('viewport'), {
    onTool: (kind, p) => app.pointer(kind, p),
    onCursor: (p) => ctx.onCursor?.(p),
    onViewChange: () => {
      app.syncDocInfo();
      app.textEditor?.close?.();
    },
    onGuideDrag: (g) => app.edoc?.commit(tt('history.guide'), [{ t: 'doc', props: { guides: [...app.edoc.doc.guides, g] } }]),
  });
  const app = new App(S, { t: tt, toast: (...a) => ctx.toast(...a), vp });
  ctx.app = app;
  app.commands = new Commands(app, ui);
  installShell(ctx);
  installDialogs(ctx);
  installQuick(ctx);
  installLive(ctx);
  installExtra(ctx);
  installContext(ctx);
  S.adjustmentList = ['brightness-contrast', 'levels', 'curves', 'exposure', 'vibrance', 'hue-saturation', 'color-balance', 'black-white', 'photo-filter', 'channel-mixer', 'invert', 'posterize', 'threshold', 'gradient-map', 'selective-color', 'look', 'tone'];

  // keep the parts of the UI that depend on the active layer up to date
  const syncLayers = app.syncLayers.bind(app);
  app.syncLayers = () => {
    syncLayers();
    S.maskEdit = app.maskEdit;
    ctx.onActiveChanged?.();
    if (S.panelsOpen.timeline) ctx.syncFrames?.();
    if (S.dock.some((g) => g.open && !g.collapsed && g.active === 'channels')) ctx.syncChannels?.();
  };
  // the channel thumbnails follow pixel edits while the panel shows
  const scheduleThumbs = app.scheduleThumbs.bind(app);
  app.scheduleThumbs = (delay) => {
    scheduleThumbs(delay);
    if (S.dock.some((g) => g.open && !g.collapsed && g.active === 'channels')) ctx.syncChannels?.();
  };
  const syncColor = app.syncColorInfo.bind(app);
  app.syncColorInfo = () => {
    syncColor();
  };
  ui.setLanguage = (l) => {
    S.lang = l;
    V.i18n.setLocale(l);
    document.documentElement.lang = l;
    ctx.saveLocal();
    S.menuBar = [...S.menuBar];
  };
  globals.setLanguage = ui.setLanguage;
  globals.quickIcon = (q) => ({ looks: 'filters', adjust: 'adjust', cutout: 'cutout', sticker: 'sticker', text: 'text', shapes: 'shape', size: 'frame' })[q];

  // autosave into this browser
  const autosaver = new Autosaver({ onSaved: () => (S.saved = tt('status.autosaved')) });
  ctx.autosaver = autosaver;
  app.autosave = (edoc) => {
    if (!S.settings.autosave || edoc.session?.guest) return;
    autosaver.schedule(edoc, async (d) => {
      const bytes = await packDocument(d, false);
      const k = Math.min(1, 320 / Math.max(d.doc.width, d.doc.height));
      const c = d.renderer.render({ scale: k });
      const thumb = await canvasToBlob(c, 'image/jpeg', 0.75);
      return { bytes, thumb };
    });
  };

  Object.assign(V.config.globals, globals);
  step('Styling the workspace', 0.55);
  await cssLoading;
  if (css) css.media = 'all';
  V.start();
  app.setTool('move');
  app.syncColorInfo();
  ctx.syncInfo?.();
  document.body.dataset.workspace = S.workspace;
  window.pixelotter = { app, S, ctx, live: app.live, V };

  step('Loading fonts', 0.62);
  await Promise.race([loadFonts(), new Promise((r) => setTimeout(r, 1500))]);
  step('Almost there', 0.82);
  // the cutout model loads only when it is used (or in the background when the setting asks)
  ctx.segmenter.isCached().then((cached) => cached && S.settings.preloadModel && ctx.segmenter.ensure().catch(() => {}), () => {});
  step('Ready', 1);

  // saved work in this browser: never let a stuck database hold the editor back
  const within = (p, ms, fallback) => Promise.race([p.catch(() => fallback), new Promise((r) => setTimeout(() => r(fallback), ms))]);
  await within(ctx.refreshRecent(), 5000, null);
  S.recover = ((await within(recoverable(), 5000, [])) ?? []).map((r) => ({ id: r.id, name: r.name }));
  clearTimeout(slow);
  help('');
  S.ready = true;
  document.getElementById('loader')?.classList.add('done');
  setTimeout(() => document.getElementById('loader')?.remove(), 600);
  if (!ctx.handleHash()) ctx.maybeTour();
  ctx.lookThumbs();
  void makeCanvas;

  window.addEventListener('beforeunload', (e) => {
    if (app.docs.some((d) => d.dirty && !d.session?.guest)) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // the offline copy is made after the editor is up, when the browser is idle
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const register = () => navigator.serviceWorker.register('sw.js').catch(() => {});
    setTimeout(() => (window.requestIdleCallback ? requestIdleCallback(register, { timeout: 10000 }) : register()), 4000);
  }
}

boot().catch((err) => {
  clearTimeout(slow);
  console.error(err);
  step('Could not start', 1);
  help(err.message);
  document.getElementById('loader')?.classList.add('failed');
  const retry = document.getElementById('loader-retry');
  if (retry) retry.hidden = false;
});
