import * as fs from "node:fs/promises";
import { LOG_ENABLED, LOG_FILE } from "./config.js";

export async function log(line: string): Promise<void> {
  if (!LOG_ENABLED) return;
  const entry = `[${new Date().toISOString()}] ${line}\n`;
  process.stderr.write(entry);
  try {
    await fs.appendFile(LOG_FILE, entry);
  } catch {
    /* ignore */
  }
}
