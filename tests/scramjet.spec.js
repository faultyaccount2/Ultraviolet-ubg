import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const production = Boolean(process.env.TEST_BASE_URL);
const target = "http://fixture.example/";

async function openScramjet(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Scramjet transport", { exact: true }).selectOption("wisp");
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(page.locator("#route-button")).toHaveText("Scramjet");
  await page.getByRole("textbox", { name: "Search or enter a URL", exact: true }).fill(target);
  await page.getByRole("textbox", { name: "Search or enter a URL", exact: true }).press("Enter");
  const host = page.frameLocator(".tab-page:not([hidden]) > iframe");
  const frame = host.frameLocator("#site");
  await expect(frame.getByRole("heading", { name: "Scramjet fixture", exact: true })).toBeVisible();
  await expect(frame.locator("#api")).toContainText("API loaded");
  return { host, frame };
}

test("configured Bare is default, loads modules and APIs, and remains switchable to Wisp", async ({ page }) => {
  test.skip(production, "Uses local Bare and Wisp protocol fixtures.");
  await page.route("**/runtime-config.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: `window.BROMINE_CONFIG=${JSON.stringify({
      scramjetOrigin: "http://127.0.0.1:4174",
      bareUrl: "http://127.0.0.1:4176/bare/",
      wispUrl: "ws://127.0.0.1:4175/wisp/",
    })};`,
  }));
  const calls = [];
  page.on("request", (request) => { if (request.url().includes(":4176/bare/v3/")) calls.push(request.url()); });
  await page.goto("/");
  await page.locator("#address").fill("https://bare-fixture.org/");
  await page.locator("#address").press("Enter");
  const frame = page.frameLocator(".tab-page:not([hidden]) > iframe").frameLocator("#site");
  await expect(frame.getByRole("heading", { name: "Bare fixture", exact: true })).toBeVisible();
  await expect(frame.locator("#module")).toHaveText("Bare module executed");
  await expect(frame.locator("#api")).toHaveText("Bare API loaded: cookies received");
  expect(calls.length).toBeGreaterThanOrEqual(3);
  await frame.getByRole("link", { name: "Next Bare page" }).click();
  await expect(frame.getByRole("heading", { name: "Next Bare page" })).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Scramjet transport", { exact: true }).selectOption("wisp");
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.locator("#address").fill(target);
  await page.locator("#address").press("Enter");
  await expect(frame.getByRole("heading", { name: "Scramjet fixture", exact: true })).toBeVisible();
  await expect(frame.locator("#api")).toContainText("API loaded");
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Scramjet transport", { exact: true })).toHaveValue("wisp");
});

test("Scramjet is primary and its actual rewriter loads scripts, modules, APIs and navigation over Wisp", async ({ page }) => {
  test.skip(production, "Uses a loopback-only Wisp protocol fixture.");
  const legacyRequests = [];
  page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/proxy") legacyRequests.push(request.url()); });
  const { host, frame } = await openScramjet(page);
  await expect(frame.locator("#script")).toHaveText("Script executed");
  await expect(frame.locator("#module")).toHaveText("Module executed");
  await expect(frame.locator("#url")).toHaveText(target);
  await expect(page.getByRole("tab").locator("img")).toHaveAttribute("src", /^blob:/);
  await expect.poll(() => page.getByRole("tab").locator("img").evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
  expect(await frame.locator("body").evaluate(() => {
    try { return parent.parent.document.title; } catch (error) { return error.name; }
  })).toBe("SecurityError");
  await frame.getByRole("button", { name: "Push fixture route" }).click();
  await expect(page.locator("#address")).toHaveValue(`${target}?route=changed`);
  const afterPush = await page.evaluate(() => JSON.parse(localStorage.getItem("bromine:session")).tabs[0].stack.length);
  await frame.getByRole("button", { name: "Replace fixture route" }).click();
  await expect(page.locator("#address")).toHaveValue(`${target}?route=replaced`);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("bromine:session")).tabs[0].stack.length)).toBe(afterPush);
  await frame.getByRole("link", { name: "Next fixture", exact: true }).click();
  await expect(frame.getByRole("heading", { name: "Next Scramjet fixture", exact: true })).toBeVisible();
  await expect(page.locator("#address")).toHaveValue(`${target}next`);
  await host.locator("body").evaluate(() => parent.postMessage({ type: "bromine:navigate", url: "https://example.com/" }, "*"));
  await expect(page.locator("#address")).toHaveValue(`${target}next`);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(frame.getByRole("heading", { name: "Scramjet fixture", exact: true })).toBeVisible();
  expect(legacyRequests).toEqual([]);
});

test("rejected Bare scripts leave a persistent failure instead of a frame-loaded status", async ({ page }) => {
  test.skip(production, "Uses a local Bare fixture with a rejected script.");
  await page.goto("/");
  await page.locator("#address").fill("https://bare-fixture.org/broken");
  await page.locator("#address").press("Enter");
  await expect(page.locator("#page-status")).toContainText("Website script returned HTTP 400 through Bare");
  await page.getByRole("button", { name: "Loading console", exact: true }).click();
  await expect(page.locator("#console-list")).toContainText("Scramjet frame loaded");
  await page.getByRole("button", { name: "Close loading console", exact: true }).click();
  await expect(page.locator("#page-status")).toContainText("Website script returned HTTP 400 through Bare");
  await page.locator("#address").fill("https://bare-fixture.org/next");
  await page.locator("#address").press("Enter");
  await expect(page.frameLocator(".tab-page:not([hidden]) > iframe").frameLocator("#site").getByRole("heading", { name: "Next Bare page" })).toBeVisible();
  await expect(page.locator("#page-status")).not.toContainText("HTTP 400");
  await page.goto("http://127.0.0.1:4174/");
  await page.getByRole("textbox", { name: "Website URL", exact: true }).fill("https://bare-fixture.org/broken");
  await page.getByRole("button", { name: "Go", exact: true }).click();
  const standalone = page.frameLocator(".standalone-frame:not([hidden])").frameLocator("#site");
  await expect(standalone.locator("body")).toBeAttached();
  await expect(page.locator("#status")).toContainText("Website script returned HTTP 400 through Bare");
  await page.getByRole("textbox", { name: "Website URL", exact: true }).fill("https://bare-fixture.org/next");
  await page.getByRole("button", { name: "Go", exact: true }).click();
  await expect(standalone.getByRole("heading", { name: "Next Bare page" })).toBeVisible();
  await expect(page.locator("#status")).not.toContainText("HTTP 400");
});

test("Scramjet public assets hit its bounded cache and site clearing fetches fresh resources", async ({ page, request }) => {
  test.skip(production, "Uses a deterministic Wisp asset fixture.");
  const { frame } = await openScramjet(page);
  await expect(frame.locator("#module")).toHaveText("Module executed");
  const before = await (await request.get("http://127.0.0.1:4175/stats")).json();
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(frame.locator("#script")).toHaveText("Script executed");
  await expect(frame.locator("#module")).toHaveText("Module executed");
  const warm = await (await request.get("http://127.0.0.1:4175/stats")).json();
  expect(warm["/app.js"]).toBe(before["/app.js"]);
  expect(warm["/module.js"]).toBe(before["/module.js"]);
  await page.getByRole("button", { name: "Loading console", exact: true }).click();
  await expect(page.locator("#console-list")).toContainText("CACHE HIT");
  await page.getByRole("button", { name: "Close loading console", exact: true }).click();
  await page.getByRole("button", { name: "Clear current site cache", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Current site cache cleared");
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(frame.locator("#module")).toHaveText("Module executed");
  const refreshed = await (await request.get("http://127.0.0.1:4175/stats")).json();
  expect(refreshed["/app.js"]).toBe(warm["/app.js"] + 1);
});

test("Scramjet login storage, cookies, site sockets and downloads work without the legacy relay", async ({ page }) => {
  test.skip(production, "Uses fixture-only cookies, storage, sockets and a download.");
  const { frame } = await openScramjet(page);
  await frame.getByRole("button", { name: "Save fixture login" }).click();
  await frame.getByRole("button", { name: "Set fixture cookie" }).click();
  await expect(frame.locator("#cookie")).toHaveText("Cookie saved");
  await page.reload();
  await expect(frame.locator("#storage")).toHaveText("fixture-saved");
  await expect(frame.locator("#api")).toHaveText("API loaded: cookie received");
  await frame.getByRole("button", { name: "Connect fixture socket" }).click();
  await expect(frame.locator("#socket")).toHaveText("echo:hello");
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  await page.locator("#menu").getByRole("button", { name: "Downloads", exact: true }).click();
  await page.getByRole("textbox", { name: "Download URL", exact: true }).fill(`${target}file.txt`);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const download = await downloadPromise;
  expect(await readFile(await download.path(), "utf8")).toBe("Scramjet download through Wisp\n");
  await expect(page.locator("#download-list")).toContainText("scramjet");
});

test("missing Scramjet configuration fails explicitly and Classic requires a manual engine selection", async ({ page }) => {
  test.skip(production, "Overrides only the local public runtime configuration.");
  await page.route("**/runtime-config.js", (route) => route.fulfill({
    contentType: "text/javascript", body: 'window.BROMINE_CONFIG = {};',
  }));
  await page.goto("/");
  await page.locator("#address").fill(target);
  await page.locator("#address").press("Enter");
  await expect(page.getByRole("alert")).toContainText("separate Scramjet frontend origin");
  await expect(page.locator("#route-button")).toHaveText("Scramjet");
  await page.getByRole("button", { name: "Configure Scramjet", exact: true }).click();
  await page.getByLabel("Scramjet frontend origin", { exact: true }).fill(new URL(page.url()).origin);
  await page.getByLabel("Scramjet frontend origin", { exact: true }).press("Tab");
  await expect(page.locator("#notice")).toContainText("separate origin");
  await page.getByLabel("Proxy engine", { exact: true }).selectOption("classic");
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
  await page.locator("#address").fill("https://fixture.example/");
  await page.locator("#address").press("Enter");
  await expect(page.frameLocator(".tab-page:not([hidden]) > iframe").getByRole("heading", { name: "Fixture page", exact: true })).toBeVisible();
  await expect(page.locator("#route-button")).toHaveText("Proxy");
  await expect(page.locator(".tab-page:not([hidden]) > iframe")).not.toHaveAttribute("sandbox", /allow-same-origin/);
});

test("Scramjet clears the current site's saved storage without deleting another site's login", async ({ page }) => {
  test.skip(production, "Uses two bounded synthetic Wisp destinations.");
  const { frame } = await openScramjet(page);
  await frame.getByRole("button", { name: "Save fixture login" }).click();
  await page.locator("#address").fill("http://other.example/");
  await page.locator("#address").press("Enter");
  await expect(frame.locator("#storage")).toHaveText("signed out");
  await frame.getByRole("button", { name: "Save fixture login" }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(frame.locator("#storage")).toHaveText("fixture-saved");
  await page.getByRole("button", { name: "Site routing", exact: true }).click();
  await page.getByRole("button", { name: "Clear this site's saved storage", exact: true }).click();
  await expect(frame.locator("#storage")).toHaveText("signed out");
  await page.locator("#address").fill("http://other.example/");
  await page.locator("#address").press("Enter");
  await expect(frame.locator("#storage")).toHaveText("fixture-saved");
});

test("Scramjet retains document HTTP and verification errors after its load event", async ({ page }) => {
  test.skip(production, "Uses explicit HTTP and verification fixture responses.");
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Scramjet transport", { exact: true }).selectOption("wisp");
  await page.getByRole("button", { name: "Close settings" }).click();
  const frame = page.frameLocator(".tab-page:not([hidden]) > iframe").frameLocator("#site");
  for (const [path, message] of [["not-found", "HTTP 404"], ["challenge", "Site verification required"]]) {
    await page.locator("#address").fill(`${target}${path}`);
    await page.locator("#address").press("Enter");
    await expect(frame.locator("#module")).toHaveText("Module executed");
    await expect(page.locator("#page-status")).toContainText(message);
    await page.getByRole("button", { name: "Loading console", exact: true }).click();
    await expect(page.locator("#console-list")).toContainText("Scramjet frame loaded");
    await page.getByRole("button", { name: "Close loading console", exact: true }).click();
    await expect(page.locator("#page-status")).toContainText(message);
  }
});

test("Scramjet preserves POST form bodies and routes website download links through its manager", async ({ page }) => {
  test.skip(production, "Uses synthetic form and download endpoints.");
  const { frame } = await openScramjet(page);
  await frame.getByRole("button", { name: "POST fixture", exact: true }).click();
  await expect(frame.getByRole("heading", { name: "Posted Scramjet fixture", exact: true })).toBeVisible();
  await expect(frame.locator("body")).toContainText("name=Bromine");
  await expect(page.locator("#address")).toHaveValue(`${target}post`);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await frame.getByRole("link", { name: "Download fixture file", exact: true }).click();
  const download = await downloadPromise;
  expect(await readFile(await download.path(), "utf8")).toBe("Scramjet download through Wisp\n");
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  await page.locator("#menu").getByRole("button", { name: "Downloads", exact: true }).click();
  await expect(page.locator("#download-list")).toContainText("scramjet");
});

test("the standalone Scramjet proxy browses, reloads and downloads without Bromine", async ({ page }) => {
  test.skip(production, "Uses the loopback Scramjet host and Wisp fixture.");
  await page.goto("http://127.0.0.1:4174/");
  await expect(page.getByLabel("Transport", { exact: true })).toHaveValue("bare");
  await page.getByLabel("Transport", { exact: true }).selectOption("wisp");
  await page.getByRole("textbox", { name: "Website URL", exact: true }).fill(target);
  await page.getByRole("button", { name: "Go", exact: true }).click();
  const frame = page.frameLocator(".standalone-frame:not([hidden])").frameLocator("#site");
  await expect(frame.locator("#script")).toHaveText("Script executed");
  await expect(frame.locator("#module")).toHaveText("Module executed");
  await expect(frame.locator("#api")).toContainText("API loaded");
  await expect(page).toHaveTitle("Scramjet fixture - Scramjet");
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(frame.locator("#api")).toContainText("API loaded");
  const downloadPromise = page.waitForEvent("download");
  await frame.getByRole("link", { name: "Download fixture file", exact: true }).click();
  const download = await downloadPromise;
  expect(await readFile(await download.path(), "utf8")).toBe("Scramjet download through Wisp\n");
  await frame.getByRole("link", { name: "Next fixture", exact: true }).click();
  await expect(frame.getByRole("heading", { name: "Next Scramjet fixture", exact: true })).toBeVisible();
  await expect(page.locator("#address")).toHaveValue(`${target}next`);
  expect(new URL(page.url()).origin).toBe("http://127.0.0.1:4174");
});

test("standalone Scramjet tabs preserve pages, open site links in-app, switch and close", async ({ page }) => {
  test.skip(production, "Uses the loopback Scramjet host and Wisp fixture.");
  await page.goto("http://127.0.0.1:4174/");
  await expect(page.getByLabel("Transport", { exact: true })).toHaveValue("bare");
  await page.getByLabel("Transport", { exact: true }).selectOption("wisp");
  await page.locator("#address").fill(target);
  await page.getByRole("button", { name: "Go", exact: true }).click();
  const frame = page.frameLocator(".standalone-frame:not([hidden])").frameLocator("#site");
  await expect(frame.locator("#api")).toContainText("API loaded");
  await frame.locator("#script").evaluate((element) => { element.textContent = "Preserved tab"; });
  await expect(page.getByRole("tab").locator("img")).toBeVisible();
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.locator("#address").fill(`${target}next`);
  await page.getByRole("button", { name: "Go", exact: true }).click();
  await expect(frame.getByRole("heading", { name: "Next Scramjet fixture", exact: true })).toBeVisible();
  await page.getByRole("tab").first().click();
  await expect(page.locator("#address")).toHaveValue(target);
  await expect(frame.locator("#script")).toHaveText("Preserved tab");
  await frame.locator("body").evaluate((body) => {
    const link = body.ownerDocument.createElement("a");
    link.href = "/next";
    link.target = "_blank";
    link.textContent = "Open another tab";
    body.append(link);
  });
  await frame.getByRole("link", { name: "Open another tab" }).click();
  await expect(page.getByRole("tab")).toHaveCount(3);
  await expect(frame.getByRole("heading", { name: "Next Scramjet fixture", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close Scramjet tab", exact: true }).last().click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.getByRole("tab").last()).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Close Scramjet tab", exact: true }).first().click();
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(frame.getByRole("heading", { name: "Next Scramjet fixture", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close Scramjet tab", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.locator("#address")).toHaveValue("");
  await expect(page).toHaveTitle("Bromine Scramjet");
});

test("cross-host script and HTTP redirects stay inside embedded and standalone Scramjet", async ({ page }) => {
  test.skip(production, "Uses deterministic non-Cloudflare redirect fixtures.");
  await openScramjet(page);
  await page.locator("#address").fill(`${target}script-redirect`);
  await page.locator("#address").press("Enter");
  let frame = page.frameLocator(".tab-page:not([hidden]) > iframe").frameLocator("#site");
  await expect(frame.locator("#api")).toContainText("API loaded");
  await expect(page.locator("#address")).toHaveValue("http://other.example/");
  expect(new URL(page.url()).origin).toBe("http://127.0.0.1:4173");
  await page.goto("http://127.0.0.1:4174/");
  await page.getByLabel("Transport", { exact: true }).selectOption("wisp");
  await page.locator("#address").fill(`${target}script-redirect`);
  await page.getByRole("button", { name: "Go", exact: true }).click();
  frame = page.frameLocator(".standalone-frame:not([hidden])").frameLocator("#site");
  await expect(frame.locator("#api")).toContainText("API loaded");
  await expect(page.locator("#address")).toHaveValue("http://other.example/");
  expect(new URL(page.url()).origin).toBe("http://127.0.0.1:4174");
});
