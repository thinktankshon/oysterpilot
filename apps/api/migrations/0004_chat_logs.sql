-- AI Oysterman の会話ログ。答えられなかった質問（範囲外・フォールバック）を後から一覧して知見を足すために残す。
-- 個人情報は入れない（質問文と返答だけ）。提出前に seed へ戻すときは一緒に消す。
CREATE TABLE IF NOT EXISTS chat_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  question TEXT NOT NULL,
  reply TEXT NOT NULL,
  out_of_scope INTEGER NOT NULL DEFAULT 0,
  out_of_scope_summary TEXT,
  basis TEXT,            -- 根拠行（読点区切り）
  fired_rules TEXT,      -- 成立したルール ID（JSON 配列）
  turn_count INTEGER NOT NULL DEFAULT 1,
  fallback INTEGER NOT NULL DEFAULT 0,  -- 固定文で返した（禁止語の言い直し失敗・空返答）
  seconds REAL
);
CREATE INDEX IF NOT EXISTS idx_chat_logs_created ON chat_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_logs_oos ON chat_logs (out_of_scope, created_at DESC);
