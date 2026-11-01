import test from "node:test";
import assert from "node:assert/strict";

test("the service-worker handler calls fetch with its global receiver and streams the body through Native Messaging", async () => {
  const extensionId = "mffndkhpgldamhbcnnaofcklhemocinb";
  const url = "https://img0.joyreactor.cc/pics/post/full/test.gif";
  const source = "https://joyreactor.cc/post/123";
  const body = new Uint8Array(250000).map((_, index) => index % 256);
  const activeRules = new Map();
  const sent = [];
  let handler;
  let received = 0;
  let scenario = "transfer", imageFetches = 0;
  const event = () => ({ addListener() {} });
  const priorChrome = globalThis.chrome, priorFetch = globalThis.fetch, priorInterval = globalThis.setInterval;
  globalThis.chrome = {
    runtime: {
      id: extensionId,
      getURL: path => `chrome-extension://${extensionId}/${path}`,
      onInstalled: event(), onStartup: event(),
      onMessage: { addListener(fn) { handler = fn; } },
      connectNative() {
        let receive;
        return {
          onMessage: { addListener(fn) { receive = fn; } }, onDisconnect: event(),
          postMessage(message) {
            sent.push(message);
            const response = { v: 1, id: message.id, ok: true };
            if (message.type === "hello") Object.assign(response, { setupComplete: true, accepting: true });
            if (message.type === "begin") Object.assign(response, scenario === "transfer" || scenario === "late-skip"
              ? { jobId: "test-image", state: "receiving" } : { state: scenario, name: "test.gif" });
            if (message.type === "metadata" && scenario === "late-skip") Object.assign(response, { state: "skipped", name: "test.gif" });
            if (message.type === "filesStatus") response.files = message.names.map(name => ({ name, exists: true, busy: false, policy: "skip" }));
            if (message.type === "jobStatus") response.state = "receiving";
            if (message.type === "chunk") {
              assert.equal(message.offset, received);
              received += Buffer.from(message.data, "base64").length;
              response.accepted = true;
            }
            if (message.type === "finish") { assert.equal(message.size, received); response.name = "test.gif"; response.state = "completed"; }
            queueMicrotask(() => receive(response));
          }
        };
      }
    },
    storage: { local: { async get(defaults) { return defaults; } }, onChanged: event() },
    alarms: { onAlarm: event() },
    declarativeNetRequest: {
      async getSessionRules() { return [...activeRules.values()]; },
      async isRegexSupported() { return { isSupported: true }; },
      async updateSessionRules({ addRules = [], removeRuleIds = [] }) {
        for (const rule of addRules) activeRules.set(rule.id, rule);
        for (const id of removeRuleIds) activeRules.delete(id);
      }
    }
  };
  globalThis.fetch = async function (target, options) {
    if (target.endsWith("/identity.json")) return Response.json({ host: "cc.qdownloadmanager.bridge" });
    // Unlike an arrow-function mock, this reproduces the browser's receiver
    // check when a native worker function is stored on another object.
    if (this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'WorkerGlobalScope': Illegal invocation");
    imageFetches++;
    assert.equal(target, url);
    assert.equal(options.cache, "no-store");
    assert.equal(options.credentials, "include");
    const rule = [...activeRules.values()][0];
    assert.equal(rule.action.requestHeaders[0].value, "https://joyreactor.cc/");
    return new Response(body, { headers: { "content-type": "image/gif", "content-length": String(body.length) } });
  };
  globalThis.setInterval = () => 0;
  try {
    await import("../extension/background.js");
    const result = await new Promise(resolve => {
      assert.equal(handler({ type: "download", url, pageUrl: "https://untrusted.example/" },
        { id: extensionId, tab: { id: 12 }, frameId: 0, url: source }, resolve), true);
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(!sent.some(message => message.type === "enqueue"), "browser mode must not ask the app to re-download the URL");
    const chunks = sent.filter(message => message.type === "chunk");
    assert.ok(chunks.length > 1);
    assert.deepEqual(Buffer.concat(chunks.map(message => Buffer.from(message.data, "base64"))), Buffer.from(body));
    assert.equal(sent.find(message => message.type === "metadata").total, body.length);
    assert.equal(activeRules.size, 0);
    const sender = { id: extensionId, tab: { id: 12 }, frameId: 0, url: source };
    const send = (message, from = sender) => new Promise(resolve => handler(message, from, resolve));
    for (scenario of ["skipped", "in_progress"]) {
      const before = sent.length;
      const result = await send({ type: "download", url });
      assert.equal(result.state, scenario);
      assert.equal(imageFetches, 1, "skip/busy must avoid fetching image bytes");
      assert.ok(!sent.slice(before).some(message => ["chunk", "metadata", "finish", "abort"].includes(message.type)));
    }
    scenario = "late-skip";
    const before = sent.length;
    assert.equal((await send({ type: "download", url })).state, "skipped");
    assert.ok(!sent.slice(before).some(message => ["chunk", "finish", "abort"].includes(message.type)));
    const files = await send({ type: "filesStatus", urls: [url] });
    assert.deepEqual(files.files, [{ url, name: "test.gif", exists: true, busy: false, policy: "skip" }]);
    const beforeInvalid = sent.length;
    assert.equal((await send({ type: "filesStatus", urls: ["https://untrusted.example/x"] })).ok, false);
    assert.equal((await send({ type: "filesStatus", urls: [url] }, { ...sender, frameId: 1 })).ok, false);
    assert.equal((await send({ type: "filesStatus", urls: Array(65).fill(url) })).ok, false);
    assert.equal(sent.length, beforeInvalid, "untrusted status requests must not reach the native app");
  } finally {
    globalThis.chrome = priorChrome;
    globalThis.fetch = priorFetch;
    globalThis.setInterval = priorInterval;
  }
});
