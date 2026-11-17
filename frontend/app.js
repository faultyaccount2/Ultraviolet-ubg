import { proxyUrl } from "../shared/proxy-url.js";
import { validateNavigation, redactUrl } from "../shared/address.js";
import { routeRequest, parseDomainRules } from "../shared/routing.js";
import { compatibility } from "../shared/compatibility.js";
import { configureCache, cacheCommand } from "./cache.js";
import { Downloads } from "./downloads.js";
import { connectWebSocket } from "./relay.js";
import { cookieDomainMatches, decodeSiteCookie, encodeCookieState, encodeSiteCookie } from "../shared/cookie-jar.js";
import { storageSeedPrefix, validStorageEntries } from "../shared/site-storage.js";
import { connectScramjet, scramjetConfig, scramjetControl, scramjetDownload } from "./scramjet.js";
import { validateScramjetOrigin, validateBareUrl, validateWispUrl } from "../scramjet-host/config.js";

const $ = (selector) => document.querySelector(selector);
const tabs = [];
let selected;
let noticeTimer;
let nextId = 1;
const closedTabs = [];
let contextTab;
let editingBookmark;
let consoleRender;

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
    return true;
  } catch {
    notice("Browser storage is unavailable. Changes will not persist.");
    return false;
  }
}

const themes = ["mocha", "obsidian", "ember", "charcoal", "ocean", "forest", "rose", "contrast", "light", "system"];
const engines = {
  duckduckgo: "https://duckduckgo.com/?q=",
  google: "https://www.google.com/search?q=",
};
const colorLabels = {
  background: "Background", surface: "Surface", hover: "Hover",
  text: "Text", muted: "Muted text", frame: "Page frame",
  toolbar: "Toolbar", tabs: "Tab bar", status: "Status bar", border: "Border",
};
const hexColor = /^#[a-f\d]{6}$/i;
const defaults = {
  theme: "mocha", engine: "duckduckgo", adblock: true, mode: "proxy",
  proxyEngine: "scramjet", scramjetOrigin: "", wispUrl: "", bareUrl: "", transport: "bare", rain: true,
  proxyDomains: [], restore: true, homepage: "", bookmarksBar: false, statusBar: true,
  accent: "", colors: {}, opacity: 82, blur: 18, saturation: 130, radius: 8, density: "normal",
  textSize: 14, logging: true, cacheEnabled: true, cacheLimit: 256, concurrent: 2, cloakTitle: "", cloakIcon: "bromine",
};
const settings = { ...defaults, ...readStore("bromine:settings", defaults,
  (value) => value && themes.includes(value.theme) && (Object.hasOwn(engines, value.engine) || value.engine === "bing") && typeof value.adblock === "boolean" &&
    (value.mode === undefined || ["automatic", "direct", "proxy"].includes(value.mode)) &&
    (value.proxyEngine === undefined || ["scramjet", "classic"].includes(value.proxyEngine)) &&
    (value.rain === undefined || typeof value.rain === "boolean") &&
    ["scramjetOrigin", "wispUrl", "bareUrl"].every((key) => value[key] === undefined || typeof value[key] === "string") &&
    (value.transport === undefined || ["", "bare", "wisp"].includes(value.transport)) &&
    (value.restore === undefined || typeof value.restore === "boolean") &&
    (value.proxyDomains === undefined || Array.isArray(value.proxyDomains) && value.proxyDomains.every((rule) => typeof rule === "string")) &&
    (value.accent === undefined || value.accent === "" || /^#[a-f\d]{6}$/i.test(value.accent)) &&
    (value.colors === undefined || value.colors && !Array.isArray(value.colors) && typeof value.colors === "object" &&
      Object.entries(value.colors).every(([key, color]) => Object.hasOwn(colorLabels, key) && typeof color === "string" && hexColor.test(color))) &&
    ["opacity", "blur", "saturation", "radius", "textSize", "concurrent", "cacheLimit"].every((key) => value[key] === undefined || Number.isFinite(value[key])) &&
    (value.homepage === undefined || typeof value.homepage === "string")) };
const restoreMigrationDone = readStore("bromine:restore-migrated", false, (value) => typeof value === "boolean");
if (!restoreMigrationDone) {
  if (!settings.restore) {
    settings.restore = true;
    writeStore("bromine:settings", settings);
  }
  writeStore("bromine:restore-migrated", true);
}
if (!settings.cacheEnabled) {
  settings.cacheEnabled = true;
  writeStore("bromine:settings", settings);
}
if (settings.engine === "bing") {
  settings.engine = defaults.engine;
  writeStore("bromine:settings", settings);
  notice("Your removed search engine has been replaced with DuckDuckGo. Other settings are unchanged.");
}
const sites = readStore("bromine:sites", {}, (value) => value && !Array.isArray(value) && typeof value === "object" &&
  Object.keys(value).length <= 500 && Object.values(value).every((site) => site && ["automatic", "direct", "proxy"].includes(site.mode) && typeof site.adblock === "boolean" && typeof site.cache === "boolean"));
const cacheVersions = readStore("bromine:cache-versions", { global: 0, sites: {} }, (value) => value &&
  Number.isSafeInteger(value.global) && value.global >= 0 && value.sites && typeof value.sites === "object" &&
  !Array.isArray(value.sites) && Object.keys(value.sites).length <= 500 &&
  Object.values(value.sites).every((version) => Number.isSafeInteger(version) && version >= 0));
function cacheVersionFor(url) {
  return `${cacheVersions.global}.${cacheVersions.sites[new URL(url).hostname] || 0}`;
}
function invalidateAssetVersion(site) {
  if (site) {
    if (!Object.hasOwn(cacheVersions.sites, site) && Object.keys(cacheVersions.sites).length >= 500) delete cacheVersions.sites[Object.keys(cacheVersions.sites)[0]];
    cacheVersions.sites[site] = Math.max(Date.now(), (cacheVersions.sites[site] || 0) + 1);
  } else cacheVersions.global = Math.max(Date.now(), cacheVersions.global + 1);
  if (!writeStore("bromine:cache-versions", cacheVersions)) throw new Error("The new cache version could not be saved. Browser storage must be available to retain cache clearing across reloads.");
}
let bookmarks = readStore("bromine:bookmarks", [], (value) => Array.isArray(value) && value.length <= 500 &&
  value.every((row) => row && typeof row.id === "string" && typeof row.title === "string" && typeof row.url === "string" && typeof row.folder === "string" && /^https?:\/\//.test(row.url)));
let history = readStore("bromine:history", [], (value) => Array.isArray(value) &&
  value.length <= 200 && value.every((row) => row && typeof row.url === "string" &&
    /^https?:\/\//.test(row.url) && typeof row.title === "string" && Number.isFinite(row.time)));
function applyAppearance() {
  document.documentElement.dataset.theme = settings.theme === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "mocha") : settings.theme;
  for (const choice of document.querySelectorAll("[data-theme-choice]")) {
    const active = choice.dataset.themeChoice === settings.theme;
    if (choice.matches(".theme-card")) choice.setAttribute("aria-pressed", String(active));
    else choice.classList.toggle("is-selected", active);
  }
  document.documentElement.style.removeProperty("--accent");
  for (const [name, value] of Object.entries({
    ...(settings.accent ? { "--accent": settings.accent } : {}), "--glass-opacity": `${settings.opacity}%`, "--blur": `${settings.blur}px`,
    "--saturation": `${settings.saturation}%`, "--radius": `${settings.radius}px`, "--ui-size": `${settings.textSize}px`,
  })) document.documentElement.style.setProperty(name, value);
  for (const key of Object.keys(colorLabels)) {
    document.documentElement.style.removeProperty(`--${key}`);
    if (settings.colors[key]) document.documentElement.style.setProperty(`--${key}`, settings.colors[key]);
  }
  document.documentElement.dataset.density = settings.density;
  document.documentElement.dataset.rain = settings.rain === false ? "off" : "on";
  $("#bookmarks-bar").hidden = !settings.bookmarksBar;
  $(".status-bar").hidden = !settings.statusBar;
  const favicon = settings.cloakIcon === "neutral" ? "/favicon-neutral.svg" : "/favicon.svg";
  $('link[rel="icon"]').href = favicon;
  if (settings.cloakTitle) document.title = settings.cloakTitle;
  if (parent !== window) parent.postMessage({ type: "bromine:appearance", title: settings.cloakTitle || document.title, favicon: new URL(favicon, location.href).href }, "*");
  refreshColorInputs();
}
function refreshColorInputs() {
  const style = getComputedStyle(document.documentElement);
  for (const input of document.querySelectorAll("[data-color]")) {
    input.value = style.getPropertyValue(`--${input.dataset.color}`).trim();
  }
}
for (const [key, label] of Object.entries({ accent: "Accent", ...colorLabels })) {
  const row = document.createElement("div");
  row.className = "setting";
  const title = document.createElement("label");
  title.htmlFor = `color-${key}`;
  title.textContent = label;
  const controls = document.createElement("div");
  controls.className = "color-controls";
  for (const type of ["color", "text"]) {
    const input = document.createElement("input");
    input.type = type;
    input.dataset.color = key;
    input.id = `color-${key}${type === "text" ? "-hex" : ""}`;
    input.setAttribute("aria-label", `${label} ${type === "text" ? "hex" : "color"}`);
    if (type === "text") {
      input.className = "field";
      input.maxLength = 7;
      input.pattern = "#[a-fA-F0-9]{6}";
      input.spellcheck = false;
    }
    input.addEventListener(type === "color" ? "input" : "change", () => {
      if (!hexColor.test(input.value)) {
        notice("Enter a six-digit hex color, such as #1e1e2e.");
        refreshColorInputs();
        return;
      }
      if (key === "accent") settings.accent = input.value.toLowerCase();
      else settings.colors[key] = input.value.toLowerCase();
      applyAppearance();
      writeStore("bromine:settings", settings);
    });
    controls.append(input);
  }
  row.append(title, controls);
  $("#appearance-colors").append(row);
}
$("#reset-colors").addEventListener("click", () => {
  settings.colors = {};
  settings.accent = "";
  applyAppearance();
  writeStore("bromine:settings", settings);
});
applyAppearance();
matchMedia("(prefers-color-scheme: light)").addEventListener("change", applyAppearance);
function startRain() {
  const canvas = $("#rain-canvas");
  const context = canvas?.getContext("2d", { alpha: true });
  if (!context) return;
  const drops = [];
  let width = 0;
  let height = 0;
  let scale = 1;
  function resize() {
    scale = Math.min(window.devicePixelRatio || 1, 1.5);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    context.setTransform(scale, 0, 0, scale, 0, 0);
    const amount = Math.min(150, Math.round(width / 12));
    drops.length = 0;
    for (let index = 0; index < amount; index++) drops.push({
      x: Math.random() * width, y: Math.random() * height, speed: 2 + Math.random() * 5,
      length: 9 + Math.random() * 22, width: .45 + Math.random() * .8, alpha: .08 + Math.random() * .17,
    });
  }
  function draw() {
    context.clearRect(0, 0, width, height);
    if (document.documentElement.dataset.rain === "on" && !document.hidden && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      context.lineCap = "round";
      for (const drop of drops) {
        drop.speed = Math.min(10, drop.speed + .018);
        drop.x += .38;
        drop.y += drop.speed;
        context.beginPath();
        context.strokeStyle = `rgba(213,226,239,${drop.alpha})`;
        context.lineWidth = drop.width;
        context.moveTo(drop.x, drop.y);
        context.lineTo(drop.x - .8, drop.y + drop.length);
        context.stroke();
        if (drop.y > height + drop.length) {
          drop.y = -drop.length - Math.random() * height * .2;
          drop.x = Math.random() * width;
          drop.speed = 2 + Math.random() * 5;
        }
      }
    }
    requestAnimationFrame(draw);
  }
  resize();
  window.addEventListener("resize", resize, { passive: true });
  requestAnimationFrame(draw);
}
startRain();
function updateClock() {
  const clock = $("#os-clock");
  if (clock) clock.textContent = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date());
}
updateClock();
setInterval(updateClock, 30_000);
const settingNavTargets = {
  appearance: "#settings-appearance", connection: "#settings-connection", interface: "#settings-interface",
  privacy: "#settings-privacy", storage: "#settings-storage",
};
document.querySelectorAll("[data-settings-nav]").forEach((button) => button.addEventListener("click", () => {
  const target = $(settingNavTargets[button.dataset.settingsNav]);
  target?.closest("details") && (target.closest("details").open = true);
  target?.scrollIntoView({ behavior: "smooth", block: "start" });
  document.querySelectorAll("[data-settings-nav]").forEach((item) => item.removeAttribute("aria-current"));
  button.setAttribute("aria-current", "true");
}));
const settingExplanations = {
  "proxy-engine": "Scramjet is the standard engine. The legacy option is tucked below for older profiles and compatibility.",
  "scramjet-origin": "The separate site that runs Scramjet. Keep it on a different domain from Bromine.",
  "scramjet-transport": "Choose where site connections go. Wisp requires a server you control or have permission to use.",
  "bare-url": "The Bare endpoint used when Bare is selected. This is public configuration, not a secret.",
  "wisp-url": "Your Wisp WebSocket address. It is stored in this browser; the app does not supply a shared private VM by default.",
  "routing-mode": "Choose whether new sites use the proxy automatically, always use it, or try a direct embedded page.",
  "proxy-domains": "Add one host per line. Use *.example.com for subdomains or =example.com for one exact host.",
  "cloak-title": "Change the browser tab label. This only changes the app's appearance.",
  "cloak-icon": "Choose the icon shown in the browser tab. It does not affect network privacy.",
  homepage: "Leave blank to open the built-in workspace when you create a tab.",
  "restore-tabs": "Reopen your previous Bromine tabs when this browser starts.",
  "show-bookmarks": "Keep saved links visible below the address bar.",
  "show-status": "Show loading messages and the privacy link at the bottom of the window.",
  "rain-effect": "Animate fine rain on the desktop glass. Turn it off to save a little battery.",
  "search-engine": "Choose which search provider receives searches from the address bar.",
  "glass-opacity": "Set how much of the desktop wallpaper shows through the interface.",
  "glass-blur": "Control how strongly the wallpaper softens behind glass surfaces.",
  "glass-saturation": "Adjust color strength in the background seen through glass.",
  "glass-radius": "Set the corner curve for windows, controls and cards.",
  density: "Compact uses less vertical space in the tab and toolbar rows.",
  "text-size": "Change the size of labels and controls across the interface.",
  adblock: "Block matching network requests on proxy pages. This does not hide all ads or trackers.",
  "request-logging": "Keep a short, local record of request addresses and results. Request bodies and cookies are not logged.",
};
for (const [id, explanation] of Object.entries(settingExplanations)) {
  const control = $(`#${id}`);
  const label = control?.closest("label.setting, label.stack-setting");
  if (!label) continue;
  const titleText = [...label.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
  if (titleText) {
    const title = document.createElement("span");
    title.className = "setting-title";
    title.textContent = titleText.textContent.trim();
    titleText.replaceWith(title);
  }
  label.classList.add("has-help");
  const help = document.createElement("small");
  help.className = "setting-help";
  help.textContent = explanation;
  label.append(help);
}
$("#theme").value = settings.theme;
$("#search-engine").value = settings.engine;
$("#adblock").checked = settings.adblock;
$("#proxy-domains").value = settings.proxyDomains.join("\n");
$("#homepage").value = settings.homepage;
$("#cache-limit").value = String(settings.cacheLimit);
$("#download-concurrent").value = String(settings.concurrent);
$("#proxy-engine").value = settings.proxyEngine;
$("#engine-status").textContent = settings.proxyEngine === "scramjet" ? "Scramjet" : "Classic HTTP proxy · legacy";
$("#scramjet-origin").value = settings.scramjetOrigin || window.BROMINE_CONFIG?.scramjetOrigin || "";
$("#wisp-url").value = settings.wispUrl || window.BROMINE_CONFIG?.wispUrl || "";
$("#bare-url").value = settings.bareUrl || window.BROMINE_CONFIG?.bareUrl || "";
$("#scramjet-transport").value = settings.transport || "bare";

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
  addActivity(tab, `${record.method} ${record.type}: ${record.status}${record.duration === null ? "" : ` (${Math.round(record.duration)} ms)`} · ${record.filter}`, {
    url: record.url, level: Number(record.status) >= 400 || record.status === "FAILED" ? "error" : "info",
  });
  if ($("#inspector-dialog").open) renderRequests();
}

function addActivity(tab, message, { level = "info", url } = {}) {
  const record = { time: Date.now(), message, level, url: url ? redactUrl(validateNavigation(url).href) : "" };
  tab.activity.push(record);
  tab.activity = tab.activity.slice(-200);
  if (settings.logging) console.info("[Bromine]", message, record.url);
  if ($("#console-dialog").open && current() === tab && !consoleRender) {
    consoleRender = requestAnimationFrame(() => { consoleRender = 0; renderConsole(); });
  }
}

function renderConsole() {
  const tab = current();
  $("#console-status").textContent = tab.status;
  $("#console-list").replaceChildren();
  for (const row of tab.activity) {
    const li = document.createElement("li");
    li.dataset.level = row.level;
    const time = document.createElement("time");
    time.dateTime = new Date(row.time).toISOString();
    time.textContent = new Date(row.time).toLocaleTimeString();
    li.append(time, document.createTextNode(`${row.message}${row.url ? ` · ${row.url}` : ""}`));
    $("#console-list").append(li);
  }
  if (!tab.activity.length) $("#console-list").textContent = "No loading events yet.";
}

function persistSiteCookie(tab, data) {
  if (tab.route?.mode !== "proxy" || data.requestUrl !== tab.expectedUrl || typeof data.url !== "string") return;
  try {
    const page = validateNavigation(data.url);
    const current = new URL(entry(tab).url || tab.expectedUrl);
    const cookie = decodeSiteCookie(encodeSiteCookie(data.cookie));
    if (!cookie || cookie.httpOnly ||
        (cookie.hostOnly ? cookie.domain !== page.hostname : !cookieDomainMatches(page.hostname, cookie.domain)) ||
        page.hostname !== current.hostname) throw new Error("The page attempted to save an out-of-scope cookie.");
    const key = `${cookie.name}\n${cookie.domain}\n${cookie.path}\n${cookie.hostOnly ? "1" : "0"}`;
    const frame = tab.frame;
    tab.cookieSync = (tab.cookieSync || Promise.resolve()).then(async () => {
      const response = await fetch(proxyUrl(page.href, { origin: page.origin, type: "cookie-sync" }), {
        method: "POST",
        headers: { "X-Bromine-Site-Cookies": encodeCookieState([cookie]) },
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(`Cookie storage returned HTTP ${response.status}.`);
      frame?.contentWindow?.postMessage({ type: "bromine:cookie-synced", key, requestUrl: data.requestUrl }, "*");
    }).catch((error) => {
      notice(`Site cookie changes could not be saved: ${error.message}`);
    });
  } catch (error) {
    console.warn("Rejected proxied site cookie update:", error.message);
  }
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
  $("#page-status").textContent = tab.status;
  $("#route-button").textContent = entry(tab).url && tab.route.mode === "direct" ? "Direct" :
    (entry(tab).url ? tab.proxyEngine : settings.proxyEngine) === "scramjet" ? "Scramjet" : "Proxy";
  $("#route-button").title = tab.route?.reason || "Automatic routing";
  $('[data-action="stop"]').hidden = !tab.loading;
  $('[data-action="reload"]').hidden = tab.loading;
  document.querySelectorAll('[data-action="add-bookmark"]').forEach((button) => { button.disabled = !entry(tab).url; });
  document.querySelectorAll('[data-action="copy-url"], [data-action="clear-site-cache"]').forEach((button) => { button.disabled = !entry(tab).url; });
  document.querySelectorAll('[data-action="open-direct"]').forEach((button) => { button.disabled = !entry(tab).url; });
  document.title = settings.cloakTitle || `${entry(tab).title} · bromine`;
  if (parent !== window) parent.postMessage({ type: "bromine:appearance", title: document.title, favicon: $('link[rel="icon"]').href }, "*");
}

function openDirectSite() {
  const url = entry(current()).url;
  if (!url) return;
  window.open(validateNavigation(url).href, "_blank", "noopener,noreferrer");
  notice("Opened the site directly in a separate browser tab for sign-in or verification. If no tab appeared, allow pop-ups. This session is separate from Proxy.");
}

function selectTab(tab) {
  selected = tab.id;
  for (const item of tabs) {
    item.page.hidden = item !== tab;
    item.button.setAttribute("aria-selected", String(item === tab));
    item.button.tabIndex = item === tab ? 0 : -1;
  }
  updateToolbar();
  if ($("#console-dialog").open) renderConsole();
  if ($("#inspector-dialog").open) renderRequests();
  saveSession();
}

function closeTab(tab) {
  const index = tabs.indexOf(tab);
  clearTimeout(tab.loadTimer);
  tab.scramjet?.close();
  if (tab.faviconObjectUrl) URL.revokeObjectURL(tab.faviconObjectUrl);
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
  const tab = { id: nextId++, stack: [{ url: null, title: "New tab" }], position: 0, loading: false, status: "Ready", requests: [], activity: [], pinned: false };
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
  clearTimeout(tab.loadTimer);
  tab.scramjet?.close();
  tab.scramjet = null;
  if (tab.faviconObjectUrl) { URL.revokeObjectURL(tab.faviconObjectUrl); tab.faviconObjectUrl = null; }
  tab.stopped = false;
  tab.documentError = null;
  tab.scriptError = false;
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
    tab.proxyEngine = settings.proxyEngine;
    if (!direct && tab.proxyEngine === "scramjet") {
      renderScramjetPage(tab, frame);
      if (selected === tab.id) updateToolbar();
      saveSession();
      return;
    }
    tab.storageOrigin = direct ? null : new URL(entry(tab).url).origin;
    if (!direct) {
      tab.siteSessions ||= new Map();
      tab.storageBridgeId = crypto.randomUUID();
      const local = readStore(storageSeedPrefix + tab.storageOrigin, [], validStorageEntries);
      frame.name = storageSeedPrefix + JSON.stringify({
        origin: tab.storageOrigin, bridgeId: tab.storageBridgeId, local, session: tab.siteSessions.get(tab.storageOrigin) || [],
      });
    }
    frame.setAttribute("sandbox", direct && new URL(entry(tab).url).origin !== location.origin ? "allow-scripts allow-forms allow-downloads allow-same-origin" : "allow-scripts allow-forms allow-downloads");
    frame.referrerPolicy = "no-referrer";
    const site = sites[new URL(entry(tab).url).hostname];
    frame.src = direct ? entry(tab).url : proxyUrl(entry(tab).url, { adblock: site?.adblock ?? settings.adblock, logging: settings.logging, cache: true, cacheVersion: cacheVersionFor(entry(tab).url) });
    frame.addEventListener("load", () => {
      if (tab.frame !== frame || tab.stopped) return;
      tab.loading = false;
      clearTimeout(tab.loadTimer);
      if (direct) tab.status = "DIRECT frame loaded; internal progress unavailable";
      else if (!tab.bridgeReady) tab.status = "Frame loaded; waiting for page confirmation";
      addActivity(tab, direct ? "Direct frame finished loading" : "Frame load event received", { url: entry(tab).url });
      if (selected === tab.id) updateToolbar();
    });
    tab.frame = frame;
    tab.loading = true;
    tab.bridgeReady = false;
    tab.status = direct ? "Loading DIRECT frame; site may refuse embedding" : "Loading via Proxy; checking safe asset cache";
    tab.expectedUrl = entry(tab).url;
    addActivity(tab, tab.status, { url: entry(tab).url });
    tab.loadTimer = setTimeout(() => {
      if (tab.frame !== frame || tab.bridgeReady) return;
      tab.status = "Still waiting for the page's document and scripts";
      addActivity(tab, tab.status, { level: "warning", url: entry(tab).url });
      if (selected === tab.id) updateToolbar();
    }, 15000);
    tab.page.append(frame);
  }
  if (selected === tab.id) updateToolbar();
  saveSession();
}

function scramjetEvent(tab, frame, data) {
  if (tab.frame !== frame || tab.stopped) return;
  try {
    if (data.event === "navigation") {
      const url = validateNavigation(data.url).href;
      if (entry(tab).url !== url) recordNavigation(url, tab, undefined, data.replace === true);
      tab.expectedUrl = url;
      tab.bridgeReady = true;
      saveSession();
    } else if (data.event === "new-tab") {
      navigate(validateNavigation(data.url).href, createTab());
    } else if (data.event === "download") {
      downloads.add(validateNavigation(data.url).href, "scramjet");
      notice("Download started through Scramjet and Wisp.");
    } else if (data.event === "appearance") {
      entry(tab).title = typeof data.title === "string" ? data.title.slice(0, 160) : new URL(entry(tab).url).hostname;
      tab.title.textContent = entry(tab).title;
      if (data.favicon instanceof Blob && data.favicon.size <= 128 * 1024 && /^image\/(?:png|jpeg|gif|webp|avif|x-icon|vnd\.microsoft\.icon|svg\+xml)$/i.test(data.favicon.type)) {
        if (tab.faviconObjectUrl) URL.revokeObjectURL(tab.faviconObjectUrl);
        tab.faviconObjectUrl = URL.createObjectURL(data.favicon);
        tab.favicon.src = tab.faviconObjectUrl;
      }
      if (data.faviconError) addActivity(tab, "Site favicon unavailable; using the local Bromine icon", { level: "warn" });
      const row = history.find((row) => row.url === redactUrl(entry(tab).url));
      if (row) { row.title = entry(tab).title; writeStore("bromine:history", history); }
      saveSession();
    } else if (data.event === "request" && settings.logging) {
      validateNavigation(data.url);
      addRequest(tab, {
        url: data.url, method: String(data.method).slice(0, 12), type: String(data.type).slice(0, 30),
        status: Number.isInteger(data.status) ? data.status : "FAILED", route: "scramjet",
        size: Number.isFinite(data.size) ? data.size : null, duration: Number.isFinite(data.duration) ? data.duration : null,
        filter: ["BLOCKED", "CACHE HIT", "ALLOWED"].includes(data.filter) ? data.filter : "Unknown",
      });
    } else if (["progress", "error", "loaded"].includes(data.event) && typeof data.message === "string") {
      const message = data.message.slice(0, 300);
      if (data.failed || data.event === "error") tab.documentError = message;
      tab.status = tab.documentError || message;
      if (data.event === "loaded" || data.event === "error") {
        tab.loading = false;
        tab.bridgeReady = true;
        clearTimeout(tab.loadTimer);
      }
      addActivity(tab, message, { level: data.failed || data.event === "error" ? "error" : "info", url: data.url || entry(tab).url });
    }
    if (selected === tab.id) updateToolbar();
  } catch { notice("Invalid Scramjet browser metadata was rejected."); }
}

function renderScramjetPage(tab, frame) {
  tab.frame = frame;
  tab.storageOrigin = null;
  tab.loading = true;
  tab.bridgeReady = false;
  tab.expectedUrl = entry(tab).url;
  tab.status = "Starting Scramjet; connecting to isolated frontend";
  addActivity(tab, tab.status, { url: entry(tab).url });
  try {
    const config = scramjetConfig({ ...settings, adblock: sites[new URL(entry(tab).url).hostname]?.adblock ?? settings.adblock });
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-downloads");
    frame.referrerPolicy = "no-referrer";
    const bridge = connectScramjet(frame, config, (data) => scramjetEvent(tab, frame, data));
    tab.scramjet = bridge;
    tab.page.append(frame);
    tab.loadTimer = setTimeout(() => {
      if (tab.scramjet !== bridge || !tab.loading) return;
      tab.status = tab.documentError || "Scramjet is still loading; check the Wisp server and Loading console";
      addActivity(tab, tab.status, { level: "warn", url: entry(tab).url });
      if (selected === tab.id) updateToolbar();
    }, 20000);
    bridge.command("navigate", { config, url: entry(tab).url, cacheVersion: cacheVersionFor(entry(tab).url) }).catch((error) => {
      if (tab.scramjet !== bridge || tab.stopped) return;
      tab.loading = false;
      tab.documentError = error.message;
      tab.status = error.message;
      addActivity(tab, error.message, { level: "error", url: entry(tab).url });
      if (selected === tab.id) updateToolbar();
      notice(error.message);
    });
  } catch (error) {
    tab.loading = false;
    tab.status = error.message;
    const message = document.createElement("p");
    message.textContent = error.message;
    message.setAttribute("role", "alert");
    const configure = document.createElement("button");
    configure.className = "secondary-button";
    configure.textContent = "Configure Scramjet";
    configure.addEventListener("click", () => openDialog("settings"));
    tab.page.append(message, configure);
    addActivity(tab, error.message, { level: "error", url: entry(tab).url });
  }
}

function recordNavigation(url, tab, title = new URL(url).hostname, replace = false) {
  tab.stack.splice(tab.position + (replace ? 0 : 1));
  tab.stack.push({ url, title });
  tab.position = tab.stack.length - 1;
  history.unshift({ url: redactUrl(url), title, time: Date.now(), favicon: "/favicon.svg" });
  history = history.slice(0, 200);
  writeStore("bromine:history", history);
}

function navigate(value, tab = current(), replace = false) {
  try {
    const url = resolveInput(value);
    recordNavigation(url, tab, undefined, replace);
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
  if (name === "console") renderConsole();
  if (name === "routing") {
    const url = entry(current()).url;
    const host = url ? new URL(url).hostname : null;
    const site = host ? sites[host] : null;
    $("#routing-current").textContent = host ? `${host} · ${current().route.mode} · ${current().route.policy}` : "Choose the default route for new navigations.";
    $("#site-route").value = site?.mode || settings.mode;
    $("#site-adblock").checked = site?.adblock ?? settings.adblock;
    $("#verify-direct").disabled = !url;
    $("#clear-site-storage").disabled = !url;
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
    clearTimeout(tab.loadTimer);
    tab.stopped = true;
    tab.scramjet?.close();
    tab.frame?.contentWindow.postMessage({ type: "bromine:stop" }, "*");
    if (tab.frame) tab.frame.src = "about:blank";
    tab.loading = false; tab.status = "Stopped"; addActivity(tab, "Loading stopped by user"); updateToolbar();
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
  console: () => openDialog("console"),
  "open-direct": () => openDirectSite(),
  "copy-url": async () => {
    try { await navigator.clipboard.writeText(entry(current()).url); notice("Current URL copied."); }
    catch { notice("The browser could not copy this URL. Select and copy it from the address bar."); }
  },
  "clear-site-cache": () => clearCurrentSiteCache(),
  duplicate: () => duplicateTab(current()),
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
  settings.accent = "";
  applyAppearance();
  writeStore("bromine:settings", settings);
});
document.querySelectorAll("[data-theme-choice]").forEach((choice) => choice.addEventListener("click", () => {
  settings.theme = choice.dataset.themeChoice;
  settings.accent = "";
  $("#theme").value = settings.theme;
  applyAppearance();
  writeStore("bromine:settings", settings);
}));
$("#reset-theme").addEventListener("click", () => {
  settings.theme = "mocha";
  settings.accent = "";
  settings.colors = {};
  $("#theme").value = settings.theme;
  applyAppearance();
  writeStore("bromine:settings", settings);
});
for (const [id, key, kind] of [
  ["routing-mode", "mode", "string"], ["restore-tabs", "restore", "boolean"], ["show-bookmarks", "bookmarksBar", "boolean"],
  ["show-status", "statusBar", "boolean"], ["rain-effect", "rain", "boolean"], ["glass-opacity", "opacity", "number"],
  ["glass-blur", "blur", "number"], ["glass-saturation", "saturation", "number"], ["glass-radius", "radius", "number"],
  ["density", "density", "string"], ["text-size", "textSize", "number"], ["request-logging", "logging", "boolean"],
  ["cloak-title", "cloakTitle", "string"], ["cloak-icon", "cloakIcon", "string"],
]) {
  const input = $(`#${id}`);
  if (kind === "boolean") input.checked = settings[key];
  else input.value = String(settings[key]);
  input.addEventListener("change", () => {
    settings[key] = kind === "boolean" ? input.checked : kind === "number" ? Number(input.value) : input.value;
    applyAppearance(); writeStore("bromine:settings", settings);
    if (key === "restore" && !settings.restore) {
      try { localStorage.removeItem("bromine:session"); }
      catch { notice("Saved tabs could not be removed from browser storage."); }
    }
    saveSession();
    if (key === "logging" && !settings.logging) tabs.forEach((tab) => { tab.requests = []; });
    if (key === "logging") tabs.forEach((tab) => {
      if (tab.scramjet) tab.scramjet.command("logging", { enabled: settings.logging }).catch((error) => notice(error.message));
      else tab.frame?.contentWindow.postMessage({ type: "bromine:logging", enabled: settings.logging }, "*");
    });
    if (key === "mode") notice("Routing updated. Reload open pages to apply it.");
  });
}
$("#proxy-engine").addEventListener("change", (event) => {
  settings.proxyEngine = event.target.value;
  $("#engine-status").textContent = settings.proxyEngine === "scramjet" ? "Scramjet" : "Classic HTTP proxy · legacy";
  writeStore("bromine:settings", settings);
  if (!entry(current()).url) updateToolbar();
  notice("Proxy engine updated. Reload open pages to apply it; login storage is separate for each engine.");
});
$("#scramjet-transport").addEventListener("change", (event) => {
  settings.transport = event.target.value;
  writeStore("bromine:settings", settings);
  notice("Transport updated. Reload open pages to apply it.");
});
for (const [id, key, validate] of [
  ["scramjet-origin", "scramjetOrigin", (value) => validateScramjetOrigin(value, location.origin)],
  ["wisp-url", "wispUrl", validateWispUrl],
  ["bare-url", "bareUrl", validateBareUrl],
]) {
  $(`#${id}`).addEventListener("change", (event) => {
    try {
      settings[key] = event.target.value.trim() ? validate(event.target.value.trim()) : "";
      writeStore("bromine:settings", settings);
      event.target.value = settings[key] || window.BROMINE_CONFIG?.[key] || "";
      notice("Scramjet connection updated. Reload open pages to apply it.");
    } catch (error) {
      notice(error.message);
      event.target.value = settings[key] || window.BROMINE_CONFIG?.[key] || "";
    }
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
    sites[new URL(url).hostname] = { mode: $("#site-route").value, adblock: $("#site-adblock").checked, cache: true };
    writeStore("bromine:sites", sites);
  } else {
    settings.mode = $("#site-route").value; $("#routing-mode").value = settings.mode;
    writeStore("bromine:settings", settings);
  }
  $("#routing-dialog").close();
  renderPage(current(), true);
});
$("#verify-direct").addEventListener("click", () => {
  $("#routing-dialog").close();
  openDirectSite();
});
$("#clear-site-storage").addEventListener("click", async () => {
  const url = entry(current()).url;
  if (!url) return;
  const origin = new URL(url).origin;
  if (current().scramjet) {
    try {
      await current().scramjet.command("clear-storage", { url });
      for (const tab of tabs) if (tab.scramjet && new URL(entry(tab).url).origin === origin) renderPage(tab);
      $("#routing-dialog").close();
      notice("This site's Scramjet LocalStorage and SessionStorage were cleared. Cookies are unchanged.");
    } catch (error) { notice(error.message); }
    return;
  }
  try { localStorage.removeItem(storageSeedPrefix + origin); }
  catch { notice("Site storage could not be cleared because browser storage is unavailable."); return; }
  for (const tab of tabs) {
    tab.siteSessions?.delete(origin);
    if (tab.storageOrigin === origin && tab.route?.mode === "proxy") renderPage(tab);
  }
  $("#routing-dialog").close();
  notice("This site's Proxy LocalStorage and SessionStorage were cleared. Cookies are unchanged.");
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
  if (!tab || tab.scramjet || tab.stopped || !data || typeof data !== "object") return;
  if (data.type === "bromine:storage") {
    if (tab.route?.mode !== "proxy" || data.requestUrl !== tab.expectedUrl || data.origin !== tab.storageOrigin ||
        data.bridgeId !== tab.storageBridgeId ||
        !["local", "session"].includes(data.area) || !validStorageEntries(data.entries)) {
      notice("An invalid or out-of-scope site storage update was rejected.");
      return;
    }
    if (data.area === "local") writeStore(storageSeedPrefix + tab.storageOrigin, data.entries);
    else tab.siteSessions.set(tab.storageOrigin, data.entries);
  } else if (data.type === "bromine:cookie") {
    persistSiteCookie(tab, data);
  } else if (data.type === "bromine:progress" && data.requestUrl === tab.expectedUrl) {
    const stages = {
      bootstrap: "Document received; executing scripts and styles",
      loaded: "Frame load completed; site functionality is not verified",
      "script-error": "A page script failed; a successful resource download does not guarantee script execution",
      "sandbox-error": "A page script hit a sandbox security restriction; try Open directly for first-party behavior",
      "request-start": "Starting API request",
      "request-error": "An API request failed",
    };
    if (!Object.hasOwn(stages, data.stage)) return;
    const failed = data.stage.endsWith("error");
    if (data.stage === "bootstrap") {
      tab.documentError = data.verification === true ? "Site security verification required; use Open directly for first-party verification" :
        Number.isInteger(data.status) && data.status >= 400 && data.status <= 599 ?
          `Site returned HTTP ${data.status}; if it requests sign-in or verification, use Open directly` : null;
      if (tab.documentError) addActivity(tab, tab.documentError, { level: "error", url: entry(tab).url });
    }
    if (data.stage === "script-error" || data.stage === "sandbox-error") tab.scriptError = true;
    if (data.stage === "bootstrap" || data.stage === "loaded" || failed) {
      tab.status = tab.documentError || (tab.scriptError ? "Page has script errors; functionality may be incomplete" : stages[data.stage]);
    }
    if (data.stage === "loaded") tab.loading = false;
    try { addActivity(tab, stages[data.stage], { level: failed ? "error" : "info", url: typeof data.url === "string" ? data.url : entry(tab).url }); }
    catch { notice("Invalid loading metadata was ignored."); }
    if (selected === tab.id) updateToolbar();
  } else if (data.type === "bromine:download" && data.requestUrl === tab.expectedUrl && typeof data.url === "string") {
    try {
      const url = validateNavigation(data.url).href;
      downloads.add(url, "classic");
      addActivity(tab, "Download queued through Proxy", { url });
      notice("Download started through Proxy.");
    } catch (error) { notice(error.message); }
  } else if (data.type === "bromine:navigate" && typeof data.url === "string") {
    navigate(data.url, data.newTab ? createTab() : tab, data.replace === true && !data.newTab);
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
      addRequest(tab, { url: data.url, method: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(data.method) ? data.method : "GET", type: String(data.resourceType || "other").slice(0, 30),
        status: typeof data.status === "number" ? data.status : data.failed ? "FAILED" : "UNKNOWN", route: "proxy",
        size: Number.isFinite(data.size) ? data.size : null, duration: Number.isFinite(data.duration) ? data.duration : null,
        filter: data.blocked ? "BLOCKED" : data.cache === "hit" ? "CACHE HIT" : data.filterKnown ? "Allowed" : "Unknown" });
    } catch { notice("Invalid request metadata was ignored."); }
  } else if (data.type === "bromine:ready" && data.requestUrl === tab.expectedUrl) {
    try {
      const url = new URL(data.url);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid page address");
      if (tab.route?.mode === "proxy" && url.origin !== tab.storageOrigin) {
        navigate(url.href, tab, true);
        return;
      }
      entry(tab).url = url.href;
      entry(tab).title = typeof data.title === "string" && data.title.trim() ? data.title.slice(0, 160) : url.hostname;
      tab.title.textContent = entry(tab).title;
      tab.loading = false;
      tab.bridgeReady = true;
      clearTimeout(tab.loadTimer);
      tab.documentError = typeof data.error === "string" ? data.error : tab.documentError;
      tab.status = tab.documentError || (tab.scriptError ? "Page has script errors; functionality may be incomplete" : "Document parsed; finishing remaining assets");
      addActivity(tab, tab.documentError ? tab.documentError : "Document parsed; site functionality is not verified", { url: url.href, level: tab.documentError ? "error" : "info" });
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
  route: routeFor, options: () => ({ concurrent: settings.concurrent, adblock: settings.adblock, proxyEngine: settings.proxyEngine }),
  fetchResource: (url, options) => scramjetDownload(scramjetConfig(settings), url, options),
  changed: () => { if ($("#downloads-dialog").open) renderDownloads(); writeStore("bromine:downloads", downloads.snapshot()); },
  notify: notice,
});
const priorDownloads = readStore("bromine:downloads", [], (value) => Array.isArray(value) && value.length <= 50 &&
  value.every((row) => row && typeof row.url === "string" && /^https?:\/\//.test(row.url) && typeof row.name === "string" && ["direct", "proxy", "scramjet"].includes(row.route)));
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
  const stats = await configureCache({ enabled: true, limitMB: settings.cacheLimit });
  $("#cache-usage").textContent = `${(stats.bytes / 1024 / 1024).toFixed(2)} MB / ${stats.limitMB} MB · ${stats.entries} resources`;
  if (settings.scramjetOrigin || window.BROMINE_CONFIG?.scramjetOrigin) {
    const config = scramjetConfig(settings, { network: false });
    const remote = await scramjetControl(config, (data) => { if (data.event === "error") notice(data.message); }).command("cache-stats", { config });
    $("#scramjet-cache-usage").textContent = `Scramjet: ${(remote.bytes / 1024 / 1024).toFixed(2)} MB / ${remote.limitMB} MB · ${remote.entries} resources`;
  } else $("#scramjet-cache-usage").textContent = "Scramjet cache: configure the isolated frontend to inspect its local public assets.";
}
async function clearScramjetCache(options) {
  if (!settings.scramjetOrigin && !window.BROMINE_CONFIG?.scramjetOrigin) return;
  const config = scramjetConfig(settings, { network: false });
  await scramjetControl(config).command("cache-clear", options);
}
$("#cache-limit").addEventListener("change", async () => {
  settings.cacheLimit = Number($("#cache-limit").value);
  writeStore("bromine:settings", settings);
  try {
    await Promise.all(tabs.filter((tab) => tab.scramjet && !tab.stopped).map((tab) =>
      tab.scramjet.command("cache-stats", { config: { ...tab.scramjet.config, limitMB: settings.cacheLimit } })));
    await refreshCache();
  } catch (error) { notice(error.message); }
});
$("#clear-cache").addEventListener("click", async () => {
  try {
    const category = $("#cache-category").value;
    await cacheCommand({ action: "clear", category });
    await clearScramjetCache({ category });
    invalidateAssetVersion();
    await refreshCache();
  }
  catch (error) { notice(error.message); }
});
async function clearCurrentSiteCache() {
  if (!entry(current()).url) return notice("Open a page to choose its cache.");
  try {
    await configureCache({ enabled: true, limitMB: settings.cacheLimit });
    await cacheCommand({ action: "clear", site: new URL(entry(current()).url).hostname });
    await clearScramjetCache({ site: new URL(entry(current()).url).hostname });
    invalidateAssetVersion(new URL(entry(current()).url).hostname);
    await refreshCache();
    addActivity(current(), "Current site cache cleared", { url: entry(current()).url });
    notice("Current site cache cleared. Reload to fetch fresh assets.");
  }
  catch (error) { notice(error.message); }
}
$("#clear-site-cache").addEventListener("click", clearCurrentSiteCache);
refreshCache().catch((error) => notice(`Public asset cache unavailable: ${error.message}`));
navigator.serviceWorker?.addEventListener("message", (event) => { if (event.data?.type === "bromine:cache-error") notice(event.data.message); });

function renderRequests() {
  $("#request-list").replaceChildren();
  const filter = $("#inspector-filter").value;
  const rows = current().requests.filter((row) => !filter || row.route === filter || row.type === filter ||
    filter === "blocked" && row.filter === "BLOCKED" || filter === "failed" && (row.status === "FAILED" || Number(row.status) >= 400));
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
function duplicateTab(source) {
  const tab = createTab(); tab.stack = source.stack.map((row) => ({ ...row })); tab.position = source.position; renderPage(tab);
}
$("#duplicate-tab").addEventListener("click", () => {
  $("#tab-actions-dialog").close();
  duplicateTab(contextTab);
});
$("#clear-console").addEventListener("click", () => { current().activity = []; renderConsole(); });
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
