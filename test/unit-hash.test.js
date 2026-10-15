import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { concatBytes, equalBytes, fromBase64Url, fromHex, randomId, toBase64Url, toHex, utf8 } from '../src/bytes.js';
import { Sha256, sha256Hex } from '../src/sha256.js';
import { randomData } from './unit-helpers.js';

const nodeHash = (data) => createHash('sha256').update(data).digest('hex');

describe('Sha256', () => {
  it('matches the FIPS 180 test vectors', () => {
    expect(sha256Hex(utf8(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex(utf8('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex(utf8('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
    const h = new Sha256();
    const block = utf8('a'.repeat(1000));
    for (let i = 0; i < 1000; i++) h.update(block);
    expect(h.hex()).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });

  it('gives the same digest for any split of the input', () => {
    const data = randomData(300000, 3);
    const expected = nodeHash(data);
    for (const step of [1, 7, 63, 64, 65, 1000, 65536]) {
      const h = new Sha256();
      for (let o = 0; o < data.length; o += step) h.update(data.subarray(o, o + step));
      expect(h.hex(), `step ${step}`).toBe(expected);
    }
  });

  it('matches node:crypto across lengths around the padding boundary', () => {
    for (let n = 0; n < 200; n++) {
      const data = randomData(n, n + 1);
      expect(sha256Hex(data)).toBe(nodeHash(data));
    }
  });

  it('saves and restores its state mid stream, so a resumed hash is still correct', () => {
    const data = randomData(100000, 4);
    const h = new Sha256().update(data.subarray(0, 33333));
    const saved = JSON.parse(JSON.stringify(h.save()));
    const resumed = Sha256.restore(saved).update(data.subarray(33333));
    expect(resumed.hex()).toBe(nodeHash(data));
    const clone = h.clone();
    h.update(data.subarray(33333));
    clone.update(data.subarray(33333));
    expect(clone.hex()).toBe(h.hex());
  });

  it('refuses updates after digest and bad saved state', () => {
    const h = new Sha256().update(utf8('x'));
    const d1 = h.hex();
    expect(h.hex()).toBe(d1);
    expect(() => h.update(utf8('y'))).toThrow();
    expect(() => h.save()).toThrow();
    expect(() => Sha256.restore({ h: [1, 2] })).toThrow();
  });

  it('accepts ArrayBuffer input', () => {
    expect(new Sha256().update(utf8('abc').buffer).hex()).toBe(sha256Hex(utf8('abc')));
  });
});

describe('bytes helpers', () => {
  it('round trips base64url and accepts the standard alphabet', () => {
    for (let n = 0; n < 40; n++) {
      const data = randomData(n, n + 9);
      const text = toBase64Url(data);
      expect(text).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(fromBase64Url(text)).toEqual(data);
      expect(fromBase64Url(Buffer.from(data).toString('base64'))).toEqual(data);
    }
    expect(toBase64Url(utf8('hello?'))).toBe('aGVsbG8_');
    expect(() => fromBase64Url('a')).toThrow();
    expect(() => fromBase64Url('ab$d')).toThrow();
    expect(fromBase64Url(' aGVs\nbG8_ ')).toEqual(utf8('hello?'));
  });

  it('converts hex, joins and compares bytes', () => {
    expect(toHex(Uint8Array.of(0, 15, 255))).toBe('000fff');
    expect(fromHex('00:0f:FF')).toEqual(Uint8Array.of(0, 15, 255));
    expect(() => fromHex('abc')).toThrow();
    expect(concatBytes([Uint8Array.of(1), Uint8Array.of(), Uint8Array.of(2, 3)])).toEqual(Uint8Array.of(1, 2, 3));
    expect(equalBytes(Uint8Array.of(1, 2), Uint8Array.of(1, 2))).toBe(true);
    expect(equalBytes(Uint8Array.of(1, 2), Uint8Array.of(1, 3))).toBe(false);
    expect(equalBytes(Uint8Array.of(1), Uint8Array.of(1, 3))).toBe(false);
    expect(randomId()).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(randomId()).not.toBe(randomId());
  });
});
