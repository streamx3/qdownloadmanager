import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../extension/rules.js";
import { migrateSettings } from "../extension/settings.js";
const rules = globalThis.QdmRules;
const post = "https://www.reddit.com/r/pics/comments/example/title/";
const image = (source, href, dataUrl) => ({
  currentSrc: source, getAttribute: () => source,
  closest(selector) {
    if (selector === "a[href]") return href ? { getAttribute: () => href } : null;
    return dataUrl ? { getAttribute: attribute => attribute === "data-url" ? dataUrl : null } : null;
  }
});

test("Reddit sites and image hosts are enabled with matching manifest permissions", () => {
  const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url)));
  for (const site of ["www.reddit.com", "old.reddit.com", "sh.reddit.com"]) assert.ok(rules.allowed(`https://${site}/r/pics`, rules.DEFAULTS.sites));
  for (const host of ["i.redd.it", "preview.redd.it", "cf.preview.redd.it", "external-preview.redd.it"]) assert.ok(rules.allowed(`https://${host}/a.png`, rules.DEFAULTS.imageHosts));
  for (const pattern of rules.patterns([...rules.DEFAULTS.sites, ...rules.DEFAULTS.imageHosts])) assert.ok(manifest.host_permissions.includes(pattern), pattern);
  for (const host of ["reddit.com.evil.example", "notreddit.com", "i.redd.it.evil.example", "v.redd.it"]) assert.ok(!rules.allowed(`https://${host}/a.png`, [...rules.DEFAULTS.sites, ...rules.DEFAULTS.imageHosts]));
});

test("Reddit feed, gallery, and media-viewer links resolve to the same original", () => {
  const original = "https://i.redd.it/4if55th920nf1.png";
  const preview = "https://preview.redd.it/some-art-v0-4if55th920nf1.png?width=640&crop=smart&auto=webp&s=signed";
  for (const [src, href] of [[preview, null], [preview, `/media?url=${encodeURIComponent(preview)}`],
    [preview, original], [original, null], [preview, "/gallery/post123"],
    ["https://cf.preview.redd.it/4if55th920nf1.png?width=100", null]]) {
    assert.equal(rules.originalImage(image(src, href), post), original);
  }
  assert.equal(rules.originalImage(image("https://preview.redd.it/another-v0-abcdefghijkl.gif?format=mp4"), post), "https://i.redd.it/abcdefghijkl.gif");
  assert.equal(rules.originalImage(image(preview), "https://example.org/"), preview, "site-specific rewriting must stay scoped to Reddit");
});

test("external previews keep their signature and unrelated viewer parameters are ignored", () => {
  const preview = "https://external-preview.redd.it/story.jpg?auto=webp&s=signature";
  assert.equal(rules.originalImage(image(preview), post), preview);
  for (const target of ["https://evil.example/a.png", "https://i.redd.it.evil.example/a.png", "file:///etc/passwd", "https://user:password@i.redd.it/abcdefghijkl.png"]) {
    assert.equal(rules.originalImage(image(preview, `/media?url=${encodeURIComponent(target)}`), post), preview);
  }
  const unfamiliar = "https://preview.redd.it/unrecognized-resource?width=100&s=signed";
  assert.equal(rules.originalImage(image(unfamiliar), post), unfamiliar);
});

test("legacy thumbnails use the post's explicit image URL, never a guessed gallery image", () => {
  const thumbnail = "https://b.thumbs.redditmedia.com/thumbnail.jpg";
  const original = "https://i.redd.it/abcdefghijkl.jpg";
  assert.equal(rules.originalImage(image(thumbnail, "/r/pics/comments/post/title/", original), "https://old.reddit.com/"), original);
  assert.equal(rules.originalImage(image(thumbnail, null, "https://www.reddit.com/gallery/example"), post), null);
  assert.equal(rules.originalImage(image(thumbnail, null, "https://v.redd.it/example"), post), null);
});

test("settings migration resets old site lists to Reddit once and preserves subsequent edits", async () => {
  let saved = { sites: ["example.org", "example.com"], imageHosts: ["images.example.com"], mode: "url", siteDefaultsVersion: 1 };
  let writes = 0;
  const storage = { async get() { return structuredClone(saved); }, async set(values) { saved = { ...saved, ...values }; writes++; } };
  await migrateSettings(storage);
  assert.deepEqual(saved.sites, ["reddit.com"]);
  assert.equal(saved.mode, "url");
  assert.deepEqual(saved.imageHosts, rules.DEFAULTS.imageHosts);
  saved.sites = saved.sites.filter(site => site !== "reddit.com");
  await migrateSettings(storage);
  assert.equal(writes, 1);
  assert.ok(!saved.sites.includes("reddit.com"), "respect a subsequent user opt-out");
  saved = { sites: [], siteDefaultsVersion: 1 };
  await migrateSettings(storage);
  assert.deepEqual(saved.sites, [], "keep a previously disabled site list disabled");
  saved = {};
  await migrateSettings(storage);
  assert.deepEqual(saved.sites, rules.DEFAULTS.sites);
  assert.deepEqual(saved.imageHosts, rules.DEFAULTS.imageHosts);
});
