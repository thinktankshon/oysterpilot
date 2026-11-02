export type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY?: string;
  DEMO_KEY?: string;
};

export const WORK_TYPES = ['選別', '分殖', '沖出し', '陸揚げ', '揺らし', '移動', 'その他'] as const;
export type WorkType = (typeof WORK_TYPES)[number];

export type RecordRow = {
  id: number;
  recorded_at: string;
  work_type: WorkType;
  location_line: number | null;
  location_tier: string | null;
  lot_no: string | null;
  avg_weight_g: number | null;
  count_per_basket: number | null;
  mortality: number | null;
  basket_count: number | null;
  raw_text: string;
  source: 'voysy' | 'seed';
  created_at: string;
};

export type ReservationRow = {
  id: number;
  due_date: string;
  location_line: number | null;
  location_tier: string | null;
  work: string;
  reason: string | null;
  rule_ids: string | null;
  status: 'open' | 'done';
  created_at: string;
};
