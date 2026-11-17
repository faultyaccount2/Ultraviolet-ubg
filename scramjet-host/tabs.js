import { validateNavigation } from "../shared/address.js";
import { connectScramjetHost } from "../frontend/scramjet.js";
import { Downloads } from "../frontend/downloads.js";
import { DEFAULT_BARE_URL, validateBareUrl, validateWispUrl } from "./config.js";

const preferenceKey = "bromine:scramjet:standalone";

function readPreferences(runtime) {
  try {
    const saved = JSON.parse(localStorage.getItem(preferenceKey) || "{}");
    return {
      transport: ["bare", "wisp"].includes(saved.transport) ? saved.transport : "bare",
      wispUrl: typeof saved.wispUrl === "string" ? saved.wispUrl : runtime.wispUrl || "",
      bareUrl: typeof saved.bareUrl === "string" ? saved.bareUrl : runtime.bareUrl || DEFAULT_BARE_URL,
      logging: saved.logging !== false,
      flags: {
        allowInvalidJs: saved.flags?.allowInvalidJs === true,
        allowFailedIntercepts: saved.flags?.allowFailedIntercepts === true,
      },
    };
  } catch {
    return { transport: "bare", wispUrl: runtime.wispUrl || "", bareUrl: runtime.bareUrl || DEFAULT_BARE_URL, logging: true, flags: { allowInvalidJs: false, allowFailedIntercepts: false } };
  }
}

export function startStandalone() {
  const address = document.querySelector("#address");
  const status = document.querySelector("#status");
  const tablist = document.querySelector("#tabs");
  const runtime = window.BROMINE_SCRAMJET_CONFIG || {};
  const preferences = readPreferences(runtime);
  const tabs = [];
  const requests = [];
  let current;
  let nextId = 0;
  let activeView = "browser";
  let editingAddress = false;
  const byId = (id) => document.getElementById(id);

  document.querySelector("#standalone").hidden = false;
  document.querySelector("#site").remove();
  byId("embed-status").hidden = true;
  byId("transport").value = preferences.transport;
  byId("wisp-url").value = preferences.wispUrl;
  byId("bare-url").value = preferences.bareUrl;
  byId("request-logging").value = preferences.logging ? "on" : "off";
  byId("flag-invalid-js").checked = preferences.flags.allowInvalidJs;
  byId("flag-failed-intercepts").checked = preferences.flags.allowFailedIntercepts;

  function announce(message) {
    status.textContent = message || "Ready";
    status.hidden = !message;
  }

  function savePreferences() {
    localStorage.setItem(preferenceKey, JSON.stringify(preferences));
  }

  function renderRequests() {
    const list = byId("request-list");
    list.replaceChildren();
    for (const request of requests.slice(0, 300)) {
      const row = document.createElement("tr");
      for (const value of [request.method, request.url, request.type, request.status, request.duration === null ? "—" : `${Math.round(request.duration)} ms`]) {
        const cell = document.createElement("td");
        cell.textContent = String(value ?? "—");
        cell.title = String(value ?? "—");
        row.append(cell);
      }
      list.append(row);
    }
    byId("request-empty").hidden = requests.length > 0;
    const button = document.querySelector('[data-view="requests"]');
    button.textContent = requests.length ? `Requests · ${requests.length}` : "Requests";
  }

  function selectView(view) {
    activeView = view;
    for (const button of document.querySelectorAll("[data-view]")) button.setAttribute("aria-selected", String(button.dataset.view === view));
    for (const panel of document.querySelectorAll(".view-panel")) panel.hidden = panel.id !== `${view}-view`;
    byId("browser-toolbar").hidden = view !== "browser";
    byId("browser-tabs").hidden = view !== "browser" || tabs.length < 2;
    if (current) current.frame.hidden = view !== "browser";
    if (view === "requests") renderRequests();
  }

  function updateNavigationControls() {
    byId("back").disabled = !current || current.historyIndex <= 0;
    byId("forward").disabled = !current || current.historyIndex >= current.history.length - 1;
    byId("reload").disabled = !current?.url;
  }

  function render() {
    for (const tab of tabs) {
      tab.frame.hidden = tab !== current || activeView !== "browser" || !tab.url;
      tab.button.setAttribute("aria-selected", String(tab === current));
      tab.button.tabIndex = tab === current ? 0 : -1;
      tab.label.textContent = tab.title;
      tab.icon.hidden = !tab.favicon;
      tab.icon.src = tab.favicon || "/favicon.svg";
    }
    if (current) {
      if (!editingAddress) address.value = current.url;
      document.title = current.url ? `${current.title} - Scramjet` : "Bromine Scramjet";
      byId("welcome").hidden = Boolean(current.url);
      announce(current.status);
    }
    byId("browser-tabs").hidden = activeView !== "browser" || tabs.length < 2;
    updateNavigationControls();
  }

  function select(tab) {
    current = tab;
    editingAddress = false;
    selectView("browser");
    render();
  }

  function dispose(tab) {
    for (const item of [...tab.downloads.items]) tab.downloads.action(item, "remove");
    tab.bridge.close();
    tab.frame.remove();
    tab.wrapper.remove();
    if (tab.favicon) URL.revokeObjectURL(tab.favicon);
  }

  function close(tab) {
    const index = tabs.indexOf(tab);
    if (index < 0) return;
    tabs.splice(index, 1);
    dispose(tab);
    if (!tabs.length) add();
    else select(current === tab ? tabs[Math.min(index, tabs.length - 1)] : current);
  }

  function event(tab, message) {
    if (!tabs.includes(tab)) return;
    if (message.event === "navigation") {
      const url = validateNavigation(message.url).href;
      if (tab.expectedHistoryURL === url) {
        tab.historyIndex = tab.history.indexOf(url);
        tab.expectedHistoryURL = "";
      } else if (message.replace && tab.historyIndex >= 0) {
        tab.history[tab.historyIndex] = url;
      } else if (tab.history[tab.historyIndex] !== url) {
        tab.history.splice(tab.historyIndex + 1);
        tab.history.push(url);
        tab.historyIndex = tab.history.length - 1;
      }
      tab.url = url;
      if (tab === current && !editingAddress) address.value = url;
    }
    if (message.event === "appearance") {
      if (message.title) tab.title = message.title;
      if (message.favicon || message.faviconError) {
        if (tab.favicon) URL.revokeObjectURL(tab.favicon);
        tab.favicon = message.favicon ? URL.createObjectURL(message.favicon) : "";
      }
    }
    if (message.event === "request") {
      requests.unshift({ ...message, tab: tab.title });
      requests.length = Math.min(requests.length, 300);
      if (activeView === "requests") renderRequests();
    }
    if (["progress", "error", "loaded"].includes(message.event) && message.message) {
      tab.error = message.failed || message.event === "error" ? message.message : "";
      tab.status = tab.error || message.message;
    }
    if (message.event === "new-tab") { add(message.url); return; }
    if (message.event === "download") {
      try { tab.downloads.add(validateNavigation(message.url).href); }
      catch (error) { tab.status = error.message; }
    }
    render();
  }

  async function navigate(tab, value, { historyTarget = null } = {}) {
    try {
      const input = value.trim();
      const url = validateNavigation(/^[a-z][a-z\d+.-]*:/i.test(input) ? input : `https://${input}`).href;
      if (preferences.transport === "wisp") validateWispUrl(preferences.wispUrl);
      if (preferences.transport === "bare") validateBareUrl(preferences.bareUrl);
      tab.url = url;
      tab.error = "";
      if (historyTarget !== null) {
        tab.expectedHistoryURL = url;
        tab.historyIndex = historyTarget;
      }
      if (tab === current) { editingAddress = false; address.value = url; }
      tab.title = new URL(url).hostname;
      tab.status = `Connecting through ${tab.config.transport === "bare" ? "Bare" : "Wisp"}…`;
      render();
      await tab.bridge.command("navigate", { url, config: tab.config });
    } catch (error) {
      if (tabs.includes(tab)) {
        tab.status = error.message;
        tab.error = error.message;
        render();
      }
    }
  }

  function add(url = "") {
    const frame = document.createElement("iframe");
    frame.className = "standalone-frame";
    frame.title = "Scramjet page";
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-downloads");
    frame.referrerPolicy = "no-referrer";
    const config = {
      origin: location.origin, wispUrl: preferences.wispUrl, bareUrl: preferences.bareUrl,
      transport: preferences.transport, limitMB: 256, adblock: true, logging: preferences.logging,
      concurrent: 2, proxyEngine: "scramjet", flags: { ...preferences.flags },
    };
    const tab = { frame, url: "", title: "New tab", favicon: "", status: "Enter a website address to browse through Scramjet.", config, history: [], historyIndex: -1, expectedHistoryURL: "" };
    tab.bridge = connectScramjetHost(frame, config, (message) => event(tab, message));
    tab.downloads = new Downloads({
      route: validateNavigation, options: () => tab.config,
      notify(message) { tab.status = message; render(); },
      changed() {
        const item = tab.downloads.items[0];
        if (item?.status === "failed") tab.status = `Download failed: ${item.error}`;
        else if (item?.status === "saved") tab.status = `Download saved: ${item.name}`;
        if (tabs.includes(tab)) render();
      },
      async fetchResource(target, options) {
        const response = await tab.bridge.command("download", { config: tab.config, url: target, headers: [...options.headers] }, { signal: options.signal });
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers });
      },
    });
    tab.wrapper = document.createElement("div");
    tab.wrapper.className = "tab";
    tab.button = document.createElement("button");
    tab.button.type = "button";
    tab.button.id = `scramjet-tab-${++nextId}`;
    tab.button.setAttribute("role", "tab");
    frame.id = `scramjet-panel-${nextId}`;
    frame.setAttribute("aria-labelledby", tab.button.id);
    tab.button.setAttribute("aria-controls", frame.id);
    tab.icon = document.createElement("img");
    tab.icon.alt = "";
    tab.label = document.createElement("span");
    tab.button.append(tab.icon, tab.label);
    tab.button.addEventListener("click", () => select(tab));
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "tab-close";
    closeButton.textContent = "×";
    closeButton.setAttribute("aria-label", "Close Scramjet tab");
    closeButton.addEventListener("click", () => close(tab));
    tab.wrapper.append(tab.button, closeButton);
    tablist.append(tab.wrapper);
    tabs.push(tab);
    byId("browser-view").append(frame);
    select(tab);
    if (url) navigate(tab, url);
    return tab;
  }

  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => selectView(button.dataset.view)));
  byId("new-tab").addEventListener("click", () => add());
  address.addEventListener("input", () => { editingAddress = true; });
  document.querySelector("#navigation").addEventListener("submit", (event) => { event.preventDefault(); if (current) navigate(current, address.value); });
  byId("back").addEventListener("click", () => {
    if (current?.historyIndex > 0) navigate(current, current.history[current.historyIndex - 1], { historyTarget: current.historyIndex - 1 });
  });
  byId("forward").addEventListener("click", () => {
    if (current?.historyIndex < current.history.length - 1) navigate(current, current.history[current.historyIndex + 1], { historyTarget: current.historyIndex + 1 });
  });
  byId("reload").addEventListener("click", () => { if (current?.url) navigate(current, current.url, { historyTarget: current.historyIndex }); });
  byId("clear-requests").addEventListener("click", () => { requests.length = 0; renderRequests(); });
  byId("run-playground").addEventListener("click", () => {
    const html = byId("play-html").value;
    const css = byId("play-css").value.replaceAll("</style", "<\\/style");
    const js = byId("play-js").value.replaceAll("</script", "<\\/script");
    byId("play-preview").srcdoc = `<!doctype html><meta charset="utf-8"><style>${css}</style>${html}<script>${js}<\/script>`;
  });
  byId("save-settings").addEventListener("click", () => {
    try {
      preferences.transport = byId("transport").value;
      preferences.wispUrl = byId("wisp-url").value.trim();
      preferences.bareUrl = byId("bare-url").value.trim();
      preferences.logging = byId("request-logging").value === "on";
      if (preferences.transport === "wisp") validateWispUrl(preferences.wispUrl);
      else validateBareUrl(preferences.bareUrl);
      savePreferences();
      for (const tab of tabs) tab.config = { ...tab.config, wispUrl: preferences.wispUrl, bareUrl: preferences.bareUrl, transport: preferences.transport, logging: preferences.logging };
      announce("Settings saved on this device. Reload the current page to use the new transport.");
      render();
    } catch (error) { announce(error.message); }
  });
  byId("flag-toggle").addEventListener("click", () => {
    const panel = byId("flag-editor");
    panel.hidden = !panel.hidden;
    byId("flag-toggle").setAttribute("aria-expanded", String(!panel.hidden));
  });
  for (const [id, key] of [["flag-invalid-js", "allowInvalidJs"], ["flag-failed-intercepts", "allowFailedIntercepts"]]) {
    byId(id).addEventListener("change", () => {
      preferences.flags[key] = byId(id).checked;
      savePreferences();
      if (current) current.config.flags = { ...preferences.flags };
    });
  }
  tablist.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = tabs.indexOf(current);
    select(tabs[event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]);
    current.button.focus();
  });
  window.addEventListener("keydown", (event) => {
    if (!event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (!["t", "w", "l"].includes(key)) return;
    event.preventDefault();
    if (key === "t") add();
    if (key === "w" && current) close(current);
    if (key === "l") { address.focus(); address.select(); }
  });
  window.addEventListener("pagehide", () => {
    for (const tab of tabs) dispose(tab);
    tabs.length = 0;
  });
  add(new URLSearchParams(location.hash.slice(1)).get("url") || "");
  renderRequests();
}
