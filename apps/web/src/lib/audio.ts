// 生音声のバックアップ（VO-15）。
// 文字起こしが崩れたときに人が聞き直すためのもので、再文字起こしには使わない（製品の AI は Claude API のみ）。
// 音声認識（Web Speech API）を先に起動し、そのあとで MediaRecorder を起動する。
// 録音を始められない端末・ブラウザでは、何も言わずに文字起こしだけで続ける（フェイルオープン）。
// 保存先は端末内の IndexedDB。船から戻ったら「共有して保存」でファイル／ドライブへ出す。

const DB_NAME = 'oysterpilot';
const DB_VERSION = 1;
const STORE = 'audio';
const SETTING_KEY = 'oysterpilot.audioBackup'; // 'off' のときだけ録音しない

export type AudioMark = { seq: number; at_ms: number };

export type AudioEntry = {
  /** 作業セッション ID（voice_segments.session_id と同じ）。1件記録は r- で始まる */
  session_id: string;
  recorded_at: string; // JST ISO（セッション開始時刻）
  mime: string;
  duration_ms: number;
  size: number;
  /** 合図（区切り）の位置。seq は区切り番号、at_ms は録音開始からのミリ秒 */
  marks: AudioMark[];
  blob: Blob;
};

export type AudioEntryMeta = Omit<AudioEntry, 'blob'>;

export function isAudioBackupEnabled(): boolean {
  try {
    return localStorage.getItem(SETTING_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setAudioBackupEnabled(on: boolean) {
  try {
    localStorage.setItem(SETTING_KEY, on ? 'on' : 'off');
  } catch {
    /* 保存できなくても動作には影響しない */
  }
}

export function isAudioRecordSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder === 'function' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}

/** iPhone Safari は audio/mp4（AAC）、Chrome 系は webm/opus。どちらも無ければブラウザ任せ */
function pickMimeType(): string {
  const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* isTypeSupported が無い実装 */
    }
  }
  return '';
}

export type AudioRecorder = {
  /** 合図（区切り）の位置を印として残す */
  mark: (seq: number) => void;
  /** 録音を止めて音声を返す。何も録れていなければ null */
  stop: () => Promise<{ blob: Blob; mime: string; duration_ms: number; marks: AudioMark[] } | null>;
  readonly mime: string;
};

/**
 * 録音を開始する。ユーザー操作（ボタン押下）の中から同期的に呼ぶこと（iOS はジェスチャ外の getUserMedia を拒む）。
 * 失敗したら null を返し、例外は投げない。
 */
export async function startAudioRecording(): Promise<AudioRecorder | null> {
  if (!isAudioRecordSupported()) return null;
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return null;
  }
  const mime = pickMimeType();
  let rec: MediaRecorder;
  try {
    rec = new MediaRecorder(stream, {
      ...(mime ? { mimeType: mime } : {}),
      audioBitsPerSecond: 32_000, // 声が聞き取れれば十分。1時間でおよそ 15MB
    });
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    return null;
  }

  const chunks: Blob[] = [];
  const marks: AudioMark[] = [];
  const startedAt = Date.now();
  rec.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) chunks.push(ev.data);
  };
  try {
    rec.start(1000); // 1 秒ごとに chunk を受け取り、途中で落ちても直前まで残す
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    return null;
  }

  const actualMime = rec.mimeType || mime || 'audio/mp4';

  return {
    mime: actualMime,
    mark: (seq) => {
      marks.push({ seq, at_ms: Date.now() - startedAt });
    },
    stop: () =>
      new Promise((resolve) => {
        const finish = () => {
          stream.getTracks().forEach((t) => t.stop());
          if (chunks.length === 0) {
            resolve(null);
            return;
          }
          const blob = new Blob(chunks, { type: actualMime });
          resolve({ blob, mime: actualMime, duration_ms: Date.now() - startedAt, marks });
        };
        if (rec.state === 'inactive') {
          finish();
          return;
        }
        rec.onstop = finish;
        rec.onerror = finish;
        try {
          rec.stop();
        } catch {
          finish();
        }
      }),
  };
}

// ---------- IndexedDB ----------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB が使えません'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'session_id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB を開けません'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB の書き込みに失敗しました'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB の書き込みが中断されました'));
  });
}

export async function saveAudio(entry: AudioEntry): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(entry);
    await txDone(tx);
  } finally {
    db.close();
  }
}

/** 一覧（blob も含める。IndexedDB の Blob は参照なので軽い）。新しい順。
 *  共有シートはボタン押下の直後に同期で呼ぶ必要があるため、一覧の時点で blob を手元に持っておく */
export async function listAudio(): Promise<AudioEntry[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    const all = await new Promise<AudioEntry[]>((resolve, reject) => {
      req.onsuccess = () => resolve((req.result as AudioEntry[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    return all.sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : -1));
  } finally {
    db.close();
  }
}

export async function getAudio(sessionId: string): Promise<AudioEntry | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(sessionId);
    return await new Promise<AudioEntry | null>((resolve, reject) => {
      req.onsuccess = () => resolve((req.result as AudioEntry) ?? null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function deleteAudio(sessionId: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(sessionId);
    await txDone(tx);
  } finally {
    db.close();
  }
}

// ---------- 共有・保存 ----------

function extFor(mime: string): string {
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('ogg')) return 'ogg';
  return 'bin';
}

export function audioFileName(meta: AudioEntryMeta): string {
  const stamp = meta.recorded_at.slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2');
  return `voysy-${stamp}.${extFor(meta.mime)}`;
}

/**
 * iPhone は共有シート（ファイルに保存／ドライブ／AirDrop）、それ以外はダウンロード。
 * 共有シートをユーザーが閉じた場合は false。
 * iOS は navigator.share をユーザー操作の直後にしか許さないので、呼ぶ前に await を挟まないこと。
 */
export async function shareAudio(entry: AudioEntry): Promise<boolean> {
  const name = audioFileName(entry);
  const file = new File([entry.blob], name, { type: entry.mime });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: name });
      return true;
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return false;
      /* 共有できなければダウンロードに落とす */
    }
  }
  const url = URL.createObjectURL(entry.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

// ---------- 区切りごとの再生範囲 ----------

/** 文字は声より 1〜2 秒遅れて確定するので、範囲の頭はこの分だけ手前から始める */
export const SEGMENT_LEAD_MS = 2000;

export type AudioRange = { start_ms: number; end_ms: number };

/**
 * 区切り seq の再生範囲。区切り N は「印 N の位置から印 N+1 の位置まで」。
 * 最初の区切りは録音の頭から、最後の区切りは末尾まで。印が無い（1件記録・seq 不明）ときは全体。
 */
export function segmentRange(entry: Pick<AudioEntry, 'marks' | 'duration_ms'>, seq: number | null): AudioRange {
  const total = Math.max(0, entry.duration_ms);
  if (seq == null || seq < 1) return { start_ms: 0, end_ms: total };
  const at = (n: number) => entry.marks.find((m) => m.seq === n)?.at_ms;
  const from = seq === 1 ? 0 : at(seq);
  if (from == null) return { start_ms: 0, end_ms: total };
  const to = at(seq + 1);
  return {
    start_ms: Math.max(0, from - (seq === 1 ? 0 : SEGMENT_LEAD_MS)),
    end_ms: to != null && to > from ? to : total,
  };
}
