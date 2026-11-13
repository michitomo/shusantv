import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { createPauseDetector, rms } = createRequire(import.meta.url)('../public/pause-detector.js');

// Feeds a level every 100ms and returns the times at which a pause is reported.
function run(detector, levels, start = 0) {
  const paused = [];
  levels.forEach((level, i) => { if (detector.feed(level, start + i * 100)) paused.push(start + i * 100); });
  return paused;
}
const repeat = (level, count) => Array(count).fill(level);

test('a pause is reported after half a second of quiet that follows speech', () => {
  const d = createPauseDetector();
  // 1s of leading silence is not a pause; then speech, 0.8s of quiet, speech again.
  const paused = run(d, [...repeat(0.001, 10), ...repeat(0.2, 20), ...repeat(0.002, 8), ...repeat(0.2, 5)]);
  assert.deepEqual(paused, [3500, 3600, 3700]);
});

test('short gaps between words and steady room noise are not pauses', () => {
  const d = createPauseDetector();
  assert.deepEqual(run(d, [...repeat(0.2, 10), ...repeat(0.002, 3), ...repeat(0.2, 10), ...repeat(0.002, 4), ...repeat(0.2, 5)]), []);
  // The quiet mark follows the speaker: hum at 10% of a loud voice still counts as quiet,
  const loud = createPauseDetector();
  assert.equal(run(loud, [...repeat(0.5, 10), ...repeat(0.05, 8)]).length, 3);
  // but the same hum under a soft voice is not mistaken for speech stopping and starting.
  const soft = createPauseDetector();
  assert.deepEqual(run(soft, [...repeat(0.08, 10), ...repeat(0.05, 8)]), []);
});

test('the speech level fades, so one loud moment does not hide later pauses forever', () => {
  const d = createPauseDetector();
  run(d, [0.9, ...repeat(0.05, 5)]);            // a bang, then a normal voice reads as "quiet"
  const later = run(d, [...repeat(0.05, 600)], 600); // …for a while, not for good
  assert.ok(later.length < 400, `quiet for ${later.length} of 600 frames`);
  d.reset();
  assert.deepEqual(run(d, repeat(0.001, 20)), [], 'after a reset, silence alone is not a pause');
});

test('rms of a frame', () => {
  assert.equal(rms(new Float32Array(8)), 0);
  assert.ok(Math.abs(rms(Float32Array.from([0.5, -0.5, 0.5, -0.5])) - 0.5) < 1e-6);
});
