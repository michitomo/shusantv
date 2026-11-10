// 衆参の開催中会議一覧スクレイピングと m3u8 解決。
// ローカルサーバ (server.js) と GitHub Actions (scripts/scrape.mjs) の双方から使う。
import { createRequire } from "node:module";
const { day, knownChannels } = createRequire(import.meta.url)("../public/sangiin-discovery.js");
const UA = "Mozilla/5.0 (shusantv viewer)";

async function fetchText(url, encoding = "utf-8") {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = await res.arrayBuffer();
  return new TextDecoder(encoding).decode(buf);
}

// ページ先頭の JS が示す「今日」(JST)。一覧の部屋→委員会は当日分だけ有効。
export function shugiinSessionDate(html) {
  const y = html.match(/var jsty='(\d{4})'/);
  const mo = html.match(/var jstm='(\d{2})'/);
  const d = html.match(/var jstd='(\d{2})'/);
  if (!y || !mo || !d) return null;
  return `${y[1]}-${mo[1]}-${d[1]}`;
}

// 衆議院: 「今日の審議中継」の中継中行だけから room_id と会議名を取る。
// 部屋番号は委員会に固定ではない（room17 は 2026-10-28 文部科学、2026-11-05 内閣）。
// 行をまたいで次の room と前の会議名を結ぶと、予定行があるだけで別委員会の名前が付く。
export function parseShugiinLive(html) {
  const todayEnd = html.search(/id="tomorrow"/);
  const head = todayEnd >= 0 ? html.slice(0, todayEnd) : html;
  const todayStart = head.search(/id="today"/);
  const section = todayStart >= 0 ? head.slice(todayStart) : head;
  const streams = [];
  for (const rowM of section.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = rowM[1];
    if (!/class="play_live"/.test(row)) continue;
    const roomM = row.match(/room_id=(room\d+)/);
    if (!roomM) continue;
    const roomId = roomM[1];
    const texts = [...row.matchAll(/class="s12_14"[^>]*>\s*([^<]*?)\s*</g)]
      .map((m) => m[1].replace(/^[\s\u3000]+/, "").trim())
      .filter(Boolean);
    const time = texts.find((t) => /^\d{1,2}:\d{2}$/.test(t)) ?? "";
    const name = texts.find((t) => !/^\d{1,2}:\d{2}$/.test(t));
    if (!name) continue;
    streams.push({
      house: "shugiin",
      id: roomId,
      name,
      time,
      m3u8: `https://hlslive.shugiintv.go.jp/${roomId}/amlst:${roomId}/playlist.m3u8`,
    });
  }
  return streams;
}

export async function getShugiinLive() {
  const html = await fetchText("https://www.shugiintv.go.jp/jp/index.php", "euc-jp");
  return { sessionDate: shugiinSessionDate(html), streams: parseShugiinLive(html) };
}

function sangiinListing() {
  return fetchText(`https://www.webtv.sangiin.go.jp/webtv/result_selecter.php?mode=today_reload&absdate=${day(Date.now())}`);
}

async function resolveSangiin(entries, parseDetail) {
  const results = await Promise.all(entries.map(async ({ sid, ...entry }) => {
    try {
      const html = await fetchText(`https://www.webtv.sangiin.go.jp/webtv/detail.php?sid=${sid}`);
      const detail = parseDetail(html);
      return detail && { house: "sangiin", id: `sid${sid}`, ...entry, ...detail };
    } catch { return null; }
  }));
  return results.filter(Boolean);
}

// 参議院: 当日一覧 (live_list) から sid を取得し、detail ページで m3u8 を解決
export async function getSangiinLive(listing = sangiinListing()) {
  const html = await listing;
  const liveSection = html.split('id="vod_list"')[0];
  const entries = [];
  const rowRe =
    /detail\.php\?sid=(\d+)[^>]*class='detail'>([^<]+)<\/a><\/td>\s*<td class="meeting_time">([\d:]+)/g;
  const seen = new Set();
  for (const m of liveSection.matchAll(rowRe)) {
    const [, sid, rawName, time] = m;
    if (seen.has(sid)) continue;
    seen.add(sid);
    entries.push({
      sid,
      time,
      pending: rawName.includes("お待ちください"),
      name: rawName.replace(/（※[^）]*）/g, "").trim(),
    });
  }
  return resolveSangiin(entries, (detail) => {
    const pm = detail.match(/channel_hash=([a-z0-9]+)&live_hash=([a-z0-9]+)/);
    if (!pm) return null;
    const base = `https://sangiin-live.live.ipcasting.jp/live/${pm[1]}.h/${pm[2]}`;
    return { m3u8: `${base}/index.m3u8`, channelInfo: `${base}/channel-info.json`, channelHash: pm[1] };
  });
}

// 参議院: 当日一覧の vod_list (録画済み) から sid を取得し、detail ページで mediasp の VOD hash を解決。
// 字幕(WebVTT)入りの VOD m3u8 はこの hash からブラウザ側で辿れる(mediasp/ipcasting は CORS 開放済み)
export async function getSangiinVod(listing = sangiinListing()) {
  const html = await listing;
  const vodSection = html.split('id="vod_list"')[1];
  if (!vodSection) return [];
  const entries = [];
  const seen = new Set();
  // 各行は日付リンクと会議名リンクの2つが同じ sid を指す。日付の方は読み飛ばす
  const rowRe = /detail\.php\?sid=(\d+)[^>]*class=['"]detail['"]>([^<]+)<\/a>/g;
  for (const m of vodSection.matchAll(rowRe)) {
    const [, sid, rawName] = m;
    const name = rawName.trim();
    if (/^\d{4}年/.test(name) || seen.has(sid)) continue;
    seen.add(sid);
    entries.push({ sid, name });
  }
  return resolveSangiin(entries, (detail) => {
    const pm = detail.match(/public\.mediasp\.jp\/v1\/player\?hash=([a-zA-Z0-9]+)/);
    return pm && { hash: pm[1] };
  });
}

export async function getStreams() {
  const listing = sangiinListing();
  const [shu, san, vod] = await Promise.allSettled([
    getShugiinLive(),
    getSangiinLive(listing),
    getSangiinVod(listing),
  ]);
  const shuVal = shu.status === "fulfilled" ? shu.value : null;
  return {
    updatedAt: new Date().toISOString(),
    sessionDate: shuVal?.sessionDate ?? null,
    sangiinSessionDate: day(Date.now()),
    sangiinChannels: san.status === "fulfilled" ? knownChannels({ streams: san.value }) : [],
    streams: [
      ...(shuVal ? shuVal.streams : []),
      ...(san.status === "fulfilled" ? san.value : []),
    ],
    vod: vod.status === "fulfilled" ? vod.value : [],
    errors: [shu, san, vod].filter((r) => r.status === "rejected").map((r) => String(r.reason)),
  };
}
