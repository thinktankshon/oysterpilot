-- 作業セッション（ハンズフリー段階1）: 区切りごとの生の文と、records の備考列
ALTER TABLE records ADD COLUMN notes TEXT;

CREATE TABLE voice_segments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT NOT NULL,
  seq           INTEGER NOT NULL,
  recorded_at   TEXT NOT NULL,
  raw_text      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft',
  record_id     INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_segments_status ON voice_segments(status, recorded_at);
