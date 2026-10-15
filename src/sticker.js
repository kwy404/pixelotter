// The sticker maker: cut out subject, white outline, optional caption, exported as a 512 by
// 512 WebP under 100 kB, the usual spec for messenger stickers (transparent background, a small
// margin on every side). This module does the layout, the outline and the size budget; the
// app does the drawing and the encoding.

import { distanceField } from './mask.js';

export const STICKER = Object.freeze({ size: 512, margin: 16, budget: 100 * 1000, mime: 'image/webp' });

/**
 * Where the subject goes: its alpha bounds are scaled to fit the sticker minus the margin, the
 * outline and the caption band. Returns { scale, x, y, w, h } in sticker pixels.
 */
export function stickerLayout(bounds, { size = STICKER.size, margin = STICKER.margin, outline = 12, caption = 0 } = {}) {
  const pad = margin + outline;
  const availW = size - 2 * pad;
  const availH = size - 2 * pad - caption;
  const s = Math.min(availW / bounds.w, availH / bounds.h);
  const w = bounds.w * s;
  const h = bounds.h * s;
  return { scale: s, x: (size - w) / 2, y: pad + (availH - h) / 2, w, h };
}

/**
 * An outline mask around the subject's alpha: every pixel within `radius` of the subject,
 * with a one pixel anti aliased edge. alpha: one byte per pixel.
 */
export function outlineMask(alpha, w, h, radius, threshold = 100) {
  const out = new Uint8Array(w * h);
  if (radius <= 0) return out;
  const dist = distanceField(w, h, (i) => alpha[i] >= threshold);
  for (let i = 0; i < out.length; i++) {
    const d = Math.sqrt(dist[i]);
    const v = Math.max(0, Math.min(1, radius + 0.5 - d));
    out[i] = Math.max(Math.round(v * 255), alpha[i]);
  }
  return out;
}

/**
 * Finds the highest quality whose encoding fits the byte budget, by bisection.
 * encode(quality) resolves to the encoded size in bytes or to a Blob. Returns
 * { ok, quality, size, tries }. When even the lowest quality is too big, ok is false and the
 * smallest result is returned so the caller can explain it.
 */
export async function fitBudget(encode, { budget = STICKER.budget, min = 0.2, max = 0.95, steps = 7 } = {}) {
  const sizeOf = async (q) => {
    const r = await encode(q);
    return typeof r === 'number' ? { size: r, result: r } : { size: r.size, result: r };
  };
  let tries = 1;
  const top = await sizeOf(max);
  if (top.size <= budget) return { ok: true, quality: max, size: top.size, result: top.result, tries };
  let lo = min;
  let hi = max;
  let best = null;
  const bottom = await sizeOf(min);
  tries++;
  if (bottom.size > budget) return { ok: false, quality: min, size: bottom.size, result: bottom.result, tries };
  best = { quality: min, ...bottom };
  for (let i = 0; i < steps; i++) {
    const mid = Math.round(((lo + hi) / 2) * 1000) / 1000;
    const r = await sizeOf(mid);
    tries++;
    if (r.size <= budget) {
      best = { quality: mid, ...r };
      lo = mid;
    } else hi = mid;
  }
  return { ok: true, quality: best.quality, size: best.size, result: best.result, tries };
}

/** Caption font size that fits the text width into the sticker, between 28 and 64 px. */
export function captionSize(measure, text, { size = STICKER.size, margin = STICKER.margin, max = 64, min = 28 } = {}) {
  if (!text) return 0;
  const room = size - 2 * margin - 24;
  let px = max;
  while (px > min && measure(text, px) > room) px -= 2;
  return px;
}
