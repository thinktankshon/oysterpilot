// 周防灘の海面水温（apps/api/data/suonada.json、scripts/fetch_jma.ts が生成）から環境指標を計算する（docs/04）。
import suonada from '../data/suonada.json';
import type { Thresholds } from './rules';

export type Daily = { date: string; temp: number | null; flag: string };
export type Stat5y = { mmdd: string; mean: number | null; max: number | null; min: number | null };
export type Suonada = {
  source: string;
  area_no: number;
  area_name: string;
  urls: { daily: string; stats: string };
  fetched_at: string;
  stats_period: string;
  daily: Daily[];
  stats5y: Stat5y[];
};

export type Season = 'growth' | 'hot' | 'cold' | 'mild';

export type EnvMetrics = {
  mean7: number | null;
  max7: number | null;
  min7: number | null;
  hot_streak: number;
  cold_streak: number;
  in_growth_band: boolean;
  season: Season; // growth=成長しやすい / hot=斃死が増えやすい / cold=生育が鈍る / mild=中間
  season_label: string;
  vs5y: { mean: number | null; max: number | null; min: number | null; diff: number | null; period: string } | null; // 5年統計の同日との比較
  as_of: string; // データの最終日（古くてもごまかさない）
  area_no: number;
  area_name: string;
  source: string;
};

const SEASON_LABEL: Record<Season, string> = {
  growth: '成長しやすい時期',
  hot: '斃死が増えやすい時期',
  cold: '生育が鈍る時期',
  mild: '成長が緩やかな時期',
};

export function getSuonada(): Suonada {
  return suonada as Suonada;
}

/** 直近 7 日の平均・最高・最低、28℃以上／10℃未満の連続日数、成長帯かどうか */
export function computeEnv(data: Suonada, th: Thresholds): EnvMetrics {
  const valid = data.daily.filter((d) => d.temp != null) as (Daily & { temp: number })[];
  const last = valid[valid.length - 1];
  const recent = valid.slice(-7).map((d) => d.temp);
  const mean7 = recent.length ? round1(recent.reduce((a, b) => a + b, 0) / recent.length) : null;
  const max7 = recent.length ? Math.max(...recent) : null;
  const min7 = recent.length ? Math.min(...recent) : null;

  let hot = 0;
  for (let i = valid.length - 1; i >= 0 && valid[i].temp >= th.hot_temp_c; i--) hot++;
  let cold = 0;
  for (let i = valid.length - 1; i >= 0 && valid[i].temp < th.cold_temp_c; i--) cold++;

  const [lo, hi] = th.growth_band_c;
  const inBand = mean7 != null && mean7 >= lo && mean7 <= hi;
  const season: Season = hot >= th.hot_days ? 'hot' : cold >= th.cold_days ? 'cold' : inBand ? 'growth' : 'mild';

  // 5年統計の同日（as_of の月日）
  let vs5y: EnvMetrics['vs5y'] = null;
  if (last) {
    const st = data.stats5y.find((x) => x.mmdd === last.date.slice(5, 10));
    if (st) {
      vs5y = {
        mean: st.mean,
        max: st.max,
        min: st.min,
        diff: mean7 != null && st.mean != null ? round1(mean7 - st.mean) : null,
        period: data.stats_period,
      };
    }
  }

  return {
    mean7,
    max7,
    min7,
    hot_streak: hot,
    cold_streak: cold,
    in_growth_band: inBand,
    season,
    season_label: SEASON_LABEL[season],
    vs5y,
    as_of: last?.date ?? '',
    area_no: data.area_no,
    area_name: data.area_name,
    source: data.source,
  };
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
