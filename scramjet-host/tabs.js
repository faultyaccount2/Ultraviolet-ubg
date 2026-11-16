import { validateNavigation } from "../shared/address.js";
import { connectScramjetHost } from "../frontend/scramjet.js";
import { Downloads } from "../frontend/downloads.js";

export function startStandalone() {
  const address = document.querySelector("#address");
  const status = document.querySelector("#status");
  const transport = document.querySelector("#transport");
  const tablist = document.querySelector("#tabs");
  const runtime = window.BROMINE_SCRAMJET_CONFIG || {};
  const tabs = [];
  let current;
  let nextId = 0;
  let editingAddress = false;
  document.querySelector("#standalone").hidden = false;
  document.querySelector("#site").remove();

  function showStatus(message) {
    status.textContent = message;
    status.hidden = !message;
  }
  function render() {
    for (const tab of tabs) {
      tab.frame.hidden = tab !== current;
      tab.button.setAttribute("aria-selected", String(tab === current));
      tab.button.tabIndex = tab === current ? 0 : -1;
      tab.label.textContent = tab.title;
      tab.icon.hidden = !tab.favicon;
      tab.icon.src = tab.favicon || "/favicon.svg";
    }
    transport.value = current.config.transport;
    document.title = current.url ? `${current.title} - Scramjet` : "Bromine Scramjet";
    showStatus(current.status);
  }
  function select(tab) {
    current = tab;
    editingAddress = false;
    address.value = tab.url;
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
    tabs.splice(index, 1);
    dispose(tab);
    if (!tabs.length) add();
    else select(current === tab ? tabs[Math.min(index, tabs.length - 1)] : current);
  }
  function event(tab, message) {
    if (!tabs.includes(tab)) return;
    if (message.event === "navigation") {
      tab.url = validateNavigation(message.url).href;
      if (tab === current && !editingAddress) address.value = tab.url;
    }
    if (message.event === "appearance") {
      if (message.title) tab.title = message.title;
      if (message.favicon || message.faviconError) {
        if (tab.favicon) URL.revokeObjectURL(tab.favicon);
        tab.favicon = message.favicon ? URL.createObjectURL(message.favicon) : "";
      }
    }
    if (["progress", "error", "loaded"].includes(message.event) && message.message) {
      if (message.failed || message.event === "error") tab.error = message.message;
      tab.status = tab.error || message.message;
    }
    if (message.event === "new-tab") { add(message.url); return; }
    if (message.event === "download") {
      try { tab.downloads.add(validateNavigation(message.url).href); }
      catch (error) { tab.status = error.message; }
    }
    render();
  }
  async function navigate(tab, value) {
    try {
      const input = value.trim();
      const url = validateNavigation(/^[a-z][a-z\d+.-]*:/i.test(input) ? input : `https://${input}`).href;
      tab.url = url;
      if (tab === current) { editingAddress = false; address.value = url; }
      tab.title = new URL(url).hostname;
      tab.error = "";
      tab.status = `Connecting through ${tab.config.transport === "bare" ? "Bare" : "Wisp"}...`;
      render();
      await tab.bridge.command("navigate", { url, config: tab.config });
    } catch (error) {
      if (tabs.includes(tab)) { tab.status = error.message; render(); }
    }
  }
  function add(url = "") {
    const frame = document.createElement("iframe");
    frame.className = "standalone-frame";
    frame.title = "Scramjet tab";
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-downloads");
    frame.referrerPolicy = "no-referrer";
    const tab = {
      frame, url: "", title: "New tab", favicon: "", status: "Enter a website address to browse through Scramjet.",
      config: {
        origin: location.origin, wispUrl: runtime.wispUrl || "", bareUrl: runtime.bareUrl || "",
        transport: current?.config.transport || "bare",
        limitMB: 256, adblock: true, logging: false, concurrent: 2, proxyEngine: "scramjet",
      },
    };
    tab.bridge = connectScramjetHost(frame, tab.config, (message) => event(tab, message));
    tab.downloads = new Downloads({
      route: validateNavigation, options: () => tab.config,
      notify(message) { tab.status = message; render(); },
      changed() {
        const item = tab.downloads.items[0];
        if (item?.status === "failed") tab.status = `Download failed: ${item.error}`;
        else if (item?.status === "saved") tab.status = `Download saved: ${item.name}`;
        if (tabs.includes(tab)) render();
      },
      async fetchResource(url, options) {
        const response = await tab.bridge.command("download", { config: tab.config, url, headers: [...options.headers] }, { signal: options.signal });
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers });
      },
    });
    tab.wrapper = document.createElement("div");
    tab.wrapper.className = "tab";
    tab.button = document.createElement("button");
    tab.button.type = "button";
    tab.button.id = `tab-${++nextId}`;
    tab.button.setAttribute("role", "tab");
    frame.id = `panel-${nextId}`;
    frame.setAttribute("aria-labelledby", tab.button.id);
    tab.button.setAttribute("aria-controls", frame.id);
    tab.icon = document.createElement("img");
    tab.icon.alt = "";
    tab.label = document.createElement("span");
    tab.button.append(tab.icon, tab.label);
    tab.button.addEventListener("click", () => select(tab));
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "x";
    closeButton.setAttribute("aria-label", "Close Scramjet tab");
    closeButton.addEventListener("click", () => close(tab));
    tab.wrapper.append(tab.button, closeButton);
    tablist.append(tab.wrapper);
    tabs.push(tab);
    document.body.append(frame);
    select(tab);
    if (url) navigate(tab, url);
    else address.focus();
    return tab;
  }

  document.querySelector("#new-tab").addEventListener("click", () => add());
  address.addEventListener("input", () => { editingAddress = true; });
  document.querySelector("#navigation").addEventListener("submit", (event) => {
    event.preventDefault();
    navigate(current, address.value);
  });
  document.querySelector("#reload").addEventListener("click", () => { if (current.url) navigate(current, current.url); });
  transport.addEventListener("change", () => {
    current.config.transport = transport.value;
    current.status = "Transport changed. Press Go or Reload to apply.";
    render();
  });
  tablist.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = tabs.indexOf(current);
    select(tabs[event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 :
      (index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]);
    current.button.focus();
  });
  window.addEventListener("keydown", (event) => {
    if (!event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (!["t", "w", "l"].includes(key)) return;
    event.preventDefault();
    if (key === "t") add();
    if (key === "w") close(current);
    if (key === "l") { address.focus(); address.select(); }
  });
  window.addEventListener("pagehide", () => {
    for (const tab of tabs) dispose(tab);
    tabs.length = 0;
  });
  add(new URLSearchParams(location.hash.slice(1)).get("url") || "");
}
