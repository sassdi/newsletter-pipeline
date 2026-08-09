import "dotenv/config";
import cron from "node-cron";
import { runPipeline } from "./pipeline.js";

async function run() {
  console.log(`[${new Date().toISOString()}] Starting pipeline run...`);
  const result = await runPipeline();
  console.log(`[${new Date().toISOString()}] Run complete:`, result);
}

cron.schedule("0 8 * * *", () => {
  run().catch((err) => console.error("Pipeline run failed:", err));
});

console.log("Newsletter pipeline scheduled: daily at 08:00 UTC.");

if (process.env.RUN_ON_STARTUP === "true") {
  run().catch((err) => console.error("Pipeline run failed:", err));
}
