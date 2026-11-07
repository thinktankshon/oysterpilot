# OysterPilot — Claude Code 作業指示

Built with Claude: Japan 2026（11/2 12:00 〜 11/8 20:00 JST。締切は当初 11/10 14:00 から前倒し）提出用プロダクト。
開発者は高畑1名。実装はこのリポジトリで Claude Code が行う。要件は `docs/` が正。迷ったら docs に従い、docs にないことは**最小の実装**を選んで `docs/99_decisions.md` に1行残す。

## 何を作るか（1行）

牡蠣養殖（シングルシード）を新しく始める人の3つの壁を、3つのAIで取り払う Web アプリ。
**Oyscan**（海を診る・PC）→ **Voysy**（海で記録する・スマホ）→ **AI Oysterman**（記録を読んで次の作業を助言・チャット）。
3つは1つの記録台帳（D1）でつながる。デモの核は Voysy の「船上で喋る」実写。

## 絶対に守ること

1. **11/8 20:00 JST に動いているものがすべて。** 完成度より「3分のデモが止まらず通る」を優先する。
2. **スコープは `docs/00_overview.md` の「やらないこと」を守る。** 追加機能を提案しない。
3. **LLM は Claude API のみ**（`claude-sonnet-5-5` を既定、抽出だけ `claude-haiku-5-5` 可）。API キーは Workers の secret。フロントに置かない。
4. **データは合成サンプルとオープンデータのみ。** 実在の漁場名・実績データ・既存システム（Oysmart）の画面やAPIを出さない。
5. **出典表示**：気象庁データと地理院タイルを使う画面・レポートには出典と「株式会社リブル加工」を表示する（文言は `docs/03_oyscan.md`）。
6. **断定しない言い回し**：高水温と斃死は「増えやすい時期」まで。「死にます」「必ず」は使わない。予測モデルとは言わない。
7. **用語**：かご分け→「分殖」、場所→「沖出し場所」。`config/glossary.yaml` の表記に統一。
8. **日本語UI**。文字は大きく（スマホで 18px 以上、ボタンは 56px 以上）。濡れた手・船上で押せること。

## 技術スタック（決定済み・変えない）

| 層 | 採用 | 理由 |
|---|---|---|
| フロント | Vite + React（TypeScript）、1つの SPA に3画面（`/scan` `/voysy` `/oysterman`） | 1人で保守できる最小構成 |
| ホスティング | Cloudflare Pages（フロント）＋ Workers（API, Hono）＋ D1（SQLite） | `*.pages.dev` で最初から HTTPS（マイクに必須）。DNS 作業不要 |
| DB | D1。スキーマは `docs/04_data_model.md` | |
| LLM | Anthropic API（Workers から呼ぶ）。構造化出力は tool use / JSON | |
| 音声→文字 | **ブラウザの Web Speech API（iPhone Safari）** を第一候補。結果は編集可能なテキストとして表示してから Claude に渡す | サーバー不要・追加ベンダー不要。11/2 に実機で検証。だめなら `docs/01_voysy.md` の代替案B |
| 地図 | MapLibre GL JS ＋ 地理院タイル（標準地図 or 淡色地図） | 出典明記のみで申請不要 |
| 環境データ | 気象庁「日本沿岸域の海面水温情報」海域 **623 周防灘**（CSV・商用可・登録不要） | `docs/03_oyscan.md` |

ローカル開発は `wrangler dev` ＋ Vite。スマホ実機確認は `cloudflared tunnel` か Pages のプレビュー URL。

## リポジトリ構成（この形にする）

```
/
  CLAUDE.md
  README.md                 ← 提出用（日英）。製品の説明・ルール表・データと出典・セットアップ
  docs/                     ← 要件（正）
  config/rules.yaml         ← AI Oysterman / Oyscan のルールと閾値（コードに埋めない）
  config/glossary.yaml      ← 用語集・作業規律（システムプロンプトに注入）
  prompts/                  ← Claude に渡すプロンプト本文（コードから読み込む）
  data/seed_records.csv     ← D1 初期投入データ
  apps/web/                 ← Vite + React
  apps/api/                 ← Hono on Workers（D1 バインディング、Anthropic 呼び出し）
  scripts/                  ← seed 投入、JMA データ取得、D1 マイグレーション
```

## 作業の進め方

- 着手順は **Voysy → AI Oysterman → Oyscan**。前の画面が実機で動いてから次に進む。
- 1日の終わりに必ず **デプロイして実機（iPhone）で触る**。動いた画面は iPhone の画面収録で残す（動画素材・保険）。
- 各画面に「完成の定義」がある（各 docs の末尾）。それを満たしたら次へ。満たせない見込みなら、同じ docs の「縮退案」に落とす。
- テストは最小限（抽出の JSON スキーマ検証、ルール評価の単体テスト）。E2E は手動。
- コミットは小さく、日本語でよい。秘密情報（API キー、`.dev.vars`）はコミットしない。

## 禁止

- Oysmart など既存システムへの接続・言及
- 機械学習・画像解析・推移グラフ・オフライン同期・ユーザー認証（簡易な共有パスワード1つは可）
- 実在する漁場の座標をデフォルト位置にすること（中津沖の少し離れた点を使う。`docs/03_oyscan.md`）
- `config/rules.yaml` の閾値をコードにハードコードすること
