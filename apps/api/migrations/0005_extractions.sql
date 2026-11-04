-- Voysy の抽出結果（Claude が返した整理前の値）。人が直して保存した記録と突き合わせ、読み取りの崩れ方を検証する。
CREATE TABLE IF NOT EXISTS voysy_extractions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  segment_id INTEGER,          -- 区切りから来た場合（voice_segments.id）
  raw_text TEXT NOT NULL,      -- 整理に渡した文（陸で直したあとの文）
  result_json TEXT NOT NULL,   -- normalize 後の ExtractResult
  saved_at TEXT,               -- 記録として保存された時刻
  record_ids TEXT              -- 保存された records.id の JSON 配列
);
CREATE INDEX IF NOT EXISTS idx_voysy_extractions_saved ON voysy_extractions (saved_at);
