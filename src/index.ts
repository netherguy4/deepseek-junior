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

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios, { AxiosError, type AxiosResponse } from "axios";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// ---------------- config ----------------
const API_KEY = process.env.DEEPSEEK_API_KEY ?? "";
const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
const FAST_MODEL = process.env.DEEPSEEK_FAST_MODEL ?? "deepseek-v4-flash";
const PRO_MODEL = process.env.DEEPSEEK_PRO_MODEL ?? "deepseek-v4-pro";
const TIMEOUT_MS = Number(process.env.DEEPSEEK_TIMEOUT_MS ?? "300000"); // 5 min
const PROGRESS_INTERVAL_MS = Number(process.env.DEEPSEEK_PROGRESS_MS ?? "250");
const LOG_FILE = process.env.DEEPSEEK_LOG_FILE ?? path.join(process.cwd(), "deepseek_mcp.log");
const LOG_ENABLED = (process.env.DEEPSEEK_LOG_ENABLED ?? "true").toLowerCase() !== "false";

// File reading limits (per tool call)
const MAX_FILE_BYTES = 1_000_000;
const MAX_TOTAL_BYTES = 8_000_000;
const MAX_FILES = 50;
const MAX_TREE_DEPTH = 4;

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  "__pycache__",
  ".venv",
  "venv",
  "target",
  ".idea",
  ".vscode",
  "coverage",
  ".cache",
  ".pytest_cache",
  ".mypy_cache",
  ".tox",
]);

// ---------------- logging ----------------
async function log(line: string): Promise<void> {
  if (!LOG_ENABLED) return;
  const entry = `[${new Date().toISOString()}] ${line}\n`;
  process.stderr.write(entry); // stderr is safe with stdio MCP transport
  try {
    await fs.appendFile(LOG_FILE, entry);
  } catch {
    /* ignore */
  }
}

// ---------------- DeepSeek streaming call ----------------
type ProgressFn = (msg: string, tokens: number) => void;

type CallOptions = {
  model: string;
  systemPrompt: string;
  userContent: string;
  reasoning?: boolean;
  temperature?: number;
  onProgress?: ProgressFn;
};

type CallResult = {
  content: string;
  reasoning?: string;
  promptTokens?: number;
  completionTokens?: number;
};

/** OpenAI-compatible SSE stream chunk */
type SseChunk = {
  choices?: { delta?: { content?: string; reasoning_content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

/**
 * Parse a single SSE line and return the parsed JSON event payload, or null.
 * DeepSeek/OpenAI-compatible streaming uses "data: {...}\n" with "data: [DONE]" terminator.
 */
export function parseSseLine(line: string): unknown | null | "DONE" {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const body = trimmed.slice(5).trim();
  if (body === "[DONE]") return "DONE";
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

async function callDeepSeekStreaming(opts: CallOptions): Promise<CallResult> {
  if (!API_KEY) {
    return {
      content:
        "Error: DEEPSEEK_API_KEY is not set on the MCP server. " +
        "Configure it in the server's environment.",
    };
  }

  const start = Date.now();
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: [
      { role: "system", content: opts.systemPrompt },
      { role: "user", content: opts.userContent },
    ],
    stream: true,
    stream_options: { include_usage: true },
  };

  if (opts.reasoning) {
    body.reasoning_effort = "high";
    body.thinking = { type: "enabled" };
  } else if (typeof opts.temperature === "number") {
    body.temperature = opts.temperature;
  }

  let resp: AxiosResponse | undefined;
  try {
    resp = await axios.post(`${BASE_URL}/chat/completions`, body, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      timeout: TIMEOUT_MS,
      responseType: "stream",
    });
  } catch (err) {
    const dur = Date.now() - start;
    const ax = err as AxiosError<{ error?: { message?: string } }>;
    const status = ax.response?.status;
    const msg = ax.response?.data?.error?.message ?? ax.message;
    await log(`ERR connect model=${opts.model} dur=${dur}ms status=${status ?? "-"} msg=${msg}`);
    return { content: `DeepSeek API error (status=${status ?? "n/a"}): ${msg}` };
  }

  let content = "";
  let reasoning = "";
  let buffer = "";
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;
  let lastProgressAt = 0;
  let tokenCount = 0;

  const sendProgress = (force = false) => {
    if (!opts.onProgress) return;
    const now = Date.now();
    if (!force && now - lastProgressAt < PROGRESS_INTERVAL_MS) return;
    lastProgressAt = now;
    // Show last ~80 chars of whatever is being generated, prefer content over reasoning
    const peekSource = content || reasoning;
    const peek = peekSource.replace(/\s+/g, " ").trim().slice(-80);
    const prefix = content ? "✍️" : "💭";
    const tag = content ? "writing" : "thinking";
    const msg = peek
      ? `${prefix} DeepSeek ${tag} (${tokenCount} tok): …${peek}`
      : `${prefix} DeepSeek ${tag} (${tokenCount} tok)…`;
    opts.onProgress(msg, tokenCount);
  };

  // Process each SSE event
  await new Promise<void>((resolve, reject) => {
    const stream = resp!.data as NodeJS.ReadableStream;
    stream.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let nlIdx;
      while ((nlIdx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nlIdx);
        buffer = buffer.slice(nlIdx + 1);
        const ev = parseSseLine(line);
        if (ev === null) continue;
        if (ev === "DONE") {
          resolve();
          return;
        }
        // OpenAI-compatible chunk shape
        const chunk = ev as SseChunk;
        const choice = chunk?.choices?.[0];
        const delta = choice?.delta ?? {};
        if (typeof delta.content === "string" && delta.content) {
          content += delta.content;
          tokenCount++;
          sendProgress();
        }
        if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
          reasoning += delta.reasoning_content;
          tokenCount++;
          sendProgress();
        }
        const usage = chunk?.usage;
        if (usage) {
          promptTokens = usage.prompt_tokens;
          completionTokens = usage.completion_tokens;
        }
      }
    });
    stream.on("end", () => resolve());
    stream.on("error", (e) => reject(e));
  }).catch(async (e) => {
    await log(`ERR stream model=${opts.model} msg=${(e as Error).message}`);
  });

  // One last progress update at completion
  sendProgress(true);

  const dur = Date.now() - start;
  await log(
    `OK model=${opts.model} reasoning=${!!opts.reasoning} stream=true ` +
      `dur=${dur}ms in=${promptTokens ?? "?"} out=${completionTokens ?? tokenCount}`,
  );

  const result: CallResult = { content };
  if (reasoning) result.reasoning = reasoning;
  if (promptTokens !== undefined) result.promptTokens = promptTokens;
  if (completionTokens !== undefined) result.completionTokens = completionTokens;
  return result;
}

export function formatResult(r: CallResult): string {
  if (r.reasoning && r.reasoning.trim()) {
    return `<thinking>\n${r.reasoning.trim()}\n</thinking>\n\n${r.content || "(empty)"}`;
  }
  return r.content || "(empty)";
}

// ---------------- file helpers ----------------
export function isSafePath(p: string): boolean {
  if (typeof p !== "string" || p.length === 0) return false;
  if (p.includes("\0")) return false;
  return true;
}

async function readFileCapped(absPath: string): Promise<string> {
  const stat = await fs.stat(absPath);
  if (!stat.isFile()) throw new Error(`not a file: ${absPath}`);
  if (stat.size > MAX_FILE_BYTES) {
    const fh = await fs.open(absPath, "r");
    try {
      const buf = Buffer.alloc(MAX_FILE_BYTES);
      await fh.read(buf, 0, MAX_FILE_BYTES, 0);
      return buf.toString("utf8") + `\n\n[... truncated; original size ${stat.size} bytes]`;
    } finally {
      await fh.close();
    }
  }
  return await fs.readFile(absPath, "utf8");
}

type GatherResult = { blob: string; included: string[]; skipped: string[] };

async function gatherFiles(filePaths: string[]): Promise<GatherResult> {
  const included: string[] = [];
  const skipped: string[] = [];
  let totalBytes = 0;
  let blob = "";

  const slice = filePaths.slice(0, MAX_FILES);
  if (filePaths.length > MAX_FILES) {
    skipped.push(`${filePaths.length - MAX_FILES} extra path(s) over MAX_FILES=${MAX_FILES}`);
  }

  for (const raw of slice) {
    if (!isSafePath(raw)) {
      skipped.push(`${raw} (unsafe path)`);
      continue;
    }
    const abs = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
    try {
      const c = await readFileCapped(abs);
      const bytes = Buffer.byteLength(c, "utf8");
      if (totalBytes + bytes > MAX_TOTAL_BYTES) {
        skipped.push(`${raw} (would exceed total context budget)`);
        continue;
      }
      totalBytes += bytes;
      blob += `\n\n===== FILE: ${raw} =====\n${c}\n===== END FILE: ${raw} =====`;
      included.push(raw);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      skipped.push(`${raw} (${msg})`);
    }
  }

  return { blob, included, skipped };
}

async function walkTree(rootDir: string, maxDepth = MAX_TREE_DEPTH): Promise<string> {
  const lines: string[] = [];
  const rootAbs = path.resolve(rootDir);

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      if (e.name.startsWith(".") && !["env.example", "gitignore"].includes(e.name.slice(1))) {
        continue;
      }
      const full = path.join(dir, e.name);
      const rel = path.relative(rootAbs, full) || e.name;
      const indent = "  ".repeat(depth);
      lines.push(`${indent}${e.isDirectory() ? "📂" : "📄"} ${rel}`);
      if (e.isDirectory()) await walk(full, depth + 1);
    }
  }

  await walk(rootAbs, 0);
  return lines.join("\n") || "(empty)";
}

// ---------------- skill content (shared with skills/deepseek-junior/SKILL.md) ----------------
const SKILL_INSTRUCTIONS = `# DeepSeek Junior — when and how to delegate

You have four DeepSeek tools (\`deepseek_explore\`, \`deepseek_implement\`,
\`deepseek_review\`, \`deepseek_ask\`) that act as a junior developer you orchestrate.

## When to delegate

- **Multi-step plans:** the user wants several files modified and you have a
  plan. For each "mechanical" step (one file, one well-defined change) call
  \`deepseek_implement\` with the relevant files attached.
- **Codebase scanning:** the user references a folder you haven't read.
  Call \`deepseek_explore\` first to find the right files — read only those.
- **Pre-commit safety:** before suggesting an irreversible change in
  security-sensitive, financial, or user-facing code, run \`deepseek_review\`.
- **Generating variations:** when you need 2–3 candidate approaches without
  spending your own context — \`deepseek_ask\` with \`reasoning=true\`.

## When NOT to delegate

- The task is small enough you'd write it yourself in 1–2 turns.
- The task needs the conversation history (DeepSeek doesn't see prior turns —
  re-pass anything it must know).
- The user explicitly wants you to do it.

## How to use the tools well

1. **Be precise.** DeepSeek doesn't see your conversation. Spell out: goal,
   constraints, edge cases, how the result will be consumed.
2. **Pass only relevant files** via the \`files\` parameter. The server reads
   them from disk; 50 files / 8 MB hard limit per call.
3. **Apply changes yourself.** DeepSeek returns code; you write it to disk
   with your native edit tools. Don't ask DeepSeek to "save" anything.
4. **Iterate freely.** Flash is fast and cheap; if the first answer is off,
   refine the instruction and call again.

## Cost shape (rough)

- \`deepseek_explore\` (Flash): cheapest, fastest. Default for navigation.
- \`deepseek_implement\` / \`deepseek_review\` (Pro + thinking): heavier but
  solves real coding tasks. Use when output quality matters.
`;

// ---------------- server ----------------
const server = new McpServer({
  name: "deepseek-junior",
  version: "0.2.1",
});

type McpExtra = {
  _meta?: { progressToken?: unknown };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendNotification?: (msg: any) => Promise<void>;
};

// Helper: extract progressToken from extra arg, return a sender (or no-op)
export function makeProgressSender(extra: McpExtra): ProgressFn {
  const token = extra?._meta?.progressToken;
  const send = extra?.sendNotification;
  if (token === undefined || typeof send !== "function") {
    return () => {};
  }
  return async (message: string, tokens: number) => {
    try {
      await send({
        method: "notifications/progress",
        params: {
          progressToken: token,
          progress: tokens,
          // total is intentionally omitted — DeepSeek max is dynamic
          message,
        },
      });
    } catch {
      /* ignore */
    }
  };
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

    const meta =
      included.length || skipped.length
        ? `\n\n---\n[included: ${included.length}; skipped: ${skipped.join(", ") || "none"}]`
        : "";
    return { content: [{ type: "text", text: formatResult(r) + meta }] };
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

    const meta =
      `\n\n---\n[files included: ${included.join(", ") || "none"}` +
      (skipped.length ? `; skipped: ${skipped.join(", ")}` : "") +
      "]";
    return { content: [{ type: "text", text: formatResult(r) + meta }] };
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
      return {
        content: [
          {
            type: "text",
            text: `No files could be read. Skipped: ${skipped.join(", ") || "none"}`,
          },
        ],
      };
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

    const meta =
      `\n\n---\n[reviewed: ${included.join(", ")}` +
      (skipped.length ? `; skipped: ${skipped.join(", ")}` : "") +
      "]";
    return { content: [{ type: "text", text: formatResult(r) + meta }] };
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
    const meta =
      included.length || skipped.length
        ? `\n\n---\n[files: ${included.length} included` +
          (skipped.length ? `, ${skipped.length} skipped` : "") +
          "]"
        : "";
    return { content: [{ type: "text", text: formatResult(r) + meta }] };
  },
);

// ---------------- prompt: skill content as a slash command ----------------
// Claude Desktop surfaces MCP prompts as slash commands. So a user / agent
// can do "/deepseek_junior" to inject the skill instructions into context.
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

// ---------------- bootstrap ----------------
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

// Only start the server when run directly (not imported for testing)
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
