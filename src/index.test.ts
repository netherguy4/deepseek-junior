import { describe, it, expect, vi } from "vitest";
import { parseSseLine, isSafePath, formatResult, makeProgressSender } from "./index.js";

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

// ========== isSafePath ==========
describe("isSafePath", () => {
  it("accepts a normal relative path", () => {
    expect(isSafePath("src/index.ts")).toBe(true);
  });

  it("accepts a normal absolute path", () => {
    expect(isSafePath("/home/user/file.txt")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(isSafePath("")).toBe(false);
  });

  it("rejects null-byte paths", () => {
    expect(isSafePath("foo\0bar")).toBe(false);
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
    // Even though TS says content is required, runtime could pass anything
    const result = formatResult({ content: undefined as unknown as string });
    expect(result).toBe("(empty)");
  });
});

// ========== makeProgressSender ==========
describe("makeProgressSender", () => {
  it("returns a no-op function when no progressToken", () => {
    const sender = makeProgressSender({});
    expect(() => sender("msg", 10)).not.toThrow();
  });

  it("returns a no-op when sendNotification is not a function", () => {
    const sender = makeProgressSender({ _meta: { progressToken: "abc" } });
    expect(() => sender("msg", 10)).not.toThrow();
  });

  it("calls sendNotification with correct params when token is present", async () => {
    const sendNotification = vi.fn().mockResolvedValue(undefined);
    const sender = makeProgressSender({
      _meta: { progressToken: "tok123" },
      sendNotification,
    });

    await sender("test message", 42);

    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification).toHaveBeenCalledWith({
      method: "notifications/progress",
      params: {
        progressToken: "tok123",
        progress: 42,
        message: "test message",
      },
    });
  });

  it("silently catches errors thrown by sendNotification", async () => {
    const sendNotification = vi.fn().mockRejectedValue(new Error("boom"));
    const sender = makeProgressSender({
      _meta: { progressToken: "tok123" },
      sendNotification,
    });

    expect(() => sender("msg", 10)).not.toThrow();
    await sender("msg", 10); // promise resolves since catch suppresses
  });
});
