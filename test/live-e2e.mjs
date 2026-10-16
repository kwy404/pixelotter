// End to end test of a live room in four headless browser contexts with fake media devices.
// The host opens a room; one friend opens the invite link, one scans the QR code (decoded
// here with an independent reader) and one pastes the six words into the first box. All three
// must land in the same room. Then: co-editing with cursors, chat, voice with noise
// suppression, mute, camera on and off, a device switch and screen sharing.
// Usage: node test/live-e2e.mjs   (set BROWSER_PATH to use another Chromium based browser)
import jsQR from 'jsqr';
import { check, closeAll, failed, launch, openApp, openSample, serve, step } from './e2e-helpers.mjs';

const { server, base } = await serve();
const A = await launch({ width: 1440, height: 900 });
const B = await launch({ width: 1280, height: 820 });
const C = await launch({ width: 1280, height: 820 });
const D = await launch({ width: 1280, height: 820 });
const [a, b, c, d] = [A.page, B.page, C.page, D.page];
const all = [a, b, c, d];

const peers = (page) => page.evaluate(() => window.pixelotter.S.live.peers.map((p) => p.name).sort());
const live = (page) => page.evaluate(() => ({ mode: window.pixelotter.S.live.mode, step: window.pixelotter.S.live.step }));
const setName = (page, name) => page.evaluate((n) => (window.pixelotter.S.settings.name = n), name);
const waitLive = (page) => page.waitForFunction(() => window.pixelotter.S.live.mode === 'guest' && window.pixelotter.S.live.step === 'live', null, { timeout: 120000 });

let words = [];
let link = '';
try {
  await step('host opens a room', async () => {
    await Promise.all(all.map((p) => openApp(p, base)));
    for (const [p, n] of [[a, 'Ana'], [b, 'Bia'], [c, 'Caio'], [d, 'Duda']]) await setName(p, n);
    await openSample(a);
    await a.click('[data-action="share"]');
    await a.waitForFunction(() => window.pixelotter.S.live.step === 'code', null, { timeout: 90000 });
    words = (await a.getAttribute('#code-words', 'data-words')).split(' ');
    link = await a.inputValue('#invite-link');
    check(words.length === 6, `six words (${words.join(' ')})`);
    check(link === `${base}app/#join=${words.join('-')}`, 'the invite link carries the same words in the hash');
    check(await a.isVisible('[data-action="copy-invite"]'), 'the link has a Copy button');
    await a.click('[data-action="copy-invite"]');
    const copied = await a.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    check(copied === link, 'Copy puts the link on the clipboard');
  });

  let qrText = '';
  await step('the QR code holds the same link', async () => {
    const img = await a.evaluate(async () => {
      const svg = document.querySelector('#code-qr svg');
      const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const el = new Image();
      await new Promise((r, j) => {
        el.onload = r;
        el.onerror = j;
        el.src = url;
      });
      const cv = document.createElement('canvas');
      cv.width = cv.height = 480;
      const g = cv.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, 480, 480);
      g.drawImage(el, 0, 0, 480, 480);
      return [...g.getImageData(0, 0, 480, 480).data];
    });
    const res = jsQR(Uint8ClampedArray.from(img), 480, 480);
    qrText = res?.data ?? '';
    check(qrText === link, `an independent reader decodes the QR code to the link (${qrText.slice(-40)})`);
  });

  await step('friend one opens the invite link', async () => {
    await b.goto(link);
    await waitLive(b);
    check(!(await b.evaluate(() => location.hash)), 'the words are cleared from the address bar');
  });

  await step('friend two scans the QR code', async () => {
    await c.goto(qrText || link);
    await waitLive(c);
  });

  await step('friend three pastes the six words into the first box', async () => {
    await d.click('[data-action="join"]');
    await d.fill('#join-word-0', `Join my pixelotter room: ${words.join(' ')}`);
    const boxes = await d.evaluate(() => [0, 1, 2, 3, 4, 5].map((i) => document.getElementById(`join-word-${i}`).value));
    check(JSON.stringify(boxes) === JSON.stringify(words), `one word per box (${boxes.join(' ')})`);
    await waitLive(d);
  });

  await step('everyone is in the same room', async () => {
    await a.waitForFunction(() => window.pixelotter.S.live.peers.length === 4, null, { timeout: 60000 });
    const want = JSON.stringify(['Ana', 'Bia', 'Caio', 'Duda']);
    for (const [p, label] of [[a, 'host'], [b, 'link'], [c, 'QR code'], [d, 'words']]) {
      await p.waitForFunction(() => window.pixelotter.S.live.peers.length === 4, null, { timeout: 60000 });
      check(JSON.stringify(await peers(p)) === want, `${label}: sees all four people`);
    }
    const size = await b.evaluate(() => [window.pixelotter.app.edoc.doc.width, window.pixelotter.app.edoc.doc.height]);
    check(size[0] === 1600 && size[1] === 1200, 'the guest has the shared document');
    const safetyA = await a.evaluate(() => window.pixelotter.S.live.peers.find((p) => p.name === 'Bia')?.safety);
    const safetyB = await b.evaluate(() => window.pixelotter.S.live.peers.find((p) => p.host)?.safety);
    check(!!safetyA && safetyA === safetyB, `safety words match on both screens (${safetyA})`);
    check((await live(a)).step === 'code', 'the invite stays open for more friends');
  });

  await step('co-editing with cursors', async () => {
    await b.evaluate(() => window.pixelotter.app.run('layer.new'));
    await a.waitForFunction(() => window.pixelotter.app.edoc.doc.layers.length === 2, null, { timeout: 30000 });
    check(true, 'a layer added by a guest appears for the host');
    await c.waitForFunction(() => window.pixelotter.app.edoc.doc.layers.length === 2, null, { timeout: 30000 });
    check(true, 'and for the other guests');
    await a.evaluate(() => {
      const app = window.pixelotter.app;
      const l = app.edoc.doc.layers[0];
      app.edoc.commit('Opacity', [{ t: 'set', id: l.id, props: { opacity: 0.5 } }]);
    });
    await b.waitForFunction(() => window.pixelotter.app.edoc.doc.layers[0].opacity === 0.5, null, { timeout: 30000 });
    check(true, 'a host change reaches the guests');
    const box = await b.locator('#viewport').boundingBox();
    for (let i = 0; i < 6; i++) await b.mouse.move(box.x + box.width / 2 + i * 12, box.y + box.height / 2 + i * 6);
    await a.waitForFunction(() => [...window.pixelotter.app.vp.peers.values()].some((p) => p.name === 'Bia'), null, { timeout: 20000 });
    check(true, 'the host sees the guest cursor');
  });

  await step('chat', async () => {
    await b.evaluate(() => window.pixelotter.live.sendChat({ text: 'hello from Bia' }));
    for (const p of [a, c, d]) await p.waitForFunction(() => window.pixelotter.S.chat.some((m) => m.text === 'hello from Bia'), null, { timeout: 20000 });
    check(true, 'a guest message reaches the host and the other guests');
    // the invite dialog is modal: close it before typing in the side panel
    await a.evaluate(() => window.pixelotter.ctx.ui.closeDialog('dlg-live'));
    await a.evaluate(() => window.pixelotter.ctx.ui.openPanel('live'));
    await a.evaluate(() => (window.pixelotter.S.liveTab = 'chat'));
    await a.fill('#chat-input', 'hi all');
    await a.press('#chat-input', 'Enter');
    await d.waitForFunction(() => window.pixelotter.S.chat.some((m) => m.text === 'hi all' && m.name === 'Ana'), null, { timeout: 20000 });
    check(true, 'the chat box sends with Enter');
    await d.evaluate(() => {
      window.pixelotter.ctx.ui.openPanel('live');
      window.pixelotter.S.liveTab = 'chat';
    });
    await d.locator('[data-msg]', { hasText: 'hi all' }).first().click({ button: 'right' });
    const items = await d.locator('.ctx-menu [role^="menuitem"]').allInnerTexts();
    check(items.some((x) => x.includes('Reply')) && items.some((x) => x.includes('React')), 'a chat message has its own menu');
    await d.locator('.ctx-menu .ctx-item', { hasText: 'Reply' }).click();
    check(!!(await d.evaluate(() => window.pixelotter.S.replyTo)), 'Reply from the menu');
    await d.evaluate(() => (window.pixelotter.S.liveTab = 'people'));
    await d.locator('[data-peer]', { hasText: 'Ana' }).first().click({ button: 'right' });
    const peerItems = await d.locator('.ctx-menu [role^="menuitem"]').allInnerTexts();
    check(peerItems.some((x) => x.includes('Follow')), 'a person in the room has a menu');
    await d.keyboard.press('Escape');
  });

  await step('voice with noise suppression and mute', async () => {
    for (const p of [a, b]) await p.evaluate(() => window.pixelotter.ctx.globals.toggleCall());
    await a.waitForFunction(() => window.pixelotter.S.call.inCall, null, { timeout: 30000 });
    check((await a.evaluate(() => window.pixelotter.S.call.processing)) === 'strong', 'the microphone runs through the noise suppression worklet');
    await b.waitForFunction(() => !!window.pixelotter.live.call.remote.get('host')?.audio, null, { timeout: 45000 });
    check(true, 'the guest receives the host voice');
    await a.waitForFunction(() => window.pixelotter.S.devices.inputs.length > 0, null, { timeout: 15000 });
    check(true, 'the device pickers list the microphones');
    await a.evaluate(() => window.pixelotter.ctx.globals.toggleMute());
    const muted = await a.evaluate(() => window.pixelotter.live.call.pipe.out.getAudioTracks().every((t) => !t.enabled));
    check(muted && (await a.evaluate(() => window.pixelotter.S.call.muted)), 'mute stops sending sound');
    await a.evaluate(() => window.pixelotter.ctx.globals.toggleMute());
    const before = await a.evaluate(() => window.pixelotter.live.call.pipe.raw.getAudioTracks()[0].id);
    const id = await a.evaluate(() => window.pixelotter.S.devices.inputs.at(-1).id);
    await a.selectOption('#call-mic', id).catch(() => a.evaluate((v) => window.pixelotter.ctx.globals.pickDevice('mic', v), id));
    await a.waitForFunction((old) => window.pixelotter.live.call.pipe?.raw.getAudioTracks()[0]?.id !== old, before, { timeout: 15000 });
    const sent = await a.evaluate(() => {
      const live = window.pixelotter.live;
      const track = live.call.pipe.out.getAudioTracks()[0];
      return live.mediaLinks().every((l) => l.senders.mic?.track === track) && track.enabled;
    });
    check(sent, 'picking another microphone swaps the track on every link, unmuted');
  });

  await step('camera on and off, and screen sharing', async () => {
    await a.evaluate(() => window.pixelotter.ctx.globals.toggleCamera());
    await b.waitForFunction(() => !!window.pixelotter.live.call.remote.get('host')?.camera, null, { timeout: 45000 });
    check(true, 'the guest sees the host camera');
    await b.waitForFunction(() => window.pixelotter.S.call.tiles.some((t) => t.kind === 'camera' && !t.self), null, { timeout: 15000 });
    check(true, 'a camera tile shows');
    await a.evaluate(() => window.pixelotter.ctx.globals.toggleCamera());
    check(!(await a.evaluate(() => window.pixelotter.S.call.camera)), 'camera off stops the camera');
    await b.waitForFunction(() => !window.pixelotter.S.call.tiles.some((t) => t.kind === 'camera' && !t.self), null, { timeout: 30000 });
    check(true, 'the camera tile goes away for the guest');
    await b.evaluate(() => window.pixelotter.ctx.globals.toggleScreen());
    const sharing = await b.waitForFunction(() => window.pixelotter.S.call.screen, null, { timeout: 15000 }).then(() => true, () => false);
    check(sharing, 'the guest shares a screen');
    if (sharing) {
      await a.waitForFunction(() => window.pixelotter.S.call.tiles.some((t) => t.kind === 'screen' && !t.self), null, { timeout: 45000 });
      check(true, 'the host sees the shared screen');
    }
  });

  await step('leaving', async () => {
    await d.evaluate(() => window.pixelotter.live.leave());
    await a.waitForFunction(() => window.pixelotter.S.live.peers.length === 3, null, { timeout: 30000 });
    check(true, 'the host sees a friend leave');
  });

  for (const [ctx, label] of [[A, 'host'], [B, 'link guest'], [C, 'QR guest'], [D, 'words guest']]) {
    check(ctx.errors.length === 0, `no console errors for the ${label}${ctx.errors.length ? `: ${ctx.errors.slice(0, 3).join(' | ')}` : ''}`);
  }
} finally {
  await closeAll(A.ctx, B.ctx, C.ctx, D.ctx);
  server.close();
}
console.log(failed() ? `\n${failed()} check(s) failed` : '\nAll checks passed');
process.exit(failed() ? 1 : 0);
