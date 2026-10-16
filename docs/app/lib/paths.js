// Generated from src/paths.js by scripts/build-app.mjs. Edit the source, not this copy.
// Pen paths: anchor points with Bezier handles, open or closed. Used by the pen tool, the
// Paths panel, "make selection from path", "fill path" and "stroke path".
// A point: { x, y, ix, iy, ox, oy } with in and out handles in document pixels (a corner point
// has its handles on the anchor).

export function makePoint(x, y, ox = x, oy = y) {
  return { x, y, ix: 2 * x - ox, iy: 2 * y - oy, ox, oy };
}

export function normalizePath(p) {
  const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    id: typeof p?.id === 'string' ? p.id.slice(0, 40) : `p${Math.random().toString(36).slice(2, 9)}`,
    name: typeof p?.name === 'string' ? p.name.slice(0, 80) : 'Path',
    closed: p?.closed === true,
    points: (Array.isArray(p?.points) ? p.points.slice(0, 5000) : []).map((q) => {
      const x = num(q.x);
      const y = num(q.y);
      return { x, y, ix: num(q.ix, x), iy: num(q.iy, y), ox: num(q.ox, x), oy: num(q.oy, y) };
    }),
  };
}

function cubic(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/** Each segment as [a, b] (a's out handle, b's in handle). */
export function segments(path) {
  const pts = path.points;
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) out.push([pts[i], pts[i + 1]]);
  if (path.closed && pts.length > 2) out.push([pts[pts.length - 1], pts[0]]);
  return out;
}

/** Flattens the path to a polygon, with at most `tolerance` pixels of error. */
export function flatten(path, tolerance = 0.5) {
  const pts = path.points;
  if (!pts.length) return [];
  const out = [[pts[0].x, pts[0].y]];
  for (const [a, b] of segments(path)) {
    const straight = a.ox === a.x && a.oy === a.y && b.ix === b.x && b.iy === b.y;
    if (straight) {
      out.push([b.x, b.y]);
      continue;
    }
    const len = Math.hypot(a.ox - a.x, a.oy - a.y) + Math.hypot(b.ix - a.ox, b.iy - a.oy) + Math.hypot(b.x - b.ix, b.y - b.iy);
    const n = Math.max(2, Math.min(256, Math.ceil(Math.sqrt(len / Math.max(0.05, tolerance)) * 1.5)));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push([cubic(a.x, a.ox, b.ix, b.x, t), cubic(a.y, a.oy, b.iy, b.y, t)]);
    }
  }
  return out;
}

export function svgPathData(path) {
  const pts = path.points;
  if (!pts.length) return '';
  let d = `M${pts[0].x} ${pts[0].y}`;
  for (const [a, b] of segments(path)) d += `C${a.ox} ${a.oy} ${b.ix} ${b.iy} ${b.x} ${b.y}`;
  if (path.closed) d += 'Z';
  return d;
}

export function bounds(polygon) {
  if (!polygon.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of polygon) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Even odd point in polygon test. */
export function inside(polygon, x, y) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Rasterizes a closed polygon to a one byte mask with 4x4 supersampling on the edges. */
export function polygonMask(polygon, w, h) {
  const mask = new Uint8Array(w * h);
  const b = bounds(polygon);
  if (!b) return mask;
  const x0 = Math.max(0, Math.floor(b.x));
  const y0 = Math.max(0, Math.floor(b.y));
  const x1 = Math.min(w - 1, Math.ceil(b.x + b.w));
  const y1 = Math.min(h - 1, Math.ceil(b.y + b.h));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let n = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) if (inside(polygon, x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) n++;
      mask[y * w + x] = Math.round((n / 16) * 255);
    }
  }
  return mask;
}

/** Index of the anchor near (x, y) within radius, or -1. */
export function hitAnchor(path, x, y, radius = 6) {
  let best = -1;
  let bd = radius * radius;
  path.points.forEach((p, i) => {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d <= bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/** Moves an anchor with its handles. */
export function moveAnchor(p, dx, dy) {
  return { x: p.x + dx, y: p.y + dy, ix: p.ix + dx, iy: p.iy + dy, ox: p.ox + dx, oy: p.oy + dy };
}

/** Sets the out handle and mirrors the in handle (a smooth point). */
export function smoothHandle(p, ox, oy) {
  return { ...p, ox, oy, ix: 2 * p.x - ox, iy: 2 * p.y - oy };
}
