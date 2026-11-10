import { createRequire } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
const { createLoader, mergeCues } = createRequire(import.meta.url)('../public/transcript-loader.js');
const tick = () => new Promise(r => setImmediate(r));
test('latest renders before slow history, live has separate capacity, bounded and ordered', async () => {
  const waiting = new Map(), started = [], rendered = [];
  let active = 0, max = 0, cues = [];
  const loader = createLoader({ concurrency: 2, recentCount: 1,
    fetchText: url => { started.push(url); active++; max = Math.max(max, active); return new Promise(r => waiting.set(url, text => { active--; r(text); })); },
    onText: (text, url) => { rendered.push(url); cues = mergeCues(cues, [{ t: +url, end: +url + .5, text }]); }
  });
  const initial = loader.enqueue(['1', '2', '3']); await tick();
  assert.deepEqual(started, ['3']);
  waiting.get('3')('latest'); await initial; await tick();
  assert.deepEqual(rendered, ['3']);
  const live = loader.enqueue(['1', '2', '3', '4']); await tick();
  assert.equal(started.at(-1), '4'); waiting.get('4')('live'); await live;
  waiting.get('2')('middle'); await tick(); waiting.get('1')('old'); await tick();
  assert.deepEqual(cues.map(c => c.t), [1, 2, 3, 4]); assert.equal(max, 2); loader.stop();
});
test('VOD failures retry without another playlist pull', async () => {
  const timers = []; let attempts = 0; const rendered = [];
  const loader = createLoader({ fetchText: async () => { if (++attempts < 2) throw Error('temporary'); return 'ok'; },
    onText: text => rendered.push(text), setTimer: fn => { timers.push(fn); return timers.length; }, clearTimer() {} });
  await loader.enqueue(['a']); await tick(); assert.equal(timers.length, 1);
  timers.shift()(); await tick(); assert.deepEqual(rendered, ['ok']); loader.stop();
});
test('stopped selection never renders stale responses or starts queued history', async () => {
  const pending = []; let renders = 0, starts = 0;
  const loader = createLoader({ concurrency: 2, recentCount: 1,
    fetchText: () => { starts++; return new Promise(r => pending.push(r)); }, onText: () => renders++ });
  const initial = loader.enqueue(['1', '2', '3']); await tick(); loader.stop(); await initial;
  pending.forEach(r => r('stale')); await tick(); assert.equal(renders, 0); assert.equal(starts, 1);
});
test('out of order overlapping cues merge while retaining the rendered row', () => {
  const row = { annotation: 'keep' };
  const result = mergeCues([{ t: 10, end: 12, text: 'same', row }], [{ t: 8, end: 11, text: 'same' }]);
  assert.equal(result.length, 1); assert.equal(result[0].row, row); assert.equal(result[0].t, 8); assert.equal(result[0].end, 12);
});
test('persistent failures stop after three attempts and stats expose the gap', async () => {
  const timers = []; let attempts = 0;
  const loader = createLoader({ fetchText: async () => { attempts++; throw Error('404'); }, onText() {},
    setTimer: fn => { timers.push(fn); return timers.length; }, clearTimer() {} });
  await loader.enqueue(['bad']); await tick();
  timers.shift()(); await tick(); timers.shift()(); await tick();
  assert.equal(attempts, 3); assert.equal(timers.length, 0);
  assert.deepEqual(loader.stats(), { total: 1, done: 0, failed: 1, pending: 0 }); loader.stop();
});
