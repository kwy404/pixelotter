// Brush based tools: brush, pencil, eraser, mask painting, dodge, burn, sponge, blur, sharpen,
// smudge, clone stamp, healing brush and spot healing. They paint into a working copy of the
// target layer's pixels, show every dab at once, and record one patch operation when the
// stroke ends (so undo, autosave and friends in a live session get exactly what changed).

import { Stroke, brushTip, dabPositions } from '../../lib/brush.js';
import { seamlessPatch } from '../../lib/filters/heal.js';
import { contentAwareFill } from '../../lib/filters/inpaint.js';
import { patchOp } from '../../lib/pixels.js';
import { apply, invert, layerMatrix } from '../../lib/geometry.js';
import { fromHex } from '../../lib/color/convert.js';

const MARGIN = 192;

/** A working region of the target asset that grows as the stroke wanders. */
class Work {
  constructor(app, target, opts) {
    this.app = app;
    this.target = target; // { layer, asset, size, mask }
    this.opts = opts;
    this.stroke = null;
    this.matrix = layerMatrix(target.layer, target.size);
    this.inverse = invert(this.matrix);
  }

  toLayer(p) {
    return this.target.mask && this.target.layer.mask.space === 'doc' ? { x: p.x, y: p.y } : apply(this.inverse, p);
  }

  /** Makes sure the region covers a rectangle of layer pixels. */
  cover(x0, y0, x1, y1) {
    const a = this.app.edoc.assets.get(this.target.asset);
    const want = {
      x: Math.max(0, Math.floor(x0 - MARGIN)),
      y: Math.max(0, Math.floor(y0 - MARGIN)),
    };
    want.w = Math.min(a.w, Math.ceil(x1 + MARGIN)) - want.x;
    want.h = Math.min(a.h, Math.ceil(y1 + MARGIN)) - want.y;
    if (want.w <= 0 || want.h <= 0) return false;
    const s = this.stroke;
    if (s) {
      const r = s.region;
      if (x0 >= r.x && y0 >= r.y && x1 <= r.x + r.w && y1 <= r.y + r.h) return true;
      // grow: union of the old and the wanted region
      const nx = Math.min(r.x, want.x);
      const ny = Math.min(r.y, want.y);
      want.w = Math.max(r.x + r.w, want.x + want.w) - nx;
      want.h = Math.max(r.y + r.h, want.y + want.h) - ny;
      want.x = nx;
      want.y = ny;
    }
    const original = new Uint8ClampedArray(this.app.edoc.assets.read(this.target.asset, want));
    const next = this.makeStroke(want, original);
    if (s) {
      // keep what the stroke already did and the true originals under it
      const r = s.region;
      for (let y = 0; y < r.h; y++) {
        const from = y * r.w * 4;
        const to = ((r.y - want.y + y) * want.w + (r.x - want.x)) * 4;
        next.original.set(s.original.subarray(from, from + r.w * 4), to);
        next.buf.set(s.buf.subarray(from, from + r.w * 4), to);
        if (s.cover) next.cover.set(s.cover.subarray(y * r.w, (y + 1) * r.w), (r.y - want.y + y) * want.w + (r.x - want.x));
      }
      if (s.dirty) next.dirty = { x0: s.dirty.x0 + r.x - want.x, y0: s.dirty.y0 + r.y - want.y, x1: s.dirty.x1 + r.x - want.x, y1: s.dirty.y1 + r.y - want.y };
      next.smudgeColor = s.smudgeColor;
    }
    this.stroke = next;
    return true;
  }

  makeStroke(region, original) {
    const o = this.opts;
    const app = this.app;
    const selection = app.edoc.selection.empty ? null : this.selectionPlane(region);
    return new Stroke({ region, original, mode: o.mode, color: o.color, opacity: o.opacity, flow: o.flow, tip: o.tip, selection, lockAlpha: o.lockAlpha, options: o.options });
  }

  /** The document selection sampled at each layer pixel of the region. */
  selectionPlane(region) {
    const sel = this.app.edoc.selection;
    const plane = new Uint8Array(region.w * region.h);
    const docSpace = this.target.mask && this.target.layer.mask.space === 'doc';
    for (let y = 0; y < region.h; y++) {
      for (let x = 0; x < region.w; x++) {
        const p = docSpace ? { x: region.x + x + 0.5, y: region.y + y + 0.5 } : apply(this.matrix, { x: region.x + x + 0.5, y: region.y + y + 0.5 });
        plane[y * region.w + x] = sel.at(p.x, p.y);
      }
    }
    return plane;
  }

  /** Writes the changed pixels into the asset so they show at once. */
  flush(r) {
    if (!r) return;
    const s = this.stroke;
    const a = this.app.edoc.assets.get(this.target.asset);
    const w = r.x1 - r.x0;
    const h = r.y1 - r.y0;
    if (w <= 0 || h <= 0) return;
    const img = new ImageData(w, h);
    for (let y = 0; y < h; y++) {
      const from = ((r.y0 + y) * s.region.w + r.x0) * 4;
      img.data.set(s.buf.subarray(from, from + w * 4), y * w * 4);
    }
    a.ctx.putImageData(img, s.region.x + r.x0, s.region.y + r.y0);
    a.version++;
    this.app.invalidateLayerRect(this.target, { x: s.region.x + r.x0, y: s.region.y + r.y0, w, h });
  }
}

const MODE = {
  brush: 'paint',
  pencil: 'paint',
  eraser: 'erase',
  dodge: 'dodge',
  burn: 'burn',
  sponge: 'sponge',
  blur: 'blur',
  sharpen: 'sharpen',
  smudge: 'smudge',
  clone: 'clone',
  heal: 'clone',
  'spot-heal': 'paint',
};

function makePaintTool(id, { group, key, icon, defaults }) {
  return {
    id,
    group,
    key,
    icon,
    cursor: 'none',
    defaults: { size: 40, hardness: 0.8, opacity: 1, flow: 1, spacing: 0.15, ...defaults },
    down(app, p) {
      const o = app.opts(id);
      if (id === 'clone' || id === 'heal') {
        if (p.alt) {
          app.cloneSource = { x: p.x, y: p.y, layer: app.edoc.active };
          app.toast(app.t('toast.cloneSource'));
          return;
        }
        if (!app.cloneSource) {
          app.toast(app.t('toast.needCloneSource'), 'warning');
          return;
        }
      }
      const target = app.paintTarget(id);
      if (!target) return;
      let mode = MODE[id];
      let color = fromHex(app.fg).slice(0, 3);
      if (target.mask) {
        mode = id === 'eraser' || p.alt ? 'mask-hide' : 'mask-reveal';
        // painting on a mask: black hides, white reveals
        if (id === 'brush' || id === 'pencil') mode = (fromHex(app.fg)[0] + fromHex(app.fg)[1] + fromHex(app.fg)[2]) / 3 < 128 ? 'mask-hide' : 'mask-reveal';
      }
      if (id === 'spot-heal') color = [255, 0, 255];
      const scale = Math.max(Math.abs(target.layer.scaleX), Math.abs(target.layer.scaleY)) || 1;
      const diameter = id === 'pencil' ? Math.max(1, Math.round(o.size / scale)) : o.size / scale;
      const tip = brushTip(diameter, id === 'pencil' ? 1 : o.hardness);
      const options = { range: o.range, exposure: o.exposure, saturate: o.saturate !== 'desaturate', strength: o.strength };
      if (id === 'clone' || id === 'heal') {
        const a = app.edoc.assets.get(target.asset);
        const src = app.edoc.assets.read(target.asset);
        const work0 = new Work(app, target, {});
        const from = work0.toLayer(app.cloneSource);
        const to = work0.toLayer(p);
        options.source = { data: src, width: a.w, height: a.h, dx: from.x - to.x, dy: from.y - to.y };
        if (o.aligned && app.cloneOffset) options.source.dx = app.cloneOffset.dx;
        if (o.aligned && app.cloneOffset) options.source.dy = app.cloneOffset.dy;
        app.cloneOffset = { dx: options.source.dx, dy: options.source.dy };
      }
      this.work = new Work(app, target, { mode, color, opacity: id === 'spot-heal' ? 1 : o.opacity, flow: id === 'spot-heal' ? 1 : o.flow, tip, lockAlpha: target.layer.lockAlpha, options });
      this.spacing = Math.max(1, diameter * (o.spacing ?? 0.15));
      this.last = this.work.toLayer(p);
      this.carry = 0;
      this.dabAt(this.last, p.pressure, o);
      if (p.shift && this.prevEnd && this.prevTarget === target.asset) {
        // shift click draws a straight line from the end of the last stroke
        this.segment(this.prevEnd, this.last, p.pressure, o);
      }
    },
    dabAt(q, pressure, o) {
      const w = this.work;
      const r = w.opts.tip.size;
      if (!w.cover(q.x - r, q.y - r, q.x + r, q.y + r)) return;
      const pr = o.pressureSize ? pressure : 1;
      const rect = w.stroke.dab(q.x, q.y, o.pressureOpacity === false ? 1 : pressure * pr);
      w.flush(rect);
    },
    segment(a, b, pressure, o) {
      const { points, carry } = dabPositions(a.x, a.y, b.x, b.y, this.spacing, this.carry);
      this.carry = carry;
      for (const [x, y] of points) if (x !== a.x || y !== a.y || !this.carry) this.dabAt({ x, y }, pressure, o);
    },
    move(app, p) {
      if (!this.work) return;
      const o = app.opts(id);
      const q = this.work.toLayer(p);
      const { points, carry } = dabPositions(this.last.x, this.last.y, q.x, q.y, this.spacing, this.carry);
      this.carry = carry;
      for (const [x, y] of points) this.dabAt({ x, y }, p.pressure, o);
      this.last = q;
      app.live?.cursor(p.x, p.y);
    },
    up(app) {
      const w = this.work;
      this.work = null;
      if (!w?.stroke) return;
      this.prevEnd = this.last;
      this.prevTarget = w.target.asset;
      let s = w.stroke;
      if (id === 'spot-heal' || id === 'heal') {
        // fill the painted area from its surroundings
        const reg = s.region;
        const mask = new Uint8Array(reg.w * reg.h);
        if (id === 'spot-heal') for (let i = 0; i < mask.length; i++) mask[i] = s.cover[i] > 0.05 ? 255 : 0;
        else for (let i = 0; i < mask.length; i++) mask[i] = s.buf[i * 4] !== s.original[i * 4] || s.buf[i * 4 + 1] !== s.original[i * 4 + 1] || s.buf[i * 4 + 2] !== s.original[i * 4 + 2] ? 255 : 0;
        const out = id === 'spot-heal' ? contentAwareFill(s.original, reg.w, reg.h, mask, { patch: 7, iterations: 4 }) : seamlessPatch(s.original, s.buf, reg.w, reg.h, mask);
        s.buf.set(out);
        if (!s.dirty) return;
        w.flush(s.dirty);
      }
      const res = s.result();
      if (!res) return;
      const label = app.t(`tool.${id}`);
      app.edoc.record(label, [patchOp(w.target.asset, res.rect, res.after)], [patchOp(w.target.asset, res.rect, res.before)], { icon: id });
    },
    cancel(app) {
      const w = this.work;
      this.work = null;
      if (!w?.stroke) return;
      // put the original pixels back
      const s = w.stroke;
      s.buf.set(s.original);
      w.flush({ x0: 0, y0: 0, x1: s.region.w, y1: s.region.h });
      void app;
    },
    overlay(ctx, vp, app) {
      if (!vp.cursorPos) return;
      const o = app.opts(id);
      const p = vp.toScreen(vp.cursorPos.x, vp.cursorPos.y);
      const r = Math.max(1.5, (o.size / 2) * vp.view.zoom);
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 0.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r - 0.5, 0, Math.PI * 2);
      ctx.stroke();
      if (r < 4) {
        ctx.beginPath();
        ctx.moveTo(p.x - 6, p.y);
        ctx.lineTo(p.x + 6, p.y);
        ctx.moveTo(p.x, p.y - 6);
        ctx.lineTo(p.x, p.y + 6);
        ctx.stroke();
      }
      if ((id === 'clone' || id === 'heal') && app.cloneSource) {
        const sp = vp.toScreen(app.cloneSource.x, app.cloneSource.y);
        ctx.strokeStyle = '#c08a4e';
        ctx.beginPath();
        ctx.moveTo(sp.x - 7, sp.y);
        ctx.lineTo(sp.x + 7, sp.y);
        ctx.moveTo(sp.x, sp.y - 7);
        ctx.lineTo(sp.x, sp.y + 7);
        ctx.stroke();
      }
      ctx.restore();
    },
  };
}

export const PAINT_TOOLS = [
  makePaintTool('brush', { group: 'brush', shortcut: 'b', icon: 'brush', defaults: { size: 40, hardness: 0.7, pressureSize: true } }),
  makePaintTool('pencil', { group: 'brush', shortcut: 'b', icon: 'pencil', defaults: { size: 4, hardness: 1 } }),
  makePaintTool('eraser', { group: 'eraser', shortcut: 'e', icon: 'eraser', defaults: { size: 60, hardness: 0.6 } }),
  makePaintTool('clone', { group: 'clone', shortcut: 's', icon: 'clone', defaults: { size: 60, hardness: 0.6, aligned: true } }),
  makePaintTool('spot-heal', { group: 'heal', shortcut: 'j', icon: 'heal', defaults: { size: 40, hardness: 0.9 } }),
  makePaintTool('heal', { group: 'heal', shortcut: 'j', icon: 'patch', defaults: { size: 50, hardness: 0.7, aligned: true } }),
  makePaintTool('dodge', { group: 'tone', shortcut: 'o', icon: 'dodge', defaults: { size: 80, hardness: 0.2, range: 'midtones', exposure: 0.5, flow: 0.5 } }),
  makePaintTool('burn', { group: 'tone', shortcut: 'o', icon: 'burn', defaults: { size: 80, hardness: 0.2, range: 'midtones', exposure: 0.5, flow: 0.5 } }),
  makePaintTool('sponge', { group: 'tone', shortcut: 'o', icon: 'sponge', defaults: { size: 80, hardness: 0.2, saturate: 'saturate', flow: 0.5 } }),
  makePaintTool('blur', { group: 'focus', shortcut: 'r', icon: 'proof', defaults: { size: 60, hardness: 0.3, flow: 0.6 } }),
  makePaintTool('sharpen', { group: 'focus', shortcut: 'r', icon: 'aperture', defaults: { size: 60, hardness: 0.3, flow: 0.4 } }),
  makePaintTool('smudge', { group: 'focus', shortcut: 'r', icon: 'smudge', defaults: { size: 50, hardness: 0.4, strength: 0.6 } }),
];
