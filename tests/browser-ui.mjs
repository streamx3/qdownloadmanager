// Real Chromium DOM/CSS test, with a controlled Native Messaging boundary.
// npm install --no-save playwright, or set QDM_PLAYWRIGHT_MODULE to its index.mjs.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { chromium } = await import(process.env.QDM_PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ executablePath: process.env.QDM_CHROME, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://joyreactor.cc/**", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><body style="padding:60px"><img id="art" width="300" height="200" src="https://joyreactor.cc/test.svg"><img width="40" height="40" src="https://joyreactor.cc/test.svg"></body>' }));
  await page.route("**/test.svg*", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#645b88"/></svg>' }));
  await page.goto("https://joyreactor.cc/post/test");
  await page.evaluate(() => {
    // Open only this test's shadow root so assertions can inspect actual buttons.
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (options) { return attach.call(this, { ...options, mode: "open" }); };
    window.fileState = { exists: false, busy: false, policy: "skip" };
    window.calls = [];
    window.chrome = {
      runtime: { async sendMessage(message) {
        calls.push(message);
        if (message.type === "filesStatus") return { ok: true, files: message.urls.map(url => ({ url, ...fileState })) };
        return new Promise(resolve => { window.completeDownload = () => { fileState.exists = true; resolve({ ok: true, state: "completed", name: "test.svg" }); }; });
      } },
      storage: { local: { async get(defaults) { return defaults; } }, onChanged: { addListener() {} } }
    };
  });
  await page.addScriptTag({ content: await readFile(new URL("../extension/rules.js", import.meta.url), "utf8") });
  await page.addScriptTag({ content: await readFile(new URL("../extension/content.js", import.meta.url), "utf8") });
  const button = page.locator("#qdm-image-buttons button:not([hidden])");
  await button.waitFor();
  assert.equal(await button.count(), 1, "small avatar must be ignored");
  const opacity = () => button.evaluate(node => getComputedStyle(node).opacity);
  assert.equal(await opacity(), "0");
  await page.locator("#art").hover();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#qdm-image-buttons').shadowRoot.querySelector('button')).opacity === "1");
  assert.equal(await button.getAttribute("data-state"), "idle");
  await button.click();
  assert.equal(await button.getAttribute("data-state"), "busy");
  assert.equal(await button.locator(".spinner").count(), 1);
  await page.evaluate(() => completeDownload());
  await page.waitForFunction(() => document.querySelector('#qdm-image-buttons').shadowRoot.querySelector('button').dataset.state === "exists");
  // Checkmark survives the old four-second reset, then follows changes on disk.
  await page.waitForTimeout(4200);
  assert.equal(await button.getAttribute("data-state"), "exists");
  await page.evaluate(() => { fileState.exists = false; });
  await page.waitForFunction(() => document.querySelector('#qdm-image-buttons').shadowRoot.querySelector('button').dataset.state === "idle");
  await page.mouse.move(10, 10);
  await page.waitForTimeout(180);
  assert.equal(await opacity(), "0");
  await page.keyboard.press("Tab"); // Leave the button focused by the earlier click.
  await page.keyboard.press("Shift+Tab");
  await page.waitForTimeout(180);
  assert.equal(await opacity(), "1", "keyboard focus must reveal the button");
  // Lazy replacement keeps one button and queries the new original URL.
  await page.evaluate(() => document.querySelector('#art').src = "https://joyreactor.cc/test.svg?new");
  await page.waitForFunction(() => calls.some(call => call.urls?.includes("https://joyreactor.cc/test.svg?new")));
  assert.deepEqual(errors, []);
  if (process.env.QDM_SCREENSHOT) await page.screenshot({ path: process.env.QDM_SCREENSHOT });
  console.log("PASS: hover transparency, keyboard focus, spinner, persistent checkmark, disk refresh, lazy-image replacement");
} finally { await browser.close(); }
