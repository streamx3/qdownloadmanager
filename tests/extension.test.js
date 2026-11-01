import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import "../extension/rules.js";
import { NativeClient } from "../extension/native-client.js";
const rules = globalThis.QdmRules;

test("stable Chrome ID matches the bridge identity", () => {
  const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url)));
  const identity = JSON.parse(readFileSync(new URL("../extension/identity.json", import.meta.url)));
  const key = Buffer.from(manifest.key, "base64");
  const id = [...createHash("sha256").update(key).digest().subarray(0, 16)].map(x => String.fromCharCode(97 + (x >> 4), 97 + (x & 15))).join("");
  assert.equal(id, identity.extensionId);
});
test("allowlist accepts only the configured domains and their subdomains", () => {
  assert.equal(rules.allowed("https://img1.joyreactor.cc/pics/post/a.jpg", rules.DEFAULTS.sites), true);
  for (const url of ["https://joyreactor.cc.evil.example/a", "https://notjoyreactor.cc/a", "file:///tmp/a", "javascript:alert(1)", "https://user:pass@joyreactor.cc/a", "http://127.0.0.1/a"])
    assert.equal(rules.allowed(url, rules.DEFAULTS.sites), false, url);
  assert.equal(rules.normalizeHost("https://JoyReactor.COM/feed"), "joyreactor.com");
  assert.throws(() => rules.normalizeHost("*.example.com"));
});
test("JoyReactor original links beat displayed thumbnails without rewriting URLs", () => {
  const img = (src, href) => ({ currentSrc: src, getAttribute: () => src, closest: () => href ? { getAttribute: () => href } : null });
  assert.equal(rules.originalImage(img("https://img0.joyreactor.com/pics/post/a.jpg", "https://img0.joyreactor.com/pics/post/full/a.gif"), "https://joyreactor.com/"), "https://img0.joyreactor.com/pics/post/full/a.gif");
  assert.equal(rules.originalImage(img("/image.jpg", "/post/123"), "https://joyreactor.cc/"), "https://joyreactor.cc/image.jpg");
  assert.equal(rules.originalImage(img("blob:https://joyreactor.cc/id"), "https://joyreactor.cc/"), null);
});
function fakeRuntime() {
  const ports = [];
  const runtime = { ports, connectNative() {
    const events = {};
    const port = { messages: [], onMessage: { addListener: fn => events.message = fn }, onDisconnect: { addListener: fn => events.disconnect = fn }, postMessage: msg => port.messages.push(msg), disconnect: () => events.disconnect(), reply: msg => events.message(msg) };
    ports.push(port); return port;
  } };
  return runtime;
}
test("native requests correlate out-of-order replies and report app errors", async () => {
  const runtime = fakeRuntime(); const client = new NativeClient(runtime, "test", 1000);
  const a = client.request("hello"), b = client.request("status");
  const port = runtime.ports[0];
  port.reply({ v: 1, id: port.messages[1].id, ok: true, answer: 2 });
  port.reply({ v: 1, id: port.messages[0].id, ok: true, answer: 1 });
  assert.equal((await a).answer, 1); assert.equal((await b).answer, 2);
  const failed = client.request("begin");
  port.reply({ v: 1, id: port.messages[2].id, ok: false, error: { code: "app_not_running", message: "Open the app" } });
  await assert.rejects(failed, { message: "Open the app", code: "app_not_running" });
});
test("disconnects reject pending transfers and the next request reconnects", async () => {
  const runtime = fakeRuntime(); const client = new NativeClient(runtime, "test", 1000);
  const pending = client.request("chunk");
  runtime.ports[0].disconnect();
  await assert.rejects(pending, /disconnected/);
  const retry = client.request("hello");
  const port = runtime.ports[1];
  // A late disconnect from the old port must not cancel the new request.
  runtime.ports[0].disconnect();
  port.reply({ v: 1, id: port.messages[0].id, ok: true });
  assert.equal((await retry).ok, true);
});
test("a stalled bridge times out and releases its port", async () => {
  const runtime = fakeRuntime(); const client = new NativeClient(runtime, "test", 10);
  await assert.rejects(client.request("hello"), /did not respond/);
  assert.equal(client.port, null); assert.equal(client.pending.size, 0);
});
