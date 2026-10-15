// Node 18 has no global WebCrypto and some Node versions lack the deflate-raw format in
// CompressionStream. Browsers have both; these shims let the same modules run under test.
import { webcrypto } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto;

function supportsDeflateRaw() {
  try {
    new CompressionStream('deflate-raw');
    new DecompressionStream('deflate-raw');
    return true;
  } catch {
    return false;
  }
}

if (typeof CompressionStream === 'undefined' || !supportsDeflateRaw()) {
  const make = (fn) =>
    class {
      constructor() {
        const parts = [];
        const ts = new TransformStream({
          transform(chunk) {
            parts.push(Buffer.from(chunk));
          },
          flush(controller) {
            controller.enqueue(new Uint8Array(fn(Buffer.concat(parts))));
          },
        });
        this.readable = ts.readable;
        this.writable = ts.writable;
      }
    };
  globalThis.CompressionStream = make(deflateRawSync);
  globalThis.DecompressionStream = make(inflateRawSync);
}
