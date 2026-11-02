import { Hono } from 'hono';
import Anthropic from '@anthropic-ai/sdk';
import { parse } from 'yaml';
import extractPrompt from '../../../prompts/voysy_extract.md';
import glossaryYaml from '../../../config/glossary.yaml';
import { WORK_TYPES, type Bindings, type WorkType } from './types';

// 抽出は軽量モデルで十分（docs/01）。応答 3 秒以内を目標。
const EXTRACT_MODEL = 'claude-haiku-5-5';
const TIERS = ['上段', '中段', '下段'] as const;

export type ExtractItem = {
  avg_weight_g: number | null;
  count_per_basket: number | null;
  basket_count: number | null;
};

export type ExtractResult = {
  work_type: WorkType;
  location_line: number | null;
  location_tier: (typeof TIERS)[number] | null;
  lot_no: string | null;
  avg_weight_g: number | null;
  count_per_basket: number | null;
  mortality: number | null;
  basket_count: number | null;
  items: ExtractItem[]; // 選別の複数サイズ帯。帯が 1 つなら 1 要素
  missing: string[];
  notes: string | null;
};

// 用語集（config/glossary.yaml）からロット型と数値の妥当範囲を読む
type Glossary = {
  lot_format?: { regex?: string; current_prefix?: string };
  plausible_ranges?: Partial<Record<'avg_weight_g' | 'count_per_basket' | 'basket_count' | 'mortality', [number, number]>>;
};
const glossary = parse(glossaryYaml) as Glossary;
const LOT_REGEX = new RegExp(glossary.lot_format?.regex ?? '^R\\d{1,2}-K\\d{1,2}$');
const LOT_CURRENT_PREFIX = glossary.lot_format?.current_prefix ?? 'R8';
const RANGES = glossary.plausible_ranges ?? {};

/** 妥当範囲の外は聞き間違いとみなして null */
function inRange(field: keyof NonNullable<Glossary['plausible_ranges']>, v: number | null): number | null {
  if (v == null) return null;
  const r = RANGES[field];
  if (!r) return v;
  return v >= r[0] && v <= r[1] ? v : null;
}

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
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          avg_weight_g: { type: ['integer', 'null'] },
          count_per_basket: { type: ['integer', 'null'] },
          basket_count: { type: ['integer', 'null'] },
        },
        required: ['avg_weight_g', 'count_per_basket', 'basket_count'],
        additionalProperties: false,
      },
    },
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
    'items',
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
  const rawItems = Array.isArray(o.items) ? (o.items as Record<string, unknown>[]) : [];
  let items: ExtractItem[] = rawItems
    .filter((it) => it && typeof it === 'object')
    .map((it) => ({
      avg_weight_g: inRange('avg_weight_g', int(it.avg_weight_g)),
      count_per_basket: inRange('count_per_basket', int(it.count_per_basket)),
      basket_count: inRange('basket_count', int(it.basket_count)),
    }))
    .filter((it) => it.avg_weight_g != null || it.count_per_basket != null || it.basket_count != null);
  const first = items[0];
  const avg = first?.avg_weight_g ?? inRange('avg_weight_g', int(o.avg_weight_g));
  const cnt = first?.count_per_basket ?? inRange('count_per_basket', int(o.count_per_basket));
  const bsk = first?.basket_count ?? inRange('basket_count', int(o.basket_count));
  if (items.length === 0 && (avg != null || cnt != null || bsk != null)) {
    items = [{ avg_weight_g: avg, count_per_basket: cnt, basket_count: bsk }];
  }
  const result: ExtractResult = {
    work_type: workType,
    location_line: int(o.location_line),
    location_tier: tier,
    lot_no: normalizeLot(str(o.lot_no)),
    avg_weight_g: avg,
    count_per_basket: cnt,
    mortality: inRange('mortality', int(o.mortality)),
    basket_count: bsk,
    items,
    missing: Array.isArray(o.missing) ? o.missing.filter((m): m is string => typeof m === 'string') : [],
    notes: str(o.notes),
  };
  // 選別のときは沖出し場所が未確定なので、場所は確認対象にしない（沖出しは別の作業として記録）
  const check = workType === '選別' ? CHECK_FIELDS.filter((f) => f !== 'location_line' && f !== 'location_tier') : [...CHECK_FIELDS];
  for (const f of check) {
    if (result[f] == null && !result.missing.includes(f)) result.missing.push(f);
  }
  result.missing = result.missing.filter((m) => (check as readonly string[]).includes(m));
  return result;
}

/** ロット番号を R8-K3 の型に正規化。型に合わなければ null（確認に回す） */
export function normalizeLot(raw: string | null): string | null {
  if (!raw) return null;
  let t = raw
    .replace(/[Ａ-Ｚａ-ｚ０-９－]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toUpperCase()
    .replace(/[\s　]/g, '')
    .replace(/アール/g, 'R')
    .replace(/ケー|ケイ/g, 'K')
    .replace(/[‐‑–—−ー]/g, '-')
    .replace(/の/g, '-')
    .replace(/^R(\d{1,2})-?K/, 'R$1-K');
  const full = /^R(\d{1,2})-?K(\d{1,2})$/.exec(t);
  if (full) return `R${Number(full[1])}-K${Number(full[2])}`;
  const kOnly = /^K(\d{1,2})$/.exec(t);
  if (kOnly) return `${LOT_CURRENT_PREFIX}-K${Number(kOnly[1])}`;
  return LOT_REGEX.test(t) ? t : null;
}
