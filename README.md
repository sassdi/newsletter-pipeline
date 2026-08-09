# newsletter-pipeline

Self-hosted Node.js replacement for the Make.com AI-newsletter ingestion
pipeline. Fetches unread newsletters from Gmail, extracts structured
insights via an LLM, embeds them, and stores everything in Supabase for the
downstream research web app.

Full design spec: [`docs/MIGRATION_PLAN.md`](docs/MIGRATION_PLAN.md).

## Architecture

```
node-cron (daily 08:00 UTC)
        │
        ▼
Gmail API — oldest 5 unread from The Batch + Mindstream
        │
        ▼
For each email:
  ├─ Insert into `newsletters` (gmail_message_id UNIQUE) → skip if duplicate
  ├─ OpenRouter (deepseek/deepseek-v4-flash) → extract structured insights
  ├─ Voyage AI (voyage-4-lite) → embed headline+summary per insight
  ├─ Insert into `insights`
  └─ Mark email as read (only after successful processing)
        │
        ▼
Write run summary → `run_logs`
```

## Status

- [x] Project scaffolded, core modules written (Gmail, extraction, embeddings, Supabase, orchestration)
- [x] Supabase schema migration applied ([`migrations/001_align_pipeline_schema.sql`](migrations/001_align_pipeline_schema.sql)) —
      `newsletters` has `gmail_message_id`/`from`/`body`, `run_logs` exists, indexes created.
      Preceded by a full `pg_dump` backup. `embedding` and the `text[]` array columns were
      verified already correct in production and left untouched (no data loss).
- [x] `.env` populated with real credentials (OpenRouter, Voyage, Supabase, Gmail OAuth)
- [ ] No live test run against Gmail/Supabase yet

## Setup

```bash
npm install
cp .env.example .env   # fill in real API keys and Gmail OAuth credentials
```

Gmail OAuth requires a one-time setup to obtain `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, and a `GOOGLE_REFRESH_TOKEN` with Gmail API scope
(`gmail.modify`, to allow marking messages as read) via the Google Cloud
Console OAuth consent flow.

## Running locally

```bash
npm run dev     # runs once immediately (RUN_ON_STARTUP=true), then stays scheduled
npm start       # cron-only, first run at the next scheduled 08:00 UTC
npm test        # exercises extraction.ts against a sample newsletter (no Gmail/Supabase needed)
npm run typecheck
```

## Notes on deviations from the migration plan doc

- Uses [`tsx`](https://github.com/privatenumber/tsx) instead of `ts-node/esm` (known ESM
  compatibility issues on current Node majors).
- `extraction.ts` and `embeddings.ts` call OpenRouter and Voyage AI directly via `fetch`
  rather than through an SDK — OpenRouter's API is OpenAI-chat-completions-compatible (not
  Anthropic-messages-compatible), and the `voyageai` npm package is a pre-1.0 alpha.

## Sources

Two newsletters: **The Batch** (deeplearning.ai) and **Mindstream**. Storage is Supabase
project `xwxlgfejfctgpnyfmizm`, shared with the UC2 Next.js web app
(`github.com/sassdi/newsletter-intelligence`).

Owner: Dirk.
