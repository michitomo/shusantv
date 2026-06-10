// shusantv ローカル用ヘルパーサーバ（Pages運用時は GitHub Actions が streams.json を生成する）
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getStreams } from "./lib/scrape.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8787;

let cache = { at: 0, data: null };
async function getStreamsCached() {
  if (cache.data && Date.now() - cache.at < 60_000) return cache.data;
  const data = await getStreams();
  cache = { at: Date.now(), data };
  return data;
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/streams.json" || url.pathname === "/api/streams") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        // ?demo=1: UI確認用ダミー(公開テストHLS)。審議がない時間帯のUI開発に使う
        if (url.searchParams.get("demo")) {
          const demo = [
            ["shugiin", "demo1", "予算委員会(ダミー)", "9:00"],
            ["shugiin", "demo2", "法務委員会(ダミー)", "9:00"],
            ["sangiin", "demo3", "厚生労働委員会(ダミー)", "10:00"],
            ["sangiin", "demo4", "内閣委員会(ダミー)", "10:00"],
            ["shugiin", "demo5", "本会議(ダミー)", "13:00"],
          ].map(([house, id, name, time]) => ({
            house, id, name, time,
            m3u8: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
          }));
          res.end(JSON.stringify({ updatedAt: new Date().toISOString(), streams: demo, errors: [] }));
          return;
        }
        res.end(JSON.stringify(await getStreamsCached()));
        return;
      }
      const file = url.pathname === "/" ? "/index.html" : url.pathname;
      const body = await readFile(path.join(__dirname, "public", path.normalize(file)));
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch (err) {
      res.writeHead(err.code === "ENOENT" ? 404 : 500, { "Content-Type": "text/plain" });
      res.end(String(err));
    }
  })
  .listen(PORT, () => console.log(`shusantv: http://localhost:${PORT}`));
