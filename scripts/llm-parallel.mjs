// 全文を並列チャンク処理した時の実時間/コストを測る。
// 使い方: PROVIDER=cerebras REASONING=medium CONC=6 node scripts/llm-parallel.mjs <model> <file> [chunkCues]
import { readFile } from "node:fs/promises";

const KEY = process.env.OPENROUTER_API_KEY;
const model = process.argv[2];
const FILE = process.argv[3];
const CHUNK = parseInt(process.argv[4] || "200", 10);
const CONC = parseInt(process.env.CONC || "6", 10);

const SYSTEM = `あなたは国会審議の自動字幕(誤変換あり)を、2階層で要約するアシスタントです。
本文は書き換えません。次の2階層に分けて要約し、JSONだけを返します(コードブロック不要):
{ "qa": [{"i": <質疑開始index>, "kind": "<質疑|手続き>", "questioner": "<質問者名/null>", "gist": "<30字以内>", "summary": "<3〜5文>"}],
  "turns": [{"i": <発言開始index>, "sp": "<発言者>", "gist": "<25字以内>", "summary": "<2〜4文>"}] }
- qa: 1人の質問者が始めてから次の質問者に交代するまで(答弁者交代は内包)。開会等はkind="手続き"。
- turns: qa内の発言者交代ごと。
- gistは簡潔、summaryは中立。原文の逐語転記はしない。`;

const raw = await readFile(FILE, "utf8");
const cues = raw.split(/\r?\n/).map((l) => {
  const m = l.match(/^(\d+:\d{2}:\d{2})\t(.*)$/);
  return m ? m[2] : null;
}).filter((x) => x !== null);

// 固定長チャンク(グローバルindex維持)
const chunks = [];
for (let i = 0; i < cues.length; i += CHUNK) {
  const slice = cues.slice(i, i + CHUNK);
  chunks.push({ start: i, body: slice.map((t, j) => `[${i + j}] ${t}`).join("\n") });
}

async function callChunk(ch) {
  const payload = {
    model,
    messages: [{ role: "system", content: SYSTEM }, { role: "user", content: ch.body }],
    temperature: 0.2,
  };
  if (process.env.PROVIDER) {
    const order = process.env.PROVIDER.split(",").map((s) => s.trim()).filter(Boolean);
    if (order.length) payload.provider = { order, allow_fallbacks: false };
  }
  if (process.env.REASONING) payload.reasoning = { effort: process.env.REASONING };
  const t = Date.now();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = await res.json();
  const ms = Date.now() - t;
  if (!res.ok) return { start: ch.start, ms, err: `${res.status} ${JSON.stringify(j).slice(0, 120)}` };
  return { start: ch.start, ms, cost: j.usage?.cost ?? 0, provider: j.provider };
}

// 同時実行数 CONC でプール実行
const results = new Array(chunks.length);
let next = 0;
const t0 = Date.now();
await Promise.all(Array.from({ length: Math.min(CONC, chunks.length) }, async () => {
  while (next < chunks.length) {
    const i = next++;
    results[i] = await callChunk(chunks[i]);
  }
}));
const total = Date.now() - t0;

let cost = 0, errs = 0;
for (const r of results) { cost += r.cost || 0; if (r.err) errs++; }
console.log(`model=${model} provider=${results[0]?.provider} cues=${cues.length} chunks=${chunks.length}(${CHUNK}cue) conc=${CONC}`);
console.log(`各チャンク: ${results.map((r) => r.err ? "ERR" : (r.ms + "ms")).join(", ")}`);
console.log(`★ 全体wall time: ${total}ms | 合計コスト: $${cost.toFixed(5)} | エラー: ${errs}`);
