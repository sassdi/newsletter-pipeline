-- Migration: Align newsletter ingestion schema with Node.js pipeline
--
-- STATUS: NOT YET EXECUTED against the live Supabase project
-- (xwxlgfejfctgpnyfmizm). This file is checked in for review only.
-- Back up the project (Project Settings -> Backups) before running this,
-- then run it manually in the Supabase SQL Editor. See docs/MIGRATION_PLAN.md
-- Section 8 for full context. embedding and the companies/people/products/
-- audience_fit columns were verified already correct (vector(1024) and
-- text[] respectively) and are left untouched -- see inline notes below.

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

-- embedding is ALREADY vector(1024) in production (confirmed via
-- `SELECT vector_dims(embedding) FROM insights LIMIT 1;`), matching
-- voyage-4-lite's output dimension. No change needed -- the original plan's
-- DROP+ADD here would have destroyed every existing insight's embedding
-- for no reason.

-- published_date is KEPT -- has existing production data. The pipeline
-- populates it as the date portion of newsletters.received_at at insert
-- time (matches prior Make.com logic exactly; see Section 4/9 of
-- docs/MIGRATION_PLAN.md). No column change needed here.

-- companies/people/products/audience_fit are ALREADY text[] in production
-- (confirmed via pg_typeof on each column) -- no change needed.

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
