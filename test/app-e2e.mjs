// End to end test of the editor in two headless browser contexts: open the app, load the
// sample, adjust it, add text, remove the background, use the menus, export a PNG, save and
// reopen a .pxo project, and send the export to a second context with a SHA-256 match.
// Usage: node test/app-e2e.mjs   (set BROWSER_PATH to use another Chromium based browser)
import { readFileSync } from 'node:fs';
import { check, closeAll, failed, launch, openApp, openSample, serve, sha256, step } from './e2e-helpers.mjs';

const { server, base } = await serve();
const A = await launch();
const B = await launch({ width: 1280, height: 860 });
const a = A.page;
const b = B.page;

const checksum = (page) =>
  page.evaluate(() => {
    const c = window.pixelotter.app.edoc.renderer.render({ scale: 0.2 });
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 7) s = (s * 31 + d[i]) % 1000000007;
    return s;
  });
const layers = (page) => page.evaluate(() => window.pixelotter.app.edoc.doc.layers.map((l) => ({ type: l.type, name: l.name, mask: !!l.mask })));

try {
  await step('open the editor', async () => {
    await openApp(a, base);
    check(await a.isVisible('.home-screen'), 'home screen shows');
  });

  await step('load the sample', async () => {
    await openSample(a);
    const l = await layers(a);
    check(l.length === 1 && l[0].type === 'raster', 'sample opens as one photo layer');
  });

  await step('menus', async () => {
    for (const menu of ['file', 'edit', 'image', 'layer', 'select', 'filter', 'view', 'window', 'help']) {
      await a.click(`[data-menu="${menu}"]`);
      const n = await a.locator('.menu-pop:not(.menu-pop-sub) .menu-row').count();
      check(n >= 3, `${menu} menu lists ${n} items`);
    }
    await a.keyboard.press('Escape');
    await a.click('[data-menu="filter"]');
    await a.click('.menu-pop .menu-sub >> nth=0');
    check((await a.locator('.menu-pop-sub .menu-row').count()) > 1, 'filter submenu opens');
    await a.keyboard.press('Escape');
    await a.mouse.click(700, 500);
  });

  const before = await checksum(a);
  await step('adjust exposure in the Quick workspace', async () => {
    await a.click('.ws-switch input[value="quick"]', { force: true });
    await a.click('[data-quick="adjust"]');
    await a.locator('[data-adjust="exposure"]').evaluate((el) => {
      el.value = '45';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await a.waitForTimeout(600);
    const exp = await a.evaluate(() => window.pixelotter.app.edoc.doc.layers[0].adjust.exposure);
    check(exp === 45, 'exposure is stored on the layer');
    check((await checksum(a)) !== before, 'the picture changes');
  });

  await step('one tap look and auto enhance', async () => {
    await a.click('[data-quick="looks"]');
    await a.click('[data-action="auto-enhance"]');
    await a.click('[data-look="golden"]');
    const look = await a.evaluate(() => window.pixelotter.app.edoc.doc.layers[0].look);
    check(look === 'golden', 'look applied');
  });

  await step('add text from a preset', async () => {
    await a.click('[data-quick="text"]');
    await a.click('[data-preset="headline"]');
    await a.waitForTimeout(400);
    const l = await layers(a);
    check(l.some((x) => x.type === 'text'), 'text layer added');
  });

  await step('undo and redo', async () => {
    const n = (await layers(a)).length;
    await a.keyboard.press('Control+z');
    check((await layers(a)).length === n - 1, 'undo removes the text layer');
    await a.keyboard.press('Control+Shift+z');
    check((await layers(a)).length === n, 'redo brings it back');
  });

  await step('remove the background (downloads the model once)', async () => {
    await a.evaluate(() => {
      const app = window.pixelotter.app;
      app.selectLayer(app.edoc.doc.layers[0].id);
    });
    await a.click('[data-quick="cutout"]');
    await a.click('[data-action="remove-bg"]');
    await a.waitForFunction(() => window.pixelotter.app.edoc.doc.layers[0].mask || window.pixelotter.S.model.state === 'error', null, { timeout: 240000 });
    const st = await a.evaluate(() => ({ state: window.pixelotter.S.model.state, error: window.pixelotter.S.model.error }));
    check(st.state !== 'error', `model ran (${st.state}${st.error ? `: ${st.error}` : ''})`);
    const cov = await a.evaluate(() => {
      const app = window.pixelotter.app;
      const l = app.edoc.doc.layers[0];
      const m = app.edoc.assets.read(l.mask.asset);
      let on = 0;
      for (let i = 0; i < m.length; i += 4) if (m[i] > 127) on++;
      return on / (m.length / 4);
    });
    check(cov > 0.03 && cov < 0.8, `mask keeps part of the picture (${(cov * 100).toFixed(1)}%)`);
  });

  await step('export a PNG', async () => {
    await a.click('.ws-switch input[value="pro"]', { force: true });
    await a.click('[data-action="export"]');
    await a.selectOption('[data-field="format"]', 'png');
    await a.waitForTimeout(500);
    const [dl] = await Promise.all([a.waitForEvent('download', { timeout: 60000 }), a.click('[data-action="do-export"]')]);
    const bytes = readFileSync(await dl.path());
    const sig = [...bytes.subarray(0, 8)].join(',');
    check(sig === '137,80,78,71,13,10,26,10', `PNG signature (${dl.suggestedFilename()})`);
    const w = bytes.readUInt32BE(16);
    const h = bytes.readUInt32BE(20);
    check(w === 1600 && h === 1200, `full resolution ${w} x ${h}`);
  });

  let pxo = null;
  await step('save the project as .pxo', async () => {
    await a.mouse.click(700, 500);
    const [dl] = await Promise.all([a.waitForEvent('download', { timeout: 60000 }), a.keyboard.press('Control+s')]);
    pxo = { path: await dl.path(), name: dl.suggestedFilename() };
    const bytes = readFileSync(pxo.path);
    check(pxo.name.endsWith('.pxo') && bytes.subarray(0, 3).toString() === 'PXO', `project file ${pxo.name} (${bytes.length} bytes)`);
  });

  await step('open the .pxo again', async () => {
    const want = await layers(a);
    const sumA = await checksum(a);
    await a.setInputFiles('#file-input', pxo.path);
    await a.waitForFunction((n) => window.pixelotter.app.docs.length === n, 2, { timeout: 30000 });
    await a.waitForTimeout(800);
    const got = await layers(a);
    check(JSON.stringify(got) === JSON.stringify(want), 'same layers, names and masks');
    check((await checksum(a)) === sumA, 'same pixels');
  });

  await step('send the export to a friend (second context)', async () => {
    await openApp(b, base);
    await a.click('[data-action="export"]');
    await a.selectOption('[data-field="format"]', 'png');
    await a.waitForTimeout(400);
    await a.click('#dlg-export .btn-soft');
    await a.waitForFunction(() => document.querySelector('#code-words')?.dataset.words?.split(' ').length === 6, null, { timeout: 60000 });
    const words = (await a.getAttribute('#code-words', 'data-words')).split(' ');
    check(!(await a.locator('#dlg-live').innerText()).includes('http'), 'no link is shown, only words');
    await b.click('[data-action="join"]');
    for (let i = 0; i < 6; i++) await b.fill(`#join-word-${i}`, words[i]);
    await b.click('#dlg-join .word-inputs button[type="submit"]');
    await b.waitForFunction(() => document.querySelector('#confirm-words')?.dataset.words?.split(' ').length === 6, null, { timeout: 90000 });
    const confirm = (await b.getAttribute('#confirm-words', 'data-words')).split(' ');
    await a.waitForSelector('#confirm-word-0', { state: 'visible', timeout: 60000 });
    for (let i = 0; i < 6; i++) await a.fill(`#confirm-word-${i}`, confirm[i]);
    await a.click('#confirm-form button[type="submit"]');
    await b.waitForFunction(() => window.pixelotter.S.live.step === 'received', null, { timeout: 120000 });
    const sent = Buffer.from(await a.evaluate(() => [...window.pixelotter.live.pendingFile.bytes]));
    const got = await b.evaluate(() => ({ ...window.pixelotter.S.live.received, bytes: [...window.pixelotter.live.received.data] }));
    const want = await sha256(sent);
    check(got.ok && got.sha256 === want && (await sha256(Buffer.from(got.bytes))) === want, `file verified on arrival (sha256 ${want.slice(0, 16)}...)`);
    await a.waitForFunction(() => window.pixelotter.S.live.sendState === 'verified', null, { timeout: 30000 });
    check(true, 'sender sees the receipt');
  });

  check(A.errors.length === 0, `no console errors in the first context${A.errors.length ? `: ${A.errors.slice(0, 3).join(' | ')}` : ''}`);
  check(B.errors.length === 0, `no console errors in the second context${B.errors.length ? `: ${B.errors.slice(0, 3).join(' | ')}` : ''}`);
} finally {
  await closeAll(A.ctx, B.ctx);
  server.close();
}
console.log(failed() ? `\n${failed()} check(s) failed` : '\nAll checks passed');
process.exit(failed() ? 1 : 0);
