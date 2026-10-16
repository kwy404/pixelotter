// pixelotter service worker: the editor itself is precached so it opens offline; the
// libraries, fonts and the cutout model from the CDN are cached the first time they load.
// The precache block below is rewritten by scripts/build-app.mjs.

// precache:start
const CACHE_VERSION = '8adacb91183e';
const PRECACHE = [
  './',
  'app.css',
  'art/otto-loader.svg',
  'icons.svg',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon.svg',
  'icons/maskable-512.png',
  'icons/maskable.svg',
  'index.html',
  'js/app.js',
  'js/commands.js',
  'js/context-menu.js',
  'js/denoise-worklet.js',
  'js/dialogs-html.js',
  'js/engine/assets.js',
  'js/engine/document.js',
  'js/engine/patterns.js',
  'js/engine/render.js',
  'js/engine/selection.js',
  'js/engine/text.js',
  'js/files.js',
  'js/i18n.js',
  'js/live.js',
  'js/main.js',
  'js/media.js',
  'js/projects.js',
  'js/segment-worker.js',
  'js/segmenter.js',
  'js/tools/create.js',
  'js/tools/paint.js',
  'js/tools/select.js',
  'js/tools/transform.js',
  'js/ui-context.js',
  'js/ui-dialogs.js',
  'js/ui-extra.js',
  'js/ui-live.js',
  'js/ui-quick.js',
  'js/ui.js',
  'js/version.js',
  'js/view/viewport.js',
  'lib/blend.js',
  'lib/brush.js',
  'lib/bytes.js',
  'lib/call.js',
  'lib/chat.js',
  'lib/color/cmyk.js',
  'lib/color/convert.js',
  'lib/doc.js',
  'lib/dsp.js',
  'lib/emitter.js',
  'lib/filters/adjust.js',
  'lib/filters/core.js',
  'lib/filters/effects.js',
  'lib/filters/heal.js',
  'lib/filters/inpaint.js',
  'lib/filters/liquify.js',
  'lib/filters/looks.js',
  'lib/filters/registry.js',
  'lib/filters/tone.js',
  'lib/fingerprint.js',
  'lib/formats/binary.js',
  'lib/formats/bmp.js',
  'lib/formats/gif.js',
  'lib/formats/hdr.js',
  'lib/formats/index.js',
  'lib/formats/magic.js',
  'lib/formats/pdf.js',
  'lib/formats/png.js',
  'lib/formats/psd.js',
  'lib/formats/quantize.js',
  'lib/formats/raw.js',
  'lib/formats/tga.js',
  'lib/formats/tiff.js',
  'lib/geometry.js',
  'lib/history.js',
  'lib/ice.js',
  'lib/mask.js',
  'lib/mqtt.js',
  'lib/pairing.js',
  'lib/paths.js',
  'lib/pixels.js',
  'lib/project.js',
  'lib/qr.js',
  'lib/relay.js',
  'lib/rendezvous.js',
  'lib/rtc.js',
  'lib/segment.js',
  'lib/session.js',
  'lib/sha256.js',
  'lib/sticker.js',
  'lib/styles.js',
  'lib/textlayout.js',
  'lib/transfer.js',
  'lib/wire.js',
  'lib/wordlist.js',
  'lib/words.js',
  'manifest.webmanifest',
  'samples/otter-desk-thumb.jpg',
  'samples/otter-desk.jpg',
  'samples/teapot-window-thumb.jpg',
  'samples/teapot-window.jpg'
];
// precache:end

const APP_CACHE = `pixelotter-app-${CACHE_VERSION}`;
const RUNTIME_CACHE = 'pixelotter-runtime-v1';
const RUNTIME_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(APP_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('pixelotter-app-') && k !== APP_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    // the app: cache first, then the network (and keep the copy fresh)
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then((hit) => {
        if (hit) return hit;
        return fetch(req).then((res) => {
          if (res.ok && url.pathname.startsWith(new URL('./', self.location).pathname)) {
            const copy = res.clone();
            caches.open(APP_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }).catch(() => (req.mode === 'navigate' ? caches.match('./') : Response.error()));
      }),
    );
    return;
  }
  if (!RUNTIME_HOSTS.includes(url.hostname)) return;
  // the large model file has its own verified cache in the page; skip it here
  if (url.pathname.endsWith('.onnx')) return;
  event.respondWith(
    caches.open(RUNTIME_CACHE).then((cache) =>
      cache.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
            return res;
          }),
      ),
    ),
  );
});
