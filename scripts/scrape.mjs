// GitHub Actions から実行: public/streams.json を生成する
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getStreams } from "../lib/scrape.mjs";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "streams.json");
const data = await getStreams();
await writeFile(out, JSON.stringify(data, null, 1));
console.log(`${data.streams.length} streams, ${data.vod.length} vod -> ${out}`);
if (data.errors.length) console.error("errors:", data.errors);
