// Reddit-shaped DOM fixtures in real Chromium; no login or API is required.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { chromium } = await import(process.env.QDM_PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ executablePath: process.env.QDM_CHROME, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const hover = async selector => {
    const rect = await page.locator(selector).boundingBox();
    assert.ok(rect);
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  };
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    if (route.request().resourceType() === "image") return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#645b88"/></svg>' });
    return route.fulfill({ contentType: "text/html", body: '<!doctype html><body style="margin:50px"><shreddit-post id="post"></shreddit-post><div id="late"></div></body>' });
  });
  await page.goto("https://www.reddit.com/r/test/comments/example/gallery/");
  await page.evaluate(() => {
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (options) { return attach.call(this, { ...options, mode: "open" }); };
    window.calls = [];
    window.saved = new Set();
    window.chrome = {
      runtime: { async sendMessage(message) {
        calls.push(message);
        if (message.type === "filesStatus") return { ok: true, files: message.urls.map(url => ({ url, exists: saved.has(url), busy: false, policy: "skip" })) };
        saved.add(message.url);
        return { ok: true, state: "completed", name: message.url.split('/').pop() };
      } },
      storage: { local: { async get(defaults) { return defaults; } }, onChanged: { addListener() {} } }
    };
    const shadow = document.querySelector('#post').attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>:host { display:block } img {width:300px;height:200px;pointer-events:none}</style>
      <a href="/gallery/example"><img id="slide" src="https://preview.redd.it/title-v0-abcdefghijkl.png?width=300&s=signature"></a>
      <img style="display:none" src="https://preview.redd.it/mnopqrstuvwx.jpg?width=300&s=signature">`;
  });
  for (const script of ["rules.js", "content.js"]) await page.addScriptTag({ content: await readFile(new URL(`../extension/${script}`, import.meta.url), "utf8") });
  const buttons = page.locator('#qdm-image-buttons button:not([hidden])');
  await buttons.first().waitFor();
  assert.equal(await buttons.count(), 1, 'only the visible gallery slide gets a button');
  await hover('#slide');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#qdm-image-buttons').shadowRoot.querySelector('button:not([hidden])')).opacity === '1');
  await buttons.first().click();
  assert.equal(await page.evaluate(() => calls.find(call => call.type === 'download').url), 'https://i.redd.it/abcdefghijkl.png');
  await page.waitForFunction(() => document.querySelector('#qdm-image-buttons').shadowRoot.querySelector('button:not([hidden])').dataset.state === 'exists');
  // Recycled slides must replace both the download target and existence state.
  await page.locator('#slide').evaluate(img => { img.src = 'https://preview.redd.it/mnopqrstuvwx.jpg?width=300&s=signature'; });
  await page.waitForFunction(() => calls.some(call => call.urls?.includes('https://i.redd.it/mnopqrstuvwx.jpg')));
  assert.equal(await buttons.first().getAttribute('data-state'), 'idle');
  await hover('#slide');
  await buttons.first().click();
  assert.equal(await page.evaluate(() => calls.filter(call => call.type === 'download').at(-1).url), 'https://i.redd.it/mnopqrstuvwx.jpg');
  // Attach a root later without a document child-list mutation.
  await page.evaluate(() => {
    document.querySelector('#late').attachShadow({ mode: 'open' }).innerHTML = '<img id="late-image" width="300" height="200" src="https://i.redd.it/zzzzzzzzzzzz.png">';
  });
  await page.waitForFunction(() => document.querySelector('#qdm-image-buttons').shadowRoot.querySelectorAll('button:not([hidden])').length === 2);
  await page.evaluate(() => document.querySelector('#late').remove());
  await page.waitForFunction(() => document.querySelector('#qdm-image-buttons').shadowRoot.querySelectorAll('button:not([hidden])').length === 1);
  // Reddit's media viewer wraps a URL, not an original image path.
  await page.evaluate(() => {
    document.querySelector('#post').remove();
    const a = document.createElement('a');
    a.href = '/media?url=' + encodeURIComponent('https://preview.redd.it/some-title-v0-111111111111.png?width=1080&s=signature');
    a.innerHTML = '<img id="viewer" width="300" height="200" src="https://preview.redd.it/111111111111.png?width=300&s=signature">';
    document.body.append(a);
  });
  await page.waitForFunction(() => calls.some(call => call.urls?.includes('https://i.redd.it/111111111111.png')));
  await page.locator('#viewer').hover(); await buttons.first().click();
  assert.equal(await page.evaluate(() => calls.filter(call => call.type === 'download').at(-1).url), 'https://i.redd.it/111111111111.png');
  // Old Reddit: post metadata supplies the original behind its thumbnail.
  await page.evaluate(() => {
    document.querySelector('#viewer').parentElement.remove();
    const post = document.createElement('div'); post.className = 'thing';
    post.dataset.url = 'https://i.redd.it/222222222222.jpg';
    post.innerHTML = '<a href="/r/pics/comments/old/title"><img id="legacy" width="150" height="100" src="https://b.thumbs.redditmedia.com/thumbnail.jpg"></a>';
    document.body.append(post);
  });
  await page.waitForFunction(() => calls.some(call => call.urls?.includes('https://i.redd.it/222222222222.jpg')));
  await page.locator('#legacy').hover(); await buttons.first().click();
  assert.equal(await page.evaluate(() => calls.filter(call => call.type === 'download').at(-1).url), 'https://i.redd.it/222222222222.jpg');
  assert.deepEqual(errors, []);
  console.log('PASS: Reddit shadow DOM, hover hit-testing, gallery slides, original URLs, checkmarks, late roots, cleanup, media viewer, legacy thumbnails');
} finally { await browser.close(); }
