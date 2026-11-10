// Optional UI regression smoke tests: npm install --no-save playwright
// Then: node scripts/test-browser.mjs (uses CHROMIUM_PATH if supplied).
// Network is mocked: no live streams, OpenRouter requests, or user credentials.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const { chromium } = createRequire(import.meta.url)("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
const H = "cpl6pa5632pig7l1fg4g", U = "browserfixtureprogram001";
let now = Date.parse("2026-11-10T04:30:00Z");
let listed = false, listingFails = true, active = true, uid = U, vod = false;
const stamp = (n = now) => new Date(n).toISOString();
const entry = () => ({ house: "sangiin", id: "sid9456", name: "総務委員会", time: "13:00", m3u8: `https://sangiin-live.live.ipcasting.jp/live/${H}.h/${uid}/index.m3u8`, channelInfo: `https://sangiin-live.live.ipcasting.jp/live/${H}.h/${uid}/channel-info.json` });
const metadata = (test = false) => ({ config: { published: "public" }, status: {
 output: active ? "active" : "inactive", program_id: test ? 65535 : 9456, program_uid: uid,
 program_start: stamp(now - 1800000), date: stamp(), latest_pts: stamp(), subtitle: "active",
}, schedules: [] });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] });
const context = await browser.newContext();
const errors = [];
const hls = `window.Hls = class {static Events={MANIFEST_PARSED:'manifest',LEVEL_SWITCHED:'level',ERROR:'error',SUBTITLE_TRACKS_UPDATED:'subs'}; constructor(){this.events={};this.sources=[];this.levels=[{bitrate:300000}];this.subtitleTracks=[];this.subtitleTrack=-1;} on(e,f){this.events[e]=f;} loadSource(s){this.sources.push(s);} attachMedia(v){} destroy(){this.destroyed=true;} };`;
await context.route("**/*", async route => {
 const url = new URL(route.request().url());
 const cors = { "Access-Control-Allow-Origin": "*" };
 if (url.hostname === "test.local") {
  if (url.pathname === "/streams.json") {
   if (listingFails) return route.fulfill({ status: 503, body: "temporary fixture failure" });
   return route.fulfill({ json: { updatedAt: stamp(), sessionDate: "2026-11-10", streams: listed && !vod ? [entry()] : [], vod: vod ? [{house:"sangiin", id:"sid9456", name:"総務委員会",hash:"vodfixture"}] : [] } });
  }
  const f = path.join(root, url.pathname === "/" ? "index.html" : url.pathname);
  return route.fulfill({ body: await readFile(f), contentType: f.endsWith(".js") ? "text/javascript" : "text/html" });
 }
 if (url.hostname === "cdn.jsdelivr.net") return route.fulfill({ body: url.pathname.includes("hls.js") ? hls : "export const loadDefaultJapaneseParser=()=>({parse:s=>[s]});", contentType:"text/javascript", headers:cors });
 if (url.hostname === "hlslive.shugiintv.go.jp") return route.fulfill({ status:404, headers:cors });
 if (url.hostname === "sangiin-live.live.ipcasting.jp") {
  if (url.pathname.endsWith("channel-info.json")) return route.fulfill({ json:metadata(!url.pathname.includes(H)), headers:cors });
  if (url.pathname.endsWith("index.m3u8")) return route.fulfill({ body:'#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,URI="subtitles.m3u8"\n', headers:cors });
  if (url.pathname.endsWith("subtitles.m3u8")) return route.fulfill({body:'#EXTM3U\n#EXTINF:4,\none.vtt\n#EXT-X-ENDLIST\n',headers:cors});
  if (url.pathname.endsWith("one.vtt")) return route.fulfill({body:'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n最新の発言です\n',headers:cors});
 }
 return route.abort();
});
async function pageAt(url) {
 const page = await context.newPage();
 page.on("pageerror", e => errors.push(String(e)));
 await page.clock.install({time:new Date(now)});
 await page.goto(`https://test.local${url}`);
 return page;
}
async function tick(page, fn) {
 now += 61000;
 await page.clock.setFixedTime(new Date(now));
 await page.evaluate(fn);
}
try {
 const page = await pageAt("/transcript.html?id=sid9456");
 await page.waitForFunction(() => document.querySelectorAll(".cue").length === 1);
 assert.match(await page.locator("#meeting option:checked").textContent(), /確認中/);
 assert.equal(await page.locator('#meeting option[value="sid65535"]').count(),0);
 await page.evaluate("window.originalSession=session; document.querySelector('#summary').textContent='保存中の要約';");
 listed = true; listingFails = false;
 await tick(page, "refreshMeetings()");
 assert.equal(await page.locator("#meeting").inputValue(),"sid9456");
 assert.match(await page.locator("#meeting option:checked").textContent(),/総務委員会/);
 assert.equal(await page.evaluate("session===window.originalSession"),true);
 assert.equal(await page.locator("#summary").textContent(),"保存中の要約");
 active = false; vod = true;
 await tick(page, "refreshMeetings()");
 assert.equal(await page.locator('#meeting option[value="sid9456"]').count(),1);
 assert.equal(await page.evaluate("session===window.originalSession"),true);
 vod = false; listed = false;
 await tick(page, "refreshMeetings()");
 assert.equal(await page.locator('#meeting option[value="sid9456"]').count(),1);
 assert.equal(await page.locator("#meeting").inputValue(),"sid9456");
 assert.equal(await page.locator(".cue").count(),1);
 await page.selectOption("#meeting", "");
 assert.equal(await page.evaluate("session"),null);
 console.log("PASS transcript: failed listing discovery, late deep link, test-stream rejection, label update, selected transcript/summary retention, VOD dedupe, explicit deselection");
 await page.close();
 active = true; listingFails = true; uid = U;
 const grid = await pageAt("/");
 await grid.waitForFunction(() => document.querySelectorAll(".tile").length === 1);
 await grid.evaluate("clickTile('sid9456'); window.originalTile=tiles.get('sid9456');");
 listed = true; listingFails = false;
 await tick(grid, "refresh()");
 assert.match(await grid.locator(".nfull").textContent(),/総務委員会/);
 assert.equal(await grid.evaluate("focusedId"),"sid9456");
 assert.equal(await grid.evaluate("tiles.get('sid9456')===window.originalTile"),true);
 uid = "browserfixtureprogram002";
 await tick(grid,"refresh()");
 assert.equal(await grid.evaluate("tiles.get('sid9456').hls.sources.length"),2);
 assert.equal(await grid.evaluate("focusedId"),"sid9456");
 active = false;
 await tick(grid,"refresh()");
 assert.equal(await grid.locator(".tile").count(),0);
 assert.deepEqual(errors,[]);
 console.log("PASS grid: discovery despite listing failure, confirmed label without recreation, focus preserved, source refresh, explicit idle removes tile, no JS errors");
 await grid.close();
} finally { await browser.close(); }
