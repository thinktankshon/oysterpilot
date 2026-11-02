# OysterPilot

牡蠣養殖（シングルシード）を新しく始める人の3つの壁を、3つのAIで取り払う。
**Oyscan**（海を診る）→ **Voysy**（喋るだけで記録）→ **AI Oysterman**（記録を読んで次の作業を助言）

> Built with Claude: Japan 2026 提出作品（2026-11-02 〜 11-10）。
> このファイルは提出前（11/9）に `docs/05_demo_and_submission.md` の骨子に沿って書き直す。

- デモ動画：（11/8 に追記）
- 公開 URL：https://oysterpilot.oysterpilot-api.workers.dev （共有パスワードは提出時に記載）
- 作者：高畑 拓弥（株式会社リブル）

## 開発者向け

要件は `docs/`、Claude Code への指示は `CLAUDE.md`、ルールは `config/rules.yaml`。

構成：`apps/web`（Vite + React）、`apps/api`（Hono on Cloudflare Workers、D1、フロントも同じ Worker から配信）、`scripts/`（seed・データ取得）。

```
pnpm i
cp apps/api/.dev.vars.example apps/api/.dev.vars   # ANTHROPIC_API_KEY, DEMO_KEY（ローカルは空でも可）
pnpm -C apps/api d1:migrate:local && pnpm -C apps/api seed:local
pnpm dev                                             # web(5173) + api(8787)。/api は Vite が 8787 へ中継
```

デプロイ（初回は `wrangler login` → `pnpm -C apps/api d1:create` → `wrangler.jsonc` の `database_id` を置換）：

```
pnpm -C apps/api d1:migrate && pnpm -C apps/api seed
pnpm -C apps/api exec wrangler secret put ANTHROPIC_API_KEY
pnpm -C apps/api exec wrangler secret put DEMO_KEY
pnpm deploy
```
