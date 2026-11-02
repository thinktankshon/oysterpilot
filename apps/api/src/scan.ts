import { Hono } from 'hono';
import Anthropic from '@anthropic-ai/sdk';
import reportTemplate from '../../../prompts/oyscan_report.md';
import { computeScanMetrics, getSuonada, type OyscanConfig, type ScanMetrics } from './env';
import { getRulesConfig } from './rulesConfig';
import type { Bindings } from './types';

const REPORT_MODEL = 'claude-sonnet-5-5';
// 周防灘（海域 623）の簡易矩形（docs/03：簡易矩形で可）
export const SUONADA_BOUNDS = { minLat: 33.5, maxLat: 34.1, minLng: 130.9, maxLng: 131.9 };
// 所見の禁止表現（prompts/oyscan_report.md・CLAUDE.md）
const FORBIDDEN = /必ず|安全です|最適です|予測|予報|死にます|来年は/;
// 実在漁場名・社名が混ざっていないか（CLAUDE.md の禁止事項）
const REAL_NAMES = /中津②|那佐|浅川|Oysmart|オイスマート/;

export const scan = new Hono<{ Bindings: Bindings }>();

export function inSuonada(lat: number, lng: number): boolean {
  return lat >= SUONADA_BOUNDS.minLat && lat <= SUONADA_BOUNDS.maxLat && lng >= SUONADA_BOUNDS.minLng && lng <= SUONADA_BOUNDS.maxLng;
}

function metricsFor(): ScanMetrics {
  const cfg = getRulesConfig() as unknown as { thresholds: Parameters<typeof computeScanMetrics>[1]; oyscan: OyscanConfig };
  return computeScanMetrics(getSuonada(), cfg.thresholds, cfg.oyscan);
}

function parseLatLng(b: unknown): { lat: number; lng: number } | null {
  const o = (b ?? {}) as Record<string, unknown>;
  const lat = Number(o.lat);
  const lng = Number(o.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

// POST /api/scan/evaluate { lat, lng } → 指標（周防灘の外は 422）
scan.post('/evaluate', async (c) => {
  const p = parseLatLng(await c.req.json().catch(() => null));
  if (!p) return c.json({ error: 'lat and lng are required' }, 400);
  if (!inSuonada(p.lat, p.lng)) {
    return c.json({ error: 'この海域はまだ対応していません（対応海域：周防灘）', supported: false, bounds: SUONADA_BOUNDS }, 422);
  }
  return c.json({ supported: true, ...p, metrics: metricsFor() });
});

// POST /api/scan/report { lat, lng, metrics? } → { id, report_text }
scan.post('/report', async (c) => {
  const body = await c.req.json<{ lat?: unknown; lng?: unknown; metrics?: ScanMetrics }>().catch(() => null);
  const p = parseLatLng(body);
  if (!p) return c.json({ error: 'lat and lng are required' }, 400);
  if (!inSuonada(p.lat, p.lng)) return c.json({ error: 'この海域はまだ対応していません（対応海域：周防灘）' }, 422);
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: 'ANTHROPIC_API_KEY が未設定です' }, 503);

  // 集計は信頼できる値をサーバー側で作り直す（クライアントの値は使わない）
  const metrics = metricsFor();
  const promptMetrics = {
    hot_risk: metrics.hot_risk,
    cold_period: metrics.cold_period,
    growth_period: metrics.growth_period,
    recent: metrics.recent,
    season_label: metrics.season_label,
    years: metrics.years,
  };
  const system = reportTemplate
    .replace('{{area_name}}', metrics.area_name)
    .replace('{{area_no}}', String(metrics.area_no))
    .replace('{{lat}}', p.lat.toFixed(3))
    .replace('{{lng}}', p.lng.toFixed(3))
    .replace('{{metrics_json}}', JSON.stringify(promptMetrics));

  const client = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 40_000 });
  let text = '';
  try {
    text = await writeReport(client, system);
    if (FORBIDDEN.test(text) || REAL_NAMES.test(text)) {
      text = await writeReport(
        client,
        system + '\n\n【注意】直前の所見に禁止表現（必ず／安全です／最適です／予測・予報／実在名）が含まれていました。同じ内容を、断定しない言い方で書き直してください。',
      );
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

  const res = await c.env.DB.prepare(
    'INSERT INTO scan_reports (lat, lng, area_no, metrics_json, report_text) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(p.lat, p.lng, metrics.area_no, JSON.stringify(metrics), text)
    .run();
  return c.json({ id: Number(res.meta.last_row_id), report_text: text, metrics }, 201);
});

// GET /api/scan/report/:id（AI Oysterman への引き継ぎ）
scan.get('/report/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'bad id' }, 400);
  const row = await c.env.DB.prepare('SELECT * FROM scan_reports WHERE id = ?')
    .bind(id)
    .first<{ id: number; lat: number; lng: number; area_no: number; metrics_json: string; report_text: string; created_at: string }>();
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json({ ...row, metrics: JSON.parse(row.metrics_json) as ScanMetrics, metrics_json: undefined });
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
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}
