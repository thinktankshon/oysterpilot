import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segmentRange, SEGMENT_LEAD_MS } from './audio.ts';

// 3 区切りの録音：印 2 が 30 秒、印 3 が 70 秒、全体 100 秒
const entry = { duration_ms: 100_000, marks: [{ seq: 2, at_ms: 30_000 }, { seq: 3, at_ms: 70_000 }] };

test('区切り 1 は録音の頭から印 2 まで', () => {
  assert.deepEqual(segmentRange(entry, 1), { start_ms: 0, end_ms: 30_000 });
});

test('途中の区切りは印の 2 秒手前から次の印まで', () => {
  assert.deepEqual(segmentRange(entry, 2), { start_ms: 30_000 - SEGMENT_LEAD_MS, end_ms: 70_000 });
});

test('最後の区切りは末尾まで', () => {
  assert.deepEqual(segmentRange(entry, 3), { start_ms: 70_000 - SEGMENT_LEAD_MS, end_ms: 100_000 });
});

test('印が無い区切り・1件記録は全体', () => {
  assert.deepEqual(segmentRange(entry, 5), { start_ms: 0, end_ms: 100_000 });
  assert.deepEqual(segmentRange(entry, null), { start_ms: 0, end_ms: 100_000 });
  assert.deepEqual(segmentRange({ duration_ms: 12_000, marks: [] }, 1), { start_ms: 0, end_ms: 12_000 });
});

test('印の手前が録音の頭を越えない', () => {
  assert.deepEqual(segmentRange({ duration_ms: 9_000, marks: [{ seq: 2, at_ms: 1_000 }] }, 2), { start_ms: 0, end_ms: 9_000 });
});
