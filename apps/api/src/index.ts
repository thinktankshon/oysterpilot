import { Hono } from 'hono';
import { WORK_TYPES, type Bindings, type RecordRow, type ReservationRow } from './types';
import { voysy } from './voysy';

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
       avg_weight_g, count_per_basket, mortality, basket_count, raw_text, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'voysy')`,
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
    )
    .run();
  return c.json({ id: res.meta.last_row_id }, 201);
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

app.notFound((c) => c.json({ error: 'not found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal error' }, 500);
});

/** JST の現在時刻を "YYYY-MM-DDTHH:mm:ss+09:00" で返す */
function jstNowIso(): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return d.toISOString().replace(/\.\d{3}Z$/, '+09:00');
}

export default app;
