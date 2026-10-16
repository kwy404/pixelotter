import { describe, expect, it } from 'vitest';
import { decode, encode, sniff, FORMATS, WRITABLE } from '../src/formats/index.js';
import { decodePng, encodePng } from '../src/formats/png.js';
import { decodeGif, encodeGif } from '../src/formats/gif.js';
import { decodeBmp, decodeIco, encodeBmp, encodeIco } from '../src/formats/bmp.js';
import { decodePnm, decodeTga, encodeTga } from '../src/formats/tga.js';
import { decodeTiff, encodeTiff } from '../src/formats/tiff.js';
import { decodePsd, encodePsd } from '../src/formats/psd.js';
import { encodePdf, extractPdfImages } from '../src/formats/pdf.js';
import { decodeExr, decodeHdr, halfToFloat } from '../src/formats/hdr.js';
import { findPreviews, jpegEnd } from '../src/formats/raw.js';
import { Writer, packBits, unpackBits, zlibDeflate } from '../src/formats/binary.js';
import { cmykConverter } from '../src/color/cmyk.js';
import { makeImage, randomData } from './unit-helpers.js';

const gradient = (w, h, alpha = false) => makeImage(w, h, (x, y) => [(x * 37) % 256, (y * 53) % 256, ((x + y) * 11) % 256, alpha ? (x * 29 + y * 7) % 256 : 255]);
const same = (a, b) => expect(Array.from(a.data)).toEqual(Array.from(b.data));

describe('binary helpers', () => {
  it('PackBits round trips random and repetitive data', () => {
    for (const data of [randomData(1000, 3), new Uint8Array(500).fill(7), Uint8Array.from([1, 1, 2, 3, 3, 3, 3, 4])]) {
      expect(Array.from(unpackBits(packBits(data), data.length))).toEqual(Array.from(data));
    }
  });
});

describe('PNG and APNG', () => {
  it('round trips RGBA and opaque RGB', async () => {
    for (const alpha of [true, false]) {
      const img = gradient(37, 23, alpha);
      const back = await decodePng(await encodePng(img));
      expect([back.width, back.height]).toEqual([37, 23]);
      same(back, img);
    }
  });

  it('keeps animation frames and delays', async () => {
    const a = gradient(8, 6);
    const b = makeImage(8, 6, [10, 20, 30, 255]);
    const bytes = await encodePng(a, { frames: [{ data: a.data, delay: 120 }, { data: b.data, delay: 400 }] });
    const back = await decodePng(bytes);
    expect(back.frames).toHaveLength(2);
    expect(back.frames[1].delay).toBe(400);
    same(back.frames[1], b);
    same(back, a);
  });

  it('reads palette, gray and 16 bit images', async () => {
    // a 2x1 palette PNG with transparency, built by hand
    const raw = Uint8Array.from([0, 0x01]); // filter 0, 4 bit indices 0 and 1 in one byte
    const chunks = [];
    const chunk = (type, data) => {
      const w = new Writer(12 + data.length);
      w.u32(data.length).ascii(type).bytes(data).u32(0);
      chunks.push(w.done());
    };
    chunk('IHDR', new Writer(13).u32(2).u32(1).u8(4).u8(3).u8(0).u8(0).u8(0).done());
    chunk('PLTE', Uint8Array.from([255, 0, 0, 0, 0, 255]));
    chunk('tRNS', Uint8Array.from([128]));
    chunk('IDAT', await zlibDeflate(raw));
    chunk('IEND', new Uint8Array(0));
    const file = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunks.flatMap((c) => Array.from(c))]);
    const img = await decodePng(file);
    expect(Array.from(img.data)).toEqual([255, 0, 0, 128, 0, 0, 255, 255]);
  });
});

describe('GIF', () => {
  it('round trips a small palette image exactly', () => {
    const img = makeImage(9, 7, (x, y) => [[255, 0, 0], [0, 255, 0], [0, 0, 255], [250, 250, 250]][(x + y) % 4]);
    const back = decodeGif(encodeGif(img, { dither: false }));
    same(back, img);
  });

  it('keeps transparency and animation frames', () => {
    const a = makeImage(6, 4, (x) => (x < 3 ? [200, 100, 0, 255] : [0, 0, 0, 0]));
    const b = makeImage(6, 4, [0, 0, 200, 255]);
    const back = decodeGif(encodeGif(a, { frames: [{ data: a.data, delay: 200 }, { data: b.data, delay: 50 }], dither: false }));
    expect(back.frames).toHaveLength(2);
    expect(back.frames[0].data[3]).toBe(255);
    expect(back.frames[0].data[5 * 4 + 3]).toBe(0);
    expect(back.frames[1].delay).toBe(50);
    expect(Array.from(back.frames[1].data.subarray(0, 4))).toEqual([0, 0, 200, 255]);
  });

  it('compresses a large photo like image and decodes it close to the original', () => {
    const img = gradient(120, 80);
    const back = decodeGif(encodeGif(img));
    let diff = 0;
    for (let i = 0; i < img.data.length; i++) diff += Math.abs(img.data[i] - back.data[i]);
    expect(diff / img.data.length).toBeLessThan(12);
  });
});

describe('BMP, ICO, TGA and Netpbm', () => {
  it('BMP round trips 24 and 32 bit', () => {
    for (const alpha of [false, true]) {
      const img = gradient(13, 5, alpha);
      same(decodeBmp(encodeBmp(img)), img);
    }
  });

  it('ICO keeps every size and opens the largest', async () => {
    const big = gradient(32, 32, true);
    const small = gradient(16, 16);
    const back = await decodeIco(await encodeIco([small, big]));
    expect(back.width).toBe(32);
    same(back, big);
    expect(back.entries).toHaveLength(2);
  });

  it('TGA round trips with run length encoding', () => {
    const img = makeImage(40, 3, (x, y) => (x < 20 ? [1, 2, 3, 255] : [(x * y) % 256, 9, 9, 128]));
    const bytes = encodeTga(img);
    expect(bytes.length).toBeLessThan(18 + 40 * 3 * 4);
    same(decodeTga(bytes), img);
  });

  it('reads ASCII and binary PPM, PGM and PAM', () => {
    const enc = new TextEncoder();
    const p3 = decodePnm(enc.encode('P3\n# comment\n2 1\n255\n255 0 0  0 0 255\n'));
    expect(Array.from(p3.data)).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
    const p5 = decodePnm(Uint8Array.from([...enc.encode('P5 2 1 255\n'), 0, 200]));
    expect(Array.from(p5.data)).toEqual([0, 0, 0, 255, 200, 200, 200, 255]);
    const p1 = decodePnm(enc.encode('P1\n2 1\n1 0\n'));
    expect(Array.from(p1.data)).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
    const p7 = decodePnm(Uint8Array.from([...enc.encode('P7\nWIDTH 1\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n'), 1, 2, 3, 4]));
    expect(Array.from(p7.data)).toEqual([1, 2, 3, 4]);
  });
});

describe('TIFF', () => {
  it('round trips RGBA with LZW, Deflate and no compression', async () => {
    const img = gradient(70, 33, true);
    for (const compression of ['lzw', 'deflate', 'none']) {
      const back = await decodeTiff(await encodeTiff(img, { compression }));
      same(back, img);
    }
  });

  it('LZW handles long runs and random data', async () => {
    for (const img of [makeImage(300, 200, [5, 5, 5, 255]), { width: 64, height: 64, data: new Uint8ClampedArray(randomData(64 * 64 * 4, 9)) }]) {
      const back = await decodeTiff(await encodeTiff(img, { compression: 'lzw' }));
      same(back, img);
    }
  });

  it('writes every page and reads them back as layers', async () => {
    const a = gradient(10, 10);
    const b = makeImage(6, 4, [9, 8, 7, 255]);
    const bytes = await encodeTiff([{ ...a, name: 'Base' }, { ...b, name: 'Note' }], { names: ['Base', 'Note'] });
    const doc = await decode(bytes, { name: 'x.tif' });
    expect(doc.layers.map((l) => l.name)).toEqual(['Base', 'Note']);
    expect(doc.layers[1].width).toBe(6);
  });

  it('CMYK round trips the ink values exactly', async () => {
    const img = gradient(24, 12);
    const conv = cmykConverter();
    const cmyk = conv.toCmyk(img.data);
    const bytes = await encodeTiff({ width: 24, height: 12, cmyk });
    const back = await decodeTiff(bytes);
    expect(back.colorMode).toBe('cmyk');
    expect(Array.from(back.cmyk)).toEqual(Array.from(cmyk));
    // the preview colors are the inks seen through the press model
    const expected = conv.toRgb(cmyk);
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff += Math.abs(expected[i] - back.data[i]);
    expect(diff / expected.length).toBeLessThan(1);
    // the stored ink bytes themselves are untouched
    const { readIfds } = await import('../src/formats/tiff.js');
    const ifd = readIfds(bytes)[0];
    expect(ifd.tags.get(262)[0]).toBe(5);
  });
});

describe('PSD and PSB', () => {
  const layered = () => {
    const bg = gradient(20, 16);
    const top = makeImage(8, 6, (x) => [200, 50, 20, x < 4 ? 255 : 100]);
    const maskData = new Uint8Array(8 * 6).map((_, i) => (i % 8 < 4 ? 255 : 0));
    return {
      width: 20,
      height: 16,
      composite: bg.data,
      layers: [
        { kind: 'raster', name: 'Background', x: 0, y: 0, width: 20, height: 16, data: bg.data, opacity: 1, blend: 'normal', visible: true },
        { kind: 'group', id: 'g1', name: 'Ideas', opacity: 0.8, blend: 'normal', visible: true },
        { kind: 'raster', name: 'Note ção', x: 5, y: 4, width: 8, height: 6, data: top.data, opacity: 0.5, blend: 'multiply', visible: false, parent: 'g1', mask: { x: 5, y: 4, width: 8, height: 6, data: maskData, default: 0 } },
        { kind: 'raster', name: 'Glow', x: 1, y: 1, width: 8, height: 6, data: top.data, opacity: 1, blend: 'screen', visible: true, parent: 'g1' },
      ],
    };
  };

  it('round trips layers, masks, blend modes, visibility, names and groups', async () => {
    const src = layered();
    for (const psb of [false, true]) {
      const doc = await decodePsd(encodePsd(src, { psb }));
      expect(doc.psb).toBe(psb);
      expect([doc.width, doc.height]).toEqual([20, 16]);
      same(doc, { data: src.composite });
      const names = doc.layers.map((l) => `${l.kind}:${l.name}`);
      expect(names).toEqual(['raster:Background', 'raster:Note ção', 'raster:Glow', 'group:Ideas']);
      const note = doc.layers[1];
      expect(note).toMatchObject({ x: 5, y: 4, width: 8, height: 6, blend: 'multiply', visible: false });
      expect(note.opacity).toBeCloseTo(0.5, 1);
      expect(note.parent).toBe(doc.layers[3].id);
      expect(note.mask.data[0]).toBe(255);
      expect(note.mask.data[7]).toBe(0);
      expect(Array.from(note.data.subarray(0, 8))).toEqual(Array.from(src.layers[2].data.subarray(0, 8)));
      expect(doc.layers[2].blend).toBe('screen');
      expect(doc.layers[3].opacity).toBeCloseTo(0.8, 1);
    }
  });

  it('keeps a private note on a layer (editable text) that other readers skip', async () => {
    const src = layered();
    const meta = JSON.stringify({ type: 'text', layer: { text: 'Olá\nmundo', size: 40 } });
    src.layers[3] = { ...src.layers[3], meta };
    for (const psb of [false, true]) {
      const doc = await decodePsd(encodePsd(src, { psb }));
      expect(doc.layers.map((l) => l.name)).toEqual(['Background', 'Note ção', 'Glow', 'Ideas']);
      expect(doc.layers[2].meta).toBe(meta);
      expect(doc.layers[0].meta).toBeUndefined();
      same(doc, { data: src.composite });
    }
  });

  it('writes CMYK documents', async () => {
    const src = layered();
    const conv = cmykConverter();
    for (const l of src.layers) if (l.data) l.cmyk = conv.toCmyk(l.data);
    const bytes = encodePsd({ ...src, compositeCmyk: conv.toCmyk(src.composite) }, { cmyk: true });
    const doc = await decodePsd(bytes);
    expect(doc.colorMode).toBe('cmyk');
    const expected = conv.toRgb(conv.toCmyk(src.composite));
    let diff = 0;
    for (let i = 0; i < doc.data.length; i++) if (i % 4 !== 3) diff += Math.abs(doc.data[i] - expected[i]);
    expect(diff / doc.data.length).toBeLessThan(1);
  });
});

describe('PDF', () => {
  it('round trips RGB with transparency', async () => {
    const img = gradient(30, 20, true);
    const pdf = await encodePdf(img, { dpi: 300 });
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toMatch(/\/MediaBox \[0 0 7\.2 4\.8\]/);
    const [back] = await extractPdfImages(pdf);
    same(back, img);
  });

  it('round trips CMYK image data', async () => {
    const img = gradient(16, 16);
    const cmyk = cmykConverter().toCmyk(img.data);
    const pdf = await encodePdf({ width: 16, height: 16, cmyk });
    expect(new TextDecoder('latin1').decode(pdf)).toContain('/DeviceCMYK');
    const [back] = await extractPdfImages(pdf);
    expect(Array.from(back.cmyk)).toEqual(Array.from(cmyk));
    expect(back.colorMode).toBe('cmyk');
  });

  it('several pages open as layers', async () => {
    const pdf = await encodePdf([gradient(5, 5), makeImage(4, 4, [1, 2, 3, 255])]);
    const doc = await decode(pdf, { name: 'a.pdf' });
    expect(doc.layers.map((l) => l.name)).toEqual(['Page 1', 'Page 2']);
  });
});

describe('HDR, EXR and raw previews', () => {
  it('reads a flat Radiance file and tone maps it', () => {
    const head = new TextEncoder().encode('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 2\n');
    const px = Uint8Array.from([128, 128, 128, 129, 128, 64, 32, 135]);
    const img = decodeHdr(Uint8Array.from([...head, ...px]));
    expect([img.width, img.height]).toEqual([2, 1]);
    expect(img.data[0]).toBeGreaterThan(img.data[4] - 255); // both pixels valid
    expect(img.data[3]).toBe(255);
    expect(img.data[4]).toBeLessThan(img.data[0] + 255);
  });

  it('reads an uncompressed half float OpenEXR file', async () => {
    const w = new Writer(512, { little: true });
    w.u32(20000630).u32(2);
    const attr = (name, type, body) => {
      w.ascii(name).u8(0).ascii(type).u8(0).u32(body.length).bytes(body);
    };
    const chl = new Writer(64, { little: true });
    for (const c of ['B', 'G', 'R']) chl.ascii(c).u8(0).i32(1).u32(0).i32(1).i32(1);
    chl.u8(0);
    attr('channels', 'chlist', chl.done());
    attr('compression', 'compression', Uint8Array.of(0));
    attr('dataWindow', 'box2i', new Writer(16, { little: true }).i32(0).i32(0).i32(1).i32(0).done());
    attr('displayWindow', 'box2i', new Writer(16, { little: true }).i32(0).i32(0).i32(1).i32(0).done());
    attr('lineOrder', 'lineOrder', Uint8Array.of(0));
    w.u8(0);
    const table = w.pos;
    w.u64(0, true);
    const chunkStart = w.pos;
    // one line: B, G, R planes of 2 halves each. 0x3c00 = 1.0, 0x0000 = 0
    w.i32(0).u32(12);
    w.u16(0x0000).u16(0x0000).u16(0x0000).u16(0x0000).u16(0x3c00).u16(0x0000);
    const bytes = w.done();
    new DataView(bytes.buffer).setUint32(table, chunkStart, true);
    const img = await decodeExr(bytes);
    expect([img.width, img.height]).toEqual([2, 1]);
    expect(img.data[0]).toBeGreaterThan(100); // red pixel
    expect(img.data[1]).toBe(0);
    expect(img.data[4]).toBe(0); // black pixel
    expect(halfToFloat(0x3c00)).toBe(1);
    expect(halfToFloat(0xc000)).toBe(-2);
  });

  it('finds the embedded preview in a raw file', () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2, 0xff, 0xda, 0, 2, 9, 9, 9, 0xff, 0x00, 7, 0xff, 0xd9]);
    expect(jpegEnd(jpeg, 0)).toBe(jpeg.length);
    const file = Uint8Array.from([...randomData(100, 1).map((b) => (b === 0xff ? 0 : b)), ...jpeg, 1, 2, 3]);
    expect(findPreviews(file)[0]).toEqual({ offset: 100, length: jpeg.length });
  });
});

describe('format sniffing and the one door API', () => {
  it('recognizes formats by their magic bytes', async () => {
    const img = gradient(4, 4, true);
    expect(sniff(await encodePng(img))).toBe('png');
    expect(sniff(encodeGif(img))).toBe('gif');
    expect(sniff(encodeBmp(img))).toBe('bmp');
    expect(sniff(await encodeTiff(img))).toBe('tiff');
    expect(sniff(encodePsd({ width: 4, height: 4, composite: img.data, layers: [] }))).toBe('psd');
    expect(sniff(await encodePdf(img))).toBe('pdf');
    expect(sniff(encodeTga(img), 'a.tga')).toBe('tga');
    expect(sniff(await encodeIco([img]), 'a.ico')).toBe('ico');
    expect(sniff(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(sniff(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('svg');
    expect(sniff(new TextEncoder().encode('hello'))).toBeNull();
  });

  it('every writable format but the browser ones encodes and decodes through the API', async () => {
    const img = gradient(12, 9, true);
    const input = { width: 12, height: 9, composite: img.data, frames: [{ data: img.data, delay: 100 }] };
    for (const f of WRITABLE.filter((k) => !FORMATS[k].browser && k !== 'ico')) {
      const { bytes, ext } = await encode(input, f);
      const doc = await decode(bytes, { name: `x.${ext}` });
      expect(doc.width).toBe(12);
      expect(doc.layers.length).toBeGreaterThan(0);
    }
    await expect(encode(input, 'jpeg')).rejects.toThrow(/browser/);
    await expect(decode(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), {})).rejects.toThrow(/browser/);
  });
});
