# OysterPilot

牡蠣養殖（シングルシード）を新しく始める人の3つの壁を、3つのAIで取り払う。
**Oyscan**（海を診る）→ **Voysy**（喋るだけで記録）→ **AI Oysterman**（記録を読んで次の作業を助言）

> Built with Claude: Japan 2026 提出作品（2026-11-02 〜 11-10）。
> このファイルは提出前（11/9）に `docs/05_demo_and_submission.md` の骨子に沿って書き直す。

- デモ動画：（11/8 に追記）
- 公開 URL：（11/5 に追記）
- 作者：高畑 拓弥（株式会社リブル）

## 開発者向け

要件は `docs/`、Claude Code への指示は `CLAUDE.md`、ルールは `config/rules.yaml`。

```
pnpm i
cp apps/api/.dev.vars.example apps/api/.dev.vars   # ANTHROPIC_API_KEY, DEMO_KEY
pnpm -C apps/api d1:migrate && pnpm -C apps/api seed
pnpm dev                                             # web + api
```
