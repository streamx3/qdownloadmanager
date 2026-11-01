// An extension-worker fetch does not inherit the tab's referrer. JoyReactor
// serves different image bytes without it, even for a public image URL.
const FIRST_RULE_ID = 1000000;
const LAST_RULE_ID = 1999999;

export function imageReferrer(imageUrl, pageUrl) {
  const image = new URL(imageUrl);
  const page = new URL(pageUrl);
  if (!["http:", "https:"].includes(image.protocol) || !["http:", "https:"].includes(page.protocol)
      || image.username || image.password || page.username || page.password)
    throw new Error("A download needs an HTTP or HTTPS image and source page.");
  // Follow strict-origin-when-cross-origin: never send a page's path/query to a
  // different origin, or send a secure-page referrer over plain HTTP.
  if (page.protocol === "https:" && image.protocol === "http:") return "";
  page.hash = "";
  return image.origin === page.origin ? page.href : `${page.origin}/`;
}

export function referrerRule(id, imageUrl, pageUrl, extensionId) {
  const url = new URL(imageUrl);
  url.hash = "";
  const referrer = imageReferrer(url.href, pageUrl);
  const escaped = url.href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {
    id,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [referrer
        ? { header: "referer", operation: "set", value: referrer }
        : { header: "referer", operation: "remove" }]
    },
    condition: {
      regexFilter: `^${escaped}$`,
      isUrlFilterCaseSensitive: true,
      initiatorDomains: [extensionId],
      tabIds: [-1],
      requestMethods: ["get"],
      resourceTypes: ["xmlhttprequest"]
    }
  };
}

export class ImageFetcher {
  constructor(netRequest, extensionId, fetchResource = globalThis.fetch.bind(globalThis)) {
    this.netRequest = netRequest;
    this.extensionId = extensionId;
    // Calling a stored native fetch as this.fetchResource() otherwise supplies
    // ImageFetcher as its receiver, which Chrome rejects as Illegal invocation.
    this.fetchResource = fetchResource;
    this.nextId = FIRST_RULE_ID;
    this.locks = new Map();
    this.initializing = null;
  }

  initialize() {
    if (!this.initializing) {
      this.initializing = (async () => {
        // Session rules survive a service-worker restart. Clear only our reserved
        // range; any old fetch died with the previous worker.
        const stale = (await this.netRequest.getSessionRules()).filter(rule => rule.id >= FIRST_RULE_ID && rule.id <= LAST_RULE_ID);
        if (stale.length) await this.netRequest.updateSessionRules({ removeRuleIds: stale.map(rule => rule.id) });
      })().catch(error => { this.initializing = null; throw error; });
    }
    return this.initializing;
  }

  async fetch(imageUrl, pageUrl, options = {}) {
    if (!this.netRequest) throw new Error("Reload the updated Download Helper extension to enable image referrers.");
    await this.initialize();
    const url = new URL(imageUrl);
    url.hash = "";
    const key = url.href;
    // Worker requests have no tab ID. Two tabs downloading the identical URL
    // must not compete over its header rule. Unlock once headers arrive; bodies
    // can then stream concurrently with no active rule.
    const previous = this.locks.get(key) || Promise.resolve();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    this.locks.set(key, gate);
    await previous;
    let installed = false;
    const id = this.nextId++;
    try {
      options.signal?.throwIfAborted();
      if (id > LAST_RULE_ID) throw new Error("Reload the extension before starting another image transfer.");
      const rule = referrerRule(id, key, pageUrl, this.extensionId);
      const supported = await this.netRequest.isRegexSupported({ regex: rule.condition.regexFilter, isCaseSensitive: true });
      if (!supported.isSupported) throw new Error("This image URL is too complex to apply its source-page referrer safely.");
      await this.netRequest.updateSessionRules({ addRules: [rule] });
      installed = true;
      return await this.fetchResource(key, {
        ...options, method: "GET", credentials: "include", redirect: "error",
        // JoyReactor's observed response did not include Vary: Referer. A cached
        // image from an earlier context may therefore contain the wrong variant.
        cache: "no-store"
      });
    } finally {
      try {
        if (installed) await this.netRequest.updateSessionRules({ removeRuleIds: [id] });
      } finally {
        release();
        if (this.locks.get(key) === gate) this.locks.delete(key);
      }
    }
  }
}
