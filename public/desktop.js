(() => {
  const surface = document.querySelector("#desktop-surface");
  const windows = [...document.querySelectorAll(".desktop-window")];
  const windowsById = new Map(windows.map((win) => [win.dataset.window, win]));
  const frameFor = (id) => windowsById.get(id)?.querySelector("iframe");
  const menu = document.querySelector("#start-menu");
  const startSearch = document.querySelector("#start-search-input");
  let zIndex = 10;
  let activeWindowId = null;
  let dragState;
  let resizeState;
  let saveTimer;
  const settingsShareHash = location.hash.startsWith("#bromine-settings=") ? location.hash.slice(1) : "";
  if (settingsShareHash) history.replaceState(null, "", `${location.pathname}${location.search}`);

  function applyAppearance(value = {}) {
    const theme = ["mocha", "obsidian", "ember", "charcoal", "ocean", "forest", "rose", "contrast", "light", "system"].includes(value.theme) ? value.theme : "mocha";
    document.documentElement.dataset.theme = theme === "system" ? "mocha" : theme;
    if (["rainy", "slate", "dusk"].includes(value.wallpaper)) document.documentElement.dataset.wallpaper = value.wallpaper;
    if (value.rain === false) document.documentElement.dataset.rain = "off";
    else document.documentElement.dataset.rain = "on";
    document.documentElement.style.setProperty("--desktop-blur", `${Math.max(0, Math.min(40, Number(value.blur) || 18))}px`);
    document.documentElement.style.setProperty("--glass-opacity", `${Math.max(55, Math.min(100, Number(value.opacity) || 82))}%`);
    document.documentElement.style.setProperty("--window-opacity", `${Math.max(65, Math.min(92, Number(value.opacity) || 82))}%`);
    document.documentElement.style.setProperty("--desktop-radius", `${Math.max(3, Math.min(8, (Number(value.radius) || 8) * .5))}px`);
    document.documentElement.style.setProperty("--saturation", `${Math.max(100, Math.min(200, Number(value.saturation) || 130))}%`);
    if (typeof value.accent === "string" && /^#[a-f\d]{6}$/i.test(value.accent)) document.documentElement.style.setProperty("--accent", value.accent);
    for (const key of ["background", "surface", "hover", "text", "muted", "frame", "toolbar", "tabs", "status", "border"]) {
      const color = value.colors?.[key];
      if (typeof color === "string" && /^#[a-f\d]{6}$/i.test(color)) document.documentElement.style.setProperty(`--${key}`, color);
      else document.documentElement.style.removeProperty(`--${key}`);
    }
  }
  try { applyAppearance(JSON.parse(localStorage.getItem("bromine:settings") || "{}")); } catch { applyAppearance(); }

  function notify(message) {
    const notice = document.querySelector("#desktop-notice");
    notice.textContent = message;
    notice.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice.hidden = true; }, 4200);
  }
  let noticeTimer;

  function focusWindow(win) {
    if (!win) return;
    win.hidden = false;
    activeWindowId = win.dataset.window;
    zIndex += 1;
    win.style.zIndex = String(zIndex);
    windows.forEach((item) => {
      const active = item === win;
      if (!active) {
        item.hidden = true;
        item.classList.remove("is-opening", "is-minimizing", "is-closing");
      }
      item.classList.toggle("active", active);
      const taskbarButton = document.querySelector(`[data-taskbar-window="${item.dataset.window}"]`);
      taskbarButton?.classList.toggle("selected", active);
      taskbarButton?.setAttribute("aria-current", active ? "page" : "false");
    });
    closeStartMenu();
  }

  function setWindowRunning(win, running) {
    const button = document.querySelector(`[data-taskbar-window="${win.dataset.window}"]`);
    button?.classList.toggle("running", running);
    button?.setAttribute("data-running", String(running));
  }

  function fitWindowToSurface(win) {
    if (win.classList.contains("is-maximized")) return;
    const bounds = surface.getBoundingClientRect();
    const minWidth = window.innerWidth <= 620 ? Math.min(bounds.width - 16, 290) : 290;
    const minHeight = window.innerWidth <= 620 ? 230 : 250;
    const width = Math.max(minWidth, Math.min(parseFloat(win.style.width) || bounds.width - 12, bounds.width - 12));
    const height = Math.max(minHeight, Math.min(parseFloat(win.style.height) || bounds.height - 12, bounds.height - 12));
    win.style.width = `${width}px`;
    win.style.height = `${height}px`;
    win.style.left = `${Math.max(0, Math.min(parseFloat(win.style.left) || 0, bounds.width - width))}px`;
    win.style.top = `${Math.max(0, Math.min(parseFloat(win.style.top) || 0, bounds.height - 42))}px`;
  }

  function saveLayout() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const layout = {};
      for (const win of windows) {
        if (!win.classList.contains("is-maximized")) layout[win.dataset.window] = {
          left: parseFloat(win.style.left) || 0, top: parseFloat(win.style.top) || 0,
          width: parseFloat(win.style.width) || 0, height: parseFloat(win.style.height) || 0,
        };
      }
      try { localStorage.setItem("bromine:desktop:layout", JSON.stringify({ version: 3, windows: layout })); } catch { /* The desktop still works without saved placement. */ }
    }, 120);
  }

  function initialLayout() {
    const bounds = surface.getBoundingClientRect();
    let saved = {};
    try {
      const stored = JSON.parse(localStorage.getItem("bromine:desktop:layout") || "{}");
      if (stored.version === 3 && stored.windows) saved = stored.windows;
    } catch { /* Use the centered layout. */ }
    const margin = 6;
    const width = Math.max(290, bounds.width - margin * 2);
    const height = Math.max(230, bounds.height - margin * 2);
    for (const id of ["proxy-1", "proxy-2", "settings"]) {
      const win = windowsById.get(id);
      const stored = saved[win.dataset.window];
      const actualWidth = Number.isFinite(stored?.width) && stored.width >= 290 ? Math.min(stored.width, bounds.width - margin * 2) : width;
      const actualHeight = Number.isFinite(stored?.height) && stored.height >= 230 ? Math.min(stored.height, bounds.height - margin * 2) : height;
      const left = Number.isFinite(stored?.left) ? stored.left : Math.round((bounds.width - actualWidth) / 2);
      const top = Number.isFinite(stored?.top) ? stored.top : Math.round((bounds.height - actualHeight) / 2);
      win.style.left = `${Math.max(0, Math.min(left, bounds.width - 100))}px`;
      win.style.top = `${Math.max(0, Math.min(top, bounds.height - 44))}px`;
      win.style.width = `${actualWidth}px`;
      win.style.height = `${actualHeight}px`;
    }
  }

  function openWindow(id) {
    const win = windowsById.get(id);
    if (!win) return;
    const wasHidden = win.hidden;
    win.hidden = false;
    fitWindowToSurface(win);
    setWindowRunning(win, true);
    win.classList.remove("is-closing", "is-minimizing");
    if (wasHidden) {
      win.classList.remove("is-opening");
      requestAnimationFrame(() => win.classList.add("is-opening"));
    }
    focusWindow(win);
    saveLayout();
  }

  function minimizeWindow(win) {
    if (activeWindowId === win.dataset.window) activeWindowId = null;
    win.classList.remove("active");
    const button = document.querySelector(`[data-taskbar-window="${win.dataset.window}"]`);
    button?.classList.remove("selected");
    button?.setAttribute("aria-current", "false");
    win.classList.add("is-minimizing");
    setTimeout(() => { win.hidden = true; win.classList.remove("is-minimizing"); }, 170);
  }

  function closeWindow(win) {
    if (activeWindowId === win.dataset.window) activeWindowId = null;
    win.classList.remove("active");
    const button = document.querySelector(`[data-taskbar-window="${win.dataset.window}"]`);
    button?.classList.remove("selected");
    button?.setAttribute("aria-current", "false");
    setWindowRunning(win, false);
    win.classList.add("is-closing");
    setTimeout(() => { win.hidden = true; win.classList.remove("is-closing"); }, 170);
  }

  function toggleMaximize(win) {
    win.classList.toggle("is-maximized");
    focusWindow(win);
    saveLayout();
  }

  function closeStartMenu() {
    menu.classList.remove("is-open");
    setTimeout(() => { if (!menu.classList.contains("is-open")) menu.hidden = true; }, 180);
    document.querySelectorAll("[data-start-toggle]").forEach((button) => button.setAttribute("aria-expanded", "false"));
  }

  function toggleStartMenu() {
    if (!menu.hidden && menu.classList.contains("is-open")) return closeStartMenu();
    menu.hidden = false;
    requestAnimationFrame(() => menu.classList.add("is-open"));
    document.querySelectorAll("[data-start-toggle]").forEach((button) => button.setAttribute("aria-expanded", "true"));
    startSearch.focus();
  }

  document.querySelectorAll("[data-start-toggle]").forEach((button) => button.addEventListener("click", toggleStartMenu));
  document.querySelectorAll("[data-open-window]:not(.taskbar-app)").forEach((button) => button.addEventListener("click", () => openWindow(button.dataset.openWindow)));
  document.querySelectorAll(".taskbar-app").forEach((button) => button.addEventListener("click", () => {
    const win = windowsById.get(button.dataset.openWindow);
    if (win && !win.hidden && win.classList.contains("active")) minimizeWindow(win);
    else openWindow(button.dataset.openWindow);
  }));
  document.querySelectorAll(".desktop-window").forEach((win) => {
    win.addEventListener("pointerdown", () => focusWindow(win));
    win.querySelector("iframe")?.addEventListener("focus", () => focusWindow(win));
    win.querySelectorAll("[data-window-action]").forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (button.dataset.windowAction === "minimize") minimizeWindow(win);
      if (button.dataset.windowAction === "maximize") toggleMaximize(win);
      if (button.dataset.windowAction === "close") closeWindow(win);
    }));
    win.querySelector("[data-drag-handle]")?.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest("button")) return;
      focusWindow(win);
      if (win.classList.contains("is-maximized")) {
        win.classList.remove("is-maximized");
        win.style.left = `${Math.max(8, event.clientX - win.offsetWidth / 2)}px`;
        win.style.top = "8px";
      }
      dragState = { win, x: event.clientX, y: event.clientY, left: win.offsetLeft, top: win.offsetTop };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    win.querySelector("[data-drag-handle]")?.addEventListener("dblclick", (event) => {
      if (!event.target.closest("button")) toggleMaximize(win);
    });
    win.querySelectorAll("[data-resize]").forEach((handle) => handle.addEventListener("pointerdown", (event) => {
      if (win.classList.contains("is-maximized") || event.button !== 0) return;
      focusWindow(win);
      resizeState = { win, edge: handle.dataset.resize, x: event.clientX, y: event.clientY,
        left: win.offsetLeft, top: win.offsetTop, width: win.offsetWidth, height: win.offsetHeight };
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
      event.stopPropagation();
    }));
  });

  document.addEventListener("pointermove", (event) => {
    const bounds = surface.getBoundingClientRect();
    if (dragState) {
      const { win, x, y, left, top } = dragState;
      win.style.left = `${Math.max(0, Math.min(bounds.width - 90, left + event.clientX - x))}px`;
      win.style.top = `${Math.max(0, Math.min(bounds.height - 38, top + event.clientY - y))}px`;
      return;
    }
    if (!resizeState) return;
    const { win, edge, x, y, left, top, width, height } = resizeState;
    const dx = event.clientX - x;
    const dy = event.clientY - y;
    let nextLeft = left, nextTop = top, nextWidth = width, nextHeight = height;
    if (edge.includes("e")) nextWidth = width + dx;
    if (edge.includes("s")) nextHeight = height + dy;
    if (edge.includes("w")) { nextWidth = width - dx; nextLeft = left + dx; }
    if (edge.includes("n")) { nextHeight = height - dy; nextTop = top + dy; }
    if (nextWidth < 330) { if (edge.includes("w")) nextLeft -= 330 - nextWidth; nextWidth = 330; }
    if (nextHeight < 250) { if (edge.includes("n")) nextTop -= 250 - nextHeight; nextHeight = 250; }
    nextWidth = Math.min(nextWidth, bounds.width - Math.max(0, nextLeft));
    nextHeight = Math.min(nextHeight, bounds.height - Math.max(0, nextTop));
    win.style.left = `${Math.max(0, nextLeft)}px`;
    win.style.top = `${Math.max(0, nextTop)}px`;
    win.style.width = `${nextWidth}px`;
    win.style.height = `${nextHeight}px`;
  });
  document.addEventListener("pointerup", () => {
    if (dragState || resizeState) saveLayout();
    dragState = null;
    resizeState = null;
  });

  function navigateProxy(value) {
    const target = String(value || "").trim();
    if (!target) return;
    openWindow("proxy-1");
    frameFor("proxy-1")?.contentWindow.postMessage({ type: "bromine:desktop-navigate", url: target }, location.origin);
  }
  for (const field of [document.querySelector("#taskbar-search-input"), startSearch]) {
    field.addEventListener("focus", () => { if (field.id === "taskbar-search-input") { menu.hidden = false; requestAnimationFrame(() => menu.classList.add("is-open")); } });
    field.addEventListener("input", () => {
      const value = field.value.toLowerCase().trim();
      document.querySelectorAll(".pinned-apps button,.recent-apps button").forEach((button) => {
        button.hidden = Boolean(value && !(button.dataset.appLabel || button.textContent).toLowerCase().includes(value));
      });
      if (field.id !== "start-search-input") startSearch.value = field.value;
      else document.querySelector("#taskbar-search-input").value = field.value;
    });
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && field.value.trim()) {
        event.preventDefault();
        const value = field.value.trim();
        const match = [...document.querySelectorAll(".pinned-apps button")].find((button) => (button.dataset.appLabel || button.textContent).trim().toLowerCase() === value.toLowerCase());
        if (match) openWindow(match.dataset.openWindow); else navigateProxy(value);
        field.value = "";
        startSearch.value = "";
        closeStartMenu();
      }
      if (event.key === "Escape") closeStartMenu();
    });
  }
  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest("#start-menu,.taskbar-start,.desktop-brand,[data-start-toggle]")) closeStartMenu();
  });
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin) return;
    if (event.data?.type === "bromine:desktop-appearance" && event.source === frameFor("settings")?.contentWindow) applyAppearance(event.data.appearance);
    if (event.data?.type === "bromine:settings-close" && event.source === frameFor("settings")?.contentWindow) closeWindow(windowsById.get("settings"));
  });
  if (settingsShareHash) {
    const settingsFrame = frameFor("settings");
    const forwardShare = () => settingsFrame?.contentWindow?.postMessage({ type: "bromine:settings-share-import", hash: settingsShareHash }, location.origin);
    settingsFrame?.addEventListener("load", forwardShare, { once: true });
    setTimeout(() => {
      openWindow("settings");
      let attempts = 0;
      const waitForSettingsApp = setInterval(() => {
        forwardShare();
        if (++attempts >= 20) clearInterval(waitForSettingsApp);
      }, 250);
    }, 0);
  }
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeStartMenu();
    if (event.altKey && event.key === "1") openWindow("proxy-1");
    if (event.altKey && event.key === "2") openWindow("proxy-2");
  });

  function updateClock() {
    const now = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date());
    document.querySelector("#desktop-clock").textContent = now;
    document.querySelector("#taskbar-clock").textContent = now;
  }
  updateClock();
  setInterval(updateClock, 30_000);
  initialLayout();
  window.addEventListener("resize", () => {
    const bounds = surface.getBoundingClientRect();
    for (const win of windows) {
      if (win.hidden || win.classList.contains("is-maximized")) continue;
      win.style.left = `${Math.max(0, Math.min(win.offsetLeft, bounds.width - 100))}px`;
      win.style.top = `${Math.max(0, Math.min(win.offsetTop, bounds.height - 42))}px`;
      win.style.width = `${Math.min(win.offsetWidth, bounds.width - win.offsetLeft)}px`;
      win.style.height = `${Math.min(win.offsetHeight, bounds.height - win.offsetTop)}px`;
    }
    saveLayout();
  });
  focusWindow(windowsById.get("proxy-1"));

  const canvas = document.querySelector("#desktop-rain");
  const context = canvas.getContext("2d", { alpha: true });
  const drops = [];
  let width = 0, height = 0, scale = 1;
  function resizeRain() {
    scale = Math.min(window.devicePixelRatio || 1, 1.5);
    width = window.innerWidth; height = window.innerHeight;
    canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
    context.setTransform(scale, 0, 0, scale, 0, 0);
    drops.length = 0;
    for (let index = 0; index < Math.min(150, Math.round(width / 12)); index++) drops.push({
      x: Math.random() * width, y: Math.random() * height, speed: 2 + Math.random() * 5,
      length: 9 + Math.random() * 20, alpha: .07 + Math.random() * .12,
    });
  }
  function drawRain() {
    context.clearRect(0, 0, width, height);
    if (document.documentElement.dataset.rain !== "off" && !document.hidden && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      context.lineCap = "round";
      for (const drop of drops) {
        drop.speed = Math.min(9, drop.speed + .02);
        drop.x += .32; drop.y += drop.speed;
        context.beginPath(); context.strokeStyle = `rgba(224,232,239,${drop.alpha})`; context.lineWidth = .7;
        context.moveTo(drop.x, drop.y); context.lineTo(drop.x - .6, drop.y + drop.length); context.stroke();
        if (drop.y > height + drop.length) { drop.y = -drop.length; drop.x = Math.random() * width; drop.speed = 2 + Math.random() * 5; }
      }
    }
    requestAnimationFrame(drawRain);
  }
  resizeRain(); window.addEventListener("resize", resizeRain, { passive: true }); requestAnimationFrame(drawRain);
})();
