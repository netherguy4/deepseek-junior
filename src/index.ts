#!/usr/bin/env node
/**
 * DeepSeek MCP Server — DeepSeek V4 as a "junior dev" for Claude / Codex.
 *
 * Tools:
 *   - deepseek_explore   (flash) — codebase navigation
 *   - deepseek_implement (pro + thinking) — implement a plan step
 *   - deepseek_review    (pro + thinking) — code review / audit
 *   - deepseek_ask       — generic escape hatch
 *
 * Prompts:
 *   - deepseek_junior — slash command that injects the skill instructions.
 *
 * Streaming:
 *   The DeepSeek API is called with stream:true. While tokens arrive,
 *   the server pushes notifications/progress to the client every ~250ms,
 *   so Claude Desktop / Codex Desktop show "DeepSeek is generating: ..."
 *   in real time. Final result is still returned as a single tool result.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { server } from "./tools.js";
import { API_KEY, BASE_URL, FAST_MODEL, PRO_MODEL } from "./config.js";
import { log } from "./logger.js";

// Re-export functions under test
export { parseSseLine } from "./sse.js";
export { formatResult } from "./deepseek.js";
export { isSafePath } from "./files.js";
export { makeProgressSender } from "./progress.js";

async function main(): Promise<void> {
  if (!API_KEY) {
    process.stderr.write(
      "WARN: DEEPSEEK_API_KEY is not set. Server will start but tool calls " +
        "will return an error until configured.\n",
    );
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  await log(`started base=${BASE_URL} fast=${FAST_MODEL} pro=${PRO_MODEL} cwd=${process.cwd()}`);
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("index.js") ||
    process.argv[1].endsWith("index.ts") ||
    process.argv[1].endsWith("index.mjs"));

if (isMain) {
  main().catch((err) => {
    process.stderr.write(`fatal: ${err}\n`);
    process.exit(1);
  });
}
