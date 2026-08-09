# Newsletter Intelligence Pipeline — Make.com to Custom Node.js Migration

**Goal**: Replace the Make.com ingestion pipeline with a self-hosted Node.js service to eliminate ops-budget constraints and reduce cost, while preserving all existing extraction logic and data quality.

**Owner**: Dirk
**Target execution**: Claude Code, local laptop (Windows + VS Code)

---

## 1. What's changing

| Component | Before (Make) | After (Custom) |
|---|---|---|
| Orchestration | Make.com (free tier) | Node.js + `node-cron`, self-hosted |
| Trigger frequency | Weekly (UC1) / ops-limited | Daily @ 08:00 UTC |
| Emails per run | Unbounded (ops-budget permitting) | Max 5 per run, oldest unread first, no date restriction |
| Read tracking | N/A | Mail marked read only after successful processing |
| Extraction LLM | Claude Haiku (via HTTP module) | DeepSeek v3 via OpenRouter |
| JSON cleanup | Make `trim(replace(replace(...)))` formula | Node.js `extractJsonArray()` utility |
| Deduplication | Subject-based lookup (`encodeURL` match) | `gmail_message_id` UNIQUE constraint |
| Embeddings | Voyage AI `voyage-4-lite` (unchanged) | Voyage AI `voyage-4-lite` (unchanged) |
| Storage | Supabase (unchanged) | Supabase (schema updated) |
| Hosting | Make cloud | Self-hosted VPS or laptop-run service |

**What stays the same**: UC2 web app (Next.js/Vercel), Supabase project, Voyage embedding model, extraction prompt content, general two-table structure.

---

## 2. Architecture overview

```
Node-cron (daily 08:00 UTC)
        │
        ▼
Gmail API — fetch last 24h from The Batch + Mindstream
        │
        ▼
For each email:
  ├─ Insert attempt into `newsletters` (gmail_message_id UNIQUE)
  │    └─ If duplicate (23505) → skip, log, continue
  ├─ OpenRouter (deepseek/deepseek-v4-flash) → extract structured insights
  ├─ extractJsonArray() → strip markdown fences, validate JSON
  ├─ Voyage AI (voyage-4-lite) → embed headline+summary per insight
  └─ Batch insert into `insights` (with embedding vector)
        │
        ▼
Log run summary → `run_logs` table
```

---

## 3. Current state (context for Claude Code)

- **New repo for this pipeline**: `github.com/<your-username>/newsletter-pipeline` — private, already created on GitHub with a Node `.gitignore`, cloned locally. Claude Code should work directly in this cloned folder (see Section 6).
- Supabase project: `xwxlgfejfctgpnyfmizm`
- Repo: `github.com/sassdi/newsletter-intelligence` (contains UC2 Next.js app — do NOT touch unless asked)
- Two newsletter sources: **The Batch** (deeplearning.ai) and **Mindstream**
- Existing tables: `newsletters`, `insights` (schema below, needs migration)
- Known Make.com gotchas already solved and to be preserved in logic:
  - Claude/LLM output sometimes wraps JSON in ` ```json ` fences — must strip robustly
  - `max_tokens` must be a number, not string
  - Subject-line dedup is fragile (encoding, "Re:" prefixes, recurring subjects) — replaced by `gmail_message_id`

---

## 4. Target Supabase schema

### `newsletters` table changes

| Field | Action |
|---|---|
| `gmail_message_id` | **ADD** — `text UNIQUE`, used for dedup |
| `sender` | **RENAME** → `from` |
| `full_text` | **RENAME** → `body` |
| `source_name`, `source_category` | Keep (pipeline will populate) |

### `insights` table changes

| Field | Action |
|---|---|
| `embedding` | **CHANGE TYPE** → `vector(1024)` (voyage-4-lite dimension) |
| `published_date` | **KEEP** — has existing production data. Pipeline should populate it by taking the date portion of `newsletters.received_at` at insert time (this matches the existing Make logic exactly — not a distinct value, just `received_at` truncated to a date). |
| `companies`, `people`, `products`, `audience_fit` | **CONFIRM TYPE** → `text[]` |

### New table: `run_logs`

```sql
CREATE TABLE public.run_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_at timestamp with time zone NOT NULL,
  processed integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
  duration_ms integer,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT run_logs_pkey PRIMARY KEY (id)
);
```

Full SQL migration script is in **Section 8**.

---

## 5. Extraction prompt (finalized — do not alter without review)

This is the current production prompt from Make.com. Port it verbatim into the Node.js `system` parameter.

```
You are extracting structured insights from an AI industry newsletter for a
personal research archive. The newsletter may be dense and technical (multiple
in-depth sections) or casual and punchy (short news bites mixed with promotional
content). Handle both styles.

TASK: Identify each distinct, substantive news item or development in this
newsletter and extract it as a separate structured insight. A single newsletter
often contains 1-6 distinct insights.

Only extract items that are substantively about AI — AI models, companies,
research, policy, or AI's impact on business/labor. Ignore unrelated content
even if the newsletter includes it (sports, entertainment, general tech that
isn't AI-specific).

For each insight, output an object with these exact fields:
- category: one of "model_release", "funding", "people_move", "regulation",
  "benchmark", "enterprise_adoption", "research", "robotics", "market_shift",
  "controversy", "other"
- headline: a short, punchy title (under 12 words), written in your own words
- summary: 2-3 sentences capturing the key point, written entirely in your own
  words — never copy sentences from the source
- companies: array of company names mentioned, empty array if none
- people: array of named individuals mentioned, empty array if none
- products: array of model/product names mentioned, empty array if none
- stats: an object with "metric", "value", "comparison" if the insight includes
  a quantifiable benchmark or figure, otherwise null
- notable_quote: a short, attributed quote ONLY if something genuinely striking
  was said — must be under 15 words, verbatim from the text, otherwise null
- quote_attribution: who said it, otherwise null
- audience_fit: array from "keynote", "management", "technical", "smalltalk" —
  pick all that apply based on how this would land with that audience
- novelty_score: integer 1-5, how good a "did you hear about..." hook this is
  for casual conversation (5 = highly surprising/quotable, 1 = routine update)
- is_promotional: true if this is primarily a course ad, product pitch, or
  subscription promo with no independent news value, false otherwise
- source_url: a URL from the text if one is directly associated with this
  specific item, otherwise null

RULES:
- Never copy more than 15 consecutive words from the source text anywhere in
  your output, including inside summary or headline fields
- If the entire newsletter is promotional with zero substantive news, return
  an empty array
- Skip newsletter boilerplate: subscribe links, sponsor messages, unsubscribe
  footers, "view in browser" links
- Output ONLY a valid JSON array of insight objects — no markdown formatting,
  no code fences, no preamble or explanation text
```

Model call: `deepseek/deepseek-v4-flash` via OpenRouter, `max_tokens: 4096`.

---

## 6. File structure to create

**Note for Claude Code**: This repo (`newsletter-pipeline`) already exists on GitHub and has been cloned locally with a Node `.gitignore` in place. Scaffold the files below directly into the current directory — do not create a nested subfolder. Commit incrementally as each piece is completed (e.g. after scaffolding, after each module, after the schema migration) rather than one giant commit at the end, so there's a reviewable history.

```
newsletter-pipeline/            # repo root — already cloned, work here directly
├── .env                        # secrets (gitignored)
├── .env.example
├── .gitignore                  # already present (GitHub Node template)
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                 # cron scheduler + entrypoint
│   ├── pipeline.ts               # main runPipeline() orchestration
│   ├── extraction.ts             # OpenRouter call + prompt
│   ├── extraction-utils.ts       # JSON fence stripping, validation
│   ├── gmail.ts                   # Gmail API auth + fetch
│   ├── embeddings.ts              # Voyage AI wrapper
│   ├── supabase.ts                # Supabase client + insert helpers
│   └── types.ts                    # shared TypeScript interfaces
├── migrations/
│   └── 001_align_pipeline_schema.sql
└── README.md                    # overwrite GitHub's default README
```

---

## 7. package.json dependencies

```json
{
  "name": "newsletter-pipeline",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node --loader ts-node/esm src/index.ts",
    "dev": "RUN_ON_STARTUP=true node --loader ts-node/esm src/index.ts",
    "test": "node --loader ts-node/esm src/test-extraction.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.30.0",
    "@supabase/supabase-js": "^2.45.0",
    "googleapis": "^144.0.0",
    "node-cron": "^3.0.3",
    "voyageai": "^0.0.3",
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    "typescript": "^5.5.4",
    "ts-node": "^10.9.2",
    "@types/node": "^22.5.0",
    "@types/node-cron": "^3.0.11"
  }
}
```

---

## 8. Supabase migration SQL

Run this in the Supabase SQL Editor **before** deploying the pipeline. Back up the project first (Project Settings → Backups).

```sql
-- Migration: Align newsletter ingestion schema with Node.js pipeline

-- ============================================================================
-- TABLE: newsletters
-- ============================================================================

ALTER TABLE public.newsletters
ADD COLUMN gmail_message_id text UNIQUE;

ALTER TABLE public.newsletters
RENAME COLUMN sender TO "from";

ALTER TABLE public.newsletters
RENAME COLUMN full_text TO body;

-- ============================================================================
-- TABLE: insights
-- ============================================================================

ALTER TABLE public.insights
DROP COLUMN embedding;

ALTER TABLE public.insights
ADD COLUMN embedding vector(1024);

-- published_date is KEPT — has existing production data.
-- Pipeline populates it as the date portion of newsletters.received_at
-- at insert time (matches prior Make logic).

ALTER TABLE public.insights
ALTER COLUMN companies TYPE text[] USING companies::text[],
ALTER COLUMN people TYPE text[] USING people::text[],
ALTER COLUMN products TYPE text[] USING products::text[],
ALTER COLUMN audience_fit TYPE text[] USING audience_fit::text[];

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS newsletters_gmail_message_id_idx
  ON public.newsletters(gmail_message_id);

CREATE INDEX IF NOT EXISTS insights_newsletter_id_idx
  ON public.insights(newsletter_id);

CREATE INDEX IF NOT EXISTS insights_embedding_idx
  ON public.insights USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS insights_novelty_score_idx
  ON public.insights(novelty_score DESC);

CREATE INDEX IF NOT EXISTS insights_is_promotional_idx
  ON public.insights(is_promotional);

CREATE INDEX IF NOT EXISTS insights_category_idx
  ON public.insights(category);

-- ============================================================================
-- TABLE: run_logs
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.run_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_at timestamp with time zone NOT NULL,
  processed integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
  duration_ms integer,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT run_logs_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS run_logs_run_at_idx
  ON public.run_logs(run_at DESC);

-- ============================================================================
-- VERIFY
-- ============================================================================

SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name IN ('newsletters', 'insights', 'run_logs')
ORDER BY table_name, ordinal_position;
```

**Note**: If `companies`/`people`/`products`/`audience_fit` already contain data in an incompatible array format, the `USING` cast may need adjustment. Inspect existing row data first with `SELECT companies FROM insights LIMIT 5;` before running.

---

## 9. Core implementation notes for Claude Code

### `src/extraction-utils.ts`
Must implement:
- `extractJsonArray<T>(text: string): T[]` — strips ` ```json ` / ` ``` ` fences, regex-matches the outer `[...]`, removes trailing commas, parses safely, returns `[]` on any failure (never throws)
- `validateInsight(insight: unknown): boolean` — checks required fields exist
- `sanitizeExtraction<T>(data, validator): T[]` — filters array to only valid items

### `src/extraction.ts`
- Calls OpenRouter (`baseURL: 'https://openrouter.io/api/v1'`) using the Anthropic SDK client shape, model `deepseek/deepseek-v4-flash`, `max_tokens: 4096`
- System prompt = **Section 5** verbatim
- User message = `Subject: {subject}\n\n{body}`
- Pipes response through `extractJsonArray` + `sanitizeExtraction`

### `src/gmail.ts`
- OAuth2 client using `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`
- Query: `from:(deeplearning.ai@mail.deeplearning.ai OR hello@mindstream.io) is:unread` — **no `after:` date bound**, so older unread mail is picked up too (this doubles as backlog-clearing, not just "today's mail")
- `maxResults: 5` on the Gmail `list` call — **hard cap of 5 emails processed per run**. Gmail's default order is newest-first, so sort by `internalDate` ascending before slicing to 5, so the oldest backlog drains first rather than always re-fetching only the newest 5 and never catching up
- Extracts `id`, `subject`, `from`, `body` (handle both single-part and multipart MIME), `internalDate` → timestamp
- **After successful processing of an email** (newsletter + insights rows committed), call `gmail.users.messages.modify({ userId: 'me', id: msg.id, requestBody: { removeLabelIds: ['UNREAD'] } })` to mark it read
- **Do not mark as read if extraction/storage failed** — leave it unread so the next run retries it naturally
- Dedup is now reinforced two ways: `is:unread` prevents re-fetching processed mail at the Gmail level, and `gmail_message_id` UNIQUE constraint prevents duplicate DB rows if a mail somehow gets re-fetched before being marked read

### `src/embeddings.ts`
- Voyage AI client, model `voyage-4-lite`
- Input: `["{headline}. {summary}", ...]` for each insight in one newsletter
- Returns array of 1024-dim vectors aligned by index to insights array

### `src/supabase.ts`
- Client instantiated with `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` (service_role — bypasses RLS)
- Insert into `newsletters` first; on `error.code === '23505'` (unique violation on `gmail_message_id`) → treat as duplicate, skip gracefully, do not throw
- Batch insert into `insights` using the returned `newsletter.id` as foreign key

### `src/pipeline.ts`
Orchestration order per email (max 5 per run, oldest unread first):
1. Attempt `newsletters` insert (dedup happens here via DB constraint)
2. If duplicate → log skip, continue to next email (do NOT mark as read — a duplicate insert means something's off, worth investigating rather than silently clearing the unread flag)
3. Call extraction
4. If zero insights → log skip, **still mark as read** (empty/promo-only newsletter was correctly processed, just had nothing to extract — should not be retried forever)
5. Generate embeddings
6. Batch insert insights — set `published_date` to the date portion of `newsletter.received_at` (e.g. `newsletter.received_at.toISOString().split('T')[0]`), matching the prior Make behavior
7. On success → mark email as read via Gmail API
8. On any failure (extraction error, embedding error, insert error) → leave unread, increment `errors`, move to next email
9. Track `processed` / `skipped` / `errors` counters
10. After all emails (up to 5), write summary row to `run_logs`

### `src/index.ts`
- `node-cron` schedule: `'0 8 * * *'` (daily 08:00 UTC — adjust if Dirk wants local time)
- If `process.env.RUN_ON_STARTUP === 'true'`, run once immediately (for local testing on the laptop before deploying)

---

## 10. Environment variables (`.env.example`)

```bash
# OpenRouter
OPENROUTER_API_KEY=sk-or-v1-...

# Voyage AI
VOYAGE_API_KEY=pa-...

# Supabase
SUPABASE_URL=https://xwxlgfejfctgpnyfmizm.supabase.co
SUPABASE_SERVICE_KEY=eyJ0eXAi...

# Gmail OAuth2
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
GOOGLE_REDIRECT_URL=http://localhost:3000/auth/callback

# Optional
RUN_ON_STARTUP=false
NODE_ENV=production
```

---

## 11. Testing checklist (before scheduling live runs)

- [ ] Run `npm run dev` locally with `RUN_ON_STARTUP=true` against a Gmail inbox containing at least one known The Batch and one Mindstream email
- [ ] Confirm `newsletters` row created with correct `gmail_message_id`, `from`, `body`
- [ ] Confirm `insights` rows created, embeddings populated (1024-length vectors)
- [ ] Confirm the processed email is marked as read in Gmail (UNREAD label removed)
- [ ] Re-run pipeline immediately — confirm duplicate emails are skipped (no new rows, `run_logs.skipped` increments); since the mail is now read it also won't be re-fetched by the `is:unread` query
- [ ] With more than 5 unread qualifying emails in the inbox, confirm exactly 5 are processed per run (oldest first) and the remainder stay untouched for the next run
- [ ] Manually mark an old (weeks-old) newsletter as unread and confirm it gets picked up — proves there's no date restriction
- [ ] Manually inspect 2-3 `headline`/`summary` pairs against source email — confirm paraphrasing (no >15-word verbatim copying)
- [ ] Force a malformed OpenRouter response (e.g. temporarily lower max_tokens to truncate output) — confirm `extractJsonArray` returns `[]` without crashing the pipeline, and confirm that email is marked read (empty-extraction case) rather than retried forever
- [ ] Force a Supabase insert failure (e.g. temporarily bad service key) — confirm the email is left unread and retried on the next run
- [ ] Confirm `run_logs` row written after both successful and partially-failed runs

---

## 12. Deployment (post-testing)

- [ ] Decide hosting: VPS (DigitalOcean/Linode) vs keep running from laptop via Task Scheduler/cron — **VPS recommended for reliability**
- [ ] If VPS: provision Ubuntu 22.04, install Node 20+, clone repo, set `.env`, run under `pm2` or `systemd` for auto-restart
- [ ] Set up basic uptime monitoring (Healthchecks.io ping at end of each successful run)
- [ ] Decommission the Make.com ingestion scenario only after 3-5 consecutive successful daily runs on the new pipeline
- [ ] Update project memory / documentation once cutover is complete

---

## 13. Rollback plan

If the new pipeline has issues after cutover:
1. Re-enable the Make.com scenario (keep it paused, not deleted, for at least 2 weeks post-cutover)
2. New pipeline's `gmail_message_id` dedup means no double-processing risk if both run temporarily
3. Investigate via `run_logs` table — `status = 'partial'` or `'failed'` rows will show which stage broke

---

## High-level human-readable progress tracker

Use this to follow along with Claude Code's work without reading every line of code.

- [ ] **Step 1 — Supabase schema migration**
  Claude Code runs the SQL in Section 8 against the live database. You should see `gmail_message_id`, renamed `from`/`body` columns, a proper `vector(1024)` embedding column, and a new `run_logs` table.

- [ ] **Step 2 — Project scaffolding**
  The `newsletter-pipeline` GitHub repo already exists and is cloned locally. Claude Code works directly inside it — creates `package.json`, `tsconfig.json`, installs dependencies, and commits as it goes.

- [ ] **Step 3 — Core modules built**
  Gmail fetching, OpenRouter extraction, Voyage embeddings, and Supabase writes each get their own file. You don't need to review each one — just confirm they exist.

- [ ] **Step 4 — Environment variables wired up**
  Claude Code creates `.env.example`; you fill in real values in `.env` (API keys, Gmail OAuth token). This is the one step that needs you personally — Claude Code cannot generate your API keys.

- [ ] **Step 5 — Local test run**
  Claude Code runs the pipeline once against your real Gmail inbox with `RUN_ON_STARTUP=true`. You should see console output showing up to 5 unread emails fetched (oldest first, no date limit), insights extracted, rows written to Supabase, and those emails marked as read in Gmail.

- [ ] **Step 6 — Duplicate-safety test**
  Claude Code runs the pipeline a second time immediately. It should report 0 newly processed emails and log skips — proving dedup works both because the emails are now marked read and because of the database-level unique constraint.

- [ ] **Step 7 — Quality spot-check**
  You personally read 2-3 extracted insights next to the original newsletter to confirm the summaries are accurate and properly paraphrased (not copy-pasted).

- [ ] **Step 8 — Scheduling decision**
  Decide together: run daily from your laptop, or deploy to a small VPS. VPS is more reliable if your laptop isn't always on.

- [ ] **Step 9 — Go live**
  Daily cron schedule activated. Make.com scenario paused (not deleted) as a safety net.

- [ ] **Step 10 — Monitor for 1 week**
  Check `run_logs` table daily. After 3-5 clean runs, consider the migration complete and archive the Make.com scenario.

---

*Generated for Dirk's AI newsletter intelligence system migration, covering UC1/UC2 supporting infrastructure. Reference project: `github.com/sassdi/newsletter-intelligence`.*
