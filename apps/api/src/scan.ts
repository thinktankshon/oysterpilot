import { Hono } from 'hono';
import Anthropic from '@anthropic-ai/sdk';
import reportTemplate from '../../../prompts/oyscan_report.md';
import scanAreas from '../data/scan_areas.json';
import { getRulesConfig } from './rulesConfig';
import type { Bindings } from './types';

// 全国版 Oyscan（docs/03）。データは scripts/fetch_scan_areas.ts がビルド時に作る。実行時に気象庁へはアクセスしない。
const REPORT_MODEL = 'claude-sonnet-5-5';
const FORBIDDEN = /必ず|安全です|最適です|予測|予報|死にます|来年は/;
const REAL_NAMES = /中津②|那佐|浅川|Oysmart|オイスマート/;

export type AreaSst = {
  years_used: number;
  hot_days_avg: number;
  cold_days_avg: number;
  growth_days_avg: number;
  max_streak_days: number;
  years_with_streak: number;
  recent: { mean7: number | null; as_of: string; vs5y_mean: number | null; vs5y_max: number | null; vs5y_min: number | null; diff: number | null };
};
export type AreaRain = { years_used: number; annual_mm_avg: number; heavy_days_avg: number; heavy_days_jun_oct_avg: number };
export type ScanArea = {
  no: number;
  name: string;
  lat: number | null;
  lng: number | null;
  on_map: boolean;
  stats_period: string;
  sst: AreaSst;
  station: { name: string; lat: number; lng: number } | null;
  rain: AreaRain | null;
};
type ScanData = {
  source: { sst: string; rain: string };
  generated_at: string;
  years: number[];
  thresholds_used: { hot_c: number; cold_c: number; growth_band_c: [number, number]; heavy_rain_mm: number; hot_streak_days: number };
  areas: ScanArea[];
};

export type Level3 = 'low' | 'mid' | 'high';
export type Speed3 = 'good' | 'normal' | 'slow';
export type ScanEvaluation = {
  area: Pick<ScanArea, 'no' | 'name' | 'lat' | 'lng' | 'stats_period' | 'station'>;
  distance_km: number;
  years: number[];
  mortality_risk: { level: Level3; hot_level: Level3; heavy_level: Level3; hot_days_avg: number; heavy_days_jun_oct_avg: number | null; max_streak_days: number; years_with_streak: number };
  growth_speed: { level: Speed3; growth_days_avg: number; cold_days_avg: number; penalized: boolean };
  rain: AreaRain | null;
  recent: AreaSst['recent'];
  season_label: string;
  source: ScanData['source'];
};

type OyscanCfg = {
  heavy_rain_mm: number;
  map_pick_radius_km: number;
  mortality_risk: { hot_days_low_max: number; hot_days_mid_max: number; heavy_days_low_max: number; heavy_days_mid_max: number };
  growth_speed: { growth_days_good_min: number; growth_days_slow_max: number; cold_days_penalty_min: number };
  labels: { mortality_risk: Record<Level3, string>; growth_speed: Record<Speed3, string> };
};

const data = scanAreas as unknown as ScanData;
export const scan = new Hono<{ Bindings: Bindings }>();

function cfg(): OyscanCfg {
  return (getRulesConfig() as unknown as { oyscan: OyscanCfg }).oyscan;
}

function distKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** クリック地点に最も近い（地図に出している）海域。半径外なら null */
export function nearestArea(lat: number, lng: number): { area: ScanArea; distance_km: number } | null {
  let best: { area: ScanArea; distance_km: number } | null = null;
  for (const a of data.areas) {
    if (!a.on_map || a.lat == null || a.lng == null) continue;
    const d = distKm({ lat, lng }, { lat: a.lat, lng: a.lng });
    if (!best || d < best.distance_km) best = { area: a, distance_km: d };
  }
  return best && best.distance_km <= cfg().map_pick_radius_km ? best : null;
}

const RANK: Level3[] = ['low', 'mid', 'high'];
const SPEED_RANK: Speed3[] = ['slow', 'normal', 'good'];

export function evaluateArea(area: ScanArea, distance_km: number): ScanEvaluation {
  const c = cfg();
  const hot = area.sst.hot_days_avg;
  const heavy = area.rain?.heavy_days_jun_oct_avg ?? null;
  const hotLevel: Level3 = hot <= c.mortality_risk.hot_days_low_max ? 'low' : hot <= c.mortality_risk.hot_days_mid_max ? 'mid' : 'high';
  const heavyLevel: Level3 =
    heavy == null ? 'low' : heavy <= c.mortality_risk.heavy_days_low_max ? 'low' : heavy <= c.mortality_risk.heavy_days_mid_max ? 'mid' : 'high';
  // 2 軸の点数（低0・中1・高2）の合計：0〜1＝低、2＝中、3〜4＝高
  const score = RANK.indexOf(hotLevel) + RANK.indexOf(heavyLevel);
  const level: Level3 = score <= 1 ? 'low' : score === 2 ? 'mid' : 'high';

  const g = area.sst.growth_days_avg;
  let sIdx = g >= c.growth_speed.growth_days_good_min ? 2 : g <= c.growth_speed.growth_days_slow_max ? 0 : 1;
  const penalized = area.sst.cold_days_avg >= c.growth_speed.cold_days_penalty_min;
  if (penalized) sIdx = Math.max(0, sIdx - 1);

  const m7 = area.sst.recent.mean7;
  const season_label =
    m7 == null ? '' : m7 >= 28 ? '斃死が増えやすい時期' : m7 < 10 ? '生育が鈍る時期' : m7 >= 15 && m7 <= 25 ? '成長しやすい時期' : '成長が緩やかな時期';

  return {
    area: { no: area.no, name: area.name, lat: area.lat, lng: area.lng, stats_period: area.stats_period, station: area.station },
    distance_km: Math.round(distance_km),
    years: data.years,
    mortality_risk: {
      level,
      hot_level: hotLevel,
      heavy_level: heavyLevel,
      hot_days_avg: hot,
      heavy_days_jun_oct_avg: heavy,
      max_streak_days: area.sst.max_streak_days,
      years_with_streak: area.sst.years_with_streak,
    },
    growth_speed: { level: SPEED_RANK[sIdx], growth_days_avg: g, cold_days_avg: area.sst.cold_days_avg, penalized },
    rain: area.rain,
    recent: area.sst.recent,
    season_label,
    source: data.source,
  };
}

function parseLatLng(b: unknown): { lat: number; lng: number } | null {
  const o = (b ?? {}) as Record<string, unknown>;
  const lat = Number(o.lat);
  const lng = Number(o.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

// GET /api/scan/areas  地図に出す海域の中心点と評価（全国）
scan.get('/areas', (c) => {
  const list = data.areas
    .filter((a) => a.on_map)
    .map((a) => {
      const ev = evaluateArea(a, 0);
      return { no: a.no, name: a.name, lat: a.lat, lng: a.lng, mortality_risk: ev.mortality_risk.level, growth_speed: ev.growth_speed.level };
    });
  return c.json({ generated_at: data.generated_at, years: data.years, labels: cfg().labels, areas: list });
});

// POST /api/scan/evaluate { lat, lng }
scan.post('/evaluate', async (c) => {
  const p = parseLatLng(await c.req.json().catch(() => null));
  if (!p) return c.json({ error: 'lat and lng are required' }, 400);
  const hit = nearestArea(p.lat, p.lng);
  if (!hit) return c.json({ error: 'この地点の近くに対応する海域がありません（本土沿岸の海をクリックしてください）', supported: false }, 422);
  return c.json({ supported: true, ...p, evaluation: evaluateArea(hit.area, hit.distance_km), labels: cfg().labels });
});

// POST /api/scan/report { lat, lng } → { id, report_text, evaluation }
scan.post('/report', async (c) => {
  const p = parseLatLng(await c.req.json().catch(() => null));
  if (!p) return c.json({ error: 'lat and lng are required' }, 400);
  const hit = nearestArea(p.lat, p.lng);
  if (!hit) return c.json({ error: 'この地点の近くに対応する海域がありません' }, 422);
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: 'ANTHROPIC_API_KEY が未設定です' }, 503);
  const ev = evaluateArea(hit.area, hit.distance_km);
  const labels = cfg().labels;
  const promptMetrics = {
    mortality_risk: { ...ev.mortality_risk, label: labels.mortality_risk[ev.mortality_risk.level] },
    growth_speed: { ...ev.growth_speed, label: labels.growth_speed[ev.growth_speed.level] },
    rain: ev.rain,
    recent: ev.recent,
    season_label: ev.season_label,
    years: ev.years,
  };
  const system = reportTemplate
    .replace('{{area_name}}', ev.area.name)
    .replace('{{area_no}}', String(ev.area.no))
    .replace('{{lat}}', p.lat.toFixed(3))
    .replace('{{lng}}', p.lng.toFixed(3))
    .replace('{{station_name}}', ev.area.station?.name ?? '—')
    .replace('{{metrics_json}}', JSON.stringify(promptMetrics));

  const client = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 40_000 });
  let text = '';
  try {
    text = await writeReport(client, system);
    if (FORBIDDEN.test(text) || REAL_NAMES.test(text)) {
      text = await writeReport(client, system + '\n\n【注意】直前の所見に禁止表現（必ず／安全です／最適です／予測・予報／実在名）が含まれていました。同じ内容を、断定しない言い方で書き直してください。');
    }
  } catch (e) {
    const status = e instanceof Anthropic.APIError ? e.status : undefined;
    const message = e instanceof Error ? e.message : String(e);
    console.error('scan/report failed', status, message);
    return c.json({ error: `所見の生成に失敗しました（Claude API ${status ?? 'error'}）。指標はそのまま使えます。`, detail: message }, 502);
  }
  if (FORBIDDEN.test(text) || REAL_NAMES.test(text) || !text) {
    text = '所見をうまく書けませんでした。指標の数値をご覧ください。出荷の安全（貝毒・衛生基準）は都道府県の検査結果でご確認ください。';
  }
  const res = await c.env.DB.prepare('INSERT INTO scan_reports (lat, lng, area_no, metrics_json, report_text) VALUES (?, ?, ?, ?, ?)')
    .bind(p.lat, p.lng, ev.area.no, JSON.stringify(ev), text)
    .run();
  return c.json({ id: Number(res.meta.last_row_id), report_text: text, evaluation: ev, labels }, 201);
});

// GET /api/scan/report/:id（AI Oysterman への引き継ぎ）
scan.get('/report/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'bad id' }, 400);
  const row = await c.env.DB.prepare('SELECT * FROM scan_reports WHERE id = ?')
    .bind(id)
    .first<{ id: number; lat: number; lng: number; area_no: number; metrics_json: string; report_text: string; created_at: string }>();
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json({ id: row.id, lat: row.lat, lng: row.lng, area_no: row.area_no, report_text: row.report_text, created_at: row.created_at, evaluation: JSON.parse(row.metrics_json) as ScanEvaluation, labels: cfg().labels });
});

async function writeReport(client: Anthropic, system: string): Promise<string> {
  const res = await client.messages.create({
    model: REPORT_MODEL,
    max_tokens: 1024,
    system,
    messages: [{ role: 'user', content: '上の集計値から所見を書いてください。' }],
    thinking: { type: 'between_tools' },
    output_config: { effort: 'low' },
  });
  return res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('').trim();
}
