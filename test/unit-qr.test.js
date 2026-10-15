import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { byteCapacity, encodeQr, formatBits, gfMul, qrPath, qrSvg, rsGenerator, rsRemainder, ECC } from '../src/qr.js';

function render(qr, scale = 4, margin = 4) {
  const n = (qr.size + margin * 2) * scale;
  const px = new Uint8ClampedArray(n * n * 4).fill(255);
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (!qr.modules[y * qr.size + x]) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const i = (((y + margin) * scale + dy) * n + (x + margin) * scale + dx) * 4;
          px[i] = px[i + 1] = px[i + 2] = 0;
        }
      }
    }
  }
  return { px, n };
}

function decode(qr) {
  const { px, n } = render(qr);
  const result = jsQR(px, n, n, { inversionAttempts: 'dontInvert' });
  return result ? new Uint8Array(result.binaryData) : null;
}

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s;
  };
}

describe('Reed-Solomon over GF(256)', () => {
  it('multiplies in the QR field', () => {
    expect(gfMul(0, 7)).toBe(0);
    expect(gfMul(1, 0x53)).toBe(0x53);
    expect(gfMul(2, 0x80)).toBe(0x1d);
  });

  it('matches the published HELLO WORLD 1-M error correction codewords', () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(Array.from(rsRemainder(data, rsGenerator(10)))).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });

  it('computes the format information with its BCH code and mask', () => {
    // Level M, mask 5 is 100000011001110 in the specification table.
    expect(formatBits(ECC.M, 5).toString(2).padStart(15, '0')).toBe('100000011001110');
    expect(formatBits(ECC.L, 4).toString(2).padStart(15, '0')).toBe('110011000101111');
  });
});

describe('encodeQr', () => {
  it('picks the smallest version that fits and grows past version 9 and 26', () => {
    expect(encodeQr('a', { ecl: 'L' }).version).toBe(1);
    expect(byteCapacity(1, ECC.L)).toBe(17);
    expect(byteCapacity(40, ECC.L)).toBe(2953);
    expect(byteCapacity(40, ECC.H)).toBe(1273);
    expect(encodeQr('x'.repeat(18), { ecl: 'L' }).version).toBe(2);
  });

  it('raises the error correction level when it still fits', () => {
    expect(encodeQr('hi', { ecl: 'L' }).ecl).toBe('H');
    expect(encodeQr('hi', { ecl: 'L', boostEcl: false }).ecl).toBe('L');
  });

  it('throws when the data is too long', () => {
    expect(() => encodeQr(new Uint8Array(2954), { ecl: 'L' })).toThrow(RangeError);
  });

  it('round trips through an independent decoder for many sizes, levels and masks', () => {
    const rand = seeded(42);
    const lengths = [1, 7, 17, 32, 60, 100, 150, 230, 320, 410, 520, 700, 900, 1200, 1600, 2100];
    let n = 0;
    for (const len of lengths) {
      for (const ecl of ['L', 'M', 'Q', 'H']) {
        if (len > byteCapacity(40, ECC[ecl])) continue;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = rand() & 0xff;
        const qr = encodeQr(bytes, { ecl, boostEcl: false });
        expect(qr.size).toBe(qr.version * 4 + 17);
        const out = decode(qr);
        expect(out, `len ${len} level ${ecl} version ${qr.version}`).not.toBeNull();
        expect(Array.from(out)).toEqual(Array.from(bytes));
        n++;
      }
    }
    expect(n).toBeGreaterThan(50);
  }, 60000);

  it('decodes with every forced mask', () => {
    for (let mask = 0; mask < 8; mask++) {
      const text = `https://kwy404.github.io/pixelotter/app/#i=mask${mask}`;
      const qr = encodeQr(text, { mask });
      expect(qr.mask).toBe(mask);
      expect(new TextDecoder().decode(decode(qr))).toBe(text);
    }
  });

  it('encodes UTF-8 text', () => {
    const text = 'Arquivos para o notebook: fotos, \u00e1udio e v\u00eddeo';
    expect(new TextDecoder().decode(decode(encodeQr(text)))).toBe(text);
  });

  it('renders an SVG path with a quiet zone', () => {
    const qr = encodeQr('pixelotter');
    const d = qrPath(qr);
    expect(d.startsWith('M4 4h7')).toBe(true);
    const svg = qrSvg(qr, { title: 'Invite <code>' });
    expect(svg).toContain(`viewBox="0 0 ${qr.size + 8} ${qr.size + 8}"`);
    expect(svg).toContain('<title>Invite code</title>');
  });
});
