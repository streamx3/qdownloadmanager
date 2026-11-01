/* Shared by content scripts, the service worker, options, and tests. */
(() => {
  const DEFAULTS = Object.freeze({ sites: ["joyreactor.cc", "joyreactor.com"], imageHosts: ["reactor.cc"], mode: "browser" });
  function normalizeHost(value) {
    const raw = String(value).trim();
    if (!raw || raw.includes("*") || /\s/.test(raw)) throw new Error("Enter a domain such as joyreactor.cc, without wildcards.");
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
  function originalImage(image, pageUrl) {
    const source = image.currentSrc || image.getAttribute("src") || image.getAttribute("data-src");
    if (!source) return null;
    let url;
    try { url = new URL(source, pageUrl); } catch { return null; }
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const link = image.closest("a[href]");
    if (link) {
      let href;
      try { href = new URL(link.getAttribute("href"), pageUrl); } catch { return url.href; }
      // JoyReactor links thumbnails to /pics/post/full/ originals. Also handle
      // ordinary image links on user-enabled sites without inventing image URLs.
      if (["http:", "https:"].includes(href.protocol) && (/\.(?:jpe?g|png|gif|webp|avif|bmp|svg)(?:$)/i.test(href.pathname)
          || /\/pics\/post\/full\//.test(href.pathname))) url = href;
    }
    return url.href;
  }
  function filename(url) {
    try { return decodeURIComponent(new URL(url).pathname.split("/").pop()) || "image"; }
    catch { return "image"; }
  }
  globalThis.QdmRules = { DEFAULTS, normalizeHost, matchesHost, allowed, patterns, originalImage, filename };
})();
