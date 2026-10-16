// Generated from src/emitter.js by scripts/build-app.mjs. Edit the source, not this copy.
// A tiny event emitter shared by the relay, the MQTT client and the photo sender.

export class Emitter {
  constructor() {
    this.listeners = new Map();
  }
  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
    return () => this.listeners.get(type)?.delete(fn);
  }
  emit(type, detail) {
    for (const fn of this.listeners.get(type) ?? []) {
      try {
        fn(detail);
      } catch (err) {
        if (type !== 'error') this.emit('error', err);
      }
    }
  }
}
