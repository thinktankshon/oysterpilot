import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFocus, parseLocation } from './lot.ts';

test('parseLocation: 3番の上段 / ５番ライン', () => {
  assert.deepEqual(parseLocation('3番の上段、選別した'), { line: 3, tier: '上段' });
  assert.deepEqual(parseLocation('５番ラインの貝'), { line: 5, tier: null });
  assert.equal(parseLocation('最近の水温ってどう？'), null);
});

test('resolveFocus: 「3番ラインの貝」→「上段だけ。下段は締まってる」で 3番・上段', () => {
  const f = resolveFocus(['3番ラインの貝、刃先がひょろっと伸びてきた。このままでいい？', '上段だけ。下段はまだ締まってる', 'この作業を予約して。明日やる。']);
  assert.deepEqual(f, { line: 3, tier: '上段' });
});

test('resolveFocus: 別のラインに移ったら段は引き継がない', () => {
  assert.deepEqual(resolveFocus(['3番の上段どう？', '5番はどう？']), { line: 5, tier: null });
});
