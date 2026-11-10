// Synthetic ASR + fake OpenRouter responses only. Never uses real storage or keys.
import assert from 'node:assert/strict';
import { createHarness } from './ui-harness.mjs';
import { delay } from './ui-fixture.mjs';
export async function runProofreadingTests() {
  const requests = [], pending = [];
  const harness = await createHarness(false, { asr: true,
    storage: { 'shusantv.aicfg': JSON.stringify({ key: 'fixture-key-not-real', model: 'fixture-model', provider: '' }) },
    fetch(url, options, fallback) {
      if (url !== 'https://openrouter.ai/api/v1/chat/completions') return fallback(url, options);
      requests.push({ ...options, body: JSON.parse(options.body) });
      return new Promise(resolve => pending.push(resolve));
    }
  });
  let page;
  const answer = (text, cost = .001) => pending.shift()(Response.json({ choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: { cost } }));
  const until = async condition => {
    for (let i = 0; i < 300; i++) { if (await condition()) return; await delay(10); }
    assert.fail('Timed out');
  };
  try {
    page = await harness.open('index.html');
    const check = async (expression, expected = true) => assert.equal(await page.eval(expression), expected, expression);
    await until(() => page.eval('tiles.size === 1'));
    await page.eval('gate.dispatchEvent(new Event("click"));');
    await until(() => page.eval('!!tiles.get("sid9456").rec'));
    await page.eval('window.t=tiles.get("sid9456"); clickTile("sid9456");');
    await check('proofreadToggle.disabled', false);
    await check('!!proofreadToggle.checked', false);
    await page.eval('t.rec.emit([["過去の確定段落",true]]); t.cap.settle(performance.now()+3001);');
    assert.equal(requests.length, 0, 'saved key alone never sends history');
    await page.eval('proofreadToggle.checked=true; proofreadToggle.dispatchEvent(new Event("change"));');
    assert.equal(requests.length, 0, 'enabling does not backfill');
    await page.eval('t.rec.emit([["過去の確定段落",true],["校正する誤字",false]]); t.cap.settle(performance.now()+3001);');
    assert.equal(requests.length, 0, 'interim is never sent');
    await page.eval('t.rec.emit([["過去の確定段落",true],["校正する誤字",true]]); t.cap.settle(performance.now()+3001);');
    await until(() => requests.length === 1);
    assert.equal(requests[0].headers.Authorization, 'Bearer fixture-key-not-real');
    assert.equal(requests[0].redirect, 'error');
    assert.equal(requests[0].credentials, 'omit');
    assert.equal(requests[0].body.model, 'fixture-model');
    assert.equal(requests[0].body.provider, undefined);
    assert.equal(JSON.stringify(requests[0].body).includes('fixture-key-not-real'), false);
    assert.match(requests[0].body.messages[0].content, /参議院/);
    assert.match(requests[0].body.messages[0].content, /不明/);
    assert.match(requests[0].body.messages[0].content, /2026年11月10日/);
    assert.deepEqual(JSON.parse(requests[0].body.messages[1].content), { text: '校正する誤字' });
    await page.eval('t.cap.settle(performance.now()+10000);');
    assert.equal(requests.length, 1, 'same closed paragraph is not charged twice');
    answer('校正した文章');
    await until(() => page.eval('!!t.el.querySelector(".caption-corrected:not([hidden])")'));
    await check('t.cap.tail(100).includes("校正する誤字")');
    await check('t.cap.tail(100).includes("校正した文章")', false);
    await check('proofreadStatus.textContent.includes("$0.0010")');
    await page.eval('window.row=t.el.querySelectorAll(".bubble p")[1]; row.querySelector("button").click();');
    await check('row.querySelector(".caption-original").hidden', false);
    await check('row.querySelector(".caption-original").textContent', '校正する誤字、');
    await check('focusedId', 'sid9456');

    // Cancelled responses cannot overwrite the original, even when abort is ignored.
    await page.eval('t.rec.emit([["過去の確定段落",true],["校正する誤字",true],["取消する文章",true]]); t.cap.settle(performance.now()+3001);');
    await until(() => requests.length === 2);
    await page.eval('proofreadToggle.checked=false; proofreadToggle.dispatchEvent(new Event("change"));');
    assert.equal(requests[1].signal.aborted, true);
    answer('遅延した不要な返答');
    await delay(0);
    await check('t.el.textContent.includes("遅延した不要な返答")', false);
    await check('t.el.textContent.includes("校正した文章")');
    await check('proofreadStatus.textContent.includes("不明1件")');

    // Error -> explicit retry, then keep original visible while reading history.
    await page.eval('proofreadToggle.checked=true; proofreadToggle.dispatchEvent(new Event("change")); t.rec.emit([["過去の確定段落",true],["校正する誤字",true],["取消する文章",true],["再試行する原文",true]]); t.cap.settle(performance.now()+3001);');
    await until(() => requests.length === 3);
    pending.shift()(new Response('fixture failure', { status: 429 }));
    await until(() => page.eval('t.el.textContent.includes("校正失敗")'));
    assert.equal(requests.length, 3, 'no automatic charged retry');
    await page.eval('window.row=t.el.querySelectorAll(".bubble p")[3]; row.querySelectorAll("button")[1].click();');
    await until(() => requests.length === 4);
    await page.eval('window.bubble=t.el.querySelector(".bubble"); Object.defineProperties(bubble,{scrollHeight:{value:1000},clientHeight:{value:100}}); bubble.scrollTop=100; bubble.dispatchEvent(new Event("scroll"));');
    answer('再試行後の校正案');
    await until(() => page.eval('row.querySelector(".caption-corrected").textContent !== ""'));
    await check('row.querySelector(".caption-original").hidden', false);
    await check('bubble.scrollTop', 100);

    // Settings change revokes consent and pending work without exposing credentials.
    await page.eval('t.rec.emit([["過去の確定段落",true],["校正する誤字",true],["取消する文章",true],["再試行する原文",true],["設定変更の原文",true]]); t.cap.settle(performance.now()+3001);');
    await until(() => requests.length === 5);
    await page.eval('localStorage.removeItem("shusantv.aicfg"); const event=new Event("storage"); event.key="shusantv.aicfg"; window.dispatchEvent(event);');
    await check('!!proofreadToggle.checked', false);
    await check('proofreadToggle.disabled');
    assert.equal(requests[4].signal.aborted, true);
    answer('取り消し済み');
    await delay(0);
    await check('t.el.textContent.includes("取り消し済み")', false);
    await check('document.body.textContent.includes("fixture-key-not-real")', false);
    await check('captionContext({house:"shugiin",name:"衆院会議名確認中",nameConfirmed:false}).name', null);
    await check('captionContext({house:"other",nameConfirmed:false}).house === undefined');
    // Source replacement/removal aborts work and cannot leak responses into another feed.
    await page.eval('localStorage.setItem("shusantv.aicfg",JSON.stringify({key:"fixture-key-not-real",model:"fixture-model",provider:""})); updateProofreadSettings(); proofreadToggle.checked=true;');
    await page.eval('t.rec.emit([["過去の確定段落",true],["校正する誤字",true],["取消する文章",true],["再試行する原文",true],["設定変更の原文",true],["配信切替前",true]]); t.cap.settle(performance.now()+3001); window.oldCap=t.cap;');
    await until(() => requests.length === 6);
    harness.state.uid = 'proofreadingfixturechanged001'; harness.state.now += 61000;
    await page.eval('refresh()');
    await check('oldCap !== t.cap');
    assert.equal(requests[5].signal.aborted, true);
    answer('前の配信の返答'); await delay(0);
    await check('t.el.textContent.includes("前の配信の返答")', false);
    await page.eval('t.hls.events[Hls.Events.MANIFEST_PARSED](); t.rec.emit([["削除前の原文",true]]); t.cap.settle(performance.now()+3001);');
    await until(() => requests.length === 7);
    await page.eval('removeTile("sid9456")');
    assert.equal(requests[6].signal.aborted, true);
    answer('削除後の返答'); await delay(0);
    await check('proofreader.getStats().running', 0);
    await check('proofreadListeners.size', 0);
    await check('t.el.querySelector(".asr").children.length', 0);
    assert.deepEqual(harness.errors, []);
    console.log('PASS proofreading DOM mocks: opt-in, metadata, raw retention, dedupe, fees, cancel, manual retry, reading position, settings/source change, removal');
  } finally { await page?.close(); await harness.close(); }
}
