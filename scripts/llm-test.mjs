// OpenRouter で index-only 整形のPoCテスト。
// 使い方: OPENROUTER_API_KEY=... node scripts/llm-test.mjs <model> <transcript.txt> [nCues]
// transcript.txt は「H:MM:SS<TAB>本文」の行が並んだ字幕TXT(文字起こしページのTXT書き出し形式)。
import { readFile } from "node:fs/promises";

const KEY = process.env.OPENROUTER_API_KEY;
const model = process.argv[2];
const FILE = process.argv[3];
const nCues = parseInt(process.argv[4] || "200", 10);
const mode = process.argv[5] || "structure"; // structure | fix

if (!KEY || !model || !FILE) {
  console.error("usage: OPENROUTER_API_KEY=... node scripts/llm-test.mjs <model> <transcript.txt> [nCues] [structure|fix]");
  process.exit(1);
}

const raw = await readFile(FILE, "utf8");
const cues = raw.split(/\r?\n/).map((l) => {
  const m = l.match(/^(\d+:\d{2}:\d{2})\t(.*)$/);
  return m ? { t: m[1], text: m[2] } : null;
}).filter(Boolean);

const slice = cues.slice(0, nCues);
// index付き本文（タイムスタンプは送らない＝indexでクライアントが引ける）
const body = slice.map((c, i) => `[${i}] ${c.text}`).join("\n");

const SYSTEM = {
  structure: `あなたは国会審議の自動字幕(誤変換あり)を「読みやすく整理」するための構造解析器です。
本文は書き換えず、構造を指し示すインデックスだけをJSONで返します。出力は最小限にしてください。

入力は [index] 本文 の行が続きます。次のJSONだけを返してください(コードブロック不要):
{
  "sections": [{"i": <そのセクションが始まるindex>, "title": "<10〜20字の短い見出し>"}],
  "turns": [{"i": <発言者が変わるindex>, "sp": "<発言者名または役職>"}]
}
規則:
- sections: 議題・論点の切れ目だけ。1審議で数個〜十数個程度。本文を要約・転記しない。
- turns: 発言者が交代するindexのみ。同一発言者の連続には付けない。発言者は本文中の呼称(例:委員長、○○大臣、○○くん)から推定。
- 発言者名だけの短い行(例「○○大臣」)は次の発言の冒頭とみなす。
- titleは見出しのみ。本文の引用や長文は禁止。`,

  fix: `あなたは国会審議の自動字幕の「明らかな音声認識の誤変換」だけを修正する校正器です。
本文全体は出力しません。高確度の誤変換に対する置換パッチだけをJSONで返します。出力は最小限に。

入力は [index] 本文 の行が続きます。次のJSONだけを返してください(コードブロック不要):
{ "fixes": [{"i": <対象index>, "from": "<元の誤変換語>", "to": "<正しい語>"}] }
規則:
- 文脈と国会用語から「ほぼ確実に誤変換」と判断できるものだけ(例: 米国→米穀、大気→待機、囲い込み等)。
- 言い回しの整形・要約・句読点の追加はしない。語句の置換のみ。
- fromはその行に実在する部分文字列。自信がなければ含めない(再現率より適合率を優先)。`,
};
const system = SYSTEM[mode];

const t0 = Date.now();
const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model,
    messages: [{ role: "system", content: system }, { role: "user", content: body }],
    temperature: 0.2,
  }),
});
const ms = Date.now() - t0;
const json = await res.json();
if (!res.ok) { console.error("HTTP", res.status, JSON.stringify(json)); process.exit(1); }

const out = json.choices?.[0]?.message?.content ?? "";
console.log(`=== model: ${model} | cues: ${slice.length} | ${ms}ms ===`);
console.log("usage:", JSON.stringify(json.usage));
console.log("--- output ---");
console.log(out);
