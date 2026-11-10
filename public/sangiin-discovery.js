// 公式HTMLにはCORSがないが、既知チャンネルのCDNメタデータは直接取得できる。
// sidは会議IDでありチャンネル番号ではない。連番探索・委員会名の推測はしない。
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.shusantvSangiin = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const ORIGIN = "https://sangiin-live.live.ipcasting.jp";
  // 2026-11-10に公式ページ/公開一覧から確認。新規チャンネルは一覧から追加学習する。
  const SEED_CHANNELS = ["cpl6pa5632pig7l1fg4g", "collj06mbb93lo02e190"];
  const POLL_MS = 60_000;
  const FRESH_MS = 120_000;
  const STORAGE_KEY = "shusantv-sangiin-channels-v1";
  const validHash = (s) => typeof s === "string" && /^[a-z0-9]{12,64}$/.test(s);
  const day = (value) => {
    const d = new Date(value);
    return Number.isFinite(d.getTime())
      ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d)
      : null;
  };
  function sameDayListing(data, now = Date.now()) {
    // sessionDateは衆院由来なので参院の判定に使わない。
    const t = Date.parse(data?.updatedAt);
    return Number.isFinite(t) && t <= +now + 30_000 && day(t) === day(now)
      && (!data.sangiinSessionDate || data.sangiinSessionDate === day(now));
  }
  function channelHash(entry) {
    for (const value of [entry?.channelInfo, entry?.m3u8]) {
      try {
        const u = new URL(value);
        const m = u.pathname.match(/^\/live\/([a-z0-9]{12,64})\.h\//);
        if (u.origin === ORIGIN && !u.username && !u.password && m) return m[1];
      } catch {}
    }
    return null;
  }
  function recent(value, now) {
    const t = Date.parse(value);
    return Number.isFinite(t) && +now - t >= -30_000 && +now - t <= FRESH_MS;
  }
  function validMetadata(info, now) {
    const s = info?.status;
    const id = Number(s?.program_id);
    return ["public", "private"].includes(info?.config?.published)
      && ["active", "inactive"].includes(s?.output)
      && ["number", "string"].includes(typeof s?.program_id)
      && Number.isSafeInteger(Number(s.program_id)) && Number(s.program_id) >= 0
      && (id === 0 || id === 65535
        ? typeof s.program_uid === "string" && /^[a-z0-9._-]{1,100}$/.test(s.program_uid)
        : validHash(s.program_uid))
      && Number.isFinite(Date.parse(s.program_start)) && Number.isFinite(Date.parse(s.latest_pts))
      && recent(s.date, now);
  }
  function candidateFromInfo(hash, info, now = Date.now()) {
    const s = info?.status;
    const id = Number(s?.program_id);
    if (!validMetadata(info, now) || !validHash(hash) || info?.config?.published !== "public" || s?.output !== "active"
      || !Number.isSafeInteger(id) || id <= 0 || id === 65535 || !validHash(s?.program_uid)
      || !recent(s?.date, now) || !recent(s?.latest_pts, now)) return null;
    const start = Date.parse(s.program_start);
    if (!Number.isFinite(start) || start > +now + 30_000 || day(start) !== day(now)) return null;
    const schedule = (Array.isArray(info.schedules) ? info.schedules : [])
      .find((x) => x.status?.program_uid === s.program_uid);
    if (schedule?.status?.program_end || (schedule?.config?.published && schedule.config.published !== "public")) return null;
    const base = `${ORIGIN}/live/${hash}.h/${s.program_uid}`;
    return {
      house: "sangiin", id: `sid${id}`, name: `参院・会議名確認中 (sid${id})`,
      time: new Date(start).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" }),
      pending: false, discovered: true, nameConfirmed: false, subtitleAvailable: s.subtitle === "active",
      programUid: s.program_uid, programStart: s.program_start,
      m3u8: `${base}/index.m3u8`, channelInfo: `${base}/channel-info.json`,
    };
  }
  function mergeStreams(data, baseStreams, discovery, now = Date.now()) {
    const found = new Map(discovery.streams.map((s) => [s.id, s]));
    const names = new Map(sameDayListing(data, now)
      ? [...(data.streams || []), ...(data.vod || [])].filter((s) => s.house === "sangiin").map((s) => [s.id, s]) : []);
    const result = new Map();
    for (const entry of baseStreams) {
      if (entry.house === "sangiin" && !entry.pending) {
        const hash = channelHash(entry);
        // 明示的な停止/別番組への切り替えと、一時的な取得失敗を区別する。
        if (hash && discovery.checkedChannels.has(hash) && !found.has(entry.id)) continue;
      }
      result.set(entry.id, entry);
    }
    for (const entry of found.values()) {
      const official = names.get(entry.id);
      result.set(entry.id, official?.name ? { ...entry, name: official.name, nameConfirmed: true } : entry);
    }
    return [...result.values()];
  }
  function transcriptEntries(data, lives, selected, now = Date.now()) {
    const entries = new Map();
    for (const s of lives) {
      if (s.house === "sangiin" && !s.pending && s.subtitleAvailable !== false)
        entries.set(s.id, { ...s, live: true });
    }
    if (sameDayListing(data, now)) {
      for (const v of data.vod || []) if (!entries.has(v.id)) entries.set(v.id, { ...v, live: false });
    }
    // 読んでいる字幕/要約は、録画移行・一覧欠落・日付切替でも消さない。
    if (selected && !entries.has(selected.id)) entries.set(selected.id, { ...selected, retained: true });
    return entries;
  }
  function createDiscovery(options = {}) {
    const fetcher = options.fetch || globalThis.fetch.bind(globalThis);
    const now = options.now || Date.now;
    let storage = options.storage;
    if (storage === undefined) { try { storage = globalThis.localStorage; } catch {} }
    const states = new Map();
    let running = null;
    function learn(data) {
      let saved = [];
      try { const value = JSON.parse(storage?.getItem(STORAGE_KEY) || "[]"); if (Array.isArray(value)) saved = value; } catch {}
      // 最新一覧を優先。上限を超える場合は古い学習分を捨て、新チャンネルを飢餓状態にしない。
      const latest = (data?.streams || []).filter((s) => s.house === "sangiin").map(channelHash);
      const hashes = [...new Set([...latest, ...(data?.sangiinChannels || []), ...saved, ...states.keys(), ...SEED_CHANNELS].filter(validHash))].slice(0, 32);
      for (const hash of hashes) if (!states.has(hash)) states.set(hash, { next: 0, failures: 0, info: null });
      for (const hash of states.keys()) if (!hashes.includes(hash)) states.delete(hash);
      try { storage?.setItem(STORAGE_KEY, JSON.stringify(hashes)); } catch {}
    }
    function snapshot() {
      const streams = [], checkedChannels = new Set();
      for (const [hash, state] of states) {
        if (!recent(state.info?.status?.date, now())) continue;
        checkedChannels.add(hash);
        const candidate = candidateFromInfo(hash, state.info, now());
        if (candidate) streams.push(candidate);
      }
      return { streams, checkedChannels };
    }
    async function poll(data) {
      if (running) return running;
      learn(data);
      running = (async () => {
        const due = [...states].filter(([, s]) => now() >= s.next);
        let cursor = 0;
        await Promise.all(Array.from({ length: Math.min(3, due.length) }, async () => {
          while (cursor < due.length) {
            const [hash, state] = due[cursor++];
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), options.timeoutMs || 6000);
            try {
              const res = await fetcher(`${ORIGIN}/live/${hash}.h/channel-info.json`, {
                signal: controller.signal, cache: "no-store", credentials: "omit",
              });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const info = await res.json();
              if (!validMetadata(info, now())) throw new Error("invalid or stale channel metadata");
              state.info = info;
              state.failures = 0;
              state.next = now() + POLL_MS;
            } catch {
              state.failures++;
              state.next = now() + Math.min(300_000, POLL_MS * 2 ** Math.min(state.failures - 1, 3));
            } finally { clearTimeout(timer); }
          }
        }));
        return snapshot();
      })();
      try { return await running; } finally { running = null; }
    }
    return { poll };
  }
  // 完了後に次回を予約し、非表示タブでは一覧/探索の通信を止める。
  function startPolling(refresh, doc = document, interval = POLL_MS) {
    let timer, running = false, stopped = false;
    async function run() {
      clearTimeout(timer);
      if (stopped || running || doc.hidden) return;
      running = true;
      try { await refresh(); } catch (e) { console.warn("一覧更新", e); }
      finally {
        running = false;
        if (!stopped && !doc.hidden) timer = setTimeout(run, interval);
      }
    }
    const visible = () => { clearTimeout(timer); if (!doc.hidden) run(); };
    doc.addEventListener("visibilitychange", visible);
    run();
    return () => { stopped = true; clearTimeout(timer); doc.removeEventListener("visibilitychange", visible); };
  }
  return { SEED_CHANNELS, POLL_MS, FRESH_MS, day, sameDayListing, channelHash, candidateFromInfo,
    mergeStreams, transcriptEntries, createDiscovery, startPolling };
});
