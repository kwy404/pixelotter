// Voice and video for live sessions: the microphone (cleaned by the browser and by our own
// "Strong" noise suppression worklet: high pass, spectral suppression and a voice gate), the
// camera, screen sharing, the speaking ring, a mic test in settings, and remote playback.

import { Emitter } from '../lib/emitter.js';
import { cameraConstraints, micConstraints, usesDenoise } from '../lib/call.js';

const SPEAK_LEVEL = 0.018;
const SPEAK_HOLD = 300;

export class CallManager extends Emitter {
  constructor(settings) {
    super();
    this.settings = settings; // { noiseMode, gateSensitivity, inputId, outputId, cameraId }
    this.inCall = false;
    this.pipe = null;
    this.camera = null;
    this.screen = null;
    this.muted = false;
    this.ctx = null;
    this.meters = new Map();
    this.speaking = new Set();
    this.lastLoud = new Map();
    this.remote = new Map(); // peer id -> { audio, camera, screen, els }
    this.sink = document.createElement('div');
    this.sink.hidden = true;
    document.body.append(this.sink);
    this.timer = setInterval(() => this.measure(), 90);
  }

  get noiseMode() {
    return this.settings.noiseMode || 'strong';
  }

  get sensitivity() {
    return (this.settings.gateSensitivity ?? 50) / 100;
  }

  ensureContext() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  async openMic() {
    const supported = navigator.mediaDevices?.getSupportedConstraints?.() || {};
    const audio = micConstraints({ noiseMode: this.noiseMode, supported, inputId: this.settings.inputId });
    try {
      return await navigator.mediaDevices.getUserMedia({ audio });
    } catch (err) {
      if (err.name === 'OverconstrainedError' && this.settings.inputId) {
        this.settings.inputId = '';
        return navigator.mediaDevices.getUserMedia({ audio: micConstraints({ noiseMode: this.noiseMode, supported }) });
      }
      throw err;
    }
  }

  /** The microphone, through the noise suppression worklet in Strong mode. */
  async openPipe() {
    const raw = await this.openMic();
    for (const t of raw.getAudioTracks()) if ('contentHint' in t) t.contentHint = 'speech';
    const ctx = this.ensureContext();
    if (!usesDenoise({ noiseMode: this.noiseMode }) || !ctx?.audioWorklet || typeof AudioWorkletNode === 'undefined') return { raw, out: raw, chain: null };
    try {
      this.workletReady ??= ctx.audioWorklet.addModule(new URL('./denoise-worklet.js', import.meta.url));
      await this.workletReady;
      const src = ctx.createMediaStreamSource(raw);
      const node = new AudioWorkletNode(ctx, 'pixelotter-denoise', { processorOptions: { sensitivity: this.sensitivity } });
      const dest = ctx.createMediaStreamDestination();
      src.connect(node);
      node.connect(dest);
      const pipe = { raw, out: dest.stream, chain: { src, node, dest } };
      node.port.onmessage = (e) => {
        pipe.level = e.data;
        this.emit('mic-level', e.data);
      };
      return pipe;
    } catch (err) {
      console.warn('noise suppression is not available here', err);
      this.workletReady = null;
      return { raw, out: raw, chain: null };
    }
  }

  closePipe(pipe) {
    if (!pipe) return;
    try {
      pipe.chain?.src.disconnect();
      pipe.chain?.node.disconnect();
    } catch {
      // already disconnected
    }
    stop(pipe.raw);
    if (pipe.out !== pipe.raw) stop(pipe.out);
  }

  /** 'strong', 'standard', 'off' or null: what the outgoing microphone runs through now. */
  get processing() {
    return this.pipe?.chain ? 'strong' : this.pipe ? this.noiseMode : null;
  }

  setSensitivity(v) {
    this.settings.gateSensitivity = v;
    for (const p of [this.pipe, this.testPipe]) p?.chain?.node.port.postMessage({ sensitivity: this.sensitivity });
  }

  async startMicTest() {
    this.stopMicTest();
    const pipe = await this.openPipe();
    this.testPipe = pipe;
    const el = document.createElement('audio');
    el.autoplay = true;
    el.srcObject = pipe.out;
    if (this.settings.outputId && el.setSinkId) el.setSinkId(this.settings.outputId).catch(() => {});
    this.sink.append(el);
    el.play().catch(() => {});
    pipe.el = el;
    this.meter('test', pipe.out);
  }

  stopMicTest() {
    const p = this.testPipe;
    if (!p) return;
    this.testPipe = null;
    p.el?.remove();
    this.unmeter('test');
    this.closePipe(p);
  }

  get micLevel() {
    return this.testPipe?.level || this.pipe?.level || null;
  }

  /** Joins the call: opens the microphone and sends it on every link. */
  async join(links) {
    if (this.inCall) return;
    this.inCall = true;
    this.ensureContext();
    try {
      this.pipe = await this.openPipe();
      this.meter('self', this.pipe.out);
    } catch (err) {
      this.pipe = null;
      this.emit('error', err.name === 'NotAllowedError' ? 'mic-denied' : err.name === 'NotFoundError' ? 'mic-missing' : 'mic-failed');
    }
    this.applyMute();
    for (const link of links) this.attach(link);
    this.emit('change');
  }

  leave(links) {
    if (!this.inCall) return;
    this.inCall = false;
    this.closePipe(this.pipe);
    stop(this.camera);
    stop(this.screen);
    this.pipe = this.camera = this.screen = null;
    this.unmeter('self');
    for (const link of links) for (const slot of ['mic', 'camera', 'screen']) if (link.senders?.[slot]) link.setTrack(slot, null);
    this.emit('change');
  }

  /** Sends what we have on a (new) link. */
  attach(link) {
    if (!this.inCall || link.closed) return;
    const out = this.pipe?.out;
    if (out) link.setTrack('mic', out.getAudioTracks()[0], out);
    if (this.camera) link.setTrack('camera', this.camera.getVideoTracks()[0], this.camera);
    if (this.screen) link.setTrack('screen', this.screen.getVideoTracks()[0], this.screen);
  }

  toggleMute() {
    this.muted = !this.muted;
    this.applyMute();
    this.emit('change');
  }

  applyMute() {
    for (const t of this.pipe?.out?.getAudioTracks() ?? []) t.enabled = !this.muted;
  }

  async toggleCamera(links) {
    if (this.camera) {
      stop(this.camera);
      this.camera = null;
      for (const l of links) if (l.senders?.camera) l.setTrack('camera', null);
    } else {
      try {
        this.camera = await navigator.mediaDevices.getUserMedia({ video: cameraConstraints({ cameraId: this.settings.cameraId }) });
      } catch (err) {
        this.emit('error', err.name === 'NotAllowedError' ? 'camera-denied' : 'camera-failed');
        return;
      }
      for (const l of links) l.setTrack('camera', this.camera.getVideoTracks()[0], this.camera);
    }
    this.emit('change');
  }

  async toggleScreen(links) {
    if (this.screen) {
      stop(this.screen);
      this.screen = null;
      for (const l of links) if (l.senders?.screen) l.setTrack('screen', null);
    } else {
      try {
        this.screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false });
      } catch (err) {
        if (err.name !== 'NotAllowedError') this.emit('error', 'screen-failed');
        return;
      }
      const track = this.screen.getVideoTracks()[0];
      if ('contentHint' in track) track.contentHint = 'detail';
      track.addEventListener('ended', () => {
        if (this.screen) this.toggleScreen(links);
      });
      for (const l of links) l.setTrack('screen', track, this.screen);
    }
    this.emit('change');
  }

  /** The microphones, speakers and cameras this browser lists (labels appear after a permission). */
  async devices() {
    const out = { inputs: [], outputs: [], cameras: [] };
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const map = { audioinput: 'inputs', audiooutput: 'outputs', videoinput: 'cameras' };
      for (const d of list) {
        const key = map[d.kind];
        if (key && d.deviceId) out[key].push({ id: d.deviceId, label: d.label || `${key.slice(0, -1)} ${out[key].length + 1}` });
      }
    } catch {
      // no media devices API
    }
    return out;
  }

  /** Switches the microphone (or the noise mode) during a call without leaving it. */
  async setInput(deviceId, links) {
    if (deviceId !== undefined) this.settings.inputId = deviceId;
    if (this.testPipe) await this.startMicTest();
    if (!this.inCall) return;
    const old = this.pipe;
    try {
      this.pipe = await this.openPipe();
    } catch {
      this.emit('error', 'mic-failed');
      return;
    }
    this.unmeter('self');
    this.meter('self', this.pipe.out);
    this.applyMute();
    const track = this.pipe.out.getAudioTracks()[0];
    for (const l of links) l.setTrack('mic', track, this.pipe.out);
    this.closePipe(old);
    this.emit('change');
  }

  /** Switches the camera while it is on. */
  async setCamera(deviceId, links) {
    this.settings.cameraId = deviceId;
    if (!this.camera) return;
    let next;
    try {
      next = await navigator.mediaDevices.getUserMedia({ video: cameraConstraints({ cameraId: deviceId }) });
    } catch {
      this.emit('error', 'camera-failed');
      return;
    }
    const old = this.camera;
    this.camera = next;
    for (const l of links) l.setTrack('camera', next.getVideoTracks()[0], next);
    stop(old);
    this.emit('change');
  }

  /** Plays everyone through another speaker, where the browser allows choosing one. */
  async setOutput(deviceId) {
    this.settings.outputId = deviceId;
    for (const r of this.remote.values()) if (r.audioEl?.setSinkId) await r.audioEl.setSinkId(deviceId).catch(() => {});
    if (this.testPipe?.el?.setSinkId) await this.testPipe.el.setSinkId(deviceId).catch(() => {});
  }

  /** A remote track arrived on a link from a peer. */
  remoteTrack(peerId, { track, stream, slot }) {
    const r = this.remote.get(peerId) ?? { audio: null, camera: null, screen: null };
    if (track.kind === 'audio') {
      r.audio = stream;
      let el = r.audioEl;
      if (!el) {
        el = document.createElement('audio');
        el.autoplay = true;
        this.sink.append(el);
        r.audioEl = el;
      }
      el.srcObject = stream;
      el.muted = this.isPeerMuted(peerId);
      if (this.settings.outputId && el.setSinkId) el.setSinkId(this.settings.outputId).catch(() => {});
      el.play().catch(() => {});
      this.meter(peerId, stream);
    } else {
      const kind = slot === 'screen' ? 'screen' : slot === 'camera' ? 'camera' : r.camera ? 'screen' : 'camera';
      r[kind] = stream;
      track.addEventListener('ended', () => {
        if (r[kind] === stream) r[kind] = null;
        this.emit('change');
      });
    }
    this.remote.set(peerId, r);
    this.emit('change');
  }

  /** Silences one person on this device only (they are not told). */
  setPeerMuted(peerId, muted) {
    this.mutedPeers ??= new Set();
    if (muted) this.mutedPeers.add(peerId);
    else this.mutedPeers.delete(peerId);
    const el = this.remote.get(peerId)?.audioEl;
    if (el) el.muted = muted;
  }

  isPeerMuted(peerId) {
    return !!this.mutedPeers?.has(peerId);
  }

  /** The other side said which streams it sends now: forget a camera or screen it stopped. */
  remoteMedia(peerId, media) {
    const r = this.remote.get(peerId);
    if (!r) return;
    const live = new Set(Object.values(media ?? {}));
    let changed = false;
    for (const kind of ['camera', 'screen']) {
      if (r[kind] && !live.has(r[kind].id)) {
        r[kind] = null;
        changed = true;
      }
    }
    if (changed) this.emit('change');
  }

  dropPeer(peerId) {
    const r = this.remote.get(peerId);
    if (!r) return;
    r.audioEl?.remove();
    this.unmeter(peerId);
    this.remote.delete(peerId);
    this.emit('change');
  }

  meter(id, stream) {
    const ctx = this.ensureContext();
    if (!ctx || !stream?.getAudioTracks().length) return;
    this.unmeter(id);
    try {
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      this.meters.set(id, { src, an, buf: new Float32Array(an.fftSize) });
    } catch {
      // a stream without audio
    }
  }

  unmeter(id) {
    const m = this.meters.get(id);
    if (!m) return;
    try {
      m.src.disconnect();
    } catch {
      // ignore
    }
    this.meters.delete(id);
    this.speaking.delete(id);
  }

  measure() {
    const now = performance.now();
    let changed = false;
    for (const [id, m] of this.meters) {
      m.an.getFloatTimeDomainData(m.buf);
      let s = 0;
      for (const v of m.buf) s += v * v;
      const rms = Math.sqrt(s / m.buf.length);
      m.rms = rms;
      const muted = id === 'self' && this.muted;
      if (rms > SPEAK_LEVEL && !muted) this.lastLoud.set(id, now);
      const on = now - (this.lastLoud.get(id) ?? 0) < SPEAK_HOLD;
      if (on !== this.speaking.has(id)) {
        if (on) this.speaking.add(id);
        else this.speaking.delete(id);
        changed = true;
      }
    }
    if (changed) this.emit('speaking', new Set(this.speaking));
  }

  level(id) {
    return this.meters.get(id)?.rms ?? 0;
  }
}

function stop(stream) {
  for (const t of stream?.getTracks() ?? []) t.stop();
}
