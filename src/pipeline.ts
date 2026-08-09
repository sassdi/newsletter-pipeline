import { embedInsights } from "./embeddings.js";
import { extractInsights } from "./extraction.js";
import { fetchUnreadNewsletters, markAsRead } from "./gmail.js";
import { insertInsights, insertNewsletter, insertRunLog } from "./supabase.js";
import type { PipelineResult, RawEmail, RunStatus } from "./types.js";

function classifySource(from: string): { source_name: string; source_category: string } {
  if (from.includes("deeplearning.ai")) {
    return { source_name: "The Batch", source_category: "deeplearning.ai" };
  }
  if (from.includes("mindstream.io")) {
    return { source_name: "Mindstream", source_category: "mindstream.io" };
  }
  return { source_name: "Unknown", source_category: "unknown" };
}

async function processEmail(email: RawEmail): Promise<"processed" | "skipped" | "error"> {
  const { source_name, source_category } = classifySource(email.from);
  // Gmail's internalDate is the actual send/receive time, which is what we
  // want here -- not "now", since backlog emails can be days/weeks old and
  // published_date must reflect when the newsletter was received.
  const receivedAt = new Date(email.internalDate).toISOString();
  const publishedDate = receivedAt.slice(0, 10);

  const { id: newsletterId, isDuplicate } = await insertNewsletter({
    gmail_message_id: email.id,
    from: email.from,
    body: email.body,
    subject: email.subject,
    source_name,
    source_category,
    received_at: receivedAt,
  });

  if (isDuplicate) {
    // Do not mark as read -- a duplicate insert means something's off
    // (e.g. is:unread didn't exclude it), worth investigating rather than
    // silently clearing the unread flag.
    return "skipped";
  }

  const insights = await extractInsights(email.subject, email.body);

  if (insights.length === 0) {
    // Empty/promo-only newsletter was correctly processed, just had
    // nothing to extract -- should not be retried forever.
    await markAsRead(email.id);
    return "skipped";
  }

  const embeddings = await embedInsights(insights);
  await insertInsights(newsletterId!, insights, embeddings, publishedDate);
  await markAsRead(email.id);
  return "processed";
}

export async function runPipeline(): Promise<PipelineResult> {
  const startedAt = Date.now();
  let processed = 0;
  let skipped = 0;
  let errors = 0;

  const emails = await fetchUnreadNewsletters();

  for (const email of emails) {
    try {
      const outcome = await processEmail(email);
      if (outcome === "processed") processed++;
      else if (outcome === "skipped") skipped++;
    } catch (err) {
      // Leave unread on any failure so the next run retries it naturally.
      errors++;
      console.error(`Failed to process email ${email.id}:`, err);
    }
  }

  const duration_ms = Date.now() - startedAt;
  const status: RunStatus = errors === 0 ? "success" : processed > 0 || skipped > 0 ? "partial" : "failed";

  await insertRunLog({
    run_at: new Date(startedAt).toISOString(),
    processed,
    skipped,
    errors,
    status,
    duration_ms,
  });

  return { processed, skipped, errors, status, duration_ms };
}
