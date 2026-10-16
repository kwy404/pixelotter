// Peer to peer, with no account and no server of ours:
//   * pairing: six words (and a QR code a phone camera can open) carry an encrypted WebRTC
//     handshake through public MQTT relays; six confirmation words made from both connection
//     certificates prove nobody sits in the middle;
//   * live editing: up to five friends on one document (lib/session.js), with cursors, a
//     follow mode, per layer locks and view only or edit roles;
//   * talking: chat with replies, reactions and pasted images, voice with noise suppression,
//     cameras and screen sharing, in a full mesh (guests reach each other through the host);
//   * sending a copy: one file, untouched, verified with SHA-256.

import { Emitter } from '../lib/emitter.js';
import { CodeCreator, CodeJoiner, CODE_LIFETIME_MS } from '../lib/pairing.js';
import { RtcLink, buildIceServers, STUN_SERVERS } from '../lib/rtc.js';
import { confirmWords, resolvePhrase, wordsLink } from '../lib/words.js';
import { sdpFingerprint } from '../lib/fingerprint.js';
import { encodeQr, qrSvg } from '../lib/qr.js';
import { randomId } from '../lib/bytes.js';
import { MessagePort } from '../lib/wire.js';
import { HostSession, GuestSession, MAX_GUESTS, touchedLayers } from '../lib/session.js';
import { normalizeMessage, toggleReaction } from '../lib/chat.js';
import { fileMessage, receiveFile, fileReceipt } from '../lib/transfer.js';
import { createDoc } from '../lib/doc.js';
import { EditorDocument } from './engine/document.js';
import { CallManager } from './media.js';

/** Checks each STUN server: resolves { ok, answered: [urls] } within a few seconds. */
export async function stunCheck(timeout = 5000) {
  const answered = [];
  await Promise.all(
    STUN_SERVERS.map(
      (url) =>
        new Promise((resolve) => {
          let pc;
          try {
            pc = new RTCPeerConnection({ iceServers: [{ urls: url }] });
          } catch {
            return resolve();
          }
          const done = () => {
            clearTimeout(t);
            try {
              pc.close();
            } catch {
              // closed
            }
            resolve();
          };
          const t = setTimeout(done, timeout);
          pc.onicecandidate = (e) => {
            if (e.candidate && / typ srflx /.test(e.candidate.candidate)) {
              answered.push(url);
              done();
            }
          };
          pc.createDataChannel('probe');
          pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(done);
        }),
    ),
  );
  return { ok: answered.length > 0, answered };
}

/** A message port over a link's binary channel. */
function portFor(link) {
  const ch = link.files;
  const port = new MessagePort({
    send: (f) => ch.readyState === 'open' && ch.send(f),
    bufferedAmount: () => (ch.readyState === 'open' ? ch.bufferedAmount : 0),
    drained: () =>
      new Promise((resolve) => {
        const t = setTimeout(resolve, 400);
        ch.addEventListener('bufferedamountlow', () => {
          clearTimeout(t);
          resolve();
        }, { once: true });
      }),
  });
  const wrap = { inbox: null, send: (m) => port.send(m).catch(() => {}) };
  link.onbinary = async (data) => {
    try {
      const msg = await port.receive(new Uint8Array(data));
      if (msg) wrap.inbox?.(msg);
    } catch (err) {
      console.warn('bad frame', err);
    }
  };
  return wrap;
}

/**
 * The creator side of a pairing: words, QR, waits for the joiner, then asks the person to type
 * the confirmation words the other screen shows. Returns { link, name, words, qr, confirm }.
 */
class Invite extends Emitter {
  constructor({ name, iceServers, appUrl, kind }) {
    super();
    this.name = name;
    this.kind = kind; // 'live' or 'send'
    this.nonce = randomId(12);
    this.link = new RtcLink({ iceServers });
    this.appUrl = appUrl;
    this.attempts = 0;
  }

  async start() {
    const offerReady = this.link.offer().then((sdp) => ({ sdp, nonce: this.nonce, name: this.name, kind: this.kind }));
    offerReady.catch(() => {});
    this.creator = new CodeCreator(offerReady);
    this.creator.on('answer', async (msg) => {
      if (typeof msg.sdp !== 'string') return;
      this.peerName = String(msg.name ?? '').slice(0, 40) || 'Friend';
      try {
        await this.link.complete(msg.sdp);
      } catch (err) {
        this.emit('error', err.message);
      }
    });
    this.creator.on('expired', () => this.emit('expired'));
    this.creator.on('status', (s) => this.emit('relays', s));
    this.link.onopen = () => {
      this.creator.stop();
      this.expected = confirmWords(sdpFingerprint(this.link.pc.localDescription.sdp), sdpFingerprint(this.link.pc.remoteDescription.sdp), this.nonce);
      this.emit('confirm');
    };
    this.link.onfail = (reason) => this.emit('error', reason);
    this.words = await this.creator.start();
    const link = wordsLink(this.appUrl, this.words);
    const qr = encodeQr(link, { ecl: 'M' });
    this.qr = qrSvg(qr, { margin: 3, dark: '#141416', light: '#f3f1ec', title: 'QR code with the six words' });
    this.qrLink = link;
    this.expires = Date.now() + CODE_LIFETIME_MS;
    return this.words;
  }

  /** The person typed what the other screen shows. Returns 'ok', 'wrong' or 'rejected'. */
  check(typed) {
    const res = resolvePhrase(typed);
    if (!res.ok) return 'incomplete';
    if (res.words.join(' ') === this.expected.join(' ')) {
      this.link.send(JSON.stringify({ t: 'pair', ok: true }));
      return 'ok';
    }
    this.attempts++;
    if (this.attempts >= 3) {
      try {
        this.link.send(JSON.stringify({ t: 'pair', ok: false }));
      } catch {
        // closed
      }
      this.stop();
      return 'rejected';
    }
    return 'wrong';
  }

  stop() {
    this.creator?.stop();
    if (!this.confirmed) this.link.close();
  }
}

/** The joiner side: types or scans the words, shows confirmation words, waits for the OK. */
class Join extends Emitter {
  constructor({ name, iceServers }) {
    super();
    this.name = name;
    this.iceServers = iceServers;
  }

  async start(words) {
    this.joiner = new CodeJoiner();
    this.joiner.on('offer', async (msg) => {
      if (typeof msg.sdp !== 'string' || typeof msg.nonce !== 'string') return;
      this.kind = msg.kind === 'send' ? 'send' : 'live';
      this.peerName = String(msg.name ?? '').slice(0, 40) || 'Friend';
      this.link = new RtcLink({ iceServers: this.iceServers });
      this.link.polite = true;
      this.link.onopen = () => {
        this.joiner.stop();
        this.shown = confirmWords(sdpFingerprint(this.link.pc.localDescription.sdp), sdpFingerprint(this.link.pc.remoteDescription.sdp), msg.nonce.slice(0, 64));
        this.emit('confirm', this.shown);
      };
      this.link.onmessage = (text) => {
        let m;
        try {
          m = JSON.parse(text);
        } catch {
          return;
        }
        if (m.t === 'pair') this.emit(m.ok ? 'paired' : 'rejected');
      };
      this.link.onfail = (reason) => this.emit('error', reason);
      try {
        const sdp = await this.link.answer(msg.sdp);
        this.joiner.sendAnswer({ sdp, name: this.name });
      } catch (err) {
        this.emit('error', err.message);
      }
    });
    this.joiner.on('timeout', () => this.emit('timeout'));
    await this.joiner.start(words);
  }

  stop() {
    this.joiner?.stop();
  }
}

export class Live extends Emitter {
  constructor(app, ui) {
    super();
    this.app = app;
    this.ui = ui;
    this.S = app.S;
    this.mode = 'off';
    this.links = new Map(); // peer id -> RtcLink (host: guests, guest: 'host' and other guests)
    this.ports = new Map();
    this.peers = [];
    this.chat = [];
    this.cursorAt = 0;
    this.follow = null;
    this.call = new CallManager(app.S.settings.call);
    this.call.on('change', () => this.syncCall());
    this.call.on('speaking', () => this.syncCall());
    this.call.on('error', (code) => app.toast(app.t(`call.error.${code}`), 'warning'));
    this.call.on('mic-level', (lv) => (this.S.callInfo = { ...this.S.callInfo, level: Math.round(lv.rms ?? 0), gate: lv.open ?? null }));
  }

  get iceServers() {
    return buildIceServers({ custom: this.S.settings.turn?.urls ? [{ urls: this.S.settings.turn.urls.split(/[\s,]+/).filter(Boolean), username: this.S.settings.turn.username, credential: this.S.settings.turn.credential }] : [] });
  }

  get appUrl() {
    return location.href.split('#')[0];
  }

  get name() {
    return this.S.settings.name || 'Otter';
  }

  set(state) {
    this.S.live = { ...this.S.live, ...state };
  }

  // ---------- invites (host and sender) ----------

  async newInvite(kind = 'live') {
    this.invite?.stop();
    const inv = new Invite({ name: this.name, iceServers: this.iceServers, appUrl: this.appUrl, kind });
    this.invite = inv;
    this.set({ step: 'starting', error: null, words: [], qr: '', confirmError: null });
    inv.on('relays', (s) => this.set({ relays: s.connected.length }));
    inv.on('expired', () => this.invite === inv && this.set({ step: 'expired' }));
    inv.on('error', (e) => this.invite === inv && this.set({ step: 'failed', error: String(e) }));
    inv.on('confirm', () => this.invite === inv && this.set({ step: 'confirm-type', peerName: inv.peerName }));
    try {
      const words = await inv.start();
      if (this.invite !== inv) return;
      this.set({ step: 'code', words, qr: inv.qr, expires: inv.expires, qrLink: inv.qrLink });
    } catch (err) {
      this.set({ step: 'failed', error: this.app.t('live.noRelay', { error: err.message }) });
    }
  }

  /** The host or sender typed the confirmation words. */
  async confirmTyped(typed) {
    const inv = this.invite;
    if (!inv) return;
    const r = inv.check(typed);
    if (r === 'incomplete') return this.set({ confirmError: this.app.t('live.confirmIncomplete') });
    if (r === 'wrong') return this.set({ confirmError: this.app.t('live.confirmWrong', { left: 3 - inv.attempts }) });
    if (r === 'rejected') return this.set({ step: 'failed', error: this.app.t('live.confirmRejected') });
    inv.confirmed = true;
    this.invite = null;
    if (inv.kind === 'send') return this.sendOverLink(inv.link, inv.peerName);
    await this.addGuest(inv.link, inv.peerName);
    this.set({ step: 'live' });
  }

  // ---------- hosting ----------

  /** Starts sharing the active document. */
  async host() {
    const app = this.app;
    const edoc = app.edoc;
    if (!edoc || this.mode !== 'off') return;
    this.mode = 'host';
    this.edoc = edoc;
    const hs = new HostSession({ engine: edoc, name: this.name, id: 'host' });
    this.session = hs;
    this.myId = 'host';
    edoc.session = {
      allowed: (ops) => {
        const reason = hs.check(hs.id, ops);
        return reason ? { ok: false, reason } : { ok: true };
      },
      local: (ops) => hs.local(ops),
      lock: (layers) => hs.requestLock(hs.id, layers),
    };
    hs.on('peers', (p) => this.syncPeers(p));
    hs.on('locks', () => app.syncLayers());
    hs.on('cursor', (c) => this.showCursor(c));
    this.set({ mode: 'host', step: 'idle', peers: hs.peerList(), me: 'host' });
    app.syncTabs();
    await this.newInvite('live');
  }

  async addGuest(link, name) {
    const hs = this.session;
    if (hs.guestCount >= MAX_GUESTS) {
      link.close();
      this.app.toast(this.app.t('live.full'), 'warning');
      return;
    }
    const port = portFor(link);
    const id = await hs.addGuest(port, { name, role: this.S.settings.defaultRole ?? 'edit' });
    this.links.set(id, link);
    this.ports.set(id, port);
    port.inbox = (msg) => this.hostReceive(id, msg);
    link.ontrack = (e) => this.call.remoteTrack(id, e);
    link.onclose = () => this.dropGuest(id);
    // tell everyone about the new peer so guests set up media links between themselves
    this.call.attach(link);
    // the chat history so far
    if (this.chat.length) port.send({ t: 'chat-history', messages: this.chat.slice(-100) });
    this.app.toast(this.app.t('live.joined', { name }), 'success');
  }

  dropGuest(id) {
    this.session?.removeGuest(id);
    this.links.delete(id);
    this.ports.delete(id);
    this.call.dropPeer(id);
  }

  hostReceive(from, msg) {
    if (msg.t === 'chat' || msg.t === 'react') {
      this.chatReceive({ ...msg, from });
      for (const [id, p] of this.ports) if (id !== from) p.send({ ...msg, from });
      return;
    }
    if (msg.t === 'rtc') {
      // guests set up their media links through the host
      this.ports.get(msg.to)?.send({ ...msg, from });
      return;
    }
    if (msg.t === 'file') {
      this.receiveFileMessage(msg, this.ports.get(from));
      return;
    }
    this.session.receive(from, msg);
  }

  setRole(peer, role) {
    this.session?.setRole(peer, role);
  }

  kick(peer) {
    this.ports.get(peer)?.send({ t: 'end' });
    this.links.get(peer)?.close();
    this.dropGuest(peer);
  }

  // ---------- joining ----------

  async join(words) {
    const app = this.app;
    if (this.mode !== 'off') this.leave();
    const j = new Join({ name: this.name, iceServers: this.iceServers });
    this.joining = j;
    this.set({ mode: 'joining', step: 'joining', error: null });
    j.on('confirm', (shown) => this.set({ step: 'confirm-show', shownWords: shown, peerName: j.peerName }));
    j.on('rejected', () => this.set({ step: 'failed', error: app.t('live.confirmRejectedPeer') }));
    j.on('timeout', () => this.set({ step: 'failed', error: app.t('live.noPeer') }));
    j.on('error', (e) => this.set({ step: 'failed', error: String(e) }));
    j.on('paired', () => {
      this.joining = null;
      if (j.kind === 'send') this.receiveOverLink(j.link, j.peerName);
      else this.becomeGuest(j.link, j.peerName);
    });
    try {
      await j.start(words);
    } catch (err) {
      this.set({ step: 'failed', error: app.t('live.noRelay', { error: err.message }) });
    }
  }

  becomeGuest(link, hostName) {
    const app = this.app;
    this.mode = 'guest';
    const edoc = new EditorDocument(createDoc({ name: app.t('live.sharedName', { name: hostName }) }));
    this.edoc = edoc;
    const port = portFor(link);
    const gs = new GuestSession({ engine: edoc, port });
    this.session = gs;
    this.links.set('host', link);
    this.ports.set('host', port);
    link.ontrack = (e) => this.call.remoteTrack('host', e);
    link.onclose = () => this.ended();
    port.inbox = (msg) => this.guestReceive(msg);
    edoc.session = {
      allowed: (ops) => {
        if (!gs.canEdit) return { ok: false, reason: 'view-only' };
        for (const op of ops) for (const l of touchedLayers(op, edoc)) {
            const owner = gs.lockOwner(l);
            if (owner && owner !== gs.id) return { ok: false, reason: 'locked' };
          }
        return { ok: true };
      },
      local: (ops, inverse) => gs.local(ops, inverse),
      lock: (layers) => gs.lock(layers),
    };
    gs.on('welcome', () => {
      this.myId = gs.id;
      app.add(edoc);
      edoc.name = edoc.doc.name;
      this.set({ mode: 'guest', step: 'live', me: gs.id });
      app.toast(app.t('live.welcome', { name: hostName }), 'success');
    });
    gs.on('peers', (p) => {
      this.syncPeers(p);
      this.meshWithGuests(p);
    });
    gs.on('locks', () => app.syncLayers());
    gs.on('cursor', (c) => this.showCursor(c));
    gs.on('rejected', ({ reason }) => app.toast(app.t(`live.refused.${reason}`), 'warning'));
    gs.on('end', () => this.ended());
    gs.on('remote', () => app.syncLayers());
    this.set({ step: 'loading' });
  }

  guestReceive(msg) {
    if (msg.t === 'chat' || msg.t === 'react') return this.chatReceive(msg);
    if (msg.t === 'chat-history') {
      for (const m of msg.messages ?? []) this.chatReceive(m);
      return;
    }
    if (msg.t === 'rtc') return this.rtcSignal(msg);
    if (msg.t === 'file') return this.receiveFileMessage(msg, this.ports.get('host'));
    this.session.receive(msg);
  }

  /** Guests connect to each other for voice and video; the lower id makes the offer. */
  async meshWithGuests(peers) {
    if (this.mode !== 'guest' || !this.myId) return;
    for (const p of peers) {
      if (p.host || p.id === this.myId || this.links.has(p.id)) continue;
      if (this.myId > p.id) continue; // the other side offers
      const link = new RtcLink({ iceServers: this.iceServers });
      this.links.set(p.id, link);
      this.wireMediaLink(p.id, link);
      const sdp = await link.offer();
      this.ports.get('host').send({ t: 'rtc', to: p.id, kind: 'offer', sdp });
    }
    for (const id of [...this.links.keys()]) if (id !== 'host' && !peers.some((p) => p.id === id)) {
        this.links.get(id).close();
        this.links.delete(id);
        this.call.dropPeer(id);
      }
  }

  wireMediaLink(id, link) {
    link.ontrack = (e) => this.call.remoteTrack(id, e);
    link.onopen = () => this.call.attach(link);
    link.onclose = () => this.call.dropPeer(id);
  }

  async rtcSignal(msg) {
    if (msg.kind === 'offer') {
      const link = new RtcLink({ iceServers: this.iceServers });
      link.polite = true;
      this.links.set(msg.from, link);
      this.wireMediaLink(msg.from, link);
      const sdp = await link.answer(msg.sdp);
      this.ports.get('host').send({ t: 'rtc', to: msg.from, kind: 'answer', sdp });
    } else if (msg.kind === 'answer') await this.links.get(msg.from)?.complete(msg.sdp);
  }

  // ---------- shared ----------

  syncPeers(list) {
    this.peers = list;
    this.set({ peers: list.map((p) => ({ ...p, me: p.id === this.myId })) });
    this.app.syncLayers();
  }

  peerMap() {
    return Object.fromEntries(this.peers.map((p) => [p.id, p]));
  }

  lockTable() {
    return this.session ? Object.fromEntries(this.session.locks) : {};
  }

  myIdFn() {
    return this.myId;
  }

  cursor(x, y) {
    const now = performance.now();
    if (!this.session || now - this.cursorAt < 50) return;
    this.cursorAt = now;
    const v = this.app.vp.view;
    this.session.cursor(x, y, { cx: v.cx, cy: v.cy, zoom: v.zoom }, this.app.toolId);
  }

  showCursor(c) {
    const p = this.peers.find((x) => x.id === c.from);
    if (!p || this.app.edoc !== this.edoc) return;
    this.app.vp.peers.set(c.from, { x: c.x, y: c.y, name: p.name, color: p.color, at: performance.now() });
    this.app.vp.needsOverlay = true;
    if (this.follow === c.from && c.view) {
      Object.assign(this.app.edoc.view, { cx: c.view.cx, cy: c.view.cy, zoom: c.view.zoom, fit: false });
      this.app.vp.viewChanged();
    }
  }

  setFollow(peer) {
    this.follow = this.follow === peer ? null : peer;
    this.set({ follow: this.follow });
  }

  // ---------- chat ----------

  sendChat({ text = '', replyTo = null, image = null, imageType = null } = {}) {
    if (!this.session) return;
    const me = this.peers.find((p) => p.id === this.myId);
    const msg = { t: 'chat', id: randomId(9), name: this.name, color: me?.color ?? '#d39b5c', text, replyTo, image, imageType, at: Date.now() };
    this.chatReceive({ ...msg, from: this.myId });
    if (this.mode === 'host') for (const p of this.ports.values()) p.send({ ...msg, from: 'host' });
    else this.ports.get('host')?.send(msg);
  }

  react(id, kind) {
    const msg = { t: 'react', id, kind };
    this.chatReceive({ ...msg, from: this.myId });
    if (this.mode === 'host') for (const p of this.ports.values()) p.send({ ...msg, from: 'host' });
    else this.ports.get('host')?.send(msg);
  }

  chatReceive(msg) {
    if (msg.t === 'react') {
      const m = this.chat.find((x) => x.id === msg.id);
      if (m) m.reactions = toggleReaction(m.reactions, msg.kind, msg.from);
    } else {
      const m = normalizeMessage(msg);
      if (!m || this.chat.some((x) => x.id === m.id)) return;
      if (m.image) m.url = URL.createObjectURL(new Blob([m.image], { type: m.imageType }));
      this.chat.push(m);
      if (this.chat.length > 500) this.chat.shift();
      if (msg.from !== this.myId) this.set({ unread: (this.S.live.unread ?? 0) + 1 });
    }
    this.S.chat = this.chat.map((m) => ({ id: m.id, name: m.name, color: m.color, text: m.text, url: m.url ?? '', at: m.at, mine: m.from === this.myId, reply: m.replyTo ? this.chat.find((x) => x.id === m.replyTo) ?? null : null, reactions: Object.entries(m.reactions).map(([k, who]) => ({ k, n: who.length, mine: who.includes(this.myId) })) }));
  }

  // ---------- voice and video ----------

  mediaLinks() {
    return [...this.links.values()].filter((l) => l.open && !l.closed);
  }

  async joinCall() {
    await this.call.join(this.mediaLinks());
  }

  leaveCall() {
    this.call.leave(this.mediaLinks());
  }

  syncCall() {
    const c = this.call;
    const tiles = [];
    if (c.camera) tiles.push({ id: 'self-camera', peer: this.myId, name: this.name, kind: 'camera', stream: c.camera, self: true });
    if (c.screen) tiles.push({ id: 'self-screen', peer: this.myId, name: this.name, kind: 'screen', stream: c.screen, self: true });
    for (const [peer, r] of c.remote) {
      const name = this.peers.find((p) => p.id === peer)?.name ?? peer;
      if (r.camera) tiles.push({ id: `${peer}-camera`, peer, name, kind: 'camera', stream: r.camera });
      if (r.screen) tiles.push({ id: `${peer}-screen`, peer, name, kind: 'screen', stream: r.screen });
    }
    this.tiles = tiles;
    this.S.call = { inCall: c.inCall, muted: c.muted, camera: !!c.camera, screen: !!c.screen, processing: c.processing, speaking: [...c.speaking].map((id) => (id === 'self' ? this.myId : id)), tiles: tiles.map((t) => ({ id: t.id, name: t.name, kind: t.kind, self: !!t.self })) };
    this.ui.renderTiles?.(tiles);
  }

  // ---------- send a copy ----------

  async startSend(bytes, name, mime) {
    this.pendingFile = { bytes, name, mime };
    this.set({ mode: 'send', sendState: 'waiting' });
    await this.newInvite('send');
  }

  async sendOverLink(link, peerName) {
    const f = this.pendingFile;
    const port = portFor(link);
    this.set({ step: 'sending', sendState: 'sending', peerName });
    port.inbox = (msg) => {
      if (msg.t !== 'file-receipt') return;
      this.set({ step: 'sent', sendState: msg.ok ? 'verified' : 'mismatch', sha256: msg.sha256 });
      setTimeout(() => link.close(), 1500);
    };
    const msg = await fileMessage(f.bytes, { name: f.name, mime: f.mime });
    this.set({ sha256: msg.sha256, size: msg.size });
    await port.send(msg);
  }

  receiveOverLink(link, peerName) {
    const port = portFor(link);
    this.set({ step: 'receiving', peerName });
    port.inbox = (msg) => msg.t === 'file' && this.receiveFileMessage(msg, port);
  }

  async receiveFileMessage(msg, port) {
    const r = await receiveFile(msg);
    port?.send(fileReceipt(r));
    this.received = r;
    this.set({ step: 'received', received: { ok: r.ok, name: r.name, size: r.size, sha256: r.sha256, url: r.ok ? URL.createObjectURL(new Blob([r.data], { type: r.mime })) : '' } });
  }

  // ---------- ending ----------

  ended() {
    if (this.mode === 'off') return;
    this.app.toast(this.app.t('live.ended'), 'info');
    this.cleanup();
  }

  leave() {
    if (this.mode === 'host') this.session?.close();
    if (this.mode === 'guest') this.session?.leave();
    this.cleanup();
  }

  cleanup() {
    this.invite?.stop();
    this.joining?.stop();
    this.leaveCall();
    for (const l of this.links.values()) l.close();
    this.links.clear();
    this.ports.clear();
    if (this.edoc) this.edoc.session = null;
    this.session = null;
    this.mode = 'off';
    this.myId = null;
    this.follow = null;
    this.app.vp.peers.clear();
    this.set({ mode: 'off', step: 'idle', peers: [], words: [], qr: '' });
    this.app.syncTabs();
    this.app.syncLayers();
  }
}
