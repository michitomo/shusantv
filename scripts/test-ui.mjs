// Offline regression tests. Add --browser for Chromium; numeric layout checks use DOM mode.
import assert from 'node:assert/strict';
import { createHarness } from './ui-harness.mjs';
import { delay } from './ui-fixture.mjs';
import { runCaptionTests } from './test-captions.mjs';
import { runProofreadingTests } from './test-proofreading.mjs';
import { runNanoTests } from './test-nano.mjs';
const browserMode = process.argv.includes('--browser');
const harness = await createHarness(browserMode), { state } = harness;
let page;
const check = async (expression, expected = true) => assert.deepEqual(await page.eval(expression), expected, expression);
async function until(condition) {
  for (let i = 0; i < 500; i++) { if (await page.eval(condition)) return; await delay(10); }
  assert.fail(`Timed out: ${condition}`);
}
async function refresh(changes, expression) {
  Object.assign(state, changes);
  state.now += 61000;
  await page.tick();
  await page.eval(expression);
}
try {
  page = await harness.open('transcript.html', '?id=sid9456');
  await until("document.querySelector('.cue') !== null");
  await check("document.querySelectorAll('.cue').length", 1);
  await check('select.value', 'sid9456');
  await check('entries.get("sid9456").name.includes("確認中")');
  await check('entries.has("sid65535")', false);
  await page.eval('window.originalSession=session; document.getElementById("summary").textContent="保存中の要約";');
  await refresh({ listed: true, listingFails: false }, 'refreshMeetings()');
  await check('select.value', 'sid9456');
  await check('entries.get("sid9456").name', '総務委員会');
  await check('session === window.originalSession');
  await check("document.getElementById('summary').textContent", '保存中の要約');
  await refresh({ active: false, vod: true }, 'refreshMeetings()');
  await check(`document.querySelectorAll('option[value="sid9456"]').length`, 1);
  await check('session === window.originalSession');
  await refresh({ vod: false, listed: false }, 'refreshMeetings()');
  await check('select.value', 'sid9456');
  await check('entries.get("sid9456").retained');
  await check("document.querySelectorAll('.cue').length", 1);
  await page.eval('select.value=""; select.dispatchEvent(new Event("change"));');
  await check('session', null);
  await check('window.originalSession.alive', false);
  await check("document.getElementById('summary').textContent", '');
  await check("['dlTxt','dlVtt','aiBtn'].every(id => document.getElementById(id).disabled)");
  console.log('PASS listing: discovery/deep link, sentinel rejection, label update, session/summary retention, VOD dedupe, deselect cleanup');
  await page.close();

  Object.assign(state, { active: true, listingFails: true });
  page = await harness.open('index.html');
  await until("document.querySelector('.tile') !== null");
  await check("document.querySelectorAll('.tile').length", 1);
  if (!browserMode) await check('!!tiles.get("sid9456").stopCaptions');
  // LinkeDOM has no media playback; Chromium exercises the actual focus click handler.
  await page.eval(browserMode ? 'clickTile("sid9456")' : 'focusedId="sid9456"');
  await page.eval('window.originalTile=tiles.get("sid9456");');
  await refresh({ listed: true, listingFails: false }, 'refresh()');
  await check("document.querySelector('.nfull').textContent.includes('総務委員会')");
  await check('focusedId', 'sid9456');
  await check('tiles.get("sid9456") === window.originalTile');
  await refresh({ uid: 'browserfixtureprogram002' }, 'refresh()');
  await check('tiles.get("sid9456").hls.sources.length', 2);
  await check('focusedId', 'sid9456');
  await refresh({ active: false }, 'refresh()');
  await check("document.querySelectorAll('.tile').length", 0);
  console.log('PASS grid: listing failure, labels, focus/tile retention, HLS source update, idle removal');
  await page.close();
  page = null;

  if (!browserMode) {
    Object.assign(state, { active: true, listingFails: true });
    page = await harness.open('transcript.html', '?id=sid9456');
    await until("document.querySelector('.cue') !== null");
    await page.eval(`clearTimeout(session.renderTimer); session.renderTimer=null;
      session.cues=[{t:100,end:102,text:"latest match"}];
      document.getElementById("follow").checked=false;
      reconcileCues(session);
      window.keptRow=session.cues[0].row; window.keptRow.dataset.annotation="keep";
      window.scrollY=20;
      document.getElementById("summary").textContent="preserved summary";
      session.cues=shusantvTranscript.mergeCues(session.cues,[{t:10,end:12,text:"old match"}]);
      reconcileCues(session);`);
    await check('window.scrollY', 54);
    await check('session.cues[1].row === window.keptRow');
    await check('session.cues[1].row.dataset.annotation', 'keep');
    await check("document.getElementById('summary').textContent", 'preserved summary');
    await page.eval(`document.getElementById("filter").value="match";
      for(const row of transcriptEl.querySelectorAll(".cue")) applyFilterToRow(row,"match");
      session.cues=shusantvTranscript.mergeCues(session.cues,[{t:50,end:52,text:"middle match"},{t:1,end:2,text:"hidden"}]);
      reconcileCues(session);`);
    await check("document.querySelectorAll('.cue mark').length", 3);
    await check("document.querySelectorAll('.cue.hidden').length", 1);
    assert.deepEqual(Array.from(await page.eval("[...document.querySelectorAll('.cue .txt')].map(n=>n.textContent)")), ['hidden','old match','middle match','latest match']);
    await page.eval('document.getElementById("follow").checked=true; reconcileCues(session);');
    await check('window.scrollY === document.body.scrollHeight');
    await page.eval(`document.getElementById("transcript").hidden=true; window.scrollY=9;
      session.cues=shusantvTranscript.mergeCues(session.cues,[{t:150,end:152,text:"new"}]); reconcileCues(session);`);
    await check('window.scrollY', 9);
    await page.eval(`localStorage.setItem(CFG_KEY,JSON.stringify({key:"fixture",model:"fixture"}));
      window.summaryCalls=0; window.summaryPending=[];
      callChunk=async () => { window.summaryCalls++; await new Promise(r=>window.summaryPending.push(r)); return {qa:[],turns:[],cost:0}; };
      session.cues=[{t:1,end:2,text:"first snapshot"}];
      window.summaryFirst=summarize(); summarize(); void 0;`);
    await until('window.summaryCalls > 0');
    await check('window.summaryCalls', 1);
    await page.eval('refreshActions()');
    await check("document.getElementById('aiBtn').disabled");
    await page.eval('window.summaryPending.shift()();');
    await page.eval('window.summaryFirst');
    await page.eval('session.cues=[{t:9,end:10,text:"different same-size snapshot"}]; window.summarySecond=summarize(); void 0;');
    await until('window.summaryCalls === 2');
    await page.eval('window.summaryPending.shift()();');
    await page.eval('window.summarySecond');
    await check('session.summarizing', false);
    console.log('PASS transcript: chronological prepend, retained rows/annotations, scroll anchor/follow/filter, hidden summary, snapshot cache, duplicate guard');
  }
  assert.deepEqual(harness.errors, []);
} finally { await page?.close(); await harness.close(); }

if (!browserMode) { await runCaptionTests(); await runProofreadingTests(); await runNanoTests(); }
