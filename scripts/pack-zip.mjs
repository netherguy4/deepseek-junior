import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });
copyFileSync("dist/deepseek-mcp.mcpb", "dist/deepseek-mcp.zip");
console.log("✓ copied dist/deepseek-mcp.mcpb → dist/deepseek-mcp.zip");
