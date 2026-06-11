// 衆参の開催中会議一覧スクレイピングと m3u8 解決。
// ローカルサーバ (server.js) と GitHub Actions (scripts/scrape.mjs) の双方から使う。
const UA = "Mozilla/5.0 (shusantv viewer)";

async function fetchText(url, encoding = "utf-8") {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = await res.arrayBuffer();
  return new TextDecoder(encoding).decode(buf);
}

// 衆議院: トップページの「中継中」リンクから room_id と会議名を取得
export async function getShugiinLive() {
  const html = await fetchText("https://www.shugiintv.go.jp/jp/index.php", "euc-jp");
  const streams = [];
  const rowRe =
    /<td[^>]*class="s12_14">([\d:]+)<\/td>[\s\S]*?room_id=(room\d+)"[^>]*class="play_live"[\s\S]*?<td[^>]*class="s12_14">\s*([^<]+?)\s*<\/td>/g;
  for (const m of html.matchAll(rowRe)) {
    const [, time, roomId, rawName] = m;
    streams.push({
      house: "shugiin",
      id: roomId,
      name: rawName.replace(/^　+/, "").trim(),
      time,
      m3u8: `https://hlslive.shugiintv.go.jp/${roomId}/amlst:${roomId}/playlist.m3u8`,
    });
  }
  return streams;
}

// 参議院: 当日一覧 (live_list) から sid を取得し、detail ページで m3u8 を解決
export async function getSangiinLive() {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const html = await fetchText(
    `https://www.webtv.sangiin.go.jp/webtv/result_selecter.php?mode=today_reload&absdate=${today}`
  );
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
  return Promise.all(
    entries.map(async (e) => {
      try {
        const detail = await fetchText(`https://www.webtv.sangiin.go.jp/webtv/detail.php?sid=${e.sid}`);
        const pm = detail.match(/channel_hash=([a-z0-9]+)&live_hash=([a-z0-9]+)/);
        if (!pm) return null;
        const base = `https://sangiin-live.live.ipcasting.jp/live/${pm[1]}.h/${pm[2]}`;
        return {
          house: "sangiin",
          id: `sid${e.sid}`,
          name: e.name,
          time: e.time,
          pending: e.pending,
          m3u8: `${base}/index.m3u8`,
          channelInfo: `${base}/channel-info.json`,
        };
      } catch {
        return null;
      }
    })
  ).then((list) => list.filter(Boolean));
}

// 参議院: 当日一覧の vod_list (録画済み) から sid を取得し、detail ページで mediasp の VOD hash を解決。
// 字幕(WebVTT)入りの VOD m3u8 はこの hash からブラウザ側で辿れる(mediasp/ipcasting は CORS 開放済み)
export async function getSangiinVod() {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const html = await fetchText(
    `https://www.webtv.sangiin.go.jp/webtv/result_selecter.php?mode=today_reload&absdate=${today}`
  );
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
  return Promise.all(
    entries.map(async (e) => {
      try {
        const detail = await fetchText(`https://www.webtv.sangiin.go.jp/webtv/detail.php?sid=${e.sid}`);
        const pm = detail.match(/public\.mediasp\.jp\/v1\/player\?hash=([a-zA-Z0-9]+)/);
        if (!pm) return null;
        return { house: "sangiin", id: `sid${e.sid}`, name: e.name, hash: pm[1] };
      } catch {
        return null;
      }
    })
  ).then((list) => list.filter(Boolean));
}

export async function getStreams() {
  const [shu, san, vod] = await Promise.allSettled([
    getShugiinLive(),
    getSangiinLive(),
    getSangiinVod(),
  ]);
  return {
    updatedAt: new Date().toISOString(),
    streams: [
      ...(shu.status === "fulfilled" ? shu.value : []),
      ...(san.status === "fulfilled" ? san.value : []),
    ],
    vod: vod.status === "fulfilled" ? vod.value : [],
    errors: [shu, san, vod].filter((r) => r.status === "rejected").map((r) => String(r.reason)),
  };
}
