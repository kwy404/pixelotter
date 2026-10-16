// Generated from src/call.js by scripts/build-app.mjs. Edit the source, not this copy.
// Call settings with no browser state: microphone constraints and whether our own noise
// suppression (the AudioWorklet running dsp.js) is used.

/** Noise suppression modes: 'off', 'standard' (the browser's own) and 'strong' (browser plus ours). */
export const NOISE_MODES = Object.freeze(['off', 'standard', 'strong']);

/**
 * getUserMedia audio constraints: echo cancellation and automatic gain always on, the
 * browser's noise suppression (and voice isolation where it exists) unless the mode is 'off'.
 */
export function micConstraints({ noiseMode = 'strong', supported = {}, inputId = '' } = {}) {
  const clean = noiseMode !== 'off';
  const audio = { echoCancellation: true, autoGainControl: true, noiseSuppression: clean };
  if (supported.voiceIsolation) audio.voiceIsolation = clean;
  if (inputId) audio.deviceId = { exact: inputId };
  return audio;
}

/** Whether our own noise suppression worklet should run. */
export const usesDenoise = ({ noiseMode = 'strong' } = {}) => noiseMode === 'strong';

/** Camera constraints: a calm 640 by 360 by default, the chosen camera when set. */
export function cameraConstraints({ cameraId = '' } = {}) {
  const video = { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24, max: 30 } };
  if (cameraId) video.deviceId = { exact: cameraId };
  return video;
}
