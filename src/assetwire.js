// Pictures travel between friends as PNG. A shared edit that adds a large asset (a pasted
// photo, a placed file) carries raw RGBA pixels in the document; before it goes on the wire
// those pixels become a lossless PNG, and the other side turns them back into pixels before
// the edit applies. Small assets stay as they are: the wire already deflates them.

export const PNG_ABOVE = 256 * 1024; // bytes of RGBA
export const MAX_SIDE = 16384;

const big = (op) => op?.t === 'asset' && op.data && op.data.length > PNG_ABOVE && op.w > 0 && op.h > 0;

/**
 * Replaces large asset pixels in an 'ops' message with PNG bytes. encode({ width, height, data })
 * resolves to a Uint8Array. cache (a WeakMap keyed by operation) avoids encoding the same picture
 * once per friend.
 */
export async function packAssetOps(msg, encode, cache = null) {
  if (msg?.t !== 'ops' || !Array.isArray(msg.ops) || !msg.ops.some(big)) return msg;
  const ops = await Promise.all(
    msg.ops.map(async (op) => {
      if (!big(op)) return op;
      let p = cache?.get(op);
      if (!p) {
        p = encode({ width: op.w, height: op.h, data: op.data });
        cache?.set(op, p);
      }
      const { data, ...rest } = op;
      void data;
      return { ...rest, png: await p };
    }),
  );
  return { ...msg, ops };
}

/** Turns PNG assets in an 'ops' message back into pixels. decode(bytes) resolves to { width, height, data }. */
export async function unpackAssetOps(msg, decode) {
  if (msg?.t !== 'ops' || !Array.isArray(msg.ops) || !msg.ops.some((op) => op?.t === 'asset' && op.png)) return msg;
  const ops = await Promise.all(
    msg.ops.map(async (op) => {
      if (op?.t !== 'asset' || !op.png) return op;
      if (!(op.w > 0 && op.h > 0 && op.w <= MAX_SIDE && op.h <= MAX_SIDE)) throw new Error('A shared picture has a bad size');
      const img = await decode(op.png);
      if (img.width !== op.w || img.height !== op.h) throw new Error('A shared picture does not match its size');
      const { png, ...rest } = op;
      void png;
      return { ...rest, data: new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength) };
    }),
  );
  return { ...msg, ops };
}
