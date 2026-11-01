// Loads the real unpacked extension in a temporary Chrome profile. Only the
// Native Messaging boundary is faked; permissions, storage, worker and pages run
// in Chrome. Set QDM_CHROME and QDM_PLAYWRIGHT_MODULE as for browser-ui.mjs.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const { chromium } = await import(process.env.QDM_PLAYWRIGHT_MODULE || "playwright");
const context = await chromium.launchPersistentContext("", {
  executablePath: process.env.QDM_CHROME, headless: true,
  ignoreDefaultArgs: ["--disable-extensions"], args: ["--enable-unsafe-extension-debugging"]
});
try {
  const cdp = await context.browser().newBrowserCDPSession();
  const { id } = await cdp.send("Extensions.loadUnpacked", { path: fileURLToPath(new URL("../extension", import.meta.url)) });
  const worker = context.serviceWorkers().find(worker => worker.url().includes(id))
    || await context.waitForEvent("serviceworker", { predicate: worker => worker.url().includes(id) });
  await worker.evaluate(() => {
    globalThis.appAppearance = { palette: "teal", colorScheme: "dark" };
    globalThis.appOnline = true;
    // Do not connect this test profile to the user's running desktop app.
    chrome.runtime.connectNative = () => {
      let receive;
      return {
        onMessage: { addListener(fn) { receive = fn; } }, onDisconnect: { addListener() {} },
        postMessage(message) {
          queueMicrotask(() => receive({ v: 1, id: message.id, ok: appOnline,
            ...(appOnline ? { setupComplete: true, accepting: true, appearance: appAppearance }
              : { error: { code: "app_not_running", message: "Open Download Helper." } }) }));
        }, disconnect() {}
      };
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`chrome-extension://${id}/options.html`);
  await page.waitForFunction(() => document.documentElement.dataset.palette === "teal");
  await page.waitForFunction(() => document.querySelector("#sites").value.includes("joyreactor.cc"));
  const initial = await page.evaluate(() => chrome.storage.local.get(["sites", "imageHosts", "mode"]));
  const save = page.getByRole("button", { name: "Save settings" });
  await save.click();
  await page.waitForFunction(() => document.querySelector("#feedback").textContent.startsWith("Saved."));
  assert.equal(await page.evaluate(() => chrome.storage.local.get("mode").then(s => s.mode)), "browser");
  assert.ok((await page.evaluate(() => chrome.scripting.getRegisteredContentScripts())).some(script => script.id === "qdm-images"));

  // Chrome's request/remove APIs use the same manifest pattern validation.
  // remove() validates new optional origins without requiring a native prompt.
  assert.match(await page.evaluate(async () => {
    try { await chrome.permissions.request({ origins: ["*://*.new.example/*"] }); return "unexpected success"; }
    catch (error) { return error.message; }
  }), /Only permissions specified in the manifest/);
  await page.evaluate(async () => {
    await chrome.permissions.remove({ origins: QdmRules.permissionOrigins(["new.example", "localhost", "127.0.0.1"]) });
    chrome.permissions.request = async ({ origins }) => {
      // A user denying a new site's prompt must not lose existing settings.
      window.requestedOrigins = origins;
      return false;
    };
  });
  await page.locator("#sites").fill("joyreactor.cc\nnew.example");
  await save.click();
  await page.waitForFunction(() => document.querySelector("#feedback").textContent.includes("not granted"));
  assert.ok((await page.evaluate(() => requestedOrigins)).includes("https://*.new.example/*"));
  assert.ok((await page.evaluate(() => requestedOrigins)).every(origin => !origin.startsWith("*:")));
  assert.deepEqual(await page.evaluate(() => chrome.storage.local.get("sites").then(s => s.sites)), initial.sites);
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#sites").value.includes("joyreactor.cc"));
  // Mode-only changes and clearing sites do not need any new host grant.
  await page.locator("#mode").selectOption("url");
  await save.click();
  await page.waitForFunction(() => document.querySelector("#feedback").textContent.startsWith("Saved."));
  assert.equal(await page.evaluate(() => chrome.storage.local.get("mode").then(s => s.mode)), "url");
  await page.locator("#sites").fill(""); await page.locator("#imageHosts").fill("");
  await save.click();
  await page.waitForFunction(() => document.querySelector("#feedback").textContent.startsWith("Saved."));
  assert.deepEqual(await page.evaluate(() => chrome.scripting.getRegisteredContentScripts()), []);

  const popup = await context.newPage();
  popup.on("pageerror", error => errors.push(error.message));
  await popup.setViewportSize({ width: 340, height: 440 });
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.waitForFunction(() => document.querySelector("#status").textContent === "App connected");
  const backgrounds = {
    blurple: { dark: "rgb(22, 24, 38)", light: "rgb(238, 240, 247)" },
    teal: { dark: "rgb(12, 22, 25)", light: "rgb(233, 243, 244)" },
    blue: { dark: "rgb(28, 28, 30)", light: "rgb(242, 242, 247)" },
    grey: { dark: "rgb(20, 20, 20)", light: "rgb(237, 237, 237)" }
  };
  if (process.env.QDM_CAPTURE_DIR) await mkdir(process.env.QDM_CAPTURE_DIR, { recursive: true });
  for (const [palette, schemes] of Object.entries(backgrounds)) {
    for (const [colorScheme, background] of Object.entries(schemes)) {
      await worker.evaluate(appearance => { appAppearance = appearance; }, { palette, colorScheme });
      await popup.getByRole("button", { name: "Check connection" }).click();
      for (const target of [page, popup]) {
        await target.waitForFunction(({ palette, colorScheme }) => document.documentElement.dataset.palette === palette
          && document.documentElement.dataset.scheme === colorScheme, { palette, colorScheme });
        assert.equal(await target.evaluate(() => getComputedStyle(document.body).backgroundColor), background);
      }
      if (process.env.QDM_CAPTURE_DIR && palette === "teal") {
        await page.screenshot({ path: `${process.env.QDM_CAPTURE_DIR}/options-${colorScheme}.png`, fullPage: true });
        await popup.screenshot({ path: `${process.env.QDM_CAPTURE_DIR}/popup-${colorScheme}.png` });
      }
    }
  }
  // Polling picks up an app change without clicking Connect or reopening pages.
  await worker.evaluate(() => { appAppearance = { palette: "blue", colorScheme: "system" }; });
  await popup.emulateMedia({ colorScheme: "light" });
  await popup.waitForFunction(() => document.documentElement.dataset.palette === "blue" && document.documentElement.dataset.scheme === "light");
  await popup.emulateMedia({ colorScheme: "dark" });
  await popup.waitForFunction(() => document.documentElement.dataset.scheme === "dark");
  await worker.evaluate(() => { appOnline = false; });
  await popup.reload();
  await popup.waitForFunction(() => document.querySelector("#status").textContent === "App unavailable");
  assert.equal(await popup.getAttribute("html", "data-palette"), "blue");
  await popup.emulateMedia({ colorScheme: "light" });
  await popup.waitForFunction(() => document.documentElement.dataset.scheme === "light");
  // An older app's hello remains compatible and preserves the cached theme.
  await worker.evaluate(() => { appOnline = true; appAppearance = undefined; });
  await popup.getByRole("button", { name: "Connect", exact: true }).click();
  await popup.waitForFunction(() => document.querySelector("#status").textContent === "App connected");
  assert.equal(await popup.getAttribute("html", "data-palette"), "blue");
  assert.deepEqual(errors, []);
  console.log("PASS: real extension saves, Chrome permission pattern validation, denied grants preserve settings, eight themes, live sync, system/offline/older-app fallback");
} finally { await context.close(); }
