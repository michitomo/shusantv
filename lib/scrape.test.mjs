import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { parseShugiinLive, shugiinSessionDate } from "./scrape.mjs";

const require = createRequire(import.meta.url);
const { listingCurrent, streamsForGrid, fallbackShugiinName } = require("../public/listing.js");

const PAGE = (rows) => `<html><script>
var jsty='2026';
var jstm='11';
var jstd='05';
</script>
<div id="today">
<table>
<tr align="center" bgcolor="#CCCCCC"><td>開会</td><td></td><td>会議名</td></tr>
${rows}
</table>
<option value="965">文部科学委員会</option>
</div>
<div id="tomorrow"></div>`;

const liveRow = (time, room, name) => `<tr bgcolor="#E1E1E1">
  <td width="100" align="center" class="s12_14">${time}</td>
  <td width="45" align="center">
  <a href="/jp/index.php?room_id=${room}" class="play_live" dvr="1"><img alt="中継中"></a>
  </td>
  <td width="465" align="left" class="s12_14">　${name}
  </td>
</tr>`;

const idleRow = (time, name, icon) => `<tr bgcolor="#E1E1E1">
  <td width="100" align="center" class="s12_14">${time}</td>
  <td width="45" align="center"><img alt="${icon}" src="../images/icon_${icon}.gif"></td>
  <td width="465" align="left" class="s12_14">　${name}</td>
</tr>`;

test("2026-11-05 午前: room17 は内閣、room12 は災害対策。予定の憲法審査会は含めない", () => {
  const html = PAGE(
    liveRow("9:00", "room17", "内閣委員会") +
      liveRow("9:30", "room12", "災害対策特別委員会") +
      idleRow("10:00", "憲法審査会", "中継予定")
  );
  assert.equal(shugiinSessionDate(html), "2026-11-05");
  const streams = parseShugiinLive(html);
  assert.deepEqual(
    streams.map(({ id, name, time }) => ({ id, name, time })),
    [
      { id: "room17", name: "内閣委員会", time: "9:00" },
      { id: "room12", name: "災害対策特別委員会", time: "9:30" },
    ]
  );
  assert.equal(streams[0].m3u8, "https://hlslive.shugiintv.go.jp/room17/amlst:room17/playlist.m3u8");
});

test("散会した災害対策特別委員会は部屋名を持たず、中継中の内閣だけ残る", () => {
  const html = PAGE(
    liveRow("9:00", "room17", "内閣委員会") +
      idleRow("9:30", "災害対策特別委員会", "散会") +
      idleRow("10:00", "憲法審査会", "中継予定")
  );
  assert.deepEqual(
    parseShugiinLive(html).map(({ id, name }) => ({ id, name })),
    [{ id: "room17", name: "内閣委員会" }]
  );
});

test("予定行の文部科学委員会を、次の中継中 room の内閣委員会に付け替えない", () => {
  const html = PAGE(
    idleRow("9:00", "文部科学委員会", "中継予定") + liveRow("9:30", "room17", "内閣委員会")
  );
  const streams = parseShugiinLive(html);
  assert.deepEqual(
    streams.map(({ id, name, time }) => ({ id, name, time })),
    [{ id: "room17", name: "内閣委員会", time: "9:30" }]
  );
});

test("中継が複数でも隣の行の委員会名と入れ替わらない", () => {
  const html = PAGE(
    liveRow("9:00", "room13", "内閣委員会") +
      liveRow("9:00", "room17", "文部科学委員会") +
      liveRow("9:00", "room12", "経済産業委員会")
  );
  assert.deepEqual(
    parseShugiinLive(html).map(({ id, name }) => [id, name]),
    [
      ["room13", "内閣委員会"],
      ["room17", "文部科学委員会"],
      ["room12", "経済産業委員会"],
    ]
  );
});

test("2026-10-28 の streams.json は 11/5 の中継名に使わない", () => {
  const now = new Date("2026-11-05T00:40:00.000Z");
  const data = {
    updatedAt: "2026-10-28T05:39:20.595Z",
    streams: [
      { house: "shugiin", id: "room17", name: "文部科学委員会", time: "9:00" },
      { house: "shugiin", id: "room12", name: "経済産業委員会", time: "9:00" },
      { house: "sangiin", id: "sid9294", name: "沖縄・北方問題及び地方に関する特別委員会" },
    ],
  };
  assert.equal(listingCurrent(data, now), false);
  assert.deepEqual(streamsForGrid(data, now), []);
});

test("当日かつ2時間以内の一覧だけ委員会名を残す", () => {
  const now = new Date("2026-11-05T01:00:00.000Z"); // 10:00 JST
  const fresh = {
    updatedAt: "2026-11-05T00:40:00.000Z",
    sessionDate: "2026-11-05",
    streams: [{ house: "shugiin", id: "room17", name: "内閣委員会" }],
  };
  assert.equal(listingCurrent(fresh, now), true);
  assert.equal(streamsForGrid(fresh, now)[0].name, "内閣委員会");

  const staleSameDay = { ...fresh, updatedAt: "2026-11-04T22:00:00.000Z" }; // 7:00 JST, 3h ago
  assert.equal(listingCurrent(staleSameDay, now), false);

  const wrongSession = { ...fresh, sessionDate: "2026-11-04" };
  assert.equal(listingCurrent(wrongSession, now), false);
});

test("プローブの仮名は room00 以外の委員会名を作らない", () => {
  assert.equal(fallbackShugiinName("room00"), "本会議");
  assert.equal(fallbackShugiinName("room12"), "中継中 (room12)");
  assert.equal(fallbackShugiinName("room17"), "中継中 (room17)");
});
