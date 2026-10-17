// End to end test of the editor in two headless browser contexts: open the app, load the
// sample, adjust it, add text, remove the background, use the menus, export a PNG, save and
// reopen a .pxo project, check the tool cursors, the brush edge, the tour (at 1440 and 375
// wide), editable text, the tooltips, keyboard shortcuts and the clipboard, and send the
// export to a second context with a SHA-256 match.
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

  await step('tool cursors over the canvas', async () => {
    await a.evaluate(() => window.pixelotter.ctx.contextMenu?.close());
    const box = await a.locator('.vp-stage').boundingBox();
    const mx = box.x + box.width / 2 + 0.25;
    const my = box.y + box.height / 2 + 0.75;
    const cursor = () =>
      a.evaluate(() => {
        const vp = window.pixelotter.app.vp;
        const el = document.querySelector('.vp-cursor');
        const svg = el.querySelector('svg')?.getBoundingClientRect();
        return { css: vp.stage.style.cursor, hidden: el.hidden, size: Number(el.dataset.size), mode: el.dataset.mode, zoom: vp.view.zoom, cx: svg ? svg.left + svg.width / 2 : null, cy: svg ? svg.top + svg.height / 2 : null };
      });
    await a.evaluate(() => {
      const app = window.pixelotter.app;
      app.setTool('brush');
      app.opts('brush').size = 40;
    });
    await a.mouse.move(mx, my);
    let c = await cursor();
    check(c.css === 'none' && !c.hidden, 'the brush hides the arrow and shows its outline');
    check(Math.abs(c.size - 40 * c.zoom) < 0.6, `the outline matches the brush at ${Math.round(c.zoom * 100)}% (${c.size} px)`);
    check(Math.abs(c.cx - mx) < 0.6 && Math.abs(c.cy - my) < 0.6, 'the outline is centered on the pointer');
    await a.evaluate(() => window.pixelotter.app.vp.setZoom(3, null));
    await a.mouse.move(mx + 7, my + 3);
    c = await cursor();
    check(Math.abs(c.size - 120) < 0.6 && Math.abs(c.cx - (mx + 7)) < 0.6, 'the outline follows the zoom and the pointer');
    await a.evaluate(() => (window.pixelotter.app.opts('brush').size = 2));
    await a.waitForTimeout(100);
    c = await cursor();
    check(Math.abs(c.size - 6) < 0.6 && (await a.locator('.vp-cursor path').count()) > 0, 'a small brush gets a crosshair in the middle');
    await a.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'CapsLock', modifierCapsLock: true })));
    c = await cursor();
    check(c.mode === 'precise' && !c.hidden, 'Caps Lock switches to the precise crosshair');
    await a.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'CapsLock', modifierCapsLock: false })));
    check((await cursor()).mode === 'outline', 'and back to the outline');
    // a pen hovering shows the outline; a finger shows it only while it touches
    const synth = (type, kind) =>
      a.evaluate(
        ([type, kind, x, y]) => document.querySelector('.vp-stage').dispatchEvent(new PointerEvent(type, { pointerType: kind, pointerId: 7, clientX: x, clientY: y, bubbles: true, isPrimary: true })),
        [type, kind, mx + 20, my + 20],
      );
    await synth('pointermove', 'pen');
    c = await cursor();
    check(!c.hidden && Math.abs(c.cx - (mx + 20)) < 0.6, 'a hovering pen shows the outline');
    await synth('pointermove', 'touch');
    check((await cursor()).hidden, 'a finger that is not touching shows nothing');
    await a.mouse.move(box.x + box.width + 40, box.y + 10);
    check((await cursor()).hidden, 'leaving the canvas hides the outline');
    const css = {};
    for (const tool of ['move', 'marquee', 'lasso', 'eyedropper', 'crop', 'text', 'hand', 'zoom', 'eraser']) {
      await a.evaluate((t) => window.pixelotter.app.setTool(t), tool);
      await a.mouse.move(mx, my);
      c = await cursor();
      css[tool] = c.hidden ? c.css.slice(0, 4) : 'outline';
    }
    check(css.move === 'move' && css.marquee === 'cros' && css.lasso === 'cros' && css.crop === 'cros' && css.text === 'text' && css.hand === 'grab' && css.zoom === 'zoom' && css.eyedropper === 'url(' && css.eraser === 'outline', `every tool has its cursor (${JSON.stringify(css)})`);
    await a.evaluate(() => {
      const app = window.pixelotter.app;
      app.opts('brush').size = 40;
      app.setTool('move');
      app.vp.fit();
    });
  });

  await step('a black brush on white has clean edges', async () => {
    const back = await a.evaluate(() => window.pixelotter.app.edoc.uid);
    await a.evaluate(() => {
      const app = window.pixelotter.app;
      app.newDocument({ width: 600, height: 400 });
      app.setTool('brush');
      app.setColor('fg', '#000000');
      Object.assign(app.opts('brush'), { size: 40, hardness: 0.7, opacity: 1, flow: 1 });
    });
    await a.waitForTimeout(300);
    const at = (x, y) =>
      a.evaluate(([x, y]) => {
        const vp = window.pixelotter.app.vp;
        const b = vp.stage.getBoundingClientRect();
        const s = vp.toScreen(x, y);
        return { x: b.left + s.x, y: b.top + s.y };
      }, [x, y]);
    let q = await at(100, 150);
    await a.mouse.move(q.x, q.y);
    await a.mouse.down();
    for (let i = 1; i <= 40; i++) {
      q = await at(100 + i * 10, 150 + i * 2.3);
      await a.mouse.move(q.x, q.y);
    }
    await a.mouse.up();
    // walk down a column through the stroke: the alpha rises once and falls once
    const bumps = await a.evaluate(() => {
      const app = window.pixelotter.app;
      const l = app.edoc.doc.layers.at(-1);
      let bad = 0;
      for (const col of [180, 251, 333, 407]) {
        const px = app.edoc.assets.read(l.asset, { x: col, y: 0, w: 1, h: 400 });
        const al = [];
        for (let y = 0; y < 400; y++) al.push(px[y * 4 + 3]);
        const peak = al.indexOf(Math.max(...al));
        for (let y = 1; y <= peak; y++) if (al[y] < al[y - 1] - 1) bad++;
        for (let y = peak + 1; y < 400; y++) if (al[y] > al[y - 1] + 1) bad++;
      }
      return bad;
    });
    check(bumps === 0, `the stroke edge falls off smoothly, without a ring (${bumps} bumps)`);
    await a.evaluate((uid) => {
      const app = window.pixelotter.app;
      app.closeDoc(app.edoc.uid);
      app.activate(uid);
      app.setTool('move');
    }, back);
  });

  await step('the tour', async () => {
    const tour = () =>
      a.evaluate(() => {
        const S = window.pixelotter.S;
        const box = (el) => {
          const r = el?.getBoundingClientRect();
          return r && { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
        };
        const spot = document.querySelector('.tour-spot');
        const sel = { tools: '.toolbox', options: '.optbar', layers: '[data-panel-group="c"]', quick: '.ws-switch', share: '[data-action="share"]', export: '[data-action="export"]' }[S.tour.key];
        return { on: S.tour.on, i: S.tour.i, n: S.tour.n, key: S.tour.key, card: box(document.querySelector('.tour-card')), spot: getComputedStyle(spot).display === 'none' ? null : box(spot), target: sel ? box(document.querySelector(sel)) : null, vw: innerWidth, vh: innerHeight, focus: document.activeElement?.dataset.action ?? '' };
      });
    const inside = (c, s) => c.l >= 0 && c.t >= 0 && c.r <= s.vw && c.b <= s.vh;
    const overlaps = (x, y) => x.l < y.r && y.l < x.r && x.t < y.b && y.t < x.b;
    const walk = async (label) => {
      await a.evaluate(() => window.pixelotter.app.run('help.tour'));
      await a.waitForTimeout(450);
      let s = await tour();
      check(s.on && s.key === 'welcome' && s.focus === 'tour-next', `${label}: the tour opens on the welcome card with Next focused`);
      const seen = [];
      const wrong = [];
      for (let k = 0; k < 10 && s.on; k++) {
        seen.push(s.key);
        if (!inside(s.card, s)) wrong.push(`${s.key}: card outside the window`);
        if (s.key !== 'welcome') {
          // the spotlight sits on a target that is on screen, and the card does not cover it
          // the part of the target inside the window
          const v = s.target && { l: Math.max(0, s.target.l), t: Math.max(0, s.target.t), r: Math.min(s.vw, s.target.r), b: Math.min(s.vh, s.target.b) };
          if (!v || !s.spot || v.r - v.l < 4 || v.b - v.t < 4) wrong.push(`${s.key}: target not on screen`);
          else if (s.spot.l > v.l + 6 || s.spot.t > v.t + 6 || s.spot.r < v.r - 6 || s.spot.b < v.b - 6) wrong.push(`${s.key}: spotlight misses the target`);
          else if (overlaps(s.card, v)) wrong.push(`${s.key}: card covers the target`);
        }
        if (s.i === 1) {
          await a.click('[data-action="tour-back"]');
          await a.waitForTimeout(450);
          const back = await tour();
          check(back.i === 0 && back.key === 'welcome', `${label}: Back returns to the previous step`);
          await a.click('[data-action="tour-next"]');
          await a.waitForTimeout(450);
        }
        await a.click('[data-action="tour-next"]');
        await a.waitForTimeout(450);
        s = await tour();
      }
      check(!wrong.length, `${label}: every step points at a visible part and the card stays in the window (${wrong.length ? wrong.join('; ') : seen.join(', ')})`);
      check(!s.on && !(await a.isVisible('.tour')), `${label}: the last step finishes the tour`);
      return seen;
    };
    const wide = await walk('1440');
    check(wide.length === 7, `all seven steps in the Pro workspace (${wide.length})`);
    // after the tour the editor takes clicks again
    const box = await a.locator('.vp-stage').boundingBox();
    const free = await a.evaluate(([x, y]) => !document.elementFromPoint(x, y)?.closest('.tour'), [box.x + box.width / 2, box.y + box.height / 2]);
    check(free, 'nothing of the tour blocks the canvas once it is closed');
    // Skip and Escape
    await a.evaluate(() => window.pixelotter.app.run('help.tour'));
    await a.waitForTimeout(300);
    await a.click('[data-action="tour-next"]');
    await a.click('[data-action="tour-skip"]');
    check(!(await tour()).on, 'Skip closes the tour');
    await a.evaluate(() => window.pixelotter.app.run('help.tour'));
    await a.waitForTimeout(300);
    const tool = await a.evaluate(() => window.pixelotter.app.toolId);
    await a.keyboard.press('b');
    check((await a.evaluate(() => window.pixelotter.app.toolId)) === tool, 'tool keys wait while the tour is open');
    await a.keyboard.press('Escape');
    check(!(await tour()).on, 'Escape closes the tour');
    check(await a.evaluate(() => localStorage.getItem('pixelotter:toured') === '1'), 'the tour is remembered as seen');
    // a phone
    await a.setViewportSize({ width: 375, height: 812 });
    await a.waitForTimeout(500);
    const narrow = await walk('375');
    check(narrow.length >= 2 && !narrow.includes('tools') && !narrow.includes('options'), `on a phone only the parts on screen (${narrow.join(', ')})`);
    await a.setViewportSize({ width: 1440, height: 900 });
    await a.waitForTimeout(500);
  });

  await step('editable text layers', async () => {
    await a.evaluate(() => window.pixelotter.ctx.contextMenu?.close());
    const at = (x, y) =>
      a.evaluate(([x, y]) => {
        const vp = window.pixelotter.app.vp;
        const b = vp.stage.getBoundingClientRect();
        const s = vp.toScreen(x, y);
        return { x: b.left + s.x, y: b.top + s.y };
      }, [x, y]);
    const textLayers = () => a.evaluate(() => window.pixelotter.app.edoc.doc.layers.filter((l) => l.type === 'text').map((l) => ({ id: l.id, name: l.name, text: l.text, size: l.size })));
    const editing = () => a.evaluate(() => !document.getElementById('text-editor').hidden && document.activeElement?.id === 'text-editor');
    const before = (await textLayers()).length;
    await a.evaluate(() => {
      window.pixelotter.ctx.ui.openPanel('layers');
      window.pixelotter.app.setTool('text');
    });
    const q = await at(400, 300);
    await a.mouse.click(q.x, q.y);
    await a.waitForTimeout(200);
    check(await editing(), 'a click with the Text tool opens the editor with the caret in it');
    await a.keyboard.type('Hello');
    await a.keyboard.press('Enter');
    await a.keyboard.type('there');
    await a.keyboard.press('Escape');
    let list = await textLayers();
    const made = list.at(-1);
    check(list.length === before + 1 && made.text === 'Hello\nthere', `typing, Enter for a new line and Escape commit the text (${JSON.stringify(made?.text)})`);
    check(made.name === 'Hello', `the layer is named after its text (${made.name})`);
    const row = a.locator(`.layer-row[data-layer="${made.id}"]`);
    check((await row.count()) === 1 && (await row.locator('.thumb-t').isVisible()), 'the layer shows in the panel with a T');
    // back into the text: a click on it with the Text tool
    await a.mouse.click(q.x, q.y);
    await a.waitForTimeout(200);
    check(await editing(), 'a click on the text enters edit mode again');
    await a.keyboard.press('Control+End');
    await a.keyboard.press('Backspace');
    await a.keyboard.type('e!');
    // a click outside commits and does not start another text
    const out = await at(40, 40);
    await a.mouse.click(out.x, out.y);
    list = await textLayers();
    check(list.length === before + 1 && list.at(-1).text === 'Hello\nthere!' && !(await editing()), `a click outside commits the change (${JSON.stringify(list.at(-1).text)})`);
    // the size from the options bar, live
    await a.fill('[data-field="text-size"]', '150');
    await a.waitForTimeout(200);
    list = await textLayers();
    check(list.at(-1).size === 150, `the options bar changes the size of the selected text (${list.at(-1).size})`);
    await a.evaluate(() => window.pixelotter.app.run('edit.undo'));
    list = await textLayers();
    check(list.at(-1).size !== 150, 'undo takes the size back');
    await a.evaluate(() => window.pixelotter.app.run('edit.undo'));
    list = await textLayers();
    check(list.at(-1).text === 'Hello\nthere', 'undo takes the text edit back');
    check((await row.count()) === 1, 'the text layer is still in the panel');
    // a double click on the canvas with the Move tool opens the text too
    await a.evaluate(() => window.pixelotter.app.setTool('move'));
    await a.mouse.dblclick(q.x, q.y);
    await a.waitForTimeout(200);
    check(await editing(), 'a double click on the text with the Move tool edits it');
    await a.keyboard.press('Escape');
    await a.evaluate(() => window.pixelotter.app.setTool('move'));
  });

  await step('tooltips', async () => {
    await a.mouse.move(5, 450);
    await a.hover('.tool-btn[data-tool="brush"]');
    await a.waitForSelector('#po-tip:not([hidden])', { timeout: 3000 });
    const tip = await a.evaluate(() => {
      const t = document.getElementById('po-tip');
      const r = t.getBoundingClientRect();
      const s = document.querySelector('.vp-stage').getBoundingClientRect();
      return { text: t.textContent, x: r.left, right: r.right, inside: r.right <= innerWidth && r.bottom <= innerHeight, native: document.querySelector('.tool-btn[data-tool="brush"]').getAttribute('title'), left: s.left };
    });
    check(tip.text.includes('Brush') && tip.text.includes('B') && tip.text.includes('foreground'), `the brush button explains itself with its shortcut (${tip.text.slice(0, 60)})`);
    check(tip.inside && tip.native === null, 'the tooltip stays in the window and replaces the browser tooltip');
    await a.mouse.move(700, 500);
    await a.waitForTimeout(100);
    check(await a.evaluate(() => document.getElementById('po-tip').hidden), 'it hides when the pointer leaves');
    await a.focus('[data-action="export"]');
    await a.keyboard.press('Shift+Tab');
    await a.keyboard.press('Tab');
    await a.waitForSelector('#po-tip:not([hidden])', { timeout: 3000 }).catch(() => {});
    check(await a.evaluate(() => !document.getElementById('po-tip').hidden), 'keyboard focus shows the tooltip too');
    check((await a.textContent('[data-field="tool-hint"]')).length > 5, 'the status bar says what to do with the tool');
  });

  await step('keyboard shortcuts', async () => {
    await a.evaluate(() => {
      const app = window.pixelotter.app;
      app.run('select.none');
      app.setTool('move');
      window.pixelotter.ctx.ui.openPanel('layers');
    });
    const names = () => a.evaluate(() => window.pixelotter.app.edoc.doc.layers.map((l) => l.name));
    const n0 = (await names()).length;
    await a.focus('#viewport');
    await a.keyboard.press('Control+j');
    check((await names()).length === n0 + 1, 'Ctrl+J duplicates the layer');
    const dup = await a.evaluate(() => window.pixelotter.app.edoc.activeLayer.name);
    await a.keyboard.press('Delete');
    const after = await names();
    check(after.length === n0 && !after.includes(dup), `Delete removes the active layer (${dup})`);
    // nothing fires while typing in a field
    const steps = () => a.evaluate(() => window.pixelotter.app.edoc.history.index);
    const before = await steps();
    const field = a.locator('[data-control="opacity"]');
    const value = await field.inputValue();
    await field.click();
    await a.keyboard.press('Delete');
    await a.keyboard.press('Control+j');
    await a.keyboard.press('b');
    check((await names()).length === n0 && (await a.evaluate(() => window.pixelotter.app.toolId)) === 'move', 'shortcuts do not fire inside a text field');
    // put the field back as it was, so leaving it does not record an opacity change (where the
    // click puts the caret differs between systems, and Delete may have removed a digit)
    await field.evaluate((el, v) => {
      el.value = v;
      el.blur();
    }, value);
    check((await steps()) === before, 'typing in the field recorded nothing');
    await a.focus('#viewport');
    await a.keyboard.press('Control+z');
    const back = await a.waitForFunction((d) => window.pixelotter.app.edoc.doc.layers.some((l) => l.name === d), dup, { timeout: 5000 }).then(() => true, () => false);
    check(back, 'Ctrl+Z brings the layer back');
    await a.keyboard.press('Control+y');
    const gone = await a.waitForFunction((d) => !window.pixelotter.app.edoc.doc.layers.some((l) => l.name === d), dup, { timeout: 5000 }).then(() => true, () => false);
    check(gone, 'Ctrl+Y redoes');
    const menuKey = await a.evaluate(async () => {
      window.pixelotter.S.menuOpen = null;
      document.querySelector('[data-menu="layer"]').click();
      await new Promise((r) => setTimeout(r, 100));
      const k = document.querySelector('.menu-pop [data-cmd="layer.duplicate"] .menu-key')?.textContent;
      window.pixelotter.ctx.globals.closeMenus?.();
      return k;
    });
    check(menuKey === 'Ctrl+J', `the menu shows the shortcut (${menuKey})`);
  });

  await step('clipboard: paste, copy and drop', async () => {
    await a.evaluate(() => {
      const app = window.pixelotter.app;
      app.run('select.none');
      app.setTool('move');
    });
    const layers2 = () => a.evaluate(() => window.pixelotter.app.edoc.doc.layers.map((l) => ({ id: l.id, type: l.type, name: l.name, w: l.w, h: l.h, x: l.x, y: l.y, text: l.text })));
    // a synthetic paste event, as the browser fires for Ctrl+V; target: body, or a selector
    const paste = (what, on = null) =>
      a.evaluate(async ([what, on]) => {
        const dt = new DataTransfer();
        if (what.png) {
          const c = document.createElement('canvas');
          c.width = what.png[0];
          c.height = what.png[1];
          const g = c.getContext('2d');
          g.fillStyle = '#2a7';
          g.fillRect(0, 0, c.width, c.height);
          const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
          dt.items.add(new File([blob], 'image.png', { type: 'image/png' }));
        } else dt.setData('text/plain', what.text);
        const el = on ? document.querySelector(on) : document.body;
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 700));
      }, [what, on]);
    let before = await layers2();
    await paste({ png: [123, 45] });
    let now = await layers2();
    const added = now.find((l) => !before.some((b) => b.id === l.id));
    check(added?.type === 'raster' && added.w === 123 && added.h === 45, `pasting PNG bytes makes a ${added?.w} x ${added?.h} layer`);
    before = now;
    await paste({ text: 'Olá mundo' });
    now = await layers2();
    const text = now.find((l) => !before.some((b) => b.id === l.id));
    check(text?.type === 'text' && text.text === 'Olá mundo', 'pasting text makes a text layer');
    await paste({ text: '#ff8800' });
    check((await a.evaluate(() => window.pixelotter.S.colors.fg)) === '#ff8800', 'pasting a hex color sets the foreground');
    await a.evaluate(() => window.pixelotter.app.setColor('fg', '#000000'));
    // inside a text field the browser pastes as text, the canvas gets nothing
    before = await layers2();
    await a.focus('[data-control="opacity"]');
    await paste({ text: 'Another text' }, '[data-control="opacity"]');
    check((await layers2()).length === before.length, 'a paste inside a text field stays in the field');
    // copy a selection, paste it back: same pixels, same place
    const copied = await a.evaluate(async () => {
      const { app, ctx } = window.pixelotter;
      // a plain layer with known pixels (the photo has adjustments and a look on top)
      await app.run('layer.new');
      const bg = app.edoc.activeLayer;
      const fill = new Uint8ClampedArray(bg.w * bg.h * 4);
      for (let i = 0; i < bg.w * bg.h; i++) fill.set([(i * 13) % 256, (i >> 4) % 256, (i * 7) % 256, 255], i * 4);
      app.edoc.commit('fill', [{ t: 'patch', id: bg.asset, x: 0, y: 0, w: bg.w, h: bg.h, data: fill }]);
      app.edoc.commit('sel', [{ t: 'sel', data: app.edoc.selection.rect(100, 120, 50, 40) }]);
      await ctx.ui.copy(false);
      app.run('select.none');
      const px = app.edoc.assets.read(bg.asset, { x: 100, y: 120, w: 50, h: 40 });
      let sum = 0;
      for (let i = 0; i < px.length; i++) sum = (sum * 31 + px[i]) % 1000000007;
      return sum;
    });
    before = await layers2();
    await a.evaluate(async () => {
      const dt = new DataTransfer();
      dt.items.add(new File([window.pixelotter.ctx.clipboard.blob], 'image.png', { type: 'image/png' }));
      document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 700));
    });
    now = await layers2();
    const back = now.find((l) => !before.some((b) => b.id === l.id));
    const same = await a.evaluate((id) => {
      const { app } = window.pixelotter;
      const l = app.edoc.layer(id);
      const px = app.edoc.assets.read(l.asset);
      let sum = 0;
      for (let i = 0; i < px.length; i++) sum = (sum * 31 + px[i]) % 1000000007;
      return sum;
    }, back?.id);
    check(back && back.x === 125 && back.y === 140 && back.w === 50 && same === copied, `copy then paste keeps the pixels and the place (${back?.x}, ${back?.y})`);
    check(await a.evaluate(() => window.pixelotter.app.edoc.activity.some((e) => e.k === 'paste')), 'the Activity panel logs the paste');
    // drop an image file on the canvas
    before = await layers2();
    await a.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 32;
      c.getContext('2d').fillRect(0, 0, 64, 32);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'dropped.png', { type: 'image/png' }));
      const stage = document.querySelector('.vp-stage');
      const r = stage.getBoundingClientRect();
      const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, dataTransfer: dt, bubbles: true, cancelable: true };
      stage.dispatchEvent(new DragEvent('dragenter', at));
      stage.dispatchEvent(new DragEvent('dragover', at));
      stage.dispatchEvent(new DragEvent('drop', at));
      await new Promise((r) => setTimeout(r, 700));
    });
    now = await layers2();
    const dropped = now.find((l) => !before.some((b) => b.id === l.id));
    check(dropped?.name === 'dropped' && dropped.w === 64, 'dropping an image file on the canvas makes a layer');
    check(await a.evaluate(() => !!window.pixelotter.app.commands.can('edit.pasteInto') === !window.pixelotter.app.edoc.selection.empty), 'Paste into selection is enabled only with a selection');
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
    const back = await layers(a);
    const got = back.length;
    check(got === want, `the PSD opens with its ${got} layers`);
    check(back.some((l) => l.type === 'text'), 'text comes back from the PSD as editable text');
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
    // a name given before, so joining does not ask for one
    await b.evaluate(() => (window.pixelotter.S.settings.name = 'Bea'));
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
