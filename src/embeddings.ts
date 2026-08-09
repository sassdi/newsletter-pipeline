import type { ExtractedInsight } from "./types.js";

// NOTE (deviation from docs/MIGRATION_PLAN.md Section 7): the `voyageai`
// npm package is a pre-1.0 alpha (0.0.3) with no guaranteed stable API
// shape. Voyage's embeddings endpoint is a single simple REST call, so we
// hit it directly via fetch instead of depending on an unstable SDK.
const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const MODEL = "voyage-4-lite";

interface VoyageResponse {
  data: Array<{ embedding: number[] }>;
}

/**
 * Embeds each insight's headline+summary. Returned vectors are index-aligned
 * to the input insights array.
 */
export async function embedInsights(insights: ExtractedInsight[]): Promise<number[][]> {
  if (insights.length === 0) return [];

  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error("VOYAGE_API_KEY is not set");

  const input = insights.map((i) => `${i.headline}. ${i.summary}`);

  const response = await fetch(VOYAGE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, input }),
    // Without this, a stalled connection hangs the whole pipeline run forever.
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Voyage AI request failed: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as VoyageResponse;
  return data.data.map((d) => d.embedding);
}
