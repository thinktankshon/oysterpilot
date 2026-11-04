// knowledge/questions.md の想定質問（表の行）を 1 問ずつ流し、範囲外・禁止語・フォールバックの数を出す。
// 使い方: pnpm sweep            （ローカル API http://localhost:8787）
//        本番に流すときは環境変数 EVAL_URL に URL、共有パスワードを環境変数 DEMO_KEY に入れて pnpm sweep
// 結果: knowledge/eval_<日付>.md
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const URL_BASE = process.env.EVAL_URL ?? 'http://localhost:8787';
const DEMO_KEY = process.env.DEMO_KEY ?? '';
const BANNED = /死にます|必ず|予測|安全です|最適です/;
const OOS_PHRASE = /先輩に聞く項目として整理します/;

type Row = { id: string; q: string; expect: string };
function loadQuestions(): Row[] {
  const md = readFileSync(join(here, '../../knowledge/questions.md'), 'utf8');
  const rows: Row[] = [];
  for (const line of md.split('\n')) {
    const m = /^\|\s*([A-J]\d{1,2})\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/.exec(line);
    if (m) rows.push({ id: m[1], q: m[2], expect: m[3] });
  }
  return rows;
}

async function ask(q: string) {
  const t0 = Date.now();
  const res = await fetch(`${URL_BASE}/api/oysterman/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(DEMO_KEY ? { 'X-Demo-Key': DEMO_KEY } : {}) },
    body: JSON.stringify({ messages: [{ role: 'user', content: q }] }),
  });
  const sec = Math.round((Date.now() - t0) / 1000);
  if (!res.ok) return { error: `${res.status} ${await res.text()}`, sec };
  const j = (await res.json()) as { reply: string; basis: string[]; out_of_scope: boolean };
  return { ...j, sec };
}

const rows = loadQuestions();
const only = process.argv[2]; // 例: J（グループだけ）
const targets = only ? rows.filter((r) => r.id.startsWith(only)) : rows;
console.log(`${targets.length} 問を ${URL_BASE} に流します`);
const out: string[] = [];
let errors = 0, banned = 0, oos = 0, oosPhrase = 0;
for (const r of targets) {
  const a = await ask(r.q);
  if ('error' in a) {
    errors++;
    out.push(`| ${r.id} | ${r.q} | ${r.expect} | エラー | | | ${a.sec} | ${a.error.slice(0, 80)} |`);
    console.log(`${r.id} ERROR ${a.error.slice(0, 60)}`);
    continue;
  }
  const hasBanned = BANNED.test(a.reply.replace(/「[^」]*」/g, '').replace(/必ず(しも)?[^。]{0,20}?(ではありません|ではない|わけではな|とは限り|言えません)/g, '').replace(/予測(は|を)?[^。]{0,10}?(しません|できません|ではなく)/g, ''));
  if (hasBanned) banned++;
  if (a.out_of_scope) oos++;
  if (OOS_PHRASE.test(a.reply)) oosPhrase++;
  const head = a.reply.replace(/\n+/g, ' ').slice(0, 140);
  out.push(`| ${r.id} | ${r.q} | ${r.expect} | ${a.basis.join('・')} | ${a.out_of_scope ? '✓' : ''} | ${hasBanned ? '✓' : ''} | ${a.sec} | ${head} |`);
  console.log(`${r.id} ${a.out_of_scope ? '[範囲外]' : '        '} ${hasBanned ? '[禁止語]' : ''} ${head.slice(0, 70)}`);
}
const date = new Date().toISOString().slice(0, 10);
const md = [
  `# AI Oysterman 想定質問の一括評価（${date}）`,
  '',
  '列：想定根拠 → 返答の根拠行 / 範囲外フラグ / 禁止語 / 秒 / 返答（先頭 140 字）',
  '',
  '| # | 質問 | 想定 | 根拠行 | 範囲外 | 禁止語 | 秒 | 返答 |',
  '|---|---|---|---|---|---|---|---|',
  ...out,
  '',
  `合計 ${targets.length} 問、エラー ${errors}、禁止語あり ${banned}、範囲外 ${oos}（「先輩に聞く項目として整理します」を含む返答 ${oosPhrase}）`,
  '',
].join('\n');
const file = join(here, `../../knowledge/eval_${date}${only ? '_' + only : ''}.md`);
writeFileSync(file, md);
console.log(`\n合計 ${targets.length} 問、エラー ${errors}、禁止語あり ${banned}、範囲外 ${oos}、整理します ${oosPhrase} → ${file}`);
