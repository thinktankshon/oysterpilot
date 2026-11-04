// 作業セッションの合図語（config/voice_cues.json）。確定した文の中で最初に出た合図を返す。
import cues from '../../../../config/voice_cues.json';

export type CueHit = { type: 'split' | 'stop'; index: number; length: number; word: string };

const SPLIT: string[] = cues.split;
const STOP: string[] = cues.stop;

export const CUE_HINT = { split: SPLIT[0] ?? '次のロット', stop: STOP[0] ?? '記録終了' };

export function findCue(text: string): CueHit | null {
  let best: CueHit | null = null;
  const consider = (type: CueHit['type'], words: string[]) => {
    for (const w of words) {
      const i = text.indexOf(w);
      if (i >= 0 && (best == null || i < best.index)) best = { type, index: i, length: w.length, word: w };
    }
  };
  consider('split', SPLIT);
  consider('stop', STOP);
  return best;
}

/** 文の中の区切り合図の数（認識中の仮の文も含めて数え、合図を言った時刻を控えるのに使う） */
export function countSplitCues(text: string): number {
  let n = 0;
  let rest = text;
  for (;;) {
    let best: { index: number; length: number } | null = null;
    for (const w of SPLIT) {
      const i = rest.indexOf(w);
      if (i >= 0 && (best == null || i < best.index)) best = { index: i, length: w.length };
    }
    if (!best) return n;
    n += 1;
    rest = rest.slice(best.index + best.length);
  }
}
