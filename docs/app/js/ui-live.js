// The live session panel and dialogs: inviting with six words, a QR code and an invite link
// with a Copy button (all three carry the same words), joining by typing, pasting or scanning,
// safety words, people and roles, follow mode, chat with replies, reactions and pasted images,
// and the call with mute, camera, screen sharing, device pickers and video tiles.

import { resolvePhrase, resolveWord, splitPhrase, suggestWords, wordsFromLink } from '../lib/words.js';
import { Live } from './live.js';
import { PEER_COLORS } from '../lib/session.js';
import { download } from './files.js';
import { openFile } from './files.js';

export function installLive(ctx) {
  const { app, S, t, globals, ui } = ctx;
  const live = new Live(app, ui);
  app.live = live;
  S.live = { mode: 'off', step: 'idle', peers: [], words: [], qr: '', unread: 0 };
  S.chat = [];
  S.call = { inCall: false, muted: false, camera: false, screen: false, processing: null, speaking: [], tiles: [] };

  // ---------- my name and color, asked once before the first live session ----------
  S.dlg.name = { name: '', color: PEER_COLORS[0], colors: [...PEER_COLORS] };
  let nameDone = null;
  ui.ensureName = () => {
    const auto = S.settings.color || PEER_COLORS[Math.floor(Math.random() * PEER_COLORS.length)];
    if (S.settings.name.trim()) {
      // named before: the color is picked for them, and can be changed in Settings
      if (!S.settings.color) {
        S.settings.color = auto;
        ctx.saveLocal();
      }
      return Promise.resolve(true);
    }
    S.dlg.name = { name: '', color: auto, colors: [...PEER_COLORS] };
    ui.openDialog('dlg-name');
    setTimeout(() => document.getElementById('name-input')?.focus(), 50);
    return new Promise((resolve) => (nameDone = resolve));
  };
  const finishName = (ok) => {
    ui.closeDialog('dlg-name');
    const done = nameDone;
    nameDone = null;
    done?.(ok);
  };
  globals.nameOk = () => {
    const name = S.dlg.name.name.trim().slice(0, 40);
    if (!name) return;
    S.settings.name = name;
    S.settings.color = S.dlg.name.color;
    ctx.saveLocal();
    finishName(true);
  };
  globals.nameCancel = () => finishName(false);
  document.getElementById('dlg-name')?.addEventListener('close', () => nameDone && finishName(false));
  globals.goToPeer = (peer) => live.goToPeer(peer);

  ui.liveDialog = async () => {
    if (live.mode === 'off' && !(await ui.ensureName())) return;
    ui.openDialog('dlg-live');
    ui.openPanel('live');
    if (live.mode === 'off') await live.host();
    else if (live.mode === 'host' && S.live.step !== 'code') await live.openRoom();
  };
  globals.inviteMore = async () => {
    ui.openDialog('dlg-live');
    if (live.mode === 'send') return live.newInvite('send');
    if (live.mode === 'host' && S.live.step !== 'code') await live.openRoom();
  };
  // new words: the old words, QR code and link stop working for anyone who has not joined yet
  globals.newRoomWords = () => live.openRoom({ fresh: true });
  globals.copyInvite = async () => {
    const link = S.live.qrLink;
    if (!link) return;
    let ok = false;
    try {
      await navigator.clipboard.writeText(link);
      ok = true;
    } catch {
      const el = document.getElementById('invite-link');
      if (el) {
        el.select();
        ok = document.execCommand?.('copy') ?? false;
      }
    }
    S.live = { ...S.live, copied: ok };
    ctx.toast(ok ? t('live.copied') : t('live.copyFailed'), ok ? 'success' : 'warning');
    setTimeout(() => (S.live = { ...S.live, copied: false }), 2000);
  };
  globals.shareInvite = async () => {
    try {
      await navigator.share({ title: 'pixelotter', text: t('live.shareText'), url: S.live.qrLink });
    } catch {
      // closed or not supported
    }
  };
  globals.canShare = () => typeof navigator.share === 'function';
  ui.joinDialog = (words = null) => {
    if (live.mode !== 'off' && live.mode !== 'joining') live.leave();
    S.live = { ...S.live, mode: 'off', step: 'idle' };
    S.dlg.join = { error: '' };
    ui.openDialog('dlg-join');
    for (let i = 0; i < 6; i++) {
      const el = document.getElementById(`join-word-${i}`);
      if (el) el.value = words?.[i] ?? '';
    }
    setTimeout(() => document.getElementById('join-word-0')?.focus(), 50);
    if (words?.length === 6) globals.joinWords();
  };
  const read = (prefix) => [0, 1, 2, 3, 4, 5].map((i) => document.getElementById(`${prefix}${i}`)?.value ?? '');
  const box = (prefix, i) => document.getElementById(`${prefix}${i}`);
  const submitFor = (prefix) => (prefix === 'join-word-' ? globals.joinWords : globals.confirmWords);

  // Puts a pasted phrase, invite text or link into the boxes, one word per box, starting at the
  // first box for a whole phrase. Phone keyboards insert clipboard text with an input event and
  // no paste event, so both handlers come here. Returns false when the text holds one word.
  const spread = (prefix, i, text) => {
    let parts = wordsFromLink(text) || splitPhrase(text);
    if (parts.length < 2) return false;
    if (parts.length > 6) {
      // a shared text with a label ("Join me: ...") still works: keep only the exact words
      const known = parts.filter((p) => resolveWord(p)?.how === 'exact');
      if (known.length >= 6) parts = known.slice(-6);
    }
    const start = parts.length >= 6 ? 0 : i;
    box(prefix, i).value = '';
    parts.slice(0, 6 - start).forEach((p, k) => {
      const el = box(prefix, start + k);
      if (el) el.value = p;
    });
    const empty = [0, 1, 2, 3, 4, 5].map((k) => box(prefix, k)).find((el) => el && !resolveWord(el.value));
    (empty ?? box(prefix, 5))?.focus();
    if (resolvePhrase(read(prefix)).ok) submitFor(prefix)();
    return true;
  };
  ctx.spreadWords = spread;
  globals.pasteWords = (e, prefix) => {
    const i = Number(e.target.id.slice(prefix.length)) || 0;
    if (spread(prefix, i, e.clipboardData?.getData('text') ?? '')) e.preventDefault();
  };
  globals.wordTyped = (e, i, prefix = 'join-word-') => {
    const v = e.target.value;
    // more than one word arrived at once (a paste from a phone keyboard, or autofill)
    if (/[^A-Za-z\u00c0-\u024f]/.test(v.trim()) && spread(prefix, i, v)) return;
    // a finished word jumps to the next box
    if (/\s$/.test(v)) {
      e.target.value = v.trim();
      box(prefix, i + 1)?.focus();
      return;
    }
    const s = suggestWords(v, 2);
    if (s.length === 1 && v.length >= 4 && s[0] === v.toLowerCase()) box(prefix, i + 1)?.focus();
  };
  globals.joinWords = async () => {
    const res = resolvePhrase(read('join-word-'));
    if (!res.ok) {
      S.dlg.join.error = t('join.incomplete');
      return;
    }
    S.dlg.join.error = '';
    if (!(await ui.ensureName())) return;
    await live.join(res.words);
  };
  globals.confirmWords = () => live.confirmTyped(read('confirm-word-'));
  // the join dialog closes by itself once the shared document is open
  const watch = setInterval(() => {
    if (S.live.step === 'live' && live.mode === 'guest') ui.closeDialog('dlg-join');
  }, 400);
  void watch;

  // invite links and QR codes: app/#join=word-word-... The words never leave the browser (a
  // hash is not sent to any server) and are cleared from the address bar right away.
  ctx.handleHash = () => {
    const words = wordsFromLink(location.hash);
    if (words) {
      history.replaceState(null, '', location.pathname + location.search);
      ui.joinDialog(words.length === 6 ? words : null);
      if (words.length !== 6) ctx.spreadWords('join-word-', 0, words.join(' '));
      return true;
    }
    if (location.hash === '#quick') {
      ui.setWorkspace('quick');
      history.replaceState(null, '', location.pathname + location.search);
    }
    return false;
  };
  window.addEventListener('hashchange', () => ctx.handleHash());

  // ---------- people ----------
  globals.setRole = (peer, role) => live.setRole(peer, role);
  globals.followPeer = (peer) => live.setFollow(peer);
  globals.leaveLive = async () => {
    const ok = await ui.confirm(live.mode === 'host' ? t('live.endTitle') : t('live.leaveTitle'), live.mode === 'host' ? t('live.endText') : t('live.leaveText'));
    if (ok) live.leave();
  };

  // ---------- chat ----------
  const input = () => document.getElementById('chat-input');
  globals.sendChat = () => {
    const el = input();
    const text = el.value.trim();
    if (!text) return;
    live.sendChat({ text, replyTo: S.replyTo });
    el.value = '';
    S.replyTo = null;
    scrollChat();
  };
  globals.chatEnter = (e) => {
    if (e.shiftKey) return;
    e.preventDefault();
    globals.sendChat();
  };
  globals.chatPaste = async (e) => {
    const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    // shrink big pictures so chat stays light
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    live.sendChat({ text: input().value.trim(), image: new Uint8Array(await blob.arrayBuffer()), imageType: 'image/jpeg', replyTo: S.replyTo });
    input().value = '';
    S.replyTo = null;
    scrollChat();
  };
  globals.react = (id, kind) => live.react(id, kind);
  // a picture from the chat opens as a new document
  ctx.openChatImage = async (id) => {
    const m = live.chat.find((x) => x.id === id);
    if (!m?.image) return;
    const edoc = await openFile(new File([m.image], `${m.name || 'chat'} picture.jpg`, { type: m.imageType || 'image/jpeg' }));
    app.add(edoc);
  };
  globals.reactionIcon = (k) => ({ heart: 'heart', thumbs: 'thumbs', laugh: 'laugh', star: 'star', wow: 'wow' })[k] ?? 'star';
  const scrollChat = () => setTimeout(() => {
      const log = document.getElementById('chat-log');
      if (log) log.scrollTop = log.scrollHeight;
    }, 30);

  // ---------- call ----------
  const refreshDevices = async () => {
    S.devices = await live.call.devices();
  };
  ctx.refreshDevices = refreshDevices;
  navigator.mediaDevices?.addEventListener?.('devicechange', () => refreshDevices());
  globals.toggleCall = async () => {
    if (S.call.inCall) live.leaveCall();
    else {
      await live.joinCall();
      await refreshDevices(); // labels show once the microphone is allowed
    }
  };
  globals.pickDevice = async (kind, id) => {
    const c = live.call;
    if (kind === 'mic') await c.setInput(id, live.mediaLinks());
    else if (kind === 'camera') await c.setCamera(id, live.mediaLinks());
    else if (kind === 'speaker') await c.setOutput(id);
    else if (kind === 'noise') {
      S.settings.call.noiseMode = id;
      await c.setInput(undefined, live.mediaLinks());
    }
    // c.settings is S.settings.call itself, so the choice is already stored
    ctx.saveLocal?.();
  };
  globals.toggleMute = () => live.call.toggleMute();
  globals.toggleCamera = () => live.call.toggleCamera(live.mediaLinks());
  globals.toggleScreen = () => live.call.toggleScreen(live.mediaLinks());
  ui.renderTiles = (tiles) => {
    const box = document.getElementById('call-tiles');
    if (!box) return;
    const keep = new Set(tiles.map((x) => x.id));
    for (const el of [...box.children]) if (!keep.has(el.dataset.id)) el.remove();
    for (const tile of tiles) {
      let el = box.querySelector(`[data-id="${CSS.escape(tile.id)}"]`);
      if (!el) {
        el = document.createElement('figure');
        el.className = `tile ${tile.kind}-tile`;
        el.dataset.id = tile.id;
        el.dataset.peer = tile.peer ?? '';
        el.tabIndex = 0;
        const v = document.createElement('video');
        v.autoplay = true;
        v.playsInline = true;
        v.muted = true; // audio plays through the call's own audio elements
        const cap = document.createElement('figcaption');
        el.append(v, cap);
        el.addEventListener('dblclick', () => el.classList.toggle('is-focus'));
        box.append(el);
      }
      const v = el.querySelector('video');
      if (v.srcObject !== tile.stream) {
        v.srcObject = tile.stream;
        v.play().catch(() => {});
      }
      el.querySelector('figcaption').textContent = `${tile.name}${tile.kind === 'screen' ? ` (${t('call.screenShort')})` : ''}`;
      el.classList.toggle('speaking', S.call.speaking.includes(tile.peer));
    }
  };

  // ---------- send a copy ----------
  ctx.startSend = async ({ bytes, name, mime }) => {
    ui.openDialog('dlg-live');
    await live.startSend(bytes, name, mime);
  };
  ui.sendDialog = () => ui.exportDialog();
  globals.saveReceived = () => {
    const r = live.received;
    if (r?.ok) download(r.data, r.name, r.mime);
  };
  globals.openReceived = async () => {
    const r = live.received;
    if (!r?.ok) return;
    const edoc = await openFile(new File([r.data], r.name, { type: r.mime }));
    app.add(edoc);
    ui.closeDialog('dlg-join');
    live.cleanup();
  };
  return live;
}
