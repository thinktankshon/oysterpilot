import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addPending,
  api,
  formatDate,
  formatDay,
  isRetryable,
  jstNowIso,
  loadPending,
  locationLabel,
  markSegmentDone,
  savePending,
  sendPending,
  type ExtractResult,
  type PendingItem,
  type RecordInput,
  type RecordRow,
  type ReservationRow,
  type SegmentInput,
  type SegmentRow,
} from '../lib/api';
import { isSpeechSupported, startSpeech, type SpeechSession } from '../lib/speech';
import { CUE_HINT, findCue } from '../lib/cues';

// idle: 待機 / session: 作業セッション（ハンズフリー） / recording→confirm→review: 1件だけ記録 / drafts: 陸でチェック
type Phase = 'idle' | 'session' | 'recording' | 'confirm' | 'review' | 'drafts';

const WORK_TYPES = ['選別', '分殖', '沖出し', '陸揚げ', '揺らし', '移動', 'その他'];
const TIERS = ['上段', '中段', '下段'];

// 確認表の項目（表示順）。missing に入った項目は「確認：○○は？」を赤で出す（VO-04）
const FIELD_LABELS: Record<string, string> = {
  work_type: '作業',
  location_line: 'ライン（番）',
  location_tier: '段',
  lot_no: 'ロット番号',
  avg_weight_g: 'サイズ（g）',
  count_per_basket: '入数（個/かご）',
  mortality: '斃死（個）',
  basket_count: 'かご数',
};
const NUM_FIELDS = ['location_line', 'avg_weight_g', 'count_per_basket', 'mortality', 'basket_count'] as const;
type NumField = (typeof NUM_FIELDS)[number];

const EMPTY_RESULT: ExtractResult = {
  work_type: 'その他',
  location_line: null,
  location_tier: null,
  lot_no: null,
  avg_weight_g: null,
  count_per_basket: null,
  mortality: null,
  basket_count: null,
  missing: ['location_line', 'location_tier', 'lot_no', 'avg_weight_g', 'count_per_basket', 'mortality', 'basket_count'],
  notes: null,
};

export function Voysy() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [finalText, setFinalText] = useState('');
  const [interimText, setInterimText] = useState('');
  const [draft, setDraft] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecordRow[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [reservations, setReservations] = useState<ReservationRow[]>([]);
  const [result, setResult] = useState<ExtractResult>(EMPTY_RESULT);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<PendingItem[]>(() => loadPending());
  const [resending, setResending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // 作業セッション
  const [segCount, setSegCount] = useState(0);
  // 陸でチェック
  const [drafts, setDrafts] = useState<SegmentRow[]>([]);
  const [currentSegmentId, setCurrentSegmentId] = useState<number | null>(null);
  const sessionRef = useRef<SpeechSession | null>(null);
  const sessionIdRef = useRef('');
  const seqRef = useRef(0);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const draftSavedRef = useRef<Map<number, string>>(new Map());
  const supported = isSpeechSupported();

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  };

  const loadDrafts = useCallback(async () => {
    try {
      const list = await api<SegmentRow[]>('/api/segments?status=draft');
      setDrafts(list);
      draftSavedRef.current = new Map(list.map((d) => [d.id, d.raw_text]));
    } catch {
      /* 一覧は前回のまま */
    }
  }, []);

  const loadRecent = useCallback(async () => {
    try {
      setRecent(await api<RecordRow[]>('/api/records?limit=3'));
      setListError(null);
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e));
    }
    try {
      setReservations(await api<ReservationRow[]>('/api/reservations?status=open'));
    } catch {
      setReservations([]);
    }
    await loadDrafts();
  }, [loadDrafts]);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  // 録音中・作業中の経過秒数
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'session') return;
    setSeconds(0);
    const t = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [phase]);

  // VO-10: 作業中は画面を消さない（Wake Lock）。タブに戻ったときは取り直す
  const requestWakeLock = useCallback(async () => {
    try {
      wakeLockRef.current = (await navigator.wakeLock?.request('screen')) ?? null;
    } catch {
      /* 非対応・低電力モードなどは諦める */
    }
  }, []);
  const releaseWakeLock = () => {
    void wakeLockRef.current?.release().catch(() => undefined);
    wakeLockRef.current = null;
  };
  useEffect(() => {
    if (phase !== 'session') return;
    const onVis = () => {
      if (document.visibilityState === 'visible') void requestWakeLock();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [phase, requestWakeLock]);

  // ---------- 作業セッション（VO-10〜12） ----------

  const commitSegment = async (text: string) => {
    const t = cleanSegment(text);
    if (!t) return;
    seqRef.current += 1;
    setSegCount(seqRef.current);
    const input: SegmentInput = {
      session_id: sessionIdRef.current,
      seq: seqRef.current,
      recorded_at: jstNowIso(),
      raw_text: t,
    };
    try {
      await api<{ id: number }>('/api/segments', { method: 'POST', body: JSON.stringify(input) });
    } catch (e) {
      if (isRetryable(e)) {
        setPending(addPending({ kind: 'segment', input }));
      } else {
        setError(e instanceof Error ? pickErrorMessage(e.message) ?? e.message : String(e));
      }
    }
  };

  const finishSession = async (remaining: string) => {
    await commitSegment(remaining);
    releaseWakeLock();
    const n = seqRef.current;
    setPhase('idle');
    showToast(n > 0 ? `${n}件を記録しました（陸でチェック）` : '記録はありませんでした');
    await loadRecent();
  };

  const handleSessionText = (f: string, i: string) => {
    const hit = findCue(f);
    if (!hit) {
      setFinalText(f);
      setInterimText(i);
      return;
    }
    const before = f.slice(0, hit.index);
    const after = f.slice(hit.index + hit.length);
    if (hit.type === 'split') {
      void commitSegment(before);
      sessionRef.current?.reset(after);
      setFinalText(after);
      setInterimText(i);
    } else {
      // 終了語：ここまでを保存して止める（終了語より後は捨てる）
      sessionRef.current?.reset(before);
      setFinalText(before);
      setInterimText('');
      sessionRef.current?.stop();
    }
  };

  const startSession = () => {
    setError(null);
    if (!supported) {
      setError('このブラウザは音声認識に対応していないため、作業セッションは使えません。「1件だけ記録」をお使いください。');
      return;
    }
    sessionIdRef.current = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    seqRef.current = 0;
    setSegCount(0);
    setFinalText('');
    setInterimText('');
    const session = startSpeech({
      onText: handleSessionText,
      onError: (msg) => setError(msg),
      onEnd: (f) => {
        sessionRef.current = null;
        void finishSession(f);
      },
    });
    if (!session) {
      setError('音声認識を開始できませんでした。');
      return;
    }
    sessionRef.current = session;
    void requestWakeLock();
    setPhase('session');
  };

  const stopSession = () => {
    const s = sessionRef.current;
    if (s) s.stop();
    else void finishSession(finalText);
  };

  // ---------- 1件だけ記録（VO-01〜05, 07, 09） ----------

  const startRecording = () => {
    setError(null);
    setFinalText('');
    setInterimText('');
    setCurrentSegmentId(null);
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

  // VO-07: もう一度話す（テキストは破棄）
  const retake = () => {
    setDraft('');
    startRecording();
  };

  // VO-03: 整理する → /api/voysy/extract
  const extract = async (text: string) => {
    setError(null);
    setExtracting(true);
    try {
      const r = await api<ExtractResult>('/api/voysy/extract', {
        method: 'POST',
        body: JSON.stringify({ text }),
      });
      setResult(r);
      setPhase('review');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(pickErrorMessage(msg) ?? '整理に失敗しました。もう一度お試しください。');
      setPhase('confirm');
    } finally {
      setExtracting(false);
    }
  };

  // 整理できないときは手で入力して保存（VO-09 の延長）
  const manualEntry = () => {
    setError(null);
    setResult(EMPTY_RESULT);
    setPhase('review');
  };

  const setField = <K extends keyof ExtractResult>(key: K, value: ExtractResult[K]) =>
    setResult((r) => ({ ...r, [key]: value }));

  const toInput = (): RecordInput => ({
    work_type: result.work_type,
    location_line: result.location_line,
    location_tier: result.location_tier,
    lot_no: result.lot_no,
    avg_weight_g: result.avg_weight_g,
    count_per_basket: result.count_per_basket,
    mortality: result.mortality,
    basket_count: result.basket_count,
    notes: result.notes,
    raw_text: draft.trim() || '（手入力）',
  });

  // VO-05 / VO-06 / VO-13: 保存。通信失敗なら未送信に残す。区切りから来たら確定にして次へ
  const save = async () => {
    setError(null);
    setSaving(true);
    const input = toInput();
    const segId = currentSegmentId;
    try {
      const { id } = await api<{ id: number }>('/api/records', { method: 'POST', body: JSON.stringify(input) });
      if (segId != null) await markSegmentDone(segId, id);
      setCurrentSegmentId(null);
      showToast('保存しました');
      await loadRecent();
      if (segId != null) {
        const rest = (await api<SegmentRow[]>('/api/segments?status=draft').catch(() => [])).filter((d) => d.id !== segId);
        setDrafts(rest);
        if (rest.length > 0) {
          organizeDraft(rest[0]);
          return;
        }
      }
      setPhase('idle');
    } catch (e) {
      if (isRetryable(e)) {
        setPending(addPending({ kind: 'record', input, segment_id: segId ?? undefined }));
        setCurrentSegmentId(null);
        setPhase('idle');
        showToast('通信できないため、未送信に残しました');
      } else {
        setError(e instanceof Error ? pickErrorMessage(e.message) ?? e.message : String(e));
      }
    } finally {
      setSaving(false);
    }
  };

  // VO-06 / VO-12: 未送信の再送
  const resend = async () => {
    setResending(true);
    const rest: PendingItem[] = [];
    let sent = 0;
    for (const p of pending) {
      try {
        await sendPending(p);
        sent++;
      } catch (e) {
        if (isRetryable(e)) rest.push(p);
        // 4xx は壊れたレコードなので捨てる
      }
    }
    savePending(rest);
    setPending(rest);
    setResending(false);
    showToast(sent > 0 ? `${sent}件を送信しました` : 'まだ送信できません');
    if (sent > 0) await loadRecent();
  };

  // ---------- 陸でチェック（VO-13） ----------

  const openDrafts = () => {
    setError(null);
    setPhase('drafts');
    void loadDrafts();
  };

  const editDraft = (id: number, text: string) =>
    setDrafts((list) => list.map((d) => (d.id === id ? { ...d, raw_text: text } : d)));

  const persistDraft = async (d: SegmentRow) => {
    const saved = draftSavedRef.current.get(d.id);
    const text = d.raw_text.trim();
    if (!text || text === saved) return;
    try {
      await api<{ ok: true }>(`/api/segments/${d.id}`, { method: 'PATCH', body: JSON.stringify({ raw_text: text }) });
      draftSavedRef.current.set(d.id, text);
    } catch (e) {
      setError(e instanceof Error ? pickErrorMessage(e.message) ?? e.message : String(e));
    }
  };

  const deleteDraft = async (id: number) => {
    if (!window.confirm('この区切りを削除しますか？')) return;
    try {
      await api<{ ok: true }>(`/api/segments/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'deleted' }) });
      setDrafts((list) => list.filter((d) => d.id !== id));
    } catch (e) {
      setError(e instanceof Error ? pickErrorMessage(e.message) ?? e.message : String(e));
    }
  };

  const organizeDraft = (d: SegmentRow) => {
    setDraft(d.raw_text.trim());
    setCurrentSegmentId(d.id);
    setPhase('confirm');
    void extract(d.raw_text.trim());
  };

  // いま空のままの missing 項目だけ「確認」に出す
  const openMissing = result.missing.filter((f) => {
    const v = result[f as keyof ExtractResult];
    return v == null || v === '';
  });

  return (
    <section className="voysy">
      {phase === 'idle' && (
        <>
          <h1 className="title">Voysy</h1>
          <p className="lead">海では喋るだけ。確認は陸で。</p>

          {pending.length > 0 && (
            <div className="pending">
              <span>未送信 {pending.length}件</span>
              <button type="button" className="btn small" onClick={resend} disabled={resending}>
                {resending ? '送信中…' : '再送'}
              </button>
            </div>
          )}

          <div className="idle-row">
            <button type="button" className="btn" onClick={openDrafts}>
              陸でチェック
              {drafts.length > 0 && <span className="badge">{drafts.length}</span>}
            </button>
            <button type="button" className="btn" onClick={startRecording}>
              1件だけ記録
            </button>
          </div>

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

          {/* VO-08: AI Oysterman からの作業予約 */}
          <div className="card">
            <h2 className="card-title">今日の予定（AI Oysterman から）</h2>
            {reservations.length === 0 && <p className="muted">予定はありません</p>}
            <ul className="record-list">
              {reservations.map((r) => (
                <li key={r.id} className="record-row">
                  <span className="record-date">{formatDay(r.due_date)}</span>
                  <span className="record-loc">{locationLabel(r)}</span>
                  <span className="record-work">予定</span>
                  <span className="record-nums">{r.work}</span>
                </li>
              ))}
            </ul>
          </div>

          {!supported && (
            <p className="notice">
              このブラウザは音声認識に対応していません。「1件だけ記録」を押すと入力欄が開きます（キーボードのマイクで音声入力できます）。
            </p>
          )}
          {error && <p className="error">{error}</p>}

          <div className="rec-area">
            <button type="button" className="rec-button" onClick={startSession} aria-label="作業開始">
              <span className="rec-dot" />
              <span>作業開始</span>
            </button>
          </div>
          <p className="cue-hint">
            「{CUE_HINT.split}」で区切り、「{CUE_HINT.stop}」で終了
          </p>
        </>
      )}

      {phase === 'session' && (
        <>
          <h1 className="title">
            作業中 <span className="timer">{formatSeconds(seconds)}</span>
          </h1>
          <p className="lead">
            「{CUE_HINT.split}」で区切り、「{CUE_HINT.stop}」で終了。
          </p>
          <div className="seg-count">
            記録 <strong>{segCount}</strong> 件
          </div>
          <div className="transcript live" aria-live="polite">
            {finalText}
            <span className="interim">{interimText}</span>
            {!finalText && !interimText && <span className="muted">（作業しながら話してください…）</span>}
          </div>
          {error && <p className="error">{error}</p>}
          <div className="rec-area">
            <button type="button" className="rec-button stop" onClick={stopSession} aria-label="記録終了">
              <span className="stop-square" />
              <span>記録終了</span>
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
          {error && (
            <div className="error-box">
              <p className="error">{error}</p>
              <button type="button" className="btn small" onClick={manualEntry}>
                手で入力して保存
              </button>
            </div>
          )}
          <div className="actions">
            <button type="button" className="btn primary" onClick={() => extract(draft)} disabled={extracting || !draft.trim()}>
              {extracting ? '整理しています…' : '整理する'}
            </button>
            {currentSegmentId == null ? (
              <button type="button" className="btn" onClick={retake} disabled={extracting}>
                もう一度話す
              </button>
            ) : (
              <button type="button" className="btn" onClick={openDrafts} disabled={extracting}>
                一覧に戻る
              </button>
            )}
            <button type="button" className="btn ghost" onClick={() => setPhase('idle')} disabled={extracting}>
              やめる
            </button>
          </div>
        </>
      )}

      {phase === 'review' && (
        <>
          <h1 className="title">記録の確認</h1>
          <p className="lead">違っていれば直してから「保存」。</p>

          {openMissing.length > 0 && (
            <ul className="missing-list">
              {openMissing.map((f) => (
                <li key={f}>確認：{FIELD_LABELS[f] ?? f}は？</li>
              ))}
            </ul>
          )}

          <table className="review-table">
            <tbody>
              <tr>
                <th>{FIELD_LABELS.work_type}</th>
                <td>
                  <select value={result.work_type} onChange={(e) => setField('work_type', e.target.value)}>
                    {WORK_TYPES.map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
              <tr className={openMissing.includes('location_line') ? 'is-missing' : ''}>
                <th>{FIELD_LABELS.location_line}</th>
                <td>{numberInput('location_line', result, setField)}</td>
              </tr>
              <tr className={openMissing.includes('location_tier') ? 'is-missing' : ''}>
                <th>{FIELD_LABELS.location_tier}</th>
                <td>
                  <select
                    value={result.location_tier ?? ''}
                    onChange={(e) => setField('location_tier', e.target.value || null)}
                  >
                    <option value="">（未入力）</option>
                    {TIERS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
              <tr className={openMissing.includes('lot_no') ? 'is-missing' : ''}>
                <th>{FIELD_LABELS.lot_no}</th>
                <td>
                  <input
                    type="text"
                    value={result.lot_no ?? ''}
                    placeholder="例：L-01"
                    onChange={(e) => setField('lot_no', e.target.value || null)}
                  />
                </td>
              </tr>
              {(['avg_weight_g', 'count_per_basket', 'mortality', 'basket_count'] as const).map((f) => (
                <tr key={f} className={openMissing.includes(f) ? 'is-missing' : ''}>
                  <th>{FIELD_LABELS[f]}</th>
                  <td>{numberInput(f, result, setField)}</td>
                </tr>
              ))}
              {/* VO-14: メモは編集できる */}
              <tr>
                <th>メモ</th>
                <td>
                  <textarea
                    className="notes-input"
                    value={result.notes ?? ''}
                    rows={2}
                    placeholder="例：殻が伸びている"
                    onChange={(e) => setField('notes', e.target.value || null)}
                  />
                </td>
              </tr>
            </tbody>
          </table>

          <details className="raw">
            <summary>元の発話</summary>
            <p>{draft || '（なし）'}</p>
          </details>

          {error && <p className="error">{error}</p>}
          <div className="actions">
            <button type="button" className="btn primary" onClick={save} disabled={saving}>
              {saving ? '保存しています…' : '保存'}
            </button>
            {currentSegmentId == null ? (
              <button type="button" className="btn" onClick={retake} disabled={saving}>
                もう一度話す
              </button>
            ) : (
              <button type="button" className="btn" onClick={openDrafts} disabled={saving}>
                一覧に戻る
              </button>
            )}
            <button type="button" className="btn ghost" onClick={() => setPhase('confirm')} disabled={saving}>
              文字に戻る
            </button>
          </div>
        </>
      )}

      {phase === 'drafts' && (
        <>
          <h1 className="title">陸でチェック</h1>
          <p className="lead">区切りごとの文です。直してから「整理する」。</p>
          {drafts.length === 0 && <p className="muted">未整理の記録はありません</p>}
          <ul className="draft-list">
            {drafts.map((d) => (
              <li key={d.id} className="draft">
                <div className="draft-head">
                  <span>{formatDate(d.recorded_at)}</span>
                  <span className="muted">#{d.seq}</span>
                </div>
                <textarea
                  className="draft-text"
                  value={d.raw_text}
                  rows={3}
                  onChange={(e) => editDraft(d.id, e.target.value)}
                  onBlur={() => persistDraft(d)}
                />
                <div className="draft-actions">
                  <button type="button" className="btn primary small" onClick={() => organizeDraft(d)}>
                    整理する
                  </button>
                  <button type="button" className="btn ghost small" onClick={() => deleteDraft(d.id)}>
                    削除
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {error && <p className="error">{error}</p>}
          <div className="actions">
            <button type="button" className="btn ghost" onClick={() => setPhase('idle')}>
              戻る
            </button>
          </div>
        </>
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </section>
  );
}

function numberInput(
  field: NumField,
  result: ExtractResult,
  setField: <K extends keyof ExtractResult>(key: K, value: ExtractResult[K]) => void,
) {
  const v = result[field];
  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      value={v ?? ''}
      placeholder="—"
      onChange={(e) => {
        const n = e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value)));
        setField(field, n != null && Number.isFinite(n) ? n : null);
      }}
    />
  );
}

/** 区切りの文を整える：前後の空白と句読点だけの残りを落とす */
function cleanSegment(text: string): string {
  return text.replace(/^[\s、。,.．]+|[\s、。,.．]+$/g, '').trim();
}

function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** API のエラー本文（JSON）から表示用メッセージだけ取り出す */
function pickErrorMessage(text: string): string | null {
  try {
    const j = JSON.parse(text) as { error?: unknown };
    return typeof j.error === 'string' ? j.error : null;
  } catch {
    return null;
  }
}
