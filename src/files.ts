import * as fs from "node:fs/promises";
import * as path from "node:path";
import { MAX_FILE_BYTES, MAX_TOTAL_BYTES, MAX_FILES, MAX_TREE_DEPTH, SKIP_DIRS } from "./config.js";

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

export type GatherResult = { blob: string; included: string[]; skipped: string[] };

export async function gatherFiles(filePaths: string[]): Promise<GatherResult> {
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

export async function walkTree(rootDir: string, maxDepth = MAX_TREE_DEPTH): Promise<string> {
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
