// The live session panel and dialogs: inviting with six words and a QR code (never a link on
// screen), joining by typing or scanning, the confirmation words, people and roles, follow
// mode, chat with replies, reactions and pasted images, and the call with video tiles.

import { resolvePhrase, splitPhrase, suggestWords, wordsFromLink } from '../lib/words.js';
import { Live } from './live.js';
import { download } from './files.js';
import { openFile } from './files.js';

export function installLive(ctx) {
  const { app, S, t, globals, ui } = ctx;
  const live = new Live(app, ui);
  app.live = live;
  S.live = { mode: 'off', step: 'idle', peers: [], words: [], qr: '', unread: 0 };
  S.chat = [];
  S.call = { inCall: false, muted: false, camera: false, screen: false, processing: null, speaking: [], tiles: [] };

  ui.liveDialog = async () => {
    if (live.mode === 'off') await live.host();
    else if (live.mode === 'host' && S.live.step !== 'code') await live.newInvite('live');
    ui.openDialog('dlg-live');
    ui.openPanel('live');
  };
  globals.inviteMore = async () => {
    ui.openDialog('dlg-live');
    if (live.mode === 'send') return live.newInvite('send');
    await live.newInvite('live');
  };
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
  globals.pasteWords = (e, prefix) => {
    const text = e.clipboardData?.getData('text') ?? '';
    const parts = splitPhrase(text);
    if (parts.length < 2) return;
    e.preventDefault();
    parts.slice(0, 6).forEach((p, i) => {
      const el = document.getElementById(`${prefix}${i}`);
      if (el) el.value = p;
    });
  };
  globals.wordTyped = (e, i) => {
    // a finished word jumps to the next box
    const v = e.target.value;
    if (/\s$/.test(v)) {
      e.target.value = v.trim();
      document.getElementById(`join-word-${i + 1}`)?.focus();
      return;
    }
    const s = suggestWords(v, 2);
    if (s.length === 1 && v.length >= 4 && s[0] === v.toLowerCase()) document.getElementById(`join-word-${i + 1}`)?.focus();
  };
  globals.joinWords = async () => {
    const res = resolvePhrase(read('join-word-'));
    if (!res.ok) {
      S.dlg.join.error = t('join.incomplete');
      return;
    }
    S.dlg.join.error = '';
    await live.join(res.words);
  };
  globals.confirmWords = () => live.confirmTyped(read('confirm-word-'));
  // the join dialog closes by itself once the shared document is open
  const watch = setInterval(() => {
    if (S.live.step === 'live' && live.mode === 'guest') ui.closeDialog('dlg-join');
  }, 400);
  void watch;

  // links from a QR code: app/#w=word-word-...
  ctx.handleHash = () => {
    const words = wordsFromLink(location.hash);
    if (words?.length === 6) {
      history.replaceState(null, '', location.pathname + location.search);
      ui.joinDialog(words);
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
  globals.reactionIcon = (k) => ({ heart: 'heart', thumbs: 'thumbs', laugh: 'laugh', star: 'star', wow: 'wow' })[k] ?? 'star';
  const scrollChat = () => setTimeout(() => {
      const log = document.getElementById('chat-log');
      if (log) log.scrollTop = log.scrollHeight;
    }, 30);

  // ---------- call ----------
  globals.toggleCall = async () => {
    if (S.call.inCall) live.leaveCall();
    else await live.joinCall();
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
