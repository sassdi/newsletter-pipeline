import type { ExtractedInsight, InsightCategory } from "./types.js";

const VALID_CATEGORIES: readonly InsightCategory[] = [
  "model_release",
  "funding",
  "people_move",
  "regulation",
  "benchmark",
  "enterprise_adoption",
  "research",
  "robotics",
  "market_shift",
  "controversy",
  "other",
];

/**
 * Strips markdown code fences and surrounding prose from an LLM response and
 * parses the embedded JSON array. Never throws — returns [] on any failure,
 * since a malformed extraction response should be skipped, not crash the run.
 */
export function extractJsonArray<T>(text: string): T[] {
  try {
    let cleaned = text.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");

    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start === -1 || end === -1 || end < start) return [];

    let jsonSlice = cleaned.slice(start, end + 1);
    jsonSlice = jsonSlice.replace(/,(\s*[\]}])/g, "$1");

    const parsed = JSON.parse(jsonSlice);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function validateInsight(insight: unknown): insight is ExtractedInsight {
  if (typeof insight !== "object" || insight === null) return false;
  const i = insight as Record<string, unknown>;

  return (
    typeof i.category === "string" &&
    (VALID_CATEGORIES as string[]).includes(i.category) &&
    typeof i.headline === "string" &&
    i.headline.length > 0 &&
    typeof i.summary === "string" &&
    i.summary.length > 0 &&
    Array.isArray(i.companies) &&
    Array.isArray(i.people) &&
    Array.isArray(i.products) &&
    Array.isArray(i.audience_fit) &&
    typeof i.novelty_score === "number" &&
    typeof i.is_promotional === "boolean"
  );
}

export function sanitizeExtraction<T>(data: unknown[], validator: (x: unknown) => x is T): T[] {
  return data.filter(validator);
}
