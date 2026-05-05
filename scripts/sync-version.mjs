import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

const pkg = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf-8"));

// If the tag for this version already exists, delete it so npm can recreate it.
const tag = `v${pkg.version}`;
const existingTags = execSync("git tag -l", { cwd: rootDir, encoding: "utf-8" }).trim().split("\n");
if (existingTags.includes(tag)) {
  execSync(`git tag -d ${tag}`, { cwd: rootDir, stdio: "inherit" });
}

for (const file of ["manifest.json", "plugin.json"]) {
  const filePath = resolve(rootDir, file);
  const content = JSON.parse(readFileSync(filePath, "utf-8"));
  content.version = pkg.version;
  writeFileSync(filePath, JSON.stringify(content, null, 2) + "\n");
  console.log(`✓ ${file} → ${pkg.version}`);
}

execSync("git add manifest.json plugin.json", { cwd: rootDir });
console.log("✓ staged manifest.json plugin.json for version commit");
