// Generated from src/pairing.js by scripts/build-app.mjs. Edit the source, not this copy.
// The six word handshake. Both devices derive a topic and a key from the words, meet on public
// MQTT brokers (several at once) and swap the WebRTC offer and answer, sealed with that key.
//   creator: shows the words, waits for a "join", sends its offer to the first device that joins
//   joiner:  knocks with "join" until the offer arrives, then sends its answer
// A one to one code expires after 10 minutes, works once, and both sides leave the brokers as
// soon as the connection opens. A room invite stays open for as long as the room does. The relay hub is injectable, so the tests run the whole exchange on an
// in memory broker.

import { Emitter } from './emitter.js';
import { randomId } from './bytes.js';
import { generateWords } from './words.js';
import { RelayHub } from './relay.js';
import { ReplayGuard, deriveRendezvous, openMessage, sealMessage } from './rendezvous.js';

export const CODE_LIFETIME_MS = 10 * 60 * 1000;
const KNOCK_EVERY_MS = 1500;
const JOIN_TIMEOUT_MS = 45000;
const ANSWER_REPEATS = 12;

class Side extends Emitter {
  constructor({ hub = (topic) => new RelayHub(topic), iterations } = {}) {
    super();
    this.makeHub = hub;
    this.iterations = iterations;
    this.id = randomId(9);
    this.guard = new ReplayGuard();
    this.hub = null;
    this.timers = [];
    this.stopped = false;
  }

  /** words: the six words, or { rv } with a topic and key already derived. */
  async open(words) {
    this.words = Array.isArray(words) ? words : null;
    this.rv = Array.isArray(words) ? await deriveRendezvous(words, this.iterations) : words.rv;
    if (this.stopped) throw new Error('stopped');
    this.hub = this.makeHub(this.rv.topic);
    this.hub.on('status', (s) => this.emit('status', s));
    this.hub.on('message', ({ payload }) => this.receive(payload));
    await this.hub.start();
    if (this.stopped) throw new Error('stopped');
    this.emit('status', this.hub.status());
  }

  async receive(payload) {
    let msg;
    try {
      msg = await openMessage(this.rv, payload);
    } catch {
      return; // not for us, or not readable: relays and strangers can only send noise
    }
    if (this.stopped || msg.f === this.id || !this.guard.accept(msg)) return;
    this.handle(msg);
  }

  async publish(body) {
    if (this.stopped || !this.hub) return 0;
    return this.hub.publish(await sealMessage(this.rv, { ...body, f: this.id }));
  }

  every(ms, fn) {
    const t = setInterval(fn, ms);
    this.timers.push(() => clearInterval(t));
    fn();
  }

  after(ms, fn) {
    const t = setTimeout(fn, ms);
    this.timers.push(() => clearTimeout(t));
  }

  /** Leaves every broker and stops all timers. */
  stop() {
    this.stopped = true;
    for (const off of this.timers) off();
    this.timers = [];
    this.hub?.close();
  }
}

/**
 * The device that shows the code. offerReady resolves with the offer fields to send.
 * With rv there are no words (a topic and key derived elsewhere), and a device that knocks
 * again after reloading may take the place of the first knock.
 */
export class CodeCreator extends Side {
  constructor(offerReady, { rv = null, ...opts } = {}) {
    super(opts);
    this.offerReady = offerReady;
    this.presetRv = rv;
    this.guest = null;
    this.answered = false;
  }

  async start() {
    const words = this.presetRv ? null : generateWords();
    this.expires = Date.now() + CODE_LIFETIME_MS;
    this.after(CODE_LIFETIME_MS, () => {
      this.stop();
      this.emit('expired');
    });
    await this.open(words ?? { rv: this.presetRv });
    return words;
  }

  async handle(msg) {
    if (msg.k === 'join') {
      // Single use: the first device that joins gets the offer, everyone else is ignored.
      if (this.presetRv && !this.answered) this.guest = msg.f;
      this.guest ??= msg.f;
      if (msg.f !== this.guest || this.answered) return;
      const offer = await this.offerReady;
      await this.publish({ k: 'offer', to: this.guest, ...offer });
    } else if (msg.k === 'answer' && msg.f === this.guest && msg.to === this.id && !this.answered) {
      this.answered = true;
      this.emit('answer', msg);
    }
  }
}

/**
 * A room invite: the same six words (typed, scanned from the QR code or opened as a link) let
 * several devices in, one after another, for as long as the room is open. Each device that
 * knocks gets a fresh offer from makeOffer(deviceId); its answer is emitted once as
 * 'answer' { from, ...fields }. A device that never answers is forgotten after a minute.
 */
export class RoomCreator extends Side {
  constructor(makeOffer, { maxPending = 6, pendingMs = 60000, ...opts } = {}) {
    super(opts);
    this.makeOffer = makeOffer;
    this.maxPending = maxPending;
    this.pendingMs = pendingMs;
    this.guests = new Map(); // device id -> { offer, answered }
    this.full = () => false;
  }

  /** Opens the room on the relays. Pass words to reuse them, or get new ones back. */
  async start(words = null) {
    const list = words ?? generateWords();
    await this.open(list);
    return list;
  }

  get pending() {
    let n = 0;
    for (const g of this.guests.values()) if (!g.answered) n++;
    return n;
  }

  async handle(msg) {
    if (msg.k === 'join') {
      let g = this.guests.get(msg.f);
      if (!g) {
        if (this.pending >= this.maxPending || this.full()) return;
        g = { offer: Promise.resolve().then(() => this.makeOffer(msg.f)), answered: false };
        g.offer.catch(() => this.guests.delete(msg.f));
        this.guests.set(msg.f, g);
        this.after(this.pendingMs, () => {
          if (this.guests.get(msg.f) === g && !g.answered) {
            this.guests.delete(msg.f);
            this.emit('abandoned', msg.f);
          }
        });
      }
      if (g.answered) return;
      let offer;
      try {
        offer = await g.offer;
      } catch {
        return;
      }
      // the joiner knocks every second and a half, so a lost offer is simply sent again
      await this.publish({ k: 'offer', to: msg.f, ...offer });
    } else if (msg.k === 'answer' && msg.to === this.id) {
      const g = this.guests.get(msg.f);
      if (!g || g.answered) return;
      g.answered = true;
      this.emit('answer', { ...msg, from: msg.f });
    }
  }

  /** Lets a device knock again from scratch (its connection failed or it left). */
  forget(deviceId) {
    this.guests.delete(deviceId);
  }
}

/** The device that typed or scanned the code. words: the six words, or { rv } with a derived topic and key. */
export class CodeJoiner extends Side {
  async start(words, { timeout = JOIN_TIMEOUT_MS } = {}) {
    await this.open(words);
    this.after(timeout, () => {
      if (!this.host) this.emit('timeout');
    });
    this.every(KNOCK_EVERY_MS, () => !this.host && this.publish({ k: 'join' }));
  }

  handle(msg) {
    if (msg.k !== 'offer' || msg.to !== this.id || this.host) return;
    this.host = msg.f;
    this.emit('offer', msg);
  }

  /** Sends the answer a few times, since the relays deliver at most once and may drop it. */
  sendAnswer(answer) {
    let n = 0;
    this.every(KNOCK_EVERY_MS, () => n++ < ANSWER_REPEATS && this.publish({ k: 'answer', to: this.host, ...answer }));
  }
}
