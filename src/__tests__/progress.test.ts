import { describe, it, expect, vi } from "vitest";
import { makeProgressSender } from "../progress.js";

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
    await sender("msg", 10);
  });
});
