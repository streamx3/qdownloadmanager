# Local protocol, version 1

Chrome launches `qdm-native-host`; the desktop UI is started separately by the user.
The host uses stdin/stdout for Chrome and a persistent `QLocalSocket` for the UI.
Both transports use a native-endian unsigned 32-bit length followed by UTF-8 JSON.
The application protocol caps frames at 512 KiB and raw chunks at 192 KiB, below
Chrome's native-message limits in both directions. Stdout contains protocol data
only. Diagnostic output belongs on stderr.

Every request contains `v: 1`, a unique string `id`, and `type`. Every response
echoes `v` and `id`, and has either `ok: true` or
`ok: false, error: { code, message }`. Requests on one connection may be submitted
concurrently; the bridge processes them in arrival order. Replies are correlated
by `id` in the extension.

| Type | Fields | Result |
| --- | --- | --- |
| `hello`, `status` | — | `appVersion`, `setupComplete`, `accepting`, `active`, `appearance` |
| `filesStatus` | `names` array (up to 64, at most 1024 characters each) | Ordered `files`: `{name, exists, busy, policy}` |
| `begin` | `url`, optional `name`, `mime`, `total` | Browser transfer `jobId`, `state`, `name` |
| `enqueue` | `url`, optional `name` | Native HTTP download `jobId`, `state`, `name` |
| `metadata` | `jobId`, `mime`, `total` | Updates a browser transfer; returns `state`, `name` (can be `skipped`) |
| `jobStatus` | `jobId` | `state`, `name`, `received`, optional error `message` |
| `chunk` | `jobId`, `offset`, base64 `data` | `accepted`, `received`; or `accepted: false` while queued/paused |
| `finish` | `jobId`, final byte `size` | Commits the file; returns `state`, `name` |
| `abort` | `jobId`, optional `message` | Removes partial data and records a failure |

`total: -1` means unknown size. Files are capped at 2 GiB. Byte offsets must equal
the number already written. Chunks are not implicitly retried or deduplicated.
The client retains a paused chunk and resubmits it only after `receiving` resumes.
The app checks final byte counts and writes to a hidden temporary file in the
chosen folder. The destination and duplicate policy are frozen when a job is
accepted. With default `skip`, an existing filename returns `state: "skipped"`
without a job ID or network request. `overwrite` atomically replaces the old file
only after a successful transfer. Cancellation/failure preserves the old file.
Directories and symlinks are not overwritten.

If another active job already targets that filename, `begin`/`enqueue` return
`state: "in_progress"` without a job ID. The client must not fetch another copy.
A target appearing later can result in `skipped` when a queued job starts,
a MIME-derived filename is learned, or `finish` commits. Clients must handle all
three cases without treating the skip as failure.

App 0.3.1 adds `appearance: {palette, colorScheme}` to `hello`/`status`, including
before setup is complete. Palettes are `blurple`, `teal`, `blue`, and `grey`;
schemes are `dark`, `light`, and `system`. This optional additive field keeps
protocol v1 compatible with older apps and extensions. Extension 0.2.3 validates
and caches these preferences in local extension storage. Its popup and options
page poll status every three seconds while visible and follow storage changes
immediately. The last valid theme remains available offline; missing/invalid
fields from older apps do not erase it. Appearance is read-only over the bridge;
the desktop app remains the settings authority.

App 0.3.2 additionally exports `resolvedScheme: "dark" | "light"` and `colors`
directly from the rendered QML theme. Color roles are `bg`, `surface`, `text`,
`line`, `muted`, `dim`, `inset`, `accent`, `accent-text`, `accent-dark`, `hover`,
and `danger`, each a six-digit hex color. Extension 0.2.4 applies these values
without recomputing them from a local palette or Chrome's OS preference. Even in
System mode, the Qt window's resolved scheme is authoritative. The full snapshot
is cached; changes to resolved scheme or color values refresh the cache even when
palette and preference names stay the same. Offline pages keep the last Qt
snapshot. Only legacy responses without a snapshot use the browser's local
palette/scheme fallback. An older connected app is identified in options with a
restart hint. The wire protocol version remains 1.

`filesStatus` checks sanitized names in the currently selected save folder,
without creating jobs or reading file contents. It works while new downloads are
paused, but requires completed setup. Status replies do not expose full paths.
`busy` covers queued, paused, and active jobs in that folder. The check is by name,
not hash, and does not scan subfolders. Extension requests are validated against
the sending page and configured image hosts, then converted to filenames by the
worker. The content script checks visible images in batches, every three seconds
and after visibility/download changes. It shows busy before exists (an overwrite
may have both true), and clears stale marks when the app cannot be reached.
There are no unsolicited bridge events; bidirectional request/reply polling also
notices external file changes and selected-folder changes.

The desktop app applies one shared concurrency limit to URL downloads and browser
transfers. A browser job is queued before its HTTP fetch begins. States are
`queued`, `receiving`/`downloading`, `paused`, `completed`, `skipped`, `failed`, `cancelled`.
Pausing a browser transfer preserves its partial file. Pausing a native HTTP
download discards its partial file; resuming starts a fresh request. Range-based
resume is not implemented.

New local connections must begin with `hello`. The bridge does that automatically
when reconnecting. Transfer IDs belong to the connection that created them.
Disconnecting a bridge fails its incomplete browser transfers; URL downloads can
continue independently. A receiving browser transfer with no activity for two
minutes fails. Queued/paused clients poll status, and cancelled jobs stop at the
next status/chunk request. An HTTP read waiting for data times out after 60 seconds.

The UI instance is protected with `QLockFile`. Local IPC uses a user-scoped named
pipe on Windows; Unix sockets live in a private directory with a short hashed name.
This is an integration boundary between programs run by the same user, not a
sandbox against other malicious processes running as that user.

The extension validates the sending tab's site and the requested image host.
Only HTTP(S) URLs without embedded credentials are accepted. Browser-mode fetches
reject redirects and non-image responses (except generic binary content types).
No browser cookies are exported to the app. Downloads retain original resource
bytes; there is no canvas re-encoding or screenshot capture.

Browser transfers fetch the image from the extension worker, not from the page's
already-loaded response buffer. To preserve the source-page referrer, extension
0.1.1 adds a temporary `declarativeNetRequestWithHostAccess` session rule before
each fetch. Its conditions match the exact image URL, extension initiator, no-tab
worker context, GET method, and XMLHttpRequest/fetch resource type. The page URL
comes from Chrome's message sender. Cross-origin requests carry only the page's
origin; same-origin requests can carry the full URL without its fragment. HTTPS
to HTTP downgrades carry no referrer.

The rule is removed as soon as response headers arrive, including on request
failure. Concurrent requests for the same URL serialize their header phase to
avoid applying another tab's referrer. Stale rules from a terminated worker are
cleared on initialization. Image fetches use `cache: no-store`: the observed
JoyReactor response lacked `Vary: Referer`, so a response fetched in the old
context could otherwise be reused. Cookies are still handled by Chrome using
`credentials: include`; this does not guarantee identical partitioned/session
state to a page's embedded image. Native URL-mode requests do not receive the
page referrer or browser cookies.

On orderly app exit, disconnect socket callbacks before destroying the client
table, close local clients, abort network replies, remove partial files, and save
interrupted history while the UI models still exist. Destructor cleanup is
idempotent so quitting through QML, the tray menu, or the window follows the same
path. No partial file is published as a completed image.

Reddit support (extension 0.2.1) uses the same transfer and status protocol. The
content script unwraps Reddit media-viewer URLs and converts recognized native
preview IDs to `i.redd.it` originals before both status queries and download
requests. Signed external-preview URLs remain unchanged. The worker validates
the sender and resolved host as usual; CDN fetches set `Accept: image/*` along
with the source-page referrer. No gallery/API JSON or browser-session secrets are
sent to the desktop app. Galleries are handled one visible image at a time.

Extension 0.2.2 also versions its content-script overlay. Reloading an unpacked
extension can leave old content-script DOM behind, so installation removes stale
overlay hosts and same-context upgrades disconnect their observers/listeners.
A detached host cleans up its timers. Mouse visibility belongs to one image at
a time and clears on pointer exit, hidden pages, or window blur; keyboard focus
continues to reveal a button. This is UI lifecycle handling, with no protocol or
native transfer changes.
