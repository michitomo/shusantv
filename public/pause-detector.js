// Finds pauses in speech from the audio level, so captions can be cut where the
// speaker actually stops rather than where the recognizer happens to finalize.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.shusantvPause = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // silenceMs: how long the level must stay low. The low mark follows the speaker:
  // `ratio` of the recent speech level, never below `floor` (room noise, hum).
  function createPauseDetector({ silenceMs = 500, floor = 0.004, ratio = 0.15, decayMs = 8000 } = {}) {
    let speech = 0, quietSince = null, heard = false, last = null;
    return {
      // level: RMS of the latest audio frame (0..1). Returns true while in a pause
      // that follows speech; leading silence is not a pause.
      feed(level, now) {
        if (last !== null && now > last) speech *= Math.pow(0.5, (now - last) / decayMs);
        last = now;
        if (level > Math.max(floor, speech * ratio)) {
          speech = Math.max(speech, level);
          quietSince = null;
          heard = true;
          return false;
        }
        if (quietSince === null) quietSince = now;
        return heard && now - quietSince >= silenceMs;
      },
      reset() { speech = 0; quietSince = null; heard = false; last = null; },
    };
  }
  const rms = samples => {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    return samples.length ? Math.sqrt(sum / samples.length) : 0;
  };
  return { createPauseDetector, rms };
});
