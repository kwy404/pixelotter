// Transforms for layers and the canvas. A layer's local box is w by h (pixels for raster
// layers, the measured box for text, the shape size for shapes). Its matrix maps the local box
// to document pixels: translate to (x, y), rotate, scale, then center the box on the origin.
// Matrices are [a, b, c, d, e, f] like the canvas setTransform.

export const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);
const RAD = Math.PI / 180;

export function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) return [...IDENTITY];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

export const apply = (m, p) => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });

export const translate = (x, y) => [1, 0, 0, 1, x, y];
export const scale = (sx, sy = sx) => [sx, 0, 0, sy, 0, 0];
export function rotate(deg) {
  const c = Math.cos(deg * RAD);
  const s = Math.sin(deg * RAD);
  return [c, s, -s, c, 0, 0];
}

/** Local box to document matrix. */
export function layerMatrix(layer, size) {
  let m = translate(layer.x, layer.y);
  if (layer.rotation) m = multiply(m, rotate(layer.rotation));
  m = multiply(m, scale(layer.scaleX ?? 1, layer.scaleY ?? 1));
  return multiply(m, translate(-size.w / 2, -size.h / 2));
}

/** The four corners in document pixels: top left, top right, bottom right, bottom left. */
export function corners(layer, size) {
  const m = layerMatrix(layer, size);
  return [
    apply(m, { x: 0, y: 0 }),
    apply(m, { x: size.w, y: 0 }),
    apply(m, { x: size.w, y: size.h }),
    apply(m, { x: 0, y: size.h }),
  ];
}

export function boundsOf(points) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export const layerBounds = (layer, size) => boundsOf(corners(layer, size));

/** The point in the layer's local box (0..w, 0..h) under a document point. */
export const toLocal = (layer, size, p) => apply(invert(layerMatrix(layer, size)), p);

export function hitTest(layer, size, p, pad = 0) {
  const q = toLocal(layer, size, p);
  const sx = Math.abs(layer.scaleX ?? 1) || 1;
  const sy = Math.abs(layer.scaleY ?? 1) || 1;
  return q.x >= -pad / sx && q.y >= -pad / sy && q.x <= size.w + pad / sx && q.y <= size.h + pad / sy;
}

/** Handle names and their position in the unit box. */
export const HANDLES = Object.freeze({
  nw: [0, 0],
  n: [0.5, 0],
  ne: [1, 0],
  e: [1, 0.5],
  se: [1, 1],
  s: [0.5, 1],
  sw: [0, 1],
  w: [0, 0.5],
});

/** Handle positions in document pixels, plus the rotation knob above the top edge. */
export function handlePoints(layer, size, knob = 36) {
  const m = layerMatrix(layer, size);
  const out = {};
  for (const [k, [u, v]] of Object.entries(HANDLES)) out[k] = apply(m, { x: u * size.w, y: v * size.h });
  const top = out.n;
  const center = { x: layer.x, y: layer.y };
  const dx = top.x - center.x;
  const dy = top.y - center.y;
  const len = Math.hypot(dx, dy) || 1;
  out.rotate = { x: top.x + (dx / len) * knob, y: top.y + (dy / len) * knob };
  return out;
}

/**
 * Resizes a layer by dragging a handle. start: the layer when the drag began, p: the pointer in
 * document pixels. keepAspect locks the ratio (corners), fromCenter scales around the center.
 * Returns { x, y, scaleX, scaleY }.
 */
export function resizeByHandle(start, size, handle, p, { keepAspect = false, fromCenter = false } = {}) {
  const [u, v] = HANDLES[handle];
  const local = toLocal({ ...start }, size, p); // pointer in the start box coordinates
  const sx0 = start.scaleX ?? 1;
  const sy0 = start.scaleY ?? 1;
  // Anchor: the opposite handle, or the center.
  const au = fromCenter ? 0.5 : 1 - u;
  const av = fromCenter ? 0.5 : 1 - v;
  let fx = 1;
  let fy = 1;
  if (u !== 0.5) {
    const span = (u - au) * size.w;
    fx = span ? (local.x - au * size.w) / span : 1;
  }
  if (v !== 0.5) {
    const span = (v - av) * size.h;
    fy = span ? (local.y - av * size.h) / span : 1;
  }
  if (keepAspect && u !== 0.5 && v !== 0.5) {
    const f = Math.abs(fx) > Math.abs(fy) ? fx : fy;
    fx = f;
    fy = f;
  } else if (keepAspect && u === 0.5) fx = Math.abs(fy) * Math.sign(fx || 1);
  else if (keepAspect && v === 0.5) fy = Math.abs(fx) * Math.sign(fy || 1);
  const min = 0.002;
  if (Math.abs(fx) < min) fx = min * Math.sign(fx || 1);
  if (Math.abs(fy) < min) fy = min * Math.sign(fy || 1);
  const next = { ...start, scaleX: sx0 * fx, scaleY: sy0 * fy };
  // Keep the anchor point where it was.
  const anchorLocal = { x: au * size.w, y: av * size.h };
  const before = apply(layerMatrix(start, size), anchorLocal);
  const after = apply(layerMatrix({ ...next, x: start.x, y: start.y }, size), anchorLocal);
  return { x: start.x + before.x - after.x, y: start.y + before.y - after.y, scaleX: next.scaleX, scaleY: next.scaleY };
}

/** Rotation from dragging the knob around the center, snapped to 15 degrees when asked. */
export function rotationFromDrag(start, from, to, snap = false) {
  const a0 = Math.atan2(from.y - start.y, from.x - start.x);
  const a1 = Math.atan2(to.y - start.y, to.x - start.x);
  let deg = (start.rotation ?? 0) + (a1 - a0) / RAD;
  if (snap) deg = Math.round(deg / 15) * 15;
  return normalizeAngle(deg);
}

export function normalizeAngle(deg) {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return Math.round(d * 100) / 100;
}

/** Scale that makes a w by h box fit inside (contain) or cover a W by H box. */
export function fitScale(w, h, W, H, mode = 'contain') {
  const s = [W / w, H / h];
  return mode === 'cover' ? Math.max(...s) : Math.min(...s);
}

/**
 * Straighten: the smallest zoom that keeps a W by H canvas covered by an image of the same size
 * rotated by deg, so no empty corners appear.
 */
export function straightenScale(W, H, deg) {
  const c = Math.abs(Math.cos(deg * RAD));
  const s = Math.abs(Math.sin(deg * RAD));
  return Math.max((W * c + H * s) / W, (W * s + H * c) / H);
}

/** Operations that crop the canvas to rect (document pixels). Layers keep their pixels. */
export function cropOps(doc, rect) {
  const r = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.max(1, Math.round(rect.w)), h: Math.max(1, Math.round(rect.h)) };
  const ops = [{ t: 'doc', props: { width: r.w, height: r.h } }];
  for (const l of doc.layers) if (l.type !== 'group' && l.type !== 'adjust') ops.push({ t: 'set', id: l.id, props: { x: l.x - r.x, y: l.y - r.y } });
  return ops;
}

/** Canvas size: anchor is [0..1, 0..1], where the old canvas sits in the new one. */
export function canvasSizeOps(doc, w, h, anchor = [0.5, 0.5]) {
  const dx = (w - doc.width) * anchor[0];
  const dy = (h - doc.height) * anchor[1];
  return cropOps(doc, { x: -dx, y: -dy, w, h });
}

/** Image size: scales the canvas and every layer with it (layers stay sharp until export). */
export function imageSizeOps(doc, w, h) {
  const sx = w / doc.width;
  const sy = h / doc.height;
  const ops = [{ t: 'doc', props: { width: Math.round(w), height: Math.round(h) } }];
  for (const l of doc.layers) {
    if (l.type === 'group' || l.type === 'adjust') continue;
    ops.push({ t: 'set', id: l.id, props: { x: l.x * sx, y: l.y * sy, scaleX: l.scaleX * sx, scaleY: l.scaleY * sy } });
  }
  return ops;
}

/** Rotates the whole canvas by 90 degrees clockwise (dir 1) or counter clockwise (dir -1). */
export function rotateCanvasOps(doc, dir = 1) {
  const ops = [{ t: 'doc', props: { width: doc.height, height: doc.width } }];
  for (const l of doc.layers) {
    if (l.type === 'group' || l.type === 'adjust') continue;
    const x = dir > 0 ? doc.height - l.y : l.y;
    const y = dir > 0 ? l.x : doc.width - l.x;
    ops.push({ t: 'set', id: l.id, props: { x, y, rotation: normalizeAngle(l.rotation + 90 * dir) } });
  }
  return ops;
}

/** Mirrors the whole canvas horizontally or vertically. */
export function flipCanvasOps(doc, axis = 'x') {
  const ops = [];
  for (const l of doc.layers) {
    if (l.type === 'group' || l.type === 'adjust') continue;
    if (axis === 'x') ops.push({ t: 'set', id: l.id, props: { x: doc.width - l.x, scaleX: -l.scaleX, rotation: normalizeAngle(-l.rotation) } });
    else ops.push({ t: 'set', id: l.id, props: { y: doc.height - l.y, scaleY: -l.scaleY, rotation: normalizeAngle(-l.rotation) } });
  }
  return ops;
}
