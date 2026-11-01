import "./rules.js";
const byId = id => document.getElementById(id);
async function refresh() {
  byId("connect").disabled = true;
  try {
    const state = await chrome.runtime.sendMessage({ type: "status" });
    byId("dot").classList.toggle("online", !!state.online);
    byId("status").textContent = state.online ? (state.accepting ? "App connected" : "App needs attention") : "App unavailable";
    byId("detail").textContent = state.online ? (state.accepting ? "Ready to save images to this computer." : state.setupComplete ? "Resume new downloads in the desktop app." : "Finish setup in the desktop app.") : state.error;
    byId("connect").textContent = state.online ? "Check connection" : "Connect";
  } catch (error) { byId("status").textContent = "Connection failed"; byId("detail").textContent = error.message; }
  finally { byId("connect").disabled = false; }
}
byId("connect").addEventListener("click", refresh);
byId("options").addEventListener("click", () => chrome.runtime.openOptionsPage());
chrome.storage.local.get(QdmRules.DEFAULTS).then(settings => { byId("sites").textContent = `Enabled: ${settings.sites.join(", ") || "no websites"}`; });
refresh();
