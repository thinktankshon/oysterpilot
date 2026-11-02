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
