// node --test src/rules.test.ts  （Node 26 は TS を直接実行できる）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { detectTopic, evaluateRules, type RulesConfig } from './rules.ts';

const cfg = parse(readFileSync(new URL('../../../config/rules.yaml', import.meta.url), 'utf-8')) as RulesConfig;
const growth = { hot_streak: 0, cold_streak: 0, in_growth_band: true };
const noTopic = { sort_related: false, shell_long: false, shell_smooth: false, poor_meat: false, storm: false, out_of_scope: false };

test('デモ会話：成長期・19日・36g×45個・刃先が伸びた → R3 と R5、1.5kg 目安で約42個', () => {
  const topic = detectTopic('3番ラインの貝、刃先がひょろっと伸びてきた。このままでいい？');
  assert.equal(topic.shell_long, true);
  const ev = evaluateRules(cfg, growth, { days_since_last_sort: 19, avg_weight_g: 36, count_per_basket: 45 }, topic);
  assert.deepEqual(ev.fired_ids.sort(), ['R3_growth_check', 'R4_basket_target', 'R5_shell_long']);
  assert.equal(ev.basket_kg_target, 1.5);
  assert.equal(ev.count_target, 42);
  assert.equal(ev.ask_first, '上段だけですか？ 下段も同じ様子ですか？');
  assert.equal(ev.out_of_scope, false);
});

test('R3 は 15 日未満では出ない。成長帯の外でも出ない', () => {
  const a = evaluateRules(cfg, growth, { days_since_last_sort: 13, avg_weight_g: 36, count_per_basket: 45 }, noTopic);
  assert.deepEqual(a.fired_ids, []);
  const b = evaluateRules(cfg, { ...growth, in_growth_band: false }, { days_since_last_sort: 19, avg_weight_g: 36, count_per_basket: 45 }, noTopic);
  assert.deepEqual(b.fired_ids, []);
});

test('R7：30 日超で選別。R3 は同時に出さない。R4 が添えられる', () => {
  const ev = evaluateRules(cfg, growth, { days_since_last_sort: 31, avg_weight_g: 40, count_per_basket: 50 }, noTopic);
  assert.deepEqual(ev.fired_ids.sort(), ['R4_basket_target', 'R7_sort_due']);
  assert.match(ev.fired[0].say, /31 日で、貝をチェックする目安（30日）/);
  assert.equal(ev.basket_kg_target, 2.0); // R7 だけなら目安は通常の 2.0
});

test('低水温 R2：選別目安は 45 日に伸びる。40 日では R7 は出ない、50 日で出る', () => {
  const cold = { hot_streak: 0, cold_streak: 7, in_growth_band: false };
  const a = evaluateRules(cfg, cold, { days_since_last_sort: 40, avg_weight_g: 30, count_per_basket: 60 }, noTopic);
  assert.equal(a.effective_sort_interval, 45);
  assert.deepEqual(a.fired_ids, ['R2_cold']);
  const b = evaluateRules(cfg, cold, { days_since_last_sort: 50, avg_weight_g: 30, count_per_basket: 60 }, noTopic);
  assert.ok(b.fired_ids.includes('R7_sort_due'));
});

test('高水温 R1 と R7 が同時 → 「手早く」の補足。目安は 1.5kg', () => {
  const hot = { hot_streak: 7, cold_streak: 0, in_growth_band: false };
  const ev = evaluateRules(cfg, hot, { days_since_last_sort: 35, avg_weight_g: 50, count_per_basket: 40 }, noTopic);
  assert.ok(ev.fired_ids.includes('R1_hot') && ev.fired_ids.includes('R7_sort_due'));
  assert.equal(ev.hints[0], '選別しましょう。高水温なので手早く');
  assert.equal(ev.basket_kg_target, 1.5);
  assert.equal(ev.count_target, 30);
});

test('殻がツルツル → R6、2.5kg 目安（薄めより優先）', () => {
  const topic = detectTopic('殻がツルツルに削られてる気がする');
  const ev = evaluateRules(cfg, growth, { days_since_last_sort: 19, avg_weight_g: 36, count_per_basket: 45 }, topic);
  assert.ok(ev.fired_ids.includes('R6_shell_smooth'));
  assert.equal(ev.basket_kg_label, 'dense');
  assert.equal(ev.basket_kg_target, 2.5);
});

test('範囲外：分からない・解決しない', () => {
  // 2026-11-04：衛生・制度の一般論は答えるので、語だけでは範囲外にしない（個別の可否はモデルが判断）
  assert.equal(detectTopic('ノロウイルスは大丈夫？').out_of_scope, false);
  assert.equal(detectTopic('よく分からない').out_of_scope, true);
  assert.equal(detectTopic('解決しない').out_of_scope, true);
  assert.equal(detectTopic('3番の選別いつやる？').out_of_scope, false);
});

test('R8：斃死 20% 以上で注意。30g 以上なら補足。20% 未満は出ない', () => {
  // 36g・45個×6かご=270、斃死 70 → 70/340 = 20.6%
  const a = evaluateRules(cfg, growth, { days_since_last_sort: 13, avg_weight_g: 36, count_per_basket: 45, basket_count: 6, mortality_recent: 70 }, noTopic);
  assert.ok(a.fired_ids.includes('R8_mortality_notice'));
  assert.match(a.fired[0].say, /21%/);
  assert.ok(a.hints.some((h) => h.includes('30g')));
  const b = evaluateRules(cfg, growth, { days_since_last_sort: 13, avg_weight_g: 36, count_per_basket: 45, basket_count: 6, mortality_recent: 8 }, noTopic);
  assert.ok(!b.fired_ids.includes('R8_mortality_notice'));
});

test('R9：直近7日平均 26℃ 以上、または hot で「1日で完結」を添える', () => {
  const warm = { ...growth, mean7: 26.5, season: 'growth' as const };
  assert.ok(evaluateRules(cfg, warm, { days_since_last_sort: 5, avg_weight_g: 30, count_per_basket: 50 }, noTopic).fired_ids.includes('R9_summer_work'));
  const cool = { ...growth, mean7: 23, season: 'growth' as const };
  assert.ok(!evaluateRules(cfg, cool, { days_since_last_sort: 5, avg_weight_g: 30, count_per_basket: 50 }, noTopic).fired_ids.includes('R9_summer_work'));
});

test('R10：台風の話題で前後の手順を出す。入数は容量 1/4 の言い方も返す', () => {
  const topic = detectTopic('台風が来るけど何かしておくことある？');
  assert.equal(topic.storm, true);
  const ev = evaluateRules(cfg, growth, { days_since_last_sort: 5, avg_weight_g: 30, count_per_basket: 50 }, topic);
  assert.ok(ev.fired_ids.includes('R10_storm'));
  assert.match(ev.basket_fill_hint ?? '', /25%/);
  assert.match(ev.basket_fill_hint ?? '', /15Lで約1.5kg/);
});
