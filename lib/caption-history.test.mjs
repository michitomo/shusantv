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
  const h = createHistory({ gapMs: 3000 });
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

test('interrupt keeps the text already shown and rejects late callbacks', () => {
  const h = createHistory();
  const old = h.resetRecognition();
  h.updateAsr([final('kept'), interim('unfinished')], 0, old);
  const stopped = h.interrupt();
  assert.equal(stopped.changed, true);
  assert.deepEqual(stopped.updated.map(e => [e.text, e.interim]), [['unfinished', false]]);
  assert.deepEqual(h.snapshot().map(e => e.text), ['kept', 'unfinished']);
  assert.equal(h.interrupt().changed, false);
  assert.equal(h.updateAsr([final('late')], 5000, old).changed, false);
  const current = h.resetRecognition();
  h.updateAsr([final('after pause')], 50000, current);
  assert.equal(h.updateAsr([final('late')], 50001, old).changed, false);
  assert.deepEqual(h.snapshot().map(e => e.paragraph), [1, 1, 1]);
});

test('results report only what changed, with viewing timestamps and a cheap tail', () => {
  let wall = 1000;
  const h = createHistory({ maxEntries: 3, clock: () => wall });
  const first = h.updateAsr([interim('あ')], 0);
  assert.deepEqual(first.updated.map(e => [e.text, e.at]), [['あ', 1000]]);
  wall = 2000;
  const second = h.updateAsr([final('あい'), interim('う')], 10);
  assert.deepEqual(second.updated.map(e => [e.text, e.interim, e.at]), [['あい', false, 1000], ['う', true, 2000]]);
  assert.deepEqual(second.removed, []);
  const retracted = h.updateAsr([final('あい')], 20);
  assert.deepEqual([retracted.updated, retracted.removed], [[], [second.updated[1].id]]);
  assert.equal(h.updateAsr([final('あい')], 30).changed, false);
  const trimmed = h.updateAsr([final('あい'), final('か'), final('き'), final('く')], 40);
  assert.deepEqual(trimmed.removed, [first.updated[0].id]);
  assert.deepEqual(trimmed.updated.map(e => e.text), ['か', 'き', 'く']);
  assert.equal(h.tail(2), 'きく');
  assert.equal(h.tail(100), 'かきく');
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
    assert.equal(done.entries[0].text, ('発言です' + suffix).replace(' ', '')); // spaces before Japanese punctuation are joined
    h.updateAsr([final('発言です' + suffix), interim('次です')], 3000);
    assert.deepEqual(h.snapshot().map(e => e.paragraph), [1, 2]);
  }
});


test('shifted duplicate VTT cues extend timing without adding text or inventing a gap', () => {
  const h = createHistory({ gapMs: 3000 });
  h.appendCue('one', 1, 2);
  assert.equal(h.appendCue('one', 1.5, 4).added, 0);
  h.appendCue('two', 6.5, 7);
  assert.deepEqual(h.snapshot().map(e => e.paragraph), [1, 1]);
});

test('settle seals only final active ASR paragraphs after the genuine-text gap', () => {
  const h = createHistory();
  const token = h.resetRecognition();
  h.updateAsr([interim('first')], 0, token);
  assert.deepEqual(h.settle(3000, token).closedParagraphs, []);
  const finalized = h.updateAsr([final('first')], 4000, token);
  assert.deepEqual(finalized.newTextParagraphs, []);
  assert.deepEqual(finalized.closedParagraphs, []);
  const before = h.snapshot();
  assert.deepEqual(h.settle(4000, token).closedParagraphs, [1]);
  assert.deepEqual(h.snapshot(), before);
  assert.deepEqual(h.settle(5000, token).closedParagraphs, []);
});

test('genuine growth delays settlement, punctuation and replacement corrections do not', () => {
  const h = createHistory({ gapMs: 3000 });
  h.updateAsr([interim('a')], 0);
  h.updateAsr([interim('ab')], 2000);
  h.updateAsr([interim('ac')], 4000);
  const done = h.updateAsr([final('ac。')], 4999);
  assert.deepEqual(done.newTextParagraphs, []);
  assert.deepEqual(h.settle(4999).closedParagraphs, []);
  assert.deepEqual(h.settle(5000).closedParagraphs, [1]);
});

test('a new paragraph seals its all-final predecessor exactly once', () => {
  const h = createHistory();
  h.updateAsr([final('one')], 0);
  const next = h.updateAsr([final('one'), interim('two')], 3000);
  assert.deepEqual(next.closedParagraphs, [1]);
  assert.deepEqual(next.entries.map(e => e.paragraph), [1, 2]);
  assert.deepEqual(h.updateAsr([final('one'), final('two')], 3001).closedParagraphs, []);
  assert.deepEqual(h.settle(6000).closedParagraphs, [2]);
});

test('an older paragraph with interim text stays open until it becomes final', () => {
  const h = createHistory();
  h.updateAsr([interim('one')], 0);
  assert.deepEqual(h.updateAsr([interim('one'), interim('two')], 3000).closedParagraphs, []);
  assert.deepEqual(h.updateAsr([final('one'), interim('two')], 3001).closedParagraphs, [1]);
});

test('interrupt and restart never settle text and stale timer tokens are ignored', () => {
  const h = createHistory();
  const old = h.resetRecognition();
  h.updateAsr([final('one'), interim('unfinished')], 0, old);
  assert.deepEqual(h.interrupt().closedParagraphs, []);
  assert.deepEqual(h.settle(10000, old).closedParagraphs, []);
  const current = h.resetRecognition();
  assert.deepEqual(h.settle(10000, current).closedParagraphs, []);
  h.updateAsr([final('two')], 10000, current);
  assert.deepEqual(h.settle(13000, old).closedParagraphs, []);
  assert.deepEqual(h.settle(13000, current).closedParagraphs, [1]);
});

test('new ASR entries cannot append to a sealed paragraph even across restart', () => {
  for (const restart of [false, true]) {
    const h = createHistory();
    let token = h.resetRecognition();
    h.updateAsr([final('one')], 0, token);
    h.settle(3000, token);
    if (restart) token = h.resetRecognition();
    const result = h.updateAsr(restart ? [final('two')] : [final('one'), final('two')], 3001, token);
    assert.deepEqual(result.entries.map(e => e.paragraph), [1, 2]);
    assert.deepEqual(result.closedParagraphs, []);
    assert.deepEqual(h.settle(6001, token).closedParagraphs, [2]);
  }
});

test('bounded history only emits retained paragraph closures over many restarts', () => {
  const h = createHistory({ maxEntries: 2 });
  for (let i = 0; i < 1000; i++) {
    const token = h.resetRecognition();
    const result = h.updateAsr([final(String(i))], i * 4000, token);
    assert.ok(result.entries.length <= 2);
    assert.deepEqual(result.closedParagraphs, []);
    assert.deepEqual(h.settle(i * 4000 + 3000, token).closedParagraphs, [i + 1]);
  }
  assert.deepEqual(h.snapshot().map(e => e.paragraph), [999, 1000]);
});

test('official captions do not emit ASR paragraph closures', () => {
  const h = createHistory();
  assert.deepEqual(h.appendCue('one', 1, 2).closedParagraphs, []);
  assert.deepEqual(h.appendCue('two', 6, 7).closedParagraphs, []);
  assert.deepEqual(h.settle(100000).closedParagraphs, []);
});

test('default gap is 1.5 seconds for both splitting and settling', () => {
  const h = createHistory();
  assert.equal(h.gapMs, 1500);
  h.updateAsr([final('one')], 0);
  assert.deepEqual(h.settle(1499).closedParagraphs, []);
  assert.deepEqual(h.settle(1500).closedParagraphs, [1]);
  h.updateAsr([final('one'), final('two')], 1600);
  assert.deepEqual(h.snapshot().map(e => e.paragraph), [1, 2]);
});

test('a finished sentence closes a long enough ASR paragraph without waiting for a pause', () => {
  const h = createHistory({ sentenceChars: 10 });
  // Too short: stays open for the next words.
  assert.deepEqual(h.updateAsr([final('はい。')], 0).closedParagraphs, []);
  // Recognizer punctuation or a sentence-final form (shown with 。) both count.
  let r = h.updateAsr([final('はい。'), final('それでは質疑に入ります')], 100);
  assert.deepEqual(r.closedParagraphs, [1]);
  assert.deepEqual(h.settle(5000).closedParagraphs, [], 'never closed twice');
  // The words after the sentence start a new paragraph even with no gap.
  r = h.updateAsr([final('はい。'), final('それでは質疑に入ります'), interim('まず地域医療構想について')], 200);
  assert.deepEqual(r.entries.map(e => e.paragraph), [1, 1, 2]);
  assert.deepEqual(r.closedParagraphs, []);
  // A clause that does not end a sentence waits; the sentence end then closes both.
  r = h.updateAsr([final('はい。'), final('それでは質疑に入ります'), final('まず地域医療構想について')], 300);
  assert.deepEqual(r.closedParagraphs, []);
  r = h.updateAsr([final('はい。'), final('それでは質疑に入ります'), final('まず地域医療構想について'), final('伺います'), interim('次に')], 400);
  assert.deepEqual(r.closedParagraphs, [2]);
  assert.deepEqual(r.entries.map(e => e.paragraph), [1, 1, 2, 2, 3]);
});

test('unfinished text and official cues are never closed as sentences', () => {
  const h = createHistory({ sentenceChars: 1 });
  assert.deepEqual(h.updateAsr([interim('検討してまいります')], 0).closedParagraphs, []);
  assert.deepEqual(h.interrupt().closedParagraphs, []);
  const cues = createHistory({ sentenceChars: 1 });
  assert.deepEqual(cues.appendCue('検討してまいります。', 1, 2).closedParagraphs, []);
});

test('space-separated recognizer output is joined, Latin words keep their spaces', () => {
  const h = createHistory();
  const r = h.updateAsr([final('自民 党 は 2012 年 の 草案 で は 9 条 2 項 を 削除 し、'), interim('AI act の 議論 を メンタル ヘルス 対策')], 0);
  assert.deepEqual(r.entries.map(e => e.text), ['自民党は2012年の草案では9条2項を削除し、', 'AI actの議論をメンタルヘルス対策']);
  assert.equal(h.tail(6), 'ルヘルス対策');
  // Re-sending the same spaced text is not a change.
  assert.equal(h.updateAsr([final('自民 党 は 2012 年 の 草案 で は 9 条 2 項 を 削除 し、'), interim('AI act の 議論 を メンタル ヘルス 対策')], 10).changed, false);
});

test('a long finalized run ends the paragraph even without a sentence end', () => {
  const h = createHistory({ paragraphChars: 20 });
  // Short and unfinished: the paragraph stays open.
  assert.deepEqual(h.updateAsr([final('自民党は2012年の')], 0).closedParagraphs, []);
  const long = '草案では9条2項を削除し自衛権の行使には何らの制約も';
  const r = h.updateAsr([final('自民党は2012年の'), final(long), interim('ないように')], 10);
  assert.deepEqual(r.closedParagraphs, [1]);
  assert.deepEqual(r.entries.map(e => e.paragraph), [1, 1, 2]);
  // Still interim: length alone never closes it.
  assert.deepEqual(h.updateAsr([final('自民党は2012年の'), final(long), interim('ないように規定したと説明していましたしかし2018年には')], 20).closedParagraphs, []);
});

test('sentences the engine punctuated are split out of a result that is still growing', () => {
  const h = createHistory();
  const said = 'え両党は正反対の方向に案を変えたと我々には見えております。';
  // Punctuation at the very end may still be revised: wait for words to follow it.
  assert.deepEqual(h.updateAsr([interim(said)], 0).closedParagraphs, []);
  const r = h.updateAsr([interim(said + 'まそこでまず')], 100);
  assert.deepEqual(r.closedParagraphs, [1]);
  assert.deepEqual(r.entries.map(e => [e.paragraph, e.text, e.interim]), [[1, said, false], [2, 'まそこでまず', true]]);
  // The rest keeps growing in its own paragraph; the closed one is not touched again.
  const next = h.updateAsr([interim(said + 'まそこでまず最初に自民党に伺います。あの答弁は')], 200);
  assert.deepEqual(next.entries.map(e => e.text), [said, 'まそこでまず最初に自民党に伺います。', 'あの答弁は']);
  assert.deepEqual(next.closedParagraphs, [2]);
  assert.equal(next.updated.some(e => e.text === said), false);
  // Finalizing the whole result adds nothing twice.
  const done = h.updateAsr([final(said + 'まそこでまず最初に自民党に伺います。あの答弁は次回で結構です。')], 300);
  assert.deepEqual(done.entries.map(e => e.text), [said, 'まそこでまず最初に自民党に伺います。', 'あの答弁は次回で結構です。']);
  assert.deepEqual(done.entries.map(e => e.interim), [false, false, false]);
});

test('word endings alone never split a result; short sentences, rewording and restarts are handled', () => {
  const { sentenceCut } = createRequire(import.meta.url)('../public/caption-history.js');
  // No engine punctuation: nothing is guessed from 「ます」「です」 (ますます, ですから…).
  for (const text of ['ますます重要になっておりますそこでまず自民党に伺います次に', 'これは次回に対応するということでよろしいでしょうかあるいは皆さんの'])
    assert.equal(sentenceCut(text, 5, 4), 0, text);
  const plain = createHistory();
  plain.updateAsr([interim('両党は正反対の方向に案を変えたと見えておりますそこでまず自民党に伺いますあの答弁は次回で')], 0);
  assert.deepEqual(plain.snapshot().map(e => e.paragraph), [1]);
  assert.equal(sentenceCut('よろしいでしょうか？あるいは皆さんの', 5, 4), 10);
  assert.equal(sentenceCut('はい。ありがとうございます次に', 15, 4), 0, 'too short to stand alone');
  assert.equal(sentenceCut('はい。どうもありがとうございます。次に移ります', 15, 4), 17);
  // The recognizer rewords text that was already split off: the shown sentence stays.
  const h = createHistory();
  h.updateAsr([interim('両党は正反対の方向に案を変えたと見えております。そこでまず')], 0);
  const r = h.updateAsr([interim('両党は正反対の方向に案を替えたと見えております。そこでまず自民党に')], 100);
  assert.deepEqual(r.entries.map(e => e.text), ['両党は正反対の方向に案を変えたと見えております。', 'そこでまず自民党に']);
  // A new recognition run starts from its own text.
  const token = h.resetRecognition();
  const again = h.updateAsr([interim('新しい認識の最初の発言でございます。そして次の話題は')], 5000, token);
  assert.deepEqual(again.entries.slice(-2).map(e => e.text), ['新しい認識の最初の発言でございます。', 'そして次の話題は']);
});

test('pending counts unfinished text; close ends the paragraph the recognizer was made to finalize', () => {
  const h = createHistory();
  const token = h.resetRecognition();
  assert.equal(h.pending(), 0);
  h.updateAsr([interim('大臣のご所見をいただければと思い')], 0, token);
  assert.equal(h.pending(), 16);
  // Not closable while text is unfinished.
  assert.deepEqual(h.close().closedParagraphs, []);
  // The page stops the recognizer at a pause: it returns the final text, then ends.
  h.updateAsr([final('大臣のご所見をいただければと思いますが')], 100, token);
  assert.equal(h.pending(), 0);
  h.interrupt();
  assert.deepEqual(h.close().closedParagraphs, [1]);
  assert.deepEqual(h.close().closedParagraphs, [], 'only once');
  // The restarted recognizer begins a new paragraph even though no time has passed.
  const next = h.resetRecognition();
  const r = h.updateAsr([interim('野田大臣')], 150, next);
  assert.deepEqual(r.entries.map(e => [e.paragraph, e.text]), [[1, '大臣のご所見をいただければと思いますが'], [2, '野田大臣']]);
  // Official cues are never closed this way.
  const cues = createHistory();
  cues.appendCue('公式字幕の一文です。', 1, 2);
  assert.deepEqual([cues.pending(), cues.close().closedParagraphs], [0, []]);
});
