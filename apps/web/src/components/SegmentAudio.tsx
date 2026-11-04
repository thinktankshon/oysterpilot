import { useEffect, useRef, useState } from 'react';
import { formatDuration, segmentRange, type AudioEntry } from '../lib/audio';

/**
 * 区切りに紐づく声だけを再生する（VO-15）。
 * 録音ファイルは分けず、印から印までの範囲を再生して、範囲の終わりで止める。
 */
export function SegmentAudio({ entry, seq }: { entry: AudioEntry; seq: number | null }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const ref = useRef<HTMLAudioElement | null>(null);
  const range = segmentRange(entry, seq);
  const whole = range.start_ms === 0 && range.end_ms >= entry.duration_ms;

  useEffect(() => {
    if (!open) return;
    const u = URL.createObjectURL(entry.blob);
    setUrl(u);
    return () => {
      URL.revokeObjectURL(u);
      setUrl(null);
    };
  }, [open, entry]);

  const onLoaded = () => {
    const el = ref.current;
    if (!el) return;
    try {
      el.currentTime = range.start_ms / 1000;
    } catch {
      /* iOS は metadata 前の seek を無視することがある */
    }
    void el.play().catch(() => undefined);
  };

  const onTime = () => {
    const el = ref.current;
    if (!el || whole) return;
    if (el.currentTime * 1000 >= range.end_ms) el.pause();
  };

  // iPhone の幅で 1 行に収まる長さにする
  const label = whole
    ? `聞く（${formatDuration(entry.duration_ms)}）`
    : `聞く（${formatDuration(range.start_ms)}〜${formatDuration(range.end_ms)}）`;

  return (
    <div className="seg-audio">
      {!open ? (
        <button type="button" className="btn small audio-btn" onClick={() => setOpen(true)}>
          ▶ {label}
        </button>
      ) : (
        <>
          {url && (
            <audio
              ref={ref}
              className="audio-player"
              controls
              src={url}
              onLoadedMetadata={onLoaded}
              onTimeUpdate={onTime}
            />
          )}
          <div className="seg-audio-foot">
            <span className="muted">{whole ? '録音全体' : `${formatDuration(range.start_ms)}〜${formatDuration(range.end_ms)} で止まります`}</span>
            <button type="button" className="btn ghost small" onClick={() => setOpen(false)}>
              閉じる
            </button>
          </div>
        </>
      )}
    </div>
  );
}
