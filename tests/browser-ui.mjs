// Real Chromium DOM/CSS test, with a controlled Native Messaging boundary.
// npm install --no-save playwright, or set QDM_PLAYWRIGHT_MODULE to its index.mjs.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { themeColors } from "../extension/theme.js";
const appearance = (palette, colorScheme) => ({ palette, colorScheme, resolvedScheme: colorScheme,
  colors: themeColors({ palette, colorScheme }).colors });
const { chromium } = await import(process.env.QDM_PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ executablePath: process.env.QDM_CHROME, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://reddit.com/**", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><body style="padding:60px"><img id="art" width="300" height="200" src="https://reddit.com/test.svg"><img width="40" height="40" src="https://reddit.com/test.svg"></body>' }));
  await page.route("**/test.svg*", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#645b88"/></svg>' }));
  await page.goto("https://reddit.com/post/test");
  await page.evaluate(initialAppearance => {
    // Open only this test's shadow root so assertions can inspect actual buttons.
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (options) { return attach.call(this, { ...options, mode: "open" }); };
    window.fileState = { exists: false, busy: false, policy: "skip" };
    window.calls = [];
    window.appearance = initialAppearance;
    const storageListeners = new Set();
    window.setAppearance = value => {
      window.appearance = value;
      for (const listener of storageListeners) listener({ appearance: { newValue: value } }, "local");
    };
    window.chrome = {
      runtime: { async sendMessage(message) {
        calls.push(message);
        if (message.type === "filesStatus") return { ok: true, files: message.urls.map(url => ({ url, ...fileState })) };
        if (window.failDownload) return { ok: false, error: "Test download failure" };
        return new Promise(resolve => { window.completeDownload = () => { fileState.exists = true; resolve({ ok: true, state: "completed", name: "test.svg" }); }; });
      } },
      storage: { local: { async get(defaults) { return { ...defaults, appearance: window.appearance }; } },
        onChanged: { addListener(fn) { storageListeners.add(fn); }, removeListener(fn) { storageListeners.delete(fn); } } }
    };
  }, appearance("teal", "dark"));
  // Old versions leave their always-visible overlay in the page after reload.
  await page.evaluate(() => {
    for (let i = 0; i < 2; i++) {
      const stale = document.createElement('div'); stale.id = 'qdm-image-buttons';
      stale.attachShadow({mode:'closed'}).innerHTML = '<button style="position:fixed;top:20px;right:20px;opacity:1">Old download button</button>';
      document.documentElement.append(stale);
    }
  });
  await page.addScriptTag({ content: await readFile(new URL("../extension/rules.js", import.meta.url), "utf8") });
  await page.addScriptTag({ content: await readFile(new URL("../extension/appearance-data.js", import.meta.url), "utf8") });
  await page.addScriptTag({ content: await readFile(new URL("../extension/content.js", import.meta.url), "utf8") });
  const button = page.locator("#qdm-image-buttons button:not([hidden])");
  await button.waitFor();
  assert.equal(await button.count(), 1, "small avatar must be ignored");
  assert.equal(await page.locator('#qdm-image-buttons').count(), 1, "reload removes stale overlays");
  const opacity = () => button.evaluate(node => getComputedStyle(node).opacity);
  assert.equal(await opacity(), "0");
  await page.locator("#art").hover();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#qdm-image-buttons').shadowRoot.querySelector('button')).opacity === "1");
  assert.equal(await button.getAttribute("data-state"), "idle");
  assert.equal(await button.evaluate(node => getComputedStyle(node).backgroundColor), "rgb(12, 22, 25)");
  await button.click();
  assert.equal(await button.getAttribute("data-state"), "busy");
  assert.equal(await button.locator(".spinner").count(), 1);
  await page.evaluate(value => setAppearance(value), appearance("blue", "light"));
  assert.equal(await button.getAttribute("data-state"), "busy", "theme changes must not reset transfer state");
  assert.equal(await button.evaluate(node => getComputedStyle(node).color), "rgb(0, 102, 214)");
  await page.evaluate(() => completeDownload());
  await page.waitForFunction(() => document.querySelector('#qdm-image-buttons').shadowRoot.querySelector('button').dataset.state === "exists");
  assert.equal(await button.evaluate(node => getComputedStyle(node).color), "rgb(0, 102, 214)");
  assert.equal(await page.locator("#qdm-image-buttons .notice").evaluate(node => getComputedStyle(node).backgroundColor), "rgb(255, 255, 255)");
  await page.evaluate(value => setAppearance(value), appearance("teal", "dark"));
  assert.equal(await button.getAttribute("data-state"), "exists");
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
  await page.evaluate(() => document.querySelector('#art').src = "https://reddit.com/test.svg?new");
  await page.waitForFunction(() => calls.some(call => call.urls?.includes("https://reddit.com/test.svg?new")));
  // A second large image must stay transparent while the first is hovered.
  await page.evaluate(() => {
    const second = document.createElement('img'); second.id = 'second'; second.width = 300; second.height = 200;
    second.src = 'https://reddit.com/test.svg?second'; second.style.display = 'block'; document.body.append(second);
  });
  await page.waitForFunction(() => document.querySelector('#qdm-image-buttons').shadowRoot.querySelectorAll('button:not([hidden])').length === 2);
  await page.locator('#art').hover();
  await page.waitForTimeout(180);
  const states = () => page.evaluate(() => [...document.querySelector('#qdm-image-buttons').shadowRoot.querySelectorAll('button:not([hidden])')].map(button => getComputedStyle(button).opacity));
  // Remove keyboard focus from the previous assertion before checking mouse-only behavior.
  await page.mouse.click(10, 10); await page.locator('#art').hover(); await page.waitForTimeout(180);
  assert.deepEqual(await states(), ['1', '0']);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(180);
  assert.deepEqual(await states(), ['0', '0'], 'leaving Chrome must clear hover visibility');
  await page.mouse.move(10, 10); await page.waitForTimeout(180);
  assert.deepEqual(await states(), ['0', '0']);
  // Re-injection in the same context cleans up listeners and creates only one overlay.
  await page.evaluate(() => { window.__qdmVersion = 'old'; });
  await page.addScriptTag({ content: await readFile(new URL("../extension/appearance-data.js", import.meta.url), "utf8") });
  await page.addScriptTag({ content: await readFile(new URL("../extension/content.js", import.meta.url), "utf8") });
  await page.waitForFunction(() => document.querySelector('#qdm-image-buttons').shadowRoot.querySelectorAll('button:not([hidden])').length === 2);
  assert.equal(await page.locator('#qdm-image-buttons').count(), 1);
  assert.deepEqual(await states(), ['0', '0']);
  const first = button.first();
  assert.equal(await first.evaluate(node => getComputedStyle(node).color), "rgb(166, 240, 236)", "cached theme survives reinjection");
  await page.evaluate(() => { window.failDownload = true; });
  await page.locator("#art").hover(); await first.click();
  await page.waitForFunction(() => document.querySelector('#qdm-image-buttons').shadowRoot.querySelector('button').dataset.state === "error");
  assert.equal(await first.evaluate(node => getComputedStyle(node).color), "rgb(227, 114, 114)");
  assert.deepEqual(errors, []);
  if (process.env.QDM_SCREENSHOT) await page.screenshot({ path: process.env.QDM_SCREENSHOT });
  console.log("PASS: hover transparency, overlay cleanup, keyboard focus, themed spinner/checkmark/error/notices, live changes during downloads, cached theme on reinjection, lazy images");
} finally { await browser.close(); }
