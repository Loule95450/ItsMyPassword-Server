#!/usr/bin/env node
/**
 * Builds the admin UI in two passes:
 *   1. Tailwind v4 CLI compiles src/admin-ui/client/style.css → static/admin.css
 *   2. esbuild bundles src/admin-ui/client/main.ts → static/admin.js
 *
 * Both outputs land next to index.html and are served as static
 * assets by /admin/ui/.
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

console.log("→ esbuild admin.js");
await build({
  entryPoints: [path.join(root, "src/admin-ui/client/main.ts")],
  outfile: path.join(root, "src/admin-ui/static/admin.js"),
  bundle: true,
  format: "esm",
  target: "es2022",
  platform: "browser",
  minify: true,
  sourcemap: false,
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "info",
});
