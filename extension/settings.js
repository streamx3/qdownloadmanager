import "./rules.js";
const rules = globalThis.QdmRules;

// Reset previous site lists to the Reddit-only defaults once. Subsequent user
// edits and explicit opt-outs remain untouched on reload/update.
export async function migrateSettings(storage) {
  const saved = await storage.get(null);
  if ((saved.siteDefaultsVersion || 0) >= 2) return;
  await storage.set({
    sites: Array.isArray(saved.sites) && saved.sites.length === 0 ? [] : rules.DEFAULTS.sites,
    imageHosts: rules.DEFAULTS.imageHosts,
    siteDefaultsVersion: 2
  });
}
