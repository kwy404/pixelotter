# Contributing to pixelotter

Thanks for helping. pixelotter is a static web app: no backend, no accounts, no analytics. Contributions keep it that way.

## Getting started

```bash
git clone https://github.com/kwy404/pixelotter.git
cd pixelotter
npm install
npm test
npm run serve   # http://localhost:8080/pixelotter/
```

## Where things live

- `src/` holds the shared modules (document model, formats, filters, pairing, sessions). Edit them here, then run `npm run build:app` to copy them into `docs/app/lib/`.
- `docs/app/` is the editor, `docs/index.html` the landing page.
- `test/` has the unit tests (vitest) and the browser tests (`npm run test:e2e`, `npm run test:live`).

## Before you open a pull request

- `npm run lint`, `npm run check:rules` and `npm test` pass.
- `npm run check:app` says the app build is up to date.
- New behavior has a test, and every claim in the interface is true. If a browser limits something, say so plainly.
- Copy is plain English, without emoji.
