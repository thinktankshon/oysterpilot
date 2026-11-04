import { Hono } from 'hono';
import { WORK_TYPES, type Bindings, type RecordRow, type ReservationRow } from './types';
import { voysy } from './voysy';
import { segments } from './segments';
import { oysterman } from './oysterman';
import { scan } from './scan';
import { computeEnv, getSuonada } from './env';
import { getRulesConfig } from './rulesConfig';
import { getLotSummary, todayJst } from './lot';

const app = new Hono<{ Bindings: Bindings }>().basePath('/api');

// 共有パスワード（X-Demo-Key）。DEMO_KEY 未設定（ローカル）なら認証なし。
app.use('*', async (c, next) => {
  const required = c.env.DEMO_KEY;
  if (required && c.req.path !== '/api/health') {
    if (c.req.header('X-Demo-Key') !== required) {
      return c.json({ error: 'unauthorized' }, 401);
    }
  }
  await next();
});

app.get('/health', (c) => c.json({ ok: true, time: new Date().toISOString() }));

// Voysy: POST /api/voysy/extract
app.route('/voysy', voysy);
// 作業セッションの区切り: /api/segments
app.route('/segments', segments);
// AI Oysterman: /api/oysterman/chat
app.route('/oysterman', oysterman);
// Oyscan: /api/scan/evaluate, /api/scan/report
app.route('/scan', scan);

// GET /api/env/suonada  周防灘の水温指標（docs/04）
app.get('/env/suonada', (c) => c.json(computeEnv(getSuonada(), getRulesConfig().thresholds)));

// GET /api/records/summary?line=3&tier=上段
app.get('/records/summary', async (c) => {
  const line = Number(c.req.query('line'));
  if (!Number.isInteger(line)) return c.json({ error: 'line is required' }, 400);
  const tier = c.req.query('tier') || null;
  return c.json(await getLotSummary(c.env.DB, line, tier, todayJst()));
});

// GET /api/records/locations  記録のある沖出し場所の一覧
app.get('/records/locations', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT location_line, location_tier, COUNT(*) AS n, MAX(recorded_at) AS latest_at
       FROM records WHERE location_line IS NOT NULL
      GROUP BY location_line, location_tier ORDER BY location_line, location_tier`,
  ).all<{ location_line: number; location_tier: string | null; n: number; latest_at: string }>();
  return c.json(results);
});

// GET /api/records?line=3&tier=上段&limit=10
app.get('/records', async (c) => {
  const line = c.req.query('line');
  const tier = c.req.query('tier');
  const limit = Math.min(Number(c.req.query('limit') ?? 10) || 10, 100);
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (line) {
    where.push('location_line = ?');
    params.push(Number(line));
  }
  if (tier) {
    where.push('location_tier = ?');
    params.push(tier);
  }
  const sql =
    'SELECT * FROM records' +
    (where.length ? ' WHERE ' + where.join(' AND ') : '') +
    ' ORDER BY recorded_at DESC, id DESC LIMIT ?';
  params.push(limit);
  const { results } = await c.env.DB.prepare(sql).bind(...params).all<RecordRow>();
  return c.json(results);
});

// POST /api/records  構造化 JSON ＋ raw_text（1 件）
app.post('/records', async (c) => {
  const body = await c.req.json<Partial<RecordRow>>().catch(() => null);
  if (!body) return c.json({ error: 'invalid json' }, 400);
  const err = validateRecord(body);
  if (err) return c.json({ error: err }, 400);
  const res = await insertRecord(c.env.DB, body, jstNowIso()).run();
  return c.json({ id: res.meta.last_row_id }, 201);
});

// GET /api/records/summary?line=3&tier=上段
app.get('/records/summary', async (c) => {
  const line = Number(c.req.query('line'));
  if (!Number.isInteger(line)) return c.json({ error: 'line is required' }, 400);
  const tier = c.req.query('tier') || null;
  return c.json(await getLotSummary(c.env.DB, line, tier, todayJst()));
});

// GET /api/records/locations  記録のある沖出し場所の一覧
app.get('/records/locations', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT location_line, location_tier, COUNT(*) AS n, MAX(recorded_at) AS latest_at
       FROM records WHERE location_line IS NOT NULL
      GROUP BY location_line, location_tier ORDER BY location_line, location_tier`,
  ).all<{ location_line: number; location_tier: string | null; n: number; latest_at: string }>();
  return c.json(results);
});

// GET /api/records?line=3&tier=上段&limit=10
app.get('/records', async (c) => {
  const line = c.req.query('line');
  const tier = c.req.query('tier');
  const limit = Math.min(Number(c.req.query('limit') ?? 10) || 10, 100);
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (line) {
    where.push('location_line = ?');
    params.push(Number(line));
  }
  if (tier) {
    where.push('location_tier = ?');
    params.push(tier);
  }
  const sql =
    'SELECT * FROM records' +
    (where.length ? ' WHERE ' + where.join(' AND ') : '') +
    ' ORDER BY recorded_at DESC, id DESC LIMIT ?';
  params.push(limit);
  const { results } = await c.env.DB.prepare(sql).bind(...params).all<RecordRow>();
  return c.json(results);
});

// POST /api/records  構造化 JSON ＋ raw_text
app.post('/records', async (c) => {
  const body = await c.req.json<Partial<RecordRow>>().catch(() => null);
  if (!body) return c.json({ error: 'invalid json' }, 400);
  if (!body.work_type || !(WORK_TYPES as readonly string[]).includes(body.work_type)) {
    return c.json({ error: 'work_type is required (選別/分殖/沖出し/陸揚げ/揺らし/移動/その他)' }, 400);
  }
  if (!body.raw_text || typeof body.raw_text !== 'string') {
    return c.json({ error: 'raw_text is required' }, 400);
  }
  const recordedAt = body.recorded_at ?? jstNowIso();
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const str = (v: unknown) => (typeof v === 'string' && v.length ? v : null);
  const res = await c.env.DB.prepare(
    `INSERT INTO records (recorded_at, work_type, location_line, location_tier, lot_no,
       avg_weight_g, count_per_basket, mortality, basket_count, raw_text, notes, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'voysy')`,
  )
    .bind(
      recordedAt,
      body.work_type,
      num(body.location_line),
      str(body.location_tier),
      str(body.lot_no),
      num(body.avg_weight_g),
      num(body.count_per_basket),
      num(body.mortality),
      num(body.basket_count),
      body.raw_text,
      str(body.notes),
    )
    .run();
  return c.json({ id: res.meta.last_row_id }, 201);
});

// POST /api/records/bulk  { records: [...], segment_id? } → { ids }  選別の複数サイズ帯や、1 区切りの複数作業を一度に保存
app.post('/records/bulk', async (c) => {
  const body = await c.req.json<{ records?: Partial<RecordRow>[]; segment_id?: number; extraction_id?: number }>().catch(() => null);
  if (!body || !Array.isArray(body.records) || body.records.length === 0) return c.json({ error: 'records is required' }, 400);
  if (body.records.length > 20) return c.json({ error: 'too many records (max 20)' }, 400);
  const now = jstNowIso();
  for (const r of body.records) {
    const err = validateRecord(r);
    if (err) return c.json({ error: err }, 400);
  }
  const results = await c.env.DB.batch(body.records.map((r) => insertRecord(c.env.DB, r, now)));
  const ids = results.map((x) => Number(x.meta.last_row_id));
  if (typeof body.segment_id === 'number') {
    await c.env.DB.prepare("UPDATE voice_segments SET status = 'done', record_id = ? WHERE id = ?")
      .bind(ids[0], body.segment_id)
      .run()
      .catch(() => undefined);
  }
  if (typeof body.extraction_id === 'number') {
    // 読み取りの検証用：抽出結果に保存済みの記録を紐づける
    await c.env.DB.prepare('UPDATE voysy_extractions SET saved_at = ?, record_ids = ? WHERE id = ?')
      .bind(new Date().toISOString(), JSON.stringify(ids), body.extraction_id)
      .run()
      .catch(() => undefined);
  }
  return c.json({ ids }, 201);
});

// GET /api/reservations?status=open
app.get('/reservations', async (c) => {
  const status = c.req.query('status') ?? 'open';
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM reservations WHERE status = ? ORDER BY due_date ASC, id ASC LIMIT 50',
  )
    .bind(status)
    .all<ReservationRow>();
  return c.json(results);
});

// POST /api/reservations  { due_date, location_line, location_tier, work, reason, rule_ids }
app.post('/reservations', async (c) => {
  const b = await c.req.json<Partial<ReservationRow>>().catch(() => null);
  if (!b) return c.json({ error: 'invalid json' }, 400);
  if (typeof b.due_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.due_date)) {
    return c.json({ error: 'due_date (YYYY-MM-DD) is required' }, 400);
  }
  if (typeof b.work !== 'string' || !b.work.trim()) return c.json({ error: 'work is required' }, 400);
  const res = await c.env.DB.prepare(
    'INSERT INTO reservations (due_date, location_line, location_tier, work, reason, rule_ids) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(
      b.due_date,
      typeof b.location_line === 'number' ? b.location_line : null,
      typeof b.location_tier === 'string' && b.location_tier ? b.location_tier : null,
      b.work.trim(),
      typeof b.reason === 'string' ? b.reason : null,
      typeof b.rule_ids === 'string' ? b.rule_ids : null,
    )
    .run();
  return c.json({ id: res.meta.last_row_id }, 201);
});

app.notFound((c) => c.json({ error: 'not found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal error' }, 500);
});

function validateRecord(r: Partial<RecordRow>): string | null {
  if (!r.work_type || !(WORK_TYPES as readonly string[]).includes(r.work_type)) {
    return 'work_type is required (選別/沖出し/陸揚げ/分殖/揺らし/移動/その他)';
  }
  if (!r.raw_text || typeof r.raw_text !== 'string') return 'raw_text is required';
  if (r.recorded_at != null && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(r.recorded_at))) return 'recorded_at must be ISO8601';
  return null;
}

/** records への INSERT（1 件）。作業別の型の列を含む */
function insertRecord(db: D1Database, r: Partial<RecordRow>, now: string) {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const str = (v: unknown) => (typeof v === 'string' && v.length ? v : null);
  const bool = (v: unknown) => (typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'number' ? (v ? 1 : 0) : null);
  return db
    .prepare(
      `INSERT INTO records (recorded_at, work_type, location_line, location_tier, lot_no,
         avg_weight_g, count_per_basket, mortality, basket_count, raw_text, notes,
         farm, lane, ma_from, ma_to, basket_type, shell_state, meat_quality, fouling, workers, duration_min, purpose, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'voysy')`,
    )
    .bind(
      r.recorded_at ?? now,
      r.work_type,
      num(r.location_line),
      str(r.location_tier),
      str(r.lot_no),
      num(r.avg_weight_g),
      num(r.count_per_basket),
      num(r.mortality),
      num(r.basket_count),
      r.raw_text,
      str(r.notes),
      str(r.farm),
      num(r.lane),
      num(r.ma_from),
      num(r.ma_to),
      str(r.basket_type),
      str(r.shell_state),
      str(r.meat_quality),
      bool(r.fouling),
      num(r.workers),
      num(r.duration_min),
      str(r.purpose),
    );
}

/** JST の現在時刻を "YYYY-MM-DDTHH:mm:ss+09:00" で返す */
function jstNowIso(): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return d.toISOString().replace(/\.\d{3}Z$/, '+09:00');
}

export default app;
