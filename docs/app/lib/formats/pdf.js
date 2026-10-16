// Generated from src/formats/pdf.js by scripts/build-app.mjs. Edit the source, not this copy.
// PDF: a small writer of our own and a small image reader.
// The writer puts each page's pixels in one image, RGB with a soft mask for transparency, or
// DeviceCMYK ink values for print (flate compressed), or a JPEG stream when one is given. Page
// size follows the resolution, so a 300 dpi image prints at its real size.
// The reader pulls image XObjects out of simple PDFs (like the ones we write). Any other PDF is
// rendered page by page in the browser with pdf.js, loaded on demand (see the app's codecs).

import { FormatError, ascii, startsWith, zlibDeflate, zlibInflate } from './binary.js';
import { cmykToRgb } from '../color/cmyk.js';

export const isPdf = (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46]);

const enc = new TextEncoder();
const num = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/0+$/, '').replace(/\.$/, ''));

/**
 * pages: [{ width, height, data (RGBA) } | { width, height, cmyk } | { width, height, jpeg }]
 * options: { dpi = 72, title }
 */
export async function encodePdf(pages, { dpi = 72, title = 'pixelotter' } = {}) {
  const list = Array.isArray(pages) ? pages : [pages];
  const objects = []; // index = object number - 1
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };
  const catalog = add(null);
  const pagesObj = add(null);
  const info = add(enc.encode(`<< /Producer (pixelotter) /Title (${String(title).replace(/[()\\]/g, '')}) >>`));
  const kids = [];
  for (const pg of list) {
    const ptsW = (pg.width * 72) / dpi;
    const ptsH = (pg.height * 72) / dpi;
    let imgDict;
    let stream;
    let smask = 0;
    if (pg.jpeg) {
      imgDict = `/Type /XObject /Subtype /Image /Width ${pg.width} /Height ${pg.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`;
      stream = pg.jpeg;
    } else if (pg.cmyk) {
      imgDict = `/Type /XObject /Subtype /Image /Width ${pg.width} /Height ${pg.height} /ColorSpace /DeviceCMYK /BitsPerComponent 8 /Filter /FlateDecode`;
      stream = await zlibDeflate(pg.cmyk);
    } else {
      const n = pg.width * pg.height;
      const rgb = new Uint8Array(n * 3);
      const a = new Uint8Array(n);
      let hasAlpha = false;
      for (let i = 0; i < n; i++) {
        rgb[i * 3] = pg.data[i * 4];
        rgb[i * 3 + 1] = pg.data[i * 4 + 1];
        rgb[i * 3 + 2] = pg.data[i * 4 + 2];
        a[i] = pg.data[i * 4 + 3];
        if (a[i] !== 255) hasAlpha = true;
      }
      if (hasAlpha) {
        const z = await zlibDeflate(a);
        smask = add([`<< /Type /XObject /Subtype /Image /Width ${pg.width} /Height ${pg.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${z.length} >>`, z]);
      }
      imgDict = `/Type /XObject /Subtype /Image /Width ${pg.width} /Height ${pg.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${smask ? ` /SMask ${smask} 0 R` : ''}`;
      stream = await zlibDeflate(rgb);
    }
    const img = add([`<< ${imgDict} /Length ${stream.length} >>`, stream]);
    const content = enc.encode(`q ${num(ptsW)} 0 0 ${num(ptsH)} 0 0 cm /Im0 Do Q`);
    const contents = add([`<< /Length ${content.length} >>`, content]);
    kids.push(add(enc.encode(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${num(ptsW)} ${num(ptsH)}] /Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${contents} 0 R >>`)));
  }
  objects[catalog - 1] = enc.encode(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);
  objects[pagesObj - 1] = enc.encode(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);
  const parts = [ascii('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')];
  let offset = parts[0].length;
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(offset);
    const head = enc.encode(`${i + 1} 0 obj\n`);
    const chunk = Array.isArray(body) ? [head, enc.encode(`${body[0]}\nstream\n`), body[1], enc.encode('\nendstream\nendobj\n')] : [head, body, enc.encode('\nendobj\n')];
    for (const c of chunk) {
      parts.push(c);
      offset += c.length;
    }
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
  parts.push(enc.encode(`${xref}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${offset}\n%%EOF\n`));
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const latin1 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 65536) s += String.fromCharCode(...bytes.subarray(i, i + 65536));
  return s;
};

/**
 * Pulls the image XObjects out of a simple PDF: 8 bit DeviceRGB, DeviceGray or DeviceCMYK with
 * FlateDecode or no filter, with soft masks. Returns [{ width, height, data, cmyk? }]. Throws
 * 'needs-renderer' for anything else, so the caller can fall back to pdf.js.
 */
export async function extractPdfImages(bytes) {
  if (!isPdf(bytes)) throw new FormatError('Not a PDF file');
  const text = latin1(bytes);
  const objs = new Map();
  // one object at a time: the dictionary may not run past this object's endobj
  const re = /(\d+)\s+0\s+obj\s*<<((?:(?!endobj)[\s\S])*?)>>\s*stream\r?\n/g;
  let m;
  while ((m = re.exec(text))) {
    const dict = m[2];
    const lenM = /\/Length\s+(\d+)(\s+0\s+R)?/.exec(dict);
    if (!lenM || lenM[2]) continue;
    const start = m.index + m[0].length;
    objs.set(+m[1], { dict, data: bytes.subarray(start, start + +lenM[1]) });
  }
  const images = [];
  const masks = new Set();
  for (const [, o] of objs) {
    const sm = /\/SMask\s+(\d+)\s+0\s+R/.exec(o.dict);
    if (sm) masks.add(+sm[1]);
  }
  for (const [id, o] of objs) {
    if (!/\/Subtype\s*\/Image/.test(o.dict) || masks.has(id)) continue;
    const w = +/\/Width\s+(\d+)/.exec(o.dict)?.[1];
    const h = +/\/Height\s+(\d+)/.exec(o.dict)?.[1];
    const cs = /\/ColorSpace\s*\/(\w+)/.exec(o.dict)?.[1];
    const bpc = +/\/BitsPerComponent\s+(\d+)/.exec(o.dict)?.[1];
    const filter = /\/Filter\s*\/(\w+)/.exec(o.dict)?.[1] ?? null;
    if (bpc !== 8 || !['DeviceRGB', 'DeviceGray', 'DeviceCMYK'].includes(cs) || (filter && filter !== 'FlateDecode')) throw new FormatError('This PDF needs the full renderer', 'needs-renderer');
    const raw = filter ? await zlibInflate(o.data) : o.data;
    const n = w * h;
    const data = new Uint8ClampedArray(n * 4);
    let cmyk = null;
    if (cs === 'DeviceCMYK') {
      cmyk = raw.slice(0, n * 4);
      const cache = new Map();
      for (let i = 0; i < n; i++) {
        const key = (raw[i * 4] << 24) | (raw[i * 4 + 1] << 16) | (raw[i * 4 + 2] << 8) | raw[i * 4 + 3];
        let rgb = cache.get(key);
        if (!rgb) {
          rgb = cmykToRgb(...[0, 1, 2, 3].map((c) => (raw[i * 4 + c] / 255) * 100));
          cache.set(key, rgb);
        }
        data.set([...rgb, 255], i * 4);
      }
    } else {
      const ch = cs === 'DeviceRGB' ? 3 : 1;
      for (let i = 0; i < n; i++) {
        const r = raw[i * ch];
        data[i * 4] = r;
        data[i * 4 + 1] = ch === 3 ? raw[i * 3 + 1] : r;
        data[i * 4 + 2] = ch === 3 ? raw[i * 3 + 2] : r;
        data[i * 4 + 3] = 255;
      }
    }
    const sm = /\/SMask\s+(\d+)\s+0\s+R/.exec(o.dict);
    if (sm && objs.has(+sm[1])) {
      const mo = objs.get(+sm[1]);
      const a = /FlateDecode/.test(mo.dict) ? await zlibInflate(mo.data) : mo.data;
      for (let i = 0; i < n; i++) data[i * 4 + 3] = a[i];
    }
    images.push({ width: w, height: h, data, cmyk, colorMode: cs === 'DeviceCMYK' ? 'cmyk' : 'rgb' });
  }
  if (!images.length) throw new FormatError('This PDF needs the full renderer', 'needs-renderer');
  return images;
}
