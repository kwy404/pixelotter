// Runs the cutout model off the main thread. The page sends the model bytes once (after it has
// checked their SHA-256), then images; the worker answers with a mask the size of the image.
// onnxruntime-web is loaded from jsDelivr (pinned version) and runs single threaded on
// WebAssembly, which needs no special server headers.

import { RUNTIME, postprocess, preprocess, upscaleMask, MODEL } from '../lib/segment.js';

let session = null;
let ort = null;

async function init(bytes) {
  ort = await import(RUNTIME.base + RUNTIME.module);
  ort.env.wasm.wasmPaths = RUNTIME.base;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
}

async function run({ rgba, width, height }) {
  const input = new ort.Tensor('float32', preprocess(rgba, width, height), [1, 3, MODEL.input, MODEL.input]);
  const out = await session.run({ [session.inputNames[0]]: input });
  const small = postprocess(out[session.outputNames[0]].data);
  return upscaleMask(small, MODEL.input, MODEL.input, width, height);
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      await init(data.bytes);
      self.postMessage({ id: data.id, ok: true });
    } else if (data.type === 'run') {
      const mask = await run(data);
      self.postMessage({ id: data.id, ok: true, mask }, [mask.buffer]);
    }
  } catch (err) {
    self.postMessage({ id: data.id, ok: false, error: String(err?.message ?? err) });
  }
};
