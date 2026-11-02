// ルール判定（config/rules.yaml）。閾値の判断はここで行い、Claude には「成立しているルール」だけを渡す（docs/02）。
// 純粋関数のみ（Node の単体テストから直接呼べるよう、ファイル読込は rulesConfig.ts に分離）。

export type Thresholds = {
  hot_temp_c: number;
  hot_days: number;
  cold_temp_c: number;
  cold_days: number;
  growth_band_c: [number, number];
  growth_check_days: number;
  sort_interval_days: number;
  sort_interval_cold_multiplier: number;
  basket_kg_normal: number;
  basket_kg_thin: number;
  basket_kg_dense: number;
};

export type RuleDef = {
  id: string;
  kind: 'notice' | 'advice' | 'recommend';
  say: string;
  ask_first?: string;
  note?: string;
};

export type RulesConfig = {
  meta: { version: string; water_source: string; tone: string[] };
  thresholds: Thresholds;
  rules: RuleDef[];
  out_of_scope: { say: string; action: string; triggers: string[] };
};

export type EnvInput = {
  hot_streak: number;
  cold_streak: number;
  in_growth_band: boolean;
};

export type LotInput = {
  days_since_last_sort: number | null;
  avg_weight_g: number | null;
  count_per_basket: number | null;
};

export type Topic = {
  sort_related: boolean; // 選別・分殖・入数・身質の話題
  shell_long: boolean; // 殻（刃先）が伸びている
  shell_smooth: boolean; // 殻がツルツル・削られすぎ
  poor_meat: boolean; // 身入り・身質が悪い
  out_of_scope: boolean; // 病気・衛生・販売・法規、または「分からない」「解決しない」
};

export type FiredRule = { id: string; kind: RuleDef['kind']; say: string; ask_first?: string };

export type Evaluation = {
  fired: FiredRule[];
  fired_ids: string[];
  effective_sort_interval: number;
  basket_kg_target: number;
  basket_kg_label: 'normal' | 'thin' | 'dense';
  count_target: number | null;
  hints: string[]; // 言い回しの補足（例：高水温なので手早く）
  ask_first: string | null; // 先に1つだけ聞き返す内容
  out_of_scope: boolean;
};

/** 相談文から話題を拾う（判定は単純な語の一致。LLM に閾値判断をさせないための前処理） */
export function detectTopic(text: string): Topic {
  const t = text.replace(/\s+/g, '');
  const has = (re: RegExp) => re.test(t);
  return {
    sort_related: has(/選別|分殖|かご分け|入数|入り数|身質|身入り|薄め|かご.*(個|kg|キロ)/),
    shell_long: has(/(殻|刃先|カラ).{0,6}(伸び|のび|ひょろ|長)|ひょろ|伸びてき/),
    shell_smooth: has(/ツルツル|つるつる|削られ|けずられ|丸くなりすぎ|丸すぎ/),
    poor_meat: has(/(身入り|身質|身).{0,4}(悪|薄|細|少な|良くない|よくない)/),
    out_of_scope: has(/ノロ|ウイルス|貝毒|衛生|病気|販売|売|価格|値段|法律|法規|許可|保険|分からない|わからない|解決しない|解決できない/),
  };
}

export function evaluateRules(cfg: RulesConfig, env: EnvInput, lot: LotInput, topic: Topic): Evaluation {
  const th = cfg.thresholds;
  const byId = new Map(cfg.rules.map((r) => [r.id, r]));
  const fired: FiredRule[] = [];
  const hints: string[] = [];
  let thin = false;
  let dense = false;

  const r1 = env.hot_streak >= th.hot_days;
  const r2 = env.cold_streak >= th.cold_days;
  const effective = Math.round(th.sort_interval_days * (r2 ? th.sort_interval_cold_multiplier : 1));
  const days = lot.days_since_last_sort;
  const r7 = days != null && days > effective;
  const r3 = !r7 && env.in_growth_band && days != null && days >= th.growth_check_days && days < effective;
  const r5 = topic.shell_long;
  const r6 = topic.shell_smooth;

  if (r1) {
    thin = true;
    fired.push(fire(byId, 'R1_hot', {}));
  }
  if (r2) fired.push(fire(byId, 'R2_cold', {}));
  if (r7) {
    fired.push(fire(byId, 'R7_sort_due', { days: String(days), effective_sort_interval: String(effective) }));
    if (r1) hints.push('選別しましょう。高水温なので手早く');
  }
  if (r3) {
    thin = true;
    fired.push(fire(byId, 'R3_growth_check', {}));
  }
  if (r5) {
    thin = true;
    fired.push(fire(byId, 'R5_shell_long', {}));
  }
  if (r6) {
    dense = true;
    fired.push(fire(byId, 'R6_shell_smooth', {}));
  }
  if (topic.poor_meat) thin = true;

  const label: Evaluation['basket_kg_label'] = dense ? 'dense' : thin ? 'thin' : 'normal';
  const target = label === 'dense' ? th.basket_kg_dense : label === 'thin' ? th.basket_kg_thin : th.basket_kg_normal;
  const count = lot.avg_weight_g ? Math.round((target * 1000) / lot.avg_weight_g) : null;

  if (topic.sort_related || r5 || r6 || r7) {
    fired.push(
      fire(byId, 'R4_basket_target', {
        basket_kg_target: String(target),
        avg_weight_g: lot.avg_weight_g != null ? String(lot.avg_weight_g) : '—',
        count_target: count != null ? String(count) : '—',
      }),
    );
  }

  const askRule = fired.find((f) => f.ask_first);
  return {
    fired,
    fired_ids: fired.map((f) => f.id),
    effective_sort_interval: effective,
    basket_kg_target: target,
    basket_kg_label: label,
    count_target: count,
    hints,
    ask_first: askRule?.ask_first ?? null,
    out_of_scope: topic.out_of_scope,
  };
}

function fire(byId: Map<string, RuleDef>, id: string, vars: Record<string, string>): FiredRule {
  const def = byId.get(id);
  if (!def) return { id, kind: 'notice', say: '' };
  const say = def.say.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
  return { id, kind: def.kind, say, ...(def.ask_first ? { ask_first: def.ask_first } : {}) };
}
