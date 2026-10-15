// The filter registry. The app builds the Filter menu, the Image > Adjustments menu, the
// adjustment layers and every filter dialog (with live preview) from this list.
// Parameter types: range { min, max, step, unit }, select { options }, checkbox, color,
// angle, point (0..1 position), curves, levels, gradient and triple (three ranges).
//   scale: parameter keys measured in pixels, multiplied by the preview scale
//   adjustment: usable as an adjustment layer (pure per pixel, no neighborhood)
//   instant: applies without a dialog

import { applyAdjustments, autoEnhance, neutralAdjustments } from './adjust.js';
import { combineLook, LOOK_NAMES } from './looks.js';
import * as tone from './tone.js';
import * as fx from './effects.js';

const range = (key, label, min, max, def, extra = {}) => ({ key, label, type: 'range', min, max, step: 1, default: def, ...extra });

export const FILTERS = [
  // adjustments
  { id: 'tone', group: 'adjust', label: 'Tone', adjustment: true, params: Object.keys(neutralAdjustments()).map((k) => range(k, k[0].toUpperCase() + k.slice(1), ['fade', 'vignette', 'sharpen', 'blur'].includes(k) ? 0 : -100, 100, 0)), run: (img, p) => applyAdjustments(img, p) },
  { id: 'look', group: 'adjust', label: 'Look', adjustment: true, params: [{ key: 'look', label: 'Look', type: 'select', options: LOOK_NAMES, default: 'safelight' }, range('mix', 'Strength', 0, 100, 100, { unit: '%' })], run: (img, p) => applyAdjustments(img, scaleLook(combineLook({}, p.look), p.mix)) },
  { id: 'brightness-contrast', group: 'adjust', label: 'Brightness and contrast', adjustment: true, params: [range('brightness', 'Brightness', -150, 150, 0), range('contrast', 'Contrast', -50, 100, 0)], run: tone.brightnessContrast },
  { id: 'levels', group: 'adjust', label: 'Levels', adjustment: true, params: [{ key: 'levels', label: 'Levels', type: 'levels', default: { master: { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 } } }], run: (img, p) => tone.levels(img, p.levels ?? p) },
  { id: 'curves', group: 'adjust', label: 'Curves', adjustment: true, params: [{ key: 'curves', label: 'Curves', type: 'curves', default: { rgb: [[0, 0], [255, 255]] } }], run: (img, p) => tone.curves(img, p.curves ?? p) },
  { id: 'exposure', group: 'adjust', label: 'Exposure', adjustment: true, params: [range('exposure', 'Exposure', -5, 5, 0, { step: 0.05, unit: 'EV' }), range('offset', 'Offset', -0.5, 0.5, 0, { step: 0.005 }), range('gamma', 'Gamma', 0.1, 3, 1, { step: 0.01 })], run: tone.exposure },
  { id: 'vibrance', group: 'adjust', label: 'Vibrance', adjustment: true, params: [range('vibrance', 'Vibrance', -100, 100, 0), range('saturation', 'Saturation', -100, 100, 0)], run: tone.vibrance },
  { id: 'hue-saturation', group: 'adjust', label: 'Hue and saturation', adjustment: true, params: [range('hue', 'Hue', -180, 180, 0, { unit: '°' }), range('saturation', 'Saturation', -100, 100, 0), range('lightness', 'Lightness', -100, 100, 0), { key: 'colorize', label: 'Colorize', type: 'checkbox', default: false }, range('colorHue', 'Colorize hue', 0, 360, 30), range('colorSat', 'Colorize saturation', 0, 100, 25)], run: tone.hueSaturation },
  { id: 'color-balance', group: 'adjust', label: 'Color balance', adjustment: true, params: [{ key: 'shadows', label: 'Shadows', type: 'triple', labels: ['Cyan to red', 'Magenta to green', 'Yellow to blue'], min: -100, max: 100, default: [0, 0, 0] }, { key: 'midtones', label: 'Midtones', type: 'triple', labels: ['Cyan to red', 'Magenta to green', 'Yellow to blue'], min: -100, max: 100, default: [0, 0, 0] }, { key: 'highlights', label: 'Highlights', type: 'triple', labels: ['Cyan to red', 'Magenta to green', 'Yellow to blue'], min: -100, max: 100, default: [0, 0, 0] }, { key: 'preserve', label: 'Preserve luminosity', type: 'checkbox', default: true }], run: tone.colorBalance },
  { id: 'black-white', group: 'adjust', label: 'Black and white', adjustment: true, params: [range('reds', 'Reds', -200, 300, 40), range('yellows', 'Yellows', -200, 300, 60), range('greens', 'Greens', -200, 300, 40), range('cyans', 'Cyans', -200, 300, 60), range('blues', 'Blues', -200, 300, 20), range('magentas', 'Magentas', -200, 300, 80), { key: 'tint', label: 'Tint', type: 'checkbox', default: false }, range('tintHue', 'Tint hue', 0, 360, 35), range('tintSat', 'Tint saturation', 0, 100, 15)], run: tone.blackWhite },
  { id: 'photo-filter', group: 'adjust', label: 'Photo filter', adjustment: true, params: [{ key: 'color', label: 'Color', type: 'color', default: '#ec8a00' }, range('density', 'Density', 0, 100, 25, { unit: '%' }), { key: 'preserve', label: 'Preserve luminosity', type: 'checkbox', default: true }], run: tone.photoFilter },
  { id: 'channel-mixer', group: 'adjust', label: 'Channel mixer', adjustment: true, params: [{ key: 'red', label: 'Red output', type: 'mix', default: [100, 0, 0, 0] }, { key: 'green', label: 'Green output', type: 'mix', default: [0, 100, 0, 0] }, { key: 'blue', label: 'Blue output', type: 'mix', default: [0, 0, 100, 0] }, { key: 'monochrome', label: 'Monochrome', type: 'checkbox', default: false }], run: tone.channelMixer },
  { id: 'selective-color', group: 'adjust', label: 'Selective color', adjustment: true, params: [{ key: 'range', label: 'Colors', type: 'select', options: ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas', 'whites', 'neutrals', 'blacks'], default: 'reds' }, range('cyan', 'Cyan', -100, 100, 0, { unit: '%' }), range('magenta', 'Magenta', -100, 100, 0, { unit: '%' }), range('yellow', 'Yellow', -100, 100, 0, { unit: '%' }), range('black', 'Black', -100, 100, 0, { unit: '%' })], run: tone.selectiveColor },
  { id: 'gradient-map', group: 'adjust', label: 'Gradient map', adjustment: true, params: [{ key: 'stops', label: 'Gradient', type: 'gradient', default: [{ at: 0, color: '#120d0a' }, { at: 1, color: '#f3e3c8' }] }, { key: 'reverse', label: 'Reverse', type: 'checkbox', default: false }], run: tone.gradientMap },
  { id: 'invert', group: 'adjust', label: 'Invert', adjustment: true, instant: true, params: [], run: tone.invert },
  { id: 'posterize', group: 'adjust', label: 'Posterize', adjustment: true, params: [range('levels', 'Levels', 2, 32, 4)], run: tone.posterize },
  { id: 'threshold', group: 'adjust', label: 'Threshold', adjustment: true, params: [range('level', 'Level', 1, 255, 128)], run: tone.threshold },
  { id: 'auto', group: 'adjust', label: 'Auto enhance', adjustment: false, instant: true, params: [], run: (img) => applyAdjustments(img, autoEnhance(img)) },
  // blur
  { id: 'gaussian-blur', group: 'blur', label: 'Gaussian blur', params: [range('radius', 'Radius', 0, 250, 4, { step: 0.1, unit: 'px' })], scale: ['radius'], run: fx.gaussianBlur },
  { id: 'box-blur', group: 'blur', label: 'Box blur', params: [range('radius', 'Radius', 1, 200, 4, { unit: 'px' })], scale: ['radius'], run: fx.boxBlur },
  { id: 'motion-blur', group: 'blur', label: 'Motion blur', params: [{ key: 'angle', label: 'Angle', type: 'angle', default: 0 }, range('distance', 'Distance', 1, 400, 20, { unit: 'px' })], scale: ['distance'], run: fx.motionBlur },
  { id: 'radial-blur', group: 'blur', label: 'Radial blur', params: [range('amount', 'Amount', 1, 100, 10), { key: 'mode', label: 'Method', type: 'select', options: ['spin', 'zoom'], default: 'spin' }, { key: 'center', label: 'Center', type: 'point', default: [0.5, 0.5] }], run: (img, p) => fx.radialBlur(img, { ...p, cx: p.center?.[0] ?? 0.5, cy: p.center?.[1] ?? 0.5 }) },
  { id: 'surface-blur', group: 'blur', label: 'Surface blur', params: [range('radius', 'Radius', 1, 20, 5, { unit: 'px' }), range('threshold', 'Threshold', 2, 100, 25)], scale: ['radius'], run: fx.surfaceBlur },
  // sharpen
  { id: 'unsharp-mask', group: 'sharpen', label: 'Unsharp mask', params: [range('amount', 'Amount', 1, 500, 80, { unit: '%' }), range('radius', 'Radius', 0.1, 50, 1.5, { step: 0.1, unit: 'px' }), range('threshold', 'Threshold', 0, 255, 0)], scale: ['radius'], run: fx.unsharpMask },
  { id: 'sharpen', group: 'sharpen', label: 'Sharpen', params: [range('amount', 'Amount', 1, 100, 50)], run: fx.sharpen },
  { id: 'high-pass', group: 'other', label: 'High pass', params: [range('radius', 'Radius', 0.5, 100, 6, { step: 0.5, unit: 'px' })], scale: ['radius'], run: fx.highPass },
  // noise
  { id: 'add-noise', group: 'noise', label: 'Add noise', params: [range('amount', 'Amount', 0, 100, 12, { unit: '%' }), { key: 'distribution', label: 'Distribution', type: 'select', options: ['gaussian', 'uniform'], default: 'gaussian' }, { key: 'monochrome', label: 'Monochromatic', type: 'checkbox', default: true }], run: fx.addNoise },
  { id: 'reduce-noise', group: 'noise', label: 'Reduce noise', params: [range('radius', 'Radius', 1, 10, 1, { unit: 'px' })], scale: ['radius'], run: fx.reduceNoise },
  { id: 'dust-scratches', group: 'noise', label: 'Dust and scratches', params: [range('radius', 'Radius', 1, 16, 2, { unit: 'px' }), range('threshold', 'Threshold', 0, 255, 20)], scale: ['radius'], run: fx.dustAndScratches },
  // stylize
  { id: 'emboss', group: 'stylize', label: 'Emboss', params: [{ key: 'angle', label: 'Angle', type: 'angle', default: 135 }, range('height', 'Height', 1, 10, 2), range('amount', 'Amount', 1, 500, 100, { unit: '%' })], run: fx.emboss },
  { id: 'find-edges', group: 'stylize', label: 'Find edges', instant: true, params: [], run: fx.findEdges },
  { id: 'solarize', group: 'stylize', label: 'Solarize', params: [range('threshold', 'Threshold', 0, 255, 128)], run: fx.solarize },
  { id: 'oil-paint', group: 'stylize', label: 'Oil paint', params: [range('radius', 'Brush size', 1, 20, 4, { unit: 'px' })], scale: ['radius'], run: fx.oilPaint },
  // distort
  { id: 'twirl', group: 'distort', label: 'Twirl', params: [range('angle', 'Angle', -999, 999, 90, { unit: '°' }), range('radius', 'Size', 0.1, 1, 1, { step: 0.01 })], run: fx.twirl },
  { id: 'pinch', group: 'distort', label: 'Pinch', params: [range('amount', 'Amount', -100, 100, 50, { unit: '%' })], run: fx.pinch },
  { id: 'spherize', group: 'distort', label: 'Spherize', params: [range('amount', 'Amount', -100, 100, 60, { unit: '%' })], run: fx.spherize },
  { id: 'ripple', group: 'distort', label: 'Ripple', params: [range('amount', 'Amount', 0, 100, 8, { unit: 'px' }), range('size', 'Size', 4, 200, 24, { unit: 'px' })], scale: ['amount', 'size'], run: fx.ripple },
  { id: 'wave', group: 'distort', label: 'Wave', params: [range('amplitudeX', 'Horizontal amplitude', 0, 200, 10, { unit: 'px' }), range('amplitudeY', 'Vertical amplitude', 0, 200, 0, { unit: 'px' }), range('wavelength', 'Wavelength', 4, 800, 60, { unit: 'px' })], scale: ['amplitudeX', 'amplitudeY', 'wavelength'], run: fx.wave },
  { id: 'polar', group: 'distort', label: 'Polar coordinates', params: [{ key: 'mode', label: 'Direction', type: 'select', options: ['rect-to-polar', 'polar-to-rect'], default: 'rect-to-polar' }], run: fx.polarCoordinates },
  { id: 'offset', group: 'other', label: 'Offset', params: [range('dx', 'Horizontal', -2000, 2000, 50, { unit: 'px' }), range('dy', 'Vertical', -2000, 2000, 50, { unit: 'px' })], scale: ['dx', 'dy'], run: fx.offset },
  // pixelate
  { id: 'mosaic', group: 'pixelate', label: 'Mosaic', params: [range('size', 'Cell size', 2, 200, 12, { unit: 'px' })], scale: ['size'], run: fx.mosaic },
  { id: 'crystallize', group: 'pixelate', label: 'Crystallize', params: [range('size', 'Cell size', 3, 200, 16, { unit: 'px' })], scale: ['size'], run: fx.crystallize },
  { id: 'color-halftone', group: 'pixelate', label: 'Color halftone', params: [range('size', 'Dot size', 3, 64, 8, { unit: 'px' })], scale: ['size'], run: fx.colorHalftone },
  // render
  { id: 'clouds', group: 'render', label: 'Clouds', params: [range('scale', 'Scale', 10, 1000, 140, { unit: 'px' }), { key: 'foreground', label: 'Foreground', type: 'color', default: '#1c1714' }, { key: 'background', label: 'Background', type: 'color', default: '#e8dcc8' }, range('seed', 'Variation', 1, 999, 5)], scale: ['scale'], run: fx.clouds },
  { id: 'difference-clouds', group: 'render', label: 'Difference clouds', params: [range('scale', 'Scale', 10, 1000, 140, { unit: 'px' }), range('seed', 'Variation', 1, 999, 9)], scale: ['scale'], run: (img, p) => fx.clouds(img, { ...p, difference: true, foreground: '#000000', background: '#ffffff' }) },
  { id: 'vignette', group: 'render', label: 'Vignette', adjustment: false, params: [range('amount', 'Amount', 0, 100, 50, { unit: '%' }), range('roundness', 'Roundness', 0.5, 2, 1, { step: 0.05 }), { key: 'color', label: 'Color', type: 'color', default: '#000000' }], run: fx.vignette },
  // other
  { id: 'minimum', group: 'other', label: 'Minimum', params: [range('radius', 'Radius', 1, 50, 1, { unit: 'px' })], scale: ['radius'], run: fx.minimum },
  { id: 'maximum', group: 'other', label: 'Maximum', params: [range('radius', 'Radius', 1, 50, 1, { unit: 'px' })], scale: ['radius'], run: fx.maximum },
];

export const FILTER_GROUPS = ['blur', 'sharpen', 'noise', 'stylize', 'distort', 'pixelate', 'render', 'other'];

function scaleLook(adjust, mix = 100) {
  const k = mix / 100;
  return Object.fromEntries(Object.entries(adjust).map(([key, v]) => [key, v * k]));
}

export const getFilter = (id) => FILTERS.find((f) => f.id === id) ?? null;

/** Default parameters for a filter. */
export function defaults(id) {
  const f = getFilter(id);
  if (!f) throw new Error(`Unknown filter ${id}`);
  return Object.fromEntries(f.params.map((p) => [p.key, structuredClone(p.default)]));
}

/** Fills in and clamps parameters. */
export function normalizeParams(id, params = {}) {
  const f = getFilter(id);
  if (!f) throw new Error(`Unknown filter ${id}`);
  const out = defaults(id);
  for (const p of f.params) {
    const v = params?.[p.key];
    if (v === undefined || v === null) continue;
    if (p.type === 'range' || p.type === 'angle') {
      const n = Number(v);
      if (Number.isFinite(n)) out[p.key] = p.type === 'range' ? Math.max(p.min, Math.min(p.max, n)) : ((n % 360) + 360) % 360;
    } else if (p.type === 'checkbox') out[p.key] = v === true;
    else if (p.type === 'select') out[p.key] = p.options.includes(v) ? v : out[p.key];
    else if (p.type === 'color') out[p.key] = /^#[0-9a-f]{6}$/i.test(v) ? v : out[p.key];
    else out[p.key] = structuredClone(v);
  }
  return out;
}

/**
 * Runs a filter. scale (0..1] is the size of the image relative to the full image, so radius
 * like parameters shrink with a preview and the preview looks like the final result.
 */
export function runFilter(id, img, params = {}, { scale = 1 } = {}) {
  const f = getFilter(id);
  if (!f) throw new Error(`Unknown filter ${id}`);
  const p = normalizeParams(id, params);
  if (scale !== 1 && f.scale) for (const k of f.scale) p[k] = p[k] * scale;
  return f.run(img, p);
}
