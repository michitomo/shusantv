// DOM integration only. Scroll geometry, media, AudioContext and SpeechRecognition
// are mocks; this does not verify browser layout, audio capture or real ASR.
import assert from 'node:assert/strict';
import { createHarness } from './ui-harness.mjs';
import { delay } from './ui-fixture.mjs';

export async function runCaptionTests() {
  for (const asr of [true, false]) {
    const harness = await createHarness(false, { captionMedia: true, asr });
    let page;
    try {
      page = await harness.open('index.html');
      const check = async (expression, expected = true) => assert.equal(await page.eval(expression), expected, expression);
      const until = async expression => {
        for (let i = 0; i < 300; i++) {
          if (await page.eval(expression)) return;
          await delay(10);
        }
        assert.fail(`Timed out: ${expression}`);
      };
      await until('tiles.size === 1');
      await check('gate.tagName', 'BUTTON');
      await page.eval(`window.t = tiles.get('sid9456'); t.video.pause(); gate.dispatchEvent(new Event('click'));`);
      await until('!!t.cap');
      if (asr) await check('!!t.rec', false);
      await page.eval('t.video.play()');
      await until(asr ? '!!t.rec' : '!!t.vtt');
      // The side panel follows the audio tile; the on-video bubble is a non-scrolling tail.
      await check('capPanel.hidden', false);
      await check('capBody.firstChild === t.cap.panel');
      await page.eval(`window.rawCaption = root => [...root.querySelectorAll('.caption-original')].map(node => node.textContent).join('');
        window.log = t.cap.panel.querySelector('.cap-log'); window.bubble = t.el.querySelector('.bubble'); window.back = t.cap.panel.querySelector('.cap-return');
        Object.defineProperties(log, {scrollHeight:{value:1000,configurable:true}, clientHeight:{value:100,configurable:true}});
        clickTile('sid9456');`);
      await check('t.el.getAttribute("tabindex")', '0');
      await check('log.getAttribute("tabindex")', '0');
      await check('capSource.children[0].textContent', '音声に追従 — 参 参院・会議名確認中 (sid9456)');
      await page.eval(`window.key=(target,key)=>{const e=new Event('keydown',{bubbles:true,cancelable:true});e.key=key;target.dispatchEvent(e);}; key(t.el,'Enter');`);
      await check('focusedId', null);
      await check('capBody.firstChild === t.cap.panel'); // keeps showing the last stream
      await page.eval("key(t.el,' ');");
      await check('focusedId', 'sid9456');
      await page.eval('capToggle.dispatchEvent(new Event("click"));');
      await check('capPanel.hidden');
      await check('localStorage.getItem("shusantv.captionPanel")', '0');
      await page.eval('capToggle.dispatchEvent(new Event("click"));');
      await check('capToggle.getAttribute("aria-expanded")', 'true');
      await check('capBody.firstChild === t.cap.panel');

      if (asr) {
        await page.eval(`t.rec.emit([['初めの発言',true]]); window.firstRow = log.firstChild;
          log.scrollTop=50; log.dispatchEvent(new Event('scroll'));
          t.rec.emit([['初めの発言',true],['議事',false]]);`);
        await check('back.hidden', false);
        await check('back.textContent.includes("新着 1 段落")');
        await check('log.scrollTop', 50);
        await check('window.firstRow.querySelector("time").textContent', '13:30');
        await check('window.firstRow.querySelector("time").title.startsWith("13:30:00")');
        await page.eval(`t.rec.emit([['初めの発言',true],['議事追加',false]]);
          t.rec.emit([['初めの発言',true],['記事追加',false]]);
          t.rec.emit([['初めの発言',true],['記事追加',true]]);`);
        await check('back.textContent.includes("新着 1 段落")');
        await check('log.firstChild === window.firstRow');
        await check('rawCaption(log)', '初めの発言、記事追加、');
        await check('bubble.textContent', '初めの発言、記事追加、');
        harness.state.now += 3001;
        await page.eval(`t.rec.emit([['初めの発言',true],['記事追加',true],['次の段落',false]]);`);
        await check('log.children.length', 2);
        await check('back.textContent.includes("新着 2 段落")');
        // Karaoke highlight: only the words that just arrived; earlier ones go plain.
        // The previous words fade 500ms after newer ones arrive.
        await check('[...bubble.querySelectorAll(".saying")].map(n => n.textContent).join("|")', '追加、|次の段落');
        await check('[...bubble.querySelectorAll(".said")].map(n => n.textContent).join("")', '初めの発言、記事');
        harness.state.now += 200;
        await page.eval(`t.rec.emit([['初めの発言',true],['記事追加',true],['次の段落です',false]]);`);
        await check('[...bubble.querySelectorAll(".saying")].map(n => n.textContent).join("|")', '追加、|次の段落です');
        harness.state.now += 501;
        await page.eval(`t.rec.emit([['初めの発言',true],['記事追加',true],['次の段落ですが続き',false]]);`);
        await check('[...bubble.querySelectorAll(".saying")].map(n => n.textContent).join("|")', 'ですが続き');
        await check('[...bubble.querySelectorAll(".said")].map(n => n.textContent).join("")', '初めの発言、記事追加、次の段落');
        harness.state.now += 501;
        await page.eval(`t.rec.emit([['初めの発言',true],['記事追加',true],['次の段落',false]]);`);
        await check('bubble.querySelectorAll(".saying").length', 0); // a retraction is not new speech
        await page.eval(`back.dispatchEvent(new Event('click',{bubbles:true}));`);
        await check('focusedId', 'sid9456'); // return click must not toggle the tile
        await check('back.hidden');
        await check('log.scrollTop', 1000);
        await page.eval(`t.rec.emit([['初めの発言',true],['記事追加',true],['次の段落'+'長'.repeat(150),true]]);`);
        await check('rawCaption(log).startsWith("初めの発言")');
        await check('rawCaption(log).length > 150');
        await check('t.cap.text().split("\\n").length', 2);
        await check('t.cap.text().startsWith("[13:30:00] 初めの発言、記事追加、")');

        // Pause, buffering, and seeking invalidate old callbacks without fake gaps.
        for (const event of ['pause', 'waiting', 'seeking']) {
          await page.eval(`window.oldRec=t.rec; t.video.dispatchEvent(new Event('${event}'));`);
          harness.state.now += 60000;
          await page.eval(`window.oldRec.emit([['遅延結果',true]]); t.video.dispatchEvent(new Event('playing')); t.rec.emit([['再開',true]]);`);
          await check('t.rec !== window.oldRec');
          await check('window.oldRec.aborted');
          await check('log.children.length', 2);
          await check('rawCaption(log).includes("遅延結果")', false);
        }
        // A recognizer restart keeps the words already on screen (they used to vanish).
        await page.eval(`t.rec.emit([['再開',true],['未確定',false]]); window.oldRec=t.rec; t.rec.onend();`);
        await check('rawCaption(log).endsWith("未確定、")');
        await check('bubble.textContent.endsWith("未確定、")');
        await check('log.querySelectorAll(".interim").length', 0);
        harness.state.now += 60000;
        await until('!!t.rec && t.rec !== window.oldRec');
        await page.eval(`window.oldRec.emit([['旧セッション',true]]); t.rec.emit([['再起動後',true]]);`);
        await check('rawCaption(log).includes("旧セッション")', false);
        await check('log.children.length', 2);
        // Re-showing the log (panel reopened / stream switched) returns to the live end.
        await page.eval(`log.scrollTop=50; log.dispatchEvent(new Event('scroll'));`);
        await check('back.hidden', false);
        await page.eval(`capToggle.dispatchEvent(new Event("click")); capToggle.dispatchEvent(new Event("click"));`);
        await check('back.hidden');
        await check('log.scrollTop', 1000);
      } else {
        await page.eval(`window.track=makeCaptionTrack(); t.video.textTracks.push(track);
          const added=new Event('addtrack'); added.track=track; t.video.textTracks.dispatchEvent(added);
          window.cue=(text,startTime,endTime)=>({text,startTime,endTime});
          window.firstCue=cue('公式一',1,2); track.emit([firstCue]);
          track.emit([firstCue]); track.emit([cue('公式一',1.5,2.5)]);`);
        await check('rawCaption(log)', '公式一、');
        harness.state.now += 60000;
        await page.eval(`track.emit([cue('公式二',2.5,3)]); track.emit([cue('公式三',6,7)]);`);
        await check('log.children.length', 2);
        await check('bubble.querySelectorAll("p").length', 2);
        await check('bubble.hidden', false);
        for (const event of ['pause', 'waiting', 'seeking']) {
          await page.eval(`t.video.dispatchEvent(new Event('${event}')); track.emit([cue('停止中',30,31)]);`);
          await check('rawCaption(log).includes("停止中")', false);
          await page.eval(`track.activeCues=[cue('再開${event}',40,41)]; t.video.dispatchEvent(new Event('playing'));`);
          await check('log.children.length', 2);
        }
        await page.eval('window.oldTrack=track');
      }

      // Source replacement keeps the tile, restarts the live bubble and drops old listeners.
      // The day's log survives it (reloaded from the store) above the new text.
      await page.eval('window.oldCap=t.cap; window.oldRec=t.rec; window.before=t.cap.text();');
      harness.state.uid = `captionchanged${asr ? 'asr' : 'vtt'}001`;
      harness.state.now += 61000;
      await page.eval('refresh()');
      await check('t.cap !== window.oldCap');
      await check('window.oldCap.panel.isConnected', false);
      await check('capBody.firstChild === t.cap.panel');
      await check('t.el.querySelector(".bubble").textContent', '');
      await until('t.cap.text() === window.before');
      if (asr) await page.eval(`window.oldRec.emit([['古いソース',true]]);`);
      else await page.eval(`window.oldTrack.emit([cue('古いソース',50,51)]);`);
      await check('t.cap.text().includes("古いソース")', false);
      await page.eval(`t.hls.events[Hls.Events.MANIFEST_PARSED]();`);
      if (asr) {
        await page.eval(`t.rec.emit([['新しいソース',true]]); window.lastRec=t.rec;`);
        await check('t.el.querySelector(".bubble").textContent', '新しいソース、');
        await check('t.cap.text().slice(window.before.length)', '\n[13:35:05] 新しいソース、');
        // Clearing forgets the stream's log on screen and in the store.
        await page.eval(`capButtons[2].dispatchEvent(new Event('click'));`);
        await check('t.cap.size > 0');
        await page.eval(`capButtons[2].dispatchEvent(new Event('click'));`);
        await check('t.cap.size', 0);
        await check('t.el.querySelector(".bubble").textContent', '');
        await page.eval(`window.restored=null; captionStore.load('sangiin:sid9456').then(r => { window.restored=r.length; });`);
        await until('window.restored === 0');
        await page.eval(`t.rec.emit([['新しいソース',true],['消去後',true]]);`);
        await check('t.cap.text()', '[13:35:05] 消去後、');
      }
      // A pinned stream stays in the panel regardless of the audio tile.
      await page.eval(`showCaptions('sid9456'); focusedId=null; applyFocus();`);
      await check('capBody.firstChild === t.cap.panel');
      await page.eval(`window.lastCap=t.cap; removeTile('sid9456');`);
      await check('t.hls.destroyed');
      await check('t.el.isConnected', false);
      await check('capPinned', '');
      await check('capBody.firstChild === capEmpty');
      await check('capButtons[0].disabled');
      if (asr) {
        await page.eval(`window.lastRec.emit([['削除後',true]]); t.video.dispatchEvent(new Event('playing'));`);
        await check('window.lastRec.aborted');
        await check('window.lastRec.track.stopped');
      } else await page.eval(`window.oldTrack.emit([cue('削除後',60,61)]);`);
      await check('t.el.querySelector(".asr").children.length', 0);
      if (asr) {
        // A long sitting: the log keeps everything, the bubble only the tail.
        await page.eval(`window.longTile={el:document.createElement('div'),stream:{house:'shugiin',id:'room99',name:'予算委員会'}}; longTile.el.innerHTML='<div class="asr"></div>';
          window.longCap=createCaption(longTile); window.many=Array.from({length:5000},(_,i)=>({text:'字幕'+i,final:true}));
          longCap.updateAsr(many,0); many.push({text:'字幕5000',final:true}); longCap.updateAsr(many,1);`);
        await check('longCap.panel.querySelectorAll(".caption-original > span").length', 5001);
        await check('longTile.el.querySelectorAll(".bubble span").length <= 12');
        // Long unbroken speech is cut into readable paragraphs instead of one block.
        await check('longCap.panel.querySelectorAll(".cap-row").length > 100');
        await check('longCap.tail(6)', '字幕5000');
        // Restored rows from another meeting in the same room are separated by its name.
        await page.eval(`longCap.stop(); longTile.stream.name='決算委員会'; window.nextCap=createCaption(longTile); nextCap.updateAsr([{text:'次の会議',final:true}],0);`);
        await until('nextCap.panel.querySelectorAll(".cap-row").length > 100');
        await check('nextCap.panel.querySelector(".cap-divider").textContent', '決算委員会');
        await check('nextCap.text().split("\\n").slice(-2).join("|")', '— 決算委員会 —|[13:35:05] 次の会議、');
        await page.eval('nextCap.stop();');
      }
      assert.deepEqual(harness.errors, []);
      console.log(`PASS captions (${asr ? 'ASR' : 'VTT'} DOM mocks): side-panel log, timestamps, gaps, lifecycle, day store and cleanup`);
    } finally { await page?.close(); await harness.close(); }
  }
}
