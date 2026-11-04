import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addPending,
  api,
  formatDate,
  formatDay,
  groupRecords,
  isRetryable,
  jstNowIso,
  loadPending,
  saveRecords,
  savePending,
  sendPending,
  toRecordInputs,
  placeLabel,
  type ExtractItem,
  type ExtractResult,
  type PendingItem,
  type RecordRow,
  type ReservationRow,
  type SegmentInput,
  type SegmentRow,
} from '../lib/api';
import { isSpeechSupported, startSpeech, type SpeechSession } from '../lib/speech';
import { CUE_HINT, countSplitCues, findCue } from '../lib/cues';
import { SegmentAudio } from '../components/SegmentAudio';
import { RecordDetail } from '../components/RecordDetail';
import {
  deleteAudio,
  formatDuration,
  formatSize,
  isAudioBackupEnabled,
  isAudioRecordSupported,
  listAudio,
  saveAudio,
  setAudioBackupEnabled,
  shareAudio,
  startAudioRecording,
  type AudioEntry,
  type AudioRecorder,
} from '../lib/audio';

// idle: 待機 / session: 作業セッション（ハンズフリー） / recording→confirm→review: 1件だけ記録 / drafts: 陸でチェック
type Phase = 'idle' | 'session' | 'recording' | 'confirm' | 'review' | 'drafts';

const FORM_TYPES = ['選別', '沖出し', '陸揚げ', 'その他'];
const TIERS = ['上段', '中段', '下段'];
const SHELL_STATES = ['刃先が伸びている', 'ツルツル', '普通'];
const MEAT = ['良', '普', '悪'];
const PURPOSES = ['選別', '出荷', '移動'];

// 確認表の項目名（missing の表示に使う）
const FIELD_LABELS: Record<string, string> = {
  work_type: '作業の種類',
  lot_no: 'ロット番号',
  farm: '漁場',
  lane: 'レーン',
  ma_from: '間（から）',
  ma_to: '間（まで）',
  basket_count: 'かご数',
  purpose: '目的',
  avg_weight_g: 'サイズ（g）',
  count_per_basket: '入数（個/かご）',
  basket_type: 'かごの種類',
  mortality: '斃死（個）',
  shell_state: '殻の状態',
  meat_quality: '身入り',
  fouling: '付着物',
  workers: '人数',
  duration_min: '時間（分）',
  location_line: 'ライン（番）',
  location_tier: '段',
};

const EMPTY_ITEM: ExtractItem = { avg_weight_g: null, count_per_basket: null, basket_count: null, basket_type: null };
const EMPTY_RESULT: ExtractResult = {
  work_type: '選別',
  work_type_guessed: true,
  lot_no: null,
  farm: null,
  lane: null,
  ma_from: null,
  ma_to: null,
  basket_count: null,
  purpose: null,
  items: [EMPTY_ITEM],
  mortality: null,
  shell_state: null,
  meat_quality: null,
  fouling: null,
  workers: null,
  duration_min: null,
  location_line: null,
  location_tier: null,
  notes: null,
  missing: [],
};

/** "YYYY-MM-DDTHH:mm" ← ISO（JST 想定） */
function toLocalInput(iso: string): string {
  return iso.slice(0, 16);
}
/** datetime-local の値 → "YYYY-MM-DDTHH:mm:00+09:00" */
function fromLocalInput(v: string): string {
  return v.length >= 16 ? `${v.slice(0, 16)}:00+09:00` : v;
}

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
  const [recordedAt, setRecordedAt] = useState<string>(''); // 確認表で編集できる日時（JST）
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
  // VO-15: 生音声のバックアップ（端末内に保存。文字起こしが崩れたときに聞き直す）
  const audioRef = useRef<AudioRecorder | null>(null);
  const audioIdRef = useRef(''); // 録音に付ける ID（作業セッションは session_id、1件記録は r-…）
  const audioStartRef = useRef('');
  const [audioOn, setAudioOn] = useState<boolean>(() => isAudioBackupEnabled());
  const [audioLive, setAudioLive] = useState<'none' | 'rec' | 'na'>('none');
  const [audios, setAudios] = useState<AudioEntry[]>([]);
  const [lastAudioId, setLastAudioId] = useState<string | null>(null); // 1件だけ記録の直近の録音
  // 直近の記録の詳細：開いている行と、記録番号 → 元の区切り（null は区切り無し）
  const [openRecord, setOpenRecord] = useState<string | null>(null);
  const [segByRecord, setSegByRecord] = useState<Map<number, SegmentRow | null>>(new Map());

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

  const loadAudios = useCallback(async () => {
    try {
      setAudios(await listAudio());
    } catch {
      setAudios([]);
    }
  }, []);

  // 録音を始める。音声認識を起動した「あと」に、ボタン押下の流れの中で呼ぶ。失敗しても文字起こしは続く
  const beginAudio = (id: string) => {
    audioRef.current = null;
    audioIdRef.current = id;
    setLastAudioId(null);
    audioStartRef.current = jstNowIso();
    if (!audioOn || !isAudioRecordSupported()) {
      setAudioLive('na');
      return;
    }
    setAudioLive('none');
    void startAudioRecording().then((r) => {
      audioRef.current = r;
      setAudioLive(r ? 'rec' : 'na');
    });
  };

  // 録音を止めて端末内に保存する。保存できたら true
  const endAudio = async (): Promise<boolean> => {
    const r = audioRef.current;
    audioRef.current = null;
    setAudioLive('none');
    if (!r) return false;
    try {
      const out = await r.stop();
      if (!out) return false;
      await saveAudio({
        session_id: audioIdRef.current,
        recorded_at: audioStartRef.current,
        mime: out.mime,
        duration_ms: out.duration_ms,
        size: out.blob.size,
        marks: out.marks,
        blob: out.blob,
      });
      setLastAudioId(audioIdRef.current);
      await loadAudios();
      return true;
    } catch {
      return false;
    }
  };

  const loadRecent = useCallback(async () => {
    try {
      setRecent(await api<RecordRow[]>('/api/records?limit=12'));
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
    await loadAudios();
  }, [loadDrafts, loadAudios]);

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
    const savedAudio = await endAudio();
    const n = seqRef.current;
    setPhase('idle');
    showToast(
      n > 0
        ? `${n}件を記録しました（陸でチェック）${savedAudio ? '・録音も保存' : ''}`
        : savedAudio
          ? '記録はありませんでした（録音は保存）'
          : '記録はありませんでした',
    );
    await loadRecent();
  };

  // 合図を言った時刻の控え。iPhone は無音のあとにまとめて確定するので、確定時刻で印を付けると数秒〜十数秒遅れる。
  // 認識中の仮の文に合図が初めて現れた時刻を控えておき、確定で処理するときにその時刻を印に使う。
  const cueSeenRef = useRef(0); // 今の文（確定＋仮）に見えている合図の数
  const cueTimesRef = useRef<number[]>([]); // 見えた順の時刻（古い順）

  const handleSessionText = (f: string, i: string) => {
    const seen = countSplitCues(f + i);
    if (seen > cueSeenRef.current) {
      for (let k = cueSeenRef.current; k < seen; k++) cueTimesRef.current.push(Date.now());
    } else if (seen < cueSeenRef.current) {
      // 仮の文で見えた合図が消えた（聞き間違い）→ 新しい控えから捨てる
      cueTimesRef.current.splice(seen);
    }
    cueSeenRef.current = seen;

    // 確定した文に合図が複数あれば、その場で全部処理する
    let text = f;
    for (;;) {
      const hit = findCue(text);
      if (!hit) break;
      const before = text.slice(0, hit.index);
      const after = text.slice(hit.index + hit.length);
      if (hit.type === 'split') {
        const at = cueTimesRef.current.shift() ?? Date.now();
        audioRef.current?.mark(seqRef.current + 1, at);
        void commitSegment(before);
        text = after;
      } else {
        // 終了語：ここまでを保存して止める（終了語より後は捨てる）
        cueSeenRef.current = 0;
        cueTimesRef.current = [];
        sessionRef.current?.reset(before);
        setFinalText(before);
        setInterimText('');
        sessionRef.current?.stop();
        return;
      }
    }
    cueSeenRef.current = countSplitCues(text + i);
    cueTimesRef.current.splice(cueSeenRef.current);
    if (text !== f) sessionRef.current?.reset(text);
    setFinalText(text);
    setInterimText(i);
  };

  const startSession = () => {
    setError(null);
    if (!supported) {
      setError('このブラウザは音声認識に対応していないため、作業セッションは使えません。「1件だけ記録」をお使いください。');
      return;
    }
    sessionIdRef.current = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    seqRef.current = 0;
    cueSeenRef.current = 0;
    cueTimesRef.current = [];
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
    beginAudio(sessionIdRef.current);
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
    setRecordedAt('');
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
        void endAudio();
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
    beginAudio(`r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`);
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
      setResult({ ...r, items: r.work_type === '選別' && r.items.length === 0 ? [EMPTY_ITEM] : r.items });
      setRecordedAt((cur) => cur || jstNowIso());
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
    setRecordedAt((cur) => cur || jstNowIso());
    setPhase('review');
  };

  const setField = <K extends keyof ExtractResult>(key: K, value: ExtractResult[K]) =>
    setResult((r) => ({ ...r, [key]: value }));

  const changeWorkType = (w: string) =>
    setResult((r) => ({
      ...r,
      work_type: w,
      work_type_guessed: false,
      missing: r.missing.filter((m) => m !== 'work_type'),
      items: w === '選別' && r.items.length === 0 ? [EMPTY_ITEM] : w === '選別' ? r.items : [],
    }));
  const setItem = (i: number, patch: Partial<ExtractItem>) =>
    setResult((r) => ({ ...r, items: r.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));
  const addItem = () => setResult((r) => ({ ...r, items: [...r.items, EMPTY_ITEM] }));
  const removeItem = (i: number) =>
    setResult((r) => ({ ...r, items: r.items.length > 1 ? r.items.filter((_, j) => j !== i) : r.items }));

  // VO-05 / VO-06 / VO-13: 保存。通信失敗なら未送信に残す。区切りから来たら確定にして次へ
  const save = async () => {
    setError(null);
    setSaving(true);
    const inputs = toRecordInputs(result, draft.trim() || '（手入力）', recordedAt || undefined);
    const segId = currentSegmentId;
    try {
      await saveRecords(inputs, segId ?? undefined);
      setCurrentSegmentId(null);
      showToast(inputs.length > 1 ? `${inputs.length}件（サイズ帯ごと）保存しました` : `${result.work_type}を保存しました`);
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
        setPending(addPending({ kind: 'records', inputs, segment_id: segId ?? undefined }));
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
    void loadAudios();
  };

  // ---------- 直近の記録の詳細 ----------

  const toggleRecord = (key: string, firstId: number) => {
    if (openRecord === key) {
      setOpenRecord(null);
      return;
    }
    setOpenRecord(key);
    if (segByRecord.has(firstId)) return;
    api<SegmentRow[]>(`/api/segments?record_id=${firstId}`)
      .then((list) => setSegByRecord((m) => new Map(m).set(firstId, list[0] ?? null)))
      .catch(() => setSegByRecord((m) => new Map(m).set(firstId, null)));
  };

  // ---------- 録音（VO-15）：区切りごとの再生は SegmentAudio。ここはファイルの共有と削除 ----------

  const audioBySession = new Map(audios.map((a) => [a.session_id, a]));
  /** 確認画面・確認表で聞く録音：区切りから来たらその区切り、1件記録なら直近の録音全体 */
  const currentAudio = (() => {
    if (currentSegmentId != null) {
      const d = drafts.find((x) => x.id === currentSegmentId);
      const entry = d ? audioBySession.get(d.session_id) : undefined;
      return entry && d ? { entry, seq: d.seq } : null;
    }
    const entry = lastAudioId ? audioBySession.get(lastAudioId) : undefined;
    return entry ? { entry, seq: null } : null;
  })();

  // iOS の共有シートはタップ直後にしか開かないので、await を挟まずに呼ぶ
  const shareOne = (entry: AudioEntry) => {
    shareAudio(entry)
      .then((ok) => {
        if (ok) showToast('共有しました');
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  const deleteOne = async (id: string) => {
    if (!window.confirm('この録音を削除しますか？（端末から消えます）')) return;
    try {
      await deleteAudio(id);
      setAudios((list) => list.filter((a) => a.session_id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const toggleAudio = (on: boolean) => {
    setAudioOn(on);
    setAudioBackupEnabled(on);
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
    setRecordedAt(d.recorded_at);
    setPhase('confirm');
    void extract(d.raw_text.trim());
  };

  // 「確認」に出すのは、聞き間違いの疑いがある項目と、推定した作業の種類だけ（言わなかった項目は催促しない）
  const openMissing = result.missing.filter((f) => {
    if (f === 'work_type') return result.work_type_guessed;
    if (f === 'avg_weight_g' || f === 'count_per_basket' || f === 'basket_count' || f === 'basket_type') {
      return result.work_type === '選別' ? result.items.some((it) => it[f as keyof ExtractItem] == null) : result[f as 'basket_count'] == null;
    }
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
              {groupRecords(recent)
                .slice(0, 5)
                .map((g) => {
                  const open = openRecord === g.key;
                  const seg = segByRecord.get(g.rows[0].id);
                  return (
                    <li key={g.key} className={`record-item${open ? ' open' : ''}`}>
                      <button
                        type="button"
                        className="record-row clickable"
                        onClick={() => toggleRecord(g.key, g.rows[0].id)}
                        aria-expanded={open}
                      >
                        <span className="record-date">{formatDate(g.recorded_at)}</span>
                        <span className="record-loc">
                          {g.rows[0].lot_no ?? ''}
                          {placeLabel(g.rows[0]) ? ` ${placeLabel(g.rows[0])}` : ''}
                        </span>
                        <span className="record-work">{g.work_type}</span>
                        <span className="record-nums">{summaryLine(g.rows)}</span>
                        <span className="record-chev" aria-hidden="true">{open ? '▲' : '▼'}</span>
                      </button>
                      {open && <RecordDetail group={g} segment={seg} audio={seg ? audioBySession.get(seg.session_id) : undefined} />}
                    </li>
                  );
                })}
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
                  <span className="record-loc">{r.location_line != null ? `${r.location_line}番ライン${r.location_tier ? '・' + r.location_tier : ''}` : ''}</span>
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
          {isAudioRecordSupported() && (
            <label className="audio-toggle">
              <input type="checkbox" checked={audioOn} onChange={(e) => toggleAudio(e.target.checked)} />
              <span>生音声も端末に残す（聞き直し用）</span>
            </label>
          )}
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
            {audioLive === 'rec' && <span className="audio-state rec">● 録音中</span>}
            {audioLive === 'na' && <span className="audio-state">文字のみ</span>}
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
          {currentAudio && <SegmentAudio key={`${currentAudio.entry.session_id}-${currentAudio.seq ?? 0}`} entry={currentAudio.entry} seq={currentAudio.seq} />}
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

          {/* 原文は確認表の上に常時表示し、音声もその直下に置く（見比べながら直す） */}
          <div className="raw-box">
            <div className="raw-label">元の発話</div>
            <p className="raw-text">{draft || '（なし）'}</p>
          </div>
          {currentAudio && <SegmentAudio key={`${currentAudio.entry.session_id}-${currentAudio.seq ?? 0}`} entry={currentAudio.entry} seq={currentAudio.seq} />}

          {openMissing.length > 0 && (
            <ul className="missing-list">
              {openMissing.map((f) => (
                <li key={f}>
                  {f === 'work_type' ? `確認：作業の種類は「${result.work_type}」で合っていますか？` : `確認：${FIELD_LABELS[f] ?? f}（聞き取れなかったか、あり得ない値）`}
                </li>
              ))}
            </ul>
          )}

          <table className="review-table">
            <tbody>
              <tr className={result.work_type_guessed ? 'is-missing' : ''}>
                <th>作業の種類</th>
                <td>
                  <select value={result.work_type} onChange={(e) => changeWorkType(e.target.value)}>
                    {FORM_TYPES.map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
              <tr>
                <th>日時</th>
                <td>
                  <input type="datetime-local" value={toLocalInput(recordedAt || jstNowIso())} onChange={(e) => setRecordedAt(fromLocalInput(e.target.value))} />
                </td>
              </tr>
              <tr className={openMissing.includes('lot_no') ? 'is-missing' : ''}>
                <th>ロット番号</th>
                <td>
                  <input type="text" value={result.lot_no ?? ''} placeholder="例：R8-K3" onChange={(e) => setField('lot_no', e.target.value || null)} />
                </td>
              </tr>

              {(result.work_type === '沖出し' || result.work_type === '陸揚げ') && (
                <>
                  <tr className={openMissing.includes('farm') || openMissing.includes('lane') ? 'is-missing' : ''}>
                    <th>場所</th>
                    <td className="place-inputs">
                      <input type="text" value={result.farm ?? ''} placeholder="漁場（D）" onChange={(e) => setField('farm', e.target.value || null)} />
                      <input type="number" inputMode="numeric" min={1} value={result.lane ?? ''} placeholder="レーン" onChange={(e) => setField('lane', numOrNull(e.target.value))} />
                    </td>
                  </tr>
                  <tr className={openMissing.includes('ma_from') || openMissing.includes('ma_to') ? 'is-missing' : ''}>
                    <th>間（から〜まで）</th>
                    <td className="place-inputs">
                      <input type="number" inputMode="numeric" min={1} value={result.ma_from ?? ''} placeholder="から" onChange={(e) => setField('ma_from', numOrNull(e.target.value))} />
                      <input type="number" inputMode="numeric" min={1} value={result.ma_to ?? ''} placeholder="まで" onChange={(e) => setField('ma_to', numOrNull(e.target.value))} />
                    </td>
                  </tr>
                  <tr className={openMissing.includes('basket_count') ? 'is-missing' : ''}>
                    <th>かご数</th>
                    <td>
                      <input type="number" inputMode="numeric" min={0} value={result.basket_count ?? ''} placeholder="—" onChange={(e) => setField('basket_count', numOrNull(e.target.value))} />
                    </td>
                  </tr>
                </>
              )}

              {result.work_type === '陸揚げ' && (
                <tr>
                  <th>目的</th>
                  <td>
                    <select value={result.purpose ?? ''} onChange={(e) => setField('purpose', e.target.value || null)}>
                      <option value="">（未入力）</option>
                      {PURPOSES.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              )}

              {result.work_type === '選別' && (
                <>
                  <tr className={openMissing.includes('mortality') ? 'is-missing' : ''}>
                    <th>斃死（個・合計）</th>
                    <td>
                      <input type="number" inputMode="numeric" min={0} value={result.mortality ?? ''} placeholder="—" onChange={(e) => setField('mortality', numOrNull(e.target.value))} />
                    </td>
                  </tr>
                  <tr>
                    <th>殻の状態</th>
                    <td>
                      <select value={result.shell_state ?? ''} onChange={(e) => setField('shell_state', e.target.value || null)}>
                        <option value="">（未入力）</option>
                        {SHELL_STATES.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                  <tr>
                    <th>身入り（任意）</th>
                    <td>
                      <select value={result.meat_quality ?? ''} onChange={(e) => setField('meat_quality', e.target.value || null)}>
                        <option value="">（未入力）</option>
                        {MEAT.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                  <tr>
                    <th>付着物</th>
                    <td>
                      <select value={result.fouling == null ? '' : result.fouling ? 'あり' : 'なし'} onChange={(e) => setField('fouling', e.target.value === '' ? null : e.target.value === 'あり')}>
                        <option value="">（未入力）</option>
                        <option value="あり">あり</option>
                        <option value="なし">なし</option>
                      </select>
                    </td>
                  </tr>
                  <tr>
                    <th>人数・時間（任意）</th>
                    <td className="place-inputs">
                      <input type="number" inputMode="numeric" min={1} value={result.workers ?? ''} placeholder="人" onChange={(e) => setField('workers', numOrNull(e.target.value))} />
                      <input type="number" inputMode="numeric" min={1} value={result.duration_min ?? ''} placeholder="分" onChange={(e) => setField('duration_min', numOrNull(e.target.value))} />
                    </td>
                  </tr>
                </>
              )}

              {result.work_type === 'その他' && (
                <tr>
                  <th>内容</th>
                  <td className="notes">項目は付けず、下のメモと元の発話を記録として残します</td>
                </tr>
              )}

              <tr>
                <th>メモ</th>
                <td>
                  <textarea
                    className="notes-input"
                    value={result.notes ?? ''}
                    rows={2}
                    placeholder="項目に入らなかった発言は、ここに全部残ります"
                    onChange={(e) => setField('notes', e.target.value || null)}
                  />
                </td>
              </tr>
            </tbody>
          </table>

          {result.work_type === '選別' && (
            <div className="bands">
              <div className="bands-head">
                <span>サイズ帯（{result.items.length}）</span>
                <button type="button" className="btn small ghost" onClick={addItem}>
                  帯を追加
                </button>
              </div>
              {result.items.map((it, i) => (
                <div key={i} className={'band' + (it.avg_weight_g == null || it.count_per_basket == null || it.basket_count == null ? ' is-missing' : '')}>
                  <label>
                    <span>サイズ（g）</span>
                    <input type="number" inputMode="numeric" min={0} value={it.avg_weight_g ?? ''} placeholder="—" onChange={(e) => setItem(i, { avg_weight_g: numOrNull(e.target.value) })} />
                  </label>
                  <label>
                    <span>入数（個/かご）</span>
                    <input type="number" inputMode="numeric" min={0} value={it.count_per_basket ?? ''} placeholder="—" onChange={(e) => setItem(i, { count_per_basket: numOrNull(e.target.value) })} />
                  </label>
                  <label>
                    <span>かご数</span>
                    <input type="number" inputMode="numeric" min={0} value={it.basket_count ?? ''} placeholder="—" onChange={(e) => setItem(i, { basket_count: numOrNull(e.target.value) })} />
                  </label>
                  <label className="band-wide">
                    <span>かごの種類</span>
                    <input type="text" value={it.basket_type ?? ''} placeholder="例：15L" onChange={(e) => setItem(i, { basket_type: e.target.value || null })} />
                  </label>
                  {result.items.length > 1 && (
                    <button type="button" className="band-remove" onClick={() => removeItem(i)} aria-label="この帯を削除">
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

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
                {audioBySession.has(d.session_id) && (
                  <SegmentAudio key={`${d.session_id}-${d.seq}`} entry={audioBySession.get(d.session_id)!} seq={d.seq} />
                )}
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
          {audios.length > 0 && (
            <div className="card">
              <h2 className="card-title">録音ファイル（共有・削除）</h2>
              <p className="muted small-note">区切りごとの再生は上の各記録から。残したい録音は「共有して保存」でファイルやドライブへ。端末の中だけに残ります。</p>
              <ul className="audio-list">
                {audios.map((a) => (
                  <li key={a.session_id} className="draft">
                    <div className="draft-head">
                      <span>{formatDate(a.recorded_at)}</span>
                      <span className="muted">
                        {formatDuration(a.duration_ms)}・{formatSize(a.size)}
                        {a.marks.length > 0 ? `・区切り${a.marks.length}` : ''}
                      </span>
                    </div>
                    <div className="draft-actions audio-file-actions">
                      <button type="button" className="btn small" onClick={() => shareOne(a)}>
                        共有して保存
                      </button>
                      <button type="button" className="btn ghost small" onClick={() => deleteOne(a.session_id)}>
                        削除
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
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

function numOrNull(v: string): number | null {
  if (v === '') return null;
  const n = Math.max(0, Math.floor(Number(v)));
  return Number.isFinite(n) ? n : null;
}

/** 一覧用の要約：選別は帯ごと「30g×60個×10かご」、沖出し・陸揚げは「40かご（選別のため）」 */
function summaryLine(rows: RecordRow[]): string {
  const r0 = rows[0];
  if (r0.work_type === '選別') {
    return rows
      .map((r) => {
        const parts: string[] = [];
        if (r.avg_weight_g != null) parts.push(`${r.avg_weight_g}g`);
        if (r.count_per_basket != null) parts.push(`${r.count_per_basket}個`);
        if (r.basket_count != null) parts.push(`${r.basket_count}かご`);
        if (r.basket_type) parts.push(r.basket_type);
        return parts.join('×');
      })
      .filter(Boolean)
      .join('／');
  }
  const parts: string[] = [];
  if (r0.basket_count != null) parts.push(`${r0.basket_count}かご`);
  if (r0.purpose) parts.push(`（${r0.purpose}のため）`);
  if (!parts.length && r0.notes) parts.push(r0.notes.slice(0, 30));
  return parts.join('');
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
