import "dotenv/config";
import { runPipeline } from "./pipeline.js";

// Entrypoint for external schedulers (cron, a VPS-wide job agent, etc.) that
// invoke a command once and expect it to exit -- as opposed to index.ts,
// which is a long-running process with its own internal node-cron schedule.
// Don't run both against the same inbox; that causes duplicate/overlapping
// runs. Exit code is non-zero on a failed run so the external scheduler can
// detect and alert on it.

console.log(`[${new Date().toISOString()}] Starting pipeline run...`);
const result = await runPipeline();
console.log(`[${new Date().toISOString()}] Run complete:`, result);
process.exit(result.status === "failed" ? 1 : 0);
