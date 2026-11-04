import { Hono } from 'hono';
import Anthropic from '@anthropic-ai/sdk';
import systemTemplate from '../../../prompts/oysterman_system.md';
import glossaryYaml from '../../../config/glossary.yaml';
import digestMd from '../../../knowledge/digest.md';
import reblueViewsMd from '../../../knowledge/reblue_views.md';
import appHelpMd from '../../../knowledge/app_help.md';
import generalQaMd from '../../../knowledge/general_qa.md';
import { getRulesConfig, getRulesYaml } from './rulesConfig';
import { computeEnv, getSuonada } from './env';
import { detectTopic, evaluateRules, type Evaluation, type Topic } from './rules';
import { getAllLotSummaries, locationLabel, resolveFocus, todayJst, type LotSummary } from './lot';
import type { Bindings, ReservationRow } from './types';

const CHAT_MODEL = 'claude-sonnet-5-5';
// 言い回しの禁止（CLAUDE.md / rules.yaml tone）。返答に含まれたら1回だけ言い直させる。
// ただし否定形（「必ず死ぬわけではありません」「予測はしません」）と、ユーザーの言葉の引用「…」は断定ではないので除外する。
const FORBIDDEN = /死にます|必ず|予測|安全です|最適です/;
export function hasForbidden(text: string): boolean {
  const t = text
    .replace(/「[^」]*」/g, '')
    .replace(/(安全|最適)です(?:とは|と)?(言い切れません|言えません|とは限りません|とは限らない|ではありません)/g, '')
    .replace(/必ず(しも)?[^。！？\n]{0,20}?(ではありません|ではない|わけではな|とは限りません|とは限らない|言えません|言い切れません|決まっていません)/g, '')
    .replace(/予測(は|を|も)?[^。！？\n]{0,10}?(しません|できません|ではなく|いたしません|は行いません)/g, '')
    .replace(/死にます[^。！？\n]{0,10}?(とは限りません|とは言えません|とは限らない)/g, '');
  return FORBIDDEN.test(t);
}
const FALLBACK_REPLY = 'うまく言葉にできませんでした。もう一度、状況を教えてください。';

type ChatMessage = { role: 'user' | 'assistant'; content: string };
type ChatBody = { messages?: ChatMessage[]; scan_report_id?: number };
type Reservation = { due_date: string; work: string; reason: string; location_line: number | null; location_tier: string | null };

export const oysterman = new Hono<{ Bindings: Bindings }>();

// GET /api/oysterman/logs?out_of_scope=1&limit=50  会話ログ（答えられなかった質問の洗い出し用）
oysterman.get('/logs', async (c) => {
  const oos = c.req.query('out_of_scope');
  const fallback = c.req.query('fallback');
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? 50) || 50));
  const where: string[] = [];
  if (oos === '1') where.push('out_of_scope = 1');
  if (fallback === '1') where.push('fallback = 1');
  const sql = `SELECT * FROM chat_logs${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`;
  const { results } = await c.env.DB.prepare(sql).bind(limit).all();
  return c.json(results);
});

// POST /api/oysterman/chat  { messages[], scan_report_id? }
oysterman.post('/chat', async (c) => {
  const startedAt = Date.now();
  const body = await c.req.json<ChatBody>().catch(() => null);
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    return c.json({ error: 'messages is required' }, 400);
  }
  const messages = body.messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-20);
  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
    return c.json({ error: 'last message must be from user' }, 400);
  }
  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'ANTHROPIC_API_KEY が未設定です（wrangler secret put / .dev.vars）' }, 503);
  }

  // 1) 記録（全場所）・予約・水温・場所ごとのルール判定（閾値の判断はコード側）
  const cfg = getRulesConfig();
  const today = todayJst();
  const [lots, reservations] = await Promise.all([
    getAllLotSummaries(c.env.DB, today),
    c.env.DB.prepare("SELECT * FROM reservations WHERE status = 'open' AND due_date >= ? ORDER BY due_date ASC LIMIT 20")
      .bind(today)
      .all<ReservationRow>()
      .then((r) => r.results),
  ]);
  const env = computeEnv(getSuonada(), cfg.thresholds);
  const userText = messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
  const lastUser = messages[messages.length - 1].content;
  const topic: Topic = { ...detectTopic(userText), out_of_scope: detectTopic(lastUser).out_of_scope };

  // 会話全体から場所を解決する（「3番の貝…」→「上段だけ」で 3番・上段）
  const focus = resolveFocus(messages.filter((m) => m.role === 'user').map((m) => m.content));
  const focusLots = focus
    ? lots.filter((l) => l.location_line === focus.line && (focus.tier == null || l.location_tier === focus.tier))
    : [];
  const perLot = lots.map((lot) => ({ lot, ev: evaluateRules(cfg, env, lot, topic) }));
  const primary = (focusLots.length ? perLot.filter((p) => focusLots.includes(p.lot)) : perLot).sort(byUrgency);
  const primaryEv: Evaluation | null = primary[0]?.ev ?? null;

  // 2) Oyscan からの引き継ぎ（AO-09）
  let scanReport: string | null = null;
  if (body.scan_report_id != null) {
    const row = await c.env.DB.prepare('SELECT report_text, metrics_json FROM scan_reports WHERE id = ?')
      .bind(Number(body.scan_report_id))
      .first<{ report_text: string; metrics_json: string }>()
      .catch(() => null);
    if (row) scanReport = `${row.report_text}\n指標: ${row.metrics_json}`;
  }

  // 3) システムプロンプト
  const firedForPrompt = {
    by_location: perLot.map(({ lot, ev }) => ({
      location: lot.location_label,
      fired: ev.fired.map((f) => ({ id: f.id, kind: f.kind, say: f.say, ...(f.ask_first ? { ask_first: f.ask_first } : {}) })),
      hints: ev.hints,
      basket_kg_target: ev.basket_kg_target,
      count_target: ev.count_target,
      basket_fill_hint: ev.basket_fill_hint,
      mortality_ratio: ev.mortality_ratio,
      effective_sort_interval_days: ev.effective_sort_interval,
    })),
    // 「今日の作業」の優先順位：予約 → 選別目安超え（R7）→ 成長期で見てみましょう（R3）
    today_priority: [
      ...reservations.filter((r) => r.due_date === today).map((r) => `予約: ${locationLabel(r.location_line ?? 0, r.location_tier)} ${r.work}`),
      ...perLot.filter((p) => p.ev.fired_ids.includes('R7_sort_due')).map((p) => `選別目安超え: ${p.lot.location_label}（${p.lot.days_since_last_sort}日）`),
      ...perLot.filter((p) => p.ev.fired_ids.includes('R3_growth_check')).map((p) => `見てみましょう: ${p.lot.location_label}（${p.lot.days_since_last_sort}日）`),
    ],
    out_of_scope_detected: topic.out_of_scope,
  };
  const system = fillTemplate(systemTemplate, {
    today,
    focus_json: JSON.stringify(focus ? { parsed: focus, matched: focusLots.map((l) => l.location_label) } : { parsed: null, matched: [] }),
    lots_json: JSON.stringify(lots),
    reservations_json: JSON.stringify(
      reservations.map((r) => ({ due_date: r.due_date, location: locationLabel(r.location_line ?? 0, r.location_tier), work: r.work, reason: r.reason })),
    ),
    env_json: JSON.stringify(env),
    fired_rules_json: JSON.stringify(firedForPrompt),
    glossary_yaml: glossaryYaml,
    rules_yaml: getRulesYaml(),
    reblue_views: reblueViewsMd,
    digest: digestMd,
    general_qa: generalQaMd,
    app_help: appHelpMd,
    scan_report: scanReport,
  });

  // 4) Claude 呼び出し（予約・範囲外は tool で構造化）
  const client = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 40_000 });
  const tools: Anthropic.Tool[] = [
    {
      name: 'propose_reservation',
      description:
        'ユーザーが「予約して」「記録に入れといて」「明日やる」など作業の実施を決めたときに、Voysy の作業予約として返す。提案しただけの段階では呼ばない。場所は【相談対象の候補】の matched が 1 つならそれを使う（会話で「上段だけ」と答えてもらった段を含む）。matched が複数で、提案が特定の段に限られるときだけ、どの段か 1 つ質問する。',
      input_schema: {
        type: 'object',
        properties: {
          due_date: { type: 'string', description: '実施日 YYYY-MM-DD（「明日」は【今日】から計算）' },
          location_line: { type: ['integer', 'null'], description: 'ライン番号' },
          location_tier: { type: ['string', 'null'], description: '上段/中段/下段。不明なら null' },
          work: { type: 'string', description: '作業の短い説明（例：揺れの強い場所へ移動・次回選別は1.5kg目安）' },
          reason: { type: 'string', description: '理由を一言' },
        },
        required: ['due_date', 'location_line', 'location_tier', 'work', 'reason'],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: 'out_of_scope',
      description:
        '個別の可否や数字の断定を求められたとき（今出荷していいか・生食用で出せるか・いくらで売れるか・儲かるか・免許が取れるか・補助金が通るか・この貝は病気か）と、ユーザーが「分からない」「解決しない」と言ったときだけ、先輩に聞く項目として要点を返す。「〜はある？」「〜って何？」「どう見分ける？」のような一般的な聞き方には使わず、一般論で答える。',
      input_schema: {
        type: 'object',
        properties: { summary: { type: 'string', description: '先輩に聞く項目の要点（1〜2行）' } },
        required: ['summary'],
        additionalProperties: false,
      },
      strict: true,
    },
  ];

  let reply = '';
  let reservation: Reservation | null = null;
  let outOfScope = topic.out_of_scope;
  let outOfScopeSummary: string | null = null;
  let usage: { input: number; output: number; cache_read: number; cache_write: number } | null = null;
  try {
    let res = await callClaude(client, system, messages, tools);
    let collected = collect(res);
    if (hasForbidden(collected.text)) {
      res = await callClaude(
        client,
        system + '\n\n【注意】直前の返答に禁止表現（死にます／必ず／予測／安全です／最適です）が含まれていました。同じ内容を、断定しない言い方で言い直してください。',
        messages,
        tools,
      );
      collected = collect(res);
    }
    reply = hasForbidden(collected.text) ? FALLBACK_REPLY : collected.text;
    reservation = collected.reservation;
    if (collected.outOfScope) {
      outOfScope = true;
      outOfScopeSummary = collected.outOfScope;
    }
    usage = {
      input: res.usage.input_tokens,
      output: res.usage.output_tokens,
      cache_read: res.usage.cache_read_input_tokens ?? 0,
      cache_write: res.usage.cache_creation_input_tokens ?? 0,
    };
  } catch (e) {
    const status = e instanceof Anthropic.APIError ? e.status : undefined;
    const message = e instanceof Error ? e.message : String(e);
    console.error('oysterman/chat failed', status, message);
    return c.json({ error: `相談に失敗しました（Claude API ${status ?? 'error'}）。少し待ってもう一度お試しください。`, detail: message }, 502);
  }

  if (reply && !/[ぁ-んァ-ン一-龥]/.test(reply)) reply = ''; // 日本語が1文字も無い返答（英文など）は捨てる
  // 最終行の「根拠：…」を取り出して本文から外す（画面で小さく出す）
  let basis: string[] = [];
  {
    const m = /(?:^|\n)\s*根拠[：:]\s*(.+)\s*$/.exec(reply);
    if (m) {
      basis = m[1].split(/[、,，・\s]+/).map((x) => x.trim()).filter(Boolean);
      reply = reply.slice(0, m.index).trim();
    }
  }
  if (!reply && outOfScopeSummary) reply = `${cfg.out_of_scope.say}\n${outOfScopeSummary}`;
  if (!reply && reservation) reply = `了解です。「${reservation.work}」を予約します。`;
  if (!reply) reply = FALLBACK_REPLY;

  // 5) 予約の書き戻し（AO-07）。場所は tool の値 → 発話から拾った場所 の順
  let saved: { id: number } | null = null;
  if (reservation) {
    const line = reservation.location_line ?? focus?.line ?? primary[0]?.lot.location_line ?? null;
    const tier = reservation.location_tier ?? (line === focus?.line ? focus?.tier ?? null : null);
    reservation = { ...reservation, due_date: normalizeDate(reservation.due_date, today), location_line: line, location_tier: tier };
    const existing = await c.env.DB.prepare(
      "SELECT id FROM reservations WHERE status = 'open' AND due_date = ? AND location_line IS ? AND location_tier IS ? LIMIT 1",
    )
      .bind(reservation.due_date, line, tier)
      .first<{ id: number }>();
    if (existing) {
      // 同じ日・同じ場所の予約は上書き（重複を作らない）
      await c.env.DB.prepare('UPDATE reservations SET work = ?, reason = ?, rule_ids = ? WHERE id = ?')
        .bind(reservation.work, reservation.reason, JSON.stringify(primaryEv?.fired_ids ?? []), existing.id)
        .run();
      saved = { id: existing.id };
    } else {
      const r = await c.env.DB.prepare(
        'INSERT INTO reservations (due_date, location_line, location_tier, work, reason, rule_ids) VALUES (?, ?, ?, ?, ?, ?)',
      )
        .bind(reservation.due_date, line, tier, reservation.work, reservation.reason, JSON.stringify(primaryEv?.fired_ids ?? []))
        .run();
      saved = { id: Number(r.meta.last_row_id) };
    }
  }

  const firedIds = [...new Set(perLot.flatMap((p) => p.ev.fired_ids))];

  // 6) 会話ログ（答えられなかった質問を後から一覧するため）。失敗しても返答は返す
  try {
    await c.env.DB.prepare(
      'INSERT INTO chat_logs (created_at, question, reply, out_of_scope, out_of_scope_summary, basis, fired_rules, turn_count, fallback, seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        new Date().toISOString(),
        lastUser,
        reply,
        outOfScope ? 1 : 0,
        outOfScopeSummary,
        basis.join('、'),
        JSON.stringify(firedIds),
        messages.length,
        reply === FALLBACK_REPLY ? 1 : 0,
        Math.round((Date.now() - startedAt) / 100) / 10,
      )
      .run();
  } catch (e) {
    console.error('chat_logs insert failed', e instanceof Error ? e.message : e);
  }

  return c.json({
    reply,
    basis,
    fired_rules: firedIds,
    focus: focusLots.map((l) => l.location_label),
    out_of_scope: outOfScope,
    out_of_scope_summary: outOfScopeSummary,
    reservation: reservation
      ? { ...reservation, ...saved, location_label: reservation.location_line != null ? locationLabel(reservation.location_line, reservation.location_tier) : null }
      : null,
    context: { env, lots: lots.map(briefLot), today_priority: firedForPrompt.today_priority },
    usage,
  });
});

function byUrgency(a: { ev: Evaluation }, b: { ev: Evaluation }): number {
  const score = (e: Evaluation) => (e.fired_ids.includes('R7_sort_due') ? 3 : e.fired_ids.includes('R3_growth_check') ? 2 : e.fired.length ? 1 : 0);
  return score(b.ev) - score(a.ev);
}

function briefLot(l: LotSummary) {
  return {
    location_label: l.location_label,
    days_since_last_sort: l.days_since_last_sort,
    avg_weight_g: l.avg_weight_g,
    count_per_basket: l.count_per_basket,
  };
}

async function callClaude(client: Anthropic, system: string, messages: ChatMessage[], tools: Anthropic.Tool[]) {
  // 知識を含む長いシステムプロンプトはプロンプトキャッシュに載せる。
  // テンプレートの <<<DYNAMIC>>> より前（話し方・用語集・ルール表・知識）は毎回同じなのでキャッシュ、後ろ（記録・水温・成立ルール）は変動。
  const [stable, dynamic] = system.split('<<<DYNAMIC>>>');
  return client.messages.create({
    model: CHAT_MODEL,
    max_tokens: 1024,
    system: dynamic
      ? [
          { type: 'text', text: stable, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: dynamic },
        ]
      : [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    tools,
    thinking: { type: 'between_tools' },
    output_config: { effort: 'low' },
  });
}

function collect(res: Anthropic.Message) {
  let text = '';
  let reservation: Reservation | null = null;
  let outOfScope: string | null = null;
  for (const b of res.content) {
    if (b.type === 'text') text += b.text;
    else if (b.type === 'tool_use') {
      const input = b.input as Record<string, unknown>;
      if (b.name === 'propose_reservation') {
        reservation = {
          due_date: String(input.due_date ?? ''),
          work: String(input.work ?? ''),
          reason: String(input.reason ?? ''),
          location_line: typeof input.location_line === 'number' ? input.location_line : null,
          location_tier: typeof input.location_tier === 'string' && input.location_tier ? input.location_tier : null,
        };
      } else if (b.name === 'out_of_scope') {
        outOfScope = String(input.summary ?? '');
      }
    }
  }
  return { text: text.trim(), reservation, outOfScope };
}

/** {{key}} と {{#if key}}...{{/if}} だけの簡易テンプレート */
function fillTemplate(tpl: string, vars: Record<string, string | null>): string {
  let out = tpl.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, k: string, body: string) => (vars[k] ? body : ''));
  out = out.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');
  return out;
}

/** YYYY-MM-DD 以外（「明日」など）が来たら今日の翌日に丸める */
function normalizeDate(s: string, today: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
