import test from "node:test";
import assert from "node:assert/strict";
import { ImageFetcher, imageReferrer, referrerRule } from "../extension/image-fetch.js";

const extensionId = "mffndkhpgldamhbcnnaofcklhemocinb";
const imageUrl = "https://img0.joyreactor.com/pics/post/full/example.jpg?size=2&name=a+b";
const pageUrl = "https://joyreactor.com/post/123?private=query#comments";

function netRequest(initial = []) {
  const rules = new Map(initial.map(rule => [rule.id, rule]));
  return {
    rules,
    async getSessionRules() { return [...rules.values()]; },
    async isRegexSupported() { return { isSupported: true }; },
    async updateSessionRules({ addRules = [], removeRuleIds = [] }) {
      for (const id of removeRuleIds) rules.delete(id);
      for (const rule of addRules) rules.set(rule.id, rule);
    }
  };
}

test("source-page referrers omit cross-origin paths, secrets, and fragments", () => {
  assert.equal(imageReferrer(imageUrl, pageUrl), "https://joyreactor.com/");
  assert.equal(imageReferrer("https://joyreactor.com/image.jpg", pageUrl), "https://joyreactor.com/post/123?private=query");
  assert.equal(imageReferrer("http://img0.joyreactor.com/image.jpg", pageUrl), "");
  assert.throws(() => imageReferrer("file:///tmp/image", pageUrl));
  assert.throws(() => imageReferrer(imageUrl, "https://user:secret@joyreactor.com/"));
});

test("a temporary header rule matches only the exact extension GET image fetch", () => {
  const rule = referrerRule(1000000, imageUrl + "#ignored", pageUrl, extensionId);
  assert.equal(rule.action.requestHeaders[0].value, "https://joyreactor.com/");
  assert.deepEqual(rule.condition.initiatorDomains, [extensionId]);
  assert.deepEqual(rule.condition.tabIds, [-1]);
  assert.deepEqual(rule.condition.resourceTypes, ["xmlhttprequest"]);
  assert.deepEqual(rule.condition.requestMethods, ["get"]);
  assert.equal(rule.condition.isUrlFilterCaseSensitive, true);
  const regex = new RegExp(rule.condition.regexFilter);
  assert.ok(regex.test(imageUrl));
  for (const other of [imageUrl + "&extra=1", imageUrl.replace("example", "Example"), imageUrl.replace("a+b", "aaab"), "https://other.example/?url=" + imageUrl])
    assert.equal(regex.test(other), false, other);
});

test("the image is fetched with its referrer, credentials, and a fresh response, then the rule is removed", async () => {
  const api = netRequest([{ id: 1000008 }, { id: 42 }]);
  const original = new Uint8Array([0, 255, 1, 128, 42]);
  const fetcher = new ImageFetcher(api, extensionId, async (url, options) => {
    assert.equal(url, imageUrl);
    assert.equal(api.rules.has(1000008), false, "stale rules must be removed");
    const rule = [...api.rules.values()].find(item => item.id >= 1000000);
    assert.equal(rule.action.requestHeaders[0].value, "https://joyreactor.com/");
    assert.equal(options.credentials, "include");
    assert.equal(options.cache, "no-store", "must not reuse the old watermarked cache variant");
    assert.equal(options.redirect, "error");
    return new Response(original);
  });
  const response = await fetcher.fetch(imageUrl, pageUrl);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), original);
  assert.deepEqual([...api.rules.keys()], [42], "leave unrelated rules untouched");
});

test("failed or cancelled fetches leave no header override behind", async () => {
  const api = netRequest();
  const fetcher = new ImageFetcher(api, extensionId, async () => { throw new Error("offline"); });
  await assert.rejects(fetcher.fetch(imageUrl, pageUrl), /offline/);
  assert.equal(api.rules.size, 0);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fetcher.fetch(imageUrl, pageUrl, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(api.rules.size, 0);
  assert.equal(fetcher.locks.size, 0);
});

test("simultaneous downloads of one URL cannot exchange the two tabs' referrers", async () => {
  const api = netRequest();
  const seen = [];
  let releaseFirst;
  const firstHeaders = new Promise(resolve => { releaseFirst = resolve; });
  let notifyFirst;
  const firstStarted = new Promise(resolve => { notifyFirst = resolve; });
  const fetcher = new ImageFetcher(api, extensionId, async () => {
    const rules = [...api.rules.values()];
    assert.equal(rules.length, 1);
    seen.push(rules[0].action.requestHeaders[0].value);
    if (seen.length === 1) { notifyFirst(); await firstHeaders; }
    return new Response("image");
  });
  const a = fetcher.fetch(imageUrl, "https://joyreactor.com/post/123");
  const b = fetcher.fetch(imageUrl, "https://joyreactor.cc/post/456");
  await firstStarted;
  assert.deepEqual(seen, ["https://joyreactor.com/"]);
  releaseFirst();
  await Promise.all([a, b]);
  assert.deepEqual(seen, ["https://joyreactor.com/", "https://joyreactor.cc/"]);
  assert.equal(api.rules.size, 0);
  assert.equal(fetcher.locks.size, 0);
});

test("unsupported URL matching fails without fetching under the wrong context", async () => {
  const api = netRequest();
  api.isRegexSupported = async () => ({ isSupported: false });
  let fetched = false;
  const fetcher = new ImageFetcher(api, extensionId, async () => { fetched = true; });
  await assert.rejects(fetcher.fetch(imageUrl, pageUrl), /too complex/);
  assert.equal(fetched, false);
  assert.equal(api.rules.size, 0);
});
