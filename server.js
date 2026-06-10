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
