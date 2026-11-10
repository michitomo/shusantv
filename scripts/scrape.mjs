// GitHub Actions から実行: public/streams.json を生成する
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getStreams } from "../lib/scrape.mjs";
import { createRequire } from "node:module";
const { SEED_CHANNELS, knownChannels } = createRequire(import.meta.url)("../public/sangiin-discovery.js");

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "streams.json");
const data = await getStreams();
// 過去に公式一覧で確認したチャンネルを次回デプロイにも引き継ぐ。
// 失敗しても当日のスクレイプは公開し、公開JSON以外への探索は行わない。
let previous = [];
if (process.env.PREVIOUS_STREAMS_URL) {
  try {
    const res = await fetch(process.env.PREVIOUS_STREAMS_URL, { signal: AbortSignal.timeout(5000), cache: "no-store" });
    if (res.ok) previous = knownChannels(await res.json());
  } catch (e) { console.warn(`Previous channel list unavailable: ${e.message}`); }
}
data.sangiinChannels = knownChannels(data, previous, SEED_CHANNELS);
await writeFile(out, JSON.stringify(data, null, 1));
console.log(`${data.streams.length} streams, ${data.vod.length} vod -> ${out}`);
if (data.errors.length) console.error("errors:", data.errors);
