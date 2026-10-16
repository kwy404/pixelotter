// Text layers: font presets (open license fonts, fetched once and cached for offline use by the
// service worker), measuring, and drawing with outline, shadow, curved text and bubbles.

import { layoutArc, splitLines } from '../../lib/textlayout.js';
import { makeCanvas } from './assets.js';

/** Font families offered in the text tools. All are SIL Open Font License fonts. */
export const FONTS = [
  { family: 'Inter', weights: [400, 500, 600, 700, 800], css: 'Inter:ital,wght@0,400..800;1,400..700', kind: 'sans' },
  { family: 'Fraunces', weights: [400, 600, 800], css: 'Fraunces:ital,wght@0,400..800;1,400..700', kind: 'serif' },
  { family: 'Playfair Display', weights: [400, 700, 900], css: 'Playfair+Display:ital,wght@0,400..900;1,400..700', kind: 'serif' },
  { family: 'Bebas Neue', weights: [400], css: 'Bebas+Neue', kind: 'display' },
  { family: 'Anton', weights: [400], css: 'Anton', kind: 'display' },
  { family: 'Space Grotesk', weights: [400, 500, 700], css: 'Space+Grotesk:wght@400..700', kind: 'sans' },
  { family: 'Baloo 2', weights: [400, 600, 800], css: 'Baloo+2:wght@400..800', kind: 'rounded' },
  { family: 'Pacifico', weights: [400], css: 'Pacifico', kind: 'script' },
  { family: 'Lobster', weights: [400], css: 'Lobster', kind: 'script' },
  { family: 'Caveat', weights: [400, 700], css: 'Caveat:wght@400..700', kind: 'hand' },
  { family: 'Permanent Marker', weights: [400], css: 'Permanent+Marker', kind: 'hand' },
  { family: 'JetBrains Mono', weights: [400, 700], css: 'JetBrains+Mono:wght@400..700', kind: 'mono' },
];

export const FONT_CSS_URL = `https://fonts.googleapis.com/css2?${FONTS.map((f) => `family=${f.css}`).join('&')}&display=swap`;

/** Ready made looks for text, used by the Quick workspace and the text options. */
export const TEXT_PRESETS = [
  { id: 'headline', label: 'Headline', props: { font: 'Bebas Neue', weight: 400, size: 150, color: '#ffffff', outline: { width: 0, color: '#000000' }, shadow: { blur: 18, x: 0, y: 8, color: '#00000099' }, letterSpacing: 4 } },
  { id: 'elegant', label: 'Elegant', props: { font: 'Playfair Display', weight: 700, italic: true, size: 110, color: '#f4ead8', shadow: { blur: 12, x: 0, y: 4, color: '#00000080' } } },
  { id: 'handwritten', label: 'Handwritten', props: { font: 'Caveat', weight: 700, size: 120, color: '#fbf3e4', shadow: { blur: 0, x: 0, y: 0, color: '#00000000' } } },
  { id: 'marker', label: 'Marker', props: { font: 'Permanent Marker', weight: 400, size: 100, color: '#f1d27a', outline: { width: 6, color: '#1a1410' } } },
  { id: 'retro', label: 'Retro arch', props: { font: 'Lobster', weight: 400, size: 110, color: '#f3c88b', outline: { width: 8, color: '#2a1a12' }, curve: 35 } },
  { id: 'bubble', label: 'Speech bubble', props: { font: 'Baloo 2', weight: 800, size: 72, color: '#1a1410', bubble: { style: 'speech', color: '#fbf6ee', padding: 36, radius: 40 } } },
  { id: 'caption', label: 'Caption box', props: { font: 'Inter', weight: 600, size: 56, color: '#f6efe4', bubble: { style: 'box', color: '#141414cc', padding: 24, radius: 14 } } },
  { id: 'sticker', label: 'Sticker caption', props: { font: 'Baloo 2', weight: 800, size: 80, color: '#ffffff', outline: { width: 14, color: '#141414' } } },
];

let fontsLink = null;
/** Adds the font stylesheet once. Returns a promise that settles when the faces are usable. */
export function loadFonts() {
  if (typeof document === 'undefined') return Promise.resolve(false);
  if (!fontsLink) {
    fontsLink = document.createElement('link');
    fontsLink.rel = 'stylesheet';
    fontsLink.href = FONT_CSS_URL;
    fontsLink.crossOrigin = 'anonymous';
    document.head.append(fontsLink);
  }
  return new Promise((resolve) => {
    const done = () => resolve(true);
    fontsLink.addEventListener('load', () => Promise.all(FONTS.map((f) => document.fonts.load(`${f.weights.at(-1)} 40px "${f.family}"`).catch(() => null))).then(done, done), { once: true });
    fontsLink.addEventListener('error', () => resolve(false), { once: true });
    if (fontsLink.sheet) done();
    setTimeout(() => resolve(false), 12000);
  });
}

/** Makes sure one face is loaded before drawing with it. */
export async function ensureFont(l) {
  if (typeof document === 'undefined' || !document.fonts) return;
  try {
    await document.fonts.load(fontString(l, 40), l.text || 'A');
  } catch {
    // fall back to a system face
  }
}

export const fontString = (l, size = l.size) => `${l.italic ? 'italic ' : ''}${l.weight} ${size}px "${l.font}", ui-sans-serif, system-ui, sans-serif`;

let measureCtx = null;
function mctx() {
  measureCtx ??= makeCanvas(8, 8).getContext('2d');
  return measureCtx;
}

/** Character advances of one line, including letter spacing. */
function advances(ctx, line, spacing) {
  return [...line].map((ch) => ctx.measureText(ch).width + spacing);
}

/**
 * Lays out a text layer at scale 1. Returns { w, h, lines: [{ text, width, y, glyphs? }], pad }
 * where w and h are the layer's local box (text plus bubble, outline and shadow room).
 */
export function layoutText(l) {
  const ctx = mctx();
  ctx.font = fontString(l);
  const lines = splitLines(l.text);
  const lh = l.size * l.lineHeight;
  const out = [];
  let maxW = 0;
  let curvedH = 0;
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    const adv = advances(ctx, text, l.letterSpacing);
    const width = Math.max(0, adv.reduce((a, b) => a + b, 0) - (adv.length ? l.letterSpacing : 0));
    const line = { text, width, adv };
    if (l.curve) {
      line.glyphs = layoutArc(adv, l.curve);
      const ys = line.glyphs.map((g) => g.y);
      line.sag = ys.length ? Math.max(...ys.map(Math.abs)) : 0;
      curvedH = Math.max(curvedH, line.sag);
    }
    maxW = Math.max(maxW, width);
    out.push(line);
  }
  const textH = lh * lines.length + curvedH;
  const bubble = l.bubble?.style && l.bubble.style !== 'none';
  const padB = bubble ? l.bubble.padding : 0;
  const tail = bubble && (l.bubble.style === 'speech' || l.bubble.style === 'thought') ? l.size * 0.9 : 0;
  const outline = l.outline?.width ?? 0;
  const shadowPad = l.shadow?.blur || l.shadow?.x || l.shadow?.y ? (l.shadow.blur ?? 0) * 1.5 + Math.max(Math.abs(l.shadow.x ?? 0), Math.abs(l.shadow.y ?? 0)) : 0;
  const pad = Math.ceil(outline + shadowPad + 4);
  const w = Math.ceil(maxW + padB * 2 + pad * 2 + (bubble ? 2 : 0));
  const h = Math.ceil(textH + padB * 2 + tail + pad * 2);
  let y = pad + padB + l.size * 0.92 + (l.curve > 0 ? 0 : curvedH);
  for (const line of out) {
    line.y = y;
    y += lh;
  }
  return { w: Math.max(4, w), h: Math.max(4, h), lines: out, pad, padB, tail, textW: maxW, textH, bubble };
}

function bubblePath(ctx, style, x, y, w, h, r, tail) {
  ctx.beginPath();
  if (style === 'thought') {
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.moveTo(x + w * 0.24 + tail * 0.28, y + h + tail * 0.35);
    ctx.arc(x + w * 0.24, y + h + tail * 0.35, tail * 0.28, 0, Math.PI * 2);
    ctx.moveTo(x + w * 0.14 + tail * 0.16, y + h + tail * 0.85);
    ctx.arc(x + w * 0.14, y + h + tail * 0.85, tail * 0.16, 0, Math.PI * 2);
    return;
  }
  const rr = Math.min(style === 'pill' ? h / 2 : r, h / 2, w / 2);
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  if (style === 'speech') {
    ctx.lineTo(x + w * 0.38, y + h);
    ctx.lineTo(x + w * 0.2, y + h + tail);
    ctx.lineTo(x + w * 0.24, y + h);
  }
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/**
 * Draws a text layer into a canvas of its local box at the given scale.
 * Returns { canvas, box: { w, h } } (box at scale 1).
 */
export function drawText(l, scale = 1, target = null) {
  const lay = layoutText(l);
  const W = Math.max(1, Math.ceil(lay.w * scale));
  const H = Math.max(1, Math.ceil(lay.h * scale));
  const canvas = target ?? makeCanvas(W, H);
  if (target) {
    canvas.width = W;
    canvas.height = H;
  }
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.scale(scale, scale);
  const shadow = l.shadow && (l.shadow.blur || l.shadow.x || l.shadow.y) && !/^#[0-9a-f]{6}00$/i.test(l.shadow.color);
  const setShadow = (on) => {
    if (on && shadow) {
      ctx.shadowColor = l.shadow.color;
      ctx.shadowBlur = l.shadow.blur * scale;
      ctx.shadowOffsetX = l.shadow.x * scale;
      ctx.shadowOffsetY = l.shadow.y * scale;
    } else {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }
  };
  if (lay.bubble) {
    const bx = lay.pad;
    const by = lay.pad;
    const bw = lay.w - lay.pad * 2;
    const bh = lay.h - lay.pad * 2 - lay.tail;
    setShadow(true);
    ctx.fillStyle = l.bubble.color;
    bubblePath(ctx, l.bubble.style, bx, by, bw, bh, l.bubble.radius, lay.tail);
    ctx.fill();
    setShadow(false);
  }
  ctx.font = fontString(l);
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  const inner = lay.w - (lay.pad + lay.padB) * 2;
  const left = lay.pad + lay.padB;
  const passes = [];
  if (l.outline?.width > 0) passes.push('stroke');
  passes.push('fill');
  for (const pass of passes) {
    setShadow(pass === passes[0] && !lay.bubble);
    if (pass === 'stroke') {
      ctx.strokeStyle = l.outline.color;
      ctx.lineWidth = l.outline.width * 2;
    } else ctx.fillStyle = l.color;
    for (const line of lay.lines) {
      const x0 = left + (l.align === 'left' ? 0 : l.align === 'right' ? inner - line.width : (inner - line.width) / 2);
      if (line.glyphs) {
        const cx = left + inner / 2;
        [...line.text].forEach((ch, i) => {
          const g = line.glyphs[i];
          ctx.save();
          ctx.translate(cx + g.x, line.y + g.y);
          ctx.rotate(g.angle);
          const half = (line.adv[i] - l.letterSpacing) / 2;
          if (pass === 'stroke') ctx.strokeText(ch, -half, 0);
          else ctx.fillText(ch, -half, 0);
          ctx.restore();
        });
      } else {
        let x = x0;
        if (!l.letterSpacing) {
          if (pass === 'stroke') ctx.strokeText(line.text, x, line.y);
          else ctx.fillText(line.text, x, line.y);
        } else {
          [...line.text].forEach((ch, i) => {
            if (pass === 'stroke') ctx.strokeText(ch, x, line.y);
            else ctx.fillText(ch, x, line.y);
            x += line.adv[i];
          });
        }
      }
    }
  }
  ctx.restore();
  return { canvas, box: { w: lay.w, h: lay.h } };
}
