(() => {
  const VERSION = "0.2.6";
  if (globalThis.__qdmVersion === VERSION && document.querySelector("#qdm-image-buttons")) { globalThis.__qdmRefresh?.(); return; }
  globalThis.__qdmDestroy?.();
  // Reloading an unpacked extension invalidates its old JS context, but leaves
  // that context's DOM behind. Remove every old overlay before installing ours.
  for (const stale of document.querySelectorAll("#qdm-image-buttons")) stale.remove();
  globalThis.__qdmInstalled = true;
  globalThis.__qdmVersion = VERSION;
  const rules = globalThis.QdmRules;
  const host = document.createElement("div");
  host.id = "qdm-image-buttons";
  host.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483646!important;";
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    button,.notice { color-scheme:dark;--qdm-bg:#161826;--qdm-surface:#232532;--qdm-text:#e9e9ed;--qdm-line:#3f424d;--qdm-accent:#9184d9;--qdm-accent-text:#d2cefd;--qdm-accent-dark:#2b2741;--qdm-hover:#3f424d;--qdm-danger:#e37272;--qdm-shadow:#0006; }
    button { position:fixed;display:grid;place-items:center;box-sizing:border-box;width:32px;height:32px;padding:0;border:1px solid var(--qdm-accent);border-radius:10px;background:var(--qdm-bg);color:var(--qdm-accent-text);box-shadow:0 2px 8px var(--qdm-shadow);cursor:pointer;opacity:0;pointer-events:none;transition:opacity .12s,background .12s;font:15px system-ui; }
    button[data-hover], button:focus-visible { opacity:1;pointer-events:auto; }
    button:hover { background:var(--qdm-hover); }
    button:active { background:var(--qdm-accent-dark); }
    button:focus-visible { outline:2px solid var(--qdm-accent);outline-offset:3px; }
    button[data-state="error"] { color:var(--qdm-danger);border-color:var(--qdm-danger); }
    button[hidden] { display:none; }
    button[aria-busy="true"] { cursor:progress; }
    svg { width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round; }
    .spinner { animation:qdm-spin .9s linear infinite; }
    @keyframes qdm-spin { to { transform:rotate(360deg); } }
    @media (prefers-reduced-motion:reduce) { .spinner { animation:none; } button { transition:none; } }
    .notice { position:fixed;bottom:20px;right:20px;max-width:min(360px,80vw);padding:12px 16px;border:1px solid var(--qdm-line);border-radius:8px;background:var(--qdm-surface);color:var(--qdm-text);font:13px/1.5 system-ui;box-shadow:0 4px 20px var(--qdm-shadow);pointer-events:auto; }
  `;
  root.append(style);
  const themeStyle = document.createElement("style");
  root.append(themeStyle);
  let appearanceRevision = 0;
  function applyAppearance(value) {
    const appearance = globalThis.QdmAppearance.validAppearance(value);
    if (!appearance?.colors) { themeStyle.textContent = ""; return; }
    // Only whitelisted hex colors enter the stylesheet, inside our shadow root.
    // Applying to controls directly also prevents site CSS variables leaking in.
    const variables = Object.entries(appearance.colors).map(([role, color]) => `--qdm-${role}:${color}`).join(";");
    const dark = appearance.resolvedScheme === "dark";
    themeStyle.textContent = `button,.notice{${variables};color-scheme:${dark ? "dark" : "light"};--qdm-shadow:${dark ? "#0006" : "#0003"}}`;
  }
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
  let enabled = false, pending = false, checking = false, destroyed = false, noticeTimer, checkTimer, frameId;
  const listeners = [];
  function listen(target, event, handler, options) {
    target.addEventListener(event, handler, options);
    listeners.push(() => target.removeEventListener(event, handler, options));
  }
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
    if (destroyed || checking || !enabled || document.hidden) return;
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
  function scheduleCheck() { if (!destroyed && !checkTimer) checkTimer = setTimeout(checkFiles, 250); }
  function addImages(scope) {
    if (![Node.ELEMENT_NODE, Node.DOCUMENT_FRAGMENT_NODE].includes(scope.nodeType) || scope === host) return;
    const images = scope.matches?.("img") ? [scope] : scope.querySelectorAll("img");
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
    // Modern Reddit uses custom elements; querySelectorAll alone cannot see
    // images inside their open shadow roots. Observe each root independently.
    for (const element of [scope, ...scope.querySelectorAll("*")]) {
      if (element !== host && element.shadowRoot) observeShadow(element.shadowRoot);
    }
    schedule();
  }
  function observeShadow(shadow) {
    if (shadowObservers.has(shadow)) return;
    const observer = new MutationObserver(onMutations);
    observer.observe(shadow, observation);
    shadow.addEventListener("load", schedule, true);
    shadow.addEventListener("scroll", schedule, { capture: true, passive: true });
    shadowObservers.set(shadow, observer);
    addImages(shadow);
  }
  function hitImage() {
    if (!pointer) return null;
    let element = document.elementFromPoint(pointer.x, pointer.y);
    // Stop at our overlay host; its hover tracking handles the button itself.
    while (element && element !== host && element.shadowRoot) {
      const inner = element.shadowRoot.elementFromPoint(pointer.x, pointer.y);
      if (!inner || inner === element) break;
      element = inner;
    }
    return element;
  }
  function containsImage(element, image) {
    if (!element || element === host) return false;
    for (let node = image; node; node = node.getRootNode?.().host) {
      if (element.contains(node)) return true;
    }
    return false;
  }
  function layout() {
    pending = false;
    const underPointer = hitImage();
    let hoveredEntry = null;
    for (const [image, entry] of entries) {
      const { button } = entry;
      if (!image.isConnected) { resize.unobserve(image); button.remove(); entries.delete(image); continue; }
      const rect = image.getBoundingClientRect();
      const url = rules.originalImage(image, location.href);
      if (entry.url !== url) { entry.url = url; entry.exists = entry.busy = false; entry.error = null; render(entry); scheduleCheck(); }
      const visible = enabled && rules.allowed(url, imageHosts) && image.complete && image.naturalWidth >= 100 && image.naturalHeight >= 80
        && rect.width >= 100 && rect.height >= 80 && rect.bottom > 0 && rect.top < innerHeight
        && rect.right > 0 && rect.left < innerWidth && image.getClientRects().length > 0
        && (image.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) ?? true);
      if (button.hidden && visible) scheduleCheck();
      button.hidden = !visible;
      const inside = pointer && pointer.x >= rect.left && pointer.x < rect.right && pointer.y >= rect.top && pointer.y < rect.bottom;
      const hovered = visible && pointer && ((underPointer === host && entry.hover)
        || (inside && (underPointer === image
          || (getComputedStyle(image).pointerEvents === "none" && containsImage(underPointer, image)))));
      if (hovered) hoveredEntry = entry;
      if (visible) {
        button.style.left = `${Math.max(4, Math.min(innerWidth - 38, rect.right - 38))}px`;
        button.style.top = `${Math.max(4, rect.top + 6)}px`;
      }
    }
    // Only the image actually under the pointer owns a visible mouse control.
    for (const entry of entries.values()) entry.button.toggleAttribute("data-hover", entry === hoveredEntry);
  }
  function schedule() { if (!destroyed && !pending) { pending = true; frameId = requestAnimationFrame(layout); } }
  async function refresh() {
    try {
      const revision = appearanceRevision;
      const settings = await chrome.storage.local.get({ ...rules.DEFAULTS, appearance: null });
      if (destroyed) return;
      if (revision === appearanceRevision) applyAppearance(settings.appearance);
      enabled = rules.allowed(location.href, settings.sites);
      imageHosts = [...settings.sites, ...settings.imageHosts];
      schedule(); scheduleCheck();
    } catch { enabled = false; schedule(); }
  }
  globalThis.__qdmRefresh = refresh;
  const resize = new ResizeObserver(schedule);
  const shadowObservers = new Map();
  const observation = { childList: true, subtree: true, attributes: true,
    attributeFilter: ["src", "srcset", "href", "style", "class", "hidden", "aria-hidden", "data-url", "content-href"] };
  function onMutations(records) {
    for (const record of records) for (const node of record.addedNodes) if (node !== host) addImages(node);
    schedule();
  }
  const observer = new MutationObserver(onMutations);
  observer.observe(document.documentElement, observation);
  function clearPointer() {
    pointer = null;
    for (const entry of entries.values()) entry.hover = false;
    schedule();
  }
  listen(document, "pointermove", event => { pointer = { x: event.clientX, y: event.clientY }; schedule(); }, { passive: true });
  listen(document, "pointerleave", clearPointer);
  listen(document, "pointerout", event => { if (!event.relatedTarget) clearPointer(); });
  listen(document, "visibilitychange", () => { if (document.hidden) clearPointer(); schedule(); scheduleCheck(); });
  listen(document, "load", schedule, true);
  listen(document, "scroll", schedule, { capture: true, passive: true });
  listen(window, "resize", schedule, { passive: true });
  listen(window, "focus", scheduleCheck);
  listen(window, "blur", clearPointer);
  const settingsChanged = (changes, area) => {
    if (area !== "local" || destroyed) return;
    if (changes.appearance) { appearanceRevision++; applyAppearance(changes.appearance.newValue); }
    if (changes.sites || changes.imageHosts) refresh();
  };
  chrome.storage.onChanged.addListener(settingsChanged);
  const interval = setInterval(() => {
    if (!host.isConnected) { destroy(); return; }
    if (!enabled || document.hidden) return;
    // A custom element can attach its root after insertion without a document
    // mutation. Rescan at the status cadence, not on every pointer movement.
    for (const [shadow, observer] of shadowObservers) {
      if (!shadow.host.isConnected) {
        observer.disconnect(); shadow.removeEventListener("load", schedule, true);
        shadow.removeEventListener("scroll", schedule, true); shadowObservers.delete(shadow);
      }
    }
    addImages(document.documentElement);
    for (const shadow of shadowObservers.keys()) addImages(shadow);
    schedule(); checkFiles();
  }, 3000);
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    clearInterval(interval); clearTimeout(checkTimer); clearTimeout(noticeTimer); cancelAnimationFrame(frameId);
    observer.disconnect(); resize.disconnect();
    for (const [shadow, observer] of shadowObservers) {
      observer.disconnect(); shadow.removeEventListener("load", schedule, true); shadow.removeEventListener("scroll", schedule, true);
    }
    shadowObservers.clear(); entries.clear();
    for (const remove of listeners) remove();
    try { chrome.storage.onChanged.removeListener?.(settingsChanged); } catch { /* Old extension context was invalidated. */ }
    host.remove();
    if (globalThis.__qdmDestroy === destroy) {
      delete globalThis.__qdmInstalled; delete globalThis.__qdmVersion; delete globalThis.__qdmRefresh; delete globalThis.__qdmDestroy;
    }
  }
  globalThis.__qdmDestroy = destroy;
  addImages(document.documentElement);
  refresh();
})();
