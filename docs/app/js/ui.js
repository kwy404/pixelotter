// The shell around the canvas: menus with shortcuts, the toolbox with flyouts, docked panels,
// the layers list (drag to reorder), colors, document tabs, the Home screen with recent files,
// toasts, drag and drop to open, and the keyboard. Functions the markup calls are published on
// `globals` (Voodoo's V.config.globals).

import { MENUS, keyLabel } from './commands.js';
import { TOOL_GROUPS } from './app.js';
import { BLEND_MODES } from '../lib/blend.js';
import { fromHex, hsvToRgb, rgbToHsv, toHex } from '../lib/color/convert.js';
import { inGamut } from '../lib/color/cmyk.js';
import { findLayer, indexOf, subtree, isLocked } from '../lib/doc.js';
import { layerBounds } from '../lib/geometry.js';
import { listProjects, getProject, deleteProject } from './projects.js';
import { ACCEPT, openFile, decodeForPlace } from './files.js';
import { makeLayer, newId } from '../lib/doc.js';

const TOOL_ICONS = { 'marquee-ellipse': 'marquee-ellipse', 'spot-heal': 'heal', heal: 'patch', blur: 'proof', sharpen: 'aperture' };

export function installShell(ctx) {
  const { app, S, t, globals, ui } = ctx;
  const toastTimers = new Map();
  let toastId = 0;

  ctx.toast = (msg, kind = 'info', action = null) => {
    const id = ++toastId;
    S.toasts = [...S.toasts, { id, msg, kind, action }].slice(-4);
    toastTimers.set(id, setTimeout(() => (S.toasts = S.toasts.filter((x) => x.id !== id)), action ? 8000 : 4200));
  };

  // ---------- menus ----------
  S.menuBar = MENUS.map(([label]) => ({ label, id: label.slice(5) }));

  const labelFor = (id) => {
    const [cmd, arg] = id.split(':');
    if (cmd === 'layer.newAdjustment' || cmd.startsWith('adjust.')) return t(`filter.${arg ?? cmd.slice(7)}`);
    if (cmd === 'layer.newFill') return t(`fill.${arg}`);
    if (cmd === 'layer.addMask') return t(`cmd.layer.addMask.${arg}`);
    if (cmd.startsWith('filter.') && cmd !== 'filter.last' && cmd !== 'filter.liquify') return t(`filter.${cmd.slice(7)}`);
    return t(`cmd.${cmd}`);
  };
  const checked = (id) => {
    const v = S.view;
    return { 'view.rulers': v.rulers, 'view.grid': v.grid, 'view.guides': v.guides, 'view.snap': v.snap, 'view.proof': v.proof, 'view.gamut': v.gamut, 'window.pro': S.workspace === 'pro', 'window.quick': S.workspace === 'quick', [`image.mode.${S.doc.mode}`]: true, 'help.english': S.lang === 'en', 'help.portuguese': S.lang === 'pt-BR' }[id] ?? (id.startsWith('window.') ? isPanelOpen(id.slice(7)) : false);
  };
  // one command as a context menu item (the same label, shortcut and enabled state as the menus)
  ctx.cmdItem = (id, extra = {}) => {
    const [cmd, arg] = id.split(':');
    const c = app.commands.list.get(cmd);
    return { label: labelFor(id), key: keyLabel(c?.key?.split(' | ')[0] ?? ''), disabled: !app.commands.can(cmd), run: () => (arg === undefined ? app.run(cmd) : app.run(cmd, arg)), ...extra };
  };
  const build = (items) =>
    items.map((it) => {
      if (it === '-') return { type: 'sep' };
      if (Array.isArray(it)) return { type: 'sub', label: t(it[0]), items: it[1] };
      const [cmd] = it.split(':');
      const c = app.commands.list.get(cmd);
      return { type: 'cmd', id: it, label: labelFor(it), key: keyLabel(c?.key?.split(' | ')[0] ?? ''), enabled: app.commands.can(cmd), checked: !!checked(it) };
    });
  const subItems = (src) => {
    if (src === 'recent') return S.recent.length ? S.recent.slice(0, 10).map((r) => ({ type: 'cmd', id: `recent:${r.id}`, label: r.name, key: '', enabled: true })) : [{ type: 'cmd', id: 'none', label: t('home.emptyTitle'), key: '', enabled: false }];
    if (src === 'history') return S.history.slice(-15).map((h) => ({ type: 'cmd', id: `history:${h.i}`, label: h.label, key: '', enabled: true, checked: h.i === S.historyIndex }));
    return build(src);
  };
  globals.toggleMenu = (i) => {
    if (S.menuOpen === i) return globals.closeMenus();
    const btn = document.querySelectorAll('.menu-top')[i];
    S.menuX = btn ? btn.offsetLeft : 0;
    S.menuItems = build(MENUS[i][1]);
    S.subOpen = null;
    S.menuOpen = i;
  };
  globals.hoverMenu = (i) => {
    if (S.menuOpen !== null && S.menuOpen !== i) globals.toggleMenu(i);
  };
  globals.leaveMenu = () => {};
  globals.closeMenus = () => {
    S.menuOpen = null;
    S.subOpen = null;
  };
  globals.openSub = (j, el) => {
    const it = S.menuItems[j];
    if (!it || it.type !== 'sub') return;
    const r = el.getBoundingClientRect();
    const bar = document.querySelector('.appbar').getBoundingClientRect();
    S.subItems = subItems(it.items);
    S.subX = Math.min(r.right - bar.left - 4, window.innerWidth - 270);
    S.subY = r.top - bar.top - 4;
    S.subOpen = j;
  };
  globals.menuRun = (it) => {
    globals.closeMenus();
    const [cmd, arg] = it.id.split(':');
    if (cmd === 'recent') return globals.openRecent(arg);
    if (cmd === 'history') return app.edoc?.goTo(+arg);
    app.run(cmd, ...(arg !== undefined ? [arg] : []));
  };
  document.addEventListener('pointerdown', (e) => {
    if (S.menuOpen !== null && !e.target.closest('.menu-pop, .menu-top')) globals.closeMenus();
    if (S.flyout && !e.target.closest('.flyout, .tool-btn')) S.flyout = null;
  });

  // ---------- tools ----------
  const groups = TOOL_GROUPS.map(([id, tools]) => ({ id, tools, current: tools[0], key: app.tools.get(tools[0]).shortcut ?? '' }));
  S.toolGroups = groups;
  globals.toolIcon = (id) => TOOL_ICONS[id] ?? app.tools.get(id)?.icon ?? id;
  globals.setTool = (id) => {
    app.setTool(id);
    const g = S.toolGroups.find((x) => x.tools.includes(id));
    if (g) g.current = id;
  };
  globals.pickGroup = (g) => globals.setTool(g.current);
  globals.flyout = (g, el) => {
    if (g.tools.length < 2) return;
    const r = el.getBoundingClientRect();
    S.flyoutX = r.right + 4;
    S.flyoutY = r.top;
    S.flyout = { tools: g.tools, key: g.key };
  };
  let hold = null;
  globals.holdStart = (g, el) => {
    clearTimeout(hold);
    hold = setTimeout(() => globals.flyout(g, el), 450);
  };
  globals.holdEnd = () => clearTimeout(hold);
  globals.align = (where) => {
    const l = app.edoc?.activeLayer;
    if (!l || ['group', 'adjust', 'fill'].includes(l.type)) return;
    const d = app.edoc.doc;
    const area = app.edoc.selection.bounds() ?? { x: 0, y: 0, w: d.width, h: d.height };
    const b = layerBounds(l, app.renderer.size(l));
    let dx = 0;
    let dy = 0;
    if (where === 'left') dx = area.x - b.x;
    if (where === 'right') dx = area.x + area.w - (b.x + b.w);
    if (where === 'hcenter') dx = area.x + area.w / 2 - (b.x + b.w / 2);
    if (where === 'top') dy = area.y - b.y;
    if (where === 'bottom') dy = area.y + area.h - (b.y + b.h);
    if (where === 'vcenter') dy = area.y + area.h / 2 - (b.y + b.h / 2);
    app.edoc.commit(t('history.align'), [{ t: 'set', id: l.id, props: { x: l.x + dx, y: l.y + dy } }], { icon: 'move' });
  };
  globals.alignIcon = (a) => ({ left: 'align-left', hcenter: 'align-hcenter', right: 'align-right', top: 'align-top', vcenter: 'align-vcenter', bottom: 'align-bottom' })[a];

  // ---------- panels ----------
  const isPanelOpen = (p) => (p === 'timeline' ? !!S.panelsOpen.timeline : S.dock.some((g) => g.open && !g.collapsed && g.active === p));
  globals.togglePanel = (p) => ui.togglePanel(p);
  ui.togglePanel = (p) => {
    if (p === 'timeline') {
      S.panelsOpen.timeline = !S.panelsOpen.timeline;
      app.vp.resize();
      return;
    }
    const g = S.dock.find((x) => x.tabs.includes(p));
    if (!g) return;
    if (g.open && g.active === p && !g.collapsed) g.open = false;
    else {
      g.open = true;
      g.active = p;
      g.collapsed = false;
    }
    if (S.workspace !== 'pro') ui.setWorkspace('pro');
  };
  ui.openPanel = (p) => {
    const g = S.dock.find((x) => x.tabs.includes(p));
    if (!g) return;
    g.open = true;
    g.active = p;
    g.collapsed = false;
  };
  globals.togglePanelTab = (p) => ui.openPanel(p);
  ui.resetPanels = () => {
    S.dock = ctx.defaultDock();
    S.panelsOpen.timeline = false;
  };
  globals.openSheet = (p) => {
    // phones: panels open as a bottom sheet
    document.body.classList.toggle('sheet-open');
    ui.openPanel(p);
  };

  // ---------- workspace ----------
  ui.setWorkspace = (w) => {
    S.workspace = w;
    document.body.dataset.workspace = w;
    try {
      localStorage.setItem('pixelotter:workspace', w);
    } catch {
      // private mode
    }
    setTimeout(() => app.vp.resize(), 0);
  };
  globals.setWorkspace = (w) => ui.setWorkspace(w);

  // ---------- layers panel ----------
  globals.layerIcon = (type) => ({ raster: 'image', text: 'text', shape: 'shape', group: 'folder', adjust: 'adjust-layer', fill: 'bucket' })[type] ?? 'layers';
  globals.selectLayer = (id) => {
    app.selectLayer(id);
    ctx.adjustProps?.();
  };
  globals.toggleVisible = (id) => {
    const l = findLayer(app.edoc.doc, id);
    app.edoc.commit(l.visible ? t('history.hide') : t('history.show'), [{ t: 'set', id, props: { visible: !l.visible } }], { icon: 'eye' });
  };
  globals.toggleLock = (id) => {
    const l = findLayer(app.edoc.doc, id);
    app.edoc.commit(t('history.lock'), [{ t: 'set', id, props: { locked: !l.locked } }], { icon: 'lock' });
  };
  globals.toggleCollapse = (id) => {
    const l = findLayer(app.edoc.doc, id);
    // collapsing is a view thing, but it lives in the document so it is saved with it
    app.edoc.apply([{ t: 'set', id, props: { collapsed: !l.collapsed } }]);
  };
  globals.editMask = (id) => {
    if (app.edoc.active !== id) app.selectLayer(id);
    app.maskEdit = !app.maskEdit;
    S.maskEdit = app.maskEdit;
    app.syncLayers();
  };
  globals.setProp = (key, value, merge = null) => {
    const l = app.edoc?.activeLayer;
    if (!l) return;
    if (isLocked(app.edoc.doc, l.id) && !['visible', 'locked'].includes(key)) return ctx.toast(t('toast.locked'), 'warning');
    let v = value;
    if (key === 'opacity' || key === 'fill') v = Math.max(0, Math.min(1, Number(value)));
    app.edoc.commit(t(`history.prop.${key}`) || t('history.change'), [{ t: 'set', id: l.id, props: { [key]: v } }], { merge: merge ? `${merge}:${l.id}` : `${key}:${l.id}` });
    if (key === 'font') app.applyFontLater(app.edoc.layer(l.id));
  };
  globals.setSize = (axis, px) => {
    const l = app.edoc?.activeLayer;
    if (!l) return;
    const size = app.renderer.size(l);
    const k = axis === 'w' ? px / size.w : px / size.h;
    const sign = axis === 'w' ? Math.sign(l.scaleX) : Math.sign(l.scaleY);
    app.edoc.commit(t('history.scale'), [{ t: 'set', id: l.id, props: axis === 'w' ? { scaleX: k * sign } : { scaleY: k * sign } }]);
  };
  globals.setGradientStop = (i, color) => {
    const l = app.edoc.activeLayer;
    const stops = l.gradient.stops.map((s) => ({ ...s }));
    stops[i < 0 ? stops.length - 1 : i].color = color;
    globals.setProp('gradient', { ...l.gradient, stops }, 'gradient');
  };
  globals.setFeather = (v) => {
    const l = app.edoc?.activeLayer;
    if (!l?.mask) return;
    app.edoc.commit(t('history.feather'), [{ t: 'set', id: l.id, props: { mask: { ...l.mask, feather: Number(v) } } }], { merge: `feather:${l.id}` });
  };
  let dragId = null;
  globals.dragLayer = (e, id) => {
    dragId = id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };
  globals.dropLayer = (e, targetId) => {
    const id = dragId;
    dragId = null;
    if (!id || id === targetId || !app.edoc) return;
    const d = app.edoc.doc;
    const target = targetId ? findLayer(d, targetId) : null;
    if (target && subtree(d, id).includes(targetId)) return;
    const ops = [];
    // dropping on a group puts the layer inside it, at the top
    if (target?.type === 'group' && e.offsetY < 18) {
      ops.push({ t: 'set', id, props: { parent: target.id } });
      ops.push({ t: 'move', id, index: indexOf(d, target.id) });
    } else if (target) {
      if (findLayer(d, id).parent !== target.parent) ops.push({ t: 'set', id, props: { parent: target.parent } });
      // the list shows the top first: dropping on a row puts the layer just above that row
      ops.push({ t: 'move', id, index: indexOf(d, target.id) + (indexOf(d, id) < indexOf(d, target.id) ? 0 : 1) });
    } else {
      ops.push({ t: 'set', id, props: { parent: null } }, { t: 'move', id, index: 0 });
    }
    app.edoc.commit(t('history.arrange'), ops, { icon: 'layers' });
  };
  globals.renameLayerInline = (id) => ui.renameLayer(id);
  /** Double click on a layer thumbnail: text opens for editing, other layers are renamed. */
  globals.editLayerContent = (id) => {
    const l = findLayer(app.edoc.doc, id);
    if (l?.type !== 'text') return ui.renameLayer(id);
    app.selectLayer(id);
    app.setTool('text');
    app.editText(id, true);
  };
  ui.renameLayer = async (id = app.edoc.active) => {
    const l = findLayer(app.edoc.doc, id);
    if (!l) return;
    const name = await ui.prompt(t('rename.title'), t('rename.text'), l.name);
    if (name && name !== l.name) app.edoc.commit(t('history.rename'), [{ t: 'set', id, props: { name: name.slice(0, 80) } }], { icon: 'text' });
  };
  S.blendModes = BLEND_MODES;
  globals.goHistory = (i) => app.edoc?.goTo(i);

  // ---------- colors ----------
  globals.setColor = (which, hex) => app.setColor(which, hex);
  globals.swapColors = () => {
    const f = S.colors.fg;
    app.setColor('fg', S.colors.bg);
    app.setColor('bg', f);
  };
  globals.resetColors = () => {
    app.setColor('fg', '#000000');
    app.setColor('bg', '#ffffff');
  };
  const colorInput = document.getElementById('color-input');
  globals.pickColor = (which) => {
    colorInput.value = S.colors[which];
    colorInput.oninput = () => app.setColor(which, colorInput.value);
    colorInput.click();
  };
  const syncInfo = () => {
    app.syncColorInfo();
    const [r, g, b] = fromHex(S.colors.fg);
    S.colorInfo = { ...S.colorInfo, outOfGamut: !inGamut(r, g, b, 8) };
    drawSv();
  };
  ctx.syncInfo = syncInfo;
  const drawSv = () => {
    const c = document.getElementById('color-sv');
    if (!c) return;
    const g = c.getContext('2d');
    const { h, s, v } = S.colorInfo;
    const [hr, hg, hb] = hsvToRgb(h, 1, 1);
    const gx = g.createLinearGradient(0, 0, c.width, 0);
    gx.addColorStop(0, '#fff');
    gx.addColorStop(1, `rgb(${hr},${hg},${hb})`);
    g.fillStyle = gx;
    g.fillRect(0, 0, c.width, c.height);
    const gy = g.createLinearGradient(0, 0, 0, c.height);
    gy.addColorStop(0, 'rgba(0,0,0,0)');
    gy.addColorStop(1, '#000');
    g.fillStyle = gy;
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = v > 50 ? '#000' : '#fff';
    g.beginPath();
    g.arc((s / 100) * c.width, (1 - v / 100) * c.height, 5, 0, Math.PI * 2);
    g.stroke();
  };
  let svDrag = false;
  const svAt = (e) => {
    const c = e.target;
    const r = c.getBoundingClientRect();
    const s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    const rgb = hsvToRgb(S.colorInfo.h, s, v);
    app.setColor('fg', toHex(...rgb));
    S.colorInfo = { ...S.colorInfo, h: S.colorInfo.h };
    syncInfo();
  };
  globals.svDown = (e) => {
    svDrag = true;
    e.target.setPointerCapture(e.pointerId);
    svAt(e);
  };
  globals.svMove = (e) => svDrag && svAt(e);
  globals.svUp = () => (svDrag = false);
  globals.setHue = (h) => {
    const [, s, v] = rgbToHsv(...fromHex(S.colors.fg));
    app.setColor('fg', toHex(...hsvToRgb(+h, s || 1, v || 1)));
    syncInfo();
    S.colorInfo = { ...S.colorInfo, h: +h };
    drawSv();
  };
  globals.setHex = (hex) => {
    const c = fromHex(hex);
    if (c) {
      app.setColor('fg', toHex(c[0], c[1], c[2]));
      syncInfo();
    }
  };
  globals.setRgb = (ch, v) => {
    const c = fromHex(S.colors.fg);
    c[{ r: 0, g: 1, b: 2 }[ch]] = Math.max(0, Math.min(255, +v));
    app.setColor('fg', toHex(c[0], c[1], c[2]));
    syncInfo();
  };
  globals.addSwatch = () => {
    if (!S.swatches.includes(S.colors.fg)) S.swatches = [...S.swatches, S.colors.fg];
    ctx.saveLocal();
  };

  // ---------- tabs ----------
  globals.activateTab = (uid) => app.activate(uid);
  globals.closeTab = (uid) => ui.closeDoc(app.docs.find((d) => d.uid === uid));
  ui.closeDoc = async (edoc) => {
    if (!edoc) return true;
    if (edoc.dirty) {
      const r = await ui.confirm(t('close.title', { name: edoc.doc.name }), t('close.text'), { yes: t('close.save'), no: t('dialog.cancel'), third: t('close.discard') });
      if (r === false) return false;
      if (r === true) {
        const saved = await ui.save(edoc);
        if (!saved) return false;
      }
    }
    if (edoc.session && app.live) app.live.leave();
    app.closeDoc(edoc.uid);
    await ctx.refreshRecent();
    return true;
  };
  globals.goHome = async () => {
    S.screen = S.screen === 'home' && app.edoc ? 'editor' : 'home';
    if (S.screen === 'home') await ctx.refreshRecent();
    else app.vp.resize();
  };

  // ---------- home and recent ----------
  ctx.refreshRecent = async () => {
    try {
      const list = await listProjects(24);
      for (const r of S.recent) if (r.thumbUrl) URL.revokeObjectURL(r.thumbUrl);
      S.recent = list.map((r) => ({ id: r.id, name: r.name, when: new Date(r.updated).toLocaleString(S.lang), thumbUrl: r.thumb ? URL.createObjectURL(r.thumb) : '', dirty: r.dirty }));
    } catch {
      S.recent = [];
    }
  };
  globals.openRecent = async (id) => {
    const p = await getProject(id);
    if (!p) return;
    const already = app.docs.find((d) => d.doc.id === id);
    if (already) return app.activate(already.uid);
    const file = new File([p.bytes], `${p.name}.pxo`);
    const edoc = await openFile(file);
    if (p.file) edoc.file.name = p.file;
    app.add(edoc);
    S.recover = S.recover.filter((r) => r.id !== id);
  };
  globals.forgetRecent = async (id) => {
    await deleteProject(id);
    await ctx.refreshRecent();
  };
  globals.recoverAll = async () => {
    for (const r of [...S.recover]) await globals.openRecent(r.id);
    S.recover = [];
  };

  // ---------- opening files ----------
  const fileInput = document.getElementById('file-input');
  fileInput.accept = ACCEPT;
  const pick = (multiple = true) =>
    new Promise((resolve) => {
      fileInput.multiple = multiple;
      fileInput.value = '';
      fileInput.onchange = () => {
        fileInput.onchange = openPicked;
        resolve([...fileInput.files]);
      };
      fileInput.click();
    });
  // files given to the input without a picker (drag and drop helpers, tests) open as documents
  const openPicked = () => ctx.openFiles([...fileInput.files]);
  fileInput.onchange = openPicked;
  ui.open = async () => {
    let files = [];
    if (window.showOpenFilePicker) {
      try {
        const handles = await window.showOpenFilePicker({ multiple: true });
        for (const h of handles) {
          const f = await h.getFile();
          f.handle = h;
          files.push(f);
        }
      } catch (err) {
        if (err?.name === 'AbortError') return;
        files = await pick();
      }
    } else files = await pick();
    await ctx.openFiles(files);
  };
  ctx.openFiles = async (files) => {
    for (const f of files) {
      app.status(t('status.opening', { name: f.name }));
      try {
        const edoc = await openFile(f);
        app.add(edoc);
        for (const n of edoc.notes ?? []) ctx.toast(t(`note.${n}`), 'info');
      } catch (err) {
        ctx.toast(t('open.failed', { name: f.name, error: err.message }), 'danger');
      }
    }
    app.status('');
  };
  ui.place = async () => {
    const files = await pick();
    await ctx.placeFiles(files);
  };
  ctx.placeFiles = async (files, at = null) => {
    const edoc = app.edoc;
    if (!edoc) return ctx.openFiles(files);
    for (const f of files) {
      try {
        const dec = await decodeForPlace(f);
        const src = dec.layers.find((l) => l.kind === 'raster') ?? dec.layers[0];
        const d = edoc.doc;
        // fit inside the canvas, centered (or where it was dropped)
        const k = Math.min(1, (d.width * 0.9) / dec.width, (d.height * 0.9) / dec.height);
        const asset = newId('a');
        const id = newId();
        const layer = makeLayer('raster', { id, name: f.name.replace(/\.[^.]+$/, ''), asset, w: src.width, h: src.height, x: at?.x ?? d.width / 2, y: at?.y ?? d.height / 2, scaleX: k, scaleY: k });
        edoc.commit(t('history.place'), [{ t: 'asset', id: asset, w: src.width, h: src.height, data: src.data }, { t: 'add', layer, index: app.insertIndex() }], { icon: 'image' });
        app.selectLayer(id);
      } catch (err) {
        ctx.toast(t('open.failed', { name: f.name, error: err.message }), 'danger');
      }
    }
  };
  // drag and drop, copy and paste live in clipboard.js

  // ---------- keyboard ----------
  window.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, select, [contenteditable]') && !(e.key === 'Escape')) return;
    if (document.querySelector('dialog[open]')) return;
    if (e.key === ' ' && !e.repeat) {
      app.vp.space = true;
      app.setCursor('grab');
      e.preventDefault();
      return;
    }
    // the tool first (Enter in crop, arrows with move, Backspace in the polygonal lasso)
    if (app.edoc && app.tool?.key?.(app, e)) {
      e.preventDefault();
      return;
    }
    const id = app.commands.match(e);
    // Ctrl+V lets the browser fire its paste event, which carries the data without asking
    const PASTE = { 'edit.paste': 'normal', 'edit.pasteInPlace': 'inPlace', 'edit.pasteInto': 'into' };
    if (id && PASTE[id]) {
      if (app.commands.can(id)) ui.expectPaste(PASTE[id]);
      return;
    }
    if (id) {
      e.preventDefault();
      app.run(id);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // Escape stops a drag or a stroke that is under way
    if (e.key === 'Escape' && app.vp.toolActive) {
      app.vp.toolActive = false;
      app.pointer('cancel');
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'x') return globals.swapColors();
    if (k === 'd') return globals.resetColors();
    const o = app.opts(app.toolId);
    // [ and ] change the brush size; with Shift ({ and }) the hardness
    if (k === '[' || k === ']') {
      if (o.size) o.size = Math.max(1, Math.round(o.size * (k === '[' ? 0.85 : 1.18)));
      app.vp.needsOverlay = true;
      return;
    }
    if (k === '{' || k === '}') {
      if (typeof o.hardness === 'number') o.hardness = Math.round(Math.max(0, Math.min(1, o.hardness + (k === '{' ? -0.1 : 0.1))) * 100) / 100;
      return;
    }
    // 1 to 9 set the opacity in tens, 0 sets 100%: of the brush, or else of the layer
    if (/^[0-9]$/.test(e.key) && app.edoc) {
      const v = e.key === '0' ? 1 : Number(e.key) / 10;
      if (typeof o.opacity === 'number') o.opacity = v;
      else {
        const l = app.edoc.activeLayer;
        if (l) app.edoc.commit(t('history.prop.opacity'), [{ t: 'set', id: l.id, props: { opacity: v } }], { merge: `opacity:${l.id}`, icon: 'layers' });
      }
      ctx.toast(t('toast.opacity', { n: Math.round(v * 100) }));
      return;
    }
    // Tab hides the panels only from the canvas; on a control it moves the focus as usual
    if (k === 'tab' && (e.target === document.body || e.target.closest?.('#viewport'))) {
      e.preventDefault();
      document.body.classList.toggle('panels-hidden');
      setTimeout(() => app.vp.resize(), 0);
      return;
    }
    // tool letters: pressing the same letter again cycles the group (with Shift)
    const g = S.toolGroups.find((x) => x.key === k);
    if (g) {
      if (e.shiftKey && g.tools.includes(app.toolId)) {
        const next = g.tools[(g.tools.indexOf(app.toolId) + 1) % g.tools.length];
        globals.setTool(next);
      } else globals.setTool(g.current);
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') {
      app.vp.space = false;
      app.setCursor(app.tool?.cursor ?? 'default');
    }
  });

  globals.toastAction = (tt) => {
    tt.action?.run?.();
    S.toasts = S.toasts.filter((x) => x.id !== tt.id);
  };
  globals.run = (id, ...args) => app.run(id, ...args);
  globals.can = (id) => app.commands.can(id);
}
