export type InsightCategory =
  | "model_release"
  | "funding"
  | "people_move"
  | "regulation"
  | "benchmark"
  | "enterprise_adoption"
  | "research"
  | "robotics"
  | "market_shift"
  | "controversy"
  | "other";

export type AudienceFit = "keynote" | "management" | "technical" | "smalltalk";

export interface InsightStats {
  metric: string;
  value: string;
  comparison: string;
}

export interface ExtractedInsight {
  category: InsightCategory;
  headline: string;
  summary: string;
  companies: string[];
  people: string[];
  products: string[];
  stats: InsightStats | null;
  notable_quote: string | null;
  quote_attribution: string | null;
  audience_fit: AudienceFit[];
  novelty_score: number;
  is_promotional: boolean;
  source_url: string | null;
}

export interface RawEmail {
  id: string;
  subject: string;
  from: string;
  body: string;
  internalDate: number;
}

export interface NewsletterRow {
  gmail_message_id: string;
  from: string;
  body: string;
  subject: string;
  source_name: string;
  source_category: string;
}

export interface InsightRow extends ExtractedInsight {
  newsletter_id: string;
  embedding: number[];
}

export type RunStatus = "success" | "partial" | "failed";

export interface RunLogRow {
  run_at: string;
  processed: number;
  skipped: number;
  errors: number;
  status: RunStatus;
  duration_ms: number;
}

export interface PipelineResult {
  processed: number;
  skipped: number;
  errors: number;
  status: RunStatus;
  duration_ms: number;
}
