import { describe, it, expect } from "vitest";
import { isSafePath } from "../files.js";

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
