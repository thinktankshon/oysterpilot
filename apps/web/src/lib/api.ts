// API クライアント。共有パスワード（DEMO_KEY）は localStorage に保持し X-Demo-Key で送る。
const KEY_STORAGE = 'oysterpilot.demoKey';

export function getDemoKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}
export function setDemoKey(key: string) {
  try {
    localStorage.setItem(KEY_STORAGE, key);
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  const key = getDemoKey();
  if (key) headers.set('X-Demo-Key', key);
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401) {
    const entered = window.prompt('共有パスワードを入力してください');
    if (entered) {
      setDemoKey(entered);
      return api<T>(path, init);
    }
    throw new ApiError(401, '共有パスワードが必要です');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(res.status, text || res.statusText);
  }
  return (await res.json()) as T;
}

export type RecordRow = {
  id: number;
  recorded_at: string;
  work_type: string;
  location_line: number | null;
  location_tier: string | null;
  lot_no: string | null;
  avg_weight_g: number | null;
  count_per_basket: number | null;
  mortality: number | null;
  basket_count: number | null;
  raw_text: string;
  source: string;
};

export function locationLabel(r: { location_line: number | null; location_tier: string | null }): string {
  if (r.location_line == null) return '場所なし';
  return `${r.location_line}番ライン${r.location_tier ? '・' + r.location_tier : ''}`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export type ReservationRow = {
  id: number;
  due_date: string;
  location_line: number | null;
  location_tier: string | null;
  work: string;
  reason: string | null;
  status: string;
};

/** 選別のサイズ帯（1 帯 = 1 件の記録として保存） */
export type ExtractItem = {
  avg_weight_g: number | null;
  count_per_basket: number | null;
  basket_count: number | null;
};

/** /api/voysy/extract の結果（docs/01） */
export type ExtractResult = {
  work_type: string;
  location_line: number | null;
  location_tier: string | null;
  lot_no: string | null;
  avg_weight_g: number | null;
  count_per_basket: number | null;
  mortality: number | null;
  basket_count: number | null;
  items: ExtractItem[];
  missing: string[];
  notes: string | null;
};

/** POST /api/records の本文（1 件） */
export type RecordInput = Omit<ExtractResult, 'missing' | 'items'> & { raw_text: string };

/** 抽出結果を帯ごとの記録に展開する。帯の場所が無ければ全体の場所を使う */
export function toRecordInputs(r: ExtractResult, rawText: string): RecordInput[] {
  const base = {
    work_type: r.work_type,
    lot_no: r.lot_no,
    mortality: r.mortality,
    notes: r.notes,
    raw_text: rawText,
  };
  const items = r.items.length ? r.items : [{ avg_weight_g: r.avg_weight_g, count_per_basket: r.count_per_basket, basket_count: r.basket_count }];
  return items.map((it, i) => ({
    ...base,
    mortality: i === 0 ? r.mortality : null, // 斃死は全体の値なので先頭の帯にだけ付ける
    location_line: r.location_line,
    location_tier: r.location_tier,
    avg_weight_g: it.avg_weight_g,
    count_per_basket: it.count_per_basket,
    basket_count: it.basket_count,
  }));
}

/** 直近の記録を「同じ発話・同じ時刻」でまとめる（選別の複数帯を 1 行に） */
export type RecordGroup = { key: string; recorded_at: string; work_type: string; rows: RecordRow[] };
export function groupRecords(rows: RecordRow[]): RecordGroup[] {
  const groups: RecordGroup[] = [];
  for (const r of rows) {
    const key = `${r.recorded_at}|${r.raw_text}`;
    const g = groups.find((x) => x.key === key);
    if (g) g.rows.push(r);
    else groups.push({ key, recorded_at: r.recorded_at, work_type: r.work_type, rows: [r] });
  }
  for (const g of groups) g.rows.sort((a, b) => a.id - b.id); // 帯は発話の順に並べる
  return groups;
}

/** 作業セッションの区切り（voice_segments） */
export type SegmentRow = {
  id: number;
  session_id: string;
  seq: number;
  recorded_at: string;
  raw_text: string;
  status: 'draft' | 'done' | 'deleted';
  record_id: number | null;
};
export type SegmentInput = Pick<SegmentRow, 'session_id' | 'seq' | 'recorded_at' | 'raw_text'>;

/** JST の現在時刻 "YYYY-MM-DDTHH:mm:ss+09:00" */
export function jstNowIso(): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return d.toISOString().replace(/\.\d{3}Z$/, '+09:00');
}

/** "YYYY-MM-DD" → "M/D" */
export function formatDay(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  return m ? `${Number(m[2])}/${Number(m[3])}` : ymd;
}

// ---- 未送信レコード（VO-06）：オフライン・5xx のときは localStorage に残して再送する ----
const PENDING_STORAGE = 'oysterpilot.pendingRecords';

export type PendingInput =
  | { kind: 'record'; input: RecordInput; segment_id?: number }
  | { kind: 'records'; inputs: RecordInput[]; segment_id?: number }
  | { kind: 'segment'; input: SegmentInput };
export type PendingItem = PendingInput & { key: string; created_at: string };

export function loadPending(): PendingItem[] {
  try {
    const raw = localStorage.getItem(PENDING_STORAGE);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? (list as PendingItem[]) : [];
  } catch {
    return [];
  }
}
export function savePending(list: PendingItem[]) {
  try {
    localStorage.setItem(PENDING_STORAGE, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}
export function addPending(item: PendingInput): PendingItem[] {
  const list = loadPending();
  list.push({
    ...item,
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    created_at: new Date().toISOString(),
  });
  savePending(list);
  return list;
}

/** 未送信を1件送る。record に segment_id が付いていれば区切りも確定にする */
export async function sendPending(item: PendingItem): Promise<void> {
  if (item.kind === 'segment') {
    await api<{ id: number }>('/api/segments', { method: 'POST', body: JSON.stringify(item.input) });
    return;
  }
  if (item.kind === 'records') {
    await saveRecords(item.inputs, item.segment_id);
    return;
  }
  const { id } = await api<{ id: number }>('/api/records', { method: 'POST', body: JSON.stringify(item.input) });
  if (item.segment_id != null) await markSegmentDone(item.segment_id, id);
}

export async function markSegmentDone(segmentId: number, recordId: number): Promise<void> {
  try {
    await api<{ ok: true }>(`/api/segments/${segmentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'done', record_id: recordId }),
    });
  } catch {
    // 記録自体は保存済み。区切りの確定だけ失敗しても陸の一覧で削除できるので握りつぶす
  }
}

/** 通信失敗（ネットワーク断・5xx）なら true。4xx は入力の問題なので再送しない */
export function isRetryable(e: unknown): boolean {
  if (e instanceof ApiError) return e.status >= 500;
  return e instanceof TypeError; // fetch のネットワークエラー
}

// ---- AI Oysterman ----
export type LocationRow = { location_line: number; location_tier: string | null; n: number; latest_at: string };
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
export type EnvMetrics = {
  mean7: number | null;
  max7: number | null;
  min7: number | null;
  hot_streak: number;
  cold_streak: number;
  in_growth_band: boolean;
  season: 'growth' | 'hot' | 'cold' | 'mild';
  season_label: string;
  vs5y: { mean: number | null; max: number | null; min: number | null; diff: number | null; period: string } | null;
  as_of: string;
  area_name: string;
  source: string;
};
export type ChatMessage = { role: 'user' | 'assistant'; content: string };
export type BriefLot = { location_label: string; days_since_last_sort: number | null; avg_weight_g: number | null; count_per_basket: number | null };
export type ChatResponse = {
  reply: string;
  basis: string[];
  fired_rules: string[];
  focus: string[];
  out_of_scope: boolean;
  out_of_scope_summary: string | null;
  reservation: { id?: number; due_date: string; work: string; reason: string; location_label: string | null } | null;
  context: { env: EnvMetrics; lots: BriefLot[]; today_priority: string[] };
};

// ---- Oyscan ----
export type ScanMetrics = {
  area_no: number;
  area_name: string;
  years: number[];
  hot_risk: { level: 'low' | 'mid' | 'high'; years_with_streak: number; max_streak_days: number; threshold_c: number; streak_days: number };
  cold_period: { avg_days: number; threshold_c: number };
  growth_period: { avg_days: number; band_c: [number, number] };
  recent: { mean7: number | null; as_of: string; vs5y: EnvMetrics['vs5y'] };
  season: EnvMetrics['season'];
  season_label: string;
  source: string;
  stats_period: string;
};
export type ScanEvaluate = { supported: boolean; lat: number; lng: number; metrics: ScanMetrics };
export type ScanReport = { id: number; report_text: string; metrics: ScanMetrics; lat?: number; lng?: number };

/** 帯ごとの記録を一括保存（区切り ID があれば確定も同時に） */
export async function saveRecords(inputs: RecordInput[], segmentId?: number): Promise<number[]> {
  const { ids } = await api<{ ids: number[] }>('/api/records/bulk', {
    method: 'POST',
    body: JSON.stringify({ records: inputs, ...(segmentId != null ? { segment_id: segmentId } : {}) }),
  });
  return ids;
}
