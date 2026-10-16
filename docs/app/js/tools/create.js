// Tools that make things: text, shapes, the pen, gradients, the paint bucket, the patch tool
// and the eyedropper.

import { makeLayer, newId } from '../../lib/doc.js';
import { apply, invert, layerMatrix, hitTest } from '../../lib/geometry.js';
import { fillGradient } from '../../lib/brush.js';
import { floodSelect } from '../../lib/mask.js';
import { seamlessPatch } from '../../lib/filters/heal.js';
import { patchOp } from '../../lib/pixels.js';
import { fromHex, toHex } from '../../lib/color/convert.js';
import { hitAnchor, makePoint, moveAnchor, normalizePath, smoothHandle } from '../../lib/paths.js';

export const text = {
  id: 'text',
  group: 'text',
  shortcut: 't',
  icon: 'text',
  cursor: 'text',
  defaults: { font: 'Inter', size: 96, weight: 700, color: null, align: 'center', preset: null },
  down(app, p) {
    const hit = [...app.edoc.doc.layers].reverse().find((l) => l.type === 'text' && app.renderer.shown(l.id) && hitTest(l, app.renderer.size(l), p));
    if (hit) {
      app.selectLayer(hit.id);
      app.editText(hit.id);
      return;
    }
    const o = app.opts('text');
    const id = newId();
    const preset = app.textPreset(o.preset);
    const layer = makeLayer('text', { id, name: app.t('layer.text'), text: app.t('text.placeholder'), font: o.font, size: o.size, weight: o.weight, align: o.align, color: o.color ?? app.fg, x: p.x, y: p.y, ...preset });
    app.edoc.commit(app.t('history.addText'), [{ t: 'add', layer, index: app.insertIndex() }], { icon: 'text' });
    app.selectLayer(id);
    app.editText(id, true);
  },
};

export const shape = {
  id: 'shape',
  group: 'shape',
  shortcut: 'u',
  icon: 'shape',
  cursor: 'crosshair',
  defaults: { shape: 'rect', fillColor: null, stroke: null, strokeWidth: 0, radius: 0 },
  down(app, p) {
    this.start = p;
    this.rect = null;
  },
  move(app, p) {
    if (!this.start) return;
    let w = p.x - this.start.x;
    let h = p.y - this.start.y;
    if (p.shift) h = Math.sign(h || 1) * Math.abs(w);
    this.rect = { x: Math.min(this.start.x, this.start.x + w), y: Math.min(this.start.y, this.start.y + h), w: Math.abs(w), h: Math.abs(h) };
    const kind = app.opts('shape').shape;
    if (kind === 'line' || kind === 'arrow') this.line = { x0: this.start.x, y0: this.start.y, x1: p.x, y1: p.y };
    app.vp.needsOverlay = true;
  },
  up(app) {
    const o = app.opts('shape');
    const r = this.rect;
    const line = this.line;
    this.start = null;
    this.rect = null;
    this.line = null;
    if (!r || (r.w < 2 && r.h < 2)) return;
    const id = newId();
    let props;
    if (o.shape === 'line' || o.shape === 'arrow') {
      const len = Math.hypot(line.x1 - line.x0, line.y1 - line.y0);
      const angle = (Math.atan2(line.y1 - line.y0, line.x1 - line.x0) * 180) / Math.PI;
      props = { x: (line.x0 + line.x1) / 2, y: (line.y0 + line.y1) / 2, w: len, h: Math.max(8, (o.strokeWidth || 6) * 3), rotation: angle, stroke: o.stroke ?? app.fg, strokeWidth: o.strokeWidth || 6, fillColor: null };
    } else props = { x: r.x + r.w / 2, y: r.y + r.h / 2, w: Math.max(1, r.w), h: Math.max(1, r.h), fillColor: o.fillColor === 'none' ? null : o.fillColor ?? app.fg, stroke: o.stroke, strokeWidth: o.strokeWidth, radius: o.radius };
    const layer = makeLayer('shape', { id, name: app.t(`shape.${o.shape}`), shape: o.shape, ...props });
    app.edoc.commit(app.t('history.addShape'), [{ t: 'add', layer, index: app.insertIndex() }], { icon: 'shape' });
    app.selectLayer(id);
  },
  overlay(ctx, vp) {
    if (!this.rect) return;
    const a = vp.toScreen(this.rect.x, this.rect.y);
    const b = vp.toScreen(this.rect.x + this.rect.w, this.rect.y + this.rect.h);
    ctx.save();
    ctx.strokeStyle = '#c08a4e';
    ctx.setLineDash([4, 3]);
    if (this.line) {
      const s = vp.toScreen(this.line.x0, this.line.y0);
      const e = vp.toScreen(this.line.x1, this.line.y1);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(e.x, e.y);
      ctx.stroke();
    } else ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.restore();
  },
};

/** The pen: click for corners, drag for curves, click the first point to close, Enter ends. */
export const pen = {
  id: 'pen',
  group: 'pen',
  shortcut: 'p',
  icon: 'pen',
  cursor: 'crosshair',
  defaults: {},
  current(app) {
    const d = app.edoc.doc;
    return d.paths.find((p) => p.id === app.activePath) ?? null;
  },
  down(app, p) {
    const edoc = app.edoc;
    this.before = JSON.parse(JSON.stringify(edoc.doc.paths));
    let path = this.current(app);
    if (!path || this.done) {
      path = normalizePath({ id: newId('p'), name: `${app.t('path.name')} ${edoc.doc.paths.length + 1}`, points: [] });
      this.done = false;
      this.paths = [...edoc.doc.paths, path];
      app.activePath = path.id;
    } else this.paths = edoc.doc.paths.map((x) => ({ ...x, points: [...x.points] }));
    const cur = this.paths.find((x) => x.id === path.id);
    const hitI = hitAnchor(cur, p.x, p.y, 7 / app.vp.view.zoom);
    if (hitI === 0 && cur.points.length > 2) {
      cur.closed = true;
      this.done = true;
      this.commit(app, app.t('history.closePath'));
      return;
    }
    if (hitI >= 0 && p.alt) {
      // Alt click on an anchor turns it into a corner
      cur.points[hitI] = makePoint(cur.points[hitI].x, cur.points[hitI].y);
      this.commit(app, app.t('history.editPath'));
      return;
    }
    if (hitI >= 0) {
      this.drag = { kind: 'anchor', i: hitI, from: p };
      return;
    }
    cur.points.push(makePoint(p.x, p.y));
    this.drag = { kind: 'handle', i: cur.points.length - 1 };
  },
  move(app, p) {
    if (!this.drag) return;
    const cur = this.paths.find((x) => x.id === app.activePath);
    const pt = cur.points[this.drag.i];
    if (this.drag.kind === 'handle') cur.points[this.drag.i] = smoothHandle(pt, p.x, p.y);
    else {
      cur.points[this.drag.i] = moveAnchor(pt, p.x - this.drag.from.x, p.y - this.drag.from.y);
      this.drag.from = p;
    }
    app.edoc.apply([{ t: 'doc', props: { paths: this.paths } }]);
    app.vp.needsOverlay = true;
  },
  up(app) {
    if (!this.drag) return;
    this.drag = null;
    this.commit(app, app.t('history.editPath'));
  },
  commit(app, label) {
    // the drag showed the change already; put the old paths back so undo records the step
    if (this.before) app.edoc.apply([{ t: 'doc', props: { paths: this.before } }]);
    app.edoc.commit(label, [{ t: 'doc', props: { paths: this.paths } }], { merge: `path:${app.activePath}`, icon: 'pen' });
    app.refreshPaths?.();
  },
  key(app, e) {
    if (e.key === 'Enter' || e.key === 'Escape') {
      this.done = true;
      app.vp.needsOverlay = true;
      return true;
    }
    return false;
  },
  overlay(ctx, vp, app) {
    for (const path of app.edoc.doc.paths) {
      const active = path.id === app.activePath;
      if (!active && !app.showAllPaths) continue;
      ctx.save();
      ctx.strokeStyle = active ? '#4fb3c9' : 'rgba(79,179,201,0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      path.points.forEach((q, i) => {
        const s = vp.toScreen(q.x, q.y);
        if (!i) ctx.moveTo(s.x, s.y);
        else {
          const a = path.points[i - 1];
          const o = vp.toScreen(a.ox, a.oy);
          const n = vp.toScreen(q.ix, q.iy);
          ctx.bezierCurveTo(o.x, o.y, n.x, n.y, s.x, s.y);
        }
      });
      if (path.closed && path.points.length > 2) {
        const a = path.points.at(-1);
        const q = path.points[0];
        const o = vp.toScreen(a.ox, a.oy);
        const n = vp.toScreen(q.ix, q.iy);
        const s = vp.toScreen(q.x, q.y);
        ctx.bezierCurveTo(o.x, o.y, n.x, n.y, s.x, s.y);
      }
      ctx.stroke();
      if (active)
        for (const q of path.points) {
          const s = vp.toScreen(q.x, q.y);
          for (const [hx, hy] of [
            [q.ix, q.iy],
            [q.ox, q.oy],
          ]) {
            if (hx === q.x && hy === q.y) continue;
            const h = vp.toScreen(hx, hy);
            ctx.beginPath();
            ctx.moveTo(s.x, s.y);
            ctx.lineTo(h.x, h.y);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(h.x, h.y, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#4fb3c9';
            ctx.fill();
          }
          ctx.fillStyle = '#f3f1ec';
          ctx.fillRect(s.x - 3.5, s.y - 3.5, 7, 7);
          ctx.strokeRect(s.x - 3.5, s.y - 3.5, 7, 7);
        }
      ctx.restore();
    }
  },
};

export const gradient = {
  id: 'gradient',
  group: 'fill',
  shortcut: 'g',
  icon: 'gradient',
  cursor: 'crosshair',
  defaults: { type: 'linear', colors: 'fg-bg', reverse: false, opacity: 1 },
  down(app, p) {
    this.line = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
  },
  move(app, p) {
    if (!this.line) return;
    this.line.x1 = p.x;
    this.line.y1 = p.y;
    if (p.shift) {
      const a = Math.round(Math.atan2(p.y - this.line.y0, p.x - this.line.x0) / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(p.x - this.line.x0, p.y - this.line.y0);
      this.line.x1 = this.line.x0 + Math.cos(a) * len;
      this.line.y1 = this.line.y0 + Math.sin(a) * len;
    }
    app.vp.needsOverlay = true;
  },
  up(app) {
    const L = this.line;
    this.line = null;
    if (!L || Math.hypot(L.x1 - L.x0, L.y1 - L.y0) < 2) return;
    const o = app.opts('gradient');
    const target = app.paintTarget('gradient', { createDocSize: true });
    if (!target) return;
    const m = invert(layerMatrix(target.layer, target.size));
    const a = target.mask && target.layer.mask.space === 'doc' ? { x: L.x0, y: L.y0 } : apply(m, { x: L.x0, y: L.y0 });
    const b = target.mask && target.layer.mask.space === 'doc' ? { x: L.x1, y: L.y1 } : apply(m, { x: L.x1, y: L.y1 });
    const fg = fromHex(app.fg);
    const bg = fromHex(app.bg);
    const stops = o.colors === 'fg-transparent' ? [{ at: 0, c: fg }, { at: 1, c: [...fg.slice(0, 3), 0] }] : [{ at: 0, c: fg }, { at: 1, c: bg }];
    const asset = app.edoc.assets.get(target.asset);
    const before = app.edoc.assets.read(target.asset);
    const buf = new Uint8ClampedArray(before);
    const selection = app.edoc.selection.empty ? null : app.selectionInLayer(target, { x: 0, y: 0, w: asset.w, h: asset.h });
    fillGradient(buf, asset.w, asset.h, { type: o.type, x0: a.x, y0: a.y, x1: b.x, y1: b.y, stops, opacity: o.opacity, selection, reverse: o.reverse });
    const rect = { x: 0, y: 0, w: asset.w, h: asset.h };
    app.edoc.commit(app.t('tool.gradient'), [patchOp(target.asset, rect, buf)], { icon: 'gradient' });
  },
  overlay(ctx, vp) {
    if (!this.line) return;
    const a = vp.toScreen(this.line.x0, this.line.y0);
    const b = vp.toScreen(this.line.x1, this.line.y1);
    ctx.save();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.fillStyle = '#c08a4e';
    for (const q of [a, b]) {
      ctx.beginPath();
      ctx.arc(q.x, q.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  },
};

export const bucket = {
  id: 'bucket',
  group: 'fill',
  shortcut: 'g',
  icon: 'bucket',
  cursor: 'crosshair',
  defaults: { tolerance: 32, contiguous: true, source: 'fg', pattern: 'grain', sampleAll: false },
  async down(app, p) {
    const o = app.opts('bucket');
    const target = app.paintTarget('bucket', { createDocSize: true });
    if (!target) return;
    const asset = app.edoc.assets.get(target.asset);
    const before = app.edoc.assets.read(target.asset);
    const local = target.mask && target.layer.mask.space === 'doc' ? p : apply(invert(layerMatrix(target.layer, target.size)), p);
    let region;
    if (o.sampleAll) {
      // flood the composite, then map the result into the layer
      const px = await app.samplePixels(true);
      const docMask = floodSelect(px.data, px.width, px.height, p.x, p.y, o.tolerance, o.contiguous);
      region = app.docMaskInLayer(target, docMask, { x: 0, y: 0, w: asset.w, h: asset.h });
    } else region = floodSelect(before, asset.w, asset.h, local.x, local.y, o.tolerance, o.contiguous);
    if (!app.edoc.selection.empty) {
      const sel = app.selectionInLayer(target, { x: 0, y: 0, w: asset.w, h: asset.h });
      for (let i = 0; i < region.length; i++) region[i] = Math.min(region[i], sel[i]);
    }
    const buf = new Uint8ClampedArray(before);
    let pattern = null;
    if (o.source === 'pattern') pattern = app.patternPixels(o.pattern);
    const fg = fromHex(app.fg);
    for (let y = 0; y < asset.h; y++) {
      for (let x = 0; x < asset.w; x++) {
        const k = y * asset.w + x;
        const a = region[k] / 255;
        if (!a) continue;
        const c = pattern ? pattern.at(x, y) : fg;
        const i = k * 4;
        for (let ch = 0; ch < 3; ch++) buf[i + ch] = buf[i + ch] * (1 - a) + c[ch] * a;
        buf[i + 3] = Math.max(buf[i + 3], 255 * a);
      }
    }
    app.edoc.commit(app.t('tool.bucket'), [patchOp(target.asset, { x: 0, y: 0, w: asset.w, h: asset.h }, buf)], { icon: 'bucket' });
  },
};

export const eyedropper = {
  id: 'eyedropper',
  group: 'eyedropper',
  shortcut: 'i',
  icon: 'eyedropper',
  cursor: 'crosshair',
  defaults: { sample: 1, layers: 'all' },
  async down(app, p) {
    await this.pick(app, p);
  },
  async move(app, p) {
    await this.pick(app, p);
  },
  async pick(app, p) {
    const c = await app.colorAt(p.x, p.y, app.opts('eyedropper').sample);
    if (!c) return;
    app.setColor(p.alt ? 'bg' : 'fg', toHex(c[0], c[1], c[2]));
  },
};

/** Patch: select an area (with any selection tool), then drag it onto good pixels. */
export const patch = {
  id: 'patch',
  group: 'heal',
  shortcut: 'j',
  icon: 'patch',
  cursor: 'default',
  defaults: {},
  down(app, p) {
    const sel = app.edoc.selection;
    if (sel.empty) {
      // draw the patch area like a lasso
      this.points = [[p.x, p.y]];
      return;
    }
    if (sel.at(p.x, p.y) < 128) {
      app.edoc.commit(app.t('history.deselect'), [{ t: 'sel', data: null }]);
      this.points = [[p.x, p.y]];
      return;
    }
    this.drag = { from: p, to: p };
  },
  move(app, p) {
    if (this.points) this.points.push([p.x, p.y]);
    if (this.drag) this.drag.to = p;
    app.vp.needsOverlay = true;
  },
  up(app) {
    if (this.points) {
      const pts = this.points;
      this.points = null;
      if (pts.length > 2) app.edoc.commit(app.t('tool.lasso'), [{ t: 'sel', data: app.edoc.selection.polygon(pts) }]);
      return;
    }
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const dx = d.to.x - d.from.x;
    const dy = d.to.y - d.from.y;
    if (Math.hypot(dx, dy) < 1) return;
    const target = app.paintTarget('patch');
    if (!target || target.mask) return;
    const asset = app.edoc.assets.get(target.asset);
    const all = app.edoc.assets.read(target.asset);
    const region = { x: 0, y: 0, w: asset.w, h: asset.h };
    const mask = app.selectionInLayer(target, region);
    // the offset in layer pixels
    const m = invert(layerMatrix(target.layer, target.size));
    const a = apply(m, d.from);
    const b = apply(m, d.to);
    const ox = Math.round(b.x - a.x);
    const oy = Math.round(b.y - a.y);
    const source = new Uint8ClampedArray(all.length);
    for (let y = 0; y < asset.h; y++) {
      for (let x = 0; x < asset.w; x++) {
        const sx = Math.min(asset.w - 1, Math.max(0, x + ox));
        const sy = Math.min(asset.h - 1, Math.max(0, y + oy));
        const i = (y * asset.w + x) * 4;
        const j = (sy * asset.w + sx) * 4;
        source[i] = all[j];
        source[i + 1] = all[j + 1];
        source[i + 2] = all[j + 2];
        source[i + 3] = all[j + 3];
      }
    }
    const out = seamlessPatch(all, source, asset.w, asset.h, mask);
    app.edoc.commit(app.t('tool.patch'), [patchOp(target.asset, region, out)], { icon: 'patch' });
  },
  overlay(ctx, vp) {
    if (this.points) {
      ctx.save();
      ctx.strokeStyle = '#fff';
      ctx.beginPath();
      this.points.forEach(([x, y], i) => {
        const s = vp.toScreen(x, y);
        if (i) ctx.lineTo(s.x, s.y);
        else ctx.moveTo(s.x, s.y);
      });
      ctx.stroke();
      ctx.restore();
    }
    if (this.drag) {
      const a = vp.toScreen(this.drag.from.x, this.drag.from.y);
      const b = vp.toScreen(this.drag.to.x, this.drag.to.y);
      ctx.save();
      ctx.strokeStyle = '#c08a4e';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();
    }
  },
};

export const CREATE_TOOLS = [text, shape, pen, gradient, bucket, eyedropper, patch];
