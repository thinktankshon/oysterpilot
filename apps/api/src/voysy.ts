import { Hono } from 'hono';
import Anthropic from '@anthropic-ai/sdk';
import { parse } from 'yaml';
import extractPrompt from '../../../prompts/voysy_extract.md';
import glossaryYaml from '../../../config/glossary.yaml';
import type { Bindings } from './types';
import { normalizeLot, normalizeFarm, normalizeBasketType, parsePlaceFromText, lotFromText, basketCountFromText } from './voysyParse';
import { diffExtraction, summarize, type ExtractionDiff } from './voysyDiff';
import type { RecordRow } from './types';

// 抽出は軽量モデルで十分（docs/01）。応答 3 秒以内を目標。
const EXTRACT_MODEL = 'claude-haiku-5-5';
const TIERS = ['上段', '中段', '下段'] as const;
// 記録の型（docs/01 11/3）：選別（陸上）・沖出し（海上）・陸揚げ（海上）・その他。分殖は選別に含める
export const FORM_TYPES = ['選別', '沖出し', '陸揚げ', 'その他'] as const;
export type FormType = (typeof FORM_TYPES)[number];
const SHELL_STATES = ['刃先が伸びている', 'ツルツル', '普通'] as const;
const MEAT = ['良', '普', '悪'] as const;
const PURPOSES = ['選別', '出荷', '移動'] as const;

export type ExtractItem = {
  avg_weight_g: number | null;
  count_per_basket: number | null;
  basket_count: number | null;
  basket_type: string | null;
};

export type ExtractResult = {
  work_type: FormType;
  work_type_guessed: boolean;
  lot_no: string | null;
  // 沖出し・陸揚げ：場所（漁場・レーン・間 から〜まで）とかご数
  farm: string | null;
  lane: number | null;
  ma_from: number | null;
  ma_to: number | null;
  basket_count: number | null;
  purpose: (typeof PURPOSES)[number] | null; // 陸揚げ
  // 選別
  items: ExtractItem[];
  mortality: number | null;
  shell_state: (typeof SHELL_STATES)[number] | null;
  meat_quality: (typeof MEAT)[number] | null;
  fouling: boolean | null;
  workers: number | null;
  duration_min: number | null;
  // 旧表記（seed や AI Oysterman の互換用）。言われたときだけ
  location_line: number | null;
  location_tier: (typeof TIERS)[number] | null;
  notes: string | null;
  missing: string[]; // 聞き間違いの疑いがある項目、推定した work_type だけ
};

// 用語集（config/glossary.yaml）からロット型と数値の妥当範囲を読む
type Glossary = {
  lot_format?: { regex?: string; current_prefix?: string };
  plausible_ranges?: Partial<Record<string, [number, number]>>;
};
const glossary = parse(glossaryYaml) as Glossary;
const LOT_CURRENT_PREFIX = glossary.lot_format?.current_prefix ?? 'R8';
const RANGES = glossary.plausible_ranges ?? {};

function inRange(field: string, v: number | null): number | null {
  if (v == null) return null;
  const r = RANGES[field];
  if (!r) return v;
  return v >= r[0] && v <= r[1] ? v : null;
}

// 構造化出力は union 型（null 許容・anyOf）が 16 個までという制限があるので、null を使わず
// 「不明な数値は -1、不明な文字は空文字」で受けて normalize() で null に戻す。
const INT = { type: 'integer', description: '不明なら -1' } as const;
const STR = { type: 'string', description: '不明なら空文字' } as const;
const enumOrEmpty = (vals: readonly string[], desc: string) => ({ type: 'string', enum: [...vals, ''], description: `${desc}。不明なら空文字` });

const extractSchema = {
  type: 'object',
  properties: {
    work_type: { type: 'string', enum: [...FORM_TYPES] },
    work_type_guessed: { type: 'boolean', description: '作業の種類が言われず推定したら true' },
    lot_no: STR,
    farm: STR,
    lane: INT,
    ma_from: INT,
    ma_to: INT,
    basket_count: INT,
    purpose: enumOrEmpty(PURPOSES, '陸揚げの目的'),
    items: {
      type: 'array',
      description: '選別のサイズ帯。選別以外は空配列',
      items: {
        type: 'object',
        properties: { avg_weight_g: INT, count_per_basket: INT, basket_count: INT, basket_type: STR },
        required: ['avg_weight_g', 'count_per_basket', 'basket_count', 'basket_type'],
        additionalProperties: false,
      },
    },
    mortality: INT,
    shell_state: enumOrEmpty(SHELL_STATES, '殻の状態'),
    meat_quality: enumOrEmpty(MEAT, '身入り'),
    fouling: { type: 'string', enum: ['あり', 'なし', ''], description: '付着物。不明なら空文字' },
    workers: INT,
    duration_min: INT,
    location_line: INT,
    location_tier: enumOrEmpty(TIERS, '旧表記の段'),
    notes: STR,
    missing: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'work_type', 'work_type_guessed', 'lot_no', 'farm', 'lane', 'ma_from', 'ma_to', 'basket_count', 'purpose', 'items',
    'mortality', 'shell_state', 'meat_quality', 'fouling', 'workers', 'duration_min', 'location_line', 'location_tier', 'notes', 'missing',
  ],
  additionalProperties: false,
} as const;

const systemPrompt =
  extractPrompt +
  '\n\n---\n以下は用語集（config/glossary.yaml）。作業名の正規化と用語の解釈、数値の妥当範囲（plausible_ranges）に使う。\n```yaml\n' +
  glossaryYaml +
  '\n```\n';

export const voysy = new Hono<{ Bindings: Bindings }>();

// POST /api/voysy/extract  { text } → 作業別の型に整理した JSON
voysy.post('/extract', async (c) => {
  const body = await c.req.json<{ text?: unknown; segment_id?: unknown }>().catch(() => null);
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  const segmentId = typeof body?.segment_id === 'number' ? body.segment_id : null;
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
  const result = normalize(parsed, text);
  // 読み取りの検証用に抽出結果を残す（保存時に record_ids が付く）。失敗しても結果は返す
  let extractionId: number | null = null;
  try {
    const r = await c.env.DB.prepare('INSERT INTO voysy_extractions (created_at, segment_id, raw_text, result_json) VALUES (?, ?, ?, ?)')
      .bind(new Date().toISOString(), segmentId, text, JSON.stringify(result))
      .run();
    extractionId = Number(r.meta.last_row_id);
  } catch (e) {
    console.error('voysy_extractions insert failed', e instanceof Error ? e.message : e);
  }
  return c.json({ ...result, extraction_id: extractionId });
});

// GET /api/voysy/accuracy?limit=200  抽出結果と保存済み記録の差分（読み取りの検証）
voysy.get('/accuracy', async (c) => {
  const limit = Math.min(500, Math.max(1, Number(c.req.query('limit') ?? 200) || 200));
  const { results } = await c.env.DB.prepare(
    'SELECT id, created_at, raw_text, result_json, record_ids FROM voysy_extractions WHERE saved_at IS NOT NULL ORDER BY id DESC LIMIT ?',
  )
    .bind(limit)
    .all<{ id: number; created_at: string; raw_text: string; result_json: string; record_ids: string }>();
  const diffs: ExtractionDiff[] = [];
  for (const row of results) {
    let ids: number[] = [];
    let result: ExtractResult;
    try {
      ids = (JSON.parse(row.record_ids) as number[]).filter((n) => Number.isInteger(n));
      result = JSON.parse(row.result_json) as ExtractResult;
    } catch {
      continue;
    }
    if (ids.length === 0) continue;
    const { results: recs } = await c.env.DB.prepare(`SELECT * FROM records WHERE id IN (${ids.map(() => '?').join(',')})`)
      .bind(...ids)
      .all<RecordRow>();
    const d = diffExtraction({ id: row.id, created_at: row.created_at, raw_text: row.raw_text, result }, recs);
    if (d) diffs.push(d);
  }
  return c.json({ summary: summarize(diffs), diffs });
});

/** モデル出力を検証し、作業の型に合わない項目を落とす */
export function normalize(v: unknown, rawText = ''): ExtractResult {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  // -1 と空文字は「不明」（スキーマの制約で null を使えないため）
  const int = (x: unknown) => (typeof x === 'number' && Number.isInteger(x) && x >= 0 ? x : null);
  const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null);
  const pick = <T extends readonly string[]>(vals: T, x: unknown): T[number] | null =>
    (vals as readonly string[]).includes(x as string) ? (x as T[number]) : null;
  const workType: FormType = pick(FORM_TYPES, o.work_type) ?? 'その他';
  const guessed = o.work_type_guessed === true;

  const rawItems = Array.isArray(o.items) ? (o.items as Record<string, unknown>[]) : [];
  const items: ExtractItem[] = rawItems
    .filter((it) => it && typeof it === 'object')
    .map((it) => ({
      avg_weight_g: inRange('avg_weight_g', int(it.avg_weight_g)),
      count_per_basket: inRange('count_per_basket', int(it.count_per_basket)),
      basket_count: inRange('basket_count', int(it.basket_count)),
      basket_type: normalizeBasketType(str(it.basket_type)),
    }))
    .filter((it) => it.avg_weight_g != null || it.count_per_basket != null || it.basket_count != null);

  // notes は確認対象にしない。basket_type は任意の文字項目で聞き間違いの対象にならない
  const missing = (Array.isArray(o.missing) ? o.missing.filter((m): m is string => typeof m === 'string') : []).filter(
    (m) => m !== 'notes' && m !== 'basket_type',
  );
  if (guessed && !missing.includes('work_type')) missing.push('work_type');

  const base: ExtractResult = {
    work_type: workType,
    work_type_guessed: guessed,
    lot_no: normalizeLot(str(o.lot_no), LOT_CURRENT_PREFIX),
    farm: normalizeFarm(str(o.farm)),
    lane: inRange('lane', int(o.lane)),
    ma_from: inRange('ma', int(o.ma_from)),
    ma_to: inRange('ma', int(o.ma_to)),
    basket_count: inRange('basket_count', int(o.basket_count)),
    purpose: pick(PURPOSES, o.purpose),
    items,
    mortality: inRange('mortality', int(o.mortality)),
    shell_state: pick(SHELL_STATES, o.shell_state),
    meat_quality: pick(MEAT, o.meat_quality),
    fouling: o.fouling === 'あり' || o.fouling === true ? true : o.fouling === 'なし' || o.fouling === false ? false : null,
    workers: inRange('workers', int(o.workers)),
    duration_min: inRange('duration_min', int(o.duration_min)),
    location_line: int(o.location_line),
    location_tier: pick(TIERS, o.location_tier),
    notes: str(o.notes),
    missing,
  };
  // モデルがロットを読めなかったら、発話から拾う（「R 8の型2」「R 3の計算」）。正規化で型に揃ったら確認は外す
  if (base.lot_no == null && rawText) base.lot_no = lotFromText(rawText, LOT_CURRENT_PREFIX);
  if (base.lot_no != null) base.missing = base.missing.filter((m) => m !== 'lot_no');
  // モデルが場所を落としたら、発話から正規表現で拾う（「ディー魚場5連5件目から12件目」のような崩れにも効く）
  if ((workType === '沖出し' || workType === '陸揚げ') && rawText) {
    if (base.basket_count == null) {
      const bc = basketCountFromText(rawText);
      if (bc != null) {
        base.basket_count = inRange('basket_count', bc);
        if (base.basket_count != null) base.missing = base.missing.filter((m) => m !== 'basket_count');
      }
    }
    const place = parsePlaceFromText(rawText);
    if (base.farm == null && place.farm) base.farm = place.farm;
    if (base.lane == null && place.lane != null) base.lane = inRange('lane', place.lane);
    if (base.ma_from == null && place.ma_from != null) base.ma_from = inRange('ma', place.ma_from);
    if (base.ma_to == null && place.ma_to != null) base.ma_to = inRange('ma', place.ma_to);
    for (const f of ['farm', 'lane', 'ma_from', 'ma_to'] as const) {
      if (base[f] != null) base.missing = base.missing.filter((m) => m !== f);
    }
  }
  if (base.ma_from != null && base.ma_to != null && base.ma_to < base.ma_from) [base.ma_from, base.ma_to] = [base.ma_to, base.ma_from];
  if (base.ma_from != null && base.ma_to == null) base.ma_to = base.ma_from;

  // 型ごとに不要な項目を落とす
  if (workType === '選別') {
    base.farm = null; base.lane = null; base.ma_from = null; base.ma_to = null; base.purpose = null; base.basket_count = null;
    if (base.items.length === 0) base.items = [{ avg_weight_g: null, count_per_basket: null, basket_count: null, basket_type: null }];
  } else if (workType === '沖出し') {
    base.items = []; base.mortality = null; base.shell_state = null; base.meat_quality = null; base.fouling = null;
    base.workers = null; base.duration_min = null; base.purpose = null;
  } else if (workType === '陸揚げ') {
    base.items = []; base.mortality = null; base.shell_state = null; base.meat_quality = null; base.fouling = null;
    base.workers = null; base.duration_min = null;
  } else {
    base.items = [];
  }
  return base;
}
