export const DEFAULT_APPEARANCE = Object.freeze({ palette: "blurple", colorScheme: "dark" });
export const COLOR_ROLES = Object.freeze([
  "bg", "surface", "text", "line", "muted", "dim", "inset", "accent", "accent-text", "accent-dark", "hover", "danger"
]);

export function validAppearance(value) {
  if (!value || !["blurple", "teal", "blue", "grey"].includes(value.palette)
      || !["dark", "light", "system"].includes(value.colorScheme)) return null;
  const appearance = { palette: value.palette, colorScheme: value.colorScheme };
  if (["dark", "light"].includes(value.resolvedScheme) && value.colors
      && COLOR_ROLES.every(role => typeof value.colors[role] === "string" && /^#[0-9a-f]{6}$/i.test(value.colors[role]))) {
    appearance.resolvedScheme = value.resolvedScheme;
    appearance.colors = Object.fromEntries(COLOR_ROLES.map(role => [role, value.colors[role]]));
  }
  return appearance;
}

export async function cacheAppearance(storage, value) {
  const appearance = validAppearance(value);
  if (!appearance) return; // Older apps have no appearance field; retain the last theme.
  const saved = (await storage.get("appearance")).appearance;
  if (JSON.stringify(validAppearance(saved)) !== JSON.stringify(appearance))
    await storage.set({ appearance });
}
