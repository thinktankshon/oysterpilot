import { useEffect, useRef, useState } from 'react';
import { Map as MapLibreMap, Marker, NavigationControl, setWorkerUrl, type MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 は Worker を別ファイル（maplibre-gl-worker.mjs）で読む。Vite の資産として URL を確定させないと本番で配信されず、海域の点（GeoJSON 層）が描けない
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
setWorkerUrl(maplibreWorkerUrl);
import { navigate } from '../App';
import { api, ApiError, formatDay, type ScanAreasResponse, type ScanEvaluate, type ScanEvaluation, type ScanLabels, type ScanReport } from '../lib/api';

// 初期表示は日本全体。ピンは立てない（OS-06：実在漁場の座標をデフォルトにしない）
const INITIAL_CENTER: [number, number] = [137.5, 37.0];
const INITIAL_ZOOM = 4.4;
// 地理院タイル（淡色地図）。出典表示は必須
const GSI_TILES = 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png';
const GSI_ATTRIBUTION = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">地理院タイル</a>';
const RISK_COLOR = { low: '#1c8a4c', mid: '#b7791f', high: '#d7263d' } as const;

type Status = 'idle' | 'evaluating' | 'unsupported' | 'done';

export function Scan() {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapObj = useRef<MapLibreMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const [areas, setAreas] = useState<ScanAreasResponse | null>(null);
  const [labels, setLabels] = useState<ScanLabels | null>(null);
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [ev, setEv] = useState<ScanEvaluation | null>(null);
  const [report, setReport] = useState<ScanReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  // 海域の中心点（斃死リスクの色つき）を地図に載せる
  useEffect(() => {
    void (async () => {
      try {
        const a = await api<ScanAreasResponse>('/api/scan/areas');
        setAreas(a);
        setLabels(a.labels);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

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

  useEffect(() => {
    const map = mapObj.current;
    if (!map || !areas) return;
    const add = () => {
      if (map.getSource('areas')) return;
      map.addSource('areas', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: areas.areas.map((a) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [a.lng, a.lat] },
            properties: { name: a.name, color: RISK_COLOR[a.mortality_risk] },
          })),
        },
      });
      map.addLayer({
        id: 'areas-dots',
        type: 'circle',
        source: 'areas',
        paint: { 'circle-radius': 6, 'circle-color': ['get', 'color'], 'circle-opacity': 0.85, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff' },
      });
    };
    if (map.isStyleLoaded()) add();
    else map.once('load', add);
  }, [areas]);

  // OS-02 → OS-03：指標を先に出し、所見はあとから追記する
  const evaluate = async (lat: number, lng: number) => {
    const my = ++seq.current;
    setError(null);
    setReport(null);
    setPoint({ lat, lng });
    if (mapObj.current) {
      if (!marker.current) marker.current = new Marker({ color: '#0b3d5c' });
      marker.current.setLngLat([lng, lat]).addTo(mapObj.current);
    }
    setStatus('evaluating');
    try {
      const r = await api<ScanEvaluate>('/api/scan/evaluate', { method: 'POST', body: JSON.stringify({ lat, lng }) });
      if (my !== seq.current) return;
      setEv(r.evaluation);
      setLabels(r.labels);
      setStatus('done');
    } catch (e) {
      if (my !== seq.current) return;
      if (e instanceof ApiError && e.status === 422) {
        setEv(null);
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

  const L = labels;
  return (
    <section className="scan">
      <div className="scan-map-col">
        <h1 className="title">Oyscan</h1>
        <p className="lead">地図の海をクリックすると、気象庁の水温と雨量から診断します。点は診断できる海域（色は斃死リスク）。</p>
        <div ref={mapRef} className="scan-map" />
        <p className="scan-point">
          {point
            ? `選択中：北緯 ${point.lat.toFixed(3)} 東経 ${point.lng.toFixed(3)}${ev ? `（${ev.area.name}）` : ''}`
            : areas
              ? `${areas.areas.length} 海域を診断できます。海をクリックしてください`
              : '地図をクリックして地点を選んでください'}
        </p>
        {areas && (
          <p className="legend">
            <span className="dot" style={{ background: RISK_COLOR.low }} /> 低 <span className="dot" style={{ background: RISK_COLOR.mid }} /> 中{' '}
            <span className="dot" style={{ background: RISK_COLOR.high }} /> 高（斃死リスク、{areas.years[0]}〜{areas.years[areas.years.length - 1]}年）
          </p>
        )}
      </div>

      <div className="scan-panel">
        {status === 'idle' && !error && <p className="muted">診断結果はここに出ます。</p>}
        {status === 'unsupported' && <p className="notice">この地点の近くに対応する海域がありません。本土沿岸の海をクリックしてください。</p>}
        {status === 'evaluating' && <p className="muted">集計しています…</p>}
        {error && <p className="error">{error}</p>}

        {ev && L && status === 'done' && (
          <>
            <h2 className="area-name">
              {ev.area.name}
              <small className="muted">（気象庁 沿岸海域 {ev.area.no}・雨量は{ev.area.station?.name ?? '—'}観測所）</small>
            </h2>
            <div className="tiles">
              <div className={`tile level-${ev.mortality_risk.level}`}>
                <div className="tile-label">斃死リスク</div>
                <div className="tile-value">{L.mortality_risk[ev.mortality_risk.level]}</div>
                <div className="tile-sub">
                  28℃以上 年{ev.mortality_risk.hot_days_avg}日（最長{ev.mortality_risk.max_streak_days}日連続）
                  {ev.mortality_risk.heavy_days_jun_oct_avg != null && ` ・ 6〜10月の大雨（50mm以上） 年${ev.mortality_risk.heavy_days_jun_oct_avg}日`}
                </div>
              </div>
              <div className={`tile speed-${ev.growth_speed.level}`}>
                <div className="tile-label">成長スピード</div>
                <div className="tile-value">{L.growth_speed[ev.growth_speed.level]}</div>
                <div className="tile-sub">
                  15〜25℃ 年{ev.growth_speed.growth_days_avg}日 ・ 10℃未満 年{ev.growth_speed.cold_days_avg}日
                  {ev.growth_speed.penalized && '（低水温が長く 1 段下げ）'}
                </div>
              </div>
              <div className="tile">
                <div className="tile-label">年間雨量</div>
                <div className="tile-value">{ev.rain ? `${ev.rain.annual_mm_avg.toLocaleString()}mm` : '—'}</div>
                <div className="tile-sub">{ev.rain ? `50mm以上の日 年${ev.rain.heavy_days_avg}日（${ev.area.station?.name}）` : '雨量データなし'}</div>
              </div>
            </div>

            <p className="tile-note">
              ※ 公開データ（気象庁の海域平均水温と最寄り観測所の雨量）を参考にした推察値です。同じ海域でも、潮流や潮の当たり方、水深、場所によって変わります。
            </p>

            <div className="card">
              <h2 className="card-title">直近の水温（{formatDay(ev.recent.as_of)} 時点）</h2>
              <p className="recent-line">
                直近7日 平均 <strong>{ev.recent.mean7 ?? '—'}℃</strong>
                {ev.recent.vs5y_mean != null && (
                  <>
                    ・5年統計の同日：平均 {ev.recent.vs5y_mean}℃
                    {ev.recent.diff != null && (
                      <>
                        ・差 <strong>{ev.recent.diff > 0 ? '+' : ''}{ev.recent.diff}℃</strong>
                      </>
                    )}
                  </>
                )}
                {ev.season_label && `・${ev.season_label}`}
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
            出典：気象庁「日本沿岸域の海面水温情報」（沿岸海域の平均・実績値）、気象庁「過去の気象データ」（気象官署の日降水量）を加工して株式会社リブル作成。水温は海域全体の平均値、雨量は最寄りの観測所の値で、個別地点の値とは異なります。予報ではありません。
          </p>
          <p>地図：国土地理院 地理院タイル。海域の判定はクリック地点に最も近い海域の中心点で行う簡易なものです。</p>
          <p>本診断は水温と雨量のみに基づく参考情報です。出荷の安全（貝毒・衛生基準）は都道府県の検査結果でご確認ください。</p>
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
