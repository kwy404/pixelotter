// One tap looks: named sets of adjustments. A look is applied on top of the layer's own
// adjustments, so a look and manual tweaks combine, and switching looks keeps the tweaks.

import { ADJUSTMENT_KEYS, ADJUSTMENTS, normalizeAdjustments } from './adjust.js';

export const LOOKS = Object.freeze({
  none: {},
  safelight: { warmth: 38, contrast: 14, fade: 10, saturation: -12, vignette: 30 },
  silver: { saturation: -100, contrast: 22, highlights: -10, shadows: 8 },
  noir: { saturation: -100, contrast: 48, exposure: -8, vignette: 45 },
  matte: { fade: 26, contrast: -10, saturation: -8, shadows: 10 },
  golden: { warmth: 30, exposure: 6, saturation: 10, highlights: -14 },
  coast: { warmth: -24, tint: -6, contrast: 10, saturation: 6 },
  bloom: { exposure: 10, contrast: -12, fade: 12, saturation: 12, blur: 0 },
  crisp: { contrast: 20, sharpen: 40, saturation: 8, shadows: 6 },
  faded: { fade: 40, saturation: -22, contrast: -6, warmth: 10 },
  punch: { contrast: 30, saturation: 30, vignette: 15 },
  dusk: { warmth: 18, tint: 14, exposure: -6, contrast: 12, vignette: 25 },
});

export const LOOK_NAMES = Object.freeze(Object.keys(LOOKS));

/** Manual adjustments plus a look, added key by key and clamped. */
export function combineLook(adjust, look) {
  const base = normalizeAdjustments(adjust);
  const add = LOOKS[look] ?? {};
  const out = {};
  for (const k of ADJUSTMENT_KEYS) {
    const { min, max } = ADJUSTMENTS[k];
    out[k] = Math.max(min, Math.min(max, (base[k] || 0) + (add[k] || 0)));
  }
  return out;
}
