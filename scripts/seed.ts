// data/seed_records.csv → D1 投入用 SQL を標準出力に出す
// 使い方: node scripts/seed.ts data/seed_records.csv > seed.sql
import { readFileSync } from 'node:fs';

const path = process.argv[2] ?? 'data/seed_records.csv';
const lines = readFileSync(path, 'utf8').trim().split(/\r?\n/);
const header = lines.shift()!.split(',');
const col = (name: string) => {
  const i = header.indexOf(name);
  if (i < 0) throw new Error(`column not found: ${name}`);
  return i;
};
const iDate = col('日時');
const iWork = col('作業');
const iLoc = col('沖出し場所');
const iLot = col('ロット番号');
const iW = col('サイズ(g)');
const iCnt = col('入数(個/かご)');
const iMort = col('斃死(個)');
const iBask = col('かご数');
const iRaw = col('元の発話');

const q = (v: string | null | undefined) => (v == null || v === '' ? 'NULL' : `'${v.replace(/'/g, "''")}'`);
const n = (v: string | undefined) => (v == null || v === '' ? 'NULL' : String(Number(v)));

const out: string[] = ["DELETE FROM records WHERE source = 'seed';"];
for (const line of lines) {
  if (!line.trim()) continue;
  const cells = line.split(',');
  // 「3番ライン・上段」→ line=3, tier=上段
  const m = cells[iLoc].match(/(\d+)番ライン(?:・(上段|中段|下段))?/);
  const locLine = m ? m[1] : null;
  const locTier = m?.[2] ?? null;
  const recordedAt = cells[iDate].replace(' ', 'T') + ':00+09:00';
  out.push(
    `INSERT INTO records (recorded_at, work_type, location_line, location_tier, lot_no, avg_weight_g, count_per_basket, mortality, basket_count, raw_text, source) VALUES (` +
      [
        q(recordedAt),
        q(cells[iWork]),
        locLine ?? 'NULL',
        q(locTier),
        q(cells[iLot]),
        n(cells[iW]),
        n(cells[iCnt]),
        n(cells[iMort]),
        n(cells[iBask]),
        q(cells[iRaw]),
        "'seed'",
      ].join(', ') +
      ');',
  );
}
process.stdout.write(out.join('\n') + '\n');
