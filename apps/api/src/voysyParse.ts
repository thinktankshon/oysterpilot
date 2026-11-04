// Voysy の読み取り補助（純粋関数。.md/.yaml を import しないので Node の単体テストから直接呼べる）

/** ロット番号を R8-K3 の型に正規化。型に合わなければ null（確認に回す） */
export function normalizeLot(raw: string | null, currentPrefix = 'R8'): string | null {
  if (!raw) return null;
  let t = raw
    .replace(/[Ａ-Ｚａ-ｚ０-９－]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toUpperCase()
    .replace(/[\s　]/g, '')
    .replace(/アール/g, 'R')
    .replace(/ケー|ケイ/g, 'K')
    // 11/4 実測：「計算」→ K3、「型2」「軽4」「計5」「形3」→ K2…
    .replace(/計算|ケイサン|けいさん/g, 'K3')
    .replace(/[型計軽形桂系](?=\d)/g, 'K')
    .replace(/イチ|ニ|サン|ヨン|シ|ゴ|ロク|ナナ|シチ|ハチ|キュウ|ク/g, (k) => ({ イチ: '1', ニ: '2', サン: '3', ヨン: '4', シ: '4', ゴ: '5', ロク: '6', ナナ: '7', シチ: '7', ハチ: '8', キュウ: '9', ク: '9' })[k] ?? k)
    .replace(/[‐‑–—−ー]/g, '-')
    .replace(/の/g, '-')
    .replace(/^R(\d{1,2})-?K/, 'R$1-K');
  const full = /^R(\d{1,2})-?K(\d{1,2})$/.exec(t);
  if (full) return `R${Number(full[1])}-K${Number(full[2])}`;
  const kOnly = /^K(\d{1,2})$/.exec(t);
  if (kOnly) return `${currentPrefix}-K${Number(kOnly[1])}`;
  return /^R\d{1,2}-K\d{1,2}$/.test(t) ? t : null;
}

/**
 * 発話そのものからロットを拾う保険。「R 8の型2」「R 3の計算」「アールハチのケーサン」「K4」。
 * R の数字が崩れていても（R 3）当年の prefix に寄せる。
 */
export function lotFromText(raw: string, currentPrefix = 'R8'): string | null {
  const t = raw
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/アール/g, 'R')
    .replace(/ケーサン|計算|ケイサン|けいさん/g, 'K3')
    .replace(/ケー|ケイ/g, 'K')
    .replace(/ハチ/g, '8')
    .replace(/[\s　]/g, '');
  const m = /R(\d{1,2})[のー-]?[Kk型計軽形桂系](\d{1,2})/.exec(t) ?? /(?:^|[^A-Za-z])[Kk](\d{1,2})(?!\d)/.exec(t);
  if (!m) return null;
  if (m.length === 3) return `${currentPrefix}-K${Number(m[2])}`;
  return `${currentPrefix}-K${Number(m[1])}`;
}

/** 沖出し・陸揚げのかご数を発話から拾う保険。「10個です」「20個入れました」「40カゴ」の最後のもの */
export function basketCountFromText(raw: string): number | null {
  const t = toAsciiDigits(raw).replace(/\s+/g, '');
  const re = /(\d{1,3})(?:かご|カゴ|籠|過去|加護|かこ|個)/g;
  let last: number | null = null;
  for (const m of t.matchAll(re)) last = Number(m[1]);
  return last;
}

/** 漁場名：「D漁場」「ディー」→ "D"。英字 1〜3 文字か数字に揃える */
export function normalizeFarm(raw: string | null): string | null {
  if (!raw) return null;
  // 「漁場」と、その文字起こしの崩れ（漁錠・漁上・漁条・魚場・業場・漁所）を剥がす
  let t = raw
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/漁場|漁錠|漁上|漁条|魚場|業場|漁所|ぎょじょう|\s/g, '')
    .toUpperCase();
  const kana: Record<string, string> = { エー: 'A', ビー: 'B', シー: 'C', ディー: 'D', デー: 'D', イー: 'E', エフ: 'F', ジー: 'G', エイチ: 'H' };
  if (kana[t]) t = kana[t];
  if (/^[A-Z]{1,3}$|^\d{1,2}$/.test(t)) return t;
  // それでも揃わなければ、先頭の英字だけを取る（「D漁錠の」「Dぎょ」など）
  const lead = /^([A-Z]{1,3})(?![A-Z])/.exec(t);
  return lead ? lead[1] : raw.trim();
}

/** かごの種類：「15リットル」「15 L」→ "15L" */
export function normalizeBasketType(raw: string | null): string | null {
  if (!raw) return null;
  const m = /(\d{1,3})\s*(リットル|リッター|L|l|ℓ)/.exec(raw);
  return m ? `${m[1]}L` : raw;
}

/** 全角→半角、漢数字・ひらがな数字→算用数字（1〜999 程度） */
function toAsciiDigits(t: string): string {
  t = t.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const kan: Record<string, number> = { 〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  return t.replace(/[一二三四五六七八九]?十[一二三四五六七八九]?|[〇零一二三四五六七八九]+/g, (m) => {
    if (m.includes('十')) {
      const [a, b] = m.split('十');
      return String((a ? kan[a] : 1) * 10 + (b ? kan[b] : 0));
    }
    return m.split('').map((c) => kan[c]).join('');
  });
}

/** 発話から 漁場・レーン・間（から〜まで）を拾う。崩れた表記（魚場・連・件目）にも対応 */
export function parsePlaceFromText(raw: string): { farm: string | null; lane: number | null; ma_from: number | null; ma_to: number | null } {
  const t = toAsciiDigits(raw)
    .replace(/\s+/g, '')
    // 11/4 実測：「ごまめ」「ゴマ豆」は 5間目
    .replace(/ごまめ|ゴマ豆|ごま豆|胡麻豆/g, '5間目');
  let farm: string | null = null;
  const fm = /([A-Za-z]|ディー|デー|エー|ビー|シー|イー|エフ|ジー)(漁場|魚場|ぎょじょう|業場|漁所|漁錠|漁上|漁条)/.exec(t);
  if (fm) farm = normalizeFarm(fm[1]);
  const lm = /(\d{1,2})(レーン|レイン|れーん|連|レン)/.exec(t);
  let lane = lm ? Number(lm[1]) : null;
  const unit = '(?:間目|間|件目|軒目|剣目|けんめ|かんめ|件|軒|豆|枚|番目|目)';
  const rm = new RegExp(`(\\d{1,3})${unit}(?:から|〜|~|-|ー|より)(\\d{1,3})${unit}?`).exec(t);
  let ma_from: number | null = null;
  let ma_to: number | null = null;
  if (rm) {
    ma_from = Number(rm[1]);
    ma_to = Number(rm[2]);
  } else {
    const sm = new RegExp(`(\\d{1,3})${unit}`).exec(t);
    if (sm) ma_from = ma_to = Number(sm[1]);
  }
  // 11/4 実測：「505から12枚」= 5レーン 5間目から12間目（「レーン」が落ちて数字が並ぶ）
  if (lane == null && (ma_from == null || rm == null)) {
    const cm = new RegExp(`(\\d)0(\\d)(?:から|〜|~|より)(\\d{1,3})${unit}?`).exec(t);
    if (cm) {
      lane = Number(cm[1]);
      ma_from = Number(cm[2]);
      ma_to = Number(cm[3]);
    }
  }
  return { farm, lane, ma_from, ma_to };
}
