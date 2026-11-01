(() => {
  if (globalThis.__qdmInstalled) { globalThis.__qdmRefresh?.(); return; }
  globalThis.__qdmInstalled = true;
  const rules = globalThis.QdmRules;
  const host = document.createElement("div");
  host.id = "qdm-image-buttons";
  host.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483646!important;";
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host { color-scheme: dark; }
    button { position:fixed;display:grid;place-items:center;box-sizing:border-box;width:32px;height:32px;padding:0;border:1px solid #9184d9;border-radius:8px;background:#161826eb;color:#d2cefd;box-shadow:0 2px 8px #0006;cursor:pointer;opacity:0;pointer-events:none;transition:opacity .12s,background .12s;font:15px system-ui; }
    button[data-hover], button:focus-visible { opacity:1;pointer-events:auto; }
    button:hover { background:#423a6a; }
    button:focus-visible { outline:2px solid #d2cefd;outline-offset:3px; }
    button[hidden] { display:none; }
    button[aria-busy="true"] { cursor:progress; }
    svg { width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round; }
    .spinner { animation:qdm-spin .9s linear infinite; }
    @keyframes qdm-spin { to { transform:rotate(360deg); } }
    @media (prefers-reduced-motion:reduce) { .spinner { animation:none; } button { transition:none; } }
    .notice { position:fixed;bottom:20px;right:20px;max-width:min(360px,80vw);padding:12px 16px;border:1px solid #595d6c;border-radius:8px;background:#232532;color:#e9e9ed;font:13px/1.5 system-ui;box-shadow:0 4px 20px #0005;pointer-events:auto; }
  `;
  root.append(style);
  const notice = document.createElement("div");
  notice.className = "notice";
  notice.setAttribute("role", "status");
  notice.hidden = true;
  root.append(notice);
  document.documentElement.append(host);
  const entries = new Map();
  const icons = {
    idle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v13m-5-5 5 5 5-5M4 20h16"/></svg>',
    exists: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
    busy: '<svg class="spinner" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-8-8"/></svg>',
    error: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v10m0 5v1"/></svg>'
  };
  let enabled = false, pending = false, checking = false, noticeTimer, checkTimer;
  let imageHosts = [], pointer = null;
  function toast(text) {
    clearTimeout(noticeTimer);
    notice.textContent = text;
    notice.hidden = false;
    noticeTimer = setTimeout(() => { notice.hidden = true; }, 6500);
  }
  function render(entry) {
    const state = entry.saving || entry.busy ? "busy" : entry.error ? "error" : entry.exists ? "exists" : "idle";
    const title = state === "busy" ? "Saving image…" : state === "error" ? entry.error : state === "exists"
      ? entry.policy === "overwrite" ? "Already exists · click to overwrite" : "Already exists · download will be skipped"
      : "Save image with Download Helper";
    if (entry.button.dataset.state !== state) { entry.button.innerHTML = icons[state]; entry.button.dataset.state = state; }
    entry.button.title = title;
    entry.button.setAttribute("aria-label", title);
    entry.button.setAttribute("aria-busy", String(state === "busy"));
    entry.button.setAttribute("aria-disabled", String(state === "busy"));
  }
  async function save(entry) {
    if (entry.saving || entry.busy) return;
    const url = entry.url;
    if (!url) return;
    entry.saving = true;
    entry.error = null;
    render(entry);
    try {
      const result = await chrome.runtime.sendMessage({ type: "download", url });
      if (!result?.ok) throw new Error(result?.error || "No response from the extension. Reload this page and try again.");
      if (entry.url === url) {
        entry.exists = ["completed", "skipped"].includes(result.state);
        entry.busy = !entry.exists;
      }
      toast(result.state === "skipped" ? `Already exists: ${result.name}. Skipped.`
        : result.state === "completed" ? `Saved ${result.name}` : "Saving in Download Helper…");
    } catch (error) {
      if (entry.url === url) { entry.error = error.message; entry.busy = false; }
      toast(error.message);
      setTimeout(() => { entry.error = null; render(entry); }, 6500);
    } finally {
      entry.saving = false;
      render(entry);
      scheduleCheck();
    }
  }
  async function checkFiles() {
    checkTimer = null;
    if (checking || !enabled || document.hidden) return;
    checking = true;
    try {
      const visible = [...entries.values()].filter(entry => !entry.button.hidden && entry.url);
      const urls = [...new Set(visible.map(entry => entry.url))];
      for (let at = 0; at < urls.length; at += 64) {
        const batch = urls.slice(at, at + 64);
        const result = await chrome.runtime.sendMessage({ type: "filesStatus", urls: batch });
        if (!result?.ok) throw new Error(result?.error || "Desktop app unavailable");
        const files = new Map(result.files.map(file => [file.url, file]));
        for (const entry of visible) {
          const file = files.get(entry.url);
          if (!file || entry.saving) continue;
          entry.exists = file.exists;
          entry.busy = file.busy;
          entry.policy = file.policy;
          render(entry);
        }
      }
    } catch {
      // Existence is unknown while disconnected; never leave a stale checkmark.
      for (const entry of entries.values()) {
        if (entry.saving) continue;
        entry.exists = entry.busy = false;
        render(entry);
      }
    } finally { checking = false; }
  }
  function scheduleCheck() { if (!checkTimer) checkTimer = setTimeout(checkFiles, 250); }
  function addImages(scope) {
    if (scope.nodeType !== Node.ELEMENT_NODE) return;
    const images = scope.matches("img") ? [scope] : scope.querySelectorAll("img");
    for (const image of images) {
      if (entries.has(image)) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.hidden = true;
      const entry = { image, button, url: null, exists: false, busy: false, saving: false, policy: "skip" };
      button.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); save(entry); });
      button.addEventListener("pointerenter", () => { entry.hover = true; schedule(); });
      button.addEventListener("pointerleave", () => { entry.hover = false; schedule(); });
      root.append(button);
      entries.set(image, entry);
      render(entry);
      resize.observe(image);
    }
    schedule();
  }
  function layout() {
    pending = false;
    const underPointer = pointer ? document.elementFromPoint(pointer.x, pointer.y) : null;
    for (const [image, entry] of entries) {
      const { button } = entry;
      if (!image.isConnected) { resize.unobserve(image); button.remove(); entries.delete(image); continue; }
      const rect = image.getBoundingClientRect();
      const url = rules.originalImage(image, location.href);
      if (entry.url !== url) { entry.url = url; entry.exists = entry.busy = false; entry.error = null; render(entry); scheduleCheck(); }
      const visible = enabled && rules.allowed(url, imageHosts) && image.complete && image.naturalWidth >= 100 && image.naturalHeight >= 80
        && rect.width >= 100 && rect.height >= 80 && rect.bottom > 0 && rect.top < innerHeight
        && rect.right > 0 && rect.left < innerWidth && image.getClientRects().length > 0;
      if (button.hidden && visible) scheduleCheck();
      button.hidden = !visible;
      const hovered = pointer && pointer.x >= rect.left && pointer.x < rect.right && pointer.y >= rect.top && pointer.y < rect.bottom
        && (underPointer === image || (underPointer === host && entry.hover));
      button.toggleAttribute("data-hover", Boolean(visible && hovered));
      if (visible) {
        button.style.left = `${Math.max(4, Math.min(innerWidth - 38, rect.right - 38))}px`;
        button.style.top = `${Math.max(4, rect.top + 6)}px`;
      }
    }
  }
  function schedule() { if (!pending) { pending = true; requestAnimationFrame(layout); } }
  async function refresh() {
    try {
      const settings = await chrome.storage.local.get(rules.DEFAULTS);
      enabled = rules.allowed(location.href, settings.sites);
      imageHosts = [...settings.sites, ...settings.imageHosts];
      schedule(); scheduleCheck();
    } catch { enabled = false; schedule(); }
  }
  globalThis.__qdmRefresh = refresh;
  const resize = new ResizeObserver(schedule);
  const observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) if (node !== host) addImages(node);
    schedule();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "srcset", "href", "style", "class"] });
  document.addEventListener("pointermove", event => { pointer = { x: event.clientX, y: event.clientY }; schedule(); }, { passive: true });
  document.addEventListener("pointerleave", () => { pointer = null; schedule(); });
  document.addEventListener("visibilitychange", () => { schedule(); scheduleCheck(); });
  document.addEventListener("load", schedule, true);
  document.addEventListener("scroll", schedule, { capture: true, passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("focus", scheduleCheck);
  chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && (changes.sites || changes.imageHosts)) refresh(); });
  setInterval(checkFiles, 3000);
  addImages(document.documentElement);
  refresh();
})();
