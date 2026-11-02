-- OysterPilot D1 schema（docs/04_data_model.md）
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

CREATE TABLE reservations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  due_date      TEXT NOT NULL,            -- YYYY-MM-DD
  location_line INTEGER,
  location_tier TEXT,
  work          TEXT NOT NULL,
  reason        TEXT,
  rule_ids      TEXT,                     -- JSON 配列
  status        TEXT NOT NULL DEFAULT 'open',  -- open / done
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE scan_reports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  lat           REAL NOT NULL,
  lng           REAL NOT NULL,
  area_no       INTEGER NOT NULL,         -- 623
  metrics_json  TEXT NOT NULL,
  report_text   TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
