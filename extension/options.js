import "./rules.js";
import { startTheme } from "./theme.js";
startTheme();
const byId = id => document.getElementById(id);
const rules = globalThis.QdmRules;
byId("extensionId").textContent = chrome.runtime.id;
chrome.storage.local.get(rules.DEFAULTS).then(settings => {
  byId("sites").value = settings.sites.join("\n");
  byId("imageHosts").value = settings.imageHosts.join("\n");
  byId("mode").value = settings.mode;
});
byId("settings").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const parse = id => [...new Set(byId(id).value.split(/\n/).map(s => s.trim()).filter(Boolean).map(rules.normalizeHost))];
    const sites = parse("sites"), imageHosts = parse("imageHosts");
    if (sites.length + imageHosts.length > 50) throw new Error("Use at most 50 domains.");
    const origins = rules.permissionOrigins([...sites, ...imageHosts]);
    if (origins.length && !await chrome.permissions.request({ origins })) throw new Error("Website access was not granted. Your settings were not changed.");
    await chrome.storage.local.set({ sites, imageHosts, mode: byId("mode").value });
    const response = await chrome.runtime.sendMessage({ type: "syncSites" });
    if (!response?.ok) throw new Error(response?.error || "Could not apply website settings.");
    byId("feedback").textContent = "Saved. Download buttons are enabled on your selected websites.";
  } catch (error) { byId("feedback").textContent = error.message; }
  finally { button.disabled = false; }
});
