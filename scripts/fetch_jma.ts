// 気象庁「日本沿岸域の海面水温情報」海域 623（周防灘）を取得し、apps/api/data/suonada.json を生成する。
// 実行時に気象庁へアクセスしないよう、ビルド／デプロイ前に手で1回実行する（docs/03）。
//   node scripts/fetch_jma.ts [areaNo]
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AREA = process.argv[2] ?? '623';
const BASE = 'https://www.data.jma.go.jp/kaiyou/data/db/kaikyo/series/engan/txt';
const DAILY_URL = `${BASE}/area${AREA}.txt`; // yyyy,mm,dd,areaNo.,flag,Temp.（flag P=速報 R=再解析、欠損 -9999）
const STATS_URL = `${BASE}/area${AREA}-stat.txt`; // 0000,mm,dd,areaNo.,Norm.,Ave.,Max.,Min.（周防灘は Norm. が欠損）

type Daily = { date: string; temp: number | null; flag: string };
type Stat = { mmdd: string; mean: number | null; max: number | null; min: number | null };

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../apps/api/data/suonada.json');

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.text();
}

function num(s: string): number | null {
  const v = Number(s.trim());
  return Number.isFinite(v) && v > -9000 ? v : null;
}

const dailyText = await fetchText(DAILY_URL);
const daily: Daily[] = [];
for (const line of dailyText.split(/\r?\n/)) {
  const m = /^(\d{4}),(\d{2}),(\d{2}),(\d+),([PR]),\s*(-?[\d.]+)/.exec(line);
  if (!m) continue;
  daily.push({ date: `${m[1]}-${m[2]}-${m[3]}`, temp: num(m[6]), flag: m[5] });
}
if (daily.length === 0) throw new Error('daily: no rows parsed');

const statsText = await fetchText(STATS_URL);
const stats5y: Stat[] = [];
let statsPeriod = '';
for (const line of statsText.split(/\r?\n/)) {
  const p = /^Period of Ave\.\/Max\.\/Min\.\s*:\s*(.+)$/.exec(line);
  if (p) statsPeriod = p[1].trim();
  const m = /^0000,(\d{2}),(\d{2}),(\d+),\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)/.exec(line);
  if (!m) continue;
  stats5y.push({ mmdd: `${m[1]}-${m[2]}`, mean: num(m[5]), max: num(m[6]), min: num(m[7]) });
}
if (stats5y.length === 0) throw new Error('stats: no rows parsed');

const json = {
  source: '気象庁「日本沿岸域の海面水温情報」',
  area_no: Number(AREA),
  area_name: AREA === '623' ? '周防灘' : `海域${AREA}`,
  urls: { daily: DAILY_URL, stats: STATS_URL },
  fetched_at: new Date().toISOString(),
  stats_period: statsPeriod,
  daily,
  stats5y,
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(json));
const last = daily[daily.length - 1];
console.log(`wrote ${out}: daily ${daily.length} rows (${daily[0].date} .. ${last.date}, last ${last.temp}℃), stats5y ${stats5y.length} rows (${statsPeriod})`);
