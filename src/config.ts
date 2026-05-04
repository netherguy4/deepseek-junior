import * as path from "node:path";

export const API_KEY = process.env.DEEPSEEK_API_KEY ?? "";
export const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
export const FAST_MODEL = process.env.DEEPSEEK_FAST_MODEL ?? "deepseek-v4-flash";
export const PRO_MODEL = process.env.DEEPSEEK_PRO_MODEL ?? "deepseek-v4-pro";
export const TIMEOUT_MS = Number(process.env.DEEPSEEK_TIMEOUT_MS ?? "300000");
export const PROGRESS_INTERVAL_MS = Number(process.env.DEEPSEEK_PROGRESS_MS ?? "250");
export const LOG_FILE =
  process.env.DEEPSEEK_LOG_FILE ?? path.join(process.cwd(), "deepseek_mcp.log");
export const LOG_ENABLED = (process.env.DEEPSEEK_LOG_ENABLED ?? "true").toLowerCase() !== "false";

export const MAX_FILE_BYTES = 1_000_000;
export const MAX_TOTAL_BYTES = 8_000_000;
export const MAX_FILES = 50;
export const MAX_TREE_DEPTH = 4;

export const SKIP_DIRS = new Set([
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
