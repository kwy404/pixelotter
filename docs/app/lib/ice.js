// Generated from src/ice.js by scripts/build-app.mjs. Edit the source, not this copy.
// Reads ICE candidates out of SDP and turns a failed connection into a reason a person can act on.

/** Candidate types found in an SDP blob: { host, srflx, relay, prflx }. */
export function candidateTypes(sdp) {
  const types = { host: 0, srflx: 0, relay: 0, prflx: 0 };
  for (const m of String(sdp || '').matchAll(/a=candidate:\S+ \d+ \S+ \d+ \S+ \d+ typ (\w+)/g)) if (m[1] in types) types[m[1]]++;
  return types;
}

const hasTurnServer = (config) => (config?.iceServers || []).some((s) => [].concat(s.urls).some((u) => /^turns?:/i.test(u)));

/**
 * Why a connection failed, as a key the UI turns into plain words:
 *   relay-unreachable  relay only is on and no relay address was gathered
 *   turn-unreachable   a TURN server is configured but gave no relay address
 *   stun-blocked       this device has no public address (STUN blocked)
 *   peer-stun-blocked  the other device has no public address
 *   strict-nat         both have public addresses but no path worked and no relay exists
 *   relay-failed       a relay existed and the connection still failed
 */
export function diagnose(localSdp, remoteSdp, config) {
  const local = candidateTypes(localSdp);
  const remote = candidateTypes(remoteSdp);
  if (config?.iceTransportPolicy === 'relay' && !local.relay) return 'relay-unreachable';
  if (hasTurnServer(config) && !local.relay) return 'turn-unreachable';
  if (!local.srflx && !local.relay) return 'stun-blocked';
  if (!remote.srflx && !remote.relay) return 'peer-stun-blocked';
  if (!local.relay && !remote.relay) return 'strict-nat';
  return 'relay-failed';
}
