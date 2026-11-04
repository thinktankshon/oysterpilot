import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffExtraction, summarize } from './voysyDiff.ts';
import type { ExtractResult } from './voysy.ts';
import type { RecordRow } from './types.ts';

const base: ExtractResult = {
  work_type: '選別', work_type_guessed: false, lot_no: 'R8-K2', farm: null, lane: null, ma_from: null, ma_to: null,
  basket_count: null, purpose: null,
  items: [{ avg_weight_g: 40, count_per_basket: 40, basket_count: 5, basket_type: null }],
  mortality: 12, shell_state: null, meat_quality: null, fouling: null, workers: null, duration_min: null,
  location_line: null, location_tier: null, notes: '右はいい', missing: [],
};
const rec = (over: Partial<RecordRow>): RecordRow => ({
  id: 1, recorded_at: '2026-11-04T10:00:00+09:00', work_type: '選別', location_line: null, location_tier: null, lot_no: 'R8-K2',
  avg_weight_g: 40, count_per_basket: 40, basket_count: 5, mortality: 12, raw_text: 'x', notes: null, farm: null, lane: null,
  ma_from: null, ma_to: null, basket_type: null, shell_state: null, meat_quality: null, fouling: null, workers: null, duration_min: null,
  source: 'voysy', ...over,
});

test('人が身入りを埋め、メモを消し、2 帯目を足した差分', () => {
  const d = diffExtraction({ id: 1, created_at: 'now', raw_text: 'x', result: base }, [
    rec({ id: 1, meat_quality: '良', notes: null }),
    rec({ id: 2, avg_weight_g: 25, count_per_basket: 60, basket_count: 4, mortality: null, meat_quality: '良' }),
  ]);
  assert.ok(d);
  const kinds = Object.fromEntries(d.diffs.map((x) => [x.field, x.kind]));
  assert.equal(kinds['meat_quality'], 'filled');
  assert.equal(kinds['notes'], 'cleared');
  assert.equal(kinds['items.count'], 'corrected');
  assert.equal(kinds['items[1].avg_weight_g'], 'filled');
  assert.equal(d.work_type_saved, '選別');
  const s = summarize([d]);
  assert.equal(s.extractions, 1);
  assert.equal(s.by_field['items[].avg_weight_g'].filled, 1);
});

test('全部一致なら diffs は空', () => {
  const d = diffExtraction({ id: 2, created_at: 'now', raw_text: 'x', result: { ...base, notes: null } }, [rec({})]);
  assert.ok(d);
  assert.deepEqual(d.diffs, []);
  assert.ok(d.matched > 10);
});

test('沖出しは basket_count を比べ、保存が無ければ null', () => {
  const r: ExtractResult = { ...base, work_type: '沖出し', items: [], basket_count: 40, farm: 'D', lane: 5, ma_from: 1, ma_to: 8, mortality: null, notes: null };
  const d = diffExtraction({ id: 3, created_at: 'now', raw_text: 'x', result: r }, [
    rec({ work_type: '沖出し', avg_weight_g: null, count_per_basket: null, basket_count: 45, farm: 'D', lane: 5, ma_from: 1, ma_to: 8, mortality: null }),
  ]);
  assert.ok(d);
  assert.deepEqual(d.diffs, [{ field: 'basket_count', model: '40', saved: '45', kind: 'corrected' }]);
  assert.equal(diffExtraction({ id: 4, created_at: 'now', raw_text: 'x', result: r }, []), null);
});
