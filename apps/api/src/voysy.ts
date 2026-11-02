import { Hono } from 'hono';
import Anthropic from '@anthropic-ai/sdk';
import extractPrompt from '../../../prompts/voysy_extract.md';
import glossaryYaml from '../../../config/glossary.yaml';
import { WORK_TYPES, type Bindings, type WorkType } from './types';

// 抽出は軽量モデルで十分（docs/01）。応答 3 秒以内を目標。
const EXTRACT_MODEL = 'claude-haiku-5-5';
const TIERS = ['上段', '中段', '下段'] as const;

export type ExtractResult = {
  work_type: WorkType;
  location_line: number | null;
  location_tier: (typeof TIERS)[number] | null;
  lot_no: string | null;
  avg_weight_g: number | null;
  count_per_basket: number | null;
  mortality: number | null;
  basket_count: number | null;
  missing: string[];
  notes: string | null;
};

// prompts/voysy_extract.md のスキーマを JSON Schema にしたもの（構造化出力で強制）
const extractSchema = {
  type: 'object',
  properties: {
    work_type: { type: 'string', enum: [...WORK_TYPES] },
    location_line: { type: ['integer', 'null'] },
    location_tier: { anyOf: [{ type: 'string', enum: [...TIERS] }, { type: 'null' }] },
    lot_no: { type: ['string', 'null'] },
    avg_weight_g: { type: ['integer', 'null'] },
    count_per_basket: { type: ['integer', 'null'] },
    mortality: { type: ['integer', 'null'] },
    basket_count: { type: ['integer', 'null'] },
    missing: { type: 'array', items: { type: 'string' } },
    notes: { type: ['string', 'null'] },
  },
  required: [
    'work_type',
    'location_line',
    'location_tier',
    'lot_no',
    'avg_weight_g',
    'count_per_basket',
    'mortality',
    'basket_count',
    'missing',
    'notes',
  ],
  additionalProperties: false,
} as const;

// 「言っていない項目」を確認に出す対象（notes は対象外）
const CHECK_FIELDS = [
  'location_line',
  'location_tier',
  'lot_no',
  'avg_weight_g',
  'count_per_basket',
  'mortality',
  'basket_count',
] as const;

const systemPrompt =
  extractPrompt +
  '\n\n---\n以下は用語集（config/glossary.yaml）。作業名の正規化と用語の解釈に使う。\n```yaml\n' +
  glossaryYaml +
  '\n```\n';

export const voysy = new Hono<{ Bindings: Bindings }>();

// POST /api/voysy/extract  { text } → 構造化 JSON
voysy.post('/extract', async (c) => {
  const body = await c.req.json<{ text?: unknown }>().catch(() => null);
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) return c.json({ error: 'text is required' }, 400);
  if (text.length > 2000) return c.json({ error: 'text is too long (max 2000)' }, 400);
  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'ANTHROPIC_API_KEY が未設定です（wrangler secret put / .dev.vars）' }, 503);
  }

  const client = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 20_000 });
  let raw: string;
  try {
    const res = await client.messages.create({
      model: EXTRACT_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: text }],
      thinking: { type: 'disabled' },
      output_config: { effort: 'low', format: { type: 'json_schema', schema: extractSchema } },
    });
    if (res.stop_reason === 'refusal') {
      return c.json({ error: '整理できませんでした。文章を直して、もう一度お試しください。' }, 422);
    }
    raw = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
  } catch (e) {
    const status = e instanceof Anthropic.APIError ? e.status : undefined;
    const message = e instanceof Error ? e.message : String(e);
    console.error('voysy/extract failed', status, message);
    return c.json(
      { error: `整理に失敗しました（Claude API ${status ?? 'error'}）。下の欄から手で入力して保存できます。`, detail: message },
      502,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return c.json({ error: '整理結果を読めませんでした。もう一度お試しください。' }, 502);
  }
  return c.json(normalize(parsed));
});

/** モデル出力を検証し、null の項目を missing に足して返す */
export function normalize(v: unknown): ExtractResult {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const int = (x: unknown) => (typeof x === 'number' && Number.isInteger(x) && x >= 0 ? x : null);
  const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null);
  const workType = (WORK_TYPES as readonly string[]).includes(o.work_type as string)
    ? (o.work_type as WorkType)
    : 'その他';
  const tier = (TIERS as readonly string[]).includes(o.location_tier as string)
    ? (o.location_tier as ExtractResult['location_tier'])
    : null;
  const result: ExtractResult = {
    work_type: workType,
    location_line: int(o.location_line),
    location_tier: tier,
    lot_no: str(o.lot_no),
    avg_weight_g: int(o.avg_weight_g),
    count_per_basket: int(o.count_per_basket),
    mortality: int(o.mortality),
    basket_count: int(o.basket_count),
    missing: Array.isArray(o.missing) ? o.missing.filter((m): m is string => typeof m === 'string') : [],
    notes: str(o.notes),
  };
  for (const f of CHECK_FIELDS) {
    if (result[f] == null && !result.missing.includes(f)) result.missing.push(f);
  }
  result.missing = result.missing.filter((m) => (CHECK_FIELDS as readonly string[]).includes(m));
  return result;
}
