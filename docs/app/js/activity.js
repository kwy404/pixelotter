// The Activity panel: who did what and when, in plain words ("Lia painted on the layer
// Background"). Every step recorded in a document lands here with its author, name and color;
// in a live session each person's steps are shared, so everyone reads the same story. A click
// selects the layer, a filter keeps one person, and the log exports as text.

import { download } from './files.js';

const MAX = 500;
const PAINT = new Set(['brush', 'pencil']);

/** The plain facts of one recorded step: kind, the layer it touched, a text or a label. */
export function summarize(edoc, { label = '', icon = '', ops = [], inverse = [], kind = null }) {
  const layerOfOp = (op) => (op.t === 'patch' ? edoc.layerOf(op.id) : op.t === 'add' ? op.layer?.id : op.id ?? null);
  const nameOf = (id) => edoc.layer(id)?.name ?? inverse.find((o) => o.t === 'add' && o.layer?.id === id)?.layer.name ?? '';
  const added = ops.find((o) => o.t === 'add' && o.layer);
  const removed = ops.find((o) => o.t === 'remove');
  const textSet = ops.find((o) => o.t === 'set' && typeof o.props?.text === 'string');
  const first = ops.map(layerOfOp).find(Boolean) ?? null;
  let k = 'did';
  let layer = first;
  let txt = '';
  if (kind === 'paste' || kind === 'pasteText') {
    k = kind;
    layer = added?.layer.id ?? first;
  } else if (textSet) {
    k = 'text';
    layer = textSet.id;
    txt = textSet.props.text.replace(/\s+/g, ' ').slice(0, 60);
  } else if (added && !removed) {
    k = 'add';
    layer = added.layer.id;
  } else if (removed && !added) {
    k = 'delete';
    layer = removed.id;
  } else if (PAINT.has(icon)) k = 'paint';
  else if (icon === 'eraser') k = 'erase';
  else if (icon === 'filters') k = 'filter';
  else if (icon === 'move') k = 'move';
  else if (ops.length && ops.every((o) => o.t === 'set' && Object.keys(o.props ?? {}).every((p) => p === 'name'))) k = 'rename';
  return { k, label: String(label).slice(0, 60), layer: layer ?? '', lname: layer ? nameOf(layer).slice(0, 60) : '', txt };
}

export function installActivity(ctx) {
  const { app, S, t, globals } = ctx;
  S.activity = [];
  S.activityFilter = '';
  S.activityPeople = [];
  let seq = 0;

  const me = () => ({ by: app.live?.myId ?? 'me', name: S.settings.name || t('activity.you'), color: S.settings.color || '#d39b5c' });
  const logOf = (edoc) => (edoc.activity ??= []);

  /** One sentence for an entry, in the reader's language ("You" for your own steps). */
  const sentence = (e) => {
    const mine = e.by === 'me' || e.by === (app.live?.myId ?? 'me');
    const who = mine ? t('activity.you') : e.name;
    const k = e.k === 'did' && !e.lname ? 'didDoc' : e.k;
    return t(`activity.${k}`, { name: who, layer: e.lname || t('activity.aLayer'), label: e.label, text: e.txt });
  };

  const render = () => {
    const edoc = app.edoc;
    const log = edoc ? logOf(edoc) : [];
    const people = new Map();
    for (const e of log) people.set(e.by, { id: e.by, name: e.by === 'me' || e.by === app.live?.myId ? t('activity.you') : e.name, color: e.color });
    S.activityPeople = [...people.values()];
    const list = S.activityFilter ? log.filter((e) => e.by === S.activityFilter) : log;
    S.activity = list
      .slice(-200)
      .reverse()
      .map((e) => ({ id: e.id, color: e.color, initial: (e.name || '?').slice(0, 1).toUpperCase(), text: sentence(e), time: new Date(e.at).toLocaleTimeString(S.lang, { hour: '2-digit', minute: '2-digit' }), layer: e.layer, by: e.by }));
  };

  const add = (edoc, entry) => {
    const log = logOf(edoc);
    const last = log.at(-1);
    // a slider drag or a run of nudges is one step: keep one line for it
    if (last && last.by === entry.by && last.k === entry.k && last.label === entry.label && last.layer === entry.layer && entry.k !== 'paint' && entry.at - last.at < 3000) log[log.length - 1] = { ...entry, id: last.id };
    else log.push(entry);
    if (log.length > MAX) log.splice(0, log.length - MAX);
    if (edoc === app.edoc) render();
  };

  /** My own step: logged here and sent to the room. */
  const local = (edoc, step, extra = {}) => {
    const e = { id: `a${Date.now().toString(36)}${seq++}`, at: Date.now(), ...me(), ...summarize(edoc, step), ...extra };
    // the history step remembers its author too
    const last = extra.k ? null : edoc.history.entries?.at(-1);
    if (last && !last.author) {
      last.author = { name: e.name, color: e.color };
      if (edoc === app.edoc) app.syncHistory();
    }
    add(edoc, e);
    if (edoc === app.live?.edoc) app.live?.shareActivity?.(e);
  };
  const watch = (edoc) => {
    if (edoc.activityWatched) return;
    edoc.activityWatched = true;
    edoc.on('recorded', (step) => local(edoc, step));
    edoc.on('undone', (step) => step && local(edoc, { label: step.label }, { k: 'undo', layer: '', lname: '' }));
    edoc.on('redone', (step) => step && local(edoc, { label: step.label }, { k: 'redo', layer: '', lname: '' }));
  };
  const addDoc = app.add.bind(app);
  app.add = (edoc) => {
    watch(edoc);
    return addDoc(edoc);
  };
  for (const d of app.docs) watch(d);

  /** A step from a friend in the live session. */
  app.activityRemote = (edoc, from, e) => {
    const p = app.live?.peers.find((x) => x.id === from);
    if (!p || !e || typeof e !== 'object') return;
    add(edoc, {
      id: `r${Date.now().toString(36)}${seq++}`,
      at: Number.isFinite(e.at) ? Math.min(Date.now(), e.at) : Date.now(),
      by: from,
      name: p.name,
      color: p.color,
      k: /^[a-z]{2,10}$/.test(e.k) ? e.k : 'did',
      label: String(e.label ?? '').slice(0, 60),
      layer: String(e.layer ?? '').slice(0, 40),
      lname: String(e.lname ?? '').slice(0, 60),
      txt: String(e.txt ?? '').slice(0, 60),
    });
  };
  ctx.renderActivity = render;

  globals.activityPick = (row) => {
    if (row.layer && app.edoc?.layer(row.layer)) app.selectLayer(row.layer);
  };
  globals.activityFilterBy = (id) => {
    S.activityFilter = id;
    render();
  };
  globals.activityExport = () => {
    const edoc = app.edoc;
    if (!edoc) return;
    const lines = logOf(edoc).map((e) => `${new Date(e.at).toLocaleString(S.lang)}  ${sentence(e)}`);
    const name = `${(edoc.doc.name || 'pixelotter').replace(/[^\w-]+/g, '-')}-${t('panel.activity').toLowerCase()}.txt`;
    download(new TextEncoder().encode(`${lines.join('\n')}\n`), name, 'text/plain');
  };

  // the panel follows the active document and the language
  const activate = app.activate.bind(app);
  app.activate = (uid) => {
    activate(uid);
    render();
  };
}
