import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { createProofreader, chunks, acceptable } = createRequire(import.meta.url)('../public/nano.js');

const speech = 'え自民党は2012年の会見草案では9条2項を削除しえ自衛権の行使には何らの制約もないように規定したと説明していましたえしかし2018年には2校を維持して自衛隊を明記する案に転じました一方の維新は令和4年には自民党の同じ自衛隊案でしたが昨年9月に2項削除に転じたと認識をしておりますえ両党は正反対の方向に案を変えたと我々には見えておりますまそこでまず自民党に伺いますあの答弁は次回の審査会で結構です'.repeat(4);

function fakeModel({ state = 'downloadable', reply = text => text.split('【字幕】\n')[1] + '。' } = {}) {
  const calls = { availability: 0, create: [], prompts: [], destroyed: 0 };
  const session = () => ({
    async clone() { return session(); },
    async prompt(text, { signal } = {}) {
      calls.prompts.push(text);
      const output = await reply(text);
      if (signal?.aborted) throw new Error('aborted');
      return output;
    },
    destroy() { calls.destroyed++; },
  });
  return { calls, model: {
    async availability(options) { calls.availability++; calls.languages = options; return state; },
    async create(options) { calls.create.push(options); options.monitor?.({ addEventListener: (_, fn) => fn({ loaded: 1 }) }); return session(); },
  } };
}
const settled = () => new Promise(resolve => setTimeout(resolve, 0));

test('long speech is cut at sentence ends into pieces a small model can handle', () => {
  const parts = chunks(speech);
  assert.equal(parts.join(''), speech);
  assert.ok(parts.length >= 3);
  for (const part of parts) assert.ok(part.length <= 480, `piece of ${part.length}`);
  for (const part of parts.slice(0, -1)) assert.match(part, /(ます|ました|です|でした|ません)$/);
  assert.deepEqual(chunks('短い発言です'), ['短い発言です']);
});

test('a rewrite that drops or invents much text is rejected', () => {
  assert.equal(acceptable('えまず自民党に伺いますあの答弁は次回で結構です', 'まず、自民党に伺います。答弁は次回で結構です。'), true);
  assert.equal(acceptable('えまず自民党に伺いますあの答弁は次回で結構です', '自民党に質問。'), false);
  assert.equal(acceptable('伺います', '伺います。なお、これは憲法審査会での発言であり、背景には長年の議論があります。'), false);
});

test('checking availability never creates a session, so nothing is downloaded until asked', async () => {
  const { calls, model } = fakeModel();
  const nano = createProofreader({ getModel: () => model });
  assert.equal(await nano.availability(), 'downloadable');
  assert.deepEqual(calls.languages.expectedInputs, [{ type: 'text', languages: ['ja'] }]);
  assert.equal(calls.create.length, 0);
  const events = [];
  const idle = createProofreader({ getModel: () => model, onChange: event => events.push(event.status) });
  idle.submit({ id: 'a', text: '準備前の文章です' });
  await settled();
  assert.deepEqual(events, ['queued', 'error']);
  assert.equal(calls.create.length, 0);
  assert.equal(await createProofreader({ getModel: () => undefined }).availability(), 'unavailable');
});

test('prepare creates one Japanese session with the instructions first, and reports progress', async () => {
  const { calls, model } = fakeModel();
  const nano = createProofreader({ getModel: () => model });
  const progress = [];
  await Promise.all([nano.prepare(value => progress.push(value)), nano.prepare()]);
  assert.equal(calls.create.length, 1);
  assert.equal(calls.create[0].initialPrompts[0].role, 'system');
  assert.deepEqual(calls.create[0].expectedOutputs, [{ type: 'text', languages: ['ja'] }]);
  assert.deepEqual(progress, [1]);
  assert.equal(nano.ready, true);
  assert.equal(await nano.availability(), 'ready');
});

test('each piece is rewritten in a fresh clone; rejected pieces keep the original text', async () => {
  let turn = 0;
  const { calls, model } = fakeModel({ reply: text => ++turn === 2 ? '要約しました。' : '整形：' + text.split('【字幕】\n')[1] });
  const events = [];
  const nano = createProofreader({ getModel: () => model, onChange: event => events.push(event) });
  await nano.prepare();
  nano.submit({ id: 'p1', text: speech, context: { house: '衆議院', name: '憲法審査会', date: '2026年11月12日' } });
  while (events.at(-1)?.status !== 'done') await settled();
  const parts = chunks(speech);
  assert.equal(calls.prompts.length, parts.length);
  assert.match(calls.prompts[0], /^【会議】衆議院 憲法審査会 2026年11月12日\n【字幕】\n/);
  assert.equal(calls.destroyed, parts.length);
  assert.equal(events.at(-1).correctedText, parts.map((part, i) => i === 1 ? part : '整形：' + part).join(''));
  assert.equal(events.at(-1).cost, 0);
  assert.equal(nano.submit({ id: 'p1', text: speech, context: { house: '衆議院', name: '憲法審査会', date: '2026年11月12日' } }), false, 'same text is not redone');
});

test('nothing acceptable is an error, and cancelled work never reports a result', async () => {
  const { model } = fakeModel({ reply: () => '短い' });
  const events = [];
  const nano = createProofreader({ getModel: () => model, onChange: event => events.push(`${event.id}:${event.status}`) });
  await nano.prepare();
  nano.submit({ id: 'bad', text: 'この文章は十分に長い発言の文字起こしです' });
  while (!events.includes('bad:error')) await settled();
  let release;
  const slow = fakeModel({ reply: () => new Promise(resolve => { release = () => resolve('取り消された後の返答です、十分な長さ'); }) });
  const later = [];
  const other = createProofreader({ getModel: () => slow.model, onChange: event => later.push(event.status) });
  await other.prepare();
  other.submit({ id: 'x', text: '取り消される文章です、十分な長さ' });
  await settled();
  other.cancel('x');
  release();
  await settled();
  assert.deepEqual(later, ['queued', 'running', 'cancelled']);
});
