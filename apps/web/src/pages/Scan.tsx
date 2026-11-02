import { useEffect, useRef, useState } from 'react';
import { Map as MapLibreMap, Marker, NavigationControl, type MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { navigate } from '../App';
import { api, ApiError, formatDay, type ScanEvaluate, type ScanMetrics, type ScanReport } from '../lib/api';

// 初期表示は周防灘（docs/03）。ピンは立てない（OS-06：実在漁場の座標をデフォルトにしない）
const INITIAL_CENTER: [number, number] = [131.25, 33.62];
const INITIAL_ZOOM = 9.5;
// 地理院タイル（淡色地図）。出典表示は必須
const GSI_TILES = 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png';
const GSI_ATTRIBUTION = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">地理院タイル</a>';

const LEVEL_LABEL = { low: '低', mid: '中', high: '高' } as const;

type Status = 'idle' | 'evaluating' | 'unsupported' | 'done';

export function Scan() {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapObj = useRef<MapLibreMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [metrics, setMetrics] = useState<ScanMetrics | null>(null);
  const [report, setReport] = useState<ScanReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!mapRef.current || mapObj.current) return;
    const map = new MapLibreMap({
      container: mapRef.current,
      style: {
        version: 8,
        sources: { gsi: { type: 'raster', tiles: [GSI_TILES], tileSize: 256, attribution: GSI_ATTRIBUTION, maxzoom: 18 } },
        layers: [{ id: 'gsi', type: 'raster', source: 'gsi' }],
      },
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      attributionControl: { compact: false },
    });
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.on('click', (e: MapMouseEvent) => void evaluate(e.lngLat.lat, e.lngLat.lng));
    mapObj.current = map;
    return () => {
      map.remove();
      mapObj.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // OS-02 → OS-03：指標を先に出し、所見はあとから追記する（クリックから 3 秒以内に指標）
  const evaluate = async (lat: number, lng: number) => {
    const my = ++seq.current;
    setError(null);
    setReport(null);
    setPoint({ lat, lng });
    if (mapObj.current) {
      if (!marker.current) marker.current = new Marker({ color: '#d7263d' });
      marker.current.setLngLat([lng, lat]).addTo(mapObj.current);
    }
    setStatus('evaluating');
    try {
      const r = await api<ScanEvaluate>('/api/scan/evaluate', { method: 'POST', body: JSON.stringify({ lat, lng }) });
      if (my !== seq.current) return;
      setMetrics(r.metrics);
      setStatus('done');
    } catch (e) {
      if (my !== seq.current) return;
      if (e instanceof ApiError && e.status === 422) {
        setMetrics(null);
        setStatus('unsupported');
        return;
      }
      setStatus('idle');
      setError(e instanceof Error ? pickErrorMessage(e.message) ?? e.message : String(e));
      return;
    }
    setReportLoading(true);
    try {
      const rep = await api<ScanReport>('/api/scan/report', { method: 'POST', body: JSON.stringify({ lat, lng }) });
      if (my !== seq.current) return;
      setReport(rep);
    } catch (e) {
      if (my !== seq.current) return;
      setError(e instanceof Error ? pickErrorMessage(e.message) ?? e.message : String(e));
    } finally {
      if (my === seq.current) setReportLoading(false);
    }
  };

  const handoff = () => {
    if (report) navigate(`/oysterman?from=scan&report=${report.id}`);
  };

  return (
    <section className="scan">
      <div className="scan-map-col">
        <h1 className="title">Oyscan</h1>
        <p className="lead">地図の海をクリックすると、気象庁の水温から診断します（対応海域：周防灘）。</p>
        <div ref={mapRef} className="scan-map" />
        <p className="scan-point">
          {point
            ? `選択中：北緯 ${point.lat.toFixed(3)} 東経 ${point.lng.toFixed(3)}${status === 'done' ? '（周防灘）' : ''}`
            : '地図をクリックして地点を選んでください'}
        </p>
      </div>

      <div className="scan-panel">
        {status === 'idle' && !error && <p className="muted">診断結果はここに出ます。</p>}
        {status === 'unsupported' && <p className="notice">この海域はまだ対応していません（対応海域：周防灘）</p>}
        {status === 'evaluating' && <p className="muted">集計しています…</p>}
        {error && <p className="error">{error}</p>}

        {metrics && status === 'done' && (
          <>
            <div className="tiles">
              <div className={`tile level-${metrics.hot_risk.level}`}>
                <div className="tile-label">高水温リスク</div>
                <div className="tile-value">{LEVEL_LABEL[metrics.hot_risk.level]}</div>
                <div className="tile-sub">
                  {metrics.hot_risk.threshold_c}℃以上が{metrics.hot_risk.streak_days}日以上続いた年：{metrics.years.length}年中{metrics.hot_risk.years_with_streak}年
                  ・最長{metrics.hot_risk.max_streak_days}日
                </div>
              </div>
              <div className="tile">
                <div className="tile-label">生育が鈍る期間</div>
                <div className="tile-value">年間約{metrics.cold_period.avg_days}日</div>
                <div className="tile-sub">{metrics.cold_period.threshold_c}℃未満の日数の年平均</div>
              </div>
              <div className="tile">
                <div className="tile-label">成長しやすい期間</div>
                <div className="tile-value">年間約{metrics.growth_period.avg_days}日</div>
                <div className="tile-sub">
                  {metrics.growth_period.band_c[0]}〜{metrics.growth_period.band_c[1]}℃の日数の年平均
                </div>
              </div>
            </div>

            <div className="card">
              <h2 className="card-title">直近の水温（{formatDay(metrics.recent.as_of)} 時点）</h2>
              <p className="recent-line">
                直近7日 平均 <strong>{metrics.recent.mean7 ?? '—'}℃</strong>
                {metrics.recent.vs5y && (
                  <>
                    ・5年統計の同日：平均 {metrics.recent.vs5y.mean ?? '—'}℃（最高 {metrics.recent.vs5y.max ?? '—'}／最低 {metrics.recent.vs5y.min ?? '—'}）
                    {metrics.recent.vs5y.diff != null && (
                      <>
                        ・差 <strong>{metrics.recent.vs5y.diff > 0 ? '+' : ''}{metrics.recent.vs5y.diff}℃</strong>
                      </>
                    )}
                  </>
                )}
                ・{metrics.season_label}
              </p>
            </div>

            <div className="card">
              <h2 className="card-title">所見</h2>
              {reportLoading && <p className="muted">所見を書いています…</p>}
              {report && <p className="report-text">{report.report_text}</p>}
            </div>

            <button type="button" className="btn primary" onClick={handoff} disabled={!report}>
              AI Oysterman に引き継いで相談する
            </button>
          </>
        )}

        <div className="disclaimer">
          <p>
            出典：気象庁「日本沿岸域の海面水温情報」（海域 623 周防灘）を加工して株式会社リブル作成。水温は海域全体の平均値（実績値）で、湾奥の個別地点とは異なります。予報ではありません。
          </p>
          <p>地図：国土地理院 地理院タイル。</p>
          <p>本診断は水温のみに基づく参考情報です。出荷の安全（貝毒・衛生基準）は都道府県の検査結果でご確認ください。</p>
        </div>
      </div>
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
