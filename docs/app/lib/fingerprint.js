// Generated from src/fingerprint.js by scripts/build-app.mjs. Edit the source, not this copy.
// Connection fingerprints from the DTLS certificates in the SDP. Both ends compute the same
// values, and anyone who swapped a handshake message in the middle gets different ones.

import { utf8 } from './bytes.js';
import { Sha256 } from './sha256.js';

/** The DTLS certificate fingerprint (algorithm and hex, no separators) from an SDP blob. */
export function sdpFingerprint(sdp) {
  const m = /a=fingerprint:(\S+) ([0-9A-Fa-f:]+)/.exec(sdp || '');
  if (!m) return null;
  return `${m[1].toLowerCase()} ${m[2].replace(/:/g, '').toLowerCase()}`;
}

/** Twelve digits both devices show, made from both certificate fingerprints. */
export function connectionFingerprint(localSdp, remoteSdp) {
  const a = sdpFingerprint(localSdp);
  const b = sdpFingerprint(remoteSdp);
  if (!a || !b) return null;
  const digest = new Sha256().update(utf8([a, b].sort().join('|'))).digest();
  let n = 0n;
  for (let i = 0; i < 8; i++) n = (n << 8n) | BigInt(digest[i]);
  const digits = (n % 1000000000000n).toString().padStart(12, '0');
  return `${digits.slice(0, 4)} ${digits.slice(4, 8)} ${digits.slice(8)}`;
}
