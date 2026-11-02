import { embedInsights } from "./embeddings.js";
import { extractInsights } from "./extraction.js";
import { fetchUnreadNewsletters, markAsRead } from "./gmail.js";
import { countInsightsForNewsletter, insertInsights, insertNewsletter, insertRunLog } from "./supabase.js";
import type { PipelineResult, RawEmail, RunStatus } from "./types.js";

function classifySource(from: string): { source_name: string; source_category: string } {
  if (from.includes("deeplearning.ai")) {
    return { source_name: "The Batch", source_category: "deeplearning.ai" };
  }
  // Mindstream actually sends from mindstream.news; keep .io in case it changes back.
  if (from.includes("mindstream.news") || from.includes("mindstream.io")) {
    return { source_name: "Mindstream", source_category: "mindstream.news" };
  }
  return { source_name: "Unknown", source_category: "unknown" };
}

async function processEmail(email: RawEmail): Promise<"processed" | "skipped" | "error"> {
  const label = `"${email.subject}" (${email.id})`;
  const { source_name, source_category } = classifySource(email.from);
  // Gmail's internalDate is the actual send/receive time, which is what we
  // want here -- not "now", since backlog emails can be days/weeks old and
  // published_date must reflect when the newsletter was received.
  const receivedAt = new Date(email.internalDate).toISOString();
  const publishedDate = receivedAt.slice(0, 10);

  console.log(`  -> inserting newsletter row for ${label}`);
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
    // A newsletter row already existing doesn't mean this email is fully
    // processed -- a prior run could have inserted it and then failed
    // before writing insights (e.g. a network timeout mid-extraction).
    // Check whether insights actually exist before deciding what to do.
    const existingInsightCount = await countInsightsForNewsletter(newsletterId);
    if (existingInsightCount > 0) {
      // Genuinely already done -- just make sure it's marked read in case
      // that step is what failed last time, and don't re-extract (that
      // would create duplicate insight rows).
      console.log(`  -> already fully processed, ensuring read: ${label}`);
      await markAsRead(email.id);
      return "skipped";
    }
    console.log(`  -> newsletter row exists but has no insights yet, resuming ${label}`);
  }

  console.log(`  -> extracting insights for ${label}`);
  const insights = await extractInsights(email.subject, email.body);
  console.log(`  -> extracted ${insights.length} insight(s) for ${label}`);

  if (insights.length === 0) {
    // Empty/promo-only newsletter was correctly processed, just had
    // nothing to extract -- should not be retried forever.
    await markAsRead(email.id);
    return "skipped";
  }

  console.log(`  -> embedding ${insights.length} insight(s) for ${label}`);
  const embeddings = await embedInsights(insights);
  console.log(`  -> inserting insights for ${label}`);
  await insertInsights(newsletterId, insights, embeddings, publishedDate);
  await markAsRead(email.id);
  console.log(`  -> done: ${label}`);
  return "processed";
}

export async function runPipeline(): Promise<PipelineResult> {
  const startedAt = Date.now();
  let processed = 0;
  let skipped = 0;
  let errors = 0;

  console.log("Fetching unread candidates from Gmail...");
  const emails = await fetchUnreadNewsletters();
  console.log(`Fetched ${emails.length} email(s) to process.`);

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
