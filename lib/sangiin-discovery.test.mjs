import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const api = require('../public/sangiin-discovery.js');
const { candidateFromInfo, channelHash, mergeStreams, transcriptEntries, createDiscovery, sameDayListing, startPolling } = api;
const NOW = Date.parse('2026-11-10T04:30:00Z');
const H = api.SEED_CHANNELS[0], U = 'abc123program456xyz';
const stamp = t => new Date(t).toISOString();
const info = (status = {}, extra = {}) => ({ config: { published: 'public' }, status: { output: 'active', program_id: 9456, program_uid: U, program_start: stamp(NOW - 3600000), date: stamp(NOW), latest_pts: stamp(NOW), subtitle: 'active', ...status }, ...extra });
const candidate = () => candidateFromInfo(H, info(), NOW);
const listing = (extra = {}) => ({ updatedAt: stamp(NOW), streams: [], vod: [], ...extra });
const response = value => ({ ok: true, json: async () => value });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('candidate pins exact program URL and explicitly marks name unconfirmed', () => {
 const s = candidate();
 assert.equal(s.id, 'sid9456'); assert.equal(s.nameConfirmed, false); assert.match(s.name, /確認中/);
 assert.equal(s.m3u8, `https://sangiin-live.live.ipcasting.jp/live/${H}.h/${U}/index.m3u8`);
 assert.equal(s.subtitleAvailable, true);
});
test('reject inactive, test, malformed, private, expired and future metadata', () => {
 for (const status of [{output:false},{output:'false'},{output:'inactive'},{program_id:0},{program_id:65535},{program_id:'no'}, {program_id:1.5},{program_uid:'../bad'}, {program_uid:''}, {date:stamp(NOW-120001)}, {date:stamp(NOW+30001)}, {latest_pts:stamp(NOW-120001)}, {program_start:stamp(NOW+30001)}, {program_start:'bad'}, {program_start:'2026-11-09T01:00:00Z'}]) assert.equal(candidateFromInfo(H, info(status), NOW), null, JSON.stringify(status));
 assert.equal(candidateFromInfo('../bad', info(), NOW), null);
 assert.equal(candidateFromInfo(H, info({}, {config:{published:'private'}}), NOW), null);
 assert.equal(candidateFromInfo(H, info({}, {config:undefined}), NOW), null);
 assert.equal(candidateFromInfo(H, info({}, {schedules:[{status:{program_uid:U,program_end:stamp(NOW)}}]}), NOW), null);
});
test('JST listing day ignores Shugiin session date but enforces Sangiin date', () => {
 assert.equal(sameDayListing(listing({sessionDate:'2026-11-09'}),NOW),true);
 assert.equal(sameDayListing(listing({sangiinSessionDate:'2026-11-09'}),NOW),false);
 assert.equal(sameDayListing(listing({updatedAt:stamp(NOW+30001)}),NOW),false);
 assert.equal(sameDayListing({updatedAt:'invalid'},NOW),false);
 const midnight=Date.parse('2026-11-10T15:00:00Z');
 assert.equal(sameDayListing({updatedAt:stamp(midnight-1)},midnight),false);
});
test('learn hashes only from exact HTTPS CDN origin, never lookalike or credentials', () => {
 assert.equal(channelHash(candidate()),H);
 for(const url of [`http://sangiin-live.live.ipcasting.jp/live/${H}.h/a`, `https://sangiin-live.live.ipcasting.jp.evil.test/live/${H}.h/a`, `https://user@sangiin-live.live.ipcasting.jp/live/${H}.h/a`, `https://evil.test/live/${H}.h/a`]) assert.equal(channelHash({m3u8:url}),null);
});
test('merge names by same-day sid, not reusable channel; checked idle removes old source', () => {
 const old = {...candidate(),id:'sid1111',name:'旧委員会'};
 const data=listing({streams:[old,{house:'sangiin',id:'sid9456',name:'正式委員会'}]});
 const disc={streams:[candidate()],checkedChannels:new Set([H])};
 const merged=mergeStreams(data,[old],disc,NOW);
 assert.equal(merged.length,1); assert.equal(merged[0].name,'正式委員会'); assert.equal(merged[0].nameConfirmed,true);
 assert.match(mergeStreams({...data,updatedAt:'2026-11-09T00:00:00Z'},[],disc,NOW)[0].name,/確認中/);
 assert.deepEqual(mergeStreams(data,[old],{streams:[],checkedChannels:new Set()},NOW),[old]);
 assert.deepEqual(mergeStreams(data,[old],{streams:[],checkedChannels:new Set([H])},NOW),[]);
});
test('transcript deduplicates VOD/live, excludes pending/no-caption and retains selected when absent', () => {
 const live=candidate(), vod={house:'sangiin',id:live.id,name:'録画',hash:'vod'};
 const data=listing({vod:[vod]});
 const entries=transcriptEntries(data,[live,{...live,id:'sid2',pending:true},{...live,id:'sid3',subtitleAvailable:false}],null,NOW);
 assert.equal(entries.size,1);assert.equal(entries.get(live.id).live,true);
 const selected={...live,live:true};
 const retained=transcriptEntries(listing(),[],selected,NOW).get(live.id);
 assert.equal(retained.retained,true);assert.equal(retained.m3u8,selected.m3u8);
 assert.equal(transcriptEntries(data,[],selected,NOW).get(live.id).live,false);
 assert.equal(transcriptEntries({...data,updatedAt:'2026-11-09T00:00:00Z'},[],null,NOW).size,0);
});
test('discovery caps concurrency at three, validates and bounds learned channels, persists safe hashes', async () => {
 let active=0,max=0; const calls=[]; let stored;
 const discovery=createDiscovery({now:()=>NOW,storage:{getItem:()=>JSON.stringify(['../bad']),setItem:(_,v)=>stored=JSON.parse(v)},fetch:async(url,opts)=>{calls.push(url);assert.equal(opts.credentials,'omit');assert.equal(opts.cache,'no-store');max=Math.max(max,++active);await delay(2);active--;return response(info());}});
 const hashes=Array.from({length:45},(_,i)=>`channelhash${String(i).padStart(5,'0')}`);
 const result=await discovery.poll(listing({sangiinChannels:[...hashes,'../bad']}));
 assert.equal(calls.length,32);assert.equal(max,3);assert.equal(result.checkedChannels.size,32);assert.equal(stored.length,32);assert.ok(stored.every(h=>/^[a-z0-9]{12,64}$/.test(h)));
});
test('discovery coalesces concurrent polls and backs off failures 60/120/240/300 seconds', async () => {
 let now=NOW,calls=0;
 const discovery=createDiscovery({now:()=>now,storage:null,fetch:async()=>{calls++;await delay(1);throw Error('network');}});
 await Promise.all([discovery.poll({}),discovery.poll({})]);assert.equal(calls,2);
 for(const [advance,expected] of [[59999,2],[1,4],[119999,4],[1,6],[239999,6],[1,8],[299999,8],[1,10]]){now+=advance;await discovery.poll({});assert.equal(calls,expected);}
});
test('timeouts abort requests; expired cached metadata no longer counts as checked', async () => {
 let now=NOW,fail=false;
 const discovery=createDiscovery({now:()=>now,storage:null,timeoutMs:5,fetch:async(_,opts)=>{
 if(!fail)return response(info());
 return new Promise((_,reject)=>opts.signal.addEventListener('abort',()=>reject(Error('abort')),{once:true}));
 }});
 assert.equal((await discovery.poll({})).streams.length,2);
 fail=true;now+=60000;
 assert.equal((await discovery.poll({})).streams.length,2);
 now+=60001;
 const result=await discovery.poll({});assert.equal(result.streams.length,0);assert.equal(result.checkedChannels.size,0);
});
test('fresh malformed metadata is a failed check, not trustworthy idle', async () => {
 for(const bad of [{status:{date:stamp(NOW)}},info({}, {config:undefined}),info({output:undefined}),info({program_uid:undefined}),info({}, {config:{published:''}}),info({program_uid:'..'}),info({program_uid:'bad'})]) {
 const discovery=createDiscovery({now:()=>NOW,storage:null,fetch:async()=>response(bad)});
 const result=await discovery.poll({});
 assert.equal(result.checkedChannels.size,0,JSON.stringify(bad));
 const source=candidate();assert.equal(mergeStreams(listing(),[source],result,NOW).length,1);
 }
});
test('fresh valid idle is checked and stale metadata is not', async () => {
 for(const [value,count] of [[info({output:'inactive'}),2],[info({date:stamp(NOW-120001)}),0]]) {
 const discovery=createDiscovery({now:()=>NOW,storage:null,fetch:async()=>response(value)});
 const result=await discovery.poll({});assert.equal(result.streams.length,0);assert.equal(result.checkedChannels.size,count);
 }
});
test('polling pauses in hidden tab, resumes immediately, does not overlap, and cleans up', async () => {
 const listeners=new Map();const doc={hidden:true,addEventListener:(k,v)=>listeners.set(k,v),removeEventListener:k=>listeners.delete(k)};
 let calls=0,active=0,max=0;
 const stop=startPolling(async()=>{calls++;max=Math.max(max,++active);await delay(8);active--;},doc,5);
 try {
 await delay(12);assert.equal(calls,0);
 doc.hidden=false;listeners.get('visibilitychange')();listeners.get('visibilitychange')();
 await delay(3);assert.equal(calls,1);
 doc.hidden=true;listeners.get('visibilitychange')();await delay(18);assert.equal(calls,1);
 doc.hidden=false;listeners.get('visibilitychange')();await delay(3);assert.equal(calls,2);assert.equal(max,1);
 } finally {stop();}
 assert.equal(listeners.size,0);await delay(20);assert.equal(calls,2);
});
test('replacement program on same channel gets a new exact identity without stale name', async () => {
 let now=NOW,current=info();
 const discovery=createDiscovery({now:()=>now,storage:null,fetch:async()=>response(current)});
 const first=await discovery.poll({});
 const original=first.streams[0];
 now+=60000;current=info({program_id:9457,program_uid:'replacementprogram987',date:stamp(now),latest_pts:stamp(now)});
 const second=await discovery.poll({});
 const result=mergeStreams(listing({streams:[{...original,name:'前の委員会'}]}),[original],second,now);
 assert.equal(result.length,1);assert.equal(result[0].id,'sid9457');assert.match(result[0].name,/確認中/);assert.match(result[0].m3u8,/replacementprogram987\/index/);
});
test('a malformed response preserves recent successful channel state rather than overwriting it', async () => {
 let now=NOW,current=info();
 const discovery=createDiscovery({now:()=>now,storage:null,fetch:async()=>response(current)});
 const first=await discovery.poll({});assert.equal(first.streams.length,2);
 now+=60000;current={status:{date:stamp(now)}};
 const second=await discovery.poll({});assert.equal(second.streams.length,2);
 assert.equal(second.streams[0].programUid,U);
});
