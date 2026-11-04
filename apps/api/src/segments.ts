import { Hono } from 'hono';
import type { Bindings, SegmentRow } from './types';

// 作業セッションの区切り（生の文）。海では保存するだけ、陸で整理して records にする。
export const segments = new Hono<{ Bindings: Bindings }>();

// POST /api/segments { session_id, seq, recorded_at, raw_text }
segments.post('/', async (c) => {
  const body = await c.req.json<Partial<SegmentRow>>().catch(() => null);
  if (!body) return c.json({ error: 'invalid json' }, 400);
  const text = typeof body.raw_text === 'string' ? body.raw_text.trim() : '';
  if (!text) return c.json({ error: 'raw_text is required' }, 400);
  if (typeof body.session_id !== 'string' || !body.session_id) return c.json({ error: 'session_id is required' }, 400);
  const seq = typeof body.seq === 'number' && Number.isInteger(body.seq) ? body.seq : 0;
  const recordedAt = typeof body.recorded_at === 'string' && body.recorded_at ? body.recorded_at : jstNowIso();
  const res = await c.env.DB.prepare(
    'INSERT INTO voice_segments (session_id, seq, recorded_at, raw_text) VALUES (?, ?, ?, ?)',
  )
    .bind(body.session_id, seq, recordedAt, text)
    .run();
  return c.json({ id: res.meta.last_row_id }, 201);
});

// GET /api/segments?status=draft | ?record_id=N（保存済みの記録から元の区切りを引く。status は問わない）
segments.get('/', async (c) => {
  const recordId = c.req.query('record_id');
  if (recordId != null) {
    const id = Number(recordId);
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad record_id' }, 400);
    const { results } = await c.env.DB.prepare('SELECT * FROM voice_segments WHERE record_id = ? ORDER BY id ASC LIMIT 10')
      .bind(id)
      .all<SegmentRow>();
    return c.json(results);
  }
  const status = c.req.query('status') ?? 'draft';
  if (!['draft', 'done', 'deleted'].includes(status)) return c.json({ error: 'bad status' }, 400);
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM voice_segments WHERE status = ? ORDER BY recorded_at ASC, seq ASC, id ASC LIMIT 200',
  )
    .bind(status)
    .all<SegmentRow>();
  return c.json(results);
});

// PATCH /api/segments/:id { raw_text?, status?, record_id? }
segments.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'bad id' }, 400);
  const body = await c.req.json<Partial<SegmentRow>>().catch(() => null);
  if (!body) return c.json({ error: 'invalid json' }, 400);
  const sets: string[] = [];
  const params: (string | number)[] = [];
  if (typeof body.raw_text === 'string') {
    if (!body.raw_text.trim()) return c.json({ error: 'raw_text must not be empty' }, 400);
    sets.push('raw_text = ?');
    params.push(body.raw_text.trim());
  }
  if (typeof body.status === 'string') {
    if (!['draft', 'done', 'deleted'].includes(body.status)) return c.json({ error: 'bad status' }, 400);
    sets.push('status = ?');
    params.push(body.status);
  }
  if (typeof body.record_id === 'number') {
    sets.push('record_id = ?');
    params.push(body.record_id);
  }
  if (!sets.length) return c.json({ error: 'nothing to update' }, 400);
  params.push(id);
  const res = await c.env.DB.prepare(`UPDATE voice_segments SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...params)
    .run();
  if (!res.meta.changes) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});

function jstNowIso(): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return d.toISOString().replace(/\.\d{3}Z$/, '+09:00');
}
