// Chat messages in a live session: text, replies, reactions and pasted images. Plain data,
// checked on arrival, so a broken or hostile peer cannot inject anything unexpected.

export const MAX_TEXT = 2000;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/** Reactions are named, and shown as icons. */
export const REACTIONS = Object.freeze(['heart', 'thumbs', 'laugh', 'star', 'wow']);

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Normalizes a chat message from a peer, or returns null when it is not one. */
export function normalizeMessage(m) {
  if (!m || typeof m !== 'object') return null;
  const text = str(m.text, MAX_TEXT).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const image = m.image instanceof Uint8Array && m.image.length <= MAX_IMAGE_BYTES && /^image\/(png|jpeg|webp|gif)$/.test(m.imageType ?? '') ? m.image : null;
  if (!text.trim() && !image) return null;
  return {
    id: str(m.id, 40) || Math.random().toString(36).slice(2),
    from: str(m.from, 40),
    name: str(m.name, 40) || 'Friend',
    color: /^#[0-9a-f]{6}$/i.test(m.color ?? '') ? m.color : '#9b968e',
    text,
    replyTo: str(m.replyTo, 40) || null,
    image,
    imageType: image ? m.imageType : null,
    at: Number.isFinite(m.at) ? m.at : Date.now(),
    reactions: {},
  };
}

/** Toggles a reaction by a person. Returns the new reactions object. */
export function toggleReaction(reactions, kind, who) {
  if (!REACTIONS.includes(kind)) return reactions;
  const out = { ...reactions };
  const list = new Set(out[kind] ?? []);
  if (list.has(who)) list.delete(who);
  else list.add(who);
  if (list.size) out[kind] = [...list];
  else delete out[kind];
  return out;
}

/** A short quote of a message for the reply preview. */
export function quote(msg, max = 80) {
  if (!msg) return '';
  const t = msg.text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}...` : t || (msg.image ? '[image]' : '');
}
