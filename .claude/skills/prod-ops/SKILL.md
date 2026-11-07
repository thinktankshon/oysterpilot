---
name: prod-ops
description: OysterPilot の本番運用の手順書。デプロイ、migration、seed、本番 D1 の件数確認と初期化（審査員が触ったあとに seed へ戻す）、デプロイ後の疎通確認をするときに読む。秘密情報の扱いも含む。
---

# prod-ops — 本番運用の手順

本番は Cloudflare Workers（`oysterpilot`）と D1（`oysterpilot`）。URL は `https://oysterpilot.oysterpilot-api.workers.dev`。
ここに書いてあるのは、実際に打って動いたコマンドと、実際につまずいた点だけ。手順を変えたら、このファイルも直す。

本番に触る操作（デプロイ・migration・seed・初期化）は、CLAUDE.md のとおり 4 点セット → GO のあとで行う。

## 1. デプロイ

```bash
pnpm test                      # 単体テスト（node --test）
pnpm typecheck
pnpm -C apps/api d1:migrate    # migrations/ に新しいファイルがあるときだけ。デプロイより先に
pnpm deploy                    # = pnpm build && pnpm -C apps/api deploy
```

- `config/rules.yaml`・`config/glossary.yaml`・`knowledge/*.md`・`prompts/*.md` は Worker に文字列として焼き込まれる（`wrangler.jsonc` の Text ルール）。文面だけ変えても、再デプロイしないと本番は変わらない。
- `pnpm deploy` は web のビルドを含む。api だけ直したときも同じコマンドでよい。

## 2. デプロイ後の疎通確認

```bash
U=https://oysterpilot.oysterpilot-api.workers.dev
curl -s -o /dev/null -w 'health: %{http_code}\n' $U/api/health            # 200
curl -s -o /dev/null -w 'no key: %{http_code}\n' $U/api/segments          # 401（共有パスワードなしは拒否）
W=$(ls apps/web/dist/assets | grep worker) && curl -s -o /dev/null -w 'maplibre worker: %{http_code} %{content_type}\n' "$U/assets/$W"   # 200 で JS
```

- 3 つ目は 2026-11-05 の不具合の再発確認。MapLibre の Worker ファイルが配信されないと、Oyscan の海域の点（GeoJSON 層）だけが消える。タイルとクリック診断は動くので、画面を見ただけでは気づきにくい。
- 画面で確認するときは、Oyscan は PC、Voysy は iPhone Safari。共有パスワードは初回に 1 度聞かれ、localStorage に残る。

## 3. 本番 D1 の件数確認

```bash
cd apps/api
for q in "select count(*) n from records where source='seed'" \
         "select count(*) n from records where source!='seed'" \
         "select count(*) n from voice_segments" \
         "select count(*) n from voice_segments where status='draft'" \
         "select count(*) n from voysy_extractions" \
         "select count(*) n from chat_logs" \
         "select count(*) n from reservations"; do
  printf '%s -> ' "$q"; npx wrangler d1 execute oysterpilot --remote --json --command "$q" 2>/dev/null | grep '"n"' | tr -d ' '
done
```

- **表ごとに 1 クエリ**にする。`UNION ALL` で 6 表をまとめると D1 が「too many terms in compound SELECT」で失敗する（2026-11-06 に遭遇）。
- macOS に `timeout` コマンドはない。付けると `command not found` で止まる。
- `--json` で受けて `grep` する。素の出力は表形式で、機械的に読みにくい。
- 初期状態の目安：seed の records 8 件、確認待ち（draft）の区切り 2 件、その他 0 件。

## 4. 初期化（審査員・試用者が記録を増やしたあと、seed に戻す）

消すもの：予約、会話ログ、Voysy の読み取り結果、区切り、seed 以外の記録。残すもの：seed の記録（`source = 'seed'`）。
そのあと「陸でチェック」に出る確認待ちの区切りを 2 件入れ直す（デモ動画と同じ文）。

```bash
cd apps/api
TS=$(TZ=Asia/Tokyo date +%Y-%m-%dT%H:%M:%S+09:00)   # recorded_at は JST の ISO 形式（API の jstNowIso と同じ）
SID="demo-$(date +%s)"
npx wrangler d1 execute oysterpilot --remote --json --command "DELETE FROM reservations; DELETE FROM chat_logs; DELETE FROM voysy_extractions; DELETE FROM voice_segments; DELETE FROM records WHERE source != 'seed'; INSERT INTO voice_segments (session_id, seq, recorded_at, raw_text) VALUES ('$SID', 1, '$TS', 'R8のK3、陸揚げ。D漁場 5レーン 5間目から12間目、10かご、選別のため'); INSERT INTO voice_segments (session_id, seq, recorded_at, raw_text) VALUES ('$SID', 2, '$TS', 'R8のK3、選別。30グラム60個入り10かご 15リットル、40グラム50個入り30かご 25リットル。死んだのは12個。刃先が伸びてる。付着物あり');" 2>&1 | grep -E '"success"|"changes"|error'
```

- 実行前に 3. で件数を取り、何件消えるかを GO の材料にする。実行後にもう一度 3. で検証して、結果を数字で報告する。
- seed の記録そのものを入れ直すときは `pnpm -C apps/api seed`（`data/seed_records.csv` → `.seed.sql` → 本番へ。`.seed.sql` は gitignore）。通常の初期化では不要。
- ローカル D1 は `pnpm -C apps/api d1:migrate:local` と `seed:local`。本番とは別物で、`--local` を付け忘れると本番に当たる。

## 5. 秘密情報

- `ANTHROPIC_API_KEY` と `DEMO_KEY`（共有パスワード）は `pnpm -C apps/api exec wrangler secret put <NAME>` だけで置く。ローカルは `apps/api/.dev.vars`（gitignore 済み）。
- 値を、このファイル・docs・README・コミットメッセージ・コマンドの出力・会話に書かない。`.dev.vars` を cat しない。
- コミット前フック（`.githooks/pre-commit`）が、`sk-ant-` で始まる文字列と、共有パスワードの変数名に値を直書きした行を止める。共有パスワードそのものは形で検出できないので、人が気をつける。
- 共有パスワードを審査員以外に渡す必要が出たら、`wrangler secret put DEMO_KEY` で新しい値に替える。フロントは次回アクセス時に聞き直す。

## 6. 落とし穴の一覧（短く）

| 事象 | 対処 |
|---|---|
| 複合 SELECT が失敗 | 表ごとに 1 クエリ |
| `timeout: command not found` | macOS には無い。付けない |
| 文面を変えたのに本番が変わらない | yaml / md は焼き込み。再デプロイ |
| 海域の点だけ出ない | MapLibre worker 資産の 200 を確認（2. の 3 つ目） |
| `--local` 忘れ | 本番に当たる。コマンドを打つ前に見直す |
| bash 3.2 で `$(cat <<EOF)` のコミットが失敗 | `git commit -q -F - <<'EOF'` を使う |
