import { useCallback, useEffect, useRef, useState } from 'react';
import { api, formatDate, locationLabel, type RecordRow } from '../lib/api';
import { isSpeechSupported, startSpeech, type SpeechSession } from '../lib/speech';

type Phase = 'idle' | 'recording' | 'confirm';

export function Voysy() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [finalText, setFinalText] = useState('');
  const [interimText, setInterimText] = useState('');
  const [draft, setDraft] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecordRow[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const sessionRef = useRef<SpeechSession | null>(null);
  const supported = isSpeechSupported();

  const loadRecent = useCallback(async () => {
    try {
      setRecent(await api<RecordRow[]>('/api/records?limit=3'));
      setListError(null);
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  // 録音中の経過秒数
  useEffect(() => {
    if (phase !== 'recording') return;
    setSeconds(0);
    const t = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [phase]);

  const startRecording = () => {
    setError(null);
    setFinalText('');
    setInterimText('');
    if (!supported) {
      // VO-09: 非対応なら textarea に直接入力（iPhone のキーボード音声入力でも可）
      setDraft('');
      setPhase('confirm');
      return;
    }
    const session = startSpeech({
      onText: (f, i) => {
        setFinalText(f);
        setInterimText(i);
      },
      onError: (msg) => setError(msg),
      onEnd: (f) => {
        sessionRef.current = null;
        setDraft(f.trim());
        setInterimText('');
        setPhase('confirm');
      },
    });
    if (!session) {
      setError('音声認識を開始できませんでした。下の欄に直接入力してください。');
      setDraft('');
      setPhase('confirm');
      return;
    }
    sessionRef.current = session;
    setPhase('recording');
  };

  const stopRecording = () => {
    const s = sessionRef.current;
    if (s) {
      s.stop();
    } else {
      setDraft(finalText.trim());
      setPhase('confirm');
    }
  };

  const retake = () => {
    setDraft('');
    startRecording();
  };

  return (
    <section className="voysy">
      {phase === 'idle' && (
        <>
          <h1 className="title">Voysy</h1>
          <p className="lead">ボタンを押して、作業を喋ってください。</p>

          <div className="card">
            <h2 className="card-title">直近の記録</h2>
            {listError && <p className="error">記録を読めませんでした（{listError}）</p>}
            {!listError && recent.length === 0 && <p className="muted">まだ記録がありません</p>}
            <ul className="record-list">
              {recent.map((r) => (
                <li key={r.id} className="record-row">
                  <span className="record-date">{formatDate(r.recorded_at)}</span>
                  <span className="record-loc">{locationLabel(r)}</span>
                  <span className="record-work">{r.work_type}</span>
                  <span className="record-nums">
                    {r.avg_weight_g != null ? `${r.avg_weight_g}g` : ''}
                    {r.count_per_basket != null ? ` ${r.count_per_basket}個/かご` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {!supported && (
            <p className="notice">
              このブラウザは音声認識に対応していません。ボタンを押すと入力欄が開きます（キーボードのマイクで音声入力できます）。
            </p>
          )}
          {error && <p className="error">{error}</p>}

          <div className="rec-area">
            <button type="button" className="rec-button" onClick={startRecording} aria-label="録音開始">
              <span className="rec-dot" />
              <span>録音</span>
            </button>
          </div>
        </>
      )}

      {phase === 'recording' && (
        <>
          <h1 className="title">
            録音中 <span className="timer">{seconds}秒</span>
          </h1>
          <div className="transcript live" aria-live="polite">
            {finalText}
            <span className="interim">{interimText}</span>
            {!finalText && !interimText && <span className="muted">（話してください…）</span>}
          </div>
          {error && <p className="error">{error}</p>}
          <div className="rec-area">
            <button type="button" className="rec-button stop" onClick={stopRecording} aria-label="停止">
              <span className="stop-square" />
              <span>停止</span>
            </button>
          </div>
        </>
      )}

      {phase === 'confirm' && (
        <>
          <h1 className="title">確認</h1>
          <p className="lead">文字を直せます。よければ「整理する」。</p>
          <textarea
            className="transcript edit"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
            placeholder="例：3番の上段、選別した。36グラムぐらい、1かご45個のまま、死んだの8個、かごは6つ"
          />
          {error && <p className="error">{error}</p>}
          <div className="actions">
            <button type="button" className="btn primary" disabled title="11/3 に実装">
              整理する
            </button>
            <button type="button" className="btn" onClick={retake}>
              もう一度話す
            </button>
            <button type="button" className="btn ghost" onClick={() => setPhase('idle')}>
              やめる
            </button>
          </div>
        </>
      )}
    </section>
  );
}
