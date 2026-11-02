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
