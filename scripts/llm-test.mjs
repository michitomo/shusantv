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

  summary: `あなたは国会審議の自動字幕(誤変換あり)を、2階層で要約するアシスタントです。
本文は書き換えません。次の2階層に分けて要約し、JSONだけを返します(コードブロック不要):
{
  "qa": [{"i": <質疑が始まるindex>, "kind": "<質疑|手続き>", "questioner": "<質問者名。手続き等はnull>", "gist": "<30字以内の見出し>", "points": ["<質疑全体の要旨。1〜3個の箇条書き。各40字以内>"]}],
  "turns": [{"i": <発言が始まるindex>, "sp": "<発言者名または役職>", "gist": "<25字以内の1行要旨>", "summary": "<その発言を2〜4文で>"}]
}
階層の定義:
- qa(質疑ターン): 1人の質問者(委員=「○○くん」と委員長に指名される議員)が始めてから次の質問者に交代するまでの一区切り。その間に答弁者(大臣・局長・参考人)が複数入れ替わってもまとめて1つにする。開会や参考人出席要求などの議事手続きは kind="手続き"・questioner=null の qa として独立させる。
- qa.points: その質疑全体の要点を1〜3個の箇条書きで(多くても3個)。冗長にしない。
- turns(発言者ターン): qaの中で、発言者が交代するindexごとに1要素。同一発言者の連続は1つにまとめる。
規則:
- gistは見出し的に超簡潔に。要旨・summaryは論点・主張・答弁の骨子を中立的に。
- 字幕の誤変換は文脈で補って要約してよいが、原文の引用や逐語転記はしない。
- qaのiとturnsのiは整合させる(各qaの先頭turnのiはそのqaのiと一致)。`,
};
const system = SYSTEM[mode];

const t0 = Date.now();
const payload = {
  model,
  messages: [{ role: "system", content: system }, { role: "user", content: body }],
  temperature: 0.2,
};
// PROVIDER=deepinfra など指定で特定プロバイダに固定(フォールバック無効)
if (process.env.PROVIDER) {
  const order = process.env.PROVIDER.split(",").map((s) => s.trim()).filter(Boolean);
  if (order.length) payload.provider = { order, allow_fallbacks: false };
}
// REASONING=low|medium|high で推論量を制御(不要な思考トークン=出力コスト削減)
if (process.env.REASONING) payload.reasoning = { effort: process.env.REASONING };
const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
const json = await res.json();
const ms = Date.now() - t0; // ヘッダ到達ではなく本文受信完了までの実時間
if (!res.ok) { console.error("HTTP", res.status, JSON.stringify(json)); process.exit(1); }

const out = json.choices?.[0]?.message?.content ?? "";
console.log(`=== model: ${model} | provider: ${json.provider || process.env.PROVIDER || "auto"} | cues: ${slice.length} | ${ms}ms ===`);
console.log("usage:", JSON.stringify(json.usage));
console.log("--- output ---");
console.log(out);
