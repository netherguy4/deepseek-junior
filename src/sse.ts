export type SseChunk = {
  choices?: { delta?: { content?: string; reasoning_content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

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
