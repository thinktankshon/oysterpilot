// AI Oysterman の会話評価。ローカル API（既定 http://localhost:8787）に cases.json を流し、期待条件の通過数を出す。
//   pnpm eval                      # ローカル
//   EVAL_URL=https://... pnpm eval   # 本番。共有パスワードは環境変数 DEMO_KEY で渡す
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const URL_BASE = process.env.EVAL_URL ?? 'http://localhost:8787';
const DEMO_KEY = process.env.DEMO_KEY ?? '';
const BANNED = /死にます|必ず|予測|安全です|最適です/;
// サーバー（apps/api/src/oysterman.ts の hasForbidden）と同じ考え方：否定形と「…」の引用は断定ではない
function stripNegations(text: string): string {
  return text
    .replace(/「[^」]*」/g, '')
    .replace(/必ず(しも)?[^。！？\n]{0,20}?(ではありません|ではない|わけではな|とは限りません|とは限らない|言えません|言い切れません|決まっていません)/g, '')
    .replace(/予測(は|を|も)?[^。！？\n]{0,10}?(しません|できません|ではなく|いたしません|は行いません)/g, '')
    .replace(/死にます[^。！？\n]{0,10}?(とは限りません|とは言えません|とは限らない)/g, '');
}

type Expect = {
  fired_includes?: string[];
  must_include?: string[];
  must_include_any?: string[];
  must_not_include?: string[];
  asks_question?: boolean;
  out_of_scope?: boolean;
  reservation?: boolean;
  reservation_location?: string;
  focus_equals?: string[];
  basis_includes?: string[];
  max_sentences?: number;
  any_of?: Expect[];
};
type Case = { id: string; group: string; turns: string[]; expect: Expect };
type ChatResponse = {
  reply: string;
  basis: string[];
  fired_rules: string[];
  focus: string[];
  out_of_scope: boolean;
  reservation: { due_date: string; work: string; location_label: string | null } | null;
  error?: string;
};

const { cases } = JSON.parse(readFileSync(resolve(here, 'cases.json'), 'utf-8')) as { cases: Case[] };

async function chat(messages: { role: 'user' | 'assistant'; content: string }[]): Promise<ChatResponse> {
  const res = await fetch(`${URL_BASE}/api/oysterman/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(DEMO_KEY ? { 'X-Demo-Key': DEMO_KEY } : {}) },
    body: JSON.stringify({ messages }),
  });
  return (await res.json()) as ChatResponse;
}

function check(e: Expect, r: ChatResponse): string[] {
  const fails: string[] = [];
  const text = r.reply;
  for (const id of e.fired_includes ?? []) if (!r.fired_rules.includes(id)) fails.push(`ルール ${id} が成立していない`);
  for (const re of e.must_include ?? []) if (!new RegExp(re).test(text)) fails.push(`含むべき「${re}」が無い`);
  if (e.must_include_any && !e.must_include_any.some((re) => new RegExp(re).test(text))) fails.push(`いずれか含むべき [${e.must_include_any.join(' | ')}] が無い`);
  for (const re of e.must_not_include ?? []) if (new RegExp(re).test(text)) fails.push(`含んではいけない「${re}」がある`);
  if (e.asks_question && !/[？?]\s*$|[？?]/.test(text)) fails.push('聞き返しが無い');
  if (e.out_of_scope != null && r.out_of_scope !== e.out_of_scope) fails.push(`out_of_scope が ${r.out_of_scope}（期待 ${e.out_of_scope}）`);
  if (e.reservation != null && Boolean(r.reservation) !== e.reservation) fails.push(`予約が ${r.reservation ? 'ある' : '無い'}（期待 ${e.reservation}）`);
  if (e.reservation_location && r.reservation?.location_label !== e.reservation_location) fails.push(`予約の場所が ${r.reservation?.location_label}（期待 ${e.reservation_location}）`);
  if (e.focus_equals && JSON.stringify(r.focus) !== JSON.stringify(e.focus_equals)) fails.push(`focus が ${JSON.stringify(r.focus)}（期待 ${JSON.stringify(e.focus_equals)}）`);
  for (const b of e.basis_includes ?? []) if (!r.basis.some((x) => new RegExp(b).test(x))) fails.push(`根拠に「${b}」が無い（${r.basis.join("・")}）`);
  if (e.max_sentences != null) {
    const n = text.split(/[。！？!?]\s*/).filter((s) => s.trim()).length;
    if (n > e.max_sentences) fails.push(`文が ${n} 個（上限 ${e.max_sentences}）`);
  }
  if (e.any_of) {
    const ok = e.any_of.some((alt) => check(alt, r).length === 0);
    if (!ok) fails.push('any_of のどれも満たさない');
  }
  const stripped = stripNegations(text);
  if (BANNED.test(stripped)) fails.push(`禁止語: ${[...new Set(stripped.match(new RegExp(BANNED.source, 'g')) ?? [])].join('、')}`);
  return fails;
}

let pass = 0;
const lines: string[] = [];
for (const c of cases) {
  const messages: { role: 'user' | 'assistant'; content: string }[] = [];
  let last: ChatResponse | null = null;
  let err: string | null = null;
  const t0 = Date.now();
  try {
    for (const u of c.turns) {
      messages.push({ role: 'user', content: u });
      last = await chat(messages);
      if (last.error) throw new Error(last.error);
      messages.push({ role: 'assistant', content: last.reply });
    }
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  const fails = err ? [`エラー: ${err}`] : check(c.expect, last!);
  const ok = fails.length === 0;
  if (ok) pass++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${c.id} (${c.group}, ${sec}s)${ok ? '' : '\n   - ' + fails.join('\n   - ')}`);
  lines.push(`| ${ok ? '✓' : '✗'} | ${c.id} | ${c.group} | ${fails.join('<br>') || '—'} | ${(last?.reply ?? '').replace(/\n/g, ' ').replace(/\|/g, '｜').slice(0, 100)} |`);
}
console.log(`\n${pass}/${cases.length} passed`);
mkdirSync(resolve(here, 'results'), { recursive: true });
const out = resolve(here, 'results', `${new Date().toISOString().slice(0, 10)}.md`);
writeFileSync(out, [`# AI Oysterman 会話評価（${new Date().toISOString().slice(0, 16)}）`, '', `対象: ${URL_BASE}　結果: ${pass}/${cases.length}`, '', '| 結果 | ケース | 分類 | 不合格の理由 | 最後の返答（先頭 100 字） |', '|---|---|---|---|---|', ...lines].join('\n') + '\n');
console.log(`wrote ${out}`);
process.exit(pass === cases.length ? 0 : 1);
