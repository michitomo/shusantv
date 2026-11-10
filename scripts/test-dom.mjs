// Optional DOM regression tests: npm install --no-save linkedom
// node scripts/test-dom.mjs (no browser or network; layout/media are mocked).
import assert from "node:assert/strict";
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
 sandbox={document,console,Date:ClockDate,Intl,URL,URLSearchParams,AbortController,AbortSignal,fetch:fetchMock,Response,Blob,TextDecoder,TextEncoder,performance,Map,Set,Promise,Hls:hls,Event:dom.Event,
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
 test=await harness('transcript.html','?id=sid9456');
 for(let i=0;i<100&&!test.document.querySelector('.cue');i++)await delay(10);
 assert.equal(test.document.querySelectorAll('.cue').length,1);
 assert.equal(test.eval('select.value'),'sid9456');
 assert.match(test.eval('entries.get("sid9456").name'),/確認中/);
 assert.equal(test.eval('entries.has("sid65535")'),false);
 test.eval('window.originalSession=session; document.getElementById("summary").textContent="保存中の要約";');
 listed=true;listingFails=false;now+=61000;await test.eval('refreshMeetings()');
 assert.equal(test.eval('select.value'),'sid9456');
 assert.equal(test.eval('entries.get("sid9456").name'),'総務委員会');
 assert.equal(test.eval('session===window.originalSession'),true);
 assert.equal(test.document.getElementById('summary').textContent,'保存中の要約');
 active=false;vod=true;now+=61000;await test.eval('refreshMeetings()');
 assert.equal(test.document.querySelectorAll('option[value="sid9456"]').length,1);
 assert.equal(test.eval('session===window.originalSession'),true);
 vod=false;listed=false;now+=61000;await test.eval('refreshMeetings()');
 assert.equal(test.eval('select.value'),'sid9456');
 assert.equal(test.eval('entries.get("sid9456").retained'),true);
 assert.equal(test.document.querySelectorAll('.cue').length,1);
 test.eval('select.value="";select.onchange();');assert.equal(test.eval('session'),null);
 console.log('PASS transcript DOM: discovery on listing failure, deep link, sentinel rejection, label update, selected session/summary retained, VOD dedupe, explicit deselection');
 test.close();test=null;
 active=true;listingFails=true;uid=U;
 test=await harness('index.html');
 for(let i=0;i<100&&!test.document.querySelector('.tile');i++)await delay(10);
 assert.equal(test.document.querySelectorAll('.tile').length,1);
 // LinkeDOM media has no play method, so set focus without invoking media playback.
 test.eval('focusedId="sid9456";window.originalTile=tiles.get("sid9456");');
 listed=true;listingFails=false;now+=61000;await test.eval('refresh()');
 assert.match(test.document.querySelector('.nfull').textContent,/総務委員会/);
 assert.equal(test.eval('focusedId'),'sid9456');
 assert.equal(test.eval('tiles.get("sid9456")===window.originalTile'),true);
 uid='browserfixtureprogram002';now+=61000;await test.eval('refresh()');
 assert.equal(test.eval('tiles.get("sid9456").hls.sources.length'),2);
 assert.equal(test.eval('focusedId'),'sid9456');
 active=false;now+=61000;await test.eval('refresh()');
 assert.equal(test.document.querySelectorAll('.tile').length,0);
 console.log('PASS grid DOM: detection on listing failure, label update, focus retained, HLS source updated, explicit idle removes tile');
} finally {test?.close();}
