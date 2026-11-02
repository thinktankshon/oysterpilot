// Oyscan 全国版のデータ取り込み（ビルド時に 1 回。実行時は気象庁へアクセスしない）
//   node scripts/fetch_scan_areas.ts
// 1) 気象庁「日本沿岸域の海面水温情報」全 106 海域の日別・5 年統計を取り、海域ごとの指標を計算
// 2) 気象庁「過去の気象データ」気象官署（代表観測所）の日降水量を 5 年分取り、雨量の指標を計算
// 3) 本土沿岸の海域に地図用の中心点を与え、最寄りの観測所を割り当てて apps/api/data/scan_areas.json に書く
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../apps/api/data/scan_areas.json');
const CACHE_DIR = resolve(here, '../.cache/jma');
mkdirSync(CACHE_DIR, { recursive: true });

const SST_BASE = 'https://www.data.jma.go.jp/kaiyou/data/db/kaikyo/series/engan/txt';
const ETRN = 'https://www.data.jma.go.jp/stats/etrn/view/daily_s1.php';
const HOT_C = 28;
const COLD_C = 10;
const GROWTH = [15, 25] as const;
const HEAVY_MM = 50;
const HOT_DAYS_STREAK = 7;

// ---- 海域（番号, 名前, 地図用中心点）。離島・千島は中心点なし（データは取るが地図に出さない） ----
type AreaDef = { no: number; name: string; lat?: number; lng?: number };
const AREAS: AreaDef[] = [
  { no: 101, name: '宗谷地方オホーツク海沿岸', lat: 45.3, lng: 142.3 }, { no: 102, name: '紋別地方沿岸', lat: 44.4, lng: 143.6 },
  { no: 103, name: '網走地方沿岸', lat: 44.1, lng: 144.4 }, { no: 104, name: '知床岬の東', lat: 44.3, lng: 145.6 },
  { no: 105, name: '根室海峡', lat: 43.9, lng: 145.2 }, { no: 106, name: '宗谷地方日本海沿岸', lat: 45.2, lng: 141.4 },
  { no: 107, name: '留萌地方沿岸北部', lat: 44.6, lng: 141.5 }, { no: 108, name: '留萌地方沿岸南部', lat: 44.0, lng: 141.5 },
  { no: 109, name: '石狩地方沿岸', lat: 43.3, lng: 141.1 }, { no: 110, name: '後志北部沿岸', lat: 43.3, lng: 140.6 },
  { no: 111, name: '後志西部沿岸', lat: 42.8, lng: 140.1 }, { no: 112, name: '檜山地方沿岸', lat: 42.1, lng: 139.9 },
  { no: 113, name: '津軽海峡の西側', lat: 41.3, lng: 140.0 }, { no: 114, name: '青森県日本海沿岸', lat: 40.7, lng: 139.9 },
  { no: 115, name: '津軽海峡', lat: 41.4, lng: 140.7 }, { no: 116, name: '津軽海峡の東側', lat: 41.5, lng: 141.4 },
  { no: 117, name: '青森県太平洋沿岸', lat: 40.7, lng: 141.7 }, { no: 118, name: '内浦湾', lat: 42.3, lng: 140.6 },
  { no: 119, name: '胆振中・東部沿岸', lat: 42.4, lng: 141.7 }, { no: 120, name: '日高地方南西沿岸', lat: 42.0, lng: 142.6 },
  { no: 121, name: '十勝地方沿岸', lat: 42.6, lng: 143.7 }, { no: 122, name: '釧路地方沿岸', lat: 42.8, lng: 144.6 },
  { no: 123, name: '根室地方太平洋沿岸', lat: 43.1, lng: 145.5 },
  { no: 124, name: '国後島南東沿岸' }, { no: 125, name: '色丹島の南東側' }, { no: 126, name: '択捉島オホーツク海沿岸' },
  { no: 127, name: '択捉島太平洋沿岸' }, { no: 128, name: 'ウルップ島沿岸' }, { no: 129, name: 'ウルップ水道' },
  { no: 130, name: '陸奥湾', lat: 41.0, lng: 140.9 }, { no: 131, name: '秋田県沿岸', lat: 39.6, lng: 139.9 },
  { no: 132, name: '岩手県北部沿岸', lat: 40.0, lng: 142.1 }, { no: 133, name: '岩手県南部沿岸', lat: 39.2, lng: 142.1 },
  { no: 134, name: '山形県沿岸', lat: 38.7, lng: 139.6 }, { no: 135, name: '宮城県沿岸', lat: 38.3, lng: 141.4 },
  { no: 136, name: '福島県沿岸', lat: 37.3, lng: 141.2 }, { no: 137, name: '茨城県北部沿岸', lat: 36.7, lng: 140.9 },
  { no: 138, name: '茨城県南部沿岸', lat: 36.1, lng: 140.8 },
  { no: 303, name: '千葉県北東部沿岸', lat: 35.6, lng: 140.9 }, { no: 304, name: '千葉県南部沿岸', lat: 35.0, lng: 140.0 },
  { no: 306, name: '相模湾', lat: 35.2, lng: 139.4 }, { no: 307, name: '伊豆諸島北部沿岸' }, { no: 308, name: '三宅島沿岸' },
  { no: 309, name: '八丈島沿岸' }, { no: 310, name: '駿河湾', lat: 34.9, lng: 138.6 }, { no: 311, name: '遠州灘', lat: 34.5, lng: 137.8 },
  { no: 313, name: '熊野灘', lat: 33.9, lng: 136.4 }, { no: 314, name: '下越沿岸', lat: 38.0, lng: 139.1 },
  { no: 315, name: '佐渡沿岸', lat: 38.0, lng: 138.3 }, { no: 316, name: '中越沿岸', lat: 37.5, lng: 138.6 },
  { no: 317, name: '上越沿岸', lat: 37.2, lng: 138.1 }, { no: 318, name: '富山湾', lat: 36.9, lng: 137.2 },
  { no: 319, name: '能登北部沿岸', lat: 37.4, lng: 137.0 }, { no: 320, name: '能登南部・加賀沿岸', lat: 36.7, lng: 136.5 },
  { no: 321, name: '福井県沿岸', lat: 36.0, lng: 135.9 },
  { no: 501, name: '京都府沿岸', lat: 35.7, lng: 135.2 }, { no: 502, name: '兵庫県北部沿岸', lat: 35.7, lng: 134.7 },
  { no: 503, name: '鳥取県東部沿岸', lat: 35.6, lng: 134.2 }, { no: 504, name: '鳥取県西部沿岸', lat: 35.6, lng: 133.5 },
  { no: 505, name: '隠岐沿岸', lat: 36.2, lng: 133.2 }, { no: 506, name: '島根県東部沿岸', lat: 35.6, lng: 132.9 },
  { no: 507, name: '島根県西部沿岸', lat: 35.0, lng: 132.1 }, { no: 508, name: '安芸灘・伊予灘', lat: 33.9, lng: 132.4 },
  { no: 509, name: '備後灘・燧灘', lat: 34.2, lng: 133.3 }, { no: 510, name: '播磨灘・備讃瀬戸', lat: 34.5, lng: 134.3 },
  { no: 511, name: '紀伊水道', lat: 33.9, lng: 134.9 }, { no: 512, name: '紀伊水道沖', lat: 33.5, lng: 135.0 },
  { no: 513, name: '和歌山県南部沿岸（紀伊水道側）', lat: 33.7, lng: 135.3 }, { no: 514, name: '和歌山県南部沿岸（熊野灘側）', lat: 33.6, lng: 135.9 },
  { no: 515, name: '高知県東部沿岸', lat: 33.4, lng: 134.2 }, { no: 516, name: '土佐湾', lat: 33.3, lng: 133.6 },
  { no: 517, name: '高知県西部沿岸', lat: 32.9, lng: 132.9 }, { no: 518, name: '豊後水道南部', lat: 32.9, lng: 132.3 },
  { no: 519, name: '豊後水道北部', lat: 33.3, lng: 132.1 }, { no: 520, name: '大阪湾', lat: 34.5, lng: 135.2 },
  { no: 601, name: '山口県沿岸北部', lat: 34.6, lng: 131.3 }, { no: 602, name: '玄界灘・響灘', lat: 33.9, lng: 130.4 },
  { no: 603, name: '壱岐水道', lat: 33.7, lng: 129.8 }, { no: 604, name: '対馬沿岸南部', lat: 34.2, lng: 129.3 },
  { no: 605, name: '対馬沿岸北部', lat: 34.6, lng: 129.4 }, { no: 606, name: '五島列島沿岸西部', lat: 32.8, lng: 128.6 },
  { no: 607, name: '男女群島沿岸' }, { no: 608, name: '五島灘', lat: 32.8, lng: 129.4 },
  { no: 609, name: '天草灘・甑島沿岸北部', lat: 32.2, lng: 129.9 }, { no: 610, name: '甑島沿岸南部', lat: 31.7, lng: 129.7 },
  { no: 611, name: '黒島沿岸' }, { no: 612, name: '大隅海峡', lat: 31.0, lng: 130.9 }, { no: 613, name: '種子島・屋久島沿岸', lat: 30.5, lng: 130.8 },
  { no: 614, name: '屋久島沿岸南西部' }, { no: 615, name: 'トカラ列島沿岸北部' }, { no: 616, name: 'トカラ列島沿岸南部' },
  { no: 617, name: '奄美群島沿岸北西部' }, { no: 618, name: '奄美群島沿岸南西部' }, { no: 619, name: '奄美群島沿岸南東部' }, { no: 620, name: '奄美群島沿岸北東部' },
  { no: 621, name: '日向灘南部', lat: 31.6, lng: 131.6 }, { no: 622, name: '日向灘北部', lat: 32.5, lng: 131.9 },
  { no: 623, name: '周防灘', lat: 33.7, lng: 131.3 },
];

// ---- 代表観測所（気象官署）。prec_no/block_no は気象庁の過去データ検索の値。名前は取得時に照合する ----
type StationDef = { name: string; prec: number; block: number; lat: number; lng: number };
const STATIONS: StationDef[] = [
  { name: '稚内', prec: 11, block: 47401, lat: 45.42, lng: 141.68 }, { name: '札幌', prec: 14, block: 47412, lat: 43.06, lng: 141.33 },
  { name: '網走', prec: 17, block: 47409, lat: 44.02, lng: 144.28 }, { name: '釧路', prec: 19, block: 47418, lat: 42.98, lng: 144.38 },
  { name: '室蘭', prec: 21, block: 47423, lat: 42.31, lng: 140.97 }, { name: '函館', prec: 23, block: 47430, lat: 41.82, lng: 140.75 },
  { name: '青森', prec: 31, block: 47575, lat: 40.82, lng: 140.77 }, { name: '八戸', prec: 31, block: 47581, lat: 40.53, lng: 141.52 },
  { name: '秋田', prec: 32, block: 47582, lat: 39.72, lng: 140.1 }, { name: '宮古', prec: 33, block: 47585, lat: 39.65, lng: 141.97 },
  { name: '仙台', prec: 34, block: 47590, lat: 38.26, lng: 140.9 }, { name: '小名浜', prec: 36, block: 47598, lat: 36.95, lng: 140.9 },
  { name: '新潟', prec: 54, block: 47604, lat: 37.89, lng: 139.02 }, { name: '金沢', prec: 56, block: 47605, lat: 36.59, lng: 136.63 },
  { name: '銚子', prec: 45, block: 47648, lat: 35.74, lng: 140.86 }, { name: '東京', prec: 44, block: 47662, lat: 35.69, lng: 139.75 },
  { name: '静岡', prec: 50, block: 47656, lat: 34.98, lng: 138.4 }, { name: '名古屋', prec: 51, block: 47636, lat: 35.17, lng: 136.97 },
  { name: '尾鷲', prec: 53, block: 47663, lat: 34.07, lng: 136.19 }, { name: '大阪', prec: 62, block: 47772, lat: 34.68, lng: 135.52 },
  { name: '和歌山', prec: 65, block: 47777, lat: 34.23, lng: 135.16 }, { name: '舞鶴', prec: 61, block: 47750, lat: 35.45, lng: 135.32 },
  { name: '松江', prec: 68, block: 47741, lat: 35.46, lng: 133.07 }, { name: '広島', prec: 67, block: 47765, lat: 34.4, lng: 132.46 },
  { name: '高松', prec: 72, block: 47891, lat: 34.32, lng: 134.05 }, { name: '高知', prec: 74, block: 47893, lat: 33.57, lng: 133.55 },
  { name: '下関', prec: 81, block: 47762, lat: 33.95, lng: 130.93 }, { name: '福岡', prec: 82, block: 47807, lat: 33.58, lng: 130.38 },
  { name: '大分', prec: 83, block: 47815, lat: 33.24, lng: 131.62 }, { name: '長崎', prec: 84, block: 47817, lat: 32.73, lng: 129.87 },
  { name: '熊本', prec: 86, block: 47819, lat: 32.81, lng: 130.71 }, { name: '宮崎', prec: 87, block: 47830, lat: 31.94, lng: 131.41 },
  { name: '鹿児島', prec: 88, block: 47827, lat: 31.56, lng: 130.55 },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function fetchText(url: string, cacheKey: string): Promise<string> {
  const f = resolve(CACHE_DIR, cacheKey);
  if (existsSync(f)) return readFileSync(f, 'utf-8');
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url);
    if (res.ok) {
      const t = await res.text();
      writeFileSync(f, t);
      await sleep(250); // 気象庁に負荷をかけない
      return t;
    }
    await sleep(1500 * (attempt + 1));
  }
  throw new Error(`fetch failed: ${url}`);
}
const num = (s: string) => {
  const v = Number(String(s).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(v) && v > -9000 && s.trim() !== '' && !/^-+$/.test(s.trim()) ? v : null;
};

// ---- 1) 水温 ----
type Daily = { date: string; temp: number | null };
async function fetchSst(no: number) {
  const dailyText = await fetchText(`${SST_BASE}/area${no}.txt`, `area${no}.txt`);
  const daily: Daily[] = [];
  for (const line of dailyText.split(/\r?\n/)) {
    const m = /^(\d{4}),(\d{2}),(\d{2}),(\d+),([PR]),\s*(-?[\d.]+)/.exec(line);
    if (m) daily.push({ date: `${m[1]}-${m[2]}-${m[3]}`, temp: num(m[6]) });
  }
  const statsText = await fetchText(`${SST_BASE}/area${no}-stat.txt`, `area${no}-stat.txt`).catch(() => '');
  const stats: Record<string, { mean: number | null; max: number | null; min: number | null }> = {};
  let statsPeriod = '';
  for (const line of statsText.split(/\r?\n/)) {
    const p = /^Period of Ave\.\/Max\.\/Min\.\s*:\s*(.+)$/.exec(line);
    if (p) statsPeriod = p[1].trim();
    const m = /^0000,(\d{2}),(\d{2}),(\d+),\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)/.exec(line);
    if (m) stats[`${m[1]}-${m[2]}`] = { mean: num(m[5]), max: num(m[6]), min: num(m[7]) };
  }
  return { daily, stats, statsPeriod };
}

function sstMetrics(daily: Daily[], stats: ReturnType<typeof Object>, years: number[]) {
  const valid = daily.filter((d) => d.temp != null) as { date: string; temp: number }[];
  let hotTotal = 0, coldTotal = 0, growthTotal = 0, yearsWithStreak = 0, maxStreak = 0, n = 0;
  for (const y of years) {
    const rows = valid.filter((d) => d.date.startsWith(String(y)));
    if (rows.length < 300) continue; // 欠測が多い年は除く
    n++;
    let streak = 0, best = 0;
    for (const d of rows) {
      streak = d.temp >= HOT_C ? streak + 1 : 0;
      if (streak > best) best = streak;
    }
    if (best >= HOT_DAYS_STREAK) yearsWithStreak++;
    if (best > maxStreak) maxStreak = best;
    hotTotal += rows.filter((d) => d.temp >= HOT_C).length;
    coldTotal += rows.filter((d) => d.temp < COLD_C).length;
    growthTotal += rows.filter((d) => d.temp >= GROWTH[0] && d.temp <= GROWTH[1]).length;
  }
  const last = valid[valid.length - 1];
  const recent = valid.slice(-7).map((d) => d.temp);
  const mean7 = recent.length ? Math.round((recent.reduce((a, b) => a + b, 0) / recent.length) * 10) / 10 : null;
  const st = last ? (stats as Record<string, { mean: number | null; max: number | null; min: number | null }>)[last.date.slice(5, 10)] : undefined;
  const k = Math.max(1, n);
  return {
    years_used: n,
    hot_days_avg: Math.round(hotTotal / k),
    cold_days_avg: Math.round(coldTotal / k),
    growth_days_avg: Math.round(growthTotal / k),
    max_streak_days: maxStreak,
    years_with_streak: yearsWithStreak,
    recent: { mean7, as_of: last?.date ?? '', vs5y_mean: st?.mean ?? null, vs5y_max: st?.max ?? null, vs5y_min: st?.min ?? null, diff: mean7 != null && st?.mean != null ? Math.round((mean7 - st.mean) * 10) / 10 : null },
  };
}

// ---- 2) 雨量（気象官署の日別表） ----
async function fetchRain(st: StationDef, years: number[]) {
  const byYear: Record<number, number[]> = {};
  const byYearJunOct: Record<number, number[]> = {};
  let verified = false;
  for (const y of years) {
    for (let m = 1; m <= 12; m++) {
      const url = `${ETRN}?prec_no=${st.prec}&block_no=${st.block}&year=${y}&month=${m}&day=&view=`;
      const html = await fetchText(url, `etrn_${st.block}_${y}_${String(m).padStart(2, '0')}.html`);
      if (!verified) {
        const sel = /<option value="\d+"\s+selected[^>]*>([^<]+)<\/option>/.exec(html);
        if (sel && !sel[1].includes(st.name)) console.warn(`  !! station mismatch for ${st.name}: page says ${sel[1]}`);
        verified = true;
      }
      const rows = html.match(/<tr[^>]*class="mtx"[^>]*>[\s\S]*?<\/tr>/g) ?? [];
      for (const r of rows) {
        const cells = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1].replace(/<[^>]+>/g, '').trim());
        if (!cells.length || !/^\d{1,2}$/.test(cells[0])) continue;
        const v = num(cells[3]); // 降水量 合計(mm)
        if (v == null) continue;
        (byYear[y] ??= []).push(v);
        if (m >= 6 && m <= 10) (byYearJunOct[y] ??= []).push(v);
      }
    }
    process.stdout.write('.');
  }
  const ys = Object.keys(byYear).map(Number);
  const k = Math.max(1, ys.length);
  const annual = ys.map((y) => byYear[y].reduce((a, b) => a + b, 0));
  const heavy = ys.map((y) => byYear[y].filter((v) => v >= HEAVY_MM).length);
  const heavyJO = ys.map((y) => (byYearJunOct[y] ?? []).filter((v) => v >= HEAVY_MM).length);
  return {
    years_used: ys.length,
    annual_mm_avg: Math.round(annual.reduce((a, b) => a + b, 0) / k),
    heavy_days_avg: Math.round((heavy.reduce((a, b) => a + b, 0) / k) * 10) / 10,
    heavy_days_jun_oct_avg: Math.round((heavyJO.reduce((a, b) => a + b, 0) / k) * 10) / 10,
  };
}

function distKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// ---- main ----
const probe = await fetchSst(623);
const lastYear = Number(probe.daily[probe.daily.length - 1].date.slice(0, 4));
const YEARS = [lastYear - 5, lastYear - 4, lastYear - 3, lastYear - 2, lastYear - 1];
console.log('years', YEARS);

console.log('rain: stations', STATIONS.length);
const rainByStation: Record<string, Awaited<ReturnType<typeof fetchRain>>> = {};
for (const st of STATIONS) {
  process.stdout.write(`  ${st.name} `);
  rainByStation[st.name] = await fetchRain(st, YEARS);
  console.log(' ok', rainByStation[st.name].annual_mm_avg, 'mm', rainByStation[st.name].heavy_days_avg, 'd≥50');
}

console.log('sst: areas', AREAS.length);
const areas = [];
for (const a of AREAS) {
  try {
    const { daily, stats, statsPeriod } = await fetchSst(a.no);
    const sst = sstMetrics(daily, stats, YEARS);
    let station: { name: string; lat: number; lng: number } | null = null;
    let rain: { years_used: number; annual_mm_avg: number; heavy_days_avg: number; heavy_days_jun_oct_avg: number } | null = null;
    if (a.lat != null && a.lng != null) {
      const here = a as { lat: number; lng: number };
      const near = STATIONS.filter((s) => rainByStation[s.name]?.years_used > 0)
        .map((s) => ({ s, d: Math.max(5, distKm(here, s)) }))
        .sort((x, y) => x.d - y.d)
        .slice(0, 2);
      const w = near.map((n) => 1 / n.d);
      const W = w.reduce((p, q) => p + q, 0);
      const avg = (f: (r: NonNullable<typeof rain>) => number) =>
        Math.round((near.reduce((acc, n, i) => acc + f(rainByStation[n.s.name]) * w[i], 0) / W) * 10) / 10;
      rain = {
        years_used: Math.min(...near.map((n) => rainByStation[n.s.name].years_used)),
        annual_mm_avg: Math.round(avg((r) => r.annual_mm_avg)),
        heavy_days_avg: avg((r) => r.heavy_days_avg),
        heavy_days_jun_oct_avg: avg((r) => r.heavy_days_jun_oct_avg),
      };
      station = { name: near.map((n) => n.s.name).join('・'), lat: near[0].s.lat, lng: near[0].s.lng };
    }
    areas.push({
      no: a.no, name: a.name, lat: a.lat ?? null, lng: a.lng ?? null, on_map: a.lat != null,
      stats_period: statsPeriod, sst, station, rain,
    });
    process.stdout.write(`${a.no} `);
  } catch (e) {
    console.warn(`\n  !! area ${a.no} failed: ${e instanceof Error ? e.message : e}`);
  }
}
console.log();
const out = {
  source: { sst: '気象庁「日本沿岸域の海面水温情報」（海域平均・実績値）', rain: '気象庁「過去の気象データ」気象官署の日降水量（最寄り 2 観測所の距離加重平均）' },
  generated_at: new Date().toISOString(), years: YEARS,
  thresholds_used: { hot_c: HOT_C, cold_c: COLD_C, growth_band_c: GROWTH, heavy_rain_mm: HEAVY_MM, hot_streak_days: HOT_DAYS_STREAK },
  stations: STATIONS.map((s) => ({ ...s, rain: rainByStation[s.name] })),
  areas,
};
writeFileSync(OUT, JSON.stringify(out));
console.log(`wrote ${OUT}: ${areas.length} areas, ${areas.filter((x) => x.on_map).length} on map`);
