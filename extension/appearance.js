export const DEFAULT_APPEARANCE = Object.freeze({ palette: "blurple", colorScheme: "dark" });

export function validAppearance(value) {
  if (!value || !["blurple", "teal", "blue", "grey"].includes(value.palette)
      || !["dark", "light", "system"].includes(value.colorScheme)) return null;
  return { palette: value.palette, colorScheme: value.colorScheme };
}

export async function cacheAppearance(storage, value) {
  const appearance = validAppearance(value);
  if (!appearance) return; // Older apps have no appearance field; retain the last theme.
  const saved = (await storage.get("appearance")).appearance;
  if (saved?.palette !== appearance.palette || saved?.colorScheme !== appearance.colorScheme)
    await storage.set({ appearance });
}
