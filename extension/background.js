import "./rules.js";
import { NativeClient } from "./native-client.js";
import { ImageFetcher } from "./image-fetch.js";

const rules = globalThis.QdmRules;
const identity = fetch(chrome.runtime.getURL("identity.json")).then(response => response.json());
let native;
const inFlight = new Set();
const imageFetcher = new ImageFetcher(chrome.declarativeNetRequest, chrome.runtime.id);
const MAX_CHUNK = 192 * 1024;
const MAX_FILE = 2 * 1024 * 1024 * 1024;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function client() {
  const registered = await identity;
  if (!native) native = new NativeClient(chrome.runtime, registered.host);
  return native;
}
async function config() { return chrome.storage.local.get(rules.DEFAULTS); }
async function status() {
  try {
    const response = await (await client()).request("hello");
    return { online: true, ...response };
  } catch (error) { return { online: false, error: error.message }; }
}
async function syncSites() {
  const settings = await config();
  const existing = await chrome.scripting.getRegisteredContentScripts();
  if (existing.some(script => script.id === "qdm-images")) await chrome.scripting.unregisterContentScripts({ ids: ["qdm-images"] });
  if (!settings.sites.length) return;
  const matches = rules.patterns(settings.sites);
  await chrome.scripting.registerContentScripts([{
    id: "qdm-images", matches, js: ["rules.js", "content.js"], runAt: "document_idle", persistAcrossSessions: true
  }]);
  // Apply newly enabled websites to tabs that are already open.
  const tabs = await chrome.tabs.query({ url: matches });
  await Promise.allSettled(tabs.filter(tab => tab.id).map(tab => chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["rules.js", "content.js"] })));
}
let syncChain = Promise.resolve();
function scheduleSync() {
  syncChain = syncChain.catch(() => {}).then(syncSites);
  return syncChain;
}
chrome.runtime.onInstalled.addListener(() => { scheduleSync().catch(console.error); chrome.alarms.create("qdm-reconnect", { periodInMinutes: 1 }); });
chrome.runtime.onStartup.addListener(() => { scheduleSync().catch(console.error); status(); });
chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes.sites) scheduleSync().catch(console.error); });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === "qdm-reconnect") status(); });
// A live native port keeps the service worker available. Refresh app presence even
// when its user-launched UI starts after Chrome, or is closed and reopened.
setInterval(() => { if (native?.port) status(); }, 20000);

function base64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

class SkippedDownload extends Error {
  constructor(name) { super("Already exists"); this.nameOnDisk = name; }
}

function validateSource(sender, settings) {
  if (!sender.tab || sender.frameId !== 0 || !rules.allowed(sender.url, settings.sites))
    throw new Error("Downloads are not enabled on this website.");
}
function validateImage(url, settings) {
  if (typeof url !== "string" || url.length > 16384 || !rules.allowed(url, [...settings.sites, ...settings.imageHosts]))
    throw new Error("This image is hosted on another domain. Add its domain under Image hosts in the extension settings.");
}
async function filesStatus(message, sender) {
  const settings = await config();
  validateSource(sender, settings);
  if (!Array.isArray(message.urls) || message.urls.length > 64) throw new Error("Check at most 64 images at a time.");
  for (const url of message.urls) validateImage(url, settings);
  const result = await (await client()).request("filesStatus", { names: message.urls.map(rules.filename) });
  return { ok: true, files: result.files.map((file, index) => ({ ...file, url: message.urls[index] })) };
}

async function waitUntilReady(connection, jobId, signal) {
  while (true) {
    signal.throwIfAborted();
    const result = await connection.request("jobStatus", { jobId });
    if (result.state === "receiving") return;
    if (result.state === "skipped") throw new SkippedDownload(result.name);
    if (!["queued", "paused"].includes(result.state)) throw new Error(result.message || "The download was cancelled in the desktop app.");
    await wait(400);
  }
}

async function download(message, sender) {
  const settings = await config();
  validateSource(sender, settings);
  validateImage(message.url, settings);
  const key = `${sender.tab.id}:${message.url}`;
  if (inFlight.has(key)) return { ok: true, state: "in_progress" };
  inFlight.add(key);
  let connection, jobId, reader;
  const abort = new AbortController();
  let networkTimer;
  function resetNetworkTimer() { clearTimeout(networkTimer); networkTimer = setTimeout(() => abort.abort(new Error("The image server took too long to respond.")), 60000); }
  try {
    connection = await client();
    const hello = await connection.request("hello");
    if (!hello.setupComplete) throw new Error("Finish setup in the desktop app first.");
    if (!hello.accepting) throw new Error("New downloads are paused in the desktop app.");
    const name = rules.filename(message.url);
    if (settings.mode === "url") {
      return await connection.request("enqueue", { url: message.url, name });
    }
    // Queue before opening a network response, so waiting jobs do not hold idle
    // HTTP streams. The native app applies its shared concurrency limit.
    const created = await connection.request("begin", { url: message.url, name, total: -1 });
    if (["skipped", "in_progress"].includes(created.state)) return created;
    jobId = created.jobId;
    await waitUntilReady(connection, jobId, abort.signal);
    resetNetworkTimer();
    // sender.url is supplied by Chrome, not by a page-supplied message field.
    const response = await imageFetcher.fetch(message.url, sender.url, { signal: abort.signal });
    clearTimeout(networkTimer);
    if (!response.ok) throw new Error(`Image server returned HTTP ${response.status}.`);
    const mime = response.headers.get("content-type")?.split(";")[0].toLowerCase() || "";
    if (mime && !mime.startsWith("image/") && mime !== "application/octet-stream")
      throw new Error("The server returned a page instead of an image. Open the original image or sign in and try again.");
    if (!response.body) throw new Error("Chrome could not read this image.");
    const length = response.headers.get("content-length");
    const total = length !== null && !response.headers.has("content-encoding") && /^\d+$/.test(length) ? Number(length) : -1;
    const metadata = await connection.request("metadata", { jobId, mime, total });
    if (metadata.state === "skipped") throw new SkippedDownload(metadata.name);
    reader = response.body.getReader();
    let offset = 0;
    while (true) {
      await waitUntilReady(connection, jobId, abort.signal);
      resetNetworkTimer();
      const { done, value } = await reader.read();
      clearTimeout(networkTimer);
      if (done) break;
      for (let at = 0; at < value.length; at += MAX_CHUNK) {
        const chunk = value.subarray(at, at + MAX_CHUNK);
        if (offset + chunk.length > MAX_FILE) throw new Error("This image exceeds the 2 GB transfer limit.");
        const data = base64(chunk);
        while (true) {
          const reply = await connection.request("chunk", { jobId, offset, data });
          if (reply.accepted) break;
          await waitUntilReady(connection, jobId, abort.signal);
        }
        offset += chunk.length;
      }
    }
    await waitUntilReady(connection, jobId, abort.signal);
    const result = await connection.request("finish", { jobId, size: offset });
    return { ok: true, state: result.state, name: result.name };
  } catch (error) {
    if (error instanceof SkippedDownload) return { ok: true, state: "skipped", name: error.nameOnDisk };
    if (jobId && connection) await connection.request("abort", { jobId, message: error.message }).catch(() => {});
    throw error;
  } finally {
    clearTimeout(networkTimer);
    abort.abort();
    await reader?.cancel().catch(() => {});
    inFlight.delete(key);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return false;
  let task;
  if (message.type === "download") task = download(message, sender);
  else if (message.type === "filesStatus") task = filesStatus(message, sender);
  else {
    // Configuration and status controls are only available to extension pages.
    if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(""))) return false;
    if (message.type === "status") task = status();
    else if (message.type === "syncSites") task = scheduleSync().then(() => ({ ok: true }));
    else return false;
  }
  task.then(sendResponse, error => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});
