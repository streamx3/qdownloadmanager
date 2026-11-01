import "./rules.js";
import { startTheme } from "./theme.js";
const byId = id => document.getElementById(id);
const refresh = startTheme(state => {
  byId("dot").classList.toggle("online", !!state.online);
  byId("status").textContent = state.online ? (state.accepting ? "App connected" : "App needs attention") : "App unavailable";
  byId("detail").textContent = state.online ? (state.accepting ? "Ready to save images to this computer." : state.setupComplete ? "Resume new downloads in the desktop app." : "Finish setup in the desktop app.") : state.error;
  byId("connect").textContent = state.online ? "Check connection" : "Connect";
});
byId("connect").addEventListener("click", async () => {
  byId("connect").disabled = true;
  try { await refresh(); } finally { byId("connect").disabled = false; }
});
byId("options").addEventListener("click", () => chrome.runtime.openOptionsPage());
chrome.storage.local.get(QdmRules.DEFAULTS).then(settings => { byId("sites").textContent = `Enabled: ${settings.sites.join(", ") || "no websites"}`; });
