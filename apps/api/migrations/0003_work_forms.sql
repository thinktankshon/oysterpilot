-- 作業別の型（選別・沖出し・陸揚げ）: 場所は 漁場・レーン・間（から〜まで）、選別の付帯項目
ALTER TABLE records ADD COLUMN farm TEXT;            -- 漁場（例: D）
ALTER TABLE records ADD COLUMN lane INTEGER;         -- レーン番号
ALTER TABLE records ADD COLUMN ma_from INTEGER;      -- 間（から）
ALTER TABLE records ADD COLUMN ma_to INTEGER;        -- 間（まで）
ALTER TABLE records ADD COLUMN basket_type TEXT;     -- かごの種類（例: 15L, 25L）
ALTER TABLE records ADD COLUMN shell_state TEXT;     -- 刃先が伸びている / ツルツル / 普通
ALTER TABLE records ADD COLUMN meat_quality TEXT;    -- 良 / 普 / 悪
ALTER TABLE records ADD COLUMN fouling INTEGER;      -- 付着物 1=あり 0=なし
ALTER TABLE records ADD COLUMN workers INTEGER;      -- 作業人数
ALTER TABLE records ADD COLUMN duration_min INTEGER; -- 作業時間（分）
ALTER TABLE records ADD COLUMN purpose TEXT;         -- 陸揚げの目的: 選別 / 出荷 / 移動
