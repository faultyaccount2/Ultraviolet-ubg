// SPDX-License-Identifier: GPL-3.0-or-later
import * as serializer from "@gorhill/ubo-core/js/s14e-serializer.js";
import engine from "@gorhill/ubo-core/js/static-net-filtering.js";
import { FilteringContext } from "@gorhill/ubo-core/js/filtering-context.js";
import publicSuffixList from "@gorhill/ubo-core/lib/publicsuffixlist/publicsuffixlist.js";

let ready;
const context = new FilteringContext();

export function loadFiltering() {
  ready ??= (async () => {
    const responses = await Promise.all([fetch("/filters.json"), fetch("/publicsuffixlist.json")]);
    for (const response of responses) if (!response.ok) throw new Error(`Network filter data returned HTTP ${response.status}.`);
    const [compiled, suffixes] = await Promise.all([responses[0].text(), responses[1].json()]);
    publicSuffixList.fromSelfie(suffixes);
    if (!await engine.unserialize(serializer.deserialize(compiled))) throw new Error("The network filter data could not be loaded.");
  })();
  return ready;
}

export function isBlocked(url, originURL, type) {
  return engine.matchRequest(context.fromDetails({ url, originURL, type })) === 1;
}
