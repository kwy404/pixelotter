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
    // the new text opens in the on canvas editor; Escape commits it and gives the keys back
    await a.keyboard.press('Escape');
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

  await step('context menus', async () => {
    const box = await a.locator('#viewport').boundingBox();
    await a.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await a.waitForSelector('.ctx-menu[role="menu"]', { timeout: 15000 });
    const labels = await a.locator('.ctx-menu [role^="menuitem"]').allInnerTexts();
    check(labels.some((x) => x.includes('Copy')) && labels.some((x) => x.includes('Paste')) && labels.some((x) => x.includes('Free transform')), `canvas menu (${labels.length} items)`);
    const pos = await a.evaluate(() => {
      const r = document.querySelector('.ctx-menu').getBoundingClientRect();
      return r.right <= innerWidth && r.bottom <= innerHeight && r.left >= 0 && r.top >= 0;
    });
    check(pos, 'the menu stays inside the window');
    await a.keyboard.press('ArrowDown');
    const focused = await a.evaluate(() => document.activeElement?.getAttribute('role'));
    check(focused?.startsWith('menuitem'), 'arrow keys move between items');
    await a.keyboard.press('Escape');
    check((await a.locator('.ctx-menu').count()) === 0, 'Escape closes the menu');
    // near the bottom right corner the menu flips to stay on screen
    await a.mouse.click(box.x + box.width - 4, box.y + box.height - 4, { button: 'right' });
    const inside = await a.evaluate(() => {
      const r = document.querySelector('.ctx-menu').getBoundingClientRect();
      return r.right <= innerWidth && r.bottom <= innerHeight;
    });
    check(inside, 'a menu opened in the corner flips inside the window');
    await a.keyboard.press('Escape');
    // the keyboard: Shift+F10 on the focused canvas
    await a.focus('#viewport');
    await a.keyboard.press('Shift+F10');
    check((await a.locator('.ctx-menu').count()) === 1, 'Shift+F10 opens the menu from the keyboard');
    await a.keyboard.press('Escape');
    // layers: duplicate, and the blend mode submenu by keyboard
    const n = (await layers(a)).length;
    const row = a.locator('.layer-row').first();
    await row.click({ button: 'right' });
    await a.locator('.ctx-menu .ctx-item', { hasText: 'Duplicate layer' }).click();
    check((await layers(a)).length === n + 1, 'Duplicate layer from the layer menu');
    await a.locator('.layer-row').first().click({ button: 'right' });
    const blend = a.locator('.ctx-menu .ctx-item', { hasText: 'Blend mode' });
    await blend.hover();
    await a.waitForSelector('.ctx-menu >> nth=1', { timeout: 15000 });
    await a.keyboard.press('ArrowRight');
    await a.keyboard.press('ArrowDown');
    await a.keyboard.press('Enter');
    const mode = await a.evaluate(() => window.pixelotter.app.edoc.activeLayer.blend);
    check(mode !== 'normal', `the blend submenu sets the mode (${mode})`);
    await a.evaluate(() => window.pixelotter.app.run('edit.undo'));
    await a.evaluate(() => window.pixelotter.app.run('edit.undo'));
    check((await layers(a)).length === n, 'undo takes both changes back');
  });

  await step('channels panel', async () => {
    await a.evaluate(() => window.pixelotter.app.run('window.channels'));
    await a.waitForFunction(() => window.pixelotter.S.channels.list.length === 4, null, { timeout: 20000 });
    check(true, 'RGB and three channels listed');
    await a.click('[data-channel="r"] .channel-pick');
    check((await a.evaluate(() => document.querySelector('.vp-display').style.filter)).includes('po-channels'), 'the red channel shows alone on the canvas');
    await a.click('[data-channel="rgb"] .channel-pick');
    check(!(await a.evaluate(() => document.querySelector('.vp-display').style.filter)), 'RGB shows the full picture again');
    await a.click('[data-channel="g"] .icon-btn');
    check(await a.evaluate(() => window.pixelotter.S.selection.active), 'a channel loads as a selection');
    await a.evaluate(() => window.pixelotter.app.run('select.none'));
  });

  const exportAs = async (format, cmyk = false) => {
    await a.evaluate(() => window.pixelotter.ctx.contextMenu?.close());
    await a.click('[data-action="export"]');
    await a.selectOption('[data-field="format"]', format);
    await a.waitForFunction((f) => window.pixelotter.S.dlg.export.format === f, format, { timeout: 15000 });
    await a.evaluate((v) => (window.pixelotter.S.dlg.export.cmyk = v), cmyk);
    await a.waitForTimeout(400);
    const [dl] = await Promise.all([a.waitForEvent('download', { timeout: 90000 }), a.click('[data-action="do-export"]')]);
    return { path: await dl.path(), name: dl.suggestedFilename() };
  };

  await step('layered PSD out and back in', async () => {
    await a.evaluate(() => window.pixelotter.app.run('layer.new'));
    const want = (await layers(a)).length;
    const psd = await exportAs('psd');
    const bytes = readFileSync(psd.path);
    check(bytes.subarray(0, 4).toString() === '8BPS', `PSD signature (${psd.name})`);
    const n = await a.evaluate(() => window.pixelotter.app.docs.length);
    await a.setInputFiles('#file-input', psd.path);
    await a.waitForFunction((k) => window.pixelotter.app.docs.length === k + 1, n, { timeout: 60000 });
    const got = (await layers(a)).length;
    check(got === want, `the PSD opens with its ${got} layers`);
  });

  await step('CMYK TIFF export', async () => {
    const tif = await exportAs('tiff', true);
    const bytes = readFileSync(tif.path);
    const le = bytes.subarray(0, 2).toString() === 'II';
    const u16 = (o) => (le ? bytes.readUInt16LE(o) : bytes.readUInt16BE(o));
    const u32 = (o) => (le ? bytes.readUInt32LE(o) : bytes.readUInt32BE(o));
    const ifd = u32(4);
    let photometric = -1;
    for (let i = 0; i < u16(ifd); i++) if (u16(ifd + 2 + i * 12) === 262) photometric = u16(ifd + 2 + i * 12 + 8);
    check(photometric === 5, `TIFF with separated (CMYK) photometric (${tif.name})`);
  });

  await step('send the export to a friend (second context)', async () => {
    await openApp(b, base);
    await a.click('[data-action="export"]');
    await a.selectOption('[data-field="format"]', 'png');
    await a.waitForTimeout(400);
    await a.click('#dlg-export .btn-soft');
    await a.waitForFunction(() => document.querySelector('#code-words')?.dataset.words?.split(' ').length === 6, null, { timeout: 60000 });
    const words = (await a.getAttribute('#code-words', 'data-words')).split(' ');
    check((await a.inputValue('#invite-link')).endsWith(`#join=${words.join('-')}`), 'the invite link carries the same words');
    await b.click('[data-action="join"]');
    // the whole phrase pasted into the first box spreads one word per box and joins by itself
    await b.fill('#join-word-0', words.join(' '));
    const boxes = await b.evaluate(() => [0, 1, 2, 3, 4, 5].map((i) => document.getElementById(`join-word-${i}`).value));
    check(JSON.stringify(boxes) === JSON.stringify(words), 'pasted words spread one per box');
    await b.waitForFunction(() => document.querySelector('#confirm-words')?.dataset.words?.split(' ').length === 6, null, { timeout: 90000 });
    const confirm = (await b.getAttribute('#confirm-words', 'data-words')).split(' ');
    await a.waitForSelector('#confirm-word-0', { state: 'visible', timeout: 60000 });
    await a.fill('#confirm-word-0', confirm.join(' '));
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
