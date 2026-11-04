// Voysy の読み取り精度レポート。/api/voysy/accuracy（抽出結果 vs 人が直して保存した記録）を取り、
// knowledge/voysy_accuracy_<日付>.md に書く。崩れ方の対応表（prompts/voysy_extract.md・voysyParse.ts）を足す材料にする。
// 使い方: pnpm accuracy                     （ローカル API http://localhost:8787）
//        本番は環境変数 EVAL_URL に URL、共有パスワードを環境変数 DEMO_KEY に入れて pnpm accuracy
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const URL_BASE = process.env.EVAL_URL ?? 'http://localhost:8787';
const DEMO_KEY = process.env.DEMO_KEY ?? '';

type FieldDiff = { field: string; model: string | null; saved: string | null; kind: string };
type Diff = { extraction_id: number; created_at: string; raw_text: string; work_type_model: string; work_type_saved: string; diffs: FieldDiff[]; matched: number };
type Summary = { extractions: number; fields_total: number; fields_matched: number; by_field: Record<string, Record<string, number>> };

const res = await fetch(`${URL_BASE}/api/voysy/accuracy?limit=500`, { headers: DEMO_KEY ? { 'X-Demo-Key': DEMO_KEY } : {} });
if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
const { summary, diffs } = (await res.json()) as { summary: Summary; diffs: Diff[] };

const KIND_JA: Record<string, string> = { filled: '空→人が埋めた', corrected: '値を直した', cleared: '人が消した' };
const date = new Date().toISOString().slice(0, 10);
const rate = summary.fields_total ? Math.round((summary.fields_matched / summary.fields_total) * 1000) / 10 : 0;
const lines: string[] = [
  `# Voysy 読み取り精度（${date}）`,
  '',
  `抽出 ${summary.extractions} 件、項目 ${summary.fields_total}、一致 ${summary.fields_matched}（${rate}%）。`,
  '「空→人が埋めた」は読み取れなかった項目、「値を直した」は読み違い、「人が消した」は余計に拾った項目。',
  '',
  '## 項目別',
  '',
  '| 項目 | 空→人が埋めた | 値を直した | 人が消した |',
  '|---|---|---|---|',
  ...Object.entries(summary.by_field)
    .sort((a, b) => (b[1].filled + b[1].corrected + b[1].cleared) - (a[1].filled + a[1].corrected + a[1].cleared))
    .map(([f, v]) => `| ${f} | ${v.filled} | ${v.corrected} | ${v.cleared} |`),
  '',
  '## 直した内容（新しい順）',
  '',
  '| 抽出 | 作業（読み取り→保存） | 項目 | 読み取り | 保存 | 種類 | 元の文 |',
  '|---|---|---|---|---|---|---|',
];
for (const d of diffs) {
  for (const f of d.diffs) {
    lines.push(`| ${d.extraction_id} | ${d.work_type_model}→${d.work_type_saved} | ${f.field} | ${f.model ?? '—'} | ${f.saved ?? '—'} | ${KIND_JA[f.kind] ?? f.kind} | ${d.raw_text.replace(/\|/g, '／').slice(0, 80)} |`);
  }
}
lines.push('');
const file = join(here, `../knowledge/voysy_accuracy_${date}.md`);
writeFileSync(file, lines.join('\n'));
console.log(`抽出 ${summary.extractions} 件、一致率 ${rate}% → ${file}`);
