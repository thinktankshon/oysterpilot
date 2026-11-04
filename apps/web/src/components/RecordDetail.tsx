import { formatDate, placeLabel, type RecordGroup, type SegmentRow } from '../lib/api';
import { SegmentAudio } from './SegmentAudio';
import type { AudioEntry } from '../lib/audio';

/**
 * 直近の記録の詳細（見るだけ）。確認表と同じ並びで、空の項目は出さない。
 * 保存時に区切りへ記録番号を書いているので、区切り → 録音（端末内）まで辿れたときだけ「聞く」を出す。
 */
export function RecordDetail({
  group,
  segment,
  audio,
}: {
  group: RecordGroup;
  segment: SegmentRow | null | undefined; // undefined: まだ読んでいない
  audio: AudioEntry | undefined;
}) {
  const r0 = group.rows[0];
  const place = placeLabel(r0);
  const rows: Array<[string, string]> = [];
  rows.push(['日時', formatDate(r0.recorded_at)]);
  rows.push(['作業', r0.work_type]);
  if (r0.lot_no) rows.push(['ロット', r0.lot_no]);
  if (place) rows.push(['場所', place]);
  if (r0.work_type !== '選別') {
    if (r0.basket_count != null) rows.push(['かご数', `${r0.basket_count}かご`]);
    if (r0.purpose) rows.push(['目的', r0.purpose]);
  } else {
    if (r0.mortality != null) rows.push(['斃死合計', `${r0.mortality}個`]);
    if (r0.shell_state) rows.push(['殻の状態', r0.shell_state]);
    if (r0.meat_quality) rows.push(['身入り', r0.meat_quality]);
    if (r0.fouling != null) rows.push(['付着物', r0.fouling ? 'あり' : 'なし']);
    if (r0.workers != null) rows.push(['人数', `${r0.workers}人`]);
    if (r0.duration_min != null) rows.push(['時間', `${r0.duration_min}分`]);
  }
  if (r0.notes) rows.push(['メモ', r0.notes]);
  const bands = r0.work_type === '選別' ? group.rows.filter((r) => r.avg_weight_g != null || r.count_per_basket != null || r.basket_count != null) : [];

  return (
    <div className="record-detail">
      <dl className="detail-list">
        {rows.map(([k, v]) => (
          <div key={k} className="detail-row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {bands.length > 0 && (
        <table className="detail-bands">
          <thead>
            <tr>
              <th>サイズ</th>
              <th>入数</th>
              <th>かご数</th>
              <th>かご</th>
            </tr>
          </thead>
          <tbody>
            {bands.map((r) => (
              <tr key={r.id}>
                <td>{r.avg_weight_g != null ? `${r.avg_weight_g}g` : '—'}</td>
                <td>{r.count_per_basket != null ? `${r.count_per_basket}個` : '—'}</td>
                <td>{r.basket_count != null ? `${r.basket_count}かご` : '—'}</td>
                <td>{r.basket_type ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {r0.raw_text && r0.raw_text !== '（手入力）' && (
        <details className="raw">
          <summary>元の発話</summary>
          <p>{r0.raw_text}</p>
        </details>
      )}
      {segment && audio && <SegmentAudio key={`${segment.session_id}-${segment.seq}`} entry={audio} seq={segment.seq} />}
    </div>
  );
}
