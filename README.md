# OysterPilot

**牡蠣養殖（シングルシード）を新しく始める人の前にある 3 つの壁を、3 つの AI で取り払う。**
Oyscan（海を診る）→ Voysy（海で記録する）→ AI Oysterman（海から学ぶ）

[English](#english)

- デモ動画：（11/8 に追記）
- 公開 URL：https://oysterpilot.oysterpilot-api.workers.dev （共有パスワードは提出フォームに記載）
- 作者：高畑 拓弥（株式会社リブル 取締役・経営企画室長）
- Built with Claude: Japan 2026 提出作品（2026-11-02 〜 11-10）

## 1. 解きたいこと

牡蠣は餌も淡水も要らない動物性タンパク質で、養殖二枚貝は水産物の中で環境負荷が最も低い部類に入ります（Gephart et al. 2021, *Nature*）。一方で漁業就業者は 2023 年に約 12.1 万人、約 4 割が 65 歳以上（水産白書）。使われていない漁場と担い手を求める自治体があり、新しく始める人が沿岸の仕事になります。

その人の前に 3 つの壁があります。

1. **判断できない** … その海で育つか、始める前に分からない。適地評価は専門家頼み。
2. **記録が残らない** … 濡れた手・揺れる船で入力できない。記録が途切れると助言もできない。
3. **相談相手がいない** … シングルシード養殖は独特で、一般の AI では答えにならない。

株式会社リブルは 2018 年から、牡蠣養殖の立ち上げ支援を人の手でやってきました。OysterPilot はそれを AI で誰でも受けられる形にする試みです。

## 2. 3 つのアプリ

| | Oyscan（海を診る） | Voysy（海で記録する） | AI Oysterman（海から学ぶ） |
|---|---|---|---|
| 一言 | 地図で海を選ぶと、水温から診断が出る | 船上で喋ると、記録に変わる | 作業の合間に、隣の先輩に聞くように相談する |
| 使う人・端末 | 自治体・漁協の担当者／PC | 生産者／iPhone | 生産者／スマホ・PC |
| Claude の役割 | 集計値から所見を書く | 発話を項目に構造化する | 記録・水温・成立ルールを読んで言い回しと聞き返しを担う |

```
 Oyscan ──診断を引き継ぐ──▶ AI Oysterman ──作業予約──▶ Voysy の「今日の予定」
                                 ▲                          │
                                 └────── 記録台帳（D1）◀── 区切りごとの発話を保存
```

### Oyscan

地図（地理院タイル）で周防灘の地点をクリックすると、気象庁の海面水温から 3 つの指標を即時に出し、Claude が 4〜6 文の所見を書きます。

- 高水温リスク（低／中／高）：28℃以上が 7 日以上続いた年が直近 5 年中に何年あったか
- 生育が鈍る期間：10℃未満の日数の年平均
- 成長しやすい期間：15〜25℃の日数の年平均
- 直近 7 日平均と、5 年統計の同日との差

所見は「AI Oysterman に引き継いで相談する」で渡せます。判定は水温のみ。塩分・流れ・水深は要現地測定、出荷の安全は都道府県の検査結果で確認、と画面に明記しています。

### Voysy

海では記録だけ、確認は陸で。「作業開始」を 1 回押せば、あとは喋りながら作業を続けられます。

- 「次のロット」などの合図語で記録を区切り、区切りごとの生の文をその場で保存（Claude は呼ばない。圏外なら端末に残して再送）
- 「記録終了」の言葉、またはボタンで止める
- 陸で「陸でチェック」を開くと、区切りごとの文を直し、「整理する」で Claude（`claude-haiku-5-5`、構造化出力）が作業・場所・ロット・サイズ・入数・斃死・かご数に整理。言っていない項目は赤で「確認：ロット番号は？」と出す
- 短い記録は「1件だけ記録」（録音→確認→保存）でも入れられる

音声認識はブラウザの Web Speech API（iPhone Safari）。Web アプリの制約で、最初の 1 タップと画面の点灯は必要です。

### AI Oysterman

「今日ってどの作業がいいかな？」「最近の水温ってどう？」「3番の貝、刃先が伸びてきた」。記録のある全場所と今日の予約、水温（5 年統計との差・季節区分）を読み、`config/rules.yaml` の 7 ルールをコード側で判定したうえで、Claude（`claude-sonnet-5-5`）が先輩の口調で答えます。判断に足りないことは 1 つだけ聞き返し、提案は「この作業を予約する」で Voysy の予定に書き戻します。ルールの範囲外（病気・衛生・販売など）は断定せず「先輩に聞く項目」に整理し、「専門家に相談する」を出します。

## 3. ルール表と、なぜ「ルール ＋ Claude」なのか

| ID | 条件 | 言うこと（要旨） |
|---|---|---|
| R1 | 28℃以上が 7 日以上 | 高水温が続いています。作業時間を短くして負担をかけない |
| R2 | 10℃未満が 7 日以上 | 生育が鈍る時期。選別の間隔を少し空ける（30 日 → 45 日） |
| R3 | 15〜25℃で、前回選別から 15 日以上 | かなり成長しているかも。殻の伸びや詰まりを見てみましょう |
| R4 | 選別・入数の話題 | 次の選別は 1 かご 2.0kg 目安（高水温期・成長期は 1.5kg、揺れを抑えたいとき 2.5kg） |
| R5 | 殻（刃先）が伸びている | 揺れが足りていない合図。揺れの強い場所へ、入数は薄めに |
| R6 | 殻がツルツル | 揺れが強すぎる合図。静穏な場所へ、入数を上げる |
| R7 | 前回選別から目安日数を超えた | 選別しましょう（R1 と同時なら「手早く」） |

閾値は `config/rules.yaml` にあり、コードに埋め込んでいません。**数字の判断は LLM に任せず**、コードが「いま成立しているルール」を決めてから Claude に渡します。Claude が担うのは、記録の数字を引用した言い回し、聞き返し、予約の構造化です。ルールは人が読めて直せる形で残し、「死にます」「必ず」「予測」のような断定は使わない方針をプロンプトとサーバー側の検査の両方で守っています。

## 4. 使ったデータと出典

- 気象庁「日本沿岸域の海面水温情報」海域 623 周防灘。日別（2016 年〜）と 5 年統計（平均・最高・最低）。`scripts/fetch_jma.ts` で取得して同梱し、実行時に気象庁へアクセスしません。
- 地図：国土地理院 地理院タイル（淡色地図）。
- 作業記録のサンプル（`data/seed_records.csv`）は合成データです。実在の漁場名・実績データは含みません。

> 出典：気象庁「日本沿岸域の海面水温情報」（海域 623 周防灘）を加工して株式会社リブル作成。水温は海域全体の平均値（実績値）で、湾奥の個別地点とは異なります。予報ではありません。
> 地図：国土地理院 地理院タイル。
> 本診断は水温のみに基づく参考情報です。出荷の安全（貝毒・衛生基準）は都道府県の検査結果でご確認ください。

## 5. 技術構成

- フロント：Vite + React（1 つの SPA、3 画面）。地図は MapLibre GL JS。音声は Web Speech API。
- API：Hono on Cloudflare Workers。フロントも同じ Worker から配信（Static Assets）。台帳は Cloudflare D1。
- Claude API：`claude-haiku-5-5`（Voysy の構造化、JSON Schema による構造化出力）、`claude-sonnet-5-5`（AI Oysterman の会話、Oyscan の所見）。予約と範囲外判定は tool use で構造化。API キーは Workers の secret にのみ置き、フロントに出しません。
- 共有パスワード：`X-Demo-Key` ヘッダ。審査用の簡易保護です。

## 6. セットアップ

要件は `docs/`、Claude Code への指示は `CLAUDE.md`、判断の記録は `docs/99_decisions.md`。

```
pnpm i
cp apps/api/.dev.vars.example apps/api/.dev.vars   # ANTHROPIC_API_KEY, DEMO_KEY（ローカルは空でも可）
pnpm -C apps/api d1:migrate:local && pnpm -C apps/api seed:local
pnpm dev                                             # web(5173) + api(8787)。/api は Vite が 8787 へ中継
pnpm test                                            # ルール判定の単体テスト
```

水温データの更新（任意）：`pnpm -C apps/api fetch:jma`

デプロイ（初回は `wrangler login` → `pnpm -C apps/api d1:create` → `wrangler.jsonc` の `database_id` を置換）：

```
pnpm -C apps/api d1:migrate && pnpm -C apps/api seed
pnpm -C apps/api exec wrangler secret put ANTHROPIC_API_KEY
pnpm -C apps/api exec wrangler secret put DEMO_KEY
pnpm deploy
```

## 7. 1 週間で割り切ったこと／今後の展開

割り切ったこと：対応海域は周防灘のみ、判定は水温のみ、認証は共有パスワード、会話履歴はブラウザ内だけ、周防灘の内外判定は矩形。

今後の展開：

- 完全ハンズフリー：言葉だけで録音を開始し、ポケットの中でも認識し続ける（ネイティブアプリの領域）
- 推移グラフ、塩分・流れ・安全性（貝毒・衛生）の診断、全国の海域への対応
- 音声での相談、作業規律の追加（ルール表を現場ごとに育てる）

## 8. ライセンス・作者

MIT License。高畑 拓弥（株式会社リブル）。

---

# English

**OysterPilot removes the three walls in front of people starting single‑seed oyster farming, with three AI tools.**
Oyscan (read the sea) → Voysy (record at sea) → AI Oysterman (learn from the sea)

- Demo video: (to be added)
- Live URL: https://oysterpilot.oysterpilot-api.workers.dev (shared password provided in the submission form)
- Author: Takuya Takahata (Director, Re:Blue Inc.)
- Entry for Built with Claude: Japan 2026 (Nov 2–10, 2026)

## Why

Oysters need no feed and no fresh water, and farmed bivalves are among the lowest‑impact animal proteins (Gephart et al. 2021, *Nature*). Japan had about 121,000 fishers in 2023, roughly 40% of them aged 65 or older (Fisheries White Paper). Unused fishing grounds and municipalities looking for newcomers exist. Yet a newcomer faces three walls: they cannot judge whether a sea will grow oysters, they cannot keep records with wet hands on a moving boat, and there is no one to ask about single‑seed farming, where generic AI does not help. Re:Blue has supported new oyster farms by hand since 2018. OysterPilot turns that support into something anyone can use.

## The three apps

| | Oyscan | Voysy | AI Oysterman |
|---|---|---|---|
| In one line | Click the sea on a map and get a water‑temperature diagnosis | Talk on the boat and it becomes a record | Ask like you would ask a senior farmer next to you |
| Who / device | Municipal or co‑op staff / PC | Farmers / iPhone | Farmers / phone or PC |
| Claude's role | Writes the findings from aggregated numbers | Structures speech into record fields | Phrases advice and asks one follow‑up question from records, temperature and fired rules |

**Oyscan.** Click a point in Suo‑nada on a GSI map. Three indicators appear instantly from JMA sea‑surface temperature: heat risk (years in the last five with 7+ consecutive days at or above 28°C), slow‑growth period (days below 10°C per year), and growth period (days at 15–25°C per year), plus the last 7‑day mean against the 5‑year statistics. Claude then writes a short finding, which can be handed to AI Oysterman. Temperature only; salinity, current and depth must be measured on site, and food‑safety clearance comes from the prefecture.

**Voysy.** Record at sea, review on land. Tap "Start work" once, then keep talking while you work. Cue words such as "next lot" split records; each segment's raw transcript is saved immediately (no LLM call; queued offline if out of range). Say "end recording" or tap to stop. On land, open "Review", fix the text if needed, and "Organize": Claude (`claude-haiku-5-5`, structured output) extracts work type, location, lot, size, count per basket, mortality and basket count, and flags anything not spoken in red ("Check: lot number?"). Speech runs on the browser's Web Speech API (iPhone Safari); one tap and a lit screen are required.

**AI Oysterman.** "What should I do today?", "How is the water lately?", "The shells on line 3 are growing thin edges." It reads every location's records, today's reservations and the temperature context (difference from the 5‑year mean, season band), evaluates the seven rules in `config/rules.yaml` in code, and Claude (`claude-sonnet-5-5`) answers in the voice of a senior farmer, asking at most one follow‑up question. Proposals can be reserved into Voysy's "today's plan". Out‑of‑scope topics (disease, hygiene, sales) are summarized as "questions for a senior" with a "consult an expert" button, never answered with certainty.

## Rules + Claude

Thresholds live in `config/rules.yaml`, not in code. Numeric judgment is never delegated to the LLM: code decides which rules fire, and Claude handles wording, follow‑up questions and structured reservations. Rules stay human‑readable and editable, and assertive phrasing ("will die", "always", "forecast") is banned by both the prompt and a server‑side check.

## Data and attribution

JMA "Coastal sea surface temperature" for area 623 (Suo‑nada), daily since 2016 and 5‑year statistics, fetched once by `scripts/fetch_jma.ts` and bundled (no runtime calls to JMA). Map tiles by the Geospatial Information Authority of Japan (GSI). Sample records in `data/seed_records.csv` are synthetic; no real farm names or performance data are included. The diagnosis is based on temperature only and is not a forecast.

## Stack

Vite + React SPA, MapLibre GL JS, Web Speech API; Hono on Cloudflare Workers serving the SPA as static assets; Cloudflare D1; Claude API (`claude-haiku-5-5` for extraction with JSON‑Schema structured output, `claude-sonnet-5-5` for conversation and findings, tool use for reservations). The API key lives only in Workers secrets. A shared password (`X-Demo-Key`) protects the demo.

## Setup

See the Japanese section above; the commands are identical (`pnpm i`, local D1 migrate and seed, `pnpm dev`, `pnpm test`, `pnpm deploy`).

## Trade‑offs and what's next

Scope was cut to one sea area, temperature‑only diagnosis, a shared password and in‑browser chat history. Next: fully hands‑free recording (voice‑triggered start, works in a pocket — a native app), trend charts, salinity/current/safety diagnostics, nationwide sea areas, and voice consultation.

MIT License. Takuya Takahata, Re:Blue Inc.
