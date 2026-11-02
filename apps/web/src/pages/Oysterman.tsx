import { useEffect, useRef, useState } from 'react';
import { api, formatDay, type BriefLot, type ChatMessage, type ChatResponse, type EnvMetrics, type ScanReport } from '../lib/api';

// 範囲外のときの相談先（リブルの問い合わせページ）。デモでは押さない。URL は提出前に確認する
const CONSULT_URL = 'https://reblue-k.com/';
// 予約ボタンを出す対象（提案を含むルール）
const PROPOSAL_RULES = ['R4_basket_target', 'R5_shell_long', 'R6_shell_smooth', 'R7_sort_due'];
const EXAMPLES = ['今日ってどの作業がいいかな？', '最近の水温ってどう？', '3番ラインの貝、刃先がひょろっと伸びてきた。このままでいい？'];
const EXAMPLES_FROM_SCAN = ['この海で始めるときの注意は？', '最近の水温ってどう？'];

type Bubble = { id: number; role: 'user' | 'ai' | 'system'; text: string; basis?: string[]; canReserve?: boolean; consult?: boolean };

export function Oysterman() {
  const [env, setEnv] = useState<EnvMetrics | null>(null);
  const [lots, setLots] = useState<BriefLot[]>([]);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFocus, setLastFocus] = useState<string[]>([]);
  const idRef = useRef(0);
  const endRef = useRef<HTMLDivElement | null>(null);
  const handoffShown = useRef(false);
  const scanReportId = new URLSearchParams(window.location.search).get('report');

  // 新しい吹き出しを足すとき、前の吹き出しの予約ボタンは消す（最新の提案だけ予約できる）
  const push = (b: Omit<Bubble, 'id'>) =>
    setBubbles((list) => [...list.map((x) => (x.canReserve ? { ...x, canReserve: false } : x)), { ...b, id: ++idRef.current }]);

  useEffect(() => {
    void (async () => {
      try {
        setEnv(await api<EnvMetrics>('/api/env/suonada'));
      } catch {
        /* 水温が取れなくても相談はできる */
      }
      try {
        const locs = await api<{ location_line: number; location_tier: string | null; latest_at: string }[]>('/api/records/locations');
        // 日数は返答の context で更新されるので、まずは場所名だけ
        setLots(
          locs.map((l) => ({
            location_label: `${l.location_line}番ライン${l.location_tier ? '・' + l.location_tier : ''}`,
            days_since_last_sort: null,
            avg_weight_g: null,
            count_per_basket: null,
          })),
        );
      } catch {
        /* 場所の一行が出ないだけ */
      }
    })();
    if (scanReportId && !handoffShown.current) {
      handoffShown.current = true;
      void (async () => {
        try {
          const rep = await api<ScanReport>(`/api/scan/report/${scanReportId}`);
          const ev = rep.evaluation;
          push({
            role: 'system',
            text: `Oyscan の診断を引き継ぎました（${ev.area.name}）：斃死リスク ${rep.labels.mortality_risk[ev.mortality_risk.level]}（28℃以上 年${ev.mortality_risk.hot_days_avg}日、6〜10月の大雨 年${ev.mortality_risk.heavy_days_jun_oct_avg ?? '—'}日）・成長スピード ${rep.labels.growth_speed[ev.growth_speed.level]}（15〜25℃ 年${ev.growth_speed.growth_days_avg}日、10℃未満 年${ev.growth_speed.cold_days_avg}日）。「この海で始めるときの注意は？」と聞けます。`,
          });
        } catch {
          push({ role: 'system', text: `Oyscan の診断（レポート #${scanReportId}）を引き継ぎました。この海で始めるときの注意を聞けます。` });
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [bubbles]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || sending) return;
    setError(null);
    setInput('');
    push({ role: 'user', text: content });
    const next: ChatMessage[] = [...history, { role: 'user', content }];
    setSending(true);
    try {
      const r = await api<ChatResponse>('/api/oysterman/chat', {
        method: 'POST',
        body: JSON.stringify({ messages: next, ...(scanReportId ? { scan_report_id: Number(scanReportId) } : {}) }),
      });
      setHistory([...next, { role: 'assistant', content: r.reply }]);
      setLots(r.context.lots);
      setEnv(r.context.env);
      setLastFocus(r.focus);
      const proposes = r.fired_rules.some((id) => PROPOSAL_RULES.includes(id));
      push({ role: 'ai', text: r.reply, basis: r.basis, canReserve: !r.reservation && proposes && !r.out_of_scope, consult: r.out_of_scope });
      if (r.reservation) {
        const where = r.reservation.location_label ? `${r.reservation.location_label} ` : '';
        push({ role: 'system', text: `✓ Voysy に『${formatDay(r.reservation.due_date)}：${where}${r.reservation.work}』を予約しました` });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(pickErrorMessage(msg) ?? msg);
      setInput(content);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="oysterman">
      <h1 className="title">AI Oysterman</h1>
      <p className="lead">作業の合間に、隣の先輩に聞くように。</p>

      <div className="status-strip">
        {env && (
          <p className="env-line">
            {env.area_name}の水温：直近7日 平均 {env.mean7 ?? '—'}℃
            {env.vs5y?.diff != null && `（5年平均より${env.vs5y.diff > 0 ? '+' : ''}${env.vs5y.diff}℃）`}
            ・{env.season_label}（{formatDay(env.as_of)} 時点）
          </p>
        )}
        {lots.length > 0 && (
          <p className="lots-line">
            記録のある場所：
            {lots.map((l, i) => (
              <span key={l.location_label}>
                {i > 0 && '・'}
                {l.location_label}
                {l.days_since_last_sort != null && <span className="muted">（{l.days_since_last_sort}日）</span>}
              </span>
            ))}
          </p>
        )}
      </div>

      <div className="chat" aria-live="polite">
        {bubbles.every((b) => b.role === 'system') && (
          <div className="examples">
            <p className="muted">例えば、こんなふうに。</p>
            {(scanReportId ? EXAMPLES_FROM_SCAN : EXAMPLES).map((ex) => (
              <button key={ex} type="button" className="example" onClick={() => send(ex)}>
                {ex}
              </button>
            ))}
          </div>
        )}
        {bubbles.map((b) => (
          <div key={b.id} className={`bubble ${b.role}`}>
            <p>{b.text}</p>
            {b.basis && b.basis.length > 0 && <p className="basis">根拠：{b.basis.join('・')}</p>}
            {b.canReserve && (
              <button
                type="button"
                className="btn small"
                onClick={() => send(lastFocus.length === 1 ? `この作業を予約して。明日やる。場所は${lastFocus[0]}。` : 'この作業を予約して。明日やる。')}
                disabled={sending}
              >
                この作業を予約する
              </button>
            )}
            {b.consult && (
              <a className="btn small consult" href={CONSULT_URL} target="_blank" rel="noreferrer">
                専門家に相談する
              </a>
            )}
          </div>
        ))}
        {sending && <div className="bubble ai thinking">考えています…</div>}
        <div ref={endRef} />
      </div>

      {error && <p className="error">{error}</p>}

      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <textarea
          className="chat-input"
          value={input}
          rows={2}
          placeholder="聞きたいことを書いてください"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send(input);
            }
          }}
        />
        <button type="submit" className="btn primary send" disabled={sending || !input.trim()}>
          送信
        </button>
      </form>
    </section>
  );
}

function pickErrorMessage(text: string): string | null {
  try {
    const j = JSON.parse(text) as { error?: unknown };
    return typeof j.error === 'string' ? j.error : null;
  } catch {
    return null;
  }
}
