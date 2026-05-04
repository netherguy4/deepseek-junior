import { describe, it, expect } from "vitest";
import { parseSseLine } from "../sse.js";
import { formatResult } from "../deepseek.js";

// ========== parseSseLine ==========
describe("parseSseLine", () => {
  it("parses a valid JSON SSE data line", () => {
    const result = parseSseLine('data: {"foo": "bar"}');
    expect(result).toEqual({ foo: "bar" });
  });

  it('returns "DONE" for the [DONE] terminator', () => {
    const result = parseSseLine("data: [DONE]");
    expect(result).toBe("DONE");
  });

  it("returns null for lines without data: prefix", () => {
    expect(parseSseLine("event: message")).toBeNull();
    expect(parseSseLine("")).toBeNull();
    expect(parseSseLine(":comment")).toBeNull();
  });

  it("returns null for empty data: payload", () => {
    expect(parseSseLine("data:")).toBeNull();
    expect(parseSseLine("data: ")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseSseLine("data: {broken")).toBeNull();
  });

  it("handles leading/trailing whitespace after data:", () => {
    const result = parseSseLine("data:  {}\t ");
    expect(result).toEqual({});
  });
});

// ========== formatResult ==========
describe("formatResult", () => {
  it("returns content when no reasoning present", () => {
    const result = formatResult({ content: "hello world" });
    expect(result).toBe("hello world");
  });

  it("returns (empty) when content is empty and no reasoning", () => {
    const result = formatResult({ content: "" });
    expect(result).toBe("(empty)");
  });

  it("wraps reasoning in <thinking> tags before content", () => {
    const result = formatResult({ content: "code", reasoning: "plan" });
    expect(result).toBe("<thinking>\nplan\n</thinking>\n\ncode");
  });

  it("trims reasoning whitespace", () => {
    const result = formatResult({ content: "code", reasoning: "  plan\n" });
    expect(result).toBe("<thinking>\nplan\n</thinking>\n\ncode");
  });

  it("handles undefined content gracefully", () => {
    const result = formatResult({ content: undefined as unknown as string });
    expect(result).toBe("(empty)");
  });
});
