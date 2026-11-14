// SPDX-License-Identifier: GPL-3.0-or-later
import { readFile } from "node:fs/promises";
import { StaticNetFilteringEngine } from "@gorhill/ubo-core";

let enginePromise;
export function filteringEngine() {
  enginePromise ??= (async () => {
    const engine = await StaticNetFilteringEngine.create();
    const compiled = await readFile(new URL("../filters/compiled.json", import.meta.url), "utf8");
    await engine.deserialize(compiled);
    return engine;
  })();
  return enginePromise;
}

export async function isBlocked(url, originURL, type) {
  const engine = await filteringEngine();
  return engine.matchRequest({ url, originURL, type }) === 1;
}
