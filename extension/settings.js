import "./rules.js";
const rules = globalThis.QdmRules;

// Apply the newly supported site once, including to users who saved the old
// defaults. A later deliberate removal remains removed on reload/update.
export async function migrateSettings(storage) {
  const saved = await storage.get(null);
  if ((saved.siteDefaultsVersion || 0) >= 1) return;
  const sites = saved.sites ?? rules.DEFAULTS.sites;
  const imageHosts = saved.imageHosts ?? rules.DEFAULTS.imageHosts;
  await storage.set({
    sites: [...new Set([...sites, "reddit.com"])],
    imageHosts: [...new Set([...imageHosts, "i.redd.it", "preview.redd.it", "external-preview.redd.it"])],
    siteDefaultsVersion: 1
  });
}
