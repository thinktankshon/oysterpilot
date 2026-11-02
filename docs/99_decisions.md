# 99. 決定ログ

Claude Code が docs にない判断をしたら、ここに1行で追記する（日付・判断・理由）。

- 2026-11-02 単独開発に変更（パートナー不選考）。ホスティングを AWS 案から Cloudflare Pages/Workers/D1 に変更。理由：HTTPS が最初から付きマイクが使える、DNS 作業不要、高畑の既存スタック
- 2026-11-02 音声→文字はブラウザ Web Speech API を第一候補。理由：ベンダー追加なし。11/2 実機検証で判断
- 2026-11-02 `config/rules.yaml` はリポジトリに含める。理由：一般的な閾値のみで、モデル本体・係数を含まない（高畑 10/26 判断）
- 2026-11-02 推移グラフ・オフライン同期・安全性診断・貝毒・塩分・漁具推奨は作らない（10/25〜26 決定を踏襲）
- 2026-11-02 Oyscan の最後の導線は「AI Oysterman に引き継いで相談する」のみ。人への相談は AI Oysterman 内の [専門家に相談する]
- 2026-11-02 デモ海域は周防灘（気象庁 623）、ピンは実在漁場を避けた中津沖の点
- 2026-11-02 Claude API は音声入力に非対応と確認（Files API の対応形式は PDF・テキスト・画像のみ）。音声→文字は Web Speech API を第一候補のまま進める。代替案B は MediaRecorder＋外部 STT
- 2026-11-02 配信は Cloudflare Workers の Static Assets（フロントと API を同一 Worker・同一オリジン）。Pages ではなく Workers を使う。理由：CORS 不要・デプロイ1回・`wrangler dev` 1本でローカル完結。公開 URL は `oysterpilot.<account>.workers.dev`（HTTPS・マイク可）。Pages に戻すのは容易
- 2026-11-02 画面遷移は react-router を入れず `pathname` の3分岐で実装（3画面のみ）。SPA フォールバックは Workers assets の `single-page-application`
- 2026-11-02 共有パスワードは `DEMO_KEY` 未設定（ローカル）なら認証なし。設定時は `X-Demo-Key` が一致しない API 呼び出しを 401 にし、フロントは 401 で入力を促して localStorage に保持
- 2026-11-02 seed は `scripts/seed.ts` が CSV から SQL を生成し `wrangler d1 execute --file` で投入（`source='seed'` を一度消してから入れ直すので何度でも実行可）。Node 26 の TS 直接実行を使い、ビルド不要
- 2026-11-02 パッケージ管理は pnpm 12（`minimumReleaseAge` により公開1日未満の版は拒否されるため wrangler / workers-types は固定版）
- 2026-11-02 公開 URL は `https://oysterpilot.oysterpilot-api.workers.dev`（Cloudflare アカウントの workers.dev サブドメインが `oysterpilot-api`）。D1 `oysterpilot`（APAC）作成・スキーマ・seed 投入済み
- 2026-11-02 Voysy の構造化は tool use ではなく Claude の構造化出力（`output_config.format` = JSON Schema）で強制する。tool 強制（`tool_choice`）は新しいモデルで非対応のため。モデルは `claude-haiku-5-5`、thinking off・effort low（実測 1.4〜2.6 秒）。
- 2026-11-02 `prompts/voysy_extract.md` と `config/glossary.yaml` は wrangler の Text ルールで Worker に文字列 import し、プロンプトの正本をファイルのまま使う（コードに複製しない）。
- 2026-11-02 `/api/voysy/extract` はモデル出力を検証したうえで、null の項目を必ず `missing` に加える（確認表示の抜け防止）。`notes` は発話者の言葉なので断定表現フィルタの対象外。`notes` は records に列がないため保存せず、`raw_text` に全文として残す。
- 2026-11-02 整理（Claude 呼び出し）が失敗しても記録は残せるよう、確認画面に「手で入力して保存」を置く。未送信（VO-06）はネットワーク断と 5xx のみ対象、4xx は再送しない。
- 2026-11-02 Voysy の主役は「作業セッション」に変更（高畑の実機確認後の判断）。海では「作業開始」1 タップのみで、合図語（`config/voice_cues.json`）で区切り、区切りごとの生の文を `voice_segments` に即保存（Claude は呼ばない）。整理・確認・保存は陸で行う。従来の 1 件ずつの流れは「1件だけ記録」として残す
- 2026-11-02 Web（iPhone Safari）の制約として、開始の 1 タップと画面点灯（Wake Lock）は必須。言葉だけでの開始・ポケットでの常時認識はネイティブアプリの範囲として README「今後の展開」に書く
- 2026-11-02 合図語は JSON（`config/voice_cues.json`）に置く。理由：Web と Worker の両方が追加ライブラリなしで読める。日常の言い回しと被る短い語（「次」「ここまで」）は誤検出を避けるため入れない。現場の言い方は高畑確認待ち
- 2026-11-02 `records.notes` 列を追加（移行 0002）。確認表の「メモ」は編集可にし、誤読をそのまま残さない。区切りの結合・分割は専用機能を作らず、陸の一覧で文を直す・削除することで代替
