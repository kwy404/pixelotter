// Patterns for pattern fills, the paint bucket and the pattern overlay: drawn in code, tiling,
// in the muted darkroom palette. Users can also define a pattern from a selection.

import { makeCanvas } from './assets.js';

const custom = new Map();

export const PATTERNS = ['grain', 'paper', 'linen', 'dots', 'stripes', 'checks', 'grid', 'halftone', 'herringbone'];

function tile(id) {
  if (custom.has(id)) return custom.get(id);
  const S = id === 'paper' || id === 'grain' || id === 'linen' ? 128 : 32;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d');
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  switch (id) {
    case 'grain':
    case 'paper': {
      const img = g.createImageData(S, S);
      for (let i = 0; i < S * S; i++) {
        const v = id === 'paper' ? 226 + rnd() * 22 : 110 + rnd() * 60;
        img.data.set([v, v * 0.97, v * 0.92, 255], i * 4);
      }
      g.putImageData(img, 0, 0);
      break;
    }
    case 'linen':
      g.fillStyle = '#d9cfbf';
      g.fillRect(0, 0, S, S);
      for (let i = 0; i < S; i += 2) {
        g.fillStyle = `rgba(90,70,50,${0.06 + rnd() * 0.08})`;
        g.fillRect(0, i, S, 1);
        g.fillRect(i, 0, 1, S);
      }
      break;
    case 'dots':
      g.fillStyle = '#1b1715';
      g.fillRect(0, 0, S, S);
      g.fillStyle = '#c08a4e';
      g.beginPath();
      g.arc(S / 2, S / 2, S / 6, 0, Math.PI * 2);
      g.fill();
      break;
    case 'stripes':
      g.fillStyle = '#e8dfcf';
      g.fillRect(0, 0, S, S);
      g.strokeStyle = '#3a2f28';
      g.lineWidth = S / 4;
      g.beginPath();
      g.moveTo(-S, S * 2);
      g.lineTo(S * 2, -S);
      g.moveTo(-S, S);
      g.lineTo(S, -S);
      g.moveTo(0, S * 2);
      g.lineTo(S * 2, 0);
      g.stroke();
      break;
    case 'checks':
      g.fillStyle = '#e8dfcf';
      g.fillRect(0, 0, S, S);
      g.fillStyle = '#2a2420';
      g.fillRect(0, 0, S / 2, S / 2);
      g.fillRect(S / 2, S / 2, S / 2, S / 2);
      break;
    case 'grid':
      g.fillStyle = '#f3efe8';
      g.fillRect(0, 0, S, S);
      g.strokeStyle = '#b9a98f';
      g.strokeRect(0.5, 0.5, S, S);
      break;
    case 'halftone':
      g.fillStyle = '#f1ece3';
      g.fillRect(0, 0, S, S);
      g.fillStyle = '#211c19';
      for (const [x, y, r] of [
        [8, 8, 5],
        [24, 24, 5],
        [24, 8, 2.5],
        [8, 24, 2.5],
      ]) {
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
      break;
    default:
      // herringbone
      g.fillStyle = '#cdbfa8';
      g.fillRect(0, 0, S, S);
      g.fillStyle = '#8a7457';
      for (let i = 0; i < 4; i++) {
        g.fillRect(i * 8, i * 8, 16, 4);
        g.fillRect(i * 8 + 12, i * 8 - 12, 4, 16);
      }
  }
  custom.set(id, c);
  return c;
}

/** A CanvasPattern for a 2D context. */
export function patternFor(ctx, id, scale = 1) {
  const p = ctx.createPattern(tile(id), 'repeat');
  if (p?.setTransform && scale !== 1) p.setTransform(new DOMMatrix().scale(scale));
  return p;
}

/** Registers a pattern from pixels (Edit > Define pattern). */
export function definePattern(id, canvas) {
  custom.set(id, canvas);
  if (!PATTERNS.includes(id)) PATTERNS.push(id);
}

export const patternTile = tile;
