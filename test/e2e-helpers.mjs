// Shared pieces of the browser tests: a fresh Edge (or Chrome) profile per context, the local
// server under /pixelotter/, console error collection and small waiting helpers.
import { chromium } from 'playwright-core';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../scripts/serve.mjs';

const CANDIDATES = [
  process.env.BROWSER_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

export const browserPath = () => CANDIDATES.find((p) => existsSync(p));

export const MEDIA_FLAGS = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
  '--auto-select-desktop-capture-source=Entire screen',
  '--auto-accept-this-tab-capture',
  '--enable-features=GetDisplayMediaSetAutoSelectAllScreens',
];

export async function serve() {
  const server = await startServer(0);
  return { server, base: `http://127.0.0.1:${server.address().port}/pixelotter/` };
}

const dirs = [];
export async function launch({ width = 1440, height = 900, locale = 'en-US', colorScheme = 'dark' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pixelotter-e2e-'));
  dirs.push(dir);
  const ctx = await chromium.launchPersistentContext(dir, {
    executablePath: browserPath(),
    headless: true,
    viewport: { width, height },
    locale,
    colorScheme,
    acceptDownloads: true,
    permissions: ['microphone', 'camera', 'clipboard-read', 'clipboard-write'],
    args: MEDIA_FLAGS,
  });
  // downloads instead of the save picker, and no first run tour
  await ctx.addInitScript(() => {
    try {
      delete window.showSaveFilePicker;
      window.showSaveFilePicker = undefined;
      localStorage.setItem('pixelotter:toured', '1');
    } catch {
      // ignore
    }
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const errors = [];
  // The browser itself logs a failed WebSocket to a public relay (one of several the pairing
  // uses at once) or an aborted network fetch as a console error; those are network
  // conditions, not errors in the app, so they are left out.
  const network = /^WebSocket connection to 'wss:\/\/|^Failed to load resource: net::ERR_(SOCKET_NOT_CONNECTED|CONNECTION_|NAME_NOT_RESOLVED|TIMED_OUT|INTERNET_DISCONNECTED)/;
  page.on('console', (m) => m.type() === 'error' && !network.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(`${e.message}\n${e.stack}`));
  return { ctx, page, errors };
}

export async function closeAll(...ctxs) {
  for (const c of ctxs) await Promise.race([c.close().catch(() => {}), new Promise((r) => setTimeout(r, 8000))]);
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // the browser may still hold a lock on a file
    }
  }
}

export async function openApp(page, base) {
  // the editor is usable before every font and CDN file has arrived, so do not wait for "load"
  await page.goto(`${base}app/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.pixelotter?.S?.ready, null, { timeout: 180000 });
}

export async function openSample(page) {
  await page.click('[data-action="sample"]');
  await page.waitForFunction(() => window.pixelotter.app.edoc?.doc.layers.length, null, { timeout: 60000 });
}

let failures = 0;
export function check(ok, label) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures++;
}
export const failed = () => failures;

export async function step(label, fn) {
  const t0 = Date.now();
  try {
    await fn();
  } catch (err) {
    check(false, `${label}: ${err.message.split('\n')[0]}`);
    return false;
  }
  console.log(`     ${label} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  return true;
}

export async function sha256(bytes) {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(bytes).digest('hex');
}
