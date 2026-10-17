import { describe, expect, it } from 'vitest';
import { PNG_ABOVE, packAssetOps, unpackAssetOps } from '../src/assetwire.js';
import { decodePng, encodePng } from '../src/formats/png.js';
import { Assembler, encodeFrames } from '../src/wire.js';

describe('pictures on the wire', () => {
  const big = () => {
    const w = 400;
    const h = 300;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) data.set([(i * 7) % 256, (i >> 3) % 256, 90, i % 5 ? 255 : 128], i * 4);
    return { t: 'asset', id: 'a1', w, h, data };
  };

  it('a large asset travels as PNG and comes back pixel for pixel', async () => {
    const op = big();
    expect(op.data.length).toBeGreaterThan(PNG_ABOVE);
    const msg = { t: 'ops', ops: [op, { t: 'add', layer: { id: 'l1' } }] };
    const cache = new WeakMap();
    const packed = await packAssetOps(msg, encodePng, cache);
    expect(packed.ops[0].data).toBeUndefined();
    expect(packed.ops[0].png.length).toBeLessThan(op.data.length);
    expect(packed.ops[1]).toBe(msg.ops[1]);
    // a second friend reuses the same encoding
    const again = await packAssetOps(msg, async () => {
      throw new Error('encoded twice');
    }, cache);
    expect(again.ops[0].png).toBe(packed.ops[0].png);
    const back = await unpackAssetOps(packed, decodePng);
    expect(back.ops[0].data).toBeInstanceOf(Uint8ClampedArray);
    expect(Array.from(back.ops[0].data)).toEqual(Array.from(op.data));
  });

  it('small assets and other messages pass untouched, and a lying size is refused', async () => {
    const small = { t: 'ops', ops: [{ t: 'asset', id: 'a', w: 2, h: 2, data: new Uint8ClampedArray(16) }] };
    expect(await packAssetOps(small, encodePng)).toBe(small);
    const chat = { t: 'chat', text: 'hi' };
    expect(await packAssetOps(chat, encodePng)).toBe(chat);
    const packed = await packAssetOps({ t: 'ops', ops: [big()] }, encodePng);
    packed.ops[0].w = 401;
    await expect(unpackAssetOps(packed, decodePng)).rejects.toThrow(/size/);
  });

  it('big messages report their progress as frames arrive', async () => {
    const seen = [];
    const asm = new Assembler({ onProgress: (p) => seen.push(p) });
    const blob = new Uint8Array(600 * 1024).map((_, i) => (i * 2654435761) >>> 24);
    const frames = await encodeFrames(7, { blob }, { compressAbove: Infinity });
    let msg = null;
    for (const f of frames) msg = (await asm.push(f)) ?? msg;
    expect(msg.blob.length).toBe(600 * 1024);
    expect(seen.length).toBe(frames.length);
    expect(seen.at(-1)).toMatchObject({ dir: 'receive', done: frames.length, total: frames.length });
  });
});
