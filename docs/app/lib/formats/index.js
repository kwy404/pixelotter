// Generated from src/formats/index.js by scripts/build-app.mjs. Edit the source, not this copy.
// One door for every file format: sniff(bytes, name), decode(bytes, options) and
// encode(input, format, options). Formats are recognized by their magic bytes first and by the
// file name only when a format has none (TGA, some raw files).
//
// Our own code reads and writes PNG and APNG, GIF, BMP, ICO, TGA, TIFF, PSD and PSB, and writes
// PDF; it reads PBM, PGM, PPM, PAM, Radiance HDR, OpenEXR, simple PDFs and the previews inside
// camera raw files. JPEG, WebP and AVIF (and HEIC where the browser can) go through the
// browser's own codecs, SVG is drawn by the browser, and other PDFs are rendered by pdf.js
// loaded on demand. Those need a `platform` object from the app:
//   platform.decodeBitmap(bytes, mime) -> { width, height, data }
//   platform.encodeBitmap(image, mime, quality) -> Uint8Array, or null when unsupported
//   platform.renderSvg(bytes) -> { width, height, data }
//   platform.renderPdf(bytes) -> [{ width, height, data }]

import { FormatError, startsWith } from './binary.js';
import { decodePng, encodePng, isPng } from './png.js';
import { decodeGif, encodeGif, isGif } from './gif.js';
import { decodeBmp, decodeIco, encodeBmp, encodeIco, isBmp, isIco } from './bmp.js';
import { decodePnm, decodeTga, encodeTga, isPnm, looksLikeTga } from './tga.js';
import { decodeTiff, encodeTiff, isTiff } from './tiff.js';
import { decodePsd, encodePsd, isPsd } from './psd.js';
import { encodePdf, extractPdfImages, isPdf } from './pdf.js';
import { decodeExr, decodeHdr, isExr, isHdr } from './hdr.js';
import { findPreviews, isRaw } from './raw.js';

export { FormatError };

export const FORMATS = {
  png: { label: 'PNG', mime: 'image/png', ext: 'png', read: true, write: true, alpha: true, frames: true },
  jpeg: { label: 'JPEG', mime: 'image/jpeg', ext: 'jpg', read: true, write: true, quality: true, browser: true },
  webp: { label: 'WebP', mime: 'image/webp', ext: 'webp', read: true, write: true, alpha: true, quality: true, browser: true },
  avif: { label: 'AVIF', mime: 'image/avif', ext: 'avif', read: true, write: true, alpha: true, quality: true, browser: true },
  gif: { label: 'GIF', mime: 'image/gif', ext: 'gif', read: true, write: true, alpha: true, frames: true },
  bmp: { label: 'BMP', mime: 'image/bmp', ext: 'bmp', read: true, write: true, alpha: true },
  ico: { label: 'ICO', mime: 'image/x-icon', ext: 'ico', read: true, write: true, alpha: true },
  tga: { label: 'TGA', mime: 'image/x-tga', ext: 'tga', read: true, write: true, alpha: true },
  tiff: { label: 'TIFF', mime: 'image/tiff', ext: 'tif', read: true, write: true, alpha: true, cmyk: true, pages: true },
  psd: { label: 'PSD', mime: 'image/vnd.adobe.photoshop', ext: 'psd', read: true, write: true, alpha: true, cmyk: true, layers: true },
  psb: { label: 'PSB', mime: 'application/octet-stream', ext: 'psb', read: true, write: true, alpha: true, cmyk: true, layers: true },
  pdf: { label: 'PDF', mime: 'application/pdf', ext: 'pdf', read: true, write: true, cmyk: true, pages: true },
  svg: { label: 'SVG', mime: 'image/svg+xml', ext: 'svg', read: true, write: false, browser: true },
  heic: { label: 'HEIC', mime: 'image/heic', ext: 'heic', read: true, write: false, browser: true },
  raw: { label: 'Camera raw (preview)', mime: 'application/octet-stream', ext: 'raw', read: true, write: false },
  exr: { label: 'OpenEXR', mime: 'image/x-exr', ext: 'exr', read: true, write: false },
  hdr: { label: 'Radiance HDR', mime: 'image/vnd.radiance', ext: 'hdr', read: true, write: false },
  pnm: { label: 'PBM, PGM, PPM, PAM', mime: 'image/x-portable-anymap', ext: 'ppm', read: true, write: false },
};

export const WRITABLE = Object.keys(FORMATS).filter((k) => FORMATS[k].write);

const ascii = (b, from, to) => String.fromCharCode(...b.subarray(from, to));

/** Recognizes a file. Returns a format id or null. */
export function sniff(bytes, name = '') {
  const ext = String(name).toLowerCase().split('.').pop();
  if (isPng(bytes)) return 'png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (isGif(bytes)) return 'gif';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'webp';
  if (isPsd(bytes)) return bytes[5] === 2 ? 'psb' : 'psd';
  if (isPdf(bytes)) return 'pdf';
  if (isExr(bytes)) return 'exr';
  if (isHdr(bytes)) return 'hdr';
  const brand = ascii(bytes, 4, 12);
  if (brand === 'ftypavif' || brand === 'ftypavis') return 'avif';
  if (/^ftyp(heic|heix|hevc|heim|heis|mif1|msf1)/.test(brand)) return 'heic';
  if (isRaw(bytes, name) && !['tif', 'tiff'].includes(ext)) return 'raw';
  if (isTiff(bytes)) return 'tiff';
  if (isBmp(bytes)) return 'bmp';
  if (isIco(bytes) && ['ico', 'cur'].includes(ext)) return 'ico';
  if (isPnm(bytes)) return 'pnm';
  const head = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg')) || ext === 'svg') return 'svg';
  if (isIco(bytes)) return 'ico';
  if (ext === 'tga' && looksLikeTga(bytes)) return 'tga';
  if (looksLikeTga(bytes) && ext === 'tga') return 'tga';
  return null;
}

const single = (img, name = 'Background') => [{ kind: 'raster', name, x: 0, y: 0, width: img.width, height: img.height, data: img.data, opacity: 1, blend: 'normal', visible: true }];

function needPlatform(platform, fn, label) {
  if (!platform?.[fn]) throw new FormatError(`${label} needs the browser to decode it`, 'unsupported');
  return platform[fn];
}

/**
 * Decodes a file into { format, width, height, colorMode, layers, frames, notes }.
 * layers are bottom to top; frames (animations) are [{ layer, delay }] in play order.
 */
export async function decode(input, { name = '', platform = null } = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const format = sniff(bytes, name);
  if (!format) throw new FormatError('This file type is not recognized', 'unknown');
  const notes = [];
  const flat = (img, colorMode = 'rgb') => ({ format, width: img.width, height: img.height, colorMode, layers: single(img), notes });
  const animated = (img, frames) => {
    const layers = frames.map((f, i) => ({ kind: 'raster', name: `Frame ${i + 1}`, x: 0, y: 0, width: img.width, height: img.height, data: f.data, opacity: 1, blend: 'normal', visible: i === 0 }));
    return { format, width: img.width, height: img.height, colorMode: 'rgb', layers, frames: frames.map((f, i) => ({ layer: i, delay: f.delay ?? 100 })), notes };
  };
  switch (format) {
    case 'png': {
      const img = await decodePng(bytes);
      return img.frames ? animated(img, img.frames) : flat(img);
    }
    case 'gif': {
      const img = decodeGif(bytes);
      return img.frames ? animated(img, img.frames) : flat(img);
    }
    case 'bmp':
      return flat(decodeBmp(bytes));
    case 'ico':
      return flat(await decodeIco(bytes));
    case 'tga':
      return flat(decodeTga(bytes));
    case 'pnm':
      return flat(decodePnm(bytes));
    case 'hdr':
      notes.push('tone-mapped');
      return flat(decodeHdr(bytes));
    case 'exr':
      notes.push('tone-mapped');
      return flat(await decodeExr(bytes));
    case 'tiff': {
      const img = await decodeTiff(bytes);
      const pages = img.pages ?? [img];
      const W = Math.max(...pages.map((p) => p.width));
      const H = Math.max(...pages.map((p) => p.height));
      const layers = pages.map((p, i) => ({ kind: 'raster', name: p.name || (pages.length > 1 ? `Page ${i + 1}` : 'Background'), x: 0, y: 0, width: p.width, height: p.height, data: p.data, opacity: 1, blend: 'normal', visible: true }));
      return { format, width: W, height: H, colorMode: img.colorMode, layers, notes };
    }
    case 'psd':
    case 'psb': {
      const doc = await decodePsd(bytes);
      const layers = doc.layers.length ? doc.layers : single(doc);
      if (doc.colorMode === 'cmyk') notes.push('cmyk-converted');
      return { format, width: doc.width, height: doc.height, colorMode: doc.colorMode, layers, composite: doc.data, notes };
    }
    case 'pdf': {
      let pages;
      try {
        pages = await extractPdfImages(bytes);
      } catch (err) {
        if (err.code !== 'needs-renderer') throw err;
        pages = await needPlatform(platform, 'renderPdf', 'This PDF')(bytes);
        notes.push('pdf-rendered');
      }
      const W = Math.max(...pages.map((p) => p.width));
      const H = Math.max(...pages.map((p) => p.height));
      const layers = pages.map((p, i) => ({ kind: 'raster', name: pages.length > 1 ? `Page ${i + 1}` : 'Page', x: 0, y: 0, width: p.width, height: p.height, data: p.data, opacity: 1, blend: 'normal', visible: i === 0 || pages.length === 1 }));
      return { format, width: W, height: H, colorMode: pages[0].colorMode ?? 'rgb', layers, notes };
    }
    case 'raw': {
      const previews = findPreviews(bytes);
      const decodeBitmap = needPlatform(platform, 'decodeBitmap', 'A camera raw preview');
      for (const p of previews) {
        try {
          const img = await decodeBitmap(bytes.subarray(p.offset, p.offset + p.length), 'image/jpeg');
          notes.push('raw-preview');
          return flat(img);
        } catch {
          // try the next preview
        }
      }
      throw new FormatError('No preview image was found in this raw file. Export a JPEG or TIFF from your camera software first.', 'unsupported');
    }
    case 'svg':
      return flat(await needPlatform(platform, 'renderSvg', 'SVG')(bytes));
    case 'heic':
    case 'jpeg':
    case 'webp':
    case 'avif': {
      const decodeBitmap = needPlatform(platform, 'decodeBitmap', FORMATS[format].label);
      try {
        return flat(await decodeBitmap(bytes, FORMATS[format].mime));
      } catch {
        if (format === 'heic') throw new FormatError('This browser cannot open HEIC photos. Safari can, or export the photo as JPEG first.', 'unsupported');
        throw new FormatError(`This ${FORMATS[format].label} file could not be decoded`, 'damaged');
      }
    }
    default:
      throw new FormatError('This file type is not supported', 'unsupported');
  }
}

/**
 * Encodes a picture. input: { width, height, composite, cmyk?, layers?, frames?, pages? }
 *   composite  flattened RGBA of the whole document
 *   cmyk       ink bytes for the composite (TIFF, PSD and PDF in CMYK mode)
 *   layers     layer records for PSD and PSB (see psd.js)
 *   frames     [{ data, delay }] for animated GIF and PNG
 *   pages      [{ width, height, data, name }] for multi page TIFF and PDF
 * options: { quality (0 to 1), cmyk, dpi, animated, sizes (ICO), compression (TIFF) }
 * Returns { bytes, mime, ext }.
 */
export async function encode(input, format, opts = {}, platform = null) {
  const f = FORMATS[format];
  if (!f?.write) throw new FormatError(`Saving as ${f?.label ?? format} is not supported`, 'unsupported');
  const img = { width: input.width, height: input.height, data: input.composite };
  let bytes;
  switch (format) {
    case 'png':
      bytes = await encodePng(img, { frames: opts.animated ? input.frames : null, dpi: opts.dpi });
      break;
    case 'gif':
      bytes = encodeGif(img, { frames: opts.animated ? input.frames : null, dither: opts.dither !== false });
      break;
    case 'bmp':
      bytes = encodeBmp(img);
      break;
    case 'tga':
      bytes = encodeTga(img);
      break;
    case 'ico': {
      const sizes = (opts.sizes ?? [16, 32, 48, 256]).filter((s) => s <= 256);
      const scaled = [];
      for (const s of sizes) scaled.push(opts.resize ? await opts.resize(img, s, s) : img);
      bytes = await encodeIco(scaled);
      break;
    }
    case 'tiff': {
      const pages = opts.pages && input.pages?.length ? input.pages : [opts.cmyk ? { width: img.width, height: img.height, cmyk: input.cmyk } : img];
      bytes = await encodeTiff(pages, { compression: opts.compression ?? 'lzw', dpi: opts.dpi ?? 72, names: pages.map((p) => p.name) });
      break;
    }
    case 'psd':
    case 'psb':
      bytes = encodePsd({ width: img.width, height: img.height, composite: img.data, compositeCmyk: input.cmyk, layers: input.layers ?? single(img) }, { psb: format === 'psb', cmyk: !!opts.cmyk });
      break;
    case 'pdf': {
      const pages = opts.pages && input.pages?.length ? input.pages : [opts.cmyk ? { width: img.width, height: img.height, cmyk: input.cmyk } : opts.jpeg ? { width: img.width, height: img.height, jpeg: opts.jpeg } : img];
      bytes = await encodePdf(pages, { dpi: opts.dpi ?? 72, title: opts.title });
      break;
    }
    default: {
      const encodeBitmap = needPlatform(platform, 'encodeBitmap', f.label);
      bytes = await encodeBitmap(img, f.mime, opts.quality ?? 0.9);
      if (!bytes) throw new FormatError(`This browser cannot save ${f.label} files. Choose PNG or JPEG instead.`, 'unsupported');
    }
  }
  return { bytes, mime: f.mime, ext: f.ext };
}
