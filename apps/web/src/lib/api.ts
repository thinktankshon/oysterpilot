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
  missing: string[];
  notes: string | null;
};

/** POST /api/records の本文 */
export type RecordInput = Omit<ExtractResult, 'missing' | 'notes'> & { raw_text: string };

/** "YYYY-MM-DD" → "M/D" */
export function formatDay(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  return m ? `${Number(m[2])}/${Number(m[3])}` : ymd;
}

// ---- 未送信レコード（VO-06）：オフライン・5xx のときは localStorage に残して再送する ----
const PENDING_STORAGE = 'oysterpilot.pendingRecords';

export type PendingRecord = { key: string; created_at: string; input: RecordInput };

export function loadPending(): PendingRecord[] {
  try {
    const raw = localStorage.getItem(PENDING_STORAGE);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? (list as PendingRecord[]) : [];
  } catch {
    return [];
  }
}
export function savePending(list: PendingRecord[]) {
  try {
    localStorage.setItem(PENDING_STORAGE, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}
export function addPending(input: RecordInput): PendingRecord[] {
  const list = loadPending();
  list.push({ key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, created_at: new Date().toISOString(), input });
  savePending(list);
  return list;
}

/** 通信失敗（ネットワーク断・5xx）なら true。4xx は入力の問題なので再送しない */
export function isRetryable(e: unknown): boolean {
  if (e instanceof ApiError) return e.status >= 500;
  return e instanceof TypeError; // fetch のネットワークエラー
}
