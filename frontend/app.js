import { proxyUrl } from "../shared/proxy-url.js";
import { validateNavigation, redactUrl } from "../shared/address.js";
import { routeRequest, parseDomainRules } from "../shared/routing.js";
import { compatibility } from "../shared/compatibility.js";
import { configureCache, cacheCommand } from "./cache.js";
import { Downloads } from "./downloads.js";
import { connectWebSocket } from "./relay.js";

const $ = (selector) => document.querySelector(selector);
const tabs = [];
let selected;
let noticeTimer;
let nextId = 1;
const closedTabs = [];
let contextTab;
let editingBookmark;

function notice(message) {
  $("#notice").textContent = message;
  $("#notice").hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { $("#notice").hidden = true; }, 8000);
}

function readStore(name, fallback, valid) {
  try {
    const raw = localStorage.getItem(name);
    if (raw === null) return fallback;
    const value = JSON.parse(raw);
    if (!valid(value)) throw new Error("Invalid saved data");
    return value;
  } catch {
    notice("Saved browser data could not be read. Defaults are being used.");
    return fallback;
  }
}

function writeStore(name, value) {
  try {
    localStorage.setItem(name, JSON.stringify(value));
  } catch {
    notice("Browser storage is unavailable. Changes will not persist.");
  }
}

const themes = ["mocha", "charcoal", "light", "system"];
const engines = {
  duckduckgo: "https://duckduckgo.com/?q=",
  bing: "https://www.bing.com/search?q=",
  google: "https://www.google.com/search?q=",
};
const defaults = {
  theme: "mocha", engine: "duckduckgo", adblock: true, mode: "proxy",
  proxyDomains: [], restore: false, homepage: "", bookmarksBar: false, statusBar: true,
  accent: "#b4befe", opacity: 82, blur: 18, saturation: 130, radius: 8, density: "normal",
  textSize: 14, logging: false, cacheEnabled: false, cacheLimit: 256, concurrent: 2, cloakTitle: "", cloakIcon: "bromine",
};
const settings = { ...defaults, ...readStore("bromine:settings", defaults,
  (value) => value && themes.includes(value.theme) && Object.hasOwn(engines, value.engine) && typeof value.adblock === "boolean" &&
    (value.mode === undefined || ["automatic", "direct", "proxy"].includes(value.mode)) &&
    (value.proxyDomains === undefined || Array.isArray(value.proxyDomains) && value.proxyDomains.every((rule) => typeof rule === "string")) &&
    (value.accent === undefined || /^#[a-f\d]{6}$/i.test(value.accent)) &&
    ["opacity", "blur", "saturation", "radius", "textSize", "concurrent", "cacheLimit"].every((key) => value[key] === undefined || Number.isFinite(value[key])) &&
    (value.homepage === undefined || typeof value.homepage === "string")) };
const sites = readStore("bromine:sites", {}, (value) => value && !Array.isArray(value) && typeof value === "object" &&
  Object.keys(value).length <= 500 && Object.values(value).every((site) => site && ["automatic", "direct", "proxy"].includes(site.mode) && typeof site.adblock === "boolean" && typeof site.cache === "boolean"));
let bookmarks = readStore("bromine:bookmarks", [], (value) => Array.isArray(value) && value.length <= 500 &&
  value.every((row) => row && typeof row.id === "string" && typeof row.title === "string" && typeof row.url === "string" && typeof row.folder === "string" && /^https?:\/\//.test(row.url)));
let history = readStore("bromine:history", [], (value) => Array.isArray(value) &&
  value.length <= 200 && value.every((row) => row && typeof row.url === "string" &&
    /^https?:\/\//.test(row.url) && typeof row.title === "string" && Number.isFinite(row.time)));
function applyAppearance() {
  document.documentElement.dataset.theme = settings.theme === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "mocha") : settings.theme;
  for (const [name, value] of Object.entries({
    "--accent": settings.accent, "--glass-opacity": `${settings.opacity}%`, "--blur": `${settings.blur}px`,
    "--saturation": `${settings.saturation}%`, "--radius": `${settings.radius}px`, "--ui-size": `${settings.textSize}px`,
  })) document.documentElement.style.setProperty(name, value);
  document.documentElement.dataset.density = settings.density;
  $("#bookmarks-bar").hidden = !settings.bookmarksBar;
  $(".status-bar").hidden = !settings.statusBar;
  const favicon = settings.cloakIcon === "neutral" ? "/favicon-neutral.svg" : "/favicon.svg";
  $('link[rel="icon"]').href = favicon;
  if (settings.cloakTitle) document.title = settings.cloakTitle;
  if (parent !== window) parent.postMessage({ type: "bromine:appearance", title: settings.cloakTitle || document.title, favicon: new URL(favicon, location.href).href }, "*");
}
applyAppearance();
matchMedia("(prefers-color-scheme: light)").addEventListener("change", applyAppearance);
$("#theme").value = settings.theme;
$("#search-engine").value = settings.engine;
$("#adblock").checked = settings.adblock;
$("#proxy-domains").value = settings.proxyDomains.join("\n");
$("#homepage").value = settings.homepage;
$("#cache-enabled").checked = settings.cacheEnabled;
$("#cache-limit").value = String(settings.cacheLimit);
$("#download-concurrent").value = String(settings.concurrent);

function routeFor(url) {
  return routeRequest(url, { mode: settings.mode, sites, defaultRoute: "proxy", rules: { forceProxy: settings.proxyDomains } });
}

function saveSession() {
  if (!settings.restore) return;
  writeStore("bromine:session", { selected: tabs.findIndex((tab) => tab.id === selected), tabs: tabs.map((tab) => ({
    stack: tab.stack.slice(-30).map((row) => ({ url: row.url ? redactUrl(row.url) : null, title: row.title })),
    position: Math.min(tab.position, 29), pinned: Boolean(tab.pinned),
  })) });
}

function addRequest(tab, record) {
  if (!settings.logging) return;
  tab.requests.unshift({ ...record, url: redactUrl(record.url) });
  tab.requests = tab.requests.slice(0, 200);
  if ($("#inspector-dialog").open) renderRequests();
}

function resolveInput(value) {
  const text = value.trim();
  if (!text) throw new Error("Enter a web address or search.");
  let target;
  if (/^[a-z][a-z\d+.-]*:/i.test(text)) target = text;
  else if (!/\s/.test(text) && (text.includes(".") || text.startsWith("localhost") || text.startsWith("["))) target = `https://${text}`;
  else target = engines[settings.engine] + encodeURIComponent(text);
  return validateNavigation(target).href;
}

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `/icons.svg#${name}`);
  svg.append(use);
  svg.setAttribute("aria-hidden", "true");
  return svg;
}

function current() { return tabs.find((tab) => tab.id === selected); }
function entry(tab) { return tab.stack[tab.position]; }

function updateToolbar() {
  const tab = current();
  $("#address").value = entry(tab).url || "";
  $('[data-action="back"]').disabled = tab.position === 0;
  $('[data-action="forward"]').disabled = tab.position === tab.stack.length - 1;
  $("#page-status").textContent = tab.loading ? "Loading…" : tab.status;
  $("#route-button").textContent = entry(tab).url ? (tab.route.mode === "direct" ? "Direct" : "Proxy") : "Proxy";
  $("#route-button").title = tab.route?.reason || "Automatic routing";
  $('[data-action="stop"]').hidden = !tab.loading;
  $('[data-action="reload"]').hidden = tab.loading;
  document.querySelectorAll('[data-action="add-bookmark"]').forEach((button) => { button.disabled = !entry(tab).url; });
  document.title = settings.cloakTitle || `${entry(tab).title} · bromine`;
  if (parent !== window) parent.postMessage({ type: "bromine:appearance", title: document.title, favicon: $('link[rel="icon"]').href }, "*");
}

function selectTab(tab) {
  selected = tab.id;
  for (const item of tabs) {
    item.page.hidden = item !== tab;
    item.button.setAttribute("aria-selected", String(item === tab));
    item.button.tabIndex = item === tab ? 0 : -1;
  }
  updateToolbar();
  saveSession();
}

function closeTab(tab) {
  const index = tabs.indexOf(tab);
  for (const cleanup of tab.relayCleanups || []) cleanup();
  closedTabs.unshift({ stack: tab.stack.map((row) => ({ ...row })), position: tab.position, pinned: tab.pinned });
  closedTabs.splice(20);
  tabs.splice(index, 1);
  tab.page.remove();
  tab.button.remove();
  if (!tabs.length) createTab();
  else if (selected === tab.id) selectTab(tabs[Math.min(index, tabs.length - 1)]);
  saveSession();
}

function createTab() {
  const tab = { id: nextId++, stack: [{ url: null, title: "New tab" }], position: 0, loading: false, status: "Ready", requests: [], pinned: false };
  tab.button = document.createElement("div");
  tab.button.className = "tab";
  tab.button.id = `tab-${tab.id}`;
  tab.button.setAttribute("role", "tab");
  tab.button.setAttribute("aria-controls", `page-${tab.id}`);
  tab.button.draggable = true;
  tab.button.addEventListener("dragstart", (event) => event.dataTransfer.setData("text/bromine-tab", String(tab.id)));
  tab.button.addEventListener("dragover", (event) => event.preventDefault());
  tab.button.addEventListener("drop", (event) => {
    event.preventDefault();
    const dragged = tabs.find((item) => item.id === Number(event.dataTransfer.getData("text/bromine-tab")));
    if (!dragged || dragged === tab) return;
    tabs.splice(tabs.indexOf(dragged), 1);
    tabs.splice(tabs.indexOf(tab), 0, dragged);
    for (const item of tabs) $("#tabs").append(item.button);
    saveSession();
  });
  tab.button.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    contextTab = tab;
    $("#tab-actions-dialog").showModal();
  });
  tab.favicon = document.createElement("img");
  tab.favicon.src = "/favicon.svg";
  tab.favicon.alt = "";
  tab.favicon.addEventListener("error", () => { if (!tab.favicon.src.endsWith("/favicon.svg")) tab.favicon.src = "/favicon.svg"; });
  tab.title = document.createElement("span");
  tab.title.className = "tab-title";
  tab.title.textContent = "New tab";
  const close = document.createElement("button");
  close.className = "icon-button";
  close.setAttribute("aria-label", "Close tab");
  close.title = "Close tab (Alt+W)";
  close.append(icon("close"));
  close.addEventListener("click", (event) => { event.stopPropagation(); closeTab(tab); });
  tab.button.append(tab.favicon, tab.title, close);
  tab.button.addEventListener("click", () => selectTab(tab));
  tab.button.addEventListener("keydown", (event) => {
    if (event.target !== tab.button) return;
    if (["Enter", " "].includes(event.key)) { event.preventDefault(); selectTab(tab); }
    if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      const offset = event.key === "ArrowLeft" ? -1 : 1;
      const next = tabs[(tabs.indexOf(tab) + offset + tabs.length) % tabs.length];
      selectTab(next);
      next.button.focus();
    }
    if (event.key === "Delete") closeTab(tab);
  });
  tab.page = document.createElement("section");
  tab.page.className = "tab-page";
  tab.page.id = `page-${tab.id}`;
  tab.page.setAttribute("role", "tabpanel");
  tab.page.setAttribute("aria-labelledby", tab.button.id);
  $("#tabs").append(tab.button);
  $("#pages").append(tab.page);
  tabs.push(tab);
  selectTab(tab);
  renderPage(tab, true);
  return tab;
}

function renderPage(tab) {
  for (const cleanup of tab.relayCleanups || []) cleanup();
  tab.relayCleanups = new Set();
  tab.page.replaceChildren();
  tab.frame = null;
  tab.title.textContent = entry(tab).title;
  tab.favicon.src = "/favicon.svg";
  if (!entry(tab).url) {
    tab.loading = false;
    tab.status = "Ready";
    tab.page.append($("#home-template").content.cloneNode(true));
    const form = tab.page.querySelector(".home-search");
    form.addEventListener("submit", (event) => { event.preventDefault(); navigate(form.querySelector("input").value, tab); });
    tab.page.querySelectorAll("[data-url]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.url, tab)));
    tab.page.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => actions[button.dataset.action]()));
  } else {
    tab.route = routeFor(entry(tab).url);
    const frame = document.createElement("iframe");
    frame.title = `Web page: ${entry(tab).title}`;
    const direct = tab.route.mode === "direct";
    frame.setAttribute("sandbox", direct && new URL(entry(tab).url).origin !== location.origin ? "allow-scripts allow-forms allow-downloads allow-same-origin" : "allow-scripts allow-forms allow-downloads");
    frame.referrerPolicy = "no-referrer";
    const site = sites[new URL(entry(tab).url).hostname];
    frame.src = direct ? entry(tab).url : proxyUrl(entry(tab).url, { adblock: site?.adblock ?? settings.adblock, logging: settings.logging, cache: site?.cache ?? settings.cacheEnabled });
    frame.addEventListener("load", () => {
      tab.loading = false;
      if (selected === tab.id) updateToolbar();
    });
    tab.frame = frame;
    tab.loading = true;
    tab.status = direct ? "DIRECT · native site session; embedding or verification may still be blocked" : "HTTP(S) page";
    tab.expectedUrl = entry(tab).url;
    tab.page.append(frame);
  }
  if (selected === tab.id) updateToolbar();
  saveSession();
}

function recordNavigation(url, tab, title = new URL(url).hostname) {
  tab.stack.splice(tab.position + 1);
  tab.stack.push({ url, title });
  tab.position = tab.stack.length - 1;
  history.unshift({ url: redactUrl(url), title, time: Date.now(), favicon: "/favicon.svg" });
  history = history.slice(0, 200);
  writeStore("bromine:history", history);
}

function navigate(value, tab = current()) {
  try {
    const url = resolveInput(value);
    recordNavigation(url, tab);
    renderPage(tab, true);
  } catch (error) {
    notice(error.message);
  }
}

function move(offset) {
  const tab = current();
  const position = tab.position + offset;
  if (position < 0 || position >= tab.stack.length) return;
  tab.position = position;
  renderPage(tab, true);
}

function openDialog(name) {
  $("#menu").hidden = true;
  $("#menu-button").setAttribute("aria-expanded", "false");
  if (name === "history") renderHistory();
  if (name === "bookmarks") renderBookmarks();
  if (name === "downloads") renderDownloads();
  if (name === "inspector") renderRequests();
  if (name === "routing") {
    const url = entry(current()).url;
    const host = url ? new URL(url).hostname : null;
    const site = host ? sites[host] : null;
    $("#routing-current").textContent = host ? `${host} · ${current().route.mode} · ${current().route.policy}` : "Choose the default route for new navigations.";
    $("#site-route").value = site?.mode || settings.mode;
    $("#site-adblock").checked = site?.adblock ?? settings.adblock;
    $("#site-cache").checked = site?.cache ?? settings.cacheEnabled;
    $("#verify-direct").disabled = !url;
  }
  if (name === "cache") refreshCache().catch((error) => notice(error.message));
  $(`#${name}-dialog`).showModal();
}

function renderHistory() {
  const filter = $("#history-search").value.toLowerCase();
  $("#history-list").replaceChildren();
  const rows = history.filter((row) => `${row.title} ${row.url}`.toLowerCase().includes(filter));
  if (!rows.length) {
    const empty = document.createElement("li");
    empty.textContent = history.length ? "No matching pages." : "No browsing history yet.";
    $("#history-list").append(empty);
  }
  for (const row of rows) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    const title = document.createElement("strong");
    title.textContent = row.title;
    const detail = document.createElement("small");
    detail.textContent = `${row.url} · ${new Date(row.time).toLocaleString()}`;
    button.append(title, detail);
    button.addEventListener("click", () => { $("#history-dialog").close(); navigate(row.url); });
    li.append(button);
    $("#history-list").append(li);
  }
  $("#clear-history").disabled = !history.length;
}

const actions = {
  "new-tab": () => { createTab(); $("#address").focus(); },
  back: () => move(-1),
  forward: () => move(1),
  reload: () => renderPage(current(), true),
  stop: () => {
    const tab = current();
    tab.frame?.contentWindow.postMessage({ type: "bromine:stop" }, "*");
    if (tab.frame) tab.frame.src = "about:blank";
    tab.loading = false; tab.status = "Stopped"; updateToolbar();
  },
  home: () => {
    if (settings.homepage) return navigate(settings.homepage);
    const tab = current();
    if (entry(tab).url) {
      tab.stack.splice(tab.position + 1);
      tab.stack.push({ url: null, title: "New tab" });
      tab.position = tab.stack.length - 1;
    }
    renderPage(tab);
  },
  settings: () => openDialog("settings"),
  history: () => openDialog("history"),
  about: () => openDialog("about"),
  routing: () => openDialog("routing"),
  bookmarks: () => openDialog("bookmarks"),
  "add-bookmark": () => editBookmark(),
  downloads: () => openDialog("downloads"),
  cache: () => openDialog("cache"),
  inspector: () => openDialog("inspector"),
  cloak: () => {
    const wrapper = window.open("about:blank", "_blank");
    if (!wrapper) return notice("Allow pop-ups to open the user-requested about:blank wrapper.");
    wrapper.opener = null;
    wrapper.document.title = settings.cloakTitle || "bromine";
    wrapper.document.body.style.cssText = "margin:0;height:100vh;overflow:hidden;background:#1e1e2e";
    const favicon = wrapper.document.createElement("link");
    favicon.rel = "icon"; favicon.href = $('link[rel="icon"]').href; wrapper.document.head.append(favicon);
    const frame = wrapper.document.createElement("iframe");
    frame.src = location.origin + "/";
    frame.style.cssText = "border:0;width:100%;height:100%";
    frame.allow = "fullscreen";
    wrapper.document.body.append(frame);
    wrapper.addEventListener("message", (event) => {
      if (event.source !== frame.contentWindow || event.origin !== location.origin || event.data?.type !== "bromine:appearance") return;
      wrapper.document.title = String(event.data.title).slice(0, 160);
      const icon = new URL(event.data.favicon);
      if (icon.origin === location.origin) favicon.href = icon.href;
    });
    $("#menu").hidden = true;
  },
  reopen: () => {
    const saved = closedTabs.shift();
    if (!saved) return notice("There are no recently closed tabs.");
    const tab = createTab();
    tab.stack = saved.stack; tab.position = saved.position; tab.pinned = Boolean(saved.pinned);
    tab.button.classList.toggle("pinned", tab.pinned); renderPage(tab);
  },
  menu: () => {
    $("#menu").hidden = !$("#menu").hidden;
    $("#menu-button").setAttribute("aria-expanded", String(!$("#menu").hidden));
    if (!$("#menu").hidden) $("#menu button").focus();
  },
  fullscreen: async () => {
    $("#menu").hidden = true;
    $("#menu-button").setAttribute("aria-expanded", "false");
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      notice("Fullscreen is unavailable in this browser or embedding context.");
    }
  },
};

document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("click", () => actions[button.dataset.action]());
});
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
document.addEventListener("click", (event) => {
  if (!event.target.closest(".menu-container")) {
    $("#menu").hidden = true;
    $("#menu-button").setAttribute("aria-expanded", "false");
  }
});
$("#address-form").addEventListener("submit", (event) => { event.preventDefault(); navigate($("#address").value); });
$("#address").addEventListener("focus", () => $("#address").select());
$("#history-search").addEventListener("input", renderHistory);
$("#clear-history").addEventListener("click", () => { history = []; writeStore("bromine:history", history); renderHistory(); });
$("#theme").addEventListener("change", (event) => {
  settings.theme = event.target.value;
  applyAppearance();
  writeStore("bromine:settings", settings);
});
for (const [id, key, kind] of [
  ["routing-mode", "mode", "string"], ["restore-tabs", "restore", "boolean"], ["show-bookmarks", "bookmarksBar", "boolean"],
  ["show-status", "statusBar", "boolean"], ["accent", "accent", "string"], ["glass-opacity", "opacity", "number"],
  ["glass-blur", "blur", "number"], ["glass-saturation", "saturation", "number"], ["glass-radius", "radius", "number"],
  ["density", "density", "string"], ["text-size", "textSize", "number"], ["request-logging", "logging", "boolean"],
  ["cloak-title", "cloakTitle", "string"], ["cloak-icon", "cloakIcon", "string"],
]) {
  const input = $(`#${id}`);
  if (kind === "boolean") input.checked = settings[key];
  else input.value = String(settings[key]);
  input.addEventListener("change", () => {
    settings[key] = kind === "boolean" ? input.checked : kind === "number" ? Number(input.value) : input.value;
    applyAppearance(); writeStore("bromine:settings", settings); saveSession();
    if (key === "logging" && !settings.logging) tabs.forEach((tab) => { tab.requests = []; });
    if (key === "mode" || key === "logging") notice("Setting updated. Reload open pages to apply it.");
  });
}
$("#proxy-domains").addEventListener("change", () => {
  try { settings.proxyDomains = parseDomainRules($("#proxy-domains").value); writeStore("bromine:settings", settings); }
  catch (error) { notice(error.message); $("#proxy-domains").value = settings.proxyDomains.join("\n"); }
});
$("#homepage").addEventListener("change", () => {
  try {
    settings.homepage = $("#homepage").value.trim() ? redactUrl(validateNavigation($("#homepage").value.trim()).href) : "";
    writeStore("bromine:settings", settings);
  } catch (error) { notice(error.message); $("#homepage").value = settings.homepage; }
});
$("#apply-site").addEventListener("click", () => {
  const url = entry(current()).url;
  if (url) {
    sites[new URL(url).hostname] = { mode: $("#site-route").value, adblock: $("#site-adblock").checked, cache: $("#site-cache").checked };
    writeStore("bromine:sites", sites);
  } else {
    settings.mode = $("#site-route").value; $("#routing-mode").value = settings.mode;
    writeStore("bromine:settings", settings);
  }
  $("#routing-dialog").close();
  renderPage(current(), true);
});
$("#verify-direct").addEventListener("click", () => {
  $("#site-route").value = "direct";
  $("#apply-site").click();
  notice("This site stays DIRECT for manual verification and login. Browser cookie restrictions still apply. Switching to Proxy does not transfer the session.");
});
$("#search-engine").addEventListener("change", (event) => {
  settings.engine = event.target.value;
  writeStore("bromine:settings", settings);
});
$("#adblock").addEventListener("change", (event) => {
  settings.adblock = event.target.checked;
  writeStore("bromine:settings", settings);
  notice("Network filtering updated. Reload open pages to apply it.");
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    $("#menu").hidden = true;
    $("#menu-button").setAttribute("aria-expanded", "false");
  }
  if (!event.altKey || event.ctrlKey || event.metaKey || $("dialog[open]")) return;
  const shortcuts = { t: actions["new-tab"], w: () => closeTab(current()), l: () => $("#address").focus(), r: actions.reload, ArrowLeft: actions.back, ArrowRight: actions.forward };
  const action = shortcuts[event.key.length === 1 ? event.key.toLowerCase() : event.key];
  if (action) { event.preventDefault(); action(); }
});
window.addEventListener("message", (event) => {
  const tab = tabs.find((item) => item.frame?.contentWindow === event.source);
  const data = event.data;
  if (!tab || !data || typeof data !== "object") return;
  if (data.type === "bromine:navigate" && typeof data.url === "string") {
    navigate(data.url, data.newTab ? createTab() : tab);
  } else if (data.type === "bromine:form" && typeof data.url === "string") {
    try {
      const url = resolveInput(data.url);
      recordNavigation(url, tab);
      tab.expectedUrl = url;
      tab.loading = true;
      tab.title.textContent = entry(tab).title;
      if (selected === tab.id) updateToolbar();
    } catch (error) { notice(error.message); }
  } else if (data.type === "bromine:history" && data.requestUrl === tab.expectedUrl && typeof data.url === "string") {
    try {
      const url = validateNavigation(data.url).href;
      if (new URL(url).origin !== new URL(entry(tab).url).origin) throw new Error("Invalid history origin");
      if (!data.replace) recordNavigation(url, tab, entry(tab).title);
      else entry(tab).url = url;
      if (selected === tab.id) updateToolbar();
      saveSession();
    } catch { notice("The page returned an invalid history update."); }
  } else if (data.type === "bromine:request" && settings.logging && typeof data.url === "string") {
    try {
      validateNavigation(data.url);
      addRequest(tab, { url: data.url, method: data.method === "POST" ? "POST" : "GET", type: String(data.resourceType || "other").slice(0, 30),
        status: typeof data.status === "number" ? data.status : "UNKNOWN", route: "proxy",
        size: Number.isFinite(data.size) ? data.size : null, duration: Number.isFinite(data.duration) ? data.duration : null,
        filter: data.blocked ? "BLOCKED" : data.cache === "hit" ? "CACHE HIT" : data.filterKnown ? "Allowed" : "Unknown" });
    } catch { notice("Invalid request metadata was ignored."); }
  } else if (data.type === "bromine:ready" && data.requestUrl === tab.expectedUrl) {
    try {
      const url = new URL(data.url);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid page address");
      entry(tab).url = url.href;
      entry(tab).title = typeof data.title === "string" && data.title.trim() ? data.title.slice(0, 160) : url.hostname;
      tab.title.textContent = entry(tab).title;
      tab.loading = false;
      tab.status = typeof data.error === "string" ? data.error : "HTTP(S) page";
      if (typeof data.favicon === "string") {
        const favicon = new URL(data.favicon, location.href);
        if (favicon.origin === location.origin && favicon.pathname === "/api/proxy") tab.favicon.src = favicon.href;
      }
      const row = history.find((row) => row.url === tab.expectedUrl);
      if (row) { row.url = redactUrl(url.href); row.title = entry(tab).title; writeStore("bromine:history", history); }
      if (selected === tab.id) updateToolbar();
      saveSession();
    } catch {
      notice("The page returned an invalid browser update.");
    }
  } else if (data.type === "bromine:unsupported" && typeof data.message === "string") {
    notice(data.message.slice(0, 240));
  } else if (data.type === "bromine:websocket" && typeof data.url === "string" && Array.isArray(data.protocols) && event.ports.length === 1) {
    connectWebSocket(tab, data.url, data.protocols, event.ports[0], notice);
  }
});

function editBookmark(row) {
  if (!row && !entry(current()).url) return notice("Open a page before adding a bookmark.");
  editingBookmark = row?.id;
  $("#bookmark-title").value = row?.title || entry(current()).title;
  $("#bookmark-url").value = row?.url || entry(current()).url;
  $("#bookmark-folder").value = row?.folder || "";
  $("#bookmark-editor-dialog").showModal();
}

function saveBookmarks() {
  writeStore("bromine:bookmarks", bookmarks);
  renderBookmarks();
  $("#bookmarks-bar").replaceChildren();
  for (const row of bookmarks.slice(0, 30)) {
    const button = document.createElement("button");
    button.textContent = row.title; button.title = row.url;
    button.addEventListener("click", () => navigate(row.url));
    $("#bookmarks-bar").append(button);
  }
}

function renderBookmarks() {
  const filter = $("#bookmark-search").value.toLowerCase();
  $("#bookmark-list").replaceChildren();
  for (const row of bookmarks.filter((row) => `${row.title} ${row.url} ${row.folder}`.toLowerCase().includes(filter))) {
    const li = document.createElement("li");
    const open = document.createElement("button");
    open.textContent = `${row.folder ? row.folder + " / " : ""}${row.title}`;
    open.addEventListener("click", () => { $("#bookmarks-dialog").close(); navigate(row.url); });
    li.append(open);
    const controls = document.createElement("div"); controls.className = "button-row";
    for (const [label, action] of [["Edit", () => editBookmark(row)], ["Remove", () => { bookmarks = bookmarks.filter((item) => item !== row); saveBookmarks(); }], ["Move up", () => {
      const index = bookmarks.indexOf(row);
      if (index > 0) { [bookmarks[index - 1], bookmarks[index]] = [bookmarks[index], bookmarks[index - 1]]; saveBookmarks(); }
    }]]) {
      const button = document.createElement("button"); button.className = "secondary-button"; button.textContent = label; button.addEventListener("click", action); controls.append(button);
    }
    li.append(controls); $("#bookmark-list").append(li);
  }
  if (!$("#bookmark-list").children.length) $("#bookmark-list").textContent = "No bookmarks found.";
}

$("#bookmark-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const raw = validateNavigation($("#bookmark-url").value).href;
    const url = redactUrl(raw);
    if (url !== raw) notice("Sensitive URL fields were removed from the saved bookmark.");
    const row = { id: editingBookmark || crypto.randomUUID(), url, title: $("#bookmark-title").value.trim().slice(0, 160), folder: $("#bookmark-folder").value.trim().slice(0, 80) };
    if (editingBookmark) bookmarks = bookmarks.map((item) => item.id === editingBookmark ? row : item);
    else {
      if (bookmarks.length >= 500) throw new Error("The bookmark limit is 500 entries.");
      bookmarks.push(row);
    }
    saveBookmarks(); $("#bookmark-editor-dialog").close();
  } catch (error) { notice(error.message); }
});
$("#bookmark-search").addEventListener("input", renderBookmarks);
$("#export-bookmarks").addEventListener("click", () => {
  const blob = URL.createObjectURL(new Blob([JSON.stringify(bookmarks, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = blob; link.download = "bromine-bookmarks.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(blob), 1000);
});
$("#import-bookmarks").addEventListener("change", async (event) => {
  try {
    const file = event.target.files[0];
    if (!file || file.size > 1024 * 1024) throw new Error("Choose a bookmark JSON file smaller than 1 MB.");
    const rows = JSON.parse(await file.text());
    if (!Array.isArray(rows) || rows.length + bookmarks.length > 500) throw new Error("Invalid bookmark file or too many bookmarks.");
    const imported = rows.map((row) => {
      if (!row || typeof row.url !== "string" || typeof row.title !== "string") throw new Error("Invalid bookmark entry.");
      return { id: crypto.randomUUID(), url: redactUrl(validateNavigation(row.url).href), title: row.title.slice(0, 160), folder: typeof row.folder === "string" ? row.folder.slice(0, 80) : "" };
    });
    bookmarks.push(...imported); saveBookmarks();
  } catch (error) { notice(error.message); }
  event.target.value = "";
});
saveBookmarks();

const downloads = new Downloads({
  route: routeFor, options: () => ({ concurrent: settings.concurrent, adblock: settings.adblock }),
  changed: () => { if ($("#downloads-dialog").open) renderDownloads(); writeStore("bromine:downloads", downloads.snapshot()); },
  notify: notice,
});
const priorDownloads = readStore("bromine:downloads", [], (value) => Array.isArray(value) && value.length <= 50 &&
  value.every((row) => row && typeof row.url === "string" && /^https?:\/\//.test(row.url) && typeof row.name === "string" && ["direct", "proxy"].includes(row.route)));
downloads.items = priorDownloads.map((row) => ({ ...row, id: crypto.randomUUID(), status: "historical", chunks: [] }));

function renderDownloads() {
  $("#download-list").replaceChildren();
  for (const row of downloads.items.slice(0, 50)) {
    const li = document.createElement("li");
    const label = document.createElement("p");
    label.textContent = `${row.name} · ${row.route} · ${row.status} · ${(row.size / 1024).toFixed(1)} KB${row.total ? ` / ${(row.total / 1024).toFixed(1)} KB` : ""}${row.speed ? ` · ${(row.speed / 1024).toFixed(1)} KB/s` : ""}${row.error ? ` · ${row.error}` : ""}`;
    li.append(label);
    const controls = document.createElement("div"); controls.className = "button-row";
    const options = row.status === "loading" ? [["Pause", "pause"], ["Cancel", "cancel"]] : row.status === "paused" ? [["Resume", "resume"], ["Cancel", "cancel"]] : row.status === "saved" ? [["Save again", "save"], ["Remove", "remove"]] : row.status === "failed" ? [["Retry", "retry"], ["Remove", "remove"]] : [["Remove", "remove"]];
    for (const [label, action] of options) {
      const button = document.createElement("button"); button.textContent = label; button.className = "secondary-button";
      button.addEventListener("click", () => downloads.action(row, action)); controls.append(button);
    }
    li.append(controls); $("#download-list").append(li);
  }
  if (!downloads.items.length) $("#download-list").textContent = "No downloads yet.";
}
$("#download-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try { downloads.add(validateNavigation($("#download-url").value).href); }
  catch (error) { notice(error.message); }
});
$("#download-concurrent").addEventListener("change", (event) => { settings.concurrent = Number(event.target.value); writeStore("bromine:settings", settings); downloads.pump(); });

async function refreshCache() {
  const stats = await configureCache({ enabled: settings.cacheEnabled, limitMB: settings.cacheLimit });
  $("#cache-usage").textContent = `${(stats.bytes / 1024 / 1024).toFixed(2)} MB / ${stats.limitMB} MB · ${stats.entries} resources`;
}
for (const id of ["cache-enabled", "cache-limit"]) $(`#${id}`).addEventListener("change", async () => {
  settings.cacheEnabled = $("#cache-enabled").checked; settings.cacheLimit = Number($("#cache-limit").value);
  writeStore("bromine:settings", settings);
  try { await refreshCache(); } catch (error) { notice(error.message); }
});
$("#clear-cache").addEventListener("click", async () => {
  try { await cacheCommand({ action: "clear", category: $("#cache-category").value }); await refreshCache(); }
  catch (error) { notice(error.message); }
});
$("#clear-site-cache").addEventListener("click", async () => {
  if (!entry(current()).url) return notice("Open a page to choose its cache.");
  try { await cacheCommand({ action: "clear", site: new URL(entry(current()).url).hostname }); await refreshCache(); }
  catch (error) { notice(error.message); }
});
if (settings.cacheEnabled) refreshCache().catch((error) => notice(error.message));
navigator.serviceWorker?.addEventListener("message", (event) => { if (event.data?.type === "bromine:cache-error") notice(event.data.message); });

function renderRequests() {
  $("#request-list").replaceChildren();
  const filter = $("#inspector-filter").value;
  const rows = current().requests.filter((row) => !filter || row.route === filter || row.type === filter ||
    filter === "blocked" && row.filter === "BLOCKED" || filter === "failed" && Number(row.status) >= 400);
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const value of [`${row.method} ${row.url}`, row.type, row.status, row.route, row.size === null ? "Unknown" : `${row.size} B`, row.duration === null ? "Unknown" : `${row.duration.toFixed(0)} ms`, row.filter]) {
      const td = document.createElement("td"); td.textContent = String(value); tr.append(td);
    }
    $("#request-list").append(tr);
  }
}
$("#inspector-filter").addEventListener("change", renderRequests);
$("#clear-requests").addEventListener("click", () => { current().requests = []; renderRequests(); });
$("#duplicate-tab").addEventListener("click", () => {
  const source = contextTab;
  $("#tab-actions-dialog").close();
  const tab = createTab(); tab.stack = source.stack.map((row) => ({ ...row })); tab.position = source.position; renderPage(tab);
});
$("#pin-tab").addEventListener("click", () => {
  contextTab.pinned = !contextTab.pinned; contextTab.button.classList.toggle("pinned", contextTab.pinned);
  $("#tab-actions-dialog").close(); saveSession();
});
$("#close-context-tab").addEventListener("click", () => { $("#tab-actions-dialog").close(); closeTab(contextTab); });

const session = settings.restore ? readStore("bromine:session", null, (value) => value && Array.isArray(value.tabs) && value.tabs.length <= 30 &&
  value.tabs.every((tab) => Array.isArray(tab.stack) && tab.stack.length > 0 && tab.stack.length <= 30 && Number.isInteger(tab.position) &&
    tab.position >= 0 && tab.position < tab.stack.length && tab.stack.every((row) => row && typeof row.title === "string" && (row.url === null || typeof row.url === "string" && /^https?:\/\//.test(row.url))))) : null;
if (session?.tabs.length) {
  for (const saved of session.tabs) {
    const tab = createTab(); tab.stack = saved.stack; tab.position = saved.position; tab.pinned = Boolean(saved.pinned);
    tab.button.classList.toggle("pinned", tab.pinned); renderPage(tab);
  }
  selectTab(tabs[Math.max(0, Math.min(session.selected || 0, tabs.length - 1))]);
} else createTab();
window.bromineCompatibility = compatibility;
