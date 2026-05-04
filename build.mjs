// Bundles src/index.ts into a single self-contained server/index.js.
// The bundle has a Node shebang, no external deps required at install time.
import * as esbuild from "esbuild";
import { mkdirSync, chmodSync } from "node:fs";

mkdirSync("server", { recursive: true });

await esbuild.build({
  entryPoints: ["index.ts"],
  bundle: true,
  outfile: "server/index.js",
  platform: "node",
  target: "node20",
  format: "esm",
  // The shebang from src/index.ts is preserved automatically by esbuild.
  // We only inject createRequire so any transitive CJS dep that needs require() still works.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  external: [],
  legalComments: "none",
  minify: false, // keep readable; .mcpb is local anyway
  sourcemap: false,
  logLevel: "info",
});

// Make the output executable on Unix
try {
  chmodSync("server/index.js", 0o755);
} catch {
  /* non-Unix */
}

console.log("✓ bundled to server/index.js");
