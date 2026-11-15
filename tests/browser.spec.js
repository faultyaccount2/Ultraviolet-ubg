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

async function expectPageContent(frame, localHeading) {
  const content = production ? frame.getByText(/This domain is for use in (?:illustrative|documentation) examples/) :
    frame.getByRole("heading", { name: localHeading, exact: true });
  await expect(content).toBeVisible();
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
  await expectPageContent(frame, "Fixture page");
  await expect(page.getByRole("button", { name: "Back", exact: true })).toBeEnabled();
  const next = production ? "https://example.com/?test=bromine" : "https://fixture.example/next?test=bromine";
  frame = await openTarget(page, next);
  await expectPageContent(frame, "Next page");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.locator("#address")).toHaveValue(target);
  await page.getByRole("button", { name: "Forward", exact: true }).click();
  await expect(page.locator("#address")).toHaveValue(next);
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expectPageContent(page.frameLocator(".tab-page:not([hidden]) iframe"), "Next page");
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
  await expect(frame.locator("#script-status")).toHaveAttribute("data-cache", "available");
  const nested = frame.frameLocator("#nested-frame");
  await expect(nested.getByRole("heading", { name: "Nested fixture", exact: true })).toBeVisible();
  expect(await nested.locator("body").evaluate(() => { try { return parent.document.title; } catch (error) { return error.name; } })).toBe("SecurityError");
  await expect(frame.locator("#fetch-status")).toHaveText("Fetch loaded: hello");
  await expect(frame.locator("h1")).toHaveCSS("color", "rgb(18, 52, 86)");
  expect(await frame.locator("#image").evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect.poll(() => frame.locator("#dynamic-image").evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect.poll(() => frame.locator("#dynamic-html img").evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(frame.locator("#script-status")).toHaveAttribute("data-xhr", "Fetch loaded: xhr");
  expect(await frame.locator("#dynamic-image").evaluate(async (image) => {
    await image.decode();
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, 1, 1).data[1];
  })).toBe(128);
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
  await frame.locator('form[method="get"]').evaluate((form) => form.submit());
  await expect(frame.getByRole("heading", { name: "GET result" })).toBeVisible();
  await expect(frame.getByText("hello world", { exact: true })).toBeVisible();
  frame = await openTarget(page, fixture);
  await frame.locator("body").evaluate((body) => {
    const form = document.createElement("form");
    form.action = "/get";
    const input = document.createElement("input");
    input.name = "q"; input.value = "dynamic submission";
    form.append(input); body.append(form);
    form.submit();
  });
  await expect(frame.getByRole("heading", { name: "GET result" })).toBeVisible();
  await expect(frame.getByText("dynamic submission", { exact: true })).toBeVisible();
  frame = await openTarget(page, fixture);
  await frame.getByRole("button", { name: "POST form" }).click();
  await expect(frame.getByRole("heading", { name: "POST result" })).toBeVisible();
  await expect(frame.getByText("name=Bromine", { exact: true })).toBeVisible();
  await expect(page.locator("#address")).toHaveValue("https://fixture.example/post");
  frame = await openTarget(page, fixture);
  await frame.locator('form[method="post"]').evaluate((form) => form.submit());
  await expect(frame.getByRole("heading", { name: "POST result" })).toBeVisible();
  await expect(frame.getByText("name=Bromine", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("site URL getters and sandbox feature detection do not expose proxy implementation URLs", async ({ page }) => {
  test.skip(production, "Deterministic URL and capability fixtures are local-only.");
  await page.goto("/");
  const frame = await openTarget(page, fixture);
  await expect(frame.locator("#script-status")).toHaveText("Script loaded");
  expect(await frame.locator("body").evaluate(() => ({
    url: document.URL,
    uri: document.documentURI,
    base: document.baseURI,
    script: document.querySelector("script[src*='app.js']").src,
    scriptAttribute: document.querySelector("script[src*='app.js']").getAttribute("src"),
    scripts: [...document.scripts].map((script) => script.src).filter(Boolean),
    image: document.querySelector("#dynamic-image").src,
    link: document.querySelector("a").href,
    form: document.querySelector("form").action,
    serviceWorker: "serviceWorker" in navigator,
  }))).toEqual({
    url: fixture, uri: fixture, base: `${fixture}assets/`,
    script: `${fixture}assets/app.js`,
    scriptAttribute: `${fixture}assets/app.js`,
    scripts: [`${fixture}assets/app.js`],
    image: `${fixture}assets/image.svg?dynamic=1`,
    link: `${fixture}next?hello=world#section`,
    form: `${fixture}get`,
    serviceWorker: false,
  });
  expect(await page.evaluate(() => "serviceWorker" in navigator)).toBe(true);
  await expect(page.locator('.tab[aria-selected="true"] img')).toHaveAttribute("src", /url=https%3A%2F%2Ffixture\.example%2Fassets%2Ficon\.svg/);
  expect(await frame.locator("body").evaluate((body) => {
    const image = new Image();
    image.srcset = "data:image/svg+xml,%3Csvg%3E%3C/svg%3E 1x, /assets/image.svg 2x";
    body.append(image);
    return { value: image.srcset, attribute: image.getAttribute("srcset") };
  })).toEqual({
    value: "data:image/svg+xml,%3Csvg%3E%3C/svg%3E 1x, https://fixture.example/assets/image.svg 2x",
    attribute: "data:image/svg+xml,%3Csvg%3E%3C/svg%3E 1x, https://fixture.example/assets/image.svg 2x",
  });
});

test("module graphs, dynamic imports and import.meta assets load through the proxy", async ({ page }) => {
  test.skip(production, "Deterministic module fixtures are local-only.");
  const errors = [];
  const modules = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/proxy" && url.searchParams.get("url")?.includes("/modules/")) modules.push(url);
  });
  await page.goto("/");
  const frame = await openTarget(page, "https://fixture.example/module-page#start");
  await expect(frame.locator("#module-static")).toHaveText("Module graph loaded");
  await expect(frame.locator("#module-dynamic")).toHaveText("Dynamic module loaded");
  await expect(frame.locator("#module-inline-url")).toHaveText("https://fixture.example/module-page#start");
  await expect(frame.locator("#module-added")).toHaveText("Added module loaded");
  await expect.poll(() => frame.locator("#module-image").evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
  expect(await frame.locator("#module-image").evaluate((image) => image.src)).toBe("https://fixture.example/assets/image.svg?module=1");
  expect(modules.length).toBeGreaterThanOrEqual(3);
  expect(modules.every((url) => url.searchParams.get("module") === "1")).toBe(true);
  expect(errors).toEqual([]);
});

test("site scripts see their own routes and navigate without leaving the isolated proxy", async ({ page }) => {
  test.skip(production, "Deterministic routing fixtures are local-only.");
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const frame = await openTarget(page, "https://fixture.example/route-page#start");
  await expect(frame.locator("#inline-route")).toHaveText("https://fixture.example/route-page#start");
  await expect(frame.locator("#script-route")).toHaveText(Array(4).fill("https://fixture.example/route-page#start").join("\n"));
  await expect(page.getByRole("tab", { selected: true })).toContainText("Route fixture");
  await frame.getByRole("button", { name: "Push route" }).click();
  await expect(page.locator("#address")).toHaveValue("https://fixture.example/route-page?state=1");
  await expect(frame.locator("#script-route")).toHaveText(Array(4).fill("https://fixture.example/route-page?state=1").join("\n"));
  await frame.getByRole("button", { name: "Change hash" }).click();
  await expect(frame.locator("#hash-route")).toHaveText("https://fixture.example/route-page?state=1#changed");
  await expect(page.locator("#address")).toHaveValue("https://fixture.example/route-page?state=1#changed");
  await frame.getByRole("button", { name: "Replace route" }).click();
  await expect(frame.getByRole("heading", { name: "Next page", exact: true })).toBeVisible();
  await expect(page.locator("#address")).toHaveValue("https://fixture.example/next?replaced=1");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(frame.getByRole("heading", { name: "Route fixture", exact: true })).toBeVisible();
  await expect(page.locator("#address")).toHaveValue("https://fixture.example/route-page?state=1");
  await frame.getByRole("button", { name: "Inline navigation" }).click();
  await expect(page.locator("#address")).toHaveValue("https://fixture.example/next?inline=1");
  await expect(frame.getByRole("heading", { name: "Next page", exact: true })).toBeVisible();
  await openTarget(page, "https://fixture.example/route-page");
  await frame.getByRole("button", { name: "Assign route" }).click();
  await expect(page.locator("#address")).toHaveValue("https://fixture.example/next?assigned=1");
  await expect(frame.getByRole("heading", { name: "Next page", exact: true })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/");
  expect(await frame.locator("body").evaluate(() => {
    try { return parent.document.title; } catch (error) { return error.name; }
  })).toBe("SecurityError");
  expect(errors).toEqual([]);
});

test("escaped CSS asset URLs survive server and runtime rewriting", async ({ page }) => {
  test.skip(production, "Deterministic CSS escape fixture.");
  await page.goto("/");
  const frame = await openTarget(page, fixture);
  await expect(frame.locator("#fetch-status")).toHaveText("Fetch loaded: hello");
  const requests = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/proxy" && url.searchParams.get("url")?.includes("escape=")) requests.push(url.searchParams.get("url"));
  });
  await frame.locator("body").evaluate(() => {
    document.body.insertAdjacentHTML("beforeend", String.raw`<div style="width:20px;height:20px;background-image:url(/assets/image.svg?escape=\(html\))"></div>`);
    const element = document.createElement("div");
    element.style.cssText = String.raw`width:20px;height:20px;background-image:url(/assets/image.svg?escape=\(style\))`;
    document.body.append(element);
  });
  await expect.poll(() => requests).toEqual(expect.arrayContaining([
    "https://fixture.example/assets/image.svg?escape=(html)",
    "https://fixture.example/assets/image.svg?escape=(style)",
  ]));
});

test("loading diagnostics retain HTTP failures and sandbox errors after frame load", async ({ page }) => {
  test.skip(production, "Deterministic document failure fixture.");
  await page.goto("/");
  let frame = await openTarget(page, "https://fixture.example/verification-page");
  await expect(frame.getByRole("heading", { name: "Verification required" })).toBeVisible();
  await expect(page.locator("#page-status")).toContainText("Site security verification required");
  frame = await openTarget(page, "https://fixture.example/unavailable-page");
  await expect(frame.getByRole("heading", { name: "Unavailable" })).toBeVisible();
  await expect(page.locator("#page-status")).toHaveText("Site returned HTTP 503");
  frame = await openTarget(page, fixture);
  await expect(frame.locator("#fetch-status")).toHaveText("Fetch loaded: hello");
  await frame.locator("body").evaluate(() => {
    dispatchEvent(new ErrorEvent("error", {
      error: new DOMException("do-not-log-this-secret", "SecurityError"),
      filename: "https://fixture.example/failing.js?token=do-not-log-this-secret",
    }));
    dispatchEvent(new Event("load"));
  });
  await expect(page.locator("#page-status")).toHaveText("Page has script errors; functionality may be incomplete");
  await page.getByRole("button", { name: "Loading console", exact: true }).click();
  await expect(page.locator("#console-list")).toContainText("A page script hit a sandbox security restriction");
  await expect(page.locator("#console-list")).toContainText("https://fixture.example/failing.js");
  expect(await page.locator("#console-list").innerText()).not.toContain("do-not-log-this-secret");
  expect(await frame.locator("body").evaluate(() => {
    try { return parent.document.title; } catch (error) { return error.name; }
  })).toBe("SecurityError");
});

test("site login storage is restored before scripts, survives reloads and remains origin scoped", async ({ page }) => {
  test.skip(production, "Synthetic login storage fixture; no real credentials.");
  await page.goto("/");
  let frame = await openTarget(page, "https://fixture.example/storage-page");
  await expect(frame.locator("#stored-login")).toHaveText("signed out");
  await frame.locator("body").evaluate(() => {
    localStorage.token = "Bearer fixture-user";
    localStorage.setItem("device", "fixture-device");
    sessionStorage.setItem("session", "same tab");
    globalThis.__bromineLocation.href = "/storage-page?after-login=1";
  });
  await expect(frame.locator("#stored-login")).toHaveText("Bearer fixture-user");
  await expect(frame.locator("#stored-session")).toHaveText("same tab");
  await expect(frame.locator("#stored-auth")).toHaveText("true");
  expect(await frame.locator("body").evaluate(() => window.name)).toBe("");
  expect(await frame.locator("body").evaluate(() => Object.keys(localStorage).sort())).toEqual(["device", "token"]);
  const nativeReload = page.waitForResponse((response) =>
    response.request().isNavigationRequest() && new URL(response.url()).pathname === "/api/proxy");
  await frame.locator("body").evaluate(() => location.reload());
  await nativeReload;
  await expect(frame.locator("#stored-login")).toHaveText("Bearer fixture-user");
  await expect(frame.locator("#stored-session")).toHaveText("same tab");
  await page.getByRole("button", { name: "Duplicate current tab", exact: true }).click();
  await expect(frame.locator("#stored-login")).toHaveText("Bearer fixture-user");
  await expect(frame.locator("#stored-session")).toHaveText("new session");
  await page.getByRole("tab", { selected: true }).getByRole("button", { name: "Close tab" }).click();
  await expect(frame.locator("#stored-session")).toHaveText("same tab");
  await page.reload();
  frame = await openTarget(page, "https://fixture.example/storage-page");
  await expect(frame.locator("#stored-login")).toHaveText("Bearer fixture-user");
  await expect(frame.locator("#stored-auth")).toHaveText("true");
  await expect(frame.locator("#stored-session")).toHaveText("new session");
  expect(await frame.locator("body").evaluate(() => localStorage.getItem("bromine:settings"))).toBe(null);
  frame = await openTarget(page, "https://fixture.example/storage-redirect");
  await expect(page.locator("#address")).toHaveValue("https://www.google.com/storage-page");
  await expect(frame.locator("#stored-login")).toHaveText("signed out");
  expect(await frame.locator("body").evaluate(() => localStorage.getItem("device"))).toBe(null);
  await frame.locator("body").evaluate(() => parent.postMessage({
    type: "bromine:storage", requestUrl: "https://www.google.com/storage-page", origin: "https://fixture.example",
    area: "local", entries: [["token", "forged"]],
  }, "*"));
  await expect(page.getByRole("alert")).toContainText("out-of-scope site storage update was rejected");
  await frame.locator("body").evaluate(() => parent.postMessage({
    type: "bromine:storage", requestUrl: "https://www.google.com/storage-page", origin: "https://www.google.com",
    bridgeId: "incorrect-frame-capability", area: "local", entries: [["token", "forged"]],
  }, "*"));
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(frame.locator("#stored-login")).toHaveText("signed out");
  frame = await openTarget(page, "https://fixture.example/storage-page");
  await expect(frame.locator("#stored-login")).toHaveText("Bearer fixture-user");
  await frame.locator("body").evaluate(() => {
    delete localStorage.token;
    globalThis.__bromineLocation.href = "/storage-page?logged-out=1";
  });
  await expect(frame.locator("#stored-login")).toHaveText("signed out");
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(frame.locator("#stored-login")).toHaveText("signed out");
  expect(await frame.locator("body").evaluate(() => localStorage.getItem("device"))).toBe("fixture-device");
  await page.getByRole("button", { name: "Site routing", exact: true }).click();
  await page.getByRole("button", { name: "Clear this site's saved storage", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("LocalStorage and SessionStorage were cleared");
  await expect(frame.locator("#stored-login")).toHaveText("signed out");
  expect(await frame.locator("body").evaluate(() => localStorage.getItem("device"))).toBe(null);
});

test("consent-style script type observers do not trigger a proxy mutation loop", async ({ page }) => {
  test.skip(production, "Deterministic consent-observer fixture.");
  await page.goto("/");
  const frame = await openTarget(page, fixture);
  await expect(frame.getByRole("heading", { name: "Fixture page", exact: true })).toBeVisible();
  const mutations = await frame.locator("body").evaluate(() => new Promise((resolve) => {
    const script = document.createElement("script");
    script.type = "text/plain";
    document.body.append(script);
    let count = 0;
    const observer = new MutationObserver(() => {
      count++;
      if (count >= 5) { observer.disconnect(); return; }
      script.type = "text/plain";
      script.setAttribute("type", "text/plain");
    });
    observer.observe(script, { attributes: true, attributeFilter: ["src"] });
    script.src = "/modules/entry.js";
    setTimeout(() => { observer.disconnect(); script.remove(); resolve(count); }, 100);
  }));
  expect(mutations).toBe(1);
});

test("proxied site cookies persist locally and return only to their matching host", async ({ page }) => {
  test.skip(production, "Cookie persistence uses deterministic local fixtures.");
  await page.goto("/");
  await setProxyMode(page);
  const syncResponse = page.waitForResponse((response) =>
    response.url().includes("type=cookie-sync") && response.status() === 204);
  let frame = await openTarget(page, fixture);
  await expect(frame.locator("#script-status")).toHaveText("Script loaded");
  await syncResponse;
  frame = await openTarget(page, "https://fixture.example/cookie-check");
  await expect(frame.getByRole("heading", { name: "Cookie check", exact: true })).toBeVisible();
  await expect(frame.locator("#stored-cookie")).toHaveText("fixture=1");
  expect(await frame.locator("body").evaluate(() => document.cookie)).toBe("fixture=1");
  const sentCookies = await frame.locator("body").evaluate(async () =>
    await (await fetch("/cookie-echo")).text());
  expect(sentCookies).toContain("fixture=1");
  expect(sentCookies).toContain("fixture_http=secret");
  expect(await frame.locator("body").evaluate(async () =>
    await (await fetch("/cookie-echo", { credentials: "omit" })).text())).toBe("(none)");
  frame = await openTarget(page, "https://www.google.com/cookie-check");
  await expect(frame.locator("#stored-cookie")).toHaveText("(none)");
});

test("isolated document caches retain responses without exposing or modifying app caches", async ({ page }) => {
  test.skip(production, "Deterministic storage fixture.");
  await page.goto("/");
  await page.evaluate(async () => {
    const cache = await caches.open("isolation-test");
    await cache.put("https://fixture.example/data", new Response("app-only"));
  });
  const frame = await openTarget(page, fixture);
  await expect(frame.getByRole("heading", { name: "Fixture page", exact: true })).toBeVisible();
  const result = await frame.locator("body").evaluate(async () => {
    const cache = await caches.open("isolation-test");
    const leaked = await cache.match("https://fixture.example/data");
    await cache.put("https://fixture.example/data", new Response("page-only"));
    const first = await (await cache.match("https://fixture.example/data")).text();
    const second = await (await cache.match("https://fixture.example/data")).text();
    await cache.put("https://fixture.example/data", new Response("replacement"));
    const replacement = await (await caches.match("https://fixture.example/data")).text();
    await caches.delete("isolation-test");
    const named = await caches.match("https://fixture.example/data");
    return { leaked: Boolean(leaked), first, second, replacement, named: Boolean(named), retained: await (await cache.match("https://fixture.example/data")).text(), isCache: cache instanceof Cache };
  });
  expect(result).toEqual({ leaked: false, first: "page-only", second: "page-only", replacement: "replacement", named: false, retained: "replacement", isCache: true });
  expect(await page.evaluate(async () => (await (await caches.open("isolation-test")).match("https://fixture.example/data")).text())).toBe("app-only");
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(frame.getByRole("heading", { name: "Fixture page", exact: true })).toBeVisible();
  expect(await frame.locator("body").evaluate(async () => Boolean(await caches.match("https://fixture.example/data")))).toBe(false);
});

test("isolated history routes SPA state and blank-frame history without allowing parent access", async ({ page }) => {
  test.skip(production, "Deterministic history fixture.");
  await page.goto("/");
  const frame = await openTarget(page, fixture);
  await expect(frame.getByRole("heading", { name: "Fixture page", exact: true })).toBeVisible();
  const result = await frame.locator("body").evaluate(() => {
    const blank = document.createElement("iframe");
    blank.src = "about:blank";
    blank.sandbox = "allow-same-origin";
    document.body.append(blank);
    const replace = blank.contentWindow.history.replaceState;
    replace.call(history, { phase: "replace" }, "", "https://fixture.example/next?state=1");
    history.pushState({ phase: "push" }, "", "https://fixture.example/next?state=2");
    let rejected;
    try { history.pushState({}, "", "https://other.example/"); } catch (error) { rejected = error.name; }
    let parentAccess;
    try { parentAccess = parent.document.title; } catch (error) { parentAccess = error.name; }
    return { state: history.state, rejected, parentAccess };
  });
  expect(result).toEqual({ state: { phase: "push" }, rejected: "SecurityError", parentAccess: "SecurityError" });
  await expect(page.locator("#address")).toHaveValue("https://fixture.example/next?state=2");
  await expect(frame.getByRole("heading", { name: "Fixture page", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.locator("#address")).toHaveValue("https://fixture.example/next?state=1");
});

test("classic workers proxy fetch and cache responses without exposing bootstrap messages", async ({ page }) => {
  test.skip(production, "Deterministic worker fixture.");
  await page.goto("/");
  const frame = await openTarget(page, fixture);
  await expect(frame.getByRole("heading", { name: "Fixture page", exact: true })).toBeVisible();
  const response = await frame.locator("body").evaluate(() => new Promise((resolve, reject) => {
    const worker = new Worker(new URL("/assets/worker.js", location.origin));
    const timer = setTimeout(() => { worker.terminate(); reject(new Error("Worker fixture timed out.")); }, 10000);
    worker.onmessage = ({ data }) => { clearTimeout(timer); worker.terminate(); resolve(data); };
    worker.onerror = (event) => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message)); };
    worker.postMessage("run");
  }));
  expect(response).toEqual({
    text: expect.stringContaining("name=worker"), isCache: true,
    url: "https://fixture.example/assets/worker.js", workerUrl: "https://fixture.example/assets/worker.js",
    authenticated: { authenticated: true, method: "PATCH", body: '{"content":"worker"}' },
  });
});

test("fetch preserves a Request body's method, headers and payload while proxying", async ({ page }) => {
  test.skip(production, "Deterministic POST fixture.");
  await page.goto("/");
  const frame = await openTarget(page, fixture);
  const body = await frame.locator("body").evaluate(async () => {
    const request = new Request("/post", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "name=request-body",
    });
    return await (await fetch(request)).text();
  });
  expect(body).toContain("name=request-body");
});

test("authenticated site fetch and XHR preserve tokens and mutations without cross-site credential leakage", async ({ page }) => {
  test.skip(production, "Synthetic authentication fixtures never use real account credentials.");
  await page.goto("/");
  const frame = await openTarget(page, fixture);
  await expect(frame.getByRole("heading", { name: "Fixture page", exact: true })).toBeVisible();
  const result = await frame.locator("body").evaluate(async () => {
    const headers = { Authorization: "Bearer fixture-user", "Content-Type": "application/json" };
    const fetched = await (await fetch(new Request("/authenticated-api", {
      method: "PATCH", headers, body: '{"content":"edited"}',
    }))).json();
    const xhr = await new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open("DELETE", "/authenticated-api");
      for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
      request.onload = () => resolve(JSON.parse(request.responseText));
      request.onerror = () => reject(new Error("Authenticated XHR failed."));
      request.send('{"content":"deleted"}');
    });
    const forged = await fetch("/authenticated-api", { headers: { "X-Bromine-Site-Authorization": "Bearer fixture-user" } });
    const emptyAuthorization = await new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open("POST", "/authenticated-api");
      request.setRequestHeader("Authorization", "");
      request.onload = () => resolve(request.status);
      request.onerror = () => reject(new Error("Signed-out XHR failed."));
      request.send();
    });
    let crossOrigin;
    try { await fetch("https://www.google.com/authenticated-api", { headers }); }
    catch (error) { crossOrigin = error.name; }
    return { fetched, xhr, forgedStatus: forged.status, emptyAuthorization, crossOrigin };
  });
  expect(result).toEqual({
    fetched: { authenticated: true, method: "PATCH", body: '{"content":"edited"}' },
    xhr: { authenticated: true, method: "DELETE", body: '{"content":"deleted"}' },
    forgedStatus: 401, emptyAuthorization: 401, crossOrigin: "SecurityError",
  });
});

test("configured WebSocket relay forwards text through the real browser bridge", async ({ page }) => {
  test.skip(!production || test.info().project.name !== "desktop", "Hosted authenticated relay is checked once, on desktop Chromium.");
  const sockets = [];
  page.on("websocket", (socket) => sockets.push(socket.url()));
  await page.goto("/");
  const config = await page.evaluate(() => ({ url: window.BROMINE_CONFIG?.supabaseUrl, configured: Boolean(window.BROMINE_CONFIG?.supabasePublishableKey) }));
  test.skip(!config.url || !config.configured, "The optional hosted relay is not configured.");
  const frame = await openTarget(page);
  await expectPageContent(frame, "Fixture page");
  const received = await frame.locator("body").evaluate(() => new Promise((resolve, reject) => {
    const socket = new WebSocket("wss://gateway.discord.gg/?v=10&encoding=json");
    const opcodes = [];
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      if (error) reject(new Error(error));
      else resolve(opcodes);
    };
    const timer = setTimeout(() => finish("The browser relay did not acknowledge the heartbeat."), 25000);
    socket.onerror = () => finish("The browser could not connect through the authenticated relay.");
    socket.onclose = (event) => finish(`The relay closed before acknowledgement (${event.code}).`);
    socket.onmessage = (event) => {
      let message;
      try { message = JSON.parse(event.data); }
      catch { finish("The relay returned an invalid text frame."); return; }
      opcodes.push(message.op);
      if (message.op === 10) socket.send(JSON.stringify({ op: 1, d: null }));
      else if (message.op === 11 && opcodes.includes(10)) finish();
    };
  }));
  expect(received).toEqual(expect.arrayContaining([10, 11]));
  expect(sockets).toHaveLength(1);
  expect(new URL(sockets[0]).hostname).toBe(new URL(config.url).hostname);
  expect(new URL(sockets[0]).pathname).toBe("/functions/v1/ws-relay");
});

test("search uses the selected engine and correct encoded query", async ({ page }) => {
  test.skip(production, "Production search providers may reject automated requests; no fake search response is deployed.");
  await page.goto("/");
  await setProxyMode(page);
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Search engine", { exact: true })).toHaveValue("duckduckgo");
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.getByRole("textbox", { name: "Search the web", exact: true }).fill("hello world");
  await page.getByRole("textbox", { name: "Search the web", exact: true }).press("Enter");
  await expect(page.frameLocator(".tab-page:not([hidden]) iframe").getByRole("heading", { name: "Results for hello world" })).toBeVisible();
  await expect(page.locator("#address")).toHaveValue("https://duckduckgo.com/?q=hello%20world");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Search engine", { exact: true }).locator("option")).toHaveText(["DuckDuckGo", "Google"]);
  await page.getByLabel("Search engine", { exact: true }).selectOption("google");
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.reload();
  await openTarget(page, "another search");
  await expect(page.locator("#address")).toHaveValue("https://www.google.com/search?q=another%20search");
  await expect(page.frameLocator(".tab-page:not([hidden]) iframe").getByRole("heading", { name: "Results for another search" })).toBeVisible();
});

test("removed search engine migrates without resetting other saved preferences", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("bromine:settings") || "{}");
    localStorage.setItem("bromine:settings", JSON.stringify({
      ...saved, theme: "charcoal", engine: "bing", adblock: false, colors: { background: "#123456" },
    }));
  });
  await page.reload();
  await expect(page.locator("#notice")).toContainText("replaced with DuckDuckGo");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Search engine", { exact: true })).toHaveValue("duckduckgo");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("bromine:settings")));
  expect(saved).toMatchObject({
    theme: "charcoal", engine: "duckduckgo", adblock: false, colors: { background: "#123456" },
  });
  await page.reload();
  await expect(page.locator("#notice")).toBeHidden();
});

test("color pickers and hex fields update the UI, persist, and reset to the theme", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Background hex", { exact: true }).fill("#123456");
  await page.getByLabel("Background hex", { exact: true }).press("Tab");
  await expect(page.getByLabel("Background color", { exact: true })).toHaveValue("#123456");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(18, 52, 86)");
  await page.getByLabel("Page frame color", { exact: true }).fill("#abcdef");
  await page.getByLabel("Page frame color", { exact: true }).dispatchEvent("input");
  await expect(page.getByLabel("Page frame hex", { exact: true })).toHaveValue("#abcdef");
  await page.getByLabel("Background hex", { exact: true }).fill("#zzzzzz");
  await page.getByLabel("Background hex", { exact: true }).press("Tab");
  await expect(page.getByRole("alert")).toContainText("six-digit hex color");
  await expect(page.getByLabel("Background hex", { exact: true })).toHaveValue("#123456");
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.reload();
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(18, 52, 86)");
  if (!production) {
    await openTarget(page, fixture);
    await expect(page.locator(".tab-page:not([hidden]) iframe")).toHaveCSS("background-color", "rgb(171, 205, 239)");
  }
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Page frame hex", { exact: true })).toHaveValue("#abcdef");
  await page.getByRole("button", { name: "Reset colors to theme" }).click();
  await expect(page.getByLabel("Background hex", { exact: true })).toHaveValue("#1e1e2e");
  await page.getByLabel("Theme", { exact: true }).selectOption("light");
  await expect(page.getByLabel("Background hex", { exact: true })).toHaveValue("#eff1f5");
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.reload();
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(239, 241, 245)");
});

test("new themes apply distinct accessible palettes and appearance settings survive reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const palettes = [];
  for (const theme of ["ocean", "forest", "rose", "contrast"]) {
    await page.getByLabel("Theme", { exact: true }).selectOption(theme);
    palettes.push(await page.evaluate(() => {
      const style = getComputedStyle(document.body);
      const channel = (x) => { x /= 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; };
      const luminance = (color) => color.match(/\d+/g).slice(0, 3).map(Number).map(channel).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
      const a = luminance(style.color), b = luminance(style.backgroundColor);
      return { background: style.backgroundColor, accent: style.getPropertyValue("--accent").trim(), contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
    }));
  }
  expect(new Set(palettes.map((p) => p.background)).size).toBe(4);
  expect(new Set(palettes.map((p) => p.accent)).size).toBe(4);
  expect(palettes.every((p) => p.contrast >= 7)).toBe(true);
  await page.getByLabel("Toolbar density", { exact: true }).selectOption("compact");
  for (const [label, value] of [["Glass opacity", "95"], ["Blur", "8"], ["Saturation", "150"], ["Corner radius", "12"], ["Text size", "16"]]) {
    await page.getByLabel(label, { exact: true }).evaluate((input, value) => {
      input.value = value; input.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
  }
  await page.getByLabel("Show bookmarks bar", { exact: true }).check();
  await page.getByLabel("Show status bar", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "contrast");
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await expect(page.locator("html")).toHaveCSS("font-size", "16px");
  await expect(page.locator("#bookmarks-bar")).toBeVisible();
  await expect(page.locator(".status-bar")).toBeHidden();
  await expect(page.locator("html")).toHaveCSS("--glass-opacity", "95%");
  await expect(page.locator("html")).toHaveCSS("--blur", "8px");
  await expect(page.locator("html")).toHaveCSS("--saturation", "150%");
  await expect(page.locator("html")).toHaveCSS("--radius", "12px");
});

test("quick actions and loading console work with redacted live progress and proxy link downloads", async ({ page, context }) => {
  test.skip(production, "Local diagnostics and download fixture.");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  const frame = await openTarget(page, fixture + "?token=do-not-log-this");
  await expect(frame.locator("#fetch-status")).toHaveText("Fetch loaded: hello");
  await page.getByRole("button", { name: "Copy current URL", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(fixture + "?token=do-not-log-this");
  await frame.locator("body").evaluate(async () => { await fetch("/failed-api"); });
  await page.getByRole("button", { name: "Loading console", exact: true }).click();
  await expect(page.locator("#console-list")).toContainText("Document parsed");
  await expect(page.locator("#console-list")).toContainText("503");
  await expect(page.locator("#console-list")).toContainText("Starting API request");
  const log = await page.locator("#console-list").innerText();
  expect(log).not.toContain("do-not-log-this");
  expect(log).not.toContain("private response body");
  await page.getByRole("button", { name: "Clear loading events", exact: true }).click();
  await expect(page.locator("#console-list")).toHaveText("No loading events yet.");
  await page.getByRole("button", { name: "Close loading console", exact: true }).click();
  const beforeClear = await frame.locator("body").evaluate(() => new Request("/assets/image.svg").url);
  await page.evaluate(async () => {
    const cache = await caches.open("bromine-cache-image-v1");
    for (const site of ["fixture.example", "other.example"]) {
      const url = new URL("/api/proxy", location.origin);
      url.search = new URLSearchParams({ url: "https://cdn.example/asset.svg", origin: `https://${site}/`, type: "image" });
      await cache.put(url, new Response("public CDN asset"));
    }
  });
  await page.getByRole("button", { name: "Clear current site cache", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Current site cache cleared");
  expect(await page.evaluate(async () => (await (await caches.open("bromine-cache-image-v1")).keys())
    .filter((request) => new URL(request.url).searchParams.get("url") === "https://cdn.example/asset.svg")
    .map((request) => new URL(request.url).searchParams.get("origin")))).toEqual(["https://other.example/"]);
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(frame.locator("#fetch-status")).toHaveText("Fetch loaded: hello");
  const afterClear = await frame.locator("body").evaluate(() => new Request("/assets/image.svg").url);
  expect(new URL(afterClear).searchParams.get("cacheVersion")).not.toBe(new URL(beforeClear).searchParams.get("cacheVersion"));
  expect(new URL(afterClear).searchParams.get("url")).toBe("https://fixture.example/assets/image.svg");
  const downloadPromise = page.waitForEvent("download");
  await frame.locator("body").evaluate(() => {
    const link = document.createElement("a"); link.href = "/file.txt"; link.download = "file.txt"; document.body.append(link); link.click();
  });
  const download = await downloadPromise;
  expect(await readFile(await download.path(), "utf8")).toBe("Bromine download fixture\n");
  await page.getByRole("button", { name: "Duplicate current tab", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.getByRole("button", { name: "Toggle fullscreen", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await page.getByRole("button", { name: "Toggle fullscreen", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
  await page.evaluate(() => {
    document.querySelector("#address").value = "https://fixture.example/next";
    document.querySelector("#address-form").requestSubmit();
    document.querySelector('[data-action="stop"]').click();
  });
  await expect(page.locator(".tab-page:not([hidden]) iframe")).toHaveAttribute("src", "about:blank");
  await expect(page.locator("#page-status")).toHaveText("Stopped");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("Direct stays embedded without native tabs and per-site Proxy overrides persist separately", async ({ page, context }) => {
  await page.goto("/");
  const routeTarget = production ? "https://example.com/" : fixture;
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
  await expectPageContent(page.frameLocator(".tab-page:not([hidden]) iframe"), "Fixture page");
  await page.reload();
  await openTarget(page, routeTarget);
  await expect(page.locator("#route-button")).toHaveText("Proxy");
});

test("manual DIRECT route retains native fixture state without transferring it to Proxy", async ({ page, context }) => {
  test.skip(production, "Tests session routing with a fixture, not a live CAPTCHA.");
  await page.route("https://fixture.example/**", (route) => route.fulfill({
    contentType: "text/html",
    body: `<button onclick="localStorage.setItem('verification-fixture', 'complete'); this.textContent = 'Fixture complete'">Complete fixture step</button>
      <p id="session"></p><script>document.querySelector('#session').textContent = localStorage.getItem('verification-fixture') || 'No fixture session';</script>`,
  }));
  await page.goto("/");
  await openTarget(page, fixture);
  await page.getByRole("button", { name: "Site routing" }).click();
  await page.getByRole("button", { name: "Use DIRECT for manual verification" }).click();
  const frame = page.frameLocator(".tab-page:not([hidden]) iframe");
  await expect(page.locator("#route-button")).toHaveText("Direct");
  await expect(page.locator(".tab-page:not([hidden]) iframe")).toHaveAttribute("sandbox", "allow-scripts allow-forms allow-downloads allow-same-origin");
  await frame.getByRole("button", { name: "Complete fixture step" }).click();
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await page.getByRole("tab").first().click();
  await expect(frame.getByRole("button", { name: "Fixture complete" })).toBeVisible();
  expect(context.pages()).toHaveLength(1);
  await page.reload();
  await openTarget(page, fixture);
  await expect(page.locator("#route-button")).toHaveText("Direct");
  await expect(frame.locator("#session")).toHaveText("complete");
  await page.getByRole("button", { name: "Site routing" }).click();
  await page.getByLabel("Route", { exact: true }).selectOption("proxy");
  await page.getByRole("button", { name: "Apply and reload", exact: true }).click();
  await expect(frame.getByRole("heading", { name: "Fixture page", exact: true })).toBeVisible();
  expect(await frame.locator("body").evaluate(() => localStorage.getItem("verification-fixture"))).toBe(null);
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

test("legacy disabled cache settings cannot disable public asset caching or reset other preferences", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Theme", { exact: true }).selectOption("ocean");
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("bromine:settings"));
    localStorage.setItem("bromine:settings", JSON.stringify({ ...saved, cacheEnabled: false }));
    localStorage.setItem("bromine:sites", JSON.stringify({ "fixture.example": { mode: "proxy", adblock: true, cache: false } }));
  });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "ocean");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("bromine:settings")).cacheEnabled)).toBe(true);
  if (!production) {
    await openTarget(page, fixture);
    const src = await page.locator(".tab-page:not([hidden]) iframe").getAttribute("src");
    expect(new URL(src, page.url()).searchParams.get("cache")).toBe("1");
  }
});

test("bounded public cache stores, hits and clears only Bromine resources", async ({ page }) => {
  test.skip(production, "Public fixture caching is verified locally; no production test fixtures.");
  await page.goto("/");
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Cache", exact: true }).click();
  await expect(page.getByText("Public proxy cache: always on", { exact: true })).toBeVisible();
  await page.getByLabel("Maximum size", { exact: true }).selectOption("64");
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const asset = "/api/proxy?url=https%3A%2F%2Ffixture.example%2Fassets%2Fcached.svg%3Fv%3D1&type=image&cache=1";
  const cold = await page.evaluate(async (url) => {
    const start = performance.now(); const response = await fetch(url);
    return { body: await response.text(), duration: performance.now() - start };
  }, asset);
  await expect.poll(async () => page.evaluate(async () => {
    const names = (await caches.keys()).filter((name) => name.startsWith("bromine-cache-"));
    let count = 0;
    for (const name of names) count += (await (await caches.open(name)).keys()).length;
    return count;
  })).toBeGreaterThan(0);
  const warm = await page.evaluate(async (url) => {
    const start = performance.now(); const response = await fetch(url);
    return { body: await response.text(), hit: response.headers.get("X-Bromine-Cache"), duration: performance.now() - start };
  }, asset);
  expect(warm.hit).toBe("hit");
  expect(warm.body).toBe(cold.body);
  console.log(`Public asset cache: cold ${cold.duration.toFixed(1)} ms, warm ${warm.duration.toFixed(1)} ms; no repeated upstream generation.`);
  const agedAsset = asset + "&cacheVersion=aged";
  await page.context().route("**/*cacheVersion=aged", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), age: "30" } });
  });
  await page.evaluate(async (url) => (await fetch(url)).text(), agedAsset);
  await expect.poll(() => page.evaluate(async (url) => {
    const cache = await caches.open("bromine-cache-image-v1");
    const request = (await cache.keys()).find((request) => request.url === new URL(url, location.href).href);
    if (!request) return false;
    const response = await cache.match(request);
    const remaining = Number(response.headers.get("X-Bromine-Expires")) - Date.now();
    return remaining > 0 && remaining <= 30000;
  }, agedAsset)).toBe(true);
  await page.evaluate(async (url) => {
    const cache = await caches.open("bromine-cache-image-v1");
    const request = (await cache.keys()).find((request) => request.url === new URL(url, location.href).href);
    const response = await cache.match(request);
    const headers = new Headers(response.headers); headers.set("X-Bromine-Expires", "1");
    await cache.put(request, new Response(response.body, { headers }));
  }, asset);
  const refreshed = await page.evaluate(async (url) => (await fetch(url)).text(), asset);
  expect(refreshed).not.toBe(cold.body);
  await page.getByRole("button", { name: "Close cache", exact: true }).click();
  const frame = await openTarget(page, fixture);
  await expect(frame.getByRole("heading", { name: "Fixture page", exact: true })).toBeVisible();
  const authenticated = await frame.locator("body").evaluate(() => new Request("/authenticated-api").url);
  await page.evaluate(async (url) => {
    const cache = await caches.open("bromine-cache-http-v1");
    await cache.put(url, new Response("wrong cached user", { headers: { "X-Bromine-Stored": String(Date.now()) } }));
  }, authenticated);
  const privateResponse = await frame.locator("body").evaluate(async () => {
    const response = await fetch("/authenticated-api", { headers: { Authorization: "Bearer fixture-user" } });
    return { cache: response.headers.get("X-Bromine-Cache"), data: await response.json() };
  });
  expect(privateResponse).toEqual({ cache: null, data: { authenticated: true, method: "GET", body: "" } });
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Cache", exact: true }).click();
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
