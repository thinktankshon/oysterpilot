// ブラウザの Web Speech API（iPhone Safari は webkitSpeechRecognition）で音声→文字。
// iOS は continuous でも無音で勝手に止まるので、停止ボタンが押されるまで自動で再開する。

type RecognitionCtor = new () => SpeechRecognitionLike;
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

function getCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSpeechSupported(): boolean {
  return getCtor() !== null;
}

export type SpeechHandlers = {
  /** 確定済み全文 + 認識中の文（表示用） */
  onText: (finalText: string, interimText: string) => void;
  onError: (message: string) => void;
  /** 停止ボタン後、完全に終了したとき */
  onEnd: (finalText: string) => void;
};

export type SpeechSession = { stop: () => void };

export function startSpeech(h: SpeechHandlers): SpeechSession | null {
  const Ctor = getCtor();
  if (!Ctor) return null;

  let finalText = '';
  let stopping = false;
  let rec: SpeechRecognitionLike | null = null;

  const spawn = () => {
    const r = new Ctor();
    r.lang = 'ja-JP';
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        const t = res[0]?.transcript ?? '';
        if (res.isFinal) finalText += t;
        else interim += t;
      }
      h.onText(finalText, interim);
    };
    r.onerror = (ev) => {
      // no-speech / aborted は再開で吸収する。それ以外は知らせる。
      if (ev.error === 'no-speech' || ev.error === 'aborted') return;
      h.onError(describeError(ev.error));
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        stopping = true;
      }
    };
    r.onend = () => {
      if (stopping) {
        h.onEnd(finalText);
        return;
      }
      // iOS Safari は無音で止まるので、ユーザーが止めるまで再開する
      try {
        rec = spawn();
      } catch {
        h.onEnd(finalText);
      }
    };
    r.start();
    return r;
  };

  try {
    rec = spawn();
  } catch (e) {
    h.onError(e instanceof Error ? e.message : String(e));
    return null;
  }

  return {
    stop: () => {
      stopping = true;
      try {
        rec?.stop();
      } catch {
        h.onEnd(finalText);
      }
    },
  };
}

function describeError(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'マイクの使用が許可されていません。Safari の設定でマイクを許可してください。';
    case 'audio-capture':
      return 'マイクが見つかりません。';
    case 'network':
      return '音声認識のネットワークエラーです。電波を確認してください。';
    default:
      return `音声認識エラー: ${code}`;
  }
}
