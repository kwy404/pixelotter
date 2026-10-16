// The compositor: draws a document, bottom to top, into a canvas at any scale, with groups,
// blend modes, opacity and fill, layer masks (with feather), clipping masks, layer styles,
// adjustment layers and fill layers. Expensive steps are cached per layer and only redone when
// that layer's pixels or settings change. A region can be redrawn alone while painting.
// After compositing, gray and CMYK documents are shown as they will look (soft proof).

import { layerTree, isShown } from '../../lib/doc.js';
import { canvasOp } from '../../lib/blend.js';
import { layerMatrix, multiply, scale as scaleM } from '../../lib/geometry.js';
import { applyAdjustments, isNeutral, normalizeAdjustments, blurPlane } from '../../lib/filters/adjust.js';
import { combineLook } from '../../lib/filters/looks.js';
import { runFilter, getFilter } from '../../lib/filters/registry.js';
import { hasStyles, renderStyles } from '../../lib/styles.js';
import { cmykConverter } from '../../lib/color/cmyk.js';
import { makeCanvas } from './assets.js';
import { drawText, layoutText } from './text.js';
import { patternFor } from './patterns.js';

let cmyk = null;
/** The simulated press, built on first use (it takes a moment). */
export const press = () => (cmyk ??= cmykConverter());

const key = (...parts) => parts.map((p) => (typeof p === 'object' ? JSON.stringify(p) : String(p))).join('|');

export class Renderer {
  constructor(edoc) {
    this.edoc = edoc;
    this.cache = new Map(); // layer id -> { key, canvas, extra }
    this.textBoxes = new Map(); // layer id -> { key, box }
  }

  get doc() {
    return this.edoc.doc;
  }

  forget(id) {
    this.cache.delete(id);
    this.textBoxes.delete(id);
  }

  /** The local box of a layer at scale 1: pixels, the measured text box or the shape size. */
  size(l) {
    if (l.type === 'raster') return { w: l.w, h: l.h };
    if (l.type === 'shape') return { w: l.w, h: l.h };
    if (l.type === 'text') {
      const k = key(l.text, l.font, l.size, l.weight, l.italic, l.lineHeight, l.letterSpacing, l.outline, l.shadow, l.curve, l.bubble, l.align, document.fonts?.status);
      const hit = this.textBoxes.get(l.id);
      if (hit?.key === k) return hit.box;
      const lay = layoutText(l);
      const box = { w: lay.w, h: lay.h };
      this.textBoxes.set(l.id, { key: k, box });
      return box;
    }
    return { w: this.doc.width, h: this.doc.height };
  }

  /** Raster pixels with the layer's own tone adjustments and look, cached at a scale bucket. */
  rasterSource(l, scale) {
    // a filter dialog previews its result here, without touching the pixels
    const override = this.overrides?.get(l.id);
    if (override) return override;
    const asset = this.edoc.assets.get(l.asset);
    if (!asset) return null;
    const adjust = l.look && l.look !== 'none' ? combineLook(l.adjust, l.look) : normalizeAdjustments(l.adjust);
    if (isNeutral(adjust)) return asset.canvas;
    // work at the size the layer is shown at, so sliders stay fast on big photos
    const shown = Math.min(1, scale * Math.max(Math.abs(l.scaleX), Math.abs(l.scaleY)));
    const bucket = shown >= 0.75 ? 1 : shown >= 0.375 ? 0.5 : shown >= 0.19 ? 0.25 : 0.125;
    const k = key('adj', asset.version, adjust, bucket);
    const hit = this.cache.get(`${l.id}:src`);
    if (hit?.key === k) return hit.canvas;
    const w = Math.max(1, Math.round(asset.w * bucket));
    const h = Math.max(1, Math.round(asset.h * bucket));
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(asset.canvas, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    const out = applyAdjustments({ data: img.data, width: w, height: h }, adjust);
    ctx.putImageData(new ImageData(out.data, w, h), 0, 0);
    this.cache.set(`${l.id}:src`, { key: k, canvas: c });
    return c;
  }

  /** Draws a layer's content (no mask, no styles) into ctx, already scaled to document space. */
  drawContent(ctx, l, s, fillAlpha = 1) {
    const doc = this.doc;
    if (l.type === 'fill') {
      ctx.save();
      ctx.globalAlpha *= fillAlpha;
      if (l.fillType === 'solid') ctx.fillStyle = l.color;
      else if (l.fillType === 'pattern') ctx.fillStyle = patternFor(ctx, l.pattern.id, l.pattern.scale * s) ?? '#808080';
      else {
        const W = doc.width * s;
        const H = doc.height * s;
        let g;
        if (l.gradient.type === 'radial') g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) / 2);
        else {
          const a = (l.gradient.angle * Math.PI) / 180;
          const r = (Math.abs(W * Math.cos(a)) + Math.abs(H * Math.sin(a))) / 2;
          g = ctx.createLinearGradient(W / 2 - Math.cos(a) * r, H / 2 + Math.sin(a) * r, W / 2 + Math.cos(a) * r, H / 2 - Math.sin(a) * r);
        }
        for (const st of l.gradient.stops) g.addColorStop(st.at, st.color);
        ctx.fillStyle = g;
      }
      ctx.fillRect(0, 0, doc.width * s, doc.height * s);
      ctx.restore();
      return;
    }
    const size = this.size(l);
    const m = multiply(scaleM(s), layerMatrix(l, size));
    ctx.save();
    ctx.globalAlpha *= fillAlpha;
    ctx.setTransform(...m.map((v, i) => (i < 4 ? v : v)));
    if (l.type === 'raster') {
      const src = this.rasterSource(l, s);
      if (src) {
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(src, 0, 0, l.w, l.h);
      }
    } else if (l.type === 'text') {
      const res = Math.min(4, Math.max(0.05, s * Math.max(Math.abs(l.scaleX), Math.abs(l.scaleY)) * (globalThis.devicePixelRatio || 1)));
      const k = key('text', l.text, l.font, l.size, l.weight, l.italic, l.color, l.align, l.lineHeight, l.letterSpacing, l.outline, l.shadow, l.curve, l.bubble, Math.round(res * 20), document.fonts?.status);
      let hit = this.cache.get(`${l.id}:text`);
      if (hit?.key !== k) {
        const { canvas } = drawText(l, res);
        hit = { key: k, canvas };
        this.cache.set(`${l.id}:text`, hit);
      }
      ctx.drawImage(hit.canvas, 0, 0, size.w, size.h);
    } else if (l.type === 'shape') {
      this.drawShape(ctx, l);
    }
    ctx.restore();
  }

  drawShape(ctx, l) {
    const { w, h } = l;
    ctx.beginPath();
    switch (l.shape) {
      case 'ellipse':
        ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        break;
      case 'line':
      case 'arrow':
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        if (l.shape === 'arrow') {
          const head = Math.min(w * 0.3, Math.max(h, 12) * 2);
          ctx.moveTo(w - head, h / 2 - head * 0.6);
          ctx.lineTo(w, h / 2);
          ctx.lineTo(w - head, h / 2 + head * 0.6);
        }
        break;
      case 'star': {
        const n = 5;
        for (let i = 0; i < n * 2; i++) {
          const r = i % 2 ? 0.42 : 1;
          const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
          const x = w / 2 + (Math.cos(a) * w * r) / 2;
          const y = h / 2 + (Math.sin(a) * h * r) / 2 + h * 0.04;
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
        ctx.closePath();
        break;
      }
      case 'heart':
        ctx.moveTo(w / 2, h * 0.92);
        ctx.bezierCurveTo(w * 0.05, h * 0.6, -w * 0.02, h * 0.18, w * 0.27, h * 0.08);
        ctx.bezierCurveTo(w * 0.42, h * 0.02, w * 0.5, h * 0.18, w / 2, h * 0.24);
        ctx.bezierCurveTo(w * 0.5, h * 0.18, w * 0.58, h * 0.02, w * 0.73, h * 0.08);
        ctx.bezierCurveTo(w * 1.02, h * 0.18, w * 0.95, h * 0.6, w / 2, h * 0.92);
        ctx.closePath();
        break;
      case 'triangle':
        ctx.moveTo(w / 2, 0);
        ctx.lineTo(w, h);
        ctx.lineTo(0, h);
        ctx.closePath();
        break;
      default: {
        const r = Math.min(l.radius, w / 2, h / 2);
        if (r > 0 && ctx.roundRect) ctx.roundRect(0, 0, w, h, r);
        else ctx.rect(0, 0, w, h);
      }
    }
    const line = l.shape === 'line' || l.shape === 'arrow';
    if (l.fillColor && !line) {
      ctx.fillStyle = l.fillColor;
      ctx.fill();
    }
    if ((l.stroke && l.strokeWidth > 0) || line) {
      ctx.strokeStyle = l.stroke ?? l.fillColor ?? '#ffffff';
      ctx.lineWidth = Math.max(1, l.strokeWidth || 6);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  }

  /** The layer mask as an alpha canvas in document space at scale s (feather and invert applied). */
  maskCanvas(l, s, W, H) {
    const m = l.mask;
    if (!m?.enabled) return null;
    const asset = this.edoc.assets.get(m.asset);
    if (!asset) return null;
    const k = key('mask', asset.version, m.feather, m.invert, s, l.x, l.y, l.rotation, l.scaleX, l.scaleY, W, H);
    const hit = this.cache.get(`${l.id}:mask`);
    if (hit?.key === k) return hit.canvas;
    const c = makeCanvas(W, H);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (m.space === 'layer' && l.type === 'raster') ctx.setTransform(...multiply(scaleM(s), layerMatrix(l, { w: l.w, h: l.h })));
    else ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.drawImage(asset.canvas, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (m.feather > 0 || m.invert) {
      const img = ctx.getImageData(0, 0, W, H);
      if (m.feather > 0) {
        const plane = new Float32Array(W * H);
        for (let i = 0; i < plane.length; i++) plane[i] = img.data[i * 4 + 3];
        blurPlane(plane, W, H, (m.feather * s) / 2);
        for (let i = 0; i < plane.length; i++) img.data[i * 4 + 3] = plane[i];
      }
      if (m.invert) for (let i = 0; i < W * H; i++) img.data[i * 4 + 3] = 255 - img.data[i * 4 + 3];
      ctx.putImageData(img, 0, 0);
    }
    this.cache.set(`${l.id}:mask`, { key: k, canvas: c });
    return c;
  }

  /** Composites a layer tree into ctx (a W x H canvas at scale s). */
  drawTree(ctx, nodes, s, W, H, region) {
    let base = null; // the content of the last layer that is not clipped, for clipping masks
    for (const node of nodes) {
      const l = node.layer;
      if (!l.visible || this.hidden?.has(l.id)) {
        if (!l.clip) base = null;
        continue;
      }
      if (l.type === 'group') {
        const off = makeCanvas(W, H);
        const octx = off.getContext('2d');
        this.drawTree(octx, node.children, s, W, H, region);
        const mask = this.maskCanvas(l, s, W, H);
        if (mask) {
          octx.globalCompositeOperation = 'destination-in';
          octx.drawImage(mask, 0, 0);
        }
        ctx.save();
        ctx.globalAlpha = l.opacity;
        ctx.globalCompositeOperation = canvasOp(l.blend);
        ctx.drawImage(off, 0, 0);
        ctx.restore();
        base = off;
        continue;
      }
      if (l.type === 'adjust') {
        this.drawAdjustment(ctx, l, s, W, H, region);
        continue;
      }
      const styled = hasStyles(l.styles);
      const mask = this.maskCanvas(l, s, W, H);
      const simple = !styled && !mask && !l.clip && l.fill === 1;
      if (simple) {
        ctx.save();
        ctx.globalAlpha = l.opacity;
        ctx.globalCompositeOperation = canvasOp(l.blend);
        this.drawContent(ctx, l, s);
        ctx.restore();
        base = null;
        this.lastSimple = l.id;
        // keep the base for clipped layers above it
        if (nodes[nodes.indexOf(node) + 1]?.layer.clip) {
          const c = makeCanvas(W, H);
          this.drawContent(c.getContext('2d'), l, s);
          base = c;
        }
        continue;
      }
      const tmp = makeCanvas(W, H);
      const tctx = tmp.getContext('2d', { willReadFrequently: styled });
      this.drawContent(tctx, l, s, styled ? 1 : l.fill);
      if (mask) {
        tctx.globalCompositeOperation = 'destination-in';
        tctx.drawImage(mask, 0, 0);
        tctx.globalCompositeOperation = 'source-over';
      }
      if (l.clip && base) {
        tctx.globalCompositeOperation = 'destination-in';
        tctx.drawImage(base, 0, 0);
        tctx.globalCompositeOperation = 'source-over';
      }
      let final = tmp;
      if (styled) final = this.applyStyles(l, tmp, tctx, s, W, H);
      ctx.save();
      ctx.globalAlpha = l.opacity;
      ctx.globalCompositeOperation = canvasOp(l.blend);
      ctx.drawImage(final, 0, 0);
      ctx.restore();
      if (!l.clip) base = tmp;
    }
  }

  applyStyles(l, tmp, tctx, s, W, H) {
    const img = tctx.getImageData(0, 0, W, H);
    const k = key('styles', l.styles, s, W, H, hash(img.data));
    let hit = this.cache.get(`${l.id}:styles`);
    if (hit?.key !== k) {
      const { under, over } = renderStyles(img.data, W, H, l.styles, s);
      const toCanvas = (buf) => {
        if (!buf) return null;
        const c = makeCanvas(W, H);
        c.getContext('2d').putImageData(new ImageData(buf, W, H), 0, 0);
        return c;
      };
      hit = { key: k, under: toCanvas(under), over: toCanvas(over) };
      this.cache.set(`${l.id}:styles`, hit);
    }
    const out = makeCanvas(W, H);
    const o = out.getContext('2d');
    if (hit.under) o.drawImage(hit.under, 0, 0);
    o.globalAlpha = l.fill;
    o.drawImage(tmp, 0, 0);
    o.globalAlpha = 1;
    if (hit.over) o.drawImage(hit.over, 0, 0);
    return out;
  }

  drawAdjustment(ctx, l, s, W, H, region) {
    const f = getFilter(l.filter);
    if (!f) return;
    const r = region ?? { x: 0, y: 0, w: W, h: H };
    if (r.w <= 0 || r.h <= 0) return;
    const img = ctx.getImageData(r.x, r.y, r.w, r.h);
    const params = l.filter === 'tone' ? { ...normalizeAdjustments(l.adjust), ...l.params } : l.params;
    const out = runFilter(l.filter, { data: img.data, width: r.w, height: r.h }, params, { scale: s });
    const tmp = makeCanvas(W, H);
    const tctx = tmp.getContext('2d');
    tctx.putImageData(new ImageData(out.data, r.w, r.h), r.x, r.y);
    const mask = this.maskCanvas(l, s, W, H);
    if (mask) {
      tctx.globalCompositeOperation = 'destination-in';
      tctx.drawImage(mask, 0, 0);
    }
    ctx.save();
    ctx.globalAlpha = l.opacity;
    ctx.globalCompositeOperation = canvasOp(l.blend);
    ctx.drawImage(tmp, 0, 0);
    ctx.restore();
  }

  /**
   * Renders the document into a canvas of W = width * scale. options:
   *   target     canvas to draw into (resized when needed)
   *   region     { x, y, w, h } in canvas pixels to redraw alone
   *   background false to leave the document background out
   *   proof      'auto' (by color mode), true or false
   *   hidden     a Set of layer ids to leave out (used while a tool previews them)
   */
  render({ scale = 1, target = null, region = null, background = true, proof = 'auto', hidden = null } = {}) {
    const doc = this.doc;
    const W = Math.max(1, Math.round(doc.width * scale));
    const H = Math.max(1, Math.round(doc.height * scale));
    const canvas = target ?? makeCanvas(W, H);
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
      region = null;
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.save();
    if (region) {
      ctx.beginPath();
      ctx.rect(region.x, region.y, region.w, region.h);
      ctx.clip();
      ctx.clearRect(region.x, region.y, region.w, region.h);
    } else ctx.clearRect(0, 0, W, H);
    if (background && doc.background) {
      ctx.fillStyle = doc.background;
      ctx.fillRect(0, 0, W, H);
    }
    this.hidden = hidden;
    this.drawTree(ctx, layerTree(doc), scale, W, H, region);
    this.hidden = null;
    ctx.restore();
    const wantProof = proof === 'auto' ? doc.mode !== 'rgb' || !!this.forceProof : proof;
    if (wantProof) this.proof(ctx, region ?? { x: 0, y: 0, w: W, h: H }, doc.mode === 'gray' ? 'gray' : 'cmyk');
    return canvas;
  }

  proof(ctx, r, mode) {
    if (r.w <= 0 || r.h <= 0) return;
    const img = ctx.getImageData(r.x, r.y, r.w, r.h);
    if (mode === 'gray') {
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
    } else img.data.set(press().proof(img.data));
    ctx.putImageData(img, r.x, r.y);
  }

  /** Whether a layer (and its groups) is visible. */
  shown(id) {
    return isShown(this.doc, id);
  }
}

/** A quick content hash for style caching (samples a few thousand bytes). */
function hash(data) {
  let h = 2166136261;
  const step = Math.max(1, Math.floor(data.length / 4096));
  for (let i = 3; i < data.length; i += step * 4 + 3) {
    h ^= data[i] + (data[i - 1] << 8);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
