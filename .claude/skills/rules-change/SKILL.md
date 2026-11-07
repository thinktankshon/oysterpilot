---
name: rules-change
description: OysterPilot のルール表（config/rules.yaml）、用語集（config/glossary.yaml）、リブルの知見（knowledge/reblue_views.md）を足す・変えるときの手順書。閾値や say の文言を変える、聞き取りの内容を反映する、新しいルールを足すときに読む。
---

# rules-change — ルール表・用語集・知見を変えるときの手順

AI Oysterman は「数字の判断はルール表をコードで判定し、Claude は言い回しだけ」という作り。だからルール表の 1 行は、プロンプトの 1 行より影響が大きい。
変更は CLAUDE.md のとおり 4 点セット → GO のあとで行い、ここに書いた順で確認する。言い回しは `oyster-glossary` スキルに従う。

## 1. どこを変えるかを先に決める

| 変えたいもの | 正本 | 同期が要る場所 |
|---|---|---|
| 閾値・成立条件・say の文言 | `config/rules.yaml` | `apps/api/src/rules.ts`（id を参照）、`rules.test.ts`、README の R1〜R10 の表、`docs/02_ai_oysterman.md` |
| Oyscan の段階の閾値 | `config/rules.yaml` の `oyscan` | `apps/api/src/scan.ts`（キー名）、`docs/03_oyscan.md` |
| 用語・言い回し | `config/glossary.yaml` | `.claude/skills/oyster-glossary/SKILL.md` の表、`prompts/*.md` |
| リブルの見解（聞き取り） | `knowledge/reblue_views.md` | 「ルール表への反映候補」の表 → 承認後に `rules.yaml` |
| 一般論の Q&A | `knowledge/general_qa.md` | `tests/oysterman_eval/cases.json` に評価ケースを足す |

- 聞き取りで得た内容は、まず `reblue_views.md` の該当の批（回）に書き、数字の変更は末尾の「ルール表への反映候補」の表に載せる。**高畑の承認が出るまで `rules.yaml` に入れない**（推測で埋めない。CLAUDE.md Rule 2）。
- 用語の定義が `glossary.yaml` に無い語は、意味を推測せず高畑に確認する。

## 2. 変えたあとの確認（この順）

```bash
pnpm test                 # apps/api の node --test。rules.test.ts / lot.test.ts / voysyDiff.test.ts
pnpm typecheck
```

- `rules.test.ts` は、成立するルールの id だけでなく、`say` や `ask_first` の**文言を文字列一致**で見ている箇所がある（11 箇所）。言い回しを変えると落ちるのは正常で、テストの期待値を新しい文言に合わせて直す。閾値を変えたときは、境界値のテスト（例：R3 は 15 日未満で出ない）を見直す。
- 次に **`rules-reviewer` サブエージェント**を走らせる（Agent ツールで `subagent_type: rules-reviewer`）。閾値同士の矛盾、R3/R7 の等号、R5/R6 の優先、プレースホルダ、禁止語、docs とのずれを読むだけで報告する。報告の「重大」は直してから進む。「要確認（高畑）」は推測で埋めず、そのまま高畑に聞く。
- 会話の中身を変えたときは `pnpm eval`（会話評価。ローカル API を起動しておく）。禁止語（死にます・必ず・予測・安全です・最適です）が 0、範囲外の判定が期待どおり、であること。

## 3. 同期する文書

- README の「10 のルール」の表（R1〜R10 の要旨）と `docs/02_ai_oysterman.md` のルール説明を、yaml と同じ内容にする。英語の README 部分も同様。
- `docs/99_decisions.md` に 1 行（日付、何を、なぜ、誰の判断か）。
- `rules.yaml` 冒頭の `version` を更新する（日付＋枝番。例：`2026-11-02b`）。

## 4. 本番に出す

`rules.yaml` と `knowledge/*.md` は Worker に焼き込まれるので、変更後は再デプロイが要る。手順は `prod-ops` スキル。

## 5. 書き方の決まり（say に入れる文）

- 断定しない。「目安です」「厳守ではありません」を添える。将来の値を言わない。
- 出どころを言う：ルール表の数字は「目安」、現場の話は「リブルの現場では」、文献は「〜と報告されている」。
- 斃死の原因を一つに決めない。範囲外（病気・衛生・貝毒・価格・法規・薬）は専門家へ誘導する文にする。
- プレースホルダは `rules.ts` の `fire()` が埋めるものだけ使う：`{days}` `{effective_sort_interval}` `{basket_kg_target}` `{avg_weight_g}` `{count_target}` `{mortality_pct}`。それ以外は文にそのまま残る。
