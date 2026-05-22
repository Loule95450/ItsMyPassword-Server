#!/usr/bin/env node
/**
 * Build the admin UI:
 *   1. Tailwind v4 CLI compiles client/style.css → static/admin.css
 *   2. esbuild bundles client/index.tsx (Preact JSX) → static/admin.js
 */
import { build } from "esbuild";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: root, stdio: "inherit" });
    p.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} → exit ${code}`));
    });
  });
}

console.log("→ tailwindcss admin.css");
await run("npx", [
  "@tailwindcss/cli",
  "-i",
  path.join(root, "src/admin-ui/client/style.css"),
  "-o",
  path.join(root, "src/admin-ui/static/admin.css"),
  "--minify",
]);

console.log("→ esbuild admin.js (Preact JSX)");
await build({
  entryPoints: [path.join(root, "src/admin-ui/client/index.tsx")],
  outfile: path.join(root, "src/admin-ui/static/admin.js"),
  bundle: true,
  format: "esm",
  target: "es2022",
  platform: "browser",
  minify: true,
  sourcemap: false,
  legalComments: "none",
  jsx: "automatic",
  jsxImportSource: "preact",
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "info",
});
