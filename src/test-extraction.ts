import "dotenv/config";
import { extractInsights } from "./extraction.js";

const SAMPLE_SUBJECT = "The Batch: New reasoning model tops benchmarks";

const SAMPLE_BODY = `
Dear reader,

This week, a research lab announced a new open-weight reasoning model that
outperforms prior systems on math and coding benchmarks, scoring 12 points
higher than the previous best open model on a standard reasoning suite. The
lab said the gains came from a new reinforcement learning recipe rather than
sheer scale.

In other news, a mid-sized enterprise software company announced it is
rolling out an AI coding assistant to its entire engineering org after a
successful pilot, citing a measurable drop in time spent on routine
refactors.

---
You're receiving this because you subscribed. Unsubscribe | View in browser
`;

async function main() {
  const insights = await extractInsights(SAMPLE_SUBJECT, SAMPLE_BODY);
  console.log(`Extracted ${insights.length} insight(s):`);
  console.log(JSON.stringify(insights, null, 2));
}

main().catch((err) => {
  console.error("Extraction test failed:", err);
  process.exitCode = 1;
});
