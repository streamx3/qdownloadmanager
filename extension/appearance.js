import "./appearance-data.js";
export const { DEFAULT_APPEARANCE, COLOR_ROLES, validAppearance } = globalThis.QdmAppearance;

export async function cacheAppearance(storage, value) {
  const appearance = validAppearance(value);
  if (!appearance) return; // Older apps have no appearance field; retain the last theme.
  const saved = (await storage.get("appearance")).appearance;
  if (JSON.stringify(validAppearance(saved)) !== JSON.stringify(appearance))
    await storage.set({ appearance });
}
