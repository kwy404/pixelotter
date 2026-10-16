// Projects kept in this browser (IndexedDB): autosave a few seconds after each change, the
// recent files on the Home screen, and recovery after a crash or a closed tab. Nothing leaves
// the device.

const DB = 'pixelotter';
const STORE = 'projects';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('updated', 'updated');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    Promise.resolve(fn(store)).then((r) => (result = r), reject);
    t.oncomplete = () => {
      db.close();
      resolve(result);
    };
    t.onerror = () => reject(t.error);
  });
}

const req = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

/** Stores a project. entry: { id, name, bytes, thumb (Blob), dirty, width, height } */
export function putProject(entry) {
  return tx('readwrite', (s) => req(s.put({ ...entry, updated: Date.now() })));
}

export function getProject(id) {
  return tx('readonly', (s) => req(s.get(id)));
}

export function deleteProject(id) {
  return tx('readwrite', (s) => req(s.delete(id)));
}

/** Recent projects, newest first, without their bytes (for the Home screen). */
export async function listProjects(limit = 24) {
  const all = await tx('readonly', (s) => req(s.getAll()));
  return all
    .sort((a, b) => b.updated - a.updated)
    .slice(0, limit)
    .map(({ bytes, ...rest }) => ({ ...rest, size: bytes?.length ?? 0 }));
}

/** Projects autosaved with unsaved changes: candidates for recovery. */
export async function recoverable() {
  return (await listProjects(50)).filter((p) => p.dirty);
}

/** Debounced autosave for a document. pack() returns { bytes, thumb }. */
export class Autosaver {
  constructor({ delay = 2500, onSaved = () => {} } = {}) {
    this.delay = delay;
    this.timers = new Map();
    this.onSaved = onSaved;
    this.busy = new Set();
  }

  schedule(edoc, pack) {
    clearTimeout(this.timers.get(edoc.uid));
    this.timers.set(
      edoc.uid,
      setTimeout(() => this.save(edoc, pack), this.delay),
    );
  }

  async save(edoc, pack) {
    if (this.busy.has(edoc.uid)) return this.schedule(edoc, pack);
    this.busy.add(edoc.uid);
    try {
      const { bytes, thumb } = await pack(edoc);
      await putProject({ id: edoc.doc.id, name: edoc.doc.name, bytes, thumb, dirty: edoc.dirty, width: edoc.doc.width, height: edoc.doc.height, file: edoc.file?.name ?? null });
      this.onSaved(edoc);
    } catch (err) {
      console.warn('autosave failed', err);
    } finally {
      this.busy.delete(edoc.uid);
    }
  }

  async markClean(edoc) {
    const p = await getProject(edoc.doc.id).catch(() => null);
    if (p) await putProject({ ...p, dirty: false });
  }
}
