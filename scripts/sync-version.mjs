import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

const pkg = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf-8"));

for (const file of ["manifest.json", "plugin.json"]) {
  const filePath = resolve(rootDir, file);
  const content = JSON.parse(readFileSync(filePath, "utf-8"));
  content.version = pkg.version;
  writeFileSync(filePath, JSON.stringify(content, null, 2) + "\n");
  console.log(`✓ ${file} → ${pkg.version}`);
}
