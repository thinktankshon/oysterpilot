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

import { parsePlaceFromText, normalizeLot, normalizeFarm, lotFromText, basketCountFromText } from './voysyParse.ts';

test('parsePlaceFromText: 崩れた表記からも場所を拾う', () => {
  assert.deepEqual(parsePlaceFromText('ディー魚場5連5件目から12件目、10かご'), { farm: 'D', lane: 5, ma_from: 5, ma_to: 12 });
  assert.deepEqual(parsePlaceFromText('D漁場 5レーン 1間目から8間目へ'), { farm: 'D', lane: 5, ma_from: 1, ma_to: 8 });
  assert.deepEqual(parsePlaceFromText('デー漁場の五レーン、七間目'), { farm: 'D', lane: 5, ma_from: 7, ma_to: 7 });
  assert.deepEqual(parsePlaceFromText('36グラム45個'), { farm: null, lane: null, ma_from: null, ma_to: null });
});

test('normalizeLot: 読みの崩れ', () => {
  assert.equal(normalizeLot('アールハチのケー3'), 'R8-K3');
  assert.equal(normalizeLot('K1'), 'R8-K1');
  assert.equal(normalizeLot('ロット2'), null);
});

// 11/4 の iPhone 実測（本番 DB に残っていた文字起こし）
test('parsePlaceFromText: 11/4 実測の崩れ', () => {
  assert.deepEqual(parsePlaceFromText('R 3の計算利上げ漁錠5レーンごまめから12豆10個選別のため'), { farm: null, lane: 5, ma_from: 5, ma_to: 12 });
  assert.deepEqual(parsePlaceFromText('置き出しR 8の計算40カゴD漁錠5レーン1目から8豆'), { farm: 'D', lane: 5, ma_from: 1, ma_to: 8 });
  assert.deepEqual(parsePlaceFromText('R 8の軽4 D漁錠3レーン2番目から6豆20個入れました'), { farm: 'D', lane: 3, ma_from: 2, ma_to: 6 });
  assert.deepEqual(parsePlaceFromText('R 8の計算陸上げ漁上の505から12枚10個です'), { farm: null, lane: 5, ma_from: 5, ma_to: 12 });
  assert.deepEqual(parsePlaceFromText('R 8の計算置き出し40カゴD漁錠5レーン1豆からゴマ豆'), { farm: 'D', lane: 5, ma_from: 1, ma_to: 5 });
});

test('normalizeLot / lotFromText: 11/4 実測の崩れ', () => {
  assert.equal(normalizeLot('R8の型2'), 'R8-K2');
  assert.equal(normalizeLot('R8の計算'), 'R8-K3');
  assert.equal(normalizeLot('計5'), 'R8-K5');
  assert.equal(lotFromText('R 8の型2線別大きい40グラム'), 'R8-K2');
  assert.equal(lotFromText('R 3の計算利上げ漁錠5レーン'), 'R8-K3');
  assert.equal(lotFromText('R 8の軽4 D漁錠3レーン'), 'R8-K4');
  assert.equal(lotFromText('R 8の計5分色しました'), 'R8-K5');
  assert.equal(lotFromText('アールハチのケーサン、陸上げ'), 'R8-K3');
  assert.equal(lotFromText('36グラム45個'), null);
});

test('basketCountFromText: 沖出し・陸揚げの「個」はかご数', () => {
  assert.equal(basketCountFromText('R 8の軽4 D漁錠3レーン2番目から6豆20個入れました'), 20);
  assert.equal(basketCountFromText('R 8の計算陸上げ漁上の505から12枚10個です'), 10);
  assert.equal(basketCountFromText('置き出しR 8の計算40カゴD漁錠5レーン1目から8豆'), 40);
  assert.equal(basketCountFromText('風が強かった'), null);
});

test('normalizeFarm: 漁場の崩れを剥がして英字だけにする', () => {
  assert.equal(normalizeFarm('D漁錠'), 'D');
  assert.equal(normalizeFarm('ディー魚場'), 'D');
  assert.equal(normalizeFarm('漁錠D'), 'D');
  assert.equal(normalizeFarm('D漁場'), 'D');
  assert.equal(normalizeFarm('デー'), 'D');
  assert.equal(normalizeFarm('3'), '3');
});
