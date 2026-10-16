// Selection tools: rectangle and ellipse marquee, lasso, polygonal lasso, magic wand and quick
// select (a brush that grows the selection along the subject the cutout model finds, or along
// similar colors). Shift adds, Alt subtracts, Shift and Alt intersect, like the options bar.

import { connectedRegion, floodSelect } from '../../lib/mask.js';

function modeFor(app, id, p) {
  if (p.shift && p.alt) return 'intersect';
  if (p.shift) return 'add';
  if (p.alt) return 'subtract';
  return app.opts(id).mode ?? 'replace';
}

function commitSelection(app, label, mask) {
  const feather = app.opts(app.toolId).feather ?? 0;
  let m = mask;
  if (feather > 0 && m) {
    const sel = app.edoc.selection;
    const old = sel.mask;
    sel.mask = m;
    m = sel.feather(feather);
    sel.mask = old;
  }
  app.edoc.commit(label, [{ t: 'sel', data: m }], { icon: 'marquee' });
}

function marquee(id, shape) {
  return {
    id,
    group: 'marquee',
    shortcut: 'm',
    icon: shape === 'rect' ? 'marquee' : 'marquee-ellipse',
    cursor: 'crosshair',
    defaults: { mode: 'replace', feather: 0, ratio: 'free' },
    down(app, p) {
      // a click inside an existing selection with no modifier moves the outline
      this.start = { x: p.x, y: p.y };
      this.rect = null;
      this.mode = modeFor(app, id, p);
    },
    move(app, p) {
      if (!this.start) return;
      let w = p.x - this.start.x;
      let h = p.y - this.start.y;
      const ratio = app.opts(id).ratio;
      if (p.shift && !p.alt) h = Math.sign(h || 1) * Math.abs(w);
      else if (ratio && ratio !== 'free') {
        const [a, b] = ratio.split(':').map(Number);
        h = Math.sign(h || 1) * Math.abs(w) * (b / a);
      }
      let x = this.start.x;
      let y = this.start.y;
      if (p.alt && !p.shift) {
        x -= w;
        y -= h;
        w *= 2;
        h *= 2;
      }
      this.rect = { x: Math.min(x, x + w), y: Math.min(y, y + h), w: Math.abs(w), h: Math.abs(h) };
      app.vp.needsOverlay = true;
    },
    up(app) {
      const r = this.rect;
      this.start = null;
      this.rect = null;
      const sel = app.edoc.selection;
      if (!r || r.w < 1 || r.h < 1) {
        if (!sel.empty && this.mode === 'replace') app.edoc.commit(app.t('history.deselect'), [{ t: 'sel', data: null }]);
        return;
      }
      const m = shape === 'rect' ? sel.rect(r.x, r.y, r.w, r.h) : sel.ellipse(r.x, r.y, r.w, r.h);
      commitSelection(app, app.t(`tool.${id}`), sel.combine(m, this.mode));
    },
    cancel() {
      this.start = null;
      this.rect = null;
    },
    overlay(ctx, vp) {
      if (!this.rect) return;
      const a = vp.toScreen(this.rect.x, this.rect.y);
      const b = vp.toScreen(this.rect.x + this.rect.w, this.rect.y + this.rect.h);
      ctx.save();
      ctx.strokeStyle = '#fff';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      if (shape === 'rect') ctx.rect(a.x + 0.5, a.y + 0.5, b.x - a.x, b.y - a.y);
      else ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#000';
      ctx.lineDashOffset = 4;
      ctx.stroke();
      ctx.restore();
    },
  };
}

const lasso = {
  id: 'lasso',
  group: 'lasso',
  shortcut: 'l',
  icon: 'lasso',
  cursor: 'crosshair',
  defaults: { mode: 'replace', feather: 0 },
  down(app, p) {
    this.points = [[p.x, p.y]];
    this.mode = modeFor(app, 'lasso', p);
  },
  move(app, p) {
    if (!this.points) return;
    const last = this.points[this.points.length - 1];
    if (Math.hypot(p.x - last[0], p.y - last[1]) * app.vp.view.zoom > 2) this.points.push([p.x, p.y]);
    app.vp.needsOverlay = true;
  },
  up(app) {
    const pts = this.points;
    this.points = null;
    if (!pts || pts.length < 3) return;
    const sel = app.edoc.selection;
    commitSelection(app, app.t('tool.lasso'), sel.combine(sel.polygon(pts), this.mode));
  },
  cancel() {
    this.points = null;
  },
  overlay(ctx, vp) {
    drawPolyline(ctx, vp, this.points, false);
  },
};

const polyLasso = {
  id: 'lasso-poly',
  group: 'lasso',
  shortcut: 'l',
  icon: 'lasso-poly',
  cursor: 'crosshair',
  defaults: { mode: 'replace', feather: 0 },
  down(app, p) {
    if (!this.points) {
      this.points = [[p.x, p.y]];
      this.mode = modeFor(app, 'lasso-poly', p);
      return;
    }
    const first = this.points[0];
    const close = Math.hypot(p.x - first[0], p.y - first[1]) * app.vp.view.zoom < 8;
    const dbl = p.event?.detail >= 2;
    if (close || dbl) this.finish(app);
    else this.points.push([p.x, p.y]);
  },
  hover(app, p) {
    this.hoverAt = [p.x, p.y];
    app.vp.needsOverlay = true;
  },
  key(app, e) {
    if (!this.points) return false;
    if (e.key === 'Enter') {
      this.finish(app);
      return true;
    }
    if (e.key === 'Escape') {
      this.points = null;
      return true;
    }
    if (e.key === 'Backspace') {
      this.points.pop();
      if (!this.points.length) this.points = null;
      return true;
    }
    return false;
  },
  finish(app) {
    const pts = this.points;
    this.points = null;
    if (!pts || pts.length < 3) return;
    const sel = app.edoc.selection;
    commitSelection(app, app.t('tool.lasso-poly'), sel.combine(sel.polygon(pts), this.mode));
  },
  cancel() {
    this.points = null;
  },
  overlay(ctx, vp) {
    if (!this.points) return;
    drawPolyline(ctx, vp, this.hoverAt ? [...this.points, this.hoverAt] : this.points, false);
  },
};

function drawPolyline(ctx, vp, pts, closed) {
  if (!pts?.length) return;
  ctx.save();
  ctx.beginPath();
  pts.forEach(([x, y], i) => {
    const s = vp.toScreen(x, y);
    if (i) ctx.lineTo(s.x, s.y);
    else ctx.moveTo(s.x, s.y);
  });
  if (closed) ctx.closePath();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.strokeStyle = '#000';
  ctx.setLineDash([3, 3]);
  ctx.stroke();
  ctx.restore();
}

const wand = {
  id: 'wand',
  group: 'select',
  shortcut: 'w',
  icon: 'wand',
  cursor: 'crosshair',
  defaults: { mode: 'replace', tolerance: 32, contiguous: true, sampleAll: true },
  async down(app, p) {
    const o = app.opts('wand');
    const { data, width, height } = await app.samplePixels(o.sampleAll);
    const m = floodSelect(data, width, height, p.x, p.y, o.tolerance, o.contiguous);
    const sel = app.edoc.selection;
    commitSelection(app, app.t('tool.wand'), sel.combine(m, modeFor(app, 'wand', p)));
  },
};

/**
 * Quick select: drag over the subject. The first stroke runs the cutout model once on the
 * whole picture; each dab adds the part of the subject under it (or, away from the subject,
 * the area of similar color).
 */
const quick = {
  id: 'quick-select',
  group: 'select',
  shortcut: 'w',
  icon: 'quick-select',
  cursor: 'brush', // the viewport draws the outline at the brush size
  defaults: { size: 40, mode: 'add', tolerance: 28 },
  async down(app, p) {
    this.mode = p.alt ? 'subtract' : 'add';
    this.active = true;
    this.startMask = app.edoc.selection.mask;
    this.pending = [[p.x, p.y]];
    if (!this.subject || this.subjectRev !== app.edoc.revision) {
      app.status(app.t('status.findingSubject'));
      try {
        this.subject = await app.subjectMask();
        this.subjectRev = app.edoc.revision;
      } catch (err) {
        this.subject = null;
        app.toast(app.modelError?.(err) ?? String(err?.message ?? err), 'warning');
      }
      app.status('');
    }
    this.dab(app);
  },
  move(app, p) {
    if (!this.active) return;
    this.pending.push([p.x, p.y]);
    app.vp.needsOverlay = true;
    if (!this.timer) this.timer = setTimeout(() => this.dab(app), 60);
  },
  async dab(app) {
    this.timer = null;
    const pts = this.pending;
    this.pending = [];
    if (!pts.length) return;
    const sel = app.edoc.selection;
    const w = sel.w;
    const h = sel.h;
    let m = sel.mask ? new Uint8Array(sel.mask) : new Uint8Array(w * h);
    const r = app.opts('quick-select').size / 2;
    for (const [x, y] of pts) {
      let region = null;
      if (this.subject && this.subject[Math.floor(y) * w + Math.floor(x)] >= 128) region = connectedRegion(this.subject, w, h, x, y);
      else {
        const px = await app.samplePixels(true);
        region = floodSelect(px.data, px.width, px.height, x, y, app.opts('quick-select').tolerance, true);
      }
      // also everything under the brush itself
      const brush = sel.ellipse(x - r, y - r, r * 2, r * 2);
      for (let i = 0; i < m.length; i++) {
        const v = Math.max(region[i], brush[i]);
        m[i] = this.mode === 'add' ? Math.max(m[i], v) : Math.max(0, m[i] - v);
      }
    }
    sel.set(m);
    app.edoc.emit('selection', sel);
    app.vp.needsOverlay = true;
  },
  async up(app) {
    this.active = false;
    clearTimeout(this.timer);
    await this.dab(app);
    const sel = app.edoc.selection;
    const mask = sel.mask;
    // record it as one undoable step: restore the starting selection first
    sel.set(this.startMask);
    app.edoc.commit(app.t('tool.quick-select'), [{ t: 'sel', data: mask }]);
  },
};

export const SELECT_TOOLS = [marquee('marquee', 'rect'), marquee('marquee-ellipse', 'ellipse'), lasso, polyLasso, quick, wand];
