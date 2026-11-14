import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const production = Boolean(process.env.TEST_BASE_URL);
const fixture = "https://fixture.example/";
const target = production ? "https://example.com/" : fixture;

async function setProxyMode(page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Default routing", { exact: true }).selectOption("proxy");
  await page.getByRole("button", { name: "Close settings" }).click();
}

async function openTarget(page, url = target) {
  await page.getByRole("textbox", { name: "Search or enter a URL", exact: true }).fill(url);
  await page.getByRole("textbox", { name: "Search or enter a URL", exact: true }).press("Enter");
  return page.frameLocator(".tab-page:not([hidden]) iframe");
}

test("homepage assets, local icons and favicon load with no console errors or broken glyphs", async ({ page }) => {
  const errors = [];
  const failed = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("requestfailed", (request) => failed.push(request.url()));
  page.on("response", (response) => { if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`); });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "bromine", exact: true })).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(1);
  for (const asset of ["/app.css", "/app.js", "/runtime-config.js", "/icons.svg", "/favicon.svg", "/favicon.ico", "/proxy-client.js"]) {
    const response = await page.request.get(asset);
    expect(response.status(), asset).toBe(200);
  }
  expect(await page.locator("body").innerText()).not.toMatch(/proton\.me|gameowners|[\uE000-\uF8FF]|×/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  expect(failed).toEqual([]);
});

test("tabs, closing the last tab, menu, themes, history and fullscreen work", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.getByRole("tab").first().click();
  await expect(page.getByRole("tab").first()).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab").first().getByRole("button", { name: "Close tab" }).click();
  await expect(page.getByRole("tab")).toHaveCount(1);
  await page.getByRole("button", { name: "Close tab", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(1);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Theme", { exact: true }).selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByLabel("uBlock Origin network filtering", { exact: true })).toBeChecked();
  await page.getByLabel("uBlock Origin network filtering", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("uBlock Origin network filtering", { exact: true })).not.toBeChecked();
  await page.getByLabel("uBlock Origin network filtering", { exact: true }).check();
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByText("No browsing history yet.")).toBeVisible();
  await page.getByRole("button", { name: "Close history" }).click();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Fullscreen", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Fullscreen", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
});

test("example/fixture navigation, back, forward, reload, home and persisted history work", async ({ page }) => {
  await page.goto("/");
  await setProxyMode(page);
  let frame = await openTarget(page);
  await expect(frame.getByRole("heading", { name: production ? "Example Domain" : "Fixture page", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Back", exact: true })).toBeEnabled();
  const next = production ? "https://example.com/?test=bromine" : "https://fixture.example/next?test=bromine";
  frame = await openTarget(page, next);
  await expect(frame.getByRole("heading", { name: production ? "Example Domain" : "Next page", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.locator("#address")).toHaveValue(target);
  await page.getByRole("button", { name: "Forward", exact: true }).click();
  await expect(page.locator("#address")).toHaveValue(next);
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(page.frameLocator(".tab-page:not([hidden]) iframe").getByRole("heading", { name: production ? "Example Domain" : "Next page", exact: true })).toBeVisible();
  if (test.info().project.name === "mobile") {
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.getByRole("button", { name: "Back", exact: true }).click();
  } else await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByRole("heading", { name: "bromine", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.locator("#history-list button")).toHaveCount(2);
  await page.getByRole("searchbox", { name: "Filter history" }).fill("test=bromine");
  await expect(page.locator("#history-list button")).toHaveCount(1);
  await page.getByRole("button", { name: "Clear history", exact: true }).click();
  await expect(page.getByText("No browsing history yet.")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByText("No browsing history yet.")).toBeVisible();
});

test("input errors are explicit and compatibility details are accessible", async ({ page }) => {
  await page.goto("/");
  await openTarget(page, "wss://example.com");
  await expect(page.getByRole("alert")).toContainText("Only HTTP(S)");
  await page.getByRole("button", { name: "See what works." }).click();
  await expect(page.getByRole("dialog")).toContainText("not a VPN");
  await expect(page.getByRole("dialog")).toContainText("not supported");
});

test("resource rewriting, scripts, fetch, relative links, redirects and GET/POST forms work in isolated frames", async ({ page }) => {
  test.skip(production, "Deterministic fixture transport is local-only, never shipped to production.");
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto("/");
  await setProxyMode(page);
  let frame = await openTarget(page, fixture);
  await expect(frame.locator("#script-status")).toHaveText("Script loaded");
  await expect(frame.locator("#fetch-status")).toHaveText("Fetch loaded: hello");
  await expect(frame.locator("h1")).toHaveCSS("color", "rgb(18, 52, 86)");
  expect(await frame.locator("#image").evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect.poll(() => frame.locator("#dynamic-image").evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect.poll(() => frame.locator("#dynamic-html img").evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(frame.locator("#script-status")).toHaveAttribute("data-xhr", "Fetch loaded: xhr");
  await expect(page.locator('iframe')).toHaveAttribute("sandbox", "allow-scripts allow-forms allow-downloads");
  const parentData = await frame.locator("body").evaluate(() => localStorage.getItem("bromine:settings"));
  expect(parentData).toBe(null);
  const parentAccess = await frame.locator("body").evaluate(() => { try { return parent.document.title; } catch (error) { return error.name; } });
  expect(parentAccess).toBe("SecurityError");
  await frame.getByRole("link", { name: "Relative next" }).click();
  await expect(page.locator("#address")).toHaveValue("https://fixture.example/next?hello=world#section");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  frame = page.frameLocator(".tab-page:not([hidden]) iframe");
  await frame.getByRole("link", { name: "Redirect", exact: true }).click();
  await expect(frame.getByRole("heading", { name: "Next page" })).toBeVisible();
  await expect(page.locator("#address")).toHaveValue("https://fixture.example/next?redirected=1");
  frame = await openTarget(page, fixture);
  await frame.getByRole("button", { name: "GET form" }).click();
  await expect(frame.getByRole("heading", { name: "GET result" })).toBeVisible();
  await expect(frame.getByText("hello world", { exact: true })).toBeVisible();
  frame = await openTarget(page, fixture);
  await frame.getByRole("button", { name: "POST form" }).click();
  await expect(frame.getByRole("heading", { name: "POST result" })).toBeVisible();
  await expect(frame.getByText("name=Bromine", { exact: true })).toBeVisible();
  await expect(page.locator("#address")).toHaveValue("https://fixture.example/post");
  expect(errors).toEqual([]);
});

test("search uses the selected engine and correct encoded query", async ({ page }) => {
  test.skip(production, "Production search providers may reject automated requests; no fake search response is deployed.");
  await page.goto("/");
  await setProxyMode(page);
  await page.getByRole("textbox", { name: "Search the web", exact: true }).fill("hello world");
  await page.getByRole("textbox", { name: "Search the web", exact: true }).press("Enter");
  await expect(page.frameLocator(".tab-page:not([hidden]) iframe").getByRole("heading", { name: "Results for hello world" })).toBeVisible();
  await expect(page.locator("#address")).toHaveValue("https://duckduckgo.com/?q=hello%20world");
});

test("Direct stays embedded without native tabs and per-site Proxy overrides persist separately", async ({ page, context }) => {
  await page.goto("/");
  const routeTarget = production ? "https://example.com/" : fixture;
  const routeHeading = production ? "Example Domain" : "Fixture page";
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Default routing", { exact: true }).selectOption("direct");
  await page.getByRole("button", { name: "Close settings" }).click();
  const apiCalls = [];
  page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/proxy") apiCalls.push(request.url()); });
  await openTarget(page, routeTarget);
  await expect(page.locator("#route-button")).toHaveText("Direct");
  await expect(page.locator(".tab-page:not([hidden]) iframe")).toHaveAttribute("src", routeTarget);
  expect(context.pages()).toHaveLength(1);
  expect(apiCalls).toEqual([]);
  await page.getByRole("button", { name: "Site routing" }).click();
  await page.getByLabel("Route", { exact: true }).selectOption("proxy");
  await page.getByRole("button", { name: "Apply and reload", exact: true }).click();
  await expect(page.locator("#route-button")).toHaveText("Proxy");
  await expect(page.frameLocator(".tab-page:not([hidden]) iframe").getByRole("heading", { name: routeHeading })).toBeVisible();
  await page.reload();
  await openTarget(page, routeTarget);
  await expect(page.locator("#route-button")).toHaveText("Proxy");
});

test("live example.com loads through the real proxy with and without trailing slash", async ({ page }) => {
  await page.goto("/");
  for (const value of ["https://example.com", "https://example.com/"]) {
    const response = await page.request.get(`/api/proxy?url=${encodeURIComponent(value)}`);
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain("Example Domain");
    expect(response.headers()["content-security-policy"]).not.toContain("allow-same-origin");
  }
});

test("bookmarks edit/import/export, tab duplication/pinning and reopening work", async ({ page }) => {
  test.skip(production, "Local deterministic navigation fixture.");
  await page.goto("/");
  await setProxyMode(page);
  await openTarget(page, fixture);
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.locator("#menu").getByRole("button", { name: "Bookmarks", exact: true }).click();
  await page.getByRole("button", { name: "Add current page" }).click();
  await page.getByLabel("Title", { exact: true }).fill("My fixture");
  await page.getByLabel("Folder", { exact: true }).fill("Tests");
  await page.getByRole("button", { name: "Save bookmark" }).click();
  await expect(page.locator("#bookmark-list")).toContainText("Tests / My fixture");
  const exportPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  const exported = await exportPromise;
  expect(exported.suggestedFilename()).toBe("bromine-bookmarks.json");
  const data = JSON.parse(await readFile(await exported.path(), "utf8"));
  expect(data[0].title).toBe("My fixture");
  await page.locator("#import-bookmarks").setInputFiles({ name: "bookmarks.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify([{ title: "Imported", url: fixture, folder: "Tests" }])) });
  await expect(page.locator("#bookmark-list")).toContainText("Imported");
  await page.getByRole("button", { name: "Close bookmarks" }).click();
  await page.getByRole("tab").click({ button: "right" });
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.getByRole("tab").last().click({ button: "right" });
  await page.getByRole("button", { name: "Pin / unpin", exact: true }).click();
  await expect(page.getByRole("tab").last()).toHaveClass(/pinned/);
  await page.getByRole("tab").last().click({ button: "right" });
  await page.getByRole("button", { name: "Close tab", exact: true }).last().click();
  await expect(page.getByRole("tab")).toHaveCount(1);
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Reopen closed tab", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
});

test("proxy downloads save the actual file and the request inspector records metadata only", async ({ page }) => {
  test.skip(production, "Local-only downloadable fixture.");
  await page.goto("/");
  await setProxyMode(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Request logging (optional)").check();
  await page.getByRole("button", { name: "Close settings" }).click();
  const frame = await openTarget(page, fixture);
  await expect(frame.locator("#fetch-status")).toHaveText("Fetch loaded: hello");
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Request inspector", exact: true }).click();
  await expect(page.locator("#request-list")).toContainText("https://fixture.example/data?value=hello");
  expect(await page.locator("#request-list").innerText()).not.toContain("Fetch loaded: hello");
  await page.getByRole("button", { name: "Close inspector" }).click();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.locator("#menu").getByRole("button", { name: "Downloads", exact: true }).click();
  await page.getByRole("textbox", { name: "Download URL", exact: true }).fill("https://fixture.example/file.txt");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("file.txt");
  expect(await readFile(await download.path(), "utf8")).toBe("Bromine download fixture\n");
  await expect(page.locator("#download-list")).toContainText("saved");
  await page.getByRole("textbox", { name: "Download URL", exact: true }).fill("https://fixture.example/large.bin");
  const largePromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const large = await largePromise;
  const bytes = await readFile(await large.path());
  expect(bytes.length).toBe(6 * 1024 * 1024);
  expect(bytes.every((byte) => byte === 7)).toBe(true);
});

test("cloaking is user-triggered and applies title/favicon to the about:blank wrapper", async ({ page, context }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("textbox", { name: "Tab title", exact: true }).fill("My browser");
  await page.getByRole("textbox", { name: "Tab title", exact: true }).press("Tab");
  await page.getByLabel("Tab favicon", { exact: true }).selectOption("neutral");
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(page).toHaveTitle("My browser");
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", /favicon-neutral.svg$/);
  const wrapperPromise = context.waitForEvent("page");
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Open about:blank wrapper" }).click();
  const wrapper = await wrapperPromise;
  await expect(wrapper).toHaveURL("about:blank");
  await expect(wrapper).toHaveTitle("My browser");
  await expect(wrapper.frameLocator("iframe").getByRole("heading", { name: "bromine", exact: true })).toBeVisible();
  await wrapper.close();
});

test("bounded public cache stores, hits and clears only Bromine resources", async ({ page }) => {
  test.skip(production, "Public fixture caching is verified locally; no production test fixtures.");
  await page.goto("/");
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Cache", exact: true }).click();
  await page.getByLabel("Public proxy cache", { exact: true }).check();
  await page.getByLabel("Maximum size", { exact: true }).selectOption("64");
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const asset = "/api/proxy?url=https%3A%2F%2Ffixture.example%2Fassets%2Fimage.svg&type=image&cache=1";
  await page.evaluate(async (url) => { await (await fetch(url)).arrayBuffer(); }, asset);
  await expect.poll(async () => page.evaluate(async () => {
    const names = (await caches.keys()).filter((name) => name.startsWith("bromine-cache-"));
    let count = 0;
    for (const name of names) count += (await (await caches.open(name)).keys()).length;
    return count;
  })).toBeGreaterThan(0);
  expect(await page.evaluate(async (url) => (await fetch(url)).headers.get("X-Bromine-Cache"), asset)).toBe("hit");
  await page.getByRole("button", { name: "Clear selected cache" }).click();
  await expect(page.locator("#cache-usage")).toContainText("0 resources");
});

test("policy pages load directly and the WebSocket relay reports missing configuration", async ({ page }) => {
  for (const path of ["/terms", "/privacy", "/legal", "/copyright", "/dmca", "/acceptable-use", "/abuse", "/contact", "/transparency"]) {
    const response = await page.goto(path);
    expect(response.status()).toBe(200);
    await expect(page.locator("#legal-text")).not.toBeEmpty();
  }
  test.skip(production, "Socket boundary test uses the isolated local fixture.");
  await page.goto("/");
  await setProxyMode(page);
  const frame = await openTarget(page, fixture);
  await expect(frame.getByRole("heading", { name: "Fixture page" })).toBeVisible();
  await frame.locator("body").evaluate(() => new Promise((resolve) => {
    const socket = new WebSocket("wss://fixture.example/socket");
    socket.addEventListener("error", () => resolve(socket.readyState), { once: true });
  }));
  await expect(page.getByRole("alert")).toContainText("Supabase project URL and publishable key");
  const wasm = await frame.locator("body").evaluate(async () => Boolean(await WebAssembly.compile(new Uint8Array([0,97,115,109,1,0,0,0]))));
  expect(wasm).toBe(true);
});
