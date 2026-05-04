import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FAST_MODEL, PRO_MODEL } from "./config.js";
import { callDeepSeekStreaming, formatResult } from "./deepseek.js";
import { gatherFiles, walkTree } from "./files.js";
import { makeProgressSender } from "./progress.js";
import { SKILL_INSTRUCTIONS } from "./skill.js";

export const server = new McpServer({
  name: "deepseek-junior",
  version: "0.2.1",
});

/** Wrap a string into the MCP content array shape that every tool returns. */
function textResult(text: string): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text }] };
}

/** Build the metadata suffix appended to every tool result. */
function formatMeta(included: string[], skipped: string[], label: string): string {
  if (!included.length && !skipped.length) return "";
  const incStr = included.length ? `${label}: ${included.join(", ")}` : `${label}: none`;
  const parts = [incStr];
  if (skipped.length) parts.push(`skipped: ${skipped.join(", ")}`);
  return `\n\n---\n[${parts.join("; ")}]`;
}

// Tool 1: explore (flash)
server.registerTool(
  "deepseek_explore",
  {
    title: "Explore codebase with DeepSeek (fast)",
    description:
      "Delegate codebase exploration to DeepSeek's fast model (flash). " +
      "Use when you need to find relevant files, understand a folder's structure, " +
      "or get a quick overview before reading specific files. Cheaper and faster " +
      "than deepseek_implement.",
    inputSchema: {
      query: z
        .string()
        .min(1)
        .describe(
          "What you want to know, e.g. 'find files that handle user auth' or " +
            "'summarize what api/ does'.",
        ),
      directory: z
        .string()
        .default(".")
        .describe("Directory to walk (relative to project root). Default: '.'"),
      include_files: z
        .array(z.string())
        .default([])
        .describe("Optional file paths to include verbatim (in addition to the tree)."),
    },
  },
  async ({ query, directory, include_files }, extra) => {
    const onProgress = makeProgressSender(extra);
    onProgress("📂 Reading project tree…", 0);
    const tree = await walkTree(directory);
    const { blob, included, skipped } = await gatherFiles(include_files ?? []);
    const userContent =
      `Question: ${query}\n\nDirectory: ${directory}\n\n--- Tree ---\n${tree}\n` +
      (blob ? `\n--- File contents ---${blob}` : "");

    const r = await callDeepSeekStreaming({
      model: FAST_MODEL,
      systemPrompt:
        "You are a code navigator. Your caller is another AI agent that will " +
        "use your answer to decide which files to open. Be concise and " +
        "specific; reference exact paths. Do NOT write implementation code " +
        "unless explicitly asked.",
      userContent,
      temperature: 0.2,
      onProgress,
    });

    return textResult(formatResult(r) + formatMeta(included, skipped, "included"));
  },
);

// Tool 2: implement (pro + reasoning)
server.registerTool(
  "deepseek_implement",
  {
    title: "Implement a plan step with DeepSeek (deep reasoning)",
    description:
      "Delegate concrete implementation to DeepSeek's reasoning model (pro). " +
      "Use for: implementing one step of a plan, refactoring a function, " +
      "writing tests, fixing a non-trivial bug. Pass relevant files via 'files' " +
      "and DeepSeek will read them itself.",
    inputSchema: {
      instruction: z
        .string()
        .min(1)
        .describe(
          "A precise task. Include goal, constraints, edge cases, and how the " +
            "result will be consumed.",
        ),
      files: z
        .array(z.string())
        .default([])
        .describe("Paths to files DeepSeek should read for context (max 50, 8 MB total)."),
      extra_context: z
        .string()
        .default("")
        .describe("Free-form additional context: error messages, requirements, decisions."),
    },
  },
  async ({ instruction, files, extra_context }, extra) => {
    const onProgress = makeProgressSender(extra);
    onProgress("📂 Reading attached files…", 0);
    const { blob, included, skipped } = await gatherFiles(files ?? []);
    const userContent =
      `Task:\n${instruction}\n` +
      (extra_context ? `\nAdditional context:\n${extra_context}\n` : "") +
      (blob ? `\nFiles:${blob}\n` : "");

    const r = await callDeepSeekStreaming({
      model: PRO_MODEL,
      systemPrompt:
        "You are a senior engineer being delegated a concrete task by a " +
        "planning agent. Output, in order: (1) brief plan if non-trivial, " +
        "(2) the actual code — full content for new files; for edits, " +
        "unified diff or full content with file path stated, (3) follow-up " +
        "actions for the planner (tests to run, deps to install). Do not " +
        "invent APIs. If files lack info, say what's missing.",
      userContent,
      reasoning: true,
      onProgress,
    });

    return textResult(formatResult(r) + formatMeta(included, skipped, "files included"));
  },
);

// Tool 3: review (pro + reasoning)
server.registerTool(
  "deepseek_review",
  {
    title: "Review code with DeepSeek (deep reasoning)",
    description:
      "Critical code review by DeepSeek-pro: bugs, security, edge cases, " +
      "API misuse. Returns a structured list of concrete issues with " +
      "severity, location, fix. Use BEFORE committing risky changes.",
    inputSchema: {
      criteria: z
        .string()
        .min(1)
        .describe(
          "What to look for, e.g. 'security issues', 'race conditions', " +
            "'error handling', 'general code quality'.",
        ),
      files: z.array(z.string()).min(1).describe("Paths to files to review."),
    },
  },
  async ({ criteria, files }, extra) => {
    const onProgress = makeProgressSender(extra);
    onProgress("📂 Reading files for review…", 0);
    const { blob, included, skipped } = await gatherFiles(files);
    if (!included.length) {
      return textResult(`No files could be read. Skipped: ${skipped.join(", ") || "none"}`);
    }
    const userContent =
      `Review criteria: ${criteria}\n\n` +
      `Find concrete issues, not generic advice. For each: severity, ` +
      `location (file:line), problem, suggested fix. Skip non-issues.\n` +
      `\nFiles:${blob}`;

    const r = await callDeepSeekStreaming({
      model: PRO_MODEL,
      systemPrompt:
        "You are a senior code reviewer. Output a numbered list of concrete " +
        "issues. For each: severity (low/med/high/critical), location " +
        "(file:line), problem, suggested fix. Be brief but specific. Do not " +
        "pad with non-issues.",
      userContent,
      reasoning: true,
      onProgress,
    });

    return textResult(formatResult(r) + formatMeta(included, skipped, "reviewed"));
  },
);

// Tool 4: ask (escape hatch)
server.registerTool(
  "deepseek_ask",
  {
    title: "Generic DeepSeek prompt",
    description:
      "Generic escape hatch: arbitrary prompt with full control over model " +
      "and reasoning. Use only when the specialized tools (explore, implement, " +
      "review) don't fit.",
    inputSchema: {
      prompt: z.string().min(1).describe("Prompt to send."),
      system: z
        .string()
        .default("You are a helpful, precise assistant.")
        .describe("Optional system prompt."),
      model: z
        .enum(["flash", "pro"])
        .default("pro")
        .describe("'flash' for speed/cost, 'pro' for quality."),
      reasoning: z.boolean().default(false).describe("Enable thinking mode (slower, deeper)."),
      files: z
        .array(z.string())
        .default([])
        .describe("Optional file paths to include in the context."),
    },
  },
  async ({ prompt, system, model, reasoning, files }, extra) => {
    const onProgress = makeProgressSender(extra);
    if (files && files.length > 0) onProgress("📂 Reading attached files…", 0);
    const { blob, included, skipped } = await gatherFiles(files ?? []);
    const userContent = blob ? `${prompt}\n\nFiles:${blob}` : prompt;
    const r = await callDeepSeekStreaming({
      model: model === "flash" ? FAST_MODEL : PRO_MODEL,
      systemPrompt: system,
      userContent,
      reasoning,
      onProgress,
    });

    return textResult(formatResult(r) + formatMeta(included, skipped, "files"));
  },
);

// Prompt: skill content as a slash command
server.registerPrompt(
  "deepseek_junior",
  {
    title: "DeepSeek Junior — usage guide",
    description:
      "Inject the DeepSeek Junior skill into context: when to delegate, " +
      "how to call the tools well. Use this once per session if you're " +
      "going to lean on the deepseek_* tools.",
  },
  () => ({
    messages: [
      {
        role: "user",
        content: { type: "text", text: SKILL_INSTRUCTIONS },
      },
    ],
  }),
);
