import { describe, expect, it } from 'vitest';
import { PRESS, cmykConverter, cmykToRgb, inGamut, rgbToCmyk, separate } from '../src/color/cmyk.js';
import { deltaE, fromHex, hslToRgb, hsvToRgb, labToRgb, rgbToHsl, rgbToHsv, rgbToLab, toHex } from '../src/color/convert.js';

const printable = [
  [128, 128, 128],
  [200, 150, 120],
  [90, 60, 40],
  [230, 210, 180],
  [60, 90, 70],
  [180, 120, 140],
  [50, 90, 140],
  [240, 200, 80],
  [100, 100, 130],
];

describe('simulated CMYK', () => {
  it('round trips printable colors within a small difference', () => {
    for (const c of printable) {
      const ink = rgbToCmyk(...c);
      const back = cmykToRgb(...ink);
      expect(deltaE(rgbToLab(...c), rgbToLab(...back))).toBeLessThan(2.5);
    }
  });

  it('flags colors a press cannot print', () => {
    for (const c of [[0, 0, 255], [0, 255, 0], [255, 0, 255], [0, 255, 255]]) expect(inGamut(...c)).toBe(false);
    for (const c of printable) expect(inGamut(...c)).toBe(true);
  });

  it('keeps the total ink under the limit and uses black for neutrals', () => {
    for (const c of [[0, 0, 0], [20, 10, 30], [60, 60, 60], [0, 0, 255]]) {
      const ink = separate(...c).ink;
      expect(ink.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(PRESS.tac + 1e-6);
    }
    const gray = rgbToCmyk(80, 80, 80);
    expect(gray[3]).toBeGreaterThan(30);
    const white = rgbToCmyk(255, 255, 255);
    expect(white).toEqual([0, 0, 0, 0]);
  });

  it('more ink is always darker', () => {
    let prev = 256;
    for (let k = 0; k <= 100; k += 10) {
      const [r] = cmykToRgb(0, 0, 0, k);
      expect(r).toBeLessThanOrEqual(prev);
      prev = r;
    }
  });

  it('image converter: separations, proof and gamut mask agree with the exact math', () => {
    const conv = cmykConverter();
    const rgba = new Uint8ClampedArray([128, 128, 128, 255, 0, 0, 255, 255, 200, 150, 120, 77]);
    const ink = conv.toCmyk(rgba);
    // the interpolated separation prints the same color as the exact one
    const viaLut = cmykToRgb(...[8, 9, 10, 11].map((i) => (ink[i] / 255) * 100));
    const exact = cmykToRgb(...separate(200, 150, 120).ink.map((v) => v * 100));
    expect(deltaE(rgbToLab(...viaLut), rgbToLab(...exact))).toBeLessThan(2);
    const proof = conv.proof(rgba);
    expect(proof[11]).toBe(77); // alpha kept
    expect(Math.abs(proof[0] - 128)).toBeLessThan(4);
    expect(proof[6]).toBeLessThan(200); // pure blue prints duller
    expect(Array.from(conv.gamut(rgba, 8))).toEqual([0, 255, 0]);
    const rgb = conv.toRgb(ink, [255, 255, 77]);
    expect(rgb[11]).toBe(77);
  });
});

describe('color conversions', () => {
  it('hex, HSV and HSL round trip', () => {
    for (const c of [[0, 0, 0], [255, 255, 255], [192, 138, 78], [12, 200, 99]]) {
      expect(fromHex(toHex(...c)).slice(0, 3)).toEqual(c);
      expect(hsvToRgb(...rgbToHsv(...c))).toEqual(c);
      expect(hslToRgb(...rgbToHsl(...c))).toEqual(c);
    }
    expect(fromHex('#abc')).toEqual([170, 187, 204, 255]);
    expect(fromHex('nope')).toBeNull();
  });

  it('Lab round trips sRGB', () => {
    for (const c of [[10, 20, 30], [250, 240, 230], [192, 138, 78]]) expect(labToRgb(...rgbToLab(...c))).toEqual(c);
    expect(rgbToLab(255, 255, 255)[0]).toBeCloseTo(100, 2);
  });
});
