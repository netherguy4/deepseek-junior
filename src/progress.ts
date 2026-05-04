import type { ProgressFn } from "./deepseek.js";

export type McpExtra = {
  _meta?: { progressToken?: unknown };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendNotification?: (msg: any) => Promise<void>;
};

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
          message,
        },
      });
    } catch {
      /* ignore */
    }
  };
}
