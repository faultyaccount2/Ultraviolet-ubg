import { build } from "esbuild";
import { writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { StaticNetFilteringEngine } from "@gorhill/ubo-core";

const worker = await build({
  entryPoints: ["frontend/proxy-worker.js"],
  bundle: true,
  format: "iife",
  target: "es2022",
  minify: true,
  write: false,
});
await build({
  entryPoints: ["frontend/app.js", "frontend/proxy-client.js", "frontend/cache-worker.js", "frontend/legal.js"],
  bundle: true,
  format: "iife",
  target: "es2022",
  outdir: "public",
  minify: true,
  logLevel: "info",
  define: { "globalThis.BROMINE_WORKER_SOURCE": JSON.stringify(worker.outputFiles[0].text) },
});
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
await writeFile("public/version.json", JSON.stringify({ commit }));
const supabaseUrl = process.env.BROMINE_SUPABASE_URL || "";
const supabasePublishableKey = process.env.BROMINE_SUPABASE_PUBLISHABLE_KEY || "";
await writeFile("public/runtime-config.js", `window.BROMINE_CONFIG=${JSON.stringify({ supabaseUrl, supabasePublishableKey })};\n`);
const engine = await StaticNetFilteringEngine.create();
const lists = await Promise.all(["easylist", "easyprivacy", "custom-exceptions", "extra-exceptions"].map(async (name) => ({
  name, raw: await readFile(`filters/${name}.txt`, "utf8"),
})));
await engine.useLists(lists);
await writeFile("filters/compiled.json", await engine.serialize());
console.log("Compiled uBlock Origin network filters and custom exceptions.");
