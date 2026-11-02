/* Shared by content scripts, the service worker, options, and tests. */
(() => {
  const DEFAULTS = Object.freeze({ sites: ["reddit.com"], imageHosts: ["i.redd.it", "preview.redd.it", "external-preview.redd.it"], mode: "browser" });
  function normalizeHost(value) {
    const raw = String(value).trim();
    if (!raw || raw.includes("*") || /\s/.test(raw)) throw new Error("Enter a domain such as reddit.com, without wildcards.");
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname || url.hostname.includes(":"))
      throw new Error("Use an HTTP or HTTPS website domain.");
    return url.hostname.toLowerCase().replace(/\.$/, "");
  }
  function matchesHost(host, domain) { return host === domain || host.endsWith(`.${domain}`); }
  function allowed(url, domains) {
    try {
      const parsed = new URL(url);
      return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password
        && domains.some(domain => matchesHost(parsed.hostname.toLowerCase(), domain));
    } catch { return false; }
  }
  function patterns(domains) {
    return domains.map(domain => `*://${domain === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(domain) ? domain : `*.${domain}`}/*`);
  }
  function permissionOrigins(domains) {
    // Each requested pattern must fit one manifest declaration. Chrome does not
    // combine separate http://*/* and https://*/* grants to cover *://new-host/*.
    return [...new Set(patterns(domains).flatMap(pattern => ["http", "https"].map(scheme => pattern.replace("*:", `${scheme}:`))))];
  }
  function httpUrl(value, base) {
    try {
      const url = new URL(value, base);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url : null;
    } catch { return null; }
  }
  function imageLink(url) {
    return url && (/\.(?:jpe?g|png|gif|webp|avif|bmp|svg)$/i.test(url.pathname));
  }
  function redditMedia(url) {
    if (url && matchesHost(url.hostname, "reddit.com") && /^\/media\/?$/.test(url.pathname)) {
      const inner = httpUrl(url.searchParams.get("url"));
      // The viewer's parameter is not permission to fetch an arbitrary host.
      if (inner && ["i.redd.it", "preview.redd.it", "external-preview.redd.it"].some(host => matchesHost(inner.hostname, host))) return inner;
      return null;
    }
    return url;
  }
  function redditOriginal(url) {
    if (!url || !["i.redd.it", "preview.redd.it", "cf.preview.redd.it"].includes(url.hostname)) return url;
    // Reddit adds a descriptive slug to previews. The media ID is also the
    // original filename, making feed/gallery/viewer duplicate checks agree.
    const match = url.pathname.match(/^\/(?:[^/]+-v\d+-)?([a-z0-9]{8,20})\.(jpe?g|png|gif|webp)$/i);
    if (!match) return url;
    return new URL(`https://i.redd.it/${match[1]}.${match[2]}`);
  }
  function composedClosest(element, selector) {
    for (let current = element; current; current = current.getRootNode?.().host) {
      const found = current.closest(selector);
      if (found) return found;
    }
    return null;
  }
  function originalImage(image, pageUrl) {
    const source = image.currentSrc || image.getAttribute("src") || image.getAttribute("data-src");
    if (!source) return null;
    let url = httpUrl(source, pageUrl);
    if (!url) return null;
    const redditPage = allowed(pageUrl, ["reddit.com"]);
    const link = composedClosest(image, "a[href]");
    if (link) {
      let href = httpUrl(link.getAttribute("href"), pageUrl);
      if (redditPage) href = redditMedia(href);
      if (imageLink(href)) url = href;
    }
    if (redditPage) {
      // Legacy feed thumbnails link to the post; the post's data-url identifies
      // its actual image. Do not apply this to gallery slides or comment images.
      if (matchesHost(url.hostname, "thumbs.redditmedia.com")) {
        const post = composedClosest(image, ".thing[data-url], shreddit-post[content-href]");
        const target = post && redditMedia(httpUrl(post.getAttribute("data-url") || post.getAttribute("content-href"), pageUrl));
        if (imageLink(target)) url = target;
        else return null; // Never silently save a tiny/video thumbnail as an original.
      }
      url = redditOriginal(url);
    }
    return url.href;
  }
  function filename(url) {
    try { return decodeURIComponent(new URL(url).pathname.split("/").pop()) || "image"; }
    catch { return "image"; }
  }
  globalThis.QdmRules = { DEFAULTS, normalizeHost, matchesHost, allowed, patterns, permissionOrigins, originalImage, filename };
})();
