import { describe, expect, it } from 'vitest';
import { createDoc, makeLayer } from '../src/doc.js';
import { GuestSession, HostSession, MAX_GUESTS } from '../src/session.js';
import { Assembler, MessagePort, decodeBody, encodeBody, encodeFrames, extractBinary, restoreBinary } from '../src/wire.js';
import { fileMessage, fileReceipt, receiveFile } from '../src/transfer.js';
import { CodeCreator, CodeJoiner, RoomCreator } from '../src/pairing.js';
import { confirmWords, wordsFromLink, wordsLink } from '../src/words.js';
import { FakeBroker, MemoryEngine, portPair, randomData, tick, until } from './unit-helpers.js';

describe('wire format', () => {
  it('keeps binary values anywhere in a message', async () => {
    const msg = { t: 'ops', ops: [{ t: 'patch', data: new Uint8ClampedArray([1, 2, 3]) }, { t: 'asset', data: new Uint8Array([9]) }], n: 1 };
    const { json, parts } = extractBinary(msg);
    expect(JSON.stringify(json)).not.toMatch(/\[1,2,3\]/);
    const back = restoreBinary(json, parts.map((p) => p.bytes));
    expect(back.ops[0].data).toBeInstanceOf(Uint8ClampedArray);
    expect(Array.from(back.ops[0].data)).toEqual([1, 2, 3]);
    const body = await encodeBody(msg);
    expect(await decodeBody(body.body, body.compressed)).toEqual(msg);
  });

  it('cuts large messages into frames and reassembles them in any order', async () => {
    const data = randomData(300000, 7);
    const frames = await encodeFrames(5, { t: 'file', data }, { compressAbove: Infinity });
    expect(frames.length).toBeGreaterThan(4);
    expect(frames.every((f) => f.length <= 60 * 1024 + 13)).toBe(true);
    const asm = new Assembler();
    let out = null;
    for (const f of [...frames].reverse()) out = (await asm.push(f)) ?? out;
    expect(Array.from(out.data.subarray(0, 50))).toEqual(Array.from(data.subarray(0, 50)));
    expect(out.data.length).toBe(data.length);
  });

  it('compresses repetitive payloads', async () => {
    const body = await encodeBody({ data: new Uint8Array(200000) });
    expect(body.compressed).toBe(true);
    expect(body.body.length).toBeLessThan(5000);
  });

  it('a message port waits for the buffer to drain', async () => {
    let buffered = 0;
    const sent = [];
    let drains = 0;
    const link = {
      send: (f) => {
        sent.push(f);
        buffered += f.length;
      },
      bufferedAmount: () => buffered,
      drained: async () => {
        drains++;
        buffered = 0;
      },
    };
    const port = new MessagePort(link, { highWater: 100000 });
    await port.send({ data: randomData(400000, 2) });
    expect(drains).toBeGreaterThan(0);
    const rx = new MessagePort(link);
    let got = null;
    for (const f of sent) got = (await rx.receive(f)) ?? got;
    expect(got.data.length).toBe(400000);
  });
});

describe('sending a photo in full quality', () => {
  it('arrives byte for byte with a matching SHA-256', async () => {
    const bytes = randomData(123457, 11);
    const msg = await fileMessage(bytes, { name: 'beach.jpg', mime: 'image/jpeg' });
    expect(msg.sha256).toMatch(/^[0-9a-f]{64}$/);
    const frames = await encodeFrames(1, msg);
    const asm = new Assembler();
    let got = null;
    for (const f of frames) got = (await asm.push(f)) ?? got;
    const r = await receiveFile(got);
    expect(r.ok).toBe(true);
    expect(r.sha256).toBe(msg.sha256);
    expect(fileReceipt(r)).toEqual({ t: 'file-receipt', ok: true, sha256: msg.sha256, size: 123457 });
  });

  it('refuses a file that changed on the way', async () => {
    const msg = await fileMessage(randomData(1000, 1), { name: '../../x', mime: 'image/png' });
    expect(msg.name).not.toContain('/');
    msg.data[10] ^= 1;
    const r = await receiveFile(msg);
    expect(r.ok).toBe(false);
    expect(r.sha256).not.toBe(r.expected);
  });
});

describe('six word pairing over relays', () => {
  it('creator and joiner swap offer and answer sealed with the words, once', async () => {
    const broker = new FakeBroker();
    const hub = (topic) => broker.hub(topic);
    const creator = new CodeCreator(Promise.resolve({ sdp: 'offer-sdp', nonce: 'n1' }), { hub, iterations: 1000 });
    const words = await creator.start();
    expect(words).toHaveLength(6);
    const answers = [];
    creator.on('answer', (m) => answers.push(m));
    const joiner = new CodeJoiner({ hub, iterations: 1000 });
    const offers = [];
    joiner.on('offer', (m) => {
      offers.push(m);
      joiner.sendAnswer({ sdp: 'answer-sdp' });
    });
    await joiner.start(words);
    await until(() => answers.length === 1);
    expect(offers[0].sdp).toBe('offer-sdp');
    expect(answers[0].sdp).toBe('answer-sdp');
    // Repeated answers (sent a few times on purpose) are applied only once.
    await tick(3200);
    expect(answers).toHaveLength(1);
    // A second device with the same words gets nothing: the code is single use.
    const late = new CodeJoiner({ hub, iterations: 1000 });
    let lateOffer = false;
    late.on('offer', () => (lateOffer = true));
    await late.start(words);
    await tick(1700);
    expect(lateOffer).toBe(false);
    for (const s of [creator, joiner, late]) s.stop();
  });

  it('a room invite lets several devices in with the same words, each with its own offer', async () => {
    const broker = new FakeBroker();
    const hub = (topic) => broker.hub(topic);
    const made = [];
    const room = new RoomCreator(async (id) => {
      made.push(id);
      return { sdp: `offer-for-${id}`, nonce: `n-${made.length}` };
    }, { hub, iterations: 1000 });
    const words = await room.start();
    const answers = [];
    room.on('answer', (m) => answers.push(m));
    // the words reach the room the same way through the link and the QR code (which holds the link)
    const viaLink = wordsFromLink(wordsLink('https://kwy404.github.io/pixelotter/app/', words));
    expect(viaLink).toEqual(words);
    const joiners = [new CodeJoiner({ hub, iterations: 1000 }), new CodeJoiner({ hub, iterations: 1000 })];
    const offers = [];
    for (const j of joiners) {
      j.on('offer', (m) => {
        offers.push(m);
        j.sendAnswer({ sdp: `answer-from-${j.id}` });
      });
    }
    await joiners[0].start(words);
    await joiners[1].start(viaLink);
    await until(() => answers.length === 2);
    expect(new Set(offers.map((o) => o.sdp)).size).toBe(2);
    expect(offers.every((o) => o.sdp === `offer-for-${o.to}`)).toBe(true);
    expect(answers.map((a) => a.from).sort()).toEqual(joiners.map((j) => j.id).sort());
    await tick(3200);
    expect(answers).toHaveLength(2);
    expect(made).toHaveLength(2);
    // a full room stops handing out offers
    room.full = () => true;
    const late = new CodeJoiner({ hub, iterations: 1000 });
    let lateOffer = false;
    late.on('offer', () => (lateOffer = true));
    await late.start(words);
    await tick(1700);
    expect(lateOffer).toBe(false);
    for (const s of [room, ...joiners, late]) s.stop();
  });

  it('other words never meet', async () => {
    const broker = new FakeBroker();
    const hub = (topic) => broker.hub(topic);
    const creator = new CodeCreator(Promise.resolve({ sdp: 'x' }), { hub, iterations: 1000 });
    await creator.start();
    const joiner = new CodeJoiner({ hub, iterations: 1000 });
    let got = false;
    joiner.on('offer', () => (got = true));
    await joiner.start(['abandon', 'ability', 'able', 'about', 'above', 'absent']);
    await tick(1700);
    expect(got).toBe(false);
    creator.stop();
    joiner.stop();
  });

  it('confirmation words match on both sides and differ for another certificate', () => {
    const a = 'sha-256 aa11';
    const b = 'sha-256 bb22';
    expect(confirmWords(a, b, 'n')).toEqual(confirmWords(b, a, 'n'));
    expect(confirmWords(a, 'sha-256 cc33', 'n')).not.toEqual(confirmWords(a, b, 'n'));
  });
});

function session(guests = 2) {
  const base = createDoc({ width: 64, height: 64 });
  const host = new MemoryEngine(base);
  host.apply([{ t: 'asset', id: 'px', w: 8, h: 8, data: null }]);
  host.apply([{ t: 'add', layer: makeLayer('raster', { id: 'bg', asset: 'px', w: 8, h: 8, x: 32, y: 32 }) }]);
  const hs = new HostSession({ engine: host, name: 'Ana' });
  const list = [];
  for (let i = 0; i < guests; i++) {
    const [hp, gp] = portPair();
    const engine = new MemoryEngine(createDoc());
    const gs = new GuestSession({ engine, port: gp });
    gp.inbox = (m) => gs.receive(m);
    list.push({ engine, gs, hp });
  }
  return { host, hs, list };
}

async function join(hs, g, name) {
  const id = await hs.addGuest(g.hp, { name });
  g.hp.inbox = (m) => hs.receive(id, m);
  await until(() => g.gs.ready);
  return id;
}

describe('live session', () => {
  it('late joiners get a full snapshot', async () => {
    const { host, hs, list } = session(1);
    await join(hs, list[0], 'Bo');
    expect(list[0].engine.fingerprint()).toBe(host.fingerprint());
    expect(hs.peerList().map((p) => p.name)).toEqual(['Ana', 'Bo']);
  });

  it('two friends editing different layers at once end with identical documents', async () => {
    const { host, hs, list } = session(2);
    await join(hs, list[0], 'Bo');
    await join(hs, list[1], 'Cy');
    const [b, c] = list;
    // Each guest adds a layer and edits it many times while the other does the same.
    const edit = (g, ops) => g.gs.local(ops, g.engine.apply(ops));
    edit(b, [{ t: 'add', layer: makeLayer('text', { id: 'tb', text: 'B' }) }]);
    edit(c, [{ t: 'add', layer: makeLayer('shape', { id: 'sc', shape: 'star' }) }]);
    for (let i = 0; i < 20; i++) {
      edit(b, [{ t: 'set', id: 'tb', props: { x: i } }]);
      edit(c, [{ t: 'set', id: 'sc', props: { rotation: i } }]);
      if (i % 5 === 0) hs.local(applyAndReturn(host, [{ t: 'set', id: 'bg', props: { opacity: 1 - i / 40 } }]));
    }
    // A pixel patch from a guest on the host's layer is refused (the host holds it).
    edit(b, [{ t: 'patch', id: 'px', x: 0, y: 0, w: 1, h: 1, data: new Uint8ClampedArray([255, 0, 0, 255]) }]);
    await until(() => b.gs.pending.length === 0 && c.gs.pending.length === 0, 8000);
    await tick(20);
    expect(b.engine.fingerprint()).toBe(host.fingerprint());
    expect(c.engine.fingerprint()).toBe(host.fingerprint());
    expect(host.doc.layers.map((l) => l.id).sort()).toEqual(['bg', 'sc', 'tb']);
    expect(host.pixels.read('px')[0]).toBe(0);
    expect(hs.lockOwner('tb')).toBe('g1');
    expect(hs.lockOwner('sc')).toBe('g2');
  });

  it('view only guests cannot edit, and leaving frees locks', async () => {
    const { hs, list } = session(2);
    const id = await join(hs, list[0], 'Bo');
    await join(hs, list[1], 'Cy');
    hs.setRole(id, 'view');
    await until(() => list[0].gs.role === 'view');
    expect(list[0].gs.local([{ t: 'doc', props: { name: 'x' } }], [])).toBe(false);
    list[1].gs.lock(['bg']);
    await until(() => hs.lockOwner('bg') === 'g2');
    list[1].gs.leave();
    await until(() => hs.lockOwner('bg') === null);
  });

  it('locks: a layer held by someone else is refused, then free after they leave', async () => {
    const { host, hs, list } = session(2);
    const idB = await join(hs, list[0], 'Bo');
    await join(hs, list[1], 'Cy');
    list[0].gs.lock(['bg']);
    await until(() => hs.lockOwner('bg') === idB);
    const ops = [{ t: 'set', id: 'bg', props: { name: 'mine' } }];
    const rejected = [];
    list[1].gs.on('rejected', (r) => rejected.push(r.reason));
    list[1].gs.local(ops, list[1].engine.apply(ops));
    await until(() => rejected.length === 1);
    expect(rejected[0]).toBe('locked');
    expect(list[1].engine.doc.layers[0].name).not.toBe('mine');
    list[0].gs.leave();
    await until(() => hs.lockOwner('bg') === null);
    expect(host.doc.layers[0].name).not.toBe('mine');
  });

  it('holds at most five friends', async () => {
    const { hs, list } = session(MAX_GUESTS + 1);
    for (let i = 0; i < MAX_GUESTS; i++) await join(hs, list[i], `G${i}`);
    await expect(hs.addGuest(list[MAX_GUESTS].hp, { name: 'late' })).rejects.toThrow(/up to 5/);
  });

  it('cursors are passed on with the sender id', async () => {
    const { hs, list } = session(2);
    await join(hs, list[0], 'Bo');
    await join(hs, list[1], 'Cy');
    const seen = [];
    list[1].gs.on('cursor', (c) => seen.push(c));
    list[0].gs.cursor(12, 34, { cx: 1, cy: 2, zoom: 1 });
    await until(() => seen.length === 1);
    expect(seen[0]).toMatchObject({ from: 'g1', x: 12, y: 34 });
  });
});

function applyAndReturn(engine, ops) {
  engine.apply(ops);
  return ops;
}
