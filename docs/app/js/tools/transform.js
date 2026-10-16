// Move with transform handles (scale from any handle, rotate from the knob above, Shift keeps
// the ratio, Alt scales from the center), crop with ratio presets and straightening, the hand
// and the zoom tools.

import { handlePoints, hitTest, layerBounds, resizeByHandle, rotationFromDrag, cropOps, normalizeAngle, straightenScale } from '../../lib/geometry.js';
import { isLocked, subtree } from '../../lib/doc.js';

const HANDLE_PX = 7;

function transformable(app, l) {
  return l && !['group', 'adjust', 'fill'].includes(l.type);
}

export const move = {
  id: 'move',
  group: 'move',
  shortcut: 'v',
  icon: 'move',
  cursor: 'move',
  defaults: { autoSelect: true, showTransform: true },
  hitHandle(app, p) {
    const l = app.edoc.activeLayer;
    if (!transformable(app, l) || !app.opts('move').showTransform) return null;
    const size = app.renderer.size(l);
    const hp = handlePoints(l, size, 28 / app.vp.view.zoom);
    for (const [name, q] of Object.entries(hp)) {
      const s = app.vp.toScreen(q.x, q.y);
      const ps = app.vp.toScreen(p.x, p.y);
      if (Math.abs(s.x - ps.x) <= HANDLE_PX + 2 && Math.abs(s.y - ps.y) <= HANDLE_PX + 2) return name;
    }
    return null;
  },
  down(app, p) {
    const edoc = app.edoc;
    let l = edoc.activeLayer;
    const handle = this.hitHandle(app, p);
    if (!handle && app.opts('move').autoSelect) {
      const hit = app.layerAt(p.x, p.y);
      if (hit && hit.id !== l?.id) {
        app.selectLayer(hit.id);
        l = hit;
      }
    }
    if (!l) return;
    if (isLocked(edoc.doc, l.id)) {
      app.toast(app.t('toast.locked'), 'warning');
      return;
    }
    // a group moves with everything in it
    const ids = l.type === 'group' ? subtree(edoc.doc, l.id).filter((id) => transformable(app, edoc.layer(id))) : transformable(app, l) ? [l.id] : [];
    if (!ids.length) return;
    this.drag = { handle: handle ?? 'move', from: p, start: ids.map((id) => ({ ...edoc.layer(id) })), ids, size: app.renderer.size(l), lastShare: 0 };
    this.inverse = ids.map((id) => {
      const x = edoc.layer(id);
      return { t: 'set', id, props: { x: x.x, y: x.y, rotation: x.rotation, scaleX: x.scaleX, scaleY: x.scaleY } };
    });
  },
  move(app, p) {
    const d = this.drag;
    if (!d) return;
    const ops = [];
    if (d.handle === 'move') {
      let dx = p.x - d.from.x;
      let dy = p.y - d.from.y;
      if (p.shift) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
      const snapped = app.snap(d.start[0], d.size, dx, dy);
      for (const s of d.start) ops.push({ t: 'set', id: s.id, props: { x: s.x + snapped.dx, y: s.y + snapped.dy } });
    } else if (d.handle === 'rotate') {
      const s = d.start[0];
      ops.push({ t: 'set', id: s.id, props: { rotation: rotationFromDrag(s, d.from, p, p.shift) } });
    } else {
      const s = d.start[0];
      const keep = app.opts('move').keepRatio ?? true;
      const corner = d.handle.length === 2;
      const next = resizeByHandle(s, d.size, d.handle, p, { keepAspect: corner ? keep !== p.shift : p.shift, fromCenter: p.alt });
      ops.push({ t: 'set', id: s.id, props: next });
    }
    this.last = ops;
    app.edoc.apply(ops, 'local');
    // friends see the drag as it happens, a few times per second
    const now = performance.now();
    if (now - d.lastShare > 90) {
      d.lastShare = now;
      app.edoc.share(ops, []);
    }
    app.live?.cursor(p.x, p.y);
  },
  up(app) {
    const d = this.drag;
    this.drag = null;
    if (!d || !this.last) return;
    const label = app.t(d.handle === 'move' ? 'history.move' : d.handle === 'rotate' ? 'history.rotate' : 'history.scale');
    app.edoc.record(label, this.last, this.inverse, { icon: 'move' });
    this.last = null;
  },
  cancel(app) {
    if (this.drag && this.inverse) app.edoc.apply(this.inverse);
    this.drag = null;
    this.last = null;
  },
  key(app, e) {
    const l = app.edoc.activeLayer;
    if (!transformable(app, l) || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return false;
    const step = e.shiftKey ? 10 : 1;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    app.edoc.commit(app.t('history.nudge'), [{ t: 'set', id: l.id, props: { x: l.x + dx, y: l.y + dy } }], { merge: `nudge:${l.id}` });
    return true;
  },
  hover(app, p) {
    const h = this.hitHandle(app, p);
    const cursors = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', rotate: 'grab' };
    app.setCursor(h ? cursors[h] : 'move');
  },
  overlay(ctx, vp, app) {
    const l = app.edoc.activeLayer;
    if (!transformable(app, l) || !app.opts('move').showTransform || !l.visible) return;
    const size = app.renderer.size(l);
    const hp = handlePoints(l, size, 28 / vp.view.zoom);
    const corners = ['nw', 'ne', 'se', 'sw'].map((k) => vp.toScreen(hp[k].x, hp[k].y));
    ctx.save();
    ctx.strokeStyle = '#c08a4e';
    ctx.lineWidth = 1;
    ctx.beginPath();
    corners.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)));
    ctx.closePath();
    ctx.stroke();
    const top = vp.toScreen(hp.n.x, hp.n.y);
    const knob = vp.toScreen(hp.rotate.x, hp.rotate.y);
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(knob.x, knob.y);
    ctx.stroke();
    for (const [name, q] of Object.entries(hp)) {
      const s = vp.toScreen(q.x, q.y);
      ctx.fillStyle = name === 'rotate' ? '#c08a4e' : '#f3f1ec';
      ctx.strokeStyle = '#1a1a1d';
      ctx.beginPath();
      if (name === 'rotate') ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
      else ctx.rect(s.x - 4, s.y - 4, 8, 8);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  },
};

export const crop = {
  id: 'crop',
  group: 'crop',
  shortcut: 'c',
  icon: 'crop',
  cursor: 'crosshair',
  defaults: { ratio: 'free', straighten: 0 },
  activate(app) {
    const d = app.edoc.doc;
    this.rect = { x: 0, y: 0, w: d.width, h: d.height };
    this.angle = 0;
  },
  deactivate(app) {
    if (this.angle) this.setAngle(app, 0);
    this.base = null;
    this.rect = null;
  },
  hit(app, p) {
    const r = this.rect;
    if (!r) return null;
    const tol = 10 / app.vp.view.zoom;
    const nearX = Math.abs(p.x - r.x) < tol ? 'w' : Math.abs(p.x - (r.x + r.w)) < tol ? 'e' : '';
    const nearY = Math.abs(p.y - r.y) < tol ? 'n' : Math.abs(p.y - (r.y + r.h)) < tol ? 's' : '';
    if (nearX || nearY) return nearY + nearX;
    if (p.x > r.x && p.y > r.y && p.x < r.x + r.w && p.y < r.y + r.h) return 'move';
    return 'new';
  },
  down(app, p) {
    if (!this.rect) this.activate(app);
    this.drag = { kind: this.hit(app, p), from: p, start: { ...this.rect } };
  },
  move(app, p) {
    const d = this.drag;
    if (!d) return;
    let { x, y, w, h } = d.start;
    const dx = p.x - d.from.x;
    const dy = p.y - d.from.y;
    if (d.kind === 'move') {
      x += dx;
      y += dy;
    } else if (d.kind === 'new') {
      x = Math.min(d.from.x, p.x);
      y = Math.min(d.from.y, p.y);
      w = Math.abs(dx);
      h = Math.abs(dy);
    } else {
      if (d.kind.includes('w')) {
        x += dx;
        w -= dx;
      }
      if (d.kind.includes('e')) w += dx;
      if (d.kind.includes('n')) {
        y += dy;
        h -= dy;
      }
      if (d.kind.includes('s')) h += dy;
    }
    const ratio = app.opts('crop').ratio;
    if (ratio && ratio !== 'free' && d.kind !== 'move') {
      const [a, b] = ratio.split(':').map(Number);
      h = Math.abs(w) * (b / a) * Math.sign(h || 1);
    }
    if (w < 0) {
      x += w;
      w = -w;
    }
    if (h < 0) {
      y += h;
      h = -h;
    }
    this.rect = { x, y, w: Math.max(1, w), h: Math.max(1, h) };
    app.vp.needsOverlay = true;
    app.cropChanged?.(this.rect);
  },
  up() {
    this.drag = null;
  },
  /** Straightening rotates every layer around the canvas center and zooms to hide the corners. */
  setAngle(app, deg) {
    const edoc = app.edoc;
    const d = edoc.doc;
    if (!this.base) {
      this.base = d.layers.map((l) => ({ id: l.id, x: l.x, y: l.y, rotation: l.rotation, scaleX: l.scaleX, scaleY: l.scaleY, type: l.type }));
    }
    const cx = d.width / 2;
    const cy = d.height / 2;
    const a = (deg * Math.PI) / 180;
    const k = straightenScale(d.width, d.height, deg);
    const ops = [];
    for (const b of this.base) {
      if (['group', 'adjust', 'fill'].includes(b.type)) continue;
      const vx = (b.x - cx) * k;
      const vy = (b.y - cy) * k;
      ops.push({ t: 'set', id: b.id, props: { x: cx + vx * Math.cos(a) - vy * Math.sin(a), y: cy + vx * Math.sin(a) + vy * Math.cos(a), rotation: normalizeAngle(b.rotation + deg), scaleX: b.scaleX * k, scaleY: b.scaleY * k } });
    }
    edoc.apply(ops);
    this.angle = deg;
  },
  commit(app) {
    const edoc = app.edoc;
    const r = this.rect;
    if (!r) return;
    const ops = [];
    if (this.angle) {
      // record the straightening together with the crop, starting from the original layers
      for (const b of this.base) {
        const l = edoc.layer(b.id);
        if (l) ops.push({ t: 'set', id: b.id, props: { x: l.x, y: l.y, rotation: l.rotation, scaleX: l.scaleX, scaleY: l.scaleY } });
      }
      edoc.apply(this.base.filter((b) => edoc.layer(b.id)).map((b) => ({ t: 'set', id: b.id, props: { x: b.x, y: b.y, rotation: b.rotation, scaleX: b.scaleX, scaleY: b.scaleY } })));
    }
    const temp = JSON.parse(JSON.stringify(edoc.doc));
    // crop math runs on the straightened positions
    for (const op of ops) Object.assign(temp.layers.find((l) => l.id === op.id), op.props);
    const crop = cropOps(temp, r);
    // merge set ops per layer so history holds one entry
    const merged = new Map();
    for (const op of [...ops, ...crop]) {
      if (op.t !== 'set') continue;
      merged.set(op.id, { ...(merged.get(op.id) ?? {}), ...op.props });
    }
    const all = [crop[0], ...[...merged].map(([id, props]) => ({ t: 'set', id, props }))];
    this.angle = 0;
    this.base = null;
    edoc.commit(app.t('history.crop'), all, { icon: 'crop' });
    this.activate(app);
  },
  key(app, e) {
    if (e.key === 'Enter') {
      this.commit(app);
      return true;
    }
    if (e.key === 'Escape') {
      if (this.angle) this.setAngle(app, 0);
      this.base = null;
      this.activate(app);
      app.vp.needsOverlay = true;
      return true;
    }
    return false;
  },
  overlay(ctx, vp) {
    if (!this.rect) return;
    const a = vp.toScreen(this.rect.x, this.rect.y);
    const b = vp.toScreen(this.rect.x + this.rect.w, this.rect.y + this.rect.h);
    ctx.save();
    ctx.fillStyle = 'rgba(8,8,9,0.55)';
    ctx.beginPath();
    ctx.rect(0, 0, vp.w, vp.h);
    ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.fill('evenodd');
    ctx.strokeStyle = '#f3f1ec';
    ctx.lineWidth = 1;
    ctx.strokeRect(a.x + 0.5, a.y + 0.5, b.x - a.x, b.y - a.y);
    // rule of thirds
    ctx.strokeStyle = 'rgba(243,241,236,0.35)';
    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
      const x = a.x + ((b.x - a.x) * i) / 3;
      const y = a.y + ((b.y - a.y) * i) / 3;
      ctx.moveTo(x, a.y);
      ctx.lineTo(x, b.y);
      ctx.moveTo(a.x, y);
      ctx.lineTo(b.x, y);
    }
    ctx.stroke();
    ctx.fillStyle = '#f3f1ec';
    for (const [x, y] of [
      [a.x, a.y],
      [b.x, a.y],
      [a.x, b.y],
      [b.x, b.y],
      [(a.x + b.x) / 2, a.y],
      [(a.x + b.x) / 2, b.y],
      [a.x, (a.y + b.y) / 2],
      [b.x, (a.y + b.y) / 2],
    ])
      ctx.fillRect(x - 4, y - 4, 8, 8);
    ctx.restore();
  },
};

export const hand = { id: 'hand', group: 'nav', shortcut: 'h', icon: 'hand', cursor: 'grab', defaults: {} };
export const zoom = { id: 'zoom', group: 'nav', shortcut: 'z', icon: 'zoom', cursor: 'zoom-in', defaults: {} };

/** The topmost visible, hit layer under a point. */
export function layerAt(app, x, y) {
  const layers = app.edoc.doc.layers;
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (!app.renderer.shown(l.id) || ['group', 'adjust', 'fill'].includes(l.type)) continue;
    const size = app.renderer.size(l);
    if (!hitTest(l, size, { x, y })) continue;
    if (l.type === 'raster') {
      // only count opaque pixels
      const b = layerBounds(l, size);
      if (!b) continue;
      const a = app.alphaAt(l, x, y);
      if (a < 8) continue;
    }
    return l;
  }
  return null;
}
