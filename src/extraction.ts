import { extractJsonArray, sanitizeExtraction, validateInsight } from "./extraction-utils.js";
import type { ExtractedInsight } from "./types.js";

// NOTE (deviation from docs/MIGRATION_PLAN.md Section 9): the doc calls for
// "the Anthropic SDK client shape" pointed at OpenRouter via a custom
// baseURL. OpenRouter's actual API surface is OpenAI chat-completions
// compatible (https://openrouter.ai/api/v1/chat/completions), not the
// Anthropic /v1/messages shape, so the Anthropic SDK can't be pointed at it.
// Calling the REST endpoint directly with fetch avoids pulling in an SDK
// (Anthropic's or OpenAI's) for a single call.
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "deepseek/deepseek-v4-flash";

const SYSTEM_PROMPT = `You are extracting structured insights from an AI industry newsletter for a
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
  no code fences, no preamble or explanation text`;

interface OpenRouterResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export async function extractInsights(subject: string, body: string): Promise<ExtractedInsight[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Subject: ${subject}\n\n${body}` },
      ],
    }),
    // Without this, a stalled connection hangs the whole pipeline run forever.
    // 120s (not 60s) because dense, multi-topic newsletters generating close
    // to max_tokens can legitimately take a while.
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter request failed: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as OpenRouterResponse;
  const content = data.choices?.[0]?.message?.content ?? "";

  const parsed = extractJsonArray<unknown>(content);
  return sanitizeExtraction(parsed, validateInsight);
}
