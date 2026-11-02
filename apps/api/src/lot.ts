// 沖出し場所ごとの記録サマリー（AO-02）
import type { RecordRow } from './types';

export type LotSummary = {
  location_line: number;
  location_tier: string | null;
  location_label: string;
  record_count: number;
  latest_at: string | null;
  last_sort_at: string | null;
  days_since_last_sort: number | null;
  avg_weight_g: number | null;
  count_per_basket: number | null;
  basket_total_kg: number | null;
  mortality_recent: number | null;
  lot_no: string | null;
};

export function locationLabel(line: number, tier: string | null): string {
  return `${line}番ライン${tier ? '・' + tier : ''}`;
}

export async function getLotSummary(
  db: D1Database,
  line: number,
  tier: string | null,
  todayJst: string, // YYYY-MM-DD
): Promise<LotSummary> {
  const sql = tier
    ? 'SELECT * FROM records WHERE location_line = ? AND location_tier = ? ORDER BY recorded_at DESC, id DESC LIMIT 30'
    : 'SELECT * FROM records WHERE location_line = ? ORDER BY recorded_at DESC, id DESC LIMIT 30';
  const stmt = tier ? db.prepare(sql).bind(line, tier) : db.prepare(sql).bind(line);
  const { results } = await stmt.all<RecordRow>();
  const latest = results[0] ?? null;
  const lastSort = results.find((r) => r.work_type === '選別') ?? null;
  const firstNum = (k: 'avg_weight_g' | 'count_per_basket' | 'mortality') =>
    results.find((r) => r[k] != null)?.[k] ?? null;
  const w = firstNum('avg_weight_g');
  const c = firstNum('count_per_basket');
  const days = lastSort ? daysBetween(lastSort.recorded_at.slice(0, 10), todayJst) : null;
  return {
    location_line: line,
    location_tier: tier,
    location_label: locationLabel(line, tier),
    record_count: results.length,
    latest_at: latest?.recorded_at ?? null,
    last_sort_at: lastSort?.recorded_at ?? null,
    days_since_last_sort: days,
    avg_weight_g: w,
    count_per_basket: c,
    basket_total_kg: w != null && c != null ? Math.round((w * c) / 10) / 100 : null,
    mortality_recent: lastSort?.mortality ?? firstNum('mortality'),
    lot_no: results.find((r) => r.lot_no)?.lot_no ?? null,
  };
}

/** JST の今日 "YYYY-MM-DD" */
export function todayJst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function daysBetween(fromYmd: string, toYmd: string): number {
  const a = Date.UTC(Number(fromYmd.slice(0, 4)), Number(fromYmd.slice(5, 7)) - 1, Number(fromYmd.slice(8, 10)));
  const b = Date.UTC(Number(toYmd.slice(0, 4)), Number(toYmd.slice(5, 7)) - 1, Number(toYmd.slice(8, 10)));
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export type LocationKey = { line: number; tier: string | null };

/** 記録のある場所の一覧 */
export async function listLocations(db: D1Database): Promise<LocationKey[]> {
  const { results } = await db
    .prepare(
      `SELECT location_line AS line, location_tier AS tier FROM records
        WHERE location_line IS NOT NULL GROUP BY location_line, location_tier ORDER BY location_line, location_tier`,
    )
    .all<{ line: number; tier: string | null }>();
  return results;
}

/** 全場所のサマリー（最大 12 か所） */
export async function getAllLotSummaries(db: D1Database, todayJst: string): Promise<LotSummary[]> {
  const locs = (await listLocations(db)).slice(0, 12);
  return Promise.all(locs.map((l) => getLotSummary(db, l.line, l.tier, todayJst)));
}

/** 発話から「3番」「上段」を拾う。段が無ければ tier=null（そのラインの全段） */
export function parseLocation(text: string): LocationKey | null {
  const t = text.replace(/\s+/g, '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const m = /(\d{1,2})番/.exec(t);
  if (!m) return null;
  const tier = /上段/.test(t) ? '上段' : /中段/.test(t) ? '中段' : /下段/.test(t) ? '下段' : null;
  return { line: Number(m[1]), tier };
}
