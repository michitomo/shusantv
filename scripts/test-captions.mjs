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
      await page.eval(`window.bubble = t.el.querySelector('.bubble'); window.back = t.el.querySelector('.caption-return');
        Object.defineProperties(bubble, {scrollHeight:{value:1000,configurable:true}, clientHeight:{value:100,configurable:true}});
        clickTile('sid9456');`);
      await check('bubble.getAttribute("tabindex")', '0');
      await page.eval('t.cap.focus(false)');
      await check('bubble.getAttribute("tabindex")', '-1');
      await page.eval('t.cap.focus(true)');
      await check('t.el.getAttribute("tabindex")', '0');
      await page.eval(`window.key=(target,key)=>{const e=new Event('keydown',{bubbles:true,cancelable:true});e.key=key;target.dispatchEvent(e);}; key(t.el,'Enter');`);
      await check('focusedId', null);
      await page.eval("key(t.el,' '); key(back,'Enter');");
      await check('focusedId', 'sid9456');

      if (asr) {
        await page.eval(`t.rec.emit([['初めの発言',true]]); window.firstRow = bubble.firstChild;
          bubble.scrollTop=50; bubble.dispatchEvent(new Event('scroll'));
          t.rec.emit([['初めの発言',true],['議事',false]]);`);
        await check('back.hidden', false);
        await check('back.textContent.includes("新着 1 段落")');
        await check('bubble.scrollTop', 50);
        await page.eval(`t.rec.emit([['初めの発言',true],['議事追加',false]]);
          t.rec.emit([['初めの発言',true],['記事追加',false]]);
          t.rec.emit([['初めの発言',true],['記事追加',true]]);`);
        await check('back.textContent.includes("新着 1 段落")');
        await check('bubble.firstChild === window.firstRow');
        await check('bubble.textContent', '初めの発言、記事追加、');
        harness.state.now += 3001;
        await page.eval(`t.rec.emit([['初めの発言',true],['記事追加',true],['次の段落',false]]);`);
        await check('bubble.children.length', 2);
        await check('back.textContent.includes("新着 2 段落")');
        await page.eval(`back.dispatchEvent(new Event('click',{bubbles:true}));`);
        await check('focusedId', 'sid9456'); // return click must not toggle the tile
        await check('back.hidden');
        await check('bubble.scrollTop', 1000);
        await page.eval(`t.rec.emit([['初めの発言',true],['記事追加',true],['次の段落'+'長'.repeat(200),true]]);`);
        await check('bubble.textContent.startsWith("初めの発言")');
        await check('bubble.textContent.length > 200');

        // Pause, buffering, and seeking invalidate old callbacks without fake gaps.
        for (const event of ['pause', 'waiting', 'seeking']) {
          await page.eval(`window.oldRec=t.rec; t.video.dispatchEvent(new Event('${event}'));`);
          harness.state.now += 60000;
          await page.eval(`window.oldRec.emit([['遅延結果',true]]); t.video.dispatchEvent(new Event('playing')); t.rec.emit([['再開',true]]);`);
          await check('t.rec !== window.oldRec');
          await check('window.oldRec.aborted');
          await check('bubble.children.length', 2);
          await check('bubble.textContent.includes("遅延結果")', false);
        }
        await page.eval(`t.rec.emit([['再開',true],['未確定',false]]); window.oldRec=t.rec; t.rec.onend();`);
        await check('bubble.textContent.includes("未確定")', false);
        harness.state.now += 60000;
        await until('!!t.rec && t.rec !== window.oldRec');
        await page.eval(`window.oldRec.emit([['旧セッション',true]]); t.rec.emit([['再起動後',true]]);`);
        await check('bubble.textContent.includes("旧セッション")', false);
        await check('bubble.children.length', 2);
        await page.eval(`bubble.scrollTop=50; bubble.dispatchEvent(new Event('scroll')); t.cap.focus(false);`);
        await check('back.hidden');
        await check('bubble.scrollTop', 1000);
      } else {
        await page.eval(`window.track=makeCaptionTrack(); t.video.textTracks.push(track);
          const added=new Event('addtrack'); added.track=track; t.video.textTracks.dispatchEvent(added);
          window.cue=(text,startTime,endTime)=>({text,startTime,endTime});
          window.firstCue=cue('公式一',1,2); track.emit([firstCue]);
          track.emit([firstCue]); track.emit([cue('公式一',1.5,2.5)]);`);
        await check('bubble.textContent', '公式一、');
        harness.state.now += 60000;
        await page.eval(`track.emit([cue('公式二',2.5,3)]); track.emit([cue('公式三',6,7)]);`);
        await check('bubble.children.length', 2);
        for (const event of ['pause', 'waiting', 'seeking']) {
          await page.eval(`t.video.dispatchEvent(new Event('${event}')); track.emit([cue('停止中',30,31)]);`);
          await check('bubble.textContent.includes("停止中")', false);
          await page.eval(`track.activeCues=[cue('再開${event}',40,41)]; t.video.dispatchEvent(new Event('playing'));`);
          await check('bubble.children.length', 2);
        }
        await page.eval('window.oldTrack=track');
      }

      // Source replacement keeps the tile but clears captions and old listeners.
      await page.eval('window.oldCap=t.cap; window.oldRec=t.rec; window.oldBubble=bubble;');
      harness.state.uid = `captionchanged${asr ? 'asr' : 'vtt'}001`;
      harness.state.now += 61000;
      await page.eval('refresh()');
      await check('t.cap !== window.oldCap');
      await check('t.el.querySelector(".bubble").textContent', '');
      if (asr) await page.eval(`window.oldRec.emit([['古いソース',true]]);`);
      else await page.eval(`window.oldTrack.emit([cue('古いソース',50,51)]);`);
      await check('t.el.querySelector(".bubble").textContent', '');
      await page.eval(`t.hls.events[Hls.Events.MANIFEST_PARSED]();`);
      if (asr) {
        await page.eval(`t.rec.emit([['新しいソース',true]]); window.lastRec=t.rec;`);
        await check('t.el.querySelector(".bubble").textContent', '新しいソース、');
      }
      await page.eval(`window.lastCap=t.cap; removeTile('sid9456');`);
      await check('t.hls.destroyed');
      await check('t.el.isConnected', false);
      if (asr) {
        await page.eval(`window.lastRec.emit([['削除後',true]]); t.video.dispatchEvent(new Event('playing'));`);
        await check('window.lastRec.aborted');
        await check('window.lastRec.track.stopped');
      } else await page.eval(`window.oldTrack.emit([cue('削除後',60,61)]);`);
      await check('t.el.querySelector(".asr").children.length', 0);
      if (asr) {
        await page.eval(`window.anchorTile={el:document.createElement('div')}; anchorTile.el.innerHTML='<div class="asr"></div>'; document.body.appendChild(anchorTile.el);
          window.anchorCap=createCaption(anchorTile); window.ab=anchorTile.el.querySelector('.bubble');
          Object.defineProperties(ab,{scrollHeight:{value:40000},clientHeight:{value:100}});
          ab.getBoundingClientRect=()=>({top:0,bottom:100});
          window.many=Array.from({length:2000},(_,i)=>({text:'字幕'+i,final:true})); anchorCap.updateAsr(many,0);
          for(const node of ab.querySelectorAll('span')) node.getBoundingClientRect=()=>{const i=[...node.parentNode.children].indexOf(node);return {top:i*20-ab.scrollTop,bottom:(i+1)*20-ab.scrollTop};};
          ab.scrollTop=400; ab.dispatchEvent(new Event('scroll')); window.keptSpan=ab.querySelectorAll('span')[20];
          many.push({text:'字幕2000',final:true}); anchorCap.updateAsr(many,1);`);
        await check('ab.querySelectorAll("span").length', 2000);
        await check('ab.scrollTop', 380);
        await check('window.keptSpan.getBoundingClientRect().top', 0);
        await page.eval('anchorCap.stop(); anchorTile.el.remove();');
      }
      assert.deepEqual(harness.errors, []);
      console.log(`PASS captions (${asr ? 'ASR' : 'VTT'} DOM mocks): history, gaps, lifecycle and cleanup`);
    } finally { await page?.close(); await harness.close(); }
  }
}
