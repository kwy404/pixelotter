// The document model and its operations. A document is plain JSON: a size, a background and a
// list of layers from bottom to top. Pixels live outside the JSON in an asset store, keyed by
// asset id (see pixels.js). Every change to a document is an operation, so the same code drives
// undo and redo, autosave and live editing with friends:
//   { t: 'add', layer, index }        insert a layer at an index of doc.layers
//   { t: 'remove', id }               delete a layer
//   { t: 'move', id, index }          change the stacking order
//   { t: 'set', id, props }           change layer properties (shallow merge)
//   { t: 'doc', props }               change name, width, height or background
// Pixel operations ('asset', 'patch', 'replace') are applied by the asset store.

import { BLEND_MODES } from './blend.js';
import { normalizeAdjustments } from './filters/adjust.js';

export const DOC_FORMAT = 'pixelotter';
export const DOC_VERSION = 1;
export const LAYER_TYPES = Object.freeze(['raster', 'text', 'shape', 'group', 'adjust']);
export const MAX_SIDE = 12000;
export const MAX_LAYERS = 500;

let counter = 0;
/** A short unique id. Random part plus a counter, so ids made in one tick still differ. */
export function newId(prefix = 'l') {
  counter = (counter + 1) % 1679616;
  const rnd = Math.floor(Math.random() * 2176782336).toString(36).padStart(6, '0');
  return `${prefix}${rnd}${counter.toString(36).padStart(4, '0')}`;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const str = (v, d, max = 200) => (typeof v === 'string' ? v.slice(0, max) : d);
const color = (v, d) => (typeof v === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v) ? v.toLowerCase() : d);

export function createDoc({ name = 'Untitled', width = 1080, height = 1080, background = '#ffffff' } = {}) {
  return {
    format: DOC_FORMAT,
    version: DOC_VERSION,
    id: newId('d'),
    name: str(name, 'Untitled', 120),
    width: clamp(Math.round(num(width, 1080)), 1, MAX_SIDE),
    height: clamp(Math.round(num(height, 1080)), 1, MAX_SIDE),
    background: background === null ? null : color(background, '#ffffff'),
    layers: [],
  };
}

const BASE = { name: 'Layer', visible: true, locked: false, opacity: 1, fill: 1, blend: 'normal', parent: null, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, mask: null };

export const TEXT_DEFAULTS = Object.freeze({
  text: 'Your text',
  font: 'Inter',
  size: 96,
  weight: 700,
  italic: false,
  color: '#ffffff',
  align: 'center',
  lineHeight: 1.15,
  letterSpacing: 0,
  outline: { width: 0, color: '#000000' },
  shadow: { blur: 0, x: 0, y: 6, color: '#00000080' },
  curve: 0,
  bubble: { style: 'none', color: '#111111', padding: 28, radius: 28 },
});

export const SHAPE_KINDS = Object.freeze(['rect', 'ellipse', 'line', 'arrow', 'star', 'heart', 'triangle']);

/** A layer with every field present and valid. Unknown fields are dropped. */
export function normalizeLayer(input) {
  if (!input || typeof input !== 'object') throw new Error('A layer must be an object');
  const type = LAYER_TYPES.includes(input.type) ? input.type : null;
  if (!type) throw new Error(`Unknown layer type: ${input.type}`);
  const l = {
    id: typeof input.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(input.id) ? input.id : newId(),
    type,
    name: str(input.name, BASE.name, 80),
    visible: input.visible !== false,
    locked: input.locked === true,
    opacity: clamp(num(input.opacity, 1), 0, 1),
    fill: clamp(num(input.fill, 1), 0, 1),
    blend: BLEND_MODES.includes(input.blend) ? input.blend : 'normal',
    parent: typeof input.parent === 'string' ? input.parent : null,
    x: num(input.x, 0),
    y: num(input.y, 0),
    rotation: num(input.rotation, 0),
    scaleX: num(input.scaleX, 1) || 1,
    scaleY: num(input.scaleY, 1) || 1,
    mask: null,
  };
  if (input.mask && typeof input.mask.asset === 'string') {
    l.mask = { asset: input.mask.asset, enabled: input.mask.enabled !== false, feather: clamp(num(input.mask.feather, 0), 0, 200), invert: input.mask.invert === true };
  }
  if (type === 'raster') {
    l.asset = str(input.asset, null, 60);
    l.w = clamp(Math.round(num(input.w, 1)), 1, MAX_SIDE);
    l.h = clamp(Math.round(num(input.h, 1)), 1, MAX_SIDE);
    l.adjust = normalizeAdjustments(input.adjust);
    l.look = str(input.look, 'none', 40);
  } else if (type === 'text') {
    const d = TEXT_DEFAULTS;
    l.text = str(input.text, d.text, 5000);
    l.font = str(input.font, d.font, 80);
    l.size = clamp(num(input.size, d.size), 4, 2000);
    l.weight = clamp(Math.round(num(input.weight, d.weight) / 100) * 100, 100, 900);
    l.italic = input.italic === true;
    l.color = color(input.color, d.color);
    l.align = ['left', 'center', 'right'].includes(input.align) ? input.align : d.align;
    l.lineHeight = clamp(num(input.lineHeight, d.lineHeight), 0.6, 4);
    l.letterSpacing = clamp(num(input.letterSpacing, d.letterSpacing), -50, 200);
    l.outline = { width: clamp(num(input.outline?.width, 0), 0, 200), color: color(input.outline?.color, d.outline.color) };
    l.shadow = {
      blur: clamp(num(input.shadow?.blur, 0), 0, 200),
      x: clamp(num(input.shadow?.x, 0), -500, 500),
      y: clamp(num(input.shadow?.y, d.shadow.y), -500, 500),
      color: color(input.shadow?.color, d.shadow.color),
    };
    l.curve = clamp(num(input.curve, 0), -100, 100);
    const style = ['none', 'box', 'pill', 'speech', 'thought'].includes(input.bubble?.style) ? input.bubble.style : 'none';
    l.bubble = { style, color: color(input.bubble?.color, d.bubble.color), padding: clamp(num(input.bubble?.padding, d.bubble.padding), 0, 400), radius: clamp(num(input.bubble?.radius, d.bubble.radius), 0, 400) };
  } else if (type === 'shape') {
    l.shape = SHAPE_KINDS.includes(input.shape) ? input.shape : 'rect';
    l.w = clamp(num(input.w, 200), 1, MAX_SIDE * 2);
    l.h = clamp(num(input.h, 200), 1, MAX_SIDE * 2);
    l.fillColor = input.fillColor === null ? null : color(input.fillColor, '#c08a4e');
    l.stroke = input.stroke === null ? null : color(input.stroke, null);
    l.strokeWidth = clamp(num(input.strokeWidth, 0), 0, 400);
    l.radius = clamp(num(input.radius, 0), 0, 2000);
  } else if (type === 'group') {
    l.collapsed = input.collapsed === true;
  } else if (type === 'adjust') {
    l.adjust = normalizeAdjustments(input.adjust);
    l.look = str(input.look, 'none', 40);
  }
  return l;
}

export function makeLayer(type, props = {}) {
  return normalizeLayer({ ...props, type });
}

/** Checks and normalizes a whole document (for opening files and joining sessions). */
export function normalizeDoc(input) {
  if (!input || typeof input !== 'object' || input.format !== DOC_FORMAT) throw new Error('This is not a pixelotter document');
  if (!Number.isInteger(input.version) || input.version > DOC_VERSION) throw new Error('This document was made by a newer version of pixelotter');
  const doc = createDoc({ name: input.name, width: input.width, height: input.height, background: input.background === null ? null : input.background });
  if (typeof input.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(input.id)) doc.id = input.id;
  const layers = Array.isArray(input.layers) ? input.layers.slice(0, MAX_LAYERS) : [];
  const seen = new Set();
  for (const raw of layers) {
    const l = normalizeLayer(raw);
    if (seen.has(l.id)) l.id = newId();
    seen.add(l.id);
    doc.layers.push(l);
  }
  // Parents must be groups that exist, and a group may not contain itself.
  const groups = new Set(doc.layers.filter((l) => l.type === 'group').map((l) => l.id));
  for (const l of doc.layers) if (l.parent && (!groups.has(l.parent) || l.parent === l.id)) l.parent = null;
  for (const l of doc.layers) if (l.parent && ancestors(doc, l.parent).includes(l.id)) l.parent = null;
  return doc;
}

export const findLayer = (doc, id) => doc.layers.find((l) => l.id === id) ?? null;
export const indexOf = (doc, id) => doc.layers.findIndex((l) => l.id === id);

/** Ids of the groups above a layer, nearest first. */
export function ancestors(doc, id) {
  const out = [];
  let cur = findLayer(doc, id)?.parent ?? null;
  while (cur && !out.includes(cur)) {
    out.push(cur);
    cur = findLayer(doc, cur)?.parent ?? null;
  }
  return out;
}

/** Direct children of a group (or of the root for null), bottom first. */
export const childrenOf = (doc, parent = null) => doc.layers.filter((l) => (l.parent ?? null) === parent);

/** A layer and everything inside it, if it is a group. */
export function subtree(doc, id) {
  const out = [];
  const walk = (pid) => {
    for (const l of doc.layers) {
      if (l.parent === pid) {
        out.push(l.id);
        if (l.type === 'group') walk(l.id);
      }
    }
  };
  out.push(id);
  if (findLayer(doc, id)?.type === 'group') walk(id);
  return out;
}

/** Visible means the layer and all its groups are visible. */
export function isShown(doc, id) {
  const l = findLayer(doc, id);
  if (!l || !l.visible) return false;
  return ancestors(doc, id).every((g) => findLayer(doc, g)?.visible !== false);
}

/** A layer is locked when it or any group above it is locked. */
export function isLocked(doc, id) {
  const l = findLayer(doc, id);
  if (!l) return true;
  return l.locked || ancestors(doc, id).some((g) => findLayer(doc, g)?.locked);
}

/** The tree for rendering and for the layers panel: [{ layer, children }], bottom first. */
export function layerTree(doc, parent = null) {
  return childrenOf(doc, parent).map((layer) => ({ layer, children: layer.type === 'group' ? layerTree(doc, layer.id) : [] }));
}

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

const DOC_PROPS = ['name', 'width', 'height', 'background'];

/** Applies one JSON operation to a document in place. Throws on an invalid operation. */
export function applyOp(doc, op) {
  switch (op?.t) {
    case 'add': {
      if (doc.layers.length >= MAX_LAYERS) throw new Error('Too many layers');
      const layer = normalizeLayer(clone(op.layer));
      if (findLayer(doc, layer.id)) throw new Error(`Layer ${layer.id} exists`);
      if (layer.parent && findLayer(doc, layer.parent)?.type !== 'group') layer.parent = null;
      const index = clamp(Math.round(num(op.index, doc.layers.length)), 0, doc.layers.length);
      doc.layers.splice(index, 0, layer);
      return doc;
    }
    case 'remove': {
      const i = indexOf(doc, op.id);
      if (i < 0) throw new Error(`No layer ${op.id}`);
      doc.layers.splice(i, 1);
      for (const l of doc.layers) if (l.parent === op.id) l.parent = null;
      return doc;
    }
    case 'move': {
      const i = indexOf(doc, op.id);
      if (i < 0) throw new Error(`No layer ${op.id}`);
      const [layer] = doc.layers.splice(i, 1);
      const index = clamp(Math.round(num(op.index, doc.layers.length)), 0, doc.layers.length);
      doc.layers.splice(index, 0, layer);
      return doc;
    }
    case 'set': {
      const i = indexOf(doc, op.id);
      if (i < 0) throw new Error(`No layer ${op.id}`);
      const props = clone(op.props) ?? {};
      delete props.id;
      delete props.type;
      if (props.parent) {
        if (findLayer(doc, props.parent)?.type !== 'group' || props.parent === op.id || ancestors(doc, props.parent).includes(op.id)) throw new Error('Invalid parent');
      }
      doc.layers[i] = normalizeLayer({ ...doc.layers[i], ...props });
      return doc;
    }
    case 'doc': {
      const props = op.props ?? {};
      const next = createDoc({
        name: 'name' in props ? props.name : doc.name,
        width: 'width' in props ? props.width : doc.width,
        height: 'height' in props ? props.height : doc.height,
        background: 'background' in props ? props.background : doc.background,
      });
      for (const k of DOC_PROPS) doc[k] = next[k];
      return doc;
    }
    default:
      throw new Error(`Unknown operation ${op?.t}`);
  }
}

/** The operation that undoes op, computed from the document before op is applied. */
export function invertOp(doc, op) {
  switch (op.t) {
    case 'add':
      return { t: 'remove', id: op.layer.id };
    case 'remove': {
      const i = indexOf(doc, op.id);
      const children = doc.layers.filter((l) => l.parent === op.id).map((l) => l.id);
      const restore = { t: 'add', layer: clone(doc.layers[i]), index: i };
      // Children of a removed group fall back to the root, so undo puts them back.
      if (children.length) return [restore, ...children.map((id) => ({ t: 'set', id, props: { parent: op.id } }))];
      return restore;
    }
    case 'move':
      return { t: 'move', id: op.id, index: indexOf(doc, op.id) };
    case 'set': {
      const l = findLayer(doc, op.id);
      const props = {};
      for (const k of Object.keys(op.props ?? {})) props[k] = clone(l?.[k] ?? null);
      return { t: 'set', id: op.id, props };
    }
    case 'doc': {
      const props = {};
      for (const k of Object.keys(op.props ?? {})) if (DOC_PROPS.includes(k)) props[k] = doc[k];
      return { t: 'doc', props };
    }
    default:
      return null;
  }
}

export const isDocOp = (op) => ['add', 'remove', 'move', 'set', 'doc'].includes(op?.t);

/** Applies a list of JSON operations and returns the list of inverses, newest last. */
export function applyOps(doc, ops) {
  const inverse = [];
  for (const op of ops) {
    const inv = invertOp(doc, op);
    applyOp(doc, op);
    if (Array.isArray(inv)) inverse.push(...inv.reverse());
    else if (inv) inverse.push(inv);
  }
  return inverse;
}

/** The ids of every asset a document refers to (layer pixels and masks). */
export function assetIds(doc) {
  const ids = new Set();
  for (const l of doc.layers) {
    if (l.type === 'raster' && l.asset) ids.add(l.asset);
    if (l.mask?.asset) ids.add(l.mask.asset);
  }
  return [...ids];
}
