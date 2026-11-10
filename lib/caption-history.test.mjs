import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { createHistory } = createRequire(import.meta.url)('../public/caption-history.js');
const interim = text => ({ text, final: false });
const final = text => ({ text, final: true });

test('cumulative interim corrections and finalization keep one stable entry', () => {
  const h = createHistory();
  const first = h.updateAsr([interim('会議')], 0);
  assert.equal(first.added, 1);
  assert.equal(h.updateAsr([interim('会議')], 4000).changed, false);
  const corrected = h.updateAsr([interim('開議')], 5000);
  assert.equal(corrected.added, 0);
  assert.equal(corrected.entries[0].id, first.entries[0].id);
  assert.equal(corrected.entries[0].paragraph, 1);
  const done = h.updateAsr([final('開議')], 10000);
  assert.equal(done.added, 0);
  assert.equal(done.entries[0].interim, false);
  assert.equal(h.updateAsr([final('開議')], 11000).changed, false);
  assert.deepEqual(h.snapshot().map(e => e.text), ['開議']);
});

test('only changed text updates the gap clock, unchanged finalization does not', () => {
  const h = createHistory();
  h.updateAsr([interim('first')], 0);
  h.updateAsr([final('first')], 2900);
  let r = h.updateAsr([final('first'), interim('second')], 3000);
  assert.deepEqual(r.entries.map(e => e.paragraph), [1, 2]);
  h.updateAsr([final('first'), interim('second grows')], 4000);
  r = h.updateAsr([final('first'), final('second grows'), final('third')], 6999);
  assert.deepEqual(r.entries.map(e => e.paragraph), [1, 2, 2]);
});

test('repeated interim does not postpone a gap and corrections never split a result', () => {
  const h = createHistory();
  h.updateAsr([interim('a')], 0);
  h.updateAsr([interim('a')], 2000);
  h.updateAsr([final('a'), interim('b')], 4000);
  h.updateAsr([final('a'), interim('c')], 10000);
  assert.deepEqual(h.snapshot().map(e => e.paragraph), [1, 2]);
});

test('interrupt preserves final text, drops unfinished text, and rejects late callbacks', () => {
  const h = createHistory();
  const old = h.resetRecognition();
  h.updateAsr([final('kept'), interim('unfinished')], 0, old);
  h.interrupt();
  assert.deepEqual(h.snapshot().map(e => e.text), ['kept']);
  assert.equal(h.updateAsr([final('late')], 5000, old).changed, false);
  const current = h.resetRecognition();
  h.updateAsr([final('after pause')], 50000, current);
  assert.equal(h.updateAsr([final('late')], 50001, old).changed, false);
  assert.deepEqual(h.snapshot().map(e => e.paragraph), [1, 1]);
});

test('recognition restart clears cumulative indices without duplicating previous run', () => {
  const h = createHistory();
  let token = h.resetRecognition();
  h.updateAsr([final('one'), final('two')], 0, token);
  token = h.resetRecognition();
  h.updateAsr([final('three')], 20000, token);
  assert.deepEqual(h.snapshot().map(e => e.text), ['one', 'two', 'three']);
  assert.deepEqual(h.snapshot().map(e => e.paragraph), [1, 1, 1]);
});

test('retracted interim disappears rather than becoming invented final text', () => {
  const h = createHistory();
  h.updateAsr([final('one'), interim('two')], 0);
  h.updateAsr([final('one')], 1);
  assert.deepEqual(h.snapshot().map(e => e.text), ['one']);
  h.updateAsr([final('one'), interim('three')], 2);
  h.updateAsr([final('one'), interim('')], 3);
  assert.deepEqual(h.snapshot().map(e => e.text), ['one']);
});

test('VTT gaps use media time rather than delayed or batched delivery', () => {
  const h = createHistory();
  h.appendCue('one', 1, 2, 0);
  h.appendCue('two', 2, 3, 20000);
  h.appendCue('three', 6, 7, 20000);
  assert.deepEqual(h.snapshot().map(e => e.paragraph), [1, 1, 2]);
  assert.equal(h.appendCue('three', 6, 7, 30000).added, 0);
  assert.equal(h.appendCue('late older cue', 0, 1, 30000).added, 0);
  h.interrupt();
  h.appendCue('after buffering', 30, 31, 40000);
  assert.deepEqual(h.snapshot().map(e => e.paragraph), [1, 1, 2, 2]);
});

test('bounded history does not reinsert trimmed cumulative final results', () => {
  const h = createHistory({ maxEntries: 2 });
  h.updateAsr([final('one'), final('two'), final('three')], 0);
  assert.deepEqual(h.snapshot().map(e => e.text), ['two', 'three']);
  h.updateAsr([final('one'), final('two'), final('three'), final('four')], 1);
  assert.deepEqual(h.snapshot().map(e => e.text), ['three', 'four']);
  const copy = h.snapshot(); copy[0].text = 'mutated';
  assert.equal(h.snapshot()[0].text, 'three');
});

test('new text paragraph IDs exclude corrections and finalization, include growth', () => {
  const h = createHistory();
  assert.deepEqual(h.updateAsr([interim('ab')], 0).newTextParagraphs, [1]);
  assert.deepEqual(h.updateAsr([interim('ac')], 1).newTextParagraphs, []);
  assert.deepEqual(h.updateAsr([interim('acd')], 2).newTextParagraphs, [1]);
  assert.deepEqual(h.updateAsr([final('acd')], 4000).newTextParagraphs, []);
  assert.deepEqual(h.updateAsr([final('acd'), interim('next')], 5000).newTextParagraphs, [2]);
});

test('pause does not repeat the current official cue after resume', () => {
  const h = createHistory();
  h.appendCue('one', 1, 2);
  h.interrupt();
  assert.equal(h.appendCue('one', 1, 2).added, 0);
  h.appendCue('two', 20, 21);
  assert.deepEqual(h.snapshot().map(e => e.paragraph), [1, 1]);
});

test('a late pure correction does not conceal a speech gap before the next result', () => {
  const h = createHistory();
  h.updateAsr([interim('cat')], 0);
  h.updateAsr([interim('car')], 2900);
  h.updateAsr([final('car'), interim('next')], 3000);
  assert.deepEqual(h.snapshot().map(e => e.paragraph), [1, 2]);
});

test('final punctuation-only suffix is neither new text nor a clock update', () => {
  for (const suffix of ['。', '！', '、', '...', ' 。']) {
    const h = createHistory();
    h.updateAsr([interim('発言です')], 0);
    const done = h.updateAsr([final('発言です' + suffix)], 2900);
    assert.deepEqual(done.newTextParagraphs, []);
    assert.equal(done.entries[0].text, '発言です' + suffix);
    h.updateAsr([final('発言です' + suffix), interim('次です')], 3000);
    assert.deepEqual(h.snapshot().map(e => e.paragraph), [1, 2]);
  }
});


test('shifted duplicate VTT cues extend timing without adding text or inventing a gap', () => {
  const h = createHistory();
  h.appendCue('one', 1, 2);
  assert.equal(h.appendCue('one', 1.5, 4).added, 0);
  h.appendCue('two', 6.5, 7);
  assert.deepEqual(h.snapshot().map(e => e.paragraph), [1, 1]);
});
