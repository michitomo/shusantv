// Optional DOM regression tests: npm install --no-save linkedom
// node scripts/test-dom.mjs (no browser or network; layout/media are mocked).
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { parseHTML } = require(process.env.LINKEDOM_PATH || "linkedom");
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
const H = "cpl6pa5632pig7l1fg4g", U = "browserfixtureprogram001";
let now = Date.parse("2026-11-10T04:30:00Z"), listed = false, listingFails = true, active = true, uid = U, vod = false;
const stamp = (n = now) => new Date(n).toISOString();
const base = () => `https://sangiin-live.live.ipcasting.jp/live/${H}.h/${uid}`;
const entry = () => ({ house: "sangiin", id: "sid9456", name: "総務委員会", time: "13:00", m3u8: `${base()}/index.m3u8`, channelInfo: `${base()}/channel-info.json` });
const meta = (test = false) => ({ config: { published: "public" }, status: { output: active ? "active" : "inactive", program_id: test ? 65535 : 9456, program_uid: uid, program_start: stamp(now - 1800000), date: stamp(), latest_pts: stamp(), subtitle: "active" }, schedules: [] });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
const json = o => new Response(JSON.stringify(o), {status:200, headers:{"content-type":"application/json"}});
const fetchMock = async value => {
 const u = new URL(value, "https://test.local/");
 if (u.pathname === "/streams.json") return listingFails ? new Response("fail",{status:503}) : json({updatedAt:stamp(),sessionDate:"2026-11-10",streams:listed&&!vod?[entry()]:[],vod:vod?[{house:"sangiin",id:"sid9456",name:"総務委員会",hash:"vodfixture"}]:[]});
 if (u.hostname === "hlslive.shugiintv.go.jp") return new Response("",{status:404});
 if (u.pathname.endsWith("channel-info.json")) return json(meta(!u.pathname.includes(H)));
 if (u.pathname.endsWith("index.m3u8")) return new Response('#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,URI="subtitles.m3u8"\n');
 if (u.pathname.endsWith("subtitles.m3u8")) return new Response('#EXTM3U\n#EXTINF:4,\none.vtt\n#EXT-X-ENDLIST\n');
 if (u.pathname.endsWith("one.vtt")) return new Response('WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n最新の発言です\n');
 throw new Error(`Unexpected request ${u}`);
};
async function harness(file, search = "") {
 const html = await readFile(path.join(publicDir,file),"utf8");
 const {document,window:dom} = parseHTML(html);
 // LinkeDOM has no browser select.value setter or layout/media implementation.
 const select=document.getElementById("meeting");
 if(select) Object.defineProperty(select,"value",{configurable:true,get(){return this.querySelector('option[selected]')?.getAttribute('value')||"";},set(v){for(const o of this.querySelectorAll('option')){if(o.getAttribute('value')===v)o.setAttribute('selected','');else o.removeAttribute('selected');}}});
 Object.defineProperty(document,"hidden",{value:false,writable:true});
 let sandbox;
 dom.HTMLElement.prototype.getBoundingClientRect=function(){const i=[...document.querySelectorAll('.cue')].indexOf(this);return {top:(i<0?0:i*34)-sandbox.scrollY,bottom:(i<0?34:(i+1)*34)-sandbox.scrollY,height:34,width:800};};
 Object.defineProperty(document.body,"scrollHeight",{get:()=>document.querySelectorAll('.cue').length*34+200});
 const timers=new Set(), intervals=new Set(), store=new Map();
 const wrapTimeout=(f,t)=>{const id=setTimeout(()=>{timers.delete(id);f();},t);timers.add(id);return id;};
 const hls=class {static Events={MANIFEST_PARSED:'manifest',LEVEL_SWITCHED:'level',ERROR:'error',SUBTITLE_TRACKS_UPDATED:'subs'};constructor(){this.sources=[];this.events={};this.levels=[{bitrate:300000}];this.subtitleTracks=[];this.subtitleTrack=-1;}on(e,f){this.events[e]=f;}loadSource(u){this.sources.push(u);}attachMedia(){}destroy(){this.destroyed=true;}};
 const location = {href:`https://test.local/${file}${search}`, pathname:`/${file}`,search};
 sandbox={crypto:webcrypto, Uint8Array, document,console,Date:ClockDate,Intl,URL,URLSearchParams,AbortController,AbortSignal,fetch:fetchMock,Response,Blob,TextDecoder,TextEncoder,performance,Map,Set,Promise,Hls:hls,Event:dom.Event,
 localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},location,history:{replaceState(_,__,url){location.href=String(url);}},navigator:{},innerHeight:768,innerWidth:1024,scrollY:0,scrollX:0,
 scrollTo:(x,y)=>{sandbox.scrollY=typeof x==='object'?x.top:y;},addEventListener(){},removeEventListener(){},requestAnimationFrame:f=>wrapTimeout(()=>f(performance.now()),0),cancelAnimationFrame:id=>clearTimeout(id),
 setTimeout:wrapTimeout,clearTimeout:id=>{clearTimeout(id);timers.delete(id);},setInterval:(f,t)=>{const id=setInterval(f,t);intervals.add(id);return id;},clearInterval:id=>{clearInterval(id);intervals.delete(id);}};
 sandbox.window=sandbox;
 const ctx=vm.createContext(sandbox);
 for(const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
  if(m[1].includes('type="module"'))continue;
  const src=m[1].match(/src="([^"]+)"/);
  if(src?.[1].startsWith('http'))continue;
  const code=src?await readFile(path.join(publicDir,src[1]),'utf8'):m[2];
  vm.runInContext(code,ctx,{filename:src?.[1]||file});
 }
 return {document,ctx,eval:s=>vm.runInContext(s,ctx),close:()=>{for(const t of timers)clearTimeout(t);for(const t of intervals)clearInterval(t);}};
}
let test;
try {
 test = await harness('transcript.html', '?id=sid9456');
 for (let i=0;i<100&&!test.document.querySelector('.cue');i++) await delay(10);
 test.eval(`window.scrollBy = (x,y) => { window.scrollY += y; };
   clearTimeout(session.renderTimer); session.renderTimer=null;
   session.cues = [{t:100,end:102,text:"latest match"}];
   document.getElementById("follow").checked=false;
   reconcileCues(session);
   window.keptRow = session.cues[0].row;
   window.keptRow.dataset.annotation = "keep";
   window.scrollY=20;
   document.getElementById("summary").textContent="preserved summary";
   session.cues = shusantvTranscript.mergeCues(session.cues,[{t:10,end:12,text:"old match"}]);
   reconcileCues(session);`);
 assert.equal(test.eval('window.scrollY'),54,'prepend preserves visible cue offset');
 assert.equal(test.eval('session.cues[1].row === window.keptRow'),true);
 assert.equal(test.eval('session.cues[1].row.dataset.annotation'),'keep');
 assert.equal(test.document.getElementById('summary').textContent,'preserved summary');
 test.eval(`document.getElementById("filter").value="match";
   for(const row of transcriptEl.querySelectorAll(".cue"))applyFilterToRow(row,"match");
   session.cues = shusantvTranscript.mergeCues(session.cues,[{t:50,end:52,text:"middle match"},{t:1,end:2,text:"hidden"}]);
   reconcileCues(session);`);
 assert.equal(test.document.querySelectorAll('.cue mark').length,3);
 assert.equal(test.document.querySelectorAll('.cue.hidden').length,1);
 assert.deepEqual([...test.document.querySelectorAll('.cue .txt')].map(n=>n.textContent),['hidden','old match','middle match','latest match']);
 test.eval(`document.getElementById("follow").checked=true; reconcileCues(session);`);
 assert.equal(test.eval('window.scrollY'),test.document.body.scrollHeight);
 test.eval(`document.getElementById("transcript").hidden=true;window.scrollY=9;
   session.cues=shusantvTranscript.mergeCues(session.cues,[{t:150,end:152,text:"new"}]);reconcileCues(session);`);
 assert.equal(test.eval('window.scrollY'),9,'background transcript does not scroll summary');
 test.eval(`localStorage.setItem(CFG_KEY, JSON.stringify({key:"fixture",model:"fixture"}));
   window.summaryCalls=0; window.summaryPending=[];
   callChunk=async cues => { window.summaryCalls++; await new Promise(r=>window.summaryPending.push(r)); return {qa:[],turns:[],cost:0}; };
   session.cues=[{t:1,end:2,text:"first snapshot"}];
   window.summaryFirst=summarize(); window.summaryDuplicate=summarize();`);
 for(let i=0;i<100&&!test.eval('window.summaryCalls');i++)await delay(5);
 assert.equal(test.eval('window.summaryCalls'),1,'duplicate paid summary blocked');
 test.eval('refreshAiBtn()'); assert.equal(test.document.getElementById('aiBtn').disabled,true);
 test.eval('window.summaryPending.shift()()'); await test.eval('window.summaryFirst');
 test.eval('session.cues=[{t:9,end:10,text:"different same-size snapshot"}];window.summarySecond=summarize()');
 for(let i=0;i<100&&test.eval('window.summaryCalls')<2;i++)await delay(5);
 assert.equal(test.eval('window.summaryCalls'),2,'different same-size snapshot cannot reuse summary cache');
 test.eval('window.summaryPending.shift()()'); await test.eval('window.summarySecond');
 assert.equal(test.eval('session.summarizing'),false);
 console.log('PASS transcript incremental DOM: chronological prepend, retained nodes/annotations/summary, scroll anchor, follow, filter, hidden summary scroll, summary fingerprint and duplicate guard');
} finally {test?.close();}
