import { build } from "esbuild";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { StaticNetFilteringEngine } from "@gorhill/ubo-core";
import { DEFAULT_BARE_URL, validateBareUrl, validateWispUrl } from "./config.js";

const root = new URL("./", import.meta.url);
const output = new URL("public/", root);

export async function buildScramjetHost(compiledFilters) {
  const wispUrl = process.env.BROMINE_WISP_URL ? validateWispUrl(process.env.BROMINE_WISP_URL) : "";
  const bareUrl = validateBareUrl(process.env.BROMINE_BARE_URL || DEFAULT_BARE_URL);
  const origins = (process.env.BROMINE_APP_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean).map((value) => {
    const url = new URL(value);
    if (url.origin !== value || url.protocol !== "https:" &&
        !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
      throw new Error("BROMINE_APP_ORIGINS must contain exact HTTPS origins (HTTP is allowed only on localhost).");
    }
    return url.origin;
  });
  if (!compiledFilters) {
    const engine = await StaticNetFilteringEngine.create();
    await engine.useLists(await Promise.all(["easylist", "easyprivacy", "custom-exceptions", "extra-exceptions"].map(async (name) => ({
      name, raw: await readFile(new URL(`../filters/${name}.txt`, root), "utf8"),
    }))));
    compiledFilters = await engine.serialize();
  }
  await mkdir(new URL("vendor/", output), { recursive: true });
  const core = import.meta.resolve("@mercuryworkshop/scramjet");
  const controller = import.meta.resolve("@mercuryworkshop/scramjet-controller");
  const ublock = import.meta.resolve("@gorhill/ubo-core");
  await Promise.all([
    ...["scramjet.js", "scramjet.wasm"].map((file) => cp(new URL(file, core), new URL(`vendor/${file}`, output))),
    ...["controller.api.js", "controller.inject.js", "controller.sw.js"].map((file) => cp(new URL(file, controller), new URL(`vendor/${file}`, output))),
    cp(new URL("index.html", root), new URL("index.html", output)),
    cp(new URL("worker.js", root), new URL("worker.js", output)),
    cp(new URL("../public/favicon.svg", root), new URL("favicon.svg", output)),
    cp(new URL("../LICENSE", root), new URL("LICENSE.txt", output)),
    cp(new URL("build/publicsuffixlist.json", ublock), new URL("publicsuffixlist.json", output)),
    writeFile(new URL("filters.json", output), compiledFilters),
    writeFile(new URL("config.js", output), `window.BROMINE_SCRAMJET_CONFIG=${JSON.stringify({ origins, wispUrl, bareUrl })};\n`),
  ]);
  await build({
    absWorkingDir: fileURLToPath(root),
    entryPoints: ["host.js", "engine.js"],
    outdir: fileURLToPath(output),
    bundle: true,
    format: "esm",
    splitting: true,
    target: "es2022",
    minify: true,
    logLevel: "info",
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildScramjetHost();
