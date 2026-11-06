# 05. デモ動画と提出物

## 提出物（11/8 20:00 JST まで。目標 11/8 12:00 提出完了。※11/3 に締切前倒しが判明）

| 提出物 | 形式 | 備考 |
|---|---|---|
| GitHub リポジトリ | 公開、`thinktankshon/oysterpilot`、MIT ライセンス | README 日英。秘密情報なし。`config/rules.yaml` は含める |
| デモ動画 | 3分、16:9、YouTube 限定公開 | 日本語音声＋英語字幕。README 冒頭にリンク |
| 公開 URL | `https://oysterpilot.oysterpilot-api.workers.dev` | 共有パスワードは提出フォームに書く（README には書かない） |
| 説明文 | 提出フォーム用に 200字／400字／英語 100 words の3種を README から抜粋して用意 | 形式が分かり次第調整 |

提出形式が公式に示されたら、この表を更新する。

## 提出物の現在地（11/5 更新）

| 提出物 | 状態 | 残り |
|---|---|---|
| GitHub リポジトリ | 公開済み（`thinktankshon/oysterpilot`、MIT、README 日英） | 動画リンクとスクリーンショット 3 枚を README に追記。`git grep` で実名・秘密情報の最終確認 |
| 公開 URL | 稼働中（workers.dev、共有パスワード） | Oyscan の海域の点が本番で出ない不具合（MapLibre の worker ファイルが配信されない）を直して再デプロイ。11/6 の画面収録前に本番 DB を seed に戻す |
| デモ動画 | 下書き v1 を `video/oysterpilot_draft_v1.mp4` に作成（画面収録 B・C7〜C9・D は実物、実写はカード） | 実写（A1〜A3・C1〜C6・F1〜F2）の差し替え、ナレーション収録、字幕の調整、YouTube 限定公開 |
| 画面収録の素材 | `video/clips/`（Oyscan PC、Voysy 陸でチェック、AI Oysterman。各 markers.json に操作時刻） | iPhone の作業セッション（C2・C4・C6）は机上で 4 文を喋って撮る（船は不要） |
| スクリーンショット | `video/shots/`（oyscan / voysy / oysterman） | `docs/assets/` に移して README に貼る |
| 説明文 | 200 字／400 字／英語 100 words を本書に用意済み | 提出フォームの項目が分かり次第、長さを合わせる |

`video/` は動画と素材の置き場（Git には入れない。`.gitignore` に追加予定）。

主催者の公式な提出形式は未確認（Web 検索では参加者の公開メモしか見つからず。それによると提出物は「プロジェクト概要・3 分のデモ動画・公開リポジトリ」、審査は Impact 30%・Demo 25%・Claude の使い方 25%・深さと実行 20%）。Cerebral Valley のイベントページで確認する。

## 動画（3分）の台本

| 時間 | シーン | 映像 | ナレーション（高畑）要旨 |
|---|---|---|---|
| 0:00–0:20 | 導入 | 中津の海（ドローン不要、堤防や船からの実写）→ タイトル | 牡蠣は餌も淡水も要らないタンパク質。でも、新しく始める人の前には3つの壁がある：判断できない、記録が残らない、相談相手がいない |
| 0:20–0:50 | Oyscan | PC 画面収録。地図でピン→指標3つ→所見 | 1つ目。地図で海を選ぶと、気象庁の水温から「成長しやすい期間」「高水温のリスク」が分かる。専門家に聞く前に、自分で当たりをつけられる |
| 0:50–1:30 | Voysy（船上） | **実写**：船上、濡れた手で「作業開始」を1回→作業しながら喋る→「次のロット」で区切りが増える→「記録終了」。陸：一覧→整理→表→保存 | 2つ目。海では喋るだけ。確認は陸で。Claude が作業・場所・サイズ・斃死を整理して、足りないことは聞き返す |
| 1:30–2:20 | AI Oysterman | スマホ or PC 画面収録。デモ会話（`02_ai_oysterman.md`）を実演 | 3つ目。記録と水温を読んで、現場の先輩のルールで次の作業を提案する。分からないことは分からないと言って、人につなぐ |
| 2:20–2:45 | つながり | 3画面を並べた図（README の図を流用） | 3つは1つの記録でつながる。診る→記録する→学ぶ、を1人で回せる |
| 2:45–3:00 | なぜ作ったか | 高畑、海を背景に顔出し | 2018年から人の手でやってきた立ち上げ支援を、AIで誰でも受けられるようにしたい。株式会社リブル |

- 字幕：日本語ナレーションの文字起こしを Claude で英訳し、焼き込み（CapCut / iMovie / DaVinci Resolve のいずれか）。
- BGM はフリー素材か無し。権利表記が要るものは使わない。
- 画面収録は毎日の作業終わりに撮っておく（iPhone：コントロールセンターの画面収録／Mac：Cmd+Shift+5）。撮影当日にアプリが不調でも素材が残る。

## 撮影（11/5 は出航できず。11/6 に様子を見て出航、無理なら 11/7 午前、それも無理なら岸壁の縮小版）

> カット表・画面収録の手順・当日の時間割・準備チェックは `07_shooting_plan.md` に詳細版がある。以下は要点。

- 高畑が iPhone で撮影。中津チームに船とハンドリング作業の協力を依頼済み（前提）。
- 船上シーン：①「作業開始」を押す手元（濡れた手）、②作業しながら喋っている横顔＋固定した iPhone の画面、③「次のロット」で区切り数が増えるアップ、④「記録終了」。陸：⑤一覧→整理→保存の瞬間。各2テイク。iPhone は見える位置に固定し画面は点けたまま（Wake Lock）。
- 風切り音対策：iPhone のマイクを手で覆わない、風下を向く。音声は後で字幕で補える。
- 電波が弱ければ、船上は録音ボタン→文字まで撮り、保存は岸で撮ってつなぐ（VO-06 で消えない）。
- 海・貝・かごの素材（B-roll）を10カットほど撮る（導入とつなぎに使う）。

## README の骨子（日英）

1. タイトル／1行説明／動画リンク／公開 URL（パスワード）
2. 解く課題（3つの壁）と理想（出典：Gephart 2021、水産白書）
3. 3つのアプリ（スクリーンショット各1枚）とつながりの図
4. AI Oysterman のルール表（`config/rules.yaml` の要約）と、なぜルール＋Claude にしたか（ルールは人が読めて直せる。数字の判断は LLM に任せない）
5. 使ったデータと出典（気象庁 623 周防灘、地理院タイル）。注意書き（海域平均・実績値、水温のみ、安全は県に確認）
6. 技術構成（Cloudflare Pages/Workers/D1、Claude API、Web Speech API）
7. セットアップ手順（`wrangler`、secrets、seed）
8. 1週間で割り切ったこと／今後の展開（推移グラフ、塩分・安全性の診断、全国対応、音声での相談）
9. 作者：高畑 拓弥（株式会社リブル 取締役・経営企画室長）。ライセンス MIT

## 提出前チェック（11/7 夜〜11/8 午前）

- [ ] 公開 URL で3画面がスマホ・PC両方で動く（別端末・別回線で確認）
- [ ] デモ会話が3回連続で期待どおり
- [ ] リポジトリに秘密情報・実データ・実在漁場名がない（`git grep` で `Oysmart`、`中津②`、`那佐`、`浅川` などを確認）
- [ ] 出典表示が Oyscan 画面・レポート・README にある
- [ ] README の英語版が通して読める
- [ ] 動画の音量・字幕・3分以内
- [ ] 提出フォームの必須項目を一度下書きしておく

## 提出フォーム用の説明文（案・11/3 更新）

**200 字**
牡蠣養殖を新しく始める人の前にある「判断できない・記録が残らない・相談相手がいない」の3つの壁を、Claude を組み込んだ3つの道具で取り払います。Oyscanは日本の海をクリックすると気象庁の水温と雨量から斃死リスクと成長スピードを診断。Voysyは船上で喋り続けるだけで、Claudeが作業記録に整理。AI Oystermanは記録・水温・現場のルールと知識を読み、伴走者として次の作業を提案します。

**400 字**
牡蠣は餌も淡水も要らない、環境負荷の低い動物性タンパク質です。しかし新しく始める人には3つの壁があります。その海で育つか判断できない、濡れた手と揺れる船では記録が残らない、シングルシード養殖は独特で相談相手がいない。OysterPilotはClaude を組み込んだ3つの道具で応えます。Oyscanは全国80の沿岸海域を地図に出し、気象庁の水温と雨量から斃死リスクと成長スピードを3段階で示し、Claudeが所見を書きます。Voysyは「作業開始」を1回押せば、あとは喋りながら作業するだけ。合図の言葉で区切った発話を陸でClaudeが作業・ロット・サイズ帯・斃死に整理し、足りない項目は聞き返します。AI Oystermanは記録と水温を読み、現場ルールをコードで判定し、リブルの見解と出典つきの知見を根拠に、伴走者として次の作業を提案します。数字の判断はLLMに任せず、ルールは人が読めて直せる形で残しました。

**English (100 words)**
OysterPilot removes three walls for people starting single-seed oyster farming: not knowing whether a sea will grow oysters, not being able to keep records with wet hands on a boat, and having no one to ask. Oyscan maps 80 coastal areas of Japan and rates mortality risk and growth speed from JMA water temperature and rainfall. Voysy lets farmers keep talking while they work; Claude turns the speech into structured records and asks about missing fields. AI Oysterman reads records and temperature, evaluates ten field rules in code, draws on Re:Blue's practice and cited knowledge, and answers as a companion.
