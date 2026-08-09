import { createClient } from "@supabase/supabase-js";
import type { ExtractedInsight, InsightRow, NewsletterRow, RunLogRow } from "./types.js";

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY are not set");
  return createClient(url, key);
}

const UNIQUE_VIOLATION = "23505";

interface InsertNewsletterResult {
  id: string | null;
  isDuplicate: boolean;
}

export async function insertNewsletter(row: NewsletterRow): Promise<InsertNewsletterResult> {
  const supabase = getClient();

  const { data, error } = await supabase.from("newsletters").insert(row).select("id").single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { id: null, isDuplicate: true };
    }
    throw error;
  }

  return { id: data.id as string, isDuplicate: false };
}

export async function insertInsights(
  newsletterId: string,
  insights: ExtractedInsight[],
  embeddings: number[][],
  publishedDate: string
): Promise<void> {
  if (insights.length === 0) return;

  const rows: InsightRow[] = insights.map((insight, i) => ({
    ...insight,
    newsletter_id: newsletterId,
    embedding: embeddings[i]!,
    published_date: publishedDate,
  }));

  const { error } = await getClient().from("insights").insert(rows);
  if (error) throw error;
}

export async function insertRunLog(row: RunLogRow): Promise<void> {
  const { error } = await getClient().from("run_logs").insert(row);
  if (error) throw error;
}
