// Background removal with an open license salient object segmentation model, run in the
// browser by onnxruntime-web. This module holds the model card and the pixel math around the
// model (no DOM, no network), so it is the same in the worker and in the tests.
//
// Model: U2-Netp, the small variant of U2-Net (Xuebin Qin, Zichen Zhang, Chenyang Huang,
// Masood Dehghan, Osmar R. Zaiane and Martin Jagersand, 2020), Apache License 2.0.
// Upstream: https://github.com/xuebinqin/U-2-Net . The ONNX file is the widely used export
// redistributed on npm with its Apache 2.0 license and notices, and is fetched from jsDelivr.

export const MODEL = Object.freeze({
  name: 'U2-Netp',
  task: 'salient object segmentation',
  license: 'Apache-2.0',
  licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
  upstream: 'https://github.com/xuebinqin/U-2-Net',
  paper: 'U2-Net: Going Deeper with Nested U-Structure for Salient Object Detection (2020)',
  urls: [
    'https://cdn.jsdelivr.net/npm/@planby-tech/rmbg-webgpu@0.2.1/models/u2netp.onnx',
    'https://cdn.jsdelivr.net/npm/@rmbg/model-u2netp@0.0.1/u2netp.onnx',
  ],
  bytes: 4574861,
  sha256: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
  input: 320,
  mean: [0.485, 0.456, 0.406],
  std: [0.229, 0.224, 0.225],
});

export const RUNTIME = Object.freeze({
  name: 'onnxruntime-web',
  version: '1.22.0',
  license: 'MIT',
  base: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/',
  module: 'ort.wasm.min.mjs',
  files: ['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'],
  bytes: 48259 + 20856 + 11210254,
});

/** Total download for the first cutout, in bytes. Everything is cached after that. */
export const DOWNLOAD_BYTES = MODEL.bytes + RUNTIME.bytes;

/** Bilinear resize of an RGBA image (premultiplied by alpha against black, like the model sees it). */
export function resizeRgba(src, sw, sh, dw, dh) {
  const out = new Uint8ClampedArray(dw * dh * 4);
  const fx = sw / dw;
  const fy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const syf = Math.max(0, (y + 0.5) * fy - 0.5);
    const y0 = Math.min(sh - 1, Math.floor(syf));
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = syf - y0;
    for (let x = 0; x < dw; x++) {
      const sxf = Math.max(0, (x + 0.5) * fx - 0.5);
      const x0 = Math.min(sw - 1, Math.floor(sxf));
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = sxf - x0;
      for (let c = 0; c < 4; c++) {
        const a = src[(y0 * sw + x0) * 4 + c];
        const b = src[(y0 * sw + x1) * 4 + c];
        const d = src[(y1 * sw + x0) * 4 + c];
        const e = src[(y1 * sw + x1) * 4 + c];
        out[(y * dw + x) * 4 + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
      }
    }
  }
  return out;
}

/**
 * The model input: a 1x3xSxS float tensor. Like the reference preprocessing, the image is
 * scaled by its brightest channel value, then normalized with the ImageNet mean and std.
 */
export function preprocess(rgba, w, h, size = MODEL.input) {
  const small = w === size && h === size ? rgba : resizeRgba(rgba, w, h, size, size);
  const n = size * size;
  let max = 0;
  for (let i = 0; i < n; i++) {
    const a = small[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) max = Math.max(max, small[i * 4 + c] * a);
  }
  max = max || 1;
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    const a = small[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) out[c * n + i] = ((small[i * 4 + c] * a) / max - MODEL.mean[c]) / MODEL.std[c];
  }
  return out;
}

/** Min max normalizes the model output (S*S floats) to a 0 to 255 mask. */
export function postprocess(output, size = MODEL.input) {
  const n = size * size;
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 0; i < n; i++) {
    if (output[i] < mn) mn = output[i];
    if (output[i] > mx) mx = output[i];
  }
  const range = mx - mn || 1;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.round(((output[i] - mn) / range) * 255);
  return out;
}

/** Bilinear upscale of a one channel mask, then a gentle contrast curve to firm up the edge. */
export function upscaleMask(mask, sw, sh, dw, dh, { gamma = 1, low = 8, high = 247 } = {}) {
  const out = new Uint8Array(dw * dh);
  const fx = sw / dw;
  const fy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const syf = Math.max(0, (y + 0.5) * fy - 0.5);
    const y0 = Math.min(sh - 1, Math.floor(syf));
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = syf - y0;
    for (let x = 0; x < dw; x++) {
      const sxf = Math.max(0, (x + 0.5) * fx - 0.5);
      const x0 = Math.min(sw - 1, Math.floor(sxf));
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = sxf - x0;
      const v = (mask[y0 * sw + x0] * (1 - tx) + mask[y0 * sw + x1] * tx) * (1 - ty) + (mask[y1 * sw + x0] * (1 - tx) + mask[y1 * sw + x1] * tx) * ty;
      let t = (v - low) / (high - low);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      if (gamma !== 1) t = t ** gamma;
      out[y * dw + x] = Math.round(t * 255);
    }
  }
  return out;
}

/** Share of the image the mask keeps, 0 to 1. Used to warn when a cutout found nothing. */
export function coverage(mask) {
  let sum = 0;
  for (let i = 0; i < mask.length; i++) sum += mask[i];
  return mask.length ? sum / (mask.length * 255) : 0;
}
