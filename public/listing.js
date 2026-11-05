// 衆議院の配信部屋番号は委員会に固定ではない。
// room17 は 2026-10-28 が文部科学委員会、2026-11-04 と 2026-11-05 が内閣委員会。
// room12 は 2026-10-28 が経済産業委員会、2026-11-05 午前が災害対策特別委員会。
// 部屋番号から委員会名を推測すると、別の日の対応がそのまま表示される。
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.shusantvListing = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  // 同じ部屋で委員会が入れ替わる。最終取得からこれ以上古い衆院名は使わない。
  const SHU_NAME_MAX_AGE_MS = 2 * 60 * 60 * 1000;

  function jstDay(d) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  }

  // streams.json の委員会名を今の中継に使ってよいか。
  // 別日、掲載日の不一致、または最終取得から2時間超は部屋の割り当てが変わり得る。
  function listingCurrent(data, now = new Date()) {
    if (!data?.updatedAt) return false;
    const updated = new Date(data.updatedAt);
    if (Number.isNaN(updated.getTime())) return false;
    const today = jstDay(now);
    if (jstDay(updated) !== today) return false;
    if (data.sessionDate && data.sessionDate !== today) return false;
    return now.getTime() - updated.getTime() < SHU_NAME_MAX_AGE_MS;
  }

  // 古い一覧の衆参は捨てる。部屋 URL は日をまたいでも生きるため、
  // 残すと 10/28 の「room17 = 文部科学委員会」が 11/5 の内閣委員会に付く。
  function streamsForGrid(data, now = new Date()) {
    const streams = Array.isArray(data?.streams) ? data.streams.slice() : [];
    if (listingCurrent(data, now)) return streams;
    return streams.filter((s) => s.house !== "shugiin" && s.house !== "sangiin");
  }

  // 公式一覧に無い部屋をプローブしたときの表示名。
  // room00 は本会議場で固定。委員会室は日によって会議が変わるので名前を作らない。
  function fallbackShugiinName(roomId) {
    return roomId === "room00" ? "本会議" : `中継中 (${roomId})`;
  }

  return { SHU_NAME_MAX_AGE_MS, jstDay, listingCurrent, streamsForGrid, fallbackShugiinName };
});
