import axios, { AxiosError, type AxiosResponse } from "axios";
import { API_KEY, BASE_URL, TIMEOUT_MS, PROGRESS_INTERVAL_MS } from "./config.js";
import { log } from "./logger.js";
import { parseSseLine, type SseChunk } from "./sse.js";

export type ProgressFn = (msg: string, tokens: number) => void;

export type CallOptions = {
  model: string;
  systemPrompt: string;
  userContent: string;
  reasoning?: boolean;
  temperature?: number;
  onProgress?: ProgressFn;
};

export type CallResult = {
  content: string;
  reasoning?: string;
  promptTokens?: number;
  completionTokens?: number;
};

export async function callDeepSeekStreaming(opts: CallOptions): Promise<CallResult> {
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
    const peekSource = content || reasoning;
    const peek = peekSource.replace(/\s+/g, " ").trim().slice(-80);
    const prefix = content ? "✍️" : "💭";
    const tag = content ? "writing" : "thinking";
    const msg = peek
      ? `${prefix} DeepSeek ${tag} (${tokenCount} tok): …${peek}`
      : `${prefix} DeepSeek ${tag} (${tokenCount} tok)…`;
    opts.onProgress(msg, tokenCount);
  };

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
        const sseChunk = ev as SseChunk;
        const choice = sseChunk?.choices?.[0];
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
        const usage = sseChunk?.usage;
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
