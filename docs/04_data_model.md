# 04. データモデルと API

## D1 スキーマ（`apps/api/migrations/0001_init.sql`）

```sql
CREATE TABLE records (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  recorded_at   TEXT NOT NULL,            -- ISO8601 (JST で入力されたものを保存)
  work_type     TEXT NOT NULL,            -- 選別/分殖/沖出し/陸揚げ/揺らし/移動/その他
  location_line INTEGER,                  -- ライン番号
  location_tier TEXT,                     -- 上段/下段/中段/NULL
  lot_no        TEXT,
  avg_weight_g  REAL,
  count_per_basket INTEGER,
  mortality     INTEGER,
  basket_count  INTEGER,
  raw_text      TEXT NOT NULL,            -- 文字起こし全文（seed は元の発話）
  source        TEXT NOT NULL DEFAULT 'voysy',  -- voysy / seed
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_records_loc ON records(location_line, location_tier, recorded_at);

-- 0002_segments.sql（11/2 追加）
ALTER TABLE records ADD COLUMN notes TEXT;      -- 備考（確認表で編集可）

CREATE TABLE voice_segments (                   -- 作業セッションの区切り（生の文。陸で整理して records にする）
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT NOT NULL,                  -- 作業開始ごとの ID（端末で生成）
  seq           INTEGER NOT NULL,               -- セッション内の順番
  recorded_at   TEXT NOT NULL,                  -- 区切りが確定した時刻（JST）
  raw_text      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft',  -- draft / done / deleted
  record_id     INTEGER,                        -- 確定後の records.id
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_segments_status ON voice_segments(status, recorded_at);

CREATE TABLE reservations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  due_date      TEXT NOT NULL,            -- YYYY-MM-DD
  location_line INTEGER,
  location_tier TEXT,
  work          TEXT NOT NULL,            -- 自由文（例：揺れの強い場所へ移動・次回選別は1.5kg目安）
  reason        TEXT,
  rule_ids      TEXT,                     -- JSON 配列（例：["R3_growth_check","R5_shell_long"]）
  status        TEXT NOT NULL DEFAULT 'open',  -- open / done
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE scan_reports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  lat           REAL NOT NULL,
  lng           REAL NOT NULL,
  area_no       INTEGER NOT NULL,         -- 623
  metrics_json  TEXT NOT NULL,            -- 指標の計算結果
  report_text   TEXT NOT NULL,            -- Claude の所見
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

シード：`data/seed_records.csv` → `scripts/seed.ts` で `records` に投入（`source='seed'`）。CSV の列対応：
日時→recorded_at／作業→work_type／沖出し場所「3番ライン・上段」→location_line=3, location_tier=上段／ロット番号→lot_no／サイズ(g)→avg_weight_g／入数(個/かご)→count_per_basket／斃死(個)→mortality／かご数→basket_count／元の発話→raw_text。

## API（Hono on Workers、すべて JSON、`X-Demo-Key` ヘッダで共有パスワード）

| Method | Path | 入力 | 出力 | 使う画面 |
|---|---|---|---|---|
| POST | `/api/voysy/extract` | `{text}` | 構造化 JSON（`01_voysy.md`） | Voysy |
| POST | `/api/records` | 構造化 JSON ＋ `raw_text` ＋ `notes` | `{id}` | Voysy |
| POST | `/api/segments` | `{session_id, seq, recorded_at, raw_text}` | `{id}` | Voysy（作業中） |
| GET | `/api/segments?status=draft` | | segments[] | Voysy（陸でチェック） |
| PATCH | `/api/segments/:id` | `{raw_text?, status?, record_id?}` | `{ok}` | Voysy（陸でチェック） |
| GET | `/api/records?line=3&tier=上段&limit=10` | | records[] | Voysy / Oysterman |
| GET | `/api/records/summary?line=3&tier=上段` | | `{last_sort_at, days_since_last_sort, avg_weight_g, count_per_basket, basket_total_kg, mortality_recent}` | Oysterman |
| GET | `/api/env/suonada` | | `{mean7, max7, min7, hot_streak, cold_streak, in_growth_band, as_of}` | Oysterman / Oyscan |
| POST | `/api/oysterman/chat` | `{messages[], line, tier, scan_report_id?}` | `{reply, fired_rules[], proposed_reservation?}` | Oysterman |
| POST | `/api/reservations` | `{due_date, location_line, location_tier, work, reason, rule_ids}` | `{id}` | Oysterman |
| GET | `/api/reservations?status=open` | | reservations[] | Voysy |
| POST | `/api/scan/evaluate` | `{lat, lng}` | metrics JSON（`03_oyscan.md`） | Oyscan |
| POST | `/api/scan/report` | `{lat, lng, metrics}` | `{id, report_text}` | Oyscan |
| GET | `/api/scan/report/:id` | | scan_report | Oysterman（引き継ぎ） |

`/api/oysterman/chat` の内部手順：summary 取得 → env 取得 → `rules.ts` で評価（fired, advice_targets）→ システムプロンプト（`prompts/oysterman_system.md` ＋ glossary ＋ rules ＋ 評価結果）→ Claude 呼び出し（tool use で `propose_reservation` を定義し、予約の提案があれば構造化で返す）。

## 環境データの計算（`apps/api/src/env.ts`）

`apps/api/data/suonada.json`（`scripts/fetch_jma.ts` が生成、`{daily:[{date,temp}], stats5y:[{mmdd,mean,max,min}]}`）から：
- `mean7/max7/min7`：直近7日（欠損 -9999 は除外）
- `hot_streak`：直近で 28℃以上が連続した日数（今日から遡る）
- `cold_streak`：同じく 10℃未満
- `in_growth_band`：直近7日平均が 15〜25℃
- 「直近」は `as_of` = データの最終日。デモ日にデータが古い場合は `as_of` をそのまま表示し、ごまかさない

## 秘密情報

- `ANTHROPIC_API_KEY`、`DEMO_KEY`：`wrangler secret put`。ローカルは `.dev.vars`（gitignore）。
- フロントは `DEMO_KEY` を初回入力でもらい `localStorage` に保持。
