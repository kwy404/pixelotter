// Generated from src/session.js by scripts/build-app.mjs. Edit the source, not this copy.
// Live editing with up to five friends, peer to peer. The person who shares the document is
// the host: every guest connects straight to the host's browser, and the host puts all edits
// in one order (an operation log with a sequence number) and passes them on. Conflicts are
// avoided with per layer locks: the layer you are editing is yours until you pick another one,
// and edits to a layer someone else holds are refused. Guests apply their own edits at once and
// rebase them when other edits arrive first, so everyone ends with the same document.
//
// The session knows nothing about WebRTC or the DOM. It talks to ports { send(message) } and to
// an engine that owns the document:
//   engine.apply(ops)      applies ops, returns their inverses in application order
//   engine.snapshot()      resolves to { doc, assets } for a late joiner
//   engine.load(snapshot)  replaces the document with a snapshot
//   engine.layerOf(asset)  the id of the layer that owns a pixel asset, or null
//   engine.hasLayer(id)    whether a layer exists

import { Emitter } from './emitter.js';

export const MAX_GUESTS = 5;
export const ROLES = Object.freeze(['view', 'edit']);
export const PEER_COLORS = Object.freeze(['#d39b5c', '#7fa7c9', '#9cc39a', '#c99ac2', '#d7c17a', '#9ec9c3']);

const LAYER_OPS = new Set(['set', 'remove', 'move']);
const PIXEL_OPS = new Set(['patch', 'replace']);

/** The layers an operation changes, or [] when it creates something new. */
export function touchedLayers(op, engine) {
  if (LAYER_OPS.has(op.t)) return [op.id];
  if (PIXEL_OPS.has(op.t)) {
    const l = engine.layerOf(op.id);
    return l ? [l] : [];
  }
  return [];
}

const HEX = /^#[0-9a-f]{6}$/i;
const word = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

/**
 * What a cursor message may carry besides the position: the tool, its brush size in document
 * pixels, what the person is doing (a short code, with an optional detail such as a filter
 * name) and the layer they work on. Anything else is dropped, so the messages stay small.
 */
export function cleanCursor(from, msg) {
  const size = Number(msg.size);
  return {
    t: 'cursor',
    from,
    x: Number(msg.x) || 0,
    y: Number(msg.y) || 0,
    view: msg.view && typeof msg.view === 'object' ? { cx: Number(msg.view.cx) || 0, cy: Number(msg.view.cy) || 0, zoom: Number(msg.view.zoom) || 1 } : null,
    tool: word(msg.tool, 20),
    size: Number.isFinite(size) ? Math.max(0, Math.min(5000, size)) : 0,
    act: /^[a-z-]{0,20}$/.test(msg.act ?? '') ? msg.act ?? '' : '',
    arg: word(msg.arg, 40),
    layer: word(msg.layer, 40),
  };
}

/**
 * Presence that changes now and then: the selection outline (a few loops of whole document
 * pixels, at most 800 points in all), the microphone and camera state, and a new name or color.
 */
export function cleanPresence(from, msg) {
  const out = { t: 'presence', from, mic: msg.mic === true, cam: msg.cam === true, sel: null };
  if (Array.isArray(msg.sel)) {
    let budget = 800;
    out.sel = [];
    for (const loop of msg.sel.slice(0, 16)) {
      if (!Array.isArray(loop) || budget <= 0) continue;
      const pts = [];
      for (let i = 0; i + 1 < loop.length && budget > 0; i += 2, budget--) pts.push(Math.round(Number(loop[i]) || 0), Math.round(Number(loop[i + 1]) || 0));
      if (pts.length >= 6) out.sel.push(pts);
    }
  }
  if (typeof msg.name === 'string' && msg.name.trim()) out.name = msg.name.trim().slice(0, 40);
  if (HEX.test(msg.color ?? '')) out.color = msg.color.toLowerCase();
  return out;
}

class Base extends Emitter {
  constructor(engine) {
    super();
    this.engine = engine;
    this.peers = new Map(); // id -> { id, name, color, role }
    this.locks = new Map(); // layer id -> peer id
    this.closed = false;
  }
  peerList() {
    return [...this.peers.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, role: p.role, host: !!p.host }));
  }
  lockOwner(layer) {
    return this.locks.get(layer) ?? null;
  }
  lockTable() {
    return Object.fromEntries(this.locks);
  }
}

export class HostSession extends Base {
  constructor({ engine, name = 'Host', id = 'host', color = null }) {
    super(engine);
    this.id = id;
    this.seq = 0;
    this.ports = new Map(); // guest id -> port
    this.nextGuest = 1;
    this.peers.set(id, { id, name, color: HEX.test(color ?? '') ? color.toLowerCase() : PEER_COLORS[0], role: 'edit', host: true });
  }

  /** A new name or color, kept when nobody else in the room wears that color. */
  rename(id, { name, color }) {
    const p = this.peers.get(id);
    if (!p) return false;
    let changed = false;
    if (name && name !== p.name) {
      p.name = name;
      changed = true;
    }
    if (color && color !== p.color && ![...this.peers.values()].some((q) => q.id !== id && q.color === color)) {
      p.color = color;
      changed = true;
    }
    if (changed) {
      this.broadcast({ t: 'peers', peers: this.peerList() });
      this.emit('peers', this.peerList());
    }
    return changed;
  }

  /** The host's own presence: a new name or color, the selection, microphone and camera. */
  presence(msg) {
    const c = cleanPresence(this.id, msg);
    this.rename(this.id, c);
    this.broadcast({ t: 'presence', from: this.id, sel: c.sel, mic: c.mic, cam: c.cam });
  }

  get guestCount() {
    return this.ports.size;
  }

  /** Adds a guest who passed the confirmation words. Sends them the whole document. */
  async addGuest(port, { name = 'Guest', role = 'edit' } = {}) {
    if (this.ports.size >= MAX_GUESTS) throw new Error(`A live session holds up to ${MAX_GUESTS} friends`);
    const id = `g${this.nextGuest++}`;
    const used = new Set([...this.peers.values()].map((p) => p.color));
    const color = PEER_COLORS.find((c) => !used.has(c)) ?? PEER_COLORS[this.nextGuest % PEER_COLORS.length];
    this.peers.set(id, { id, name: String(name).slice(0, 40), color, role: ROLES.includes(role) ? role : 'edit' });
    this.ports.set(id, port);
    const snapshot = await this.engine.snapshot();
    port.send({ t: 'welcome', you: id, seq: this.seq, peers: this.peerList(), locks: this.lockTable(), snapshot });
    this.broadcast({ t: 'peers', peers: this.peerList() }, id);
    this.emit('peers', this.peerList());
    return id;
  }

  removeGuest(id) {
    if (!this.ports.has(id)) return;
    this.ports.delete(id);
    this.peers.delete(id);
    let changed = false;
    for (const [layer, owner] of this.locks) if (owner === id) (this.locks.delete(layer), (changed = true));
    this.broadcast({ t: 'peers', peers: this.peerList() });
    if (changed) this.broadcast({ t: 'locks', locks: this.lockTable() });
    this.emit('peers', this.peerList());
    if (changed) this.emit('locks', this.lockTable());
  }

  broadcast(msg, except = null) {
    for (const [id, port] of this.ports) if (id !== except) port.send(msg);
  }

  setRole(id, role) {
    const p = this.peers.get(id);
    if (!p || p.host || !ROLES.includes(role)) return;
    p.role = role;
    if (role === 'view') this.releaseAll(id);
    this.broadcast({ t: 'peers', peers: this.peerList() });
    this.emit('peers', this.peerList());
  }

  releaseAll(peer) {
    for (const [layer, owner] of this.locks) if (owner === peer) this.locks.delete(layer);
    this.broadcast({ t: 'locks', locks: this.lockTable() });
    this.emit('locks', this.lockTable());
  }

  /** Locks layers for a peer (and frees what that peer held before). Returns true on success. */
  requestLock(peer, layers) {
    const want = (layers ?? []).filter((l) => this.engine.hasLayer(l));
    if (want.some((l) => this.locks.has(l) && this.locks.get(l) !== peer)) return false;
    for (const [layer, owner] of this.locks) if (owner === peer && !want.includes(layer)) this.locks.delete(layer);
    for (const l of want) this.locks.set(l, peer);
    this.broadcast({ t: 'locks', locks: this.lockTable() });
    this.emit('locks', this.lockTable());
    return true;
  }

  /** Whether peer may apply ops right now. Returns null when fine, or a reason. */
  check(peer, ops) {
    const p = this.peers.get(peer);
    if (!p) return 'unknown';
    if (p.role !== 'edit') return 'view-only';
    for (const op of ops) {
      for (const layer of touchedLayers(op, this.engine)) {
        const owner = this.locks.get(layer);
        if (owner && owner !== peer) return 'locked';
      }
    }
    return null;
  }

  /** Claims the layers that ops touch or add for the peer who made them. */
  claim(peer, ops) {
    let changed = false;
    for (const op of ops) {
      const layers = op.t === 'add' ? [op.layer.id] : touchedLayers(op, this.engine);
      for (const l of layers) {
        if (op.t === 'remove') {
          if (this.locks.delete(l)) changed = true;
        } else if (!this.locks.has(l) && this.engine.hasLayer(l)) {
          this.locks.set(l, peer);
          changed = true;
        }
      }
    }
    if (changed) {
      this.broadcast({ t: 'locks', locks: this.lockTable() });
      this.emit('locks', this.lockTable());
    }
  }

  /** The host's own edit, already applied to the engine. Returns false when a guest holds the layer. */
  local(ops) {
    const reason = this.check(this.id, ops);
    if (reason) return false;
    this.seq++;
    this.broadcast({ t: 'ops', seq: this.seq, from: this.id, ops });
    this.claim(this.id, ops);
    return true;
  }

  receive(from, msg) {
    if (this.closed || !this.ports.has(from) || !msg || typeof msg !== 'object') return;
    const port = this.ports.get(from);
    switch (msg.t) {
      case 'ops': {
        const ops = Array.isArray(msg.ops) ? msg.ops : [];
        const reason = this.check(from, ops);
        if (reason) {
          port.send({ t: 'reject', opId: msg.opId, reason });
          return;
        }
        try {
          this.engine.apply(ops);
        } catch (err) {
          port.send({ t: 'reject', opId: msg.opId, reason: 'invalid', detail: String(err?.message ?? err) });
          return;
        }
        this.seq++;
        const out = { t: 'ops', seq: this.seq, from, opId: msg.opId, ops };
        for (const [id, p] of this.ports) p.send(id === from ? { t: 'ack', seq: this.seq, opId: msg.opId } : out);
        this.claim(from, ops);
        this.emit('remote', { from, ops });
        return;
      }
      case 'lock': {
        const ok = this.requestLock(from, Array.isArray(msg.layers) ? msg.layers : []);
        if (!ok) port.send({ t: 'locks', locks: this.lockTable(), denied: msg.layers });
        return;
      }
      case 'cursor': {
        const c = cleanCursor(from, msg);
        this.broadcast(c, from);
        this.emit('cursor', c);
        return;
      }
      case 'presence': {
        const c = cleanPresence(from, msg);
        this.rename(from, c);
        const out = { t: 'presence', from, sel: c.sel, mic: c.mic, cam: c.cam };
        this.broadcast(out, from);
        this.emit('presence', out);
        return;
      }
      case 'bye':
        this.removeGuest(from);
        return;
      default:
    }
  }

  cursor(x, y, view = null, tool = '', extra = {}) {
    this.broadcast(cleanCursor(this.id, { x, y, view, tool, ...extra }));
  }

  close() {
    this.closed = true;
    this.broadcast({ t: 'end' });
    this.ports.clear();
  }
}

export class GuestSession extends Base {
  constructor({ engine, port }) {
    super(engine);
    this.port = port;
    this.id = null;
    this.seq = 0;
    this.role = 'view';
    this.pending = []; // [{ opId, ops, inverse }] sent but not yet acknowledged
    this.nextOp = 1;
    this.ready = false;
  }

  get canEdit() {
    return this.ready && this.role === 'edit';
  }

  /** A local edit, already applied to the engine with its inverses. */
  local(ops, inverse) {
    if (!this.canEdit) return false;
    const opId = this.nextOp++;
    this.pending.push({ opId, ops, inverse });
    this.port.send({ t: 'ops', opId, ops });
    return true;
  }

  lock(layers) {
    if (this.ready) this.port.send({ t: 'lock', layers });
  }

  cursor(x, y, view = null, tool = '', extra = {}) {
    if (this.ready) this.port.send({ t: 'cursor', x, y, view, tool, ...extra });
  }

  presence(msg) {
    if (this.ready) this.port.send({ ...msg, t: 'presence' });
  }

  rollback(list) {
    for (let i = list.length - 1; i >= 0; i--) {
      const inv = list[i].inverse;
      if (inv?.length) this.engine.apply([...inv].reverse());
    }
  }

  reapply(list) {
    const kept = [];
    for (const p of list) {
      try {
        p.inverse = this.engine.apply(p.ops);
        kept.push(p);
      } catch {
        // The edit no longer fits (its layer was removed): the host refuses it too.
      }
    }
    return kept;
  }

  async receive(msg) {
    if (this.closed || !msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'welcome':
        await this.engine.load(msg.snapshot);
        this.id = msg.you;
        this.seq = msg.seq;
        this.setPeers(msg.peers);
        this.locks = new Map(Object.entries(msg.locks ?? {}));
        this.ready = true;
        this.emit('welcome', { id: this.id, role: this.role });
        this.emit('locks', this.lockTable());
        return;
      case 'peers':
        this.setPeers(msg.peers);
        return;
      case 'locks':
        this.locks = new Map(Object.entries(msg.locks ?? {}));
        this.emit('locks', this.lockTable());
        if (msg.denied) this.emit('denied', msg.denied);
        return;
      case 'ops': {
        this.seq = msg.seq;
        const pend = this.pending;
        this.rollback(pend);
        this.engine.apply(msg.ops);
        this.pending = this.reapply(pend);
        this.emit('remote', { from: msg.from, ops: msg.ops });
        return;
      }
      case 'ack': {
        this.seq = msg.seq;
        const i = this.pending.findIndex((p) => p.opId === msg.opId);
        if (i >= 0) this.pending.splice(i, 1);
        this.emit('ack', msg.opId);
        return;
      }
      case 'reject': {
        const i = this.pending.findIndex((p) => p.opId === msg.opId);
        if (i < 0) return;
        const tail = this.pending.slice(i);
        this.rollback(tail);
        this.pending = this.pending.slice(0, i).concat(this.reapply(tail.slice(1)));
        this.emit('rejected', { opId: msg.opId, reason: msg.reason });
        return;
      }
      case 'cursor':
        this.emit('cursor', msg);
        return;
      case 'presence':
        this.emit('presence', msg);
        return;
      case 'end':
        this.closed = true;
        this.emit('end');
        return;
      default:
    }
  }

  setPeers(list) {
    this.peers = new Map((list ?? []).map((p) => [p.id, p]));
    const me = this.peers.get(this.id);
    if (me) this.role = me.role;
    this.emit('peers', this.peerList());
  }

  leave() {
    if (!this.closed) this.port.send({ t: 'bye' });
    this.closed = true;
  }
}
