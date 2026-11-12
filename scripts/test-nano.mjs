// On-device (Gemini Nano) proofreading with a fake LanguageModel. No real model,
// download or recognition is involved.
import assert from 'node:assert/strict';
import { createHarness } from './ui-harness.mjs';
import { delay } from './ui-fixture.mjs';
export async function runNanoTests() {
  const harness = await createHarness(false, { asr: true });
  let page;
  const until = async expression => {
    for (let i = 0; i < 300; i++) { if (await page.eval(expression)) return; await delay(10); }
    assert.fail(`Timed out: ${expression}`);
  };
  try {
    page = await harness.open('index.html');
    const check = async (expression, expected = true) => assert.equal(await page.eval(expression), expected, expression);
    await page.eval(`window.nanoCalls = { availability: 0, create: 0, prompts: [] };
      const session = () => ({ clone: async () => session(), destroy() {},
        prompt: async text => { nanoCalls.prompts.push(text); return 'まず、自民党に伺います。\\n答弁は次回の審査会で結構です。'; } });
      window.LanguageModel = {
        availability: async () => { nanoCalls.availability++; return nanoCalls.create ? 'available' : 'downloadable'; },
        create: async options => { nanoCalls.create++; options.monitor({ addEventListener: (_, fn) => fn({ loaded: .5 }) }); return session(); },
      };`);
    await until('tiles.size === 1');
    await page.eval('gate.dispatchEvent(new Event("click"));');
    await until('!!tiles.get("sid9456").rec');
    await page.eval('window.t=tiles.get("sid9456"); clickTile("sid9456");');
    // Opening the page with the default engine never touches the built-in model.
    await check('nanoCalls.availability + nanoCalls.create', 0);
    await check('proofEngine', 'openrouter');
    await check('document.querySelector(".proofread-panel [data-engine=nano]").hidden');

    // Choosing it only asks about availability; the download waits for the button.
    await page.eval('setProofEngine("nano"); void 0;');
    await until('nanoState === "downloadable"');
    await check('localStorage.getItem("shusantv.proofEngine")', 'nano');
    await check('nanoCalls.create', 0);
    await check('proofreadToggle.disabled');
    await check('nanoSetup.hidden', false);
    await check('proofreadStatus.textContent.includes("を押すまでダウンロードしません")');
    await check('document.getElementById("proofScope").textContent', '字幕ログに表示中の会議');
    await page.eval('t.rec.emit([["準備前に確定した二次医療圏ごとの地域医療構想の見直しについて伺います",true]]);');
    await check('nanoCalls.prompts.length', 0);

    await page.eval('nanoSetup.dispatchEvent(new Event("click"));');
    await until('nanoState === "ready"');
    await check('nanoCalls.create', 1);
    await check('nanoSetup.hidden');
    await check('proofreadToggle.disabled', false);
    await check('nanoCalls.prompts.length', 0); // ready is not consent: the toggle is still off
    await page.eval('proofreadToggle.checked=true; proofreadToggle.dispatchEvent(new Event("change"));');

    // Only the stream shown in the caption log is rewritten, on the device.
    await page.eval(`window.other={el:document.createElement('div'),stream:{house:'shugiin',id:'room97',name:'予算委員会'}}; other.el.innerHTML='<div class="asr"></div>';
      window.otherCap=createCaption(other); otherCap.updateAsr([{text:'表示していない会議の二次医療圏ごとの地域医療構想について伺います',final:true}],0);`);
    await check('nanoCalls.prompts.length', 0);
    await page.eval('t.rec.emit([["準備前に確定した二次医療圏ごとの地域医療構想の見直しについて伺います",true],["えまず自民党に伺いますあの答弁は次回の憲法審査会で結構でございます",true]]);');
    await until('nanoCalls.prompts.length === 1');
    await check('nanoCalls.prompts[0].includes("【字幕】\\nえまず自民党に伺いますあの答弁は次回の憲法審査会で結構でございます")');
    await check('nanoCalls.prompts[0].includes("参議院")');
    await until('!!t.cap.panel.querySelector(".caption-corrected:not([hidden])")');
    await check('t.cap.panel.querySelector(".caption-corrected:not([hidden])").textContent', 'まず、自民党に伺います。\n答弁は次回の審査会で結構です。');
    await check('proofreadStatus.textContent.includes("整形 1件")');
    await check('t.cap.tail(100).includes("えまず自民党")'); // watch detection keeps using the original

    // Switching back releases the model and stops using it.
    await page.eval('setProofEngine("openrouter"); void 0;');
    await check('nano.ready', false);
    await check('!!proofreadToggle.checked', false);
    await check('proofreadStatus.textContent', 'BYOKキー未設定');
    // Left ON: coming back to the on-device engine starts ON again, with no click
    // (the model is already downloaded; it is never downloaded on its own).
    await check('localStorage.getItem("shusantv.proofOn")', '1');
    await page.eval('setProofEngine("nano"); void 0;');
    await until('!!proofreadToggle.checked && nano.ready');
    await check('nanoCalls.create', 2);
    // Turned OFF by the viewer: it stays off next time.
    await page.eval('proofreadToggle.checked=false; proofreadToggle.dispatchEvent(new Event("change"));');
    await check('localStorage.getItem("shusantv.proofOn")', '0');
    await page.eval('setProofEngine("openrouter"); window.back=setProofEngine("nano"); void 0;');
    await page.eval('window.back');
    await check('!!proofreadToggle.checked', false);
    // The paid cloud engine is never switched on by a saved choice.
    await page.eval('localStorage.setItem("shusantv.proofOn","1"); window.back=setProofEngine("openrouter"); void 0;');
    await page.eval('window.back');
    await check('!!proofreadToggle.checked', false);
    await page.eval('otherCap.stop();');
    assert.deepEqual(harness.errors, []);
    console.log('PASS on-device proofreading (fake LanguageModel): no download until asked, opt-in, shown stream only, line breaks, release, remembered ON/OFF');
  } finally { await page?.close(); await harness.close(); }
}
