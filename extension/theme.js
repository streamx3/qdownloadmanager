import { palettes } from "./palettes.js";
import { DEFAULT_APPEARANCE, validAppearance } from "./appearance.js";

export function themeColors(appearance, systemDark = false) {
  const { palette, colorScheme } = validAppearance(appearance) || DEFAULT_APPEARANCE;
  const p = palettes[palette];
  const dark = colorScheme === "dark" || (colorScheme === "system" && systemDark);
  const g = dark ? p.dark : p.light;
  const neutral = dark ? p.neutralRamp : p.neutralRamp.slice().reverse();
  const accent = dark ? p.accentRamp : p.accentRamp.slice().reverse();
  return { palette, dark, colors: {
    bg: g.bg, surface: g.surface, text: g.text, line: g.edge,
    muted: neutral[dark ? 3 : 2], dim: neutral[dark ? 4 : 2], inset: neutral[8],
    accent: dark ? p.accent : p.accentRamp[5], "accent-text": accent[2], "accent-dark": accent[8],
    hover: neutral[dark ? 7 : 8], danger: dark ? "#e37272" : "#b23a3a"
  } };
}

// Both extension pages follow the app. Cache survives app shutdown and worker
// restarts; System continues to follow the OS even while the app is closed.
export function startTheme(onStatus = () => {}) {
  let appearance = DEFAULT_APPEARANCE, changed = false, pending;
  const media = matchMedia("(prefers-color-scheme: dark)");
  function apply() {
    const { palette, dark, colors } = themeColors(appearance, media.matches);
    for (const [key, color] of Object.entries(colors)) document.documentElement.style.setProperty(`--${key}`, color);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    document.documentElement.dataset.palette = palette;
    document.documentElement.dataset.scheme = dark ? "dark" : "light";
  }
  apply();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.appearance) {
      changed = true;
      appearance = validAppearance(changes.appearance.newValue) || DEFAULT_APPEARANCE;
      apply();
    }
  });
  chrome.storage.local.get("appearance").then(saved => {
    if (!changed) { appearance = validAppearance(saved.appearance) || DEFAULT_APPEARANCE; apply(); }
  }).catch(() => {});
  media.addEventListener("change", apply);
  function refresh() {
    if (!pending) pending = chrome.runtime.sendMessage({ type: "status" })
      .catch(error => ({ online: false, error: error.message }))
      .then(state => {
        const updated = validAppearance(state?.appearance);
        if (updated) { changed = true; appearance = updated; apply(); }
        onStatus(state);
        return state;
      }).finally(() => { pending = null; });
    return pending;
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  const timer = setInterval(() => { if (!document.hidden) refresh(); }, 3000);
  window.addEventListener("pagehide", () => clearInterval(timer), { once: true });
  refresh();
  return refresh;
}
