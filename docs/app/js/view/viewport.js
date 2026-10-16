// The canvas viewport: shows the active document with zoom and pan, a checkerboard under
// transparency, rulers, guides, a grid, the marching ants, tool overlays and the cursors of
// friends in a live session. Pointer, pen, touch (pinch to zoom, two finger pan), wheel and
// keyboard input are turned into document coordinates and handed to the current tool.

import { makeCanvas } from '../engine/assets.js';

const DPR = () => globalThis.devicePixelRatio || 1;
const SVG = 'http://www.w3.org/2000/svg';

// An eyedropper drawn black on a white outline so it shows on any pixel; the hotspot is the tip.
const EYEDROPPER = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><g fill='none' stroke-linecap='round' stroke-linejoin='round'><g stroke='#fff' stroke-width='4'><path d='M2.5 21.5l1-3.5 9-9 2.5 2.5-9 9z'/><path d='M11 7.5l5.5 5.5M14.5 9.5l3.5-3.5a2.1 2.1 0 0 0-3-3l-3.5 3.5'/></g><g stroke='#000' stroke-width='1.6'><path d='M2.5 21.5l1-3.5 9-9 2.5 2.5-9 9z' fill='#fff'/><path d='M11 7.5l5.5 5.5M14.5 9.5l3.5-3.5a2.1 2.1 0 0 0-3-3l-3.5 3.5' fill='#000'/></g></g></svg>",
)}") 2 22, crosshair`;
/** Tool cursor names that are not plain CSS cursors. */
const CSS_CURSORS = { eyedropper: EYEDROPPER, brush: 'none' };
export const ZOOM_STEPS = [0.02, 0.03, 0.05, 0.0667, 0.1, 0.125, 0.1667, 0.25, 0.333, 0.5, 0.667, 1, 1.5, 2, 3, 4, 5, 6, 8, 12, 16, 24, 32];

export class Viewport {
  constructor(root, { onTool, onCursor, onViewChange, onGuideDrag } = {}) {
    this.root = root;
    this.onTool = onTool;
    this.onCursor = onCursor;
    this.onViewChange = onViewChange;
    this.onGuideDrag = onGuideDrag;
    this.display = root.querySelector('.vp-display');
    this.overlay = root.querySelector('.vp-overlay');
    this.rulerX = root.querySelector('.vp-ruler-x');
    this.rulerY = root.querySelector('.vp-ruler-y');
    this.stage = root.querySelector('.vp-stage');
    this.dctx = this.display.getContext('2d');
    this.octx = this.overlay.getContext('2d');
    this.edoc = null;
    this.renderer = null;
    this.composite = makeCanvas(1, 1);
    this.compositeScale = 0;
    this.dirty = true;
    this.dirtyRegion = null;
    this.pointers = new Map();
    this.gesture = null;
    this.space = false;
    this.showRulers = true;
    this.showGrid = false;
    this.showGuides = true;
    this.snap = true;
    this.gamut = false;
    this.peers = new Map(); // id -> { x, y (shown), tx, ty (latest), name, color, icon, label, ring, active, at }
    this.peerSel = new Map(); // id -> { loops: [[x, y, x, y...]], color }: friends' selections
    this.peerEls = new Map(); // id -> the cursor element of a friend
    this.overlays = []; // functions (ctx, view) drawn on top
    this.antsOffset = 0;
    this.cursorPos = null;
    this.frame = 0;
    // the tool cursor: a CSS cursor, or for brushes an outline element that follows the pointer
    this.cursorName = 'default';
    this.cursorSize = null; // () => brush diameter in document pixels
    this.hoverAt = null; // { sx, sy, type, down } in stage pixels
    this.caps = false;
    this.cursorEl = document.createElement('div');
    this.cursorEl.className = 'vp-cursor';
    this.cursorEl.setAttribute('aria-hidden', 'true');
    this.cursorEl.hidden = true;
    this.stage.append(this.cursorEl);
    this.peerLayer = document.createElement('div');
    this.peerLayer.className = 'vp-peers';
    this.peerLayer.setAttribute('aria-hidden', 'true');
    this.stage.append(this.peerLayer);
    this.bind();
    new ResizeObserver(() => this.resize()).observe(this.stage);
    this.watchDpr();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  attach(edoc, renderer) {
    this.edoc = edoc;
    this.renderer = renderer;
    this.dirty = true;
    this.compositeScale = 0;
    if (edoc && (!edoc.view.zoom || edoc.view.fit)) this.fit();
    this.requestDraw();
    this.applyCursor();
  }

  get view() {
    return this.edoc?.view ?? { zoom: 1, cx: 0, cy: 0 };
  }

  /** Moving the window to another screen or zooming the page changes the pixel ratio. */
  watchDpr() {
    if (!globalThis.matchMedia) return;
    const mq = matchMedia(`(resolution: ${DPR()}dppx)`);
    mq.addEventListener?.('change', () => {
      this.resize();
      this.watchDpr();
    }, { once: true });
  }

  resize() {
    const r = this.stage.getBoundingClientRect();
    const dpr = DPR();
    // whole device pixels and a CSS size that matches them exactly, so the canvas is never
    // resampled on its way to the screen
    const cw = Math.max(1, Math.round(r.width * dpr));
    const ch = Math.max(1, Math.round(r.height * dpr));
    this.w = cw / dpr;
    this.h = ch / dpr;
    for (const c of [this.display, this.overlay]) {
      c.width = cw;
      c.height = ch;
      c.style.width = `${this.w}px`;
      c.style.height = `${this.h}px`;
    }
    for (const [c, horizontal] of [
      [this.rulerX, true],
      [this.rulerY, false],
    ]) {
      if (!c) continue;
      const rr = c.getBoundingClientRect();
      c.width = Math.round(rr.width * DPR());
      c.height = Math.round(rr.height * DPR());
      void horizontal;
    }
    if (this.edoc?.view.fit) this.fit();
    this.requestDraw();
  }

  /** Document point to stage pixels (CSS). */
  toScreen(x, y) {
    const v = this.view;
    return { x: (x - v.cx) * v.zoom + this.w / 2, y: (y - v.cy) * v.zoom + this.h / 2 };
  }

  toDoc(sx, sy) {
    const v = this.view;
    return { x: (sx - this.w / 2) / v.zoom + v.cx, y: (sy - this.h / 2) / v.zoom + v.cy };
  }

  fit() {
    if (!this.edoc) return;
    const d = this.edoc.doc;
    const pad = Math.min(48, this.w * 0.06);
    const z = Math.min((this.w - pad * 2) / d.width, (this.h - pad * 2) / d.height);
    Object.assign(this.edoc.view, { zoom: Math.max(0.01, Math.min(z, 16)), cx: d.width / 2, cy: d.height / 2, fit: true });
    this.viewChanged();
  }

  setZoom(z, anchor = null) {
    if (!this.edoc) return;
    const v = this.edoc.view;
    const nz = Math.max(0.01, Math.min(64, z));
    if (anchor) {
      const before = this.toDoc(anchor.x, anchor.y);
      v.zoom = nz;
      const after = this.toDoc(anchor.x, anchor.y);
      v.cx += before.x - after.x;
      v.cy += before.y - after.y;
    } else v.zoom = nz;
    v.fit = false;
    this.viewChanged();
  }

  zoomStep(dir, anchor = null) {
    const z = this.view.zoom;
    const next = dir > 0 ? ZOOM_STEPS.find((s) => s > z * 1.01) ?? z * 1.5 : [...ZOOM_STEPS].reverse().find((s) => s < z / 1.01) ?? z / 1.5;
    this.setZoom(next, anchor);
  }

  panBy(dx, dy) {
    const v = this.edoc.view;
    v.cx -= dx / v.zoom;
    v.cy -= dy / v.zoom;
    v.fit = false;
    this.viewChanged();
  }

  viewChanged() {
    this.requestDraw();
    this.drawCursor();
    this.onViewChange?.(this.view);
  }

  /** Marks the composite stale (all of it, or a rectangle in document pixels). */
  invalidate(rect = null) {
    if (!rect || this.dirty === true) {
      this.dirty = true;
      this.dirtyRegion = null;
    } else {
      const s = this.compositeScale || 1;
      const r = { x: Math.floor(rect.x * s) - 2, y: Math.floor(rect.y * s) - 2, w: Math.ceil(rect.w * s) + 4, h: Math.ceil(rect.h * s) + 4 };
      this.dirtyRegion = this.dirtyRegion ? union(this.dirtyRegion, r) : r;
    }
    this.requestDraw();
  }

  requestDraw() {
    this.needsDraw = true;
  }

  /** The scale the composite is rendered at: screen resolution, never above 1. */
  wantScale() {
    const z = this.view.zoom * DPR();
    if (z >= 1) return 1;
    // power of two steps so small zoom changes do not re-render everything
    return Math.min(1, 2 ** Math.ceil(Math.log2(Math.max(z, 1 / 64))));
  }

  loop(t) {
    requestAnimationFrame(this.loop);
    this.frame++;
    const antsVisible = this.edoc && !this.edoc.selection.empty;
    if (antsVisible && this.frame % 4 === 0) {
      this.antsOffset = (this.antsOffset + 1) % 16;
      this.needsOverlay = true;
    }
    if (this.peers.size || this.peerEls.size) this.drawPeers(t);
    if (!this.cursorEl.hidden) this.drawCursor(); // follows brush size changes from the options
    if (!this.needsDraw && !this.needsOverlay) return;
    if (this.needsDraw) this.draw();
    this.drawOverlay(t);
    this.needsDraw = false;
    this.needsOverlay = false;
  }

  ensureComposite() {
    if (!this.edoc) return;
    const s = this.wantScale();
    if (s !== this.compositeScale) {
      this.dirty = true;
      this.dirtyRegion = null;
    }
    if (this.dirty === true && !this.dirtyRegion) {
      this.renderer.render({ scale: s, target: this.composite, hidden: this.hidden });
      this.compositeScale = s;
      this.dirty = false;
    } else if (this.dirtyRegion) {
      const r = clip(this.dirtyRegion, this.composite.width, this.composite.height);
      if (r) this.renderer.render({ scale: s, target: this.composite, region: r, hidden: this.hidden });
      this.dirtyRegion = null;
      this.dirty = false;
    }
  }

  draw() {
    const ctx = this.dctx;
    const dpr = DPR();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.display.width, this.display.height);
    if (!this.edoc) return;
    this.ensureComposite();
    const d = this.edoc.doc;
    const v = this.view;
    const tl = this.toScreen(0, 0);
    const W = d.width * v.zoom;
    const H = d.height * v.zoom;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // drop shadow of the canvas
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = '#808080';
    ctx.fillRect(tl.x, tl.y, W, H);
    ctx.restore();
    // checkerboard for transparency
    if (!d.background || this.hasTransparency) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(tl.x, tl.y, W, H);
      ctx.clip();
      ctx.fillStyle = this.checker(ctx);
      ctx.fillRect(tl.x, tl.y, W, H);
      ctx.restore();
    }
    ctx.imageSmoothingEnabled = v.zoom * dpr < 2;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.composite, tl.x, tl.y, W, H);
    if (this.gamut && d.mode !== 'gray') this.drawGamut(ctx, tl, W, H);
  }

  checker(ctx) {
    if (!this.checkerPattern) {
      const c = makeCanvas(16, 16);
      const g = c.getContext('2d');
      g.fillStyle = '#d9d6d0';
      g.fillRect(0, 0, 16, 16);
      g.fillStyle = '#b8b4ad';
      g.fillRect(0, 0, 8, 8);
      g.fillRect(8, 8, 8, 8);
      this.checkerPattern = ctx.createPattern(c, 'repeat');
    }
    return this.checkerPattern;
  }

  drawGamut(ctx, tl, W, H) {
    if (!this.gamutCanvas || this.gamutVersion !== this.edoc.revision || this.gamutScale !== this.compositeScale) {
      const src = this.composite.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, this.composite.width, this.composite.height);
      const mask = this.renderer && this.gamutFn ? this.gamutFn(src.data) : null;
      const c = makeCanvas(this.composite.width, this.composite.height);
      if (mask) {
        const g = c.getContext('2d');
        const img = g.createImageData(c.width, c.height);
        for (let i = 0; i < mask.length; i++) if (mask[i]) img.data.set([120, 130, 140, 200], i * 4);
        g.putImageData(img, 0, 0);
      }
      this.gamutCanvas = c;
      this.gamutVersion = this.edoc.revision;
      this.gamutScale = this.compositeScale;
    }
    ctx.drawImage(this.gamutCanvas, tl.x, tl.y, W, H);
  }

  drawOverlay() {
    const ctx = this.octx;
    const dpr = DPR();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    if (!this.edoc) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const d = this.edoc.doc;
    const v = this.view;
    const tl = this.toScreen(0, 0);
    // grid
    if (this.showGrid) {
      const step = gridStep(v.zoom);
      ctx.strokeStyle = 'rgba(192,138,78,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= d.width; x += step) {
        const sx = Math.round(tl.x + x * v.zoom) + 0.5;
        ctx.moveTo(sx, tl.y);
        ctx.lineTo(sx, tl.y + d.height * v.zoom);
      }
      for (let y = 0; y <= d.height; y += step) {
        const sy = Math.round(tl.y + y * v.zoom) + 0.5;
        ctx.moveTo(tl.x, sy);
        ctx.lineTo(tl.x + d.width * v.zoom, sy);
      }
      ctx.stroke();
    }
    // guides
    if (this.showGuides && d.guides?.length) {
      ctx.strokeStyle = '#4fb3c9';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const g of d.guides) {
        if (g.axis === 'x') {
          const sx = Math.round(tl.x + g.pos * v.zoom) + 0.5;
          ctx.moveTo(sx, 0);
          ctx.lineTo(sx, this.h);
        } else {
          const sy = Math.round(tl.y + g.pos * v.zoom) + 0.5;
          ctx.moveTo(0, sy);
          ctx.lineTo(this.w, sy);
        }
      }
      ctx.stroke();
    }
    // marching ants
    if (!this.edoc.selection.empty && !this.hideAnts) {
      const loops = this.edoc.selection.outlines();
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const loop of loops) {
        loop.forEach(([x, y], i) => {
          const p = this.toScreen(x, y);
          if (i) ctx.lineTo(Math.round(p.x) + 0.5, Math.round(p.y) + 0.5);
          else ctx.moveTo(Math.round(p.x) + 0.5, Math.round(p.y) + 0.5);
        });
        ctx.closePath();
      }
      ctx.setLineDash([]);
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.setLineDash([4, 4]);
      ctx.lineDashOffset = -this.antsOffset;
      ctx.strokeStyle = '#000000';
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const fn of this.overlays) fn(ctx, this);
    if (this.toolOverlay) {
      ctx.save();
      try {
        this.toolOverlay(ctx, this);
      } catch (err) {
        if (!this.overlayFailed) console.warn(err);
        this.overlayFailed = true;
      }
      ctx.restore();
    }
    // friends' selections, in their colors
    for (const { loops, color } of this.peerSel.values()) {
      ctx.save();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = color;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      for (const loop of loops) {
        for (let i = 0; i + 1 < loop.length; i += 2) {
          const q = this.toScreen(loop[i], loop[i + 1]);
          if (i) ctx.lineTo(q.x, q.y);
          else ctx.moveTo(q.x, q.y);
        }
        ctx.closePath();
      }
      ctx.stroke();
      ctx.restore();
    }
    this.drawRulers();
  }

  drawRulers() {
    if (!this.showRulers || !this.rulerX) return;
    const v = this.view;
    const step = gridStep(v.zoom);
    for (const [c, horizontal] of [
      [this.rulerX, true],
      [this.rulerY, false],
    ]) {
      const ctx = c.getContext('2d');
      const dpr = DPR();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const len = horizontal ? c.width / dpr : c.height / dpr;
      const thick = horizontal ? c.height / dpr : c.width / dpr;
      ctx.fillStyle = getComputedStyle(this.root).getPropertyValue('--ruler-fg') || '#8a857d';
      ctx.strokeStyle = ctx.fillStyle;
      ctx.font = '9px "JetBrains Mono", ui-monospace, monospace';
      ctx.lineWidth = 1;
      const offset = horizontal ? (this.rulerX.getBoundingClientRect().left - this.stage.getBoundingClientRect().left) : (this.rulerY.getBoundingClientRect().top - this.stage.getBoundingClientRect().top);
      const startDoc = horizontal ? this.toDoc(offset, 0).x : this.toDoc(0, offset).y;
      const endDoc = startDoc + len / v.zoom;
      const first = Math.floor(startDoc / step) * step;
      ctx.beginPath();
      for (let d = first; d <= endDoc; d += step / 5) {
        const major = Math.abs(d / step - Math.round(d / step)) < 1e-6;
        const pos = Math.round((d - startDoc) * v.zoom) + 0.5;
        const tick = major ? thick : thick * 0.3;
        if (horizontal) {
          ctx.moveTo(pos, thick);
          ctx.lineTo(pos, thick - tick);
        } else {
          ctx.moveTo(thick, pos);
          ctx.lineTo(thick - tick, pos);
        }
        if (major) {
          if (horizontal) ctx.fillText(String(Math.round(d)), pos + 3, 9);
          else {
            ctx.save();
            ctx.translate(9, pos + 3);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText(String(Math.round(d)), -24, 0);
            ctx.restore();
          }
        }
      }
      ctx.stroke();
      if (this.cursorPos) {
        ctx.strokeStyle = '#c08a4e';
        ctx.beginPath();
        const p = ((horizontal ? this.cursorPos.x : this.cursorPos.y) - startDoc) * v.zoom;
        if (horizontal) {
          ctx.moveTo(p, 0);
          ctx.lineTo(p, thick);
        } else {
          ctx.moveTo(0, p);
          ctx.lineTo(thick, p);
        }
        ctx.stroke();
      }
    }
  }

  /**
   * Friends' cursors as elements over the canvas: an arrow and a tag in their color with the
   * icon of their tool and what they are doing, plus their brush outline. Each glides toward
   * the latest position it heard of, so a few messages a second still move smoothly.
   */
  drawPeers(t) {
    const now = performance.now();
    const dt = Math.min(100, t - (this.peerFrame ?? t));
    this.peerFrame = t;
    const k = 1 - Math.exp(-dt / 70);
    for (const [id, p] of this.peers) {
      if (now - p.at > 60000) this.peers.delete(id);
    }
    for (const [id, el] of this.peerEls) {
      if (!this.peers.has(id) || !this.edoc) {
        el.remove();
        this.peerEls.delete(id);
      }
    }
    if (!this.edoc) return;
    for (const [id, p] of this.peers) {
      p.x += (p.tx - p.x) * k;
      p.y += (p.ty - p.y) * k;
      if (Math.abs(p.tx - p.x) * this.view.zoom < 0.05) p.x = p.tx;
      if (Math.abs(p.ty - p.y) * this.view.zoom < 0.05) p.y = p.ty;
      let el = this.peerEls.get(id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'peer-cursor';
        el.dataset.peerCursor = id;
        el.innerHTML = '<div class="peer-ring"></div><svg class="peer-arrow" width="16" height="22" viewBox="0 0 16 22"><path d="M1 1v17l4.5-4.5 3.5 7.5 3-1.4-3.4-7.3H15z"/></svg><div class="peer-tag"><svg class="ic peer-tool" aria-hidden="true"><use href=""/></svg><b class="peer-name"></b><span class="peer-act"></span></div>';
        this.peerLayer.append(el);
        this.peerEls.set(id, el);
      }
      const idle = p.active && now - p.active > 30000;
      const label = idle ? p.idleLabel : p.label || '';
      const icon = p.icon ? `icons.svg#i-${p.icon}` : '';
      const ring = p.ring * this.view.zoom;
      const key = `${p.name}|${p.color}|${icon}|${label}|${Math.round(ring)}|${idle}`;
      if (el.dataset.key !== key) {
        el.dataset.key = key;
        el.style.setProperty('--peer', p.color);
        el.querySelector('.peer-name').textContent = p.name;
        el.querySelector('.peer-act').textContent = label;
        el.querySelector('.peer-act').hidden = !label;
        const use = el.querySelector('.peer-tool use');
        use.setAttribute('href', icon);
        el.querySelector('.peer-tool').style.display = icon ? '' : 'none';
        el.dataset.tool = p.toolName ?? '';
        el.classList.toggle('idle', !!idle);
        const r = el.querySelector('.peer-ring');
        r.hidden = !(ring >= 4);
        r.style.width = r.style.height = `${ring}px`;
      }
      const s = this.toScreen(p.x, p.y);
      el.style.transform = `translate(${s.x}px, ${s.y}px)`;
    }
  }

  /** Sets the tool cursor: a CSS cursor name, 'eyedropper', or 'brush' for the outline. */
  setCursor(name) {
    this.cursorName = name || 'default';
    this.applyCursor();
  }

  applyCursor() {
    const name = this.panning ? 'grabbing' : this.space ? 'grab' : this.cursorName;
    const brush = name === 'brush' && !!this.edoc;
    const css = name === 'brush' && !brush ? 'default' : CSS_CURSORS[name] ?? name;
    if (this.stage.style.cursor !== css) this.stage.style.cursor = css;
    this.brushCursor = brush;
    this.drawCursor();
  }

  /** Places the brush outline (or the precise crosshair) under the pointer. */
  drawCursor() {
    const el = this.cursorEl;
    const at = this.hoverAt;
    // touch has no hover: the outline shows only while a finger paints
    if (!this.brushCursor || !this.edoc || !at || (at.type === 'touch' && !at.down) || this.pointers.size > 1) {
      if (!el.hidden) el.hidden = true;
      return;
    }
    const d = Math.max(0, (this.cursorSize?.() ?? 0) * this.view.zoom);
    // Caps Lock swaps the outline for a precise crosshair; so does a brush far larger than the view
    const precise = this.caps || d > 4 * Math.max(this.w, this.h);
    const key = precise ? 'precise' : String(Math.round(d * 2) / 2);
    if (key !== this.cursorKey) {
      this.cursorKey = key;
      this.buildCursor(precise ? 0 : d, precise);
    }
    const t = `translate(${at.sx}px, ${at.sy}px)`;
    if (el.style.transform !== t) el.style.transform = t;
    if (el.hidden) el.hidden = false;
  }

  buildCursor(d, precise) {
    const el = this.cursorEl;
    const r = d / 2;
    const arm = precise ? 9 : 5;
    const half = Math.ceil(Math.max(r + 2, arm + 3));
    el.dataset.size = String(Math.round(d * 100) / 100);
    el.dataset.mode = precise ? 'precise' : 'outline';
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('width', String(half * 2));
    svg.setAttribute('height', String(half * 2));
    svg.setAttribute('viewBox', `${-half} ${-half} ${half * 2} ${half * 2}`);
    svg.style.left = svg.style.top = `${-half}px`;
    const parts = [];
    if (!precise && r >= 2) parts.push(['circle', { r: String(r) }]);
    // a crosshair marks the center of a small brush, and is the whole precise cursor
    if (precise || d < 12) {
      const gap = precise ? 2 : 0;
      parts.push(['path', { d: `M${-arm} 0H${-gap}M${gap} 0H${arm}M0 ${-arm}V${-gap}M0 ${gap}V${arm}` }]);
    }
    // a dark band with a light line inside reads on black, white and everything between
    for (const [stroke, width, opacity] of [
      ['#000', 3, 0.65],
      ['#fff', 1, 1],
    ]) {
      for (const [tag, attrs] of parts) {
        const n = document.createElementNS(SVG, tag);
        for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
        n.setAttribute('fill', 'none');
        n.setAttribute('stroke', stroke);
        n.setAttribute('stroke-width', String(width));
        n.setAttribute('stroke-opacity', String(opacity));
        svg.append(n);
      }
    }
    el.replaceChildren(svg);
  }

  /** Remembers where the pointer is, for the cursor element. */
  track(e, down) {
    const r = this.stage.getBoundingClientRect();
    this.hoverAt = { sx: e.clientX - r.left, sy: e.clientY - r.top, type: e.pointerType, down };
    if (e.getModifierState) this.caps = e.getModifierState('CapsLock');
    this.drawCursor();
  }

  bind() {
    const st = this.stage;
    // Caps Lock can change while the pointer rests on the canvas
    const caps = (e) => {
      if (!e.getModifierState) return;
      const on = e.getModifierState('CapsLock');
      if (on === this.caps) return;
      this.caps = on;
      this.drawCursor();
    };
    window.addEventListener('keydown', caps);
    window.addEventListener('keyup', caps);
    st.addEventListener('pointerdown', (e) => this.down(e));
    st.addEventListener('pointermove', (e) => this.move(e));
    st.addEventListener('pointerup', (e) => this.up(e));
    st.addEventListener('pointercancel', (e) => this.up(e, true));
    st.addEventListener('pointerleave', (e) => {
      if (this.pointers.has(e.pointerId)) return; // captured: the stroke goes on
      this.hoverAt = null;
      this.drawCursor();
      this.cursorPos = null;
      this.onCursor?.(null);
      this.needsOverlay = true;
    });
    st.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    st.addEventListener('dblclick', (e) => {
      if (!this.edoc || this.ownEvent(e) || this.space || e.button !== 0) return;
      this.onDouble?.(this.local(e));
    });
    st.addEventListener('contextmenu', (e) => e.preventDefault());
    // dragging from a ruler makes a guide
    for (const [c, axis] of [
      [this.rulerX, 'y'],
      [this.rulerY, 'x'],
    ]) {
      c?.addEventListener('pointerdown', (e) => {
        if (!this.edoc) return;
        e.preventDefault();
        const move = (ev) => {
          const r = st.getBoundingClientRect();
          const p = this.toDoc(ev.clientX - r.left, ev.clientY - r.top);
          this.guidePreview = { axis, pos: axis === 'x' ? p.x : p.y };
          this.needsOverlay = true;
        };
        const up = (ev) => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          const r = st.getBoundingClientRect();
          const inside = ev.clientX >= r.left && ev.clientY >= r.top && ev.clientX <= r.right && ev.clientY <= r.bottom;
          if (inside && this.guidePreview) this.onGuideDrag?.(this.guidePreview);
          this.guidePreview = null;
          this.needsOverlay = true;
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
    }
    this.overlays.push((ctx) => {
      if (!this.guidePreview) return;
      const tl = this.toScreen(0, 0);
      ctx.strokeStyle = '#4fb3c9';
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      if (this.guidePreview.axis === 'x') {
        const x = tl.x + this.guidePreview.pos * this.view.zoom;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, this.h);
      } else {
        const y = tl.y + this.guidePreview.pos * this.view.zoom;
        ctx.moveTo(0, y);
        ctx.lineTo(this.w, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    });
  }

  local(e) {
    const r = this.stage.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const p = this.toDoc(sx, sy);
    return { sx, sy, x: p.x, y: p.y, pressure: e.pointerType === 'pen' ? e.pressure || 0.5 : 1, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, button: e.button, type: e.pointerType, event: e };
  }

  /** Events on the inline text editor belong to it, not to the tools. */
  ownEvent(e) {
    return !!e.target?.closest?.('.text-editor');
  }

  down(e) {
    if (!this.edoc || this.ownEvent(e)) return;
    this.stage.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.track(e, true);
    if (this.pointers.size === 2) {
      // a second finger: cancel the tool and start pinch and pan
      this.onTool?.('cancel');
      const [a, b] = [...this.pointers.values()];
      this.gesture = { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, zoom: this.view.zoom };
      return;
    }
    if (this.pointers.size > 2) return;
    const p = this.local(e);
    if (e.button === 1 || this.space || this.toolId === 'hand') {
      this.panning = { x: e.clientX, y: e.clientY };
      this.applyCursor();
      return;
    }
    if (this.toolId === 'zoom') {
      this.zoomStep(e.altKey || e.button === 2 ? -1 : 1, { x: p.sx, y: p.sy });
      return;
    }
    if (e.button === 2) return;
    this.toolActive = true;
    this.onTool?.('down', p);
  }

  move(e) {
    if (!this.edoc) return;
    this.track(e, this.pointers.has(e.pointerId));
    const p = this.local(e);
    this.cursorPos = { x: p.x, y: p.y };
    this.onCursor?.(p);
    this.needsOverlay = true;
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.gesture && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const r = this.stage.getBoundingClientRect();
      this.panBy(mid.x - this.gesture.mid.x, mid.y - this.gesture.mid.y);
      this.setZoom(this.gesture.zoom * (dist / Math.max(1, this.gesture.dist)), { x: mid.x - r.left, y: mid.y - r.top });
      this.gesture.mid = mid;
      return;
    }
    if (this.panning) {
      this.panBy(e.clientX - this.panning.x, e.clientY - this.panning.y);
      this.panning = { x: e.clientX, y: e.clientY };
      return;
    }
    if (this.toolActive) {
      // pen and touch deliver several samples per frame
      const events = e.getCoalescedEvents?.() ?? [e];
      for (const ev of events.length ? events : [e]) this.onTool?.('move', this.local(ev));
    } else this.onTool?.('hover', p);
  }

  up(e, cancel = false) {
    this.pointers.delete(e.pointerId);
    if (e.pointerType === 'touch' || cancel) {
      this.hoverAt = null;
      this.drawCursor();
    } else this.track(e, false);
    if (this.gesture) {
      if (this.pointers.size < 2) this.gesture = null;
      return;
    }
    if (this.panning) {
      this.panning = null;
      this.applyCursor();
      return;
    }
    if (this.toolActive) {
      this.toolActive = false;
      this.onTool?.(cancel ? 'cancel' : 'up', this.local(e));
    }
  }

  wheel(e) {
    if (!this.edoc) return;
    e.preventDefault();
    const r = this.stage.getBoundingClientRect();
    const anchor = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (e.ctrlKey || e.metaKey || this.toolId === 'zoom') {
      const k = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
      this.setZoom(this.view.zoom * k, anchor);
    } else if (e.altKey) {
      this.zoomStep(e.deltaY < 0 ? 1 : -1, anchor);
    } else {
      const f = e.deltaMode === 1 ? 16 : 1;
      this.panBy(-(e.shiftKey ? e.deltaY : e.deltaX) * f, -(e.shiftKey ? 0 : e.deltaY) * f);
    }
  }
}

function union(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

function clip(r, W, H) {
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y);
  const x1 = Math.min(W, r.x + r.w);
  const y1 = Math.min(H, r.y + r.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** A tick spacing in document pixels that reads well at the zoom. */
export function gridStep(zoom) {
  const target = 80 / zoom;
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
  return steps.find((s) => s >= target) ?? 10000;
}
