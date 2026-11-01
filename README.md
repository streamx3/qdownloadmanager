# Download Helper / qdownloadmanager

A Qt 6 desktop app, a small Chrome Native Messaging bridge, and a Manifest V3
extension for saving images in one click. The QML interface follows the Nocturne
HTML design in `Design/mockup/`: compact dark surfaces, outlined purple actions,
connection status, a download queue, recent files, and settings. Themes and the
integrated window header follow [Dr Stein](https://github.com/streamx3/dr_stein).

```text
Image button → extension service worker → Chrome native host → local IPC → Qt app
```

The user launches the app. Chrome launches only the headless bridge. There is no
remote relay server, account, or listening TCP port in the product.

## What works

- Image buttons on `joyreactor.cc`, `joyreactor.com`, `reddit.com` (including old
  Reddit), and their subdomains. Linked
  originals are preferred to thumbnails. Lazy-loaded and dynamically inserted
  images are discovered; small avatars and icons are skipped.
- Chrome fetches the original image with the source page's referrer and streams
  bounded chunks to the app, preserving file formats and animated GIFs. An optional URL mode lets the desktop
  app fetch public files itself. The app also has an **Add link** button.
- Shared queue with 1–3 simultaneous downloads, pause/resume, cancel, live progress,
  persistent recent history, folder selection, and reveal in Finder/Explorer.
- Filename checks with **Skip** (default) or **Overwrite** settings. Overwrite
  replaces the old file only after a successful transfer; skip avoids fetching it.
- Hover-only image buttons, persistent checkmarks for existing filenames, and a
  spinner while saving. Keyboard focus also reveals the button. Visible images
  refresh their status from the app every three seconds.
- Safe filenames, temporary files, disconnect cleanup, and
  request/response correlation. Clearing history never deletes saved files.
- Four Dr Stein palettes (teal, blurple, Apple blue, grey), each with dark/light
  schemes and a system-following option. Theme changes apply immediately.
- An integrated title bar: native traffic lights on macOS; caption controls on
  Windows/Linux. The header stays visible while the content scrolls.
- Optional system-tray/menu-bar behavior and completion notifications where the
  OS supports them. Closing the app normally quits unless background mode is on.
- Local native-host registration from the setup screen or a Python utility.
- A stable development extension ID from the public key in its manifest:
  `mffndkhpgldamhbcnnaofcklhemocinb`.

## Build

Requires CMake 3.21+, a C++17 compiler, and Qt 6.9+ with Core, Gui, Network, Qml,
Quick, Quick Controls 2, Widgets, and Test (when testing is enabled). Node 20+ and
Python 3.10+ are only needed for tests and the optional registration utility.
The extension has no npm dependencies and requires Chrome 116+.

```sh
cmake -S . -B build -G Ninja \
  -DCMAKE_PREFIX_PATH=/path/to/Qt/6.x/platform \
  -DCMAKE_BUILD_TYPE=Debug
cmake --build build
```

On this Mac, the Qt prefix is `/Users/andrii/Qt/6.10.2/macos`.

```sh
cmake -S . -B build -G Ninja -DCMAKE_PREFIX_PATH=/Users/andrii/Qt/6.10.2/macos
cmake --build build
open build/qdownloadmanager.app
```

On Linux, run `build/qdownloadmanager`. On Windows, run `qdownloadmanager.exe`
from the build output directory (often `build/Debug` for Visual Studio generators).
Run in a Qt-configured environment or deploy the Qt DLLs with `windeployqt`.
`qdm-native-host` must be beside the app executable. On macOS both binaries are
inside `qdownloadmanager.app/Contents/MacOS`.

## Connect Chrome

1. Launch Download Helper and choose the save folder.
2. Click **Register Chrome bridge**. This registers the current executable path
   for your user, without administrator access. Register again if you move it.
3. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**,
   and select this repository's `extension` folder. The desktop app's **Show
   extension folder** button opens it for you.
4. Finish the app's setup. Open the extension popup and click **Connect**.
5. Visit JoyReactor or Reddit, hover over a large image, and click its ↓ button. Keep the desktop app
   running until the image is saved. Reload previously open pages if necessary.

In the extension's settings, add website domains and additional image-CDN domains.
Chrome requests host access for additions. Removing a website removes its buttons
and blocks new requests; Chrome's previously granted permission remains until you
revoke it in the browser. The default network grants cover JoyReactor, `reactor.cc`, Reddit, and its
`i.redd.it`, `preview.redd.it`, and `external-preview.redd.it` image hosts.

### Appearance and window controls

Settings → Appearance offers **Teal**, **Blurple**, **Blue**, and **Grey**, plus
**Dark**, **Light**, and **System**. The header's sun/moon button switches between
light and dark. Preferences persist independently from Dr Stein. Existing users
keep the familiar blurple/dark default; all four palette values come from Dr Stein.

The integrated title bar is enabled by default. On macOS it retains native
traffic lights, window resizing, zoom/fullscreen, and the system frame, while
hiding the separate title and blending the header into the app. Windows uses an
expanded client area with app-drawn caption buttons. Linux uses a frameless
window with resize edges. Drag the header to move the window; non-macOS headers
also support double-click maximize/restore. Close still honors **Keep running
when closed**; Quit exits the app normally.

Turn off **Integrated title bar** in Appearance and restart to restore the system
title bar. For a single launch, pass `--native-title-bar`. Qt 6.9+ is now required
for expanded-client-area and safe-area support. macOS has been exercised locally;
Windows and Linux native window-manager behavior still needs platform testing.
Windows Snap Layouts on hovering our maximize button are not implemented.

The MIT-licensed theme and window code provenance is recorded in
[third_party/dr_stein](third_party/dr_stein/README.md). Dr Stein itself is unchanged
and is not a build dependency. The extension's popup and settings page follow the
desktop app's displayed colors and resolved light/dark mode. Open extension pages
check for changes every three seconds and keep the exact last received theme when
the app is closed. Qt decides the scheme in System mode; Chrome does not override
it with its own preference. This requires app 0.3.2+ and extension 0.2.4+. Before
the first theme sync, the extension uses blurple/dark. There is no separate
extension theme selector. From extension 0.2.6, image-overlay buttons and their
notifications also use those exact colors, including hover, progress, saved, and
error states. They stay transparent until the image is hovered or the button has
keyboard focus. Website image-status checks refresh the shared theme even with
the popup and settings closed; offline overlays retain the last received theme.

App 0.3.3 includes a teal download arrow on a dark squircle as a proper macOS
bundle icon, as well as the runtime Qt icon. This makes it available in Finder,
the Dock, and the app switcher. Extension 0.2.5 uses the same artwork for its
toolbar, extension manager, and page headers. Source and regeneration details
are in [assets/icons](assets/icons/README.md). The header's +, moon, and settings
glyphs are centered within their buttons, and the moon uses a corrected crescent.

App 0.3.4 uses the supplied Icons8 settings gear with the current theme's glyph
color. Extension 0.2.7 removes the desktop artwork's transparent outer padding
from Chrome's icons, so the squircle fills each icon canvas edge to edge.

### Updating an already loaded extension

After editing/updating the extension folder, click **Reload** on Download Helper
at `chrome://extensions`, then refresh the website page. The desktop app does
not need rebuilding for extension-only changes.

Extension 0.2.6 themes the image-overlay controls using the Qt app's rendered
palette and scheme. Reload the extension and refresh open website tabs once.
The existing app 0.3.2+ already supplies the necessary colors; no app update is
needed for this extension release.

Extension 0.2.4 with app 0.3.2 uses the actual color values exported by the Qt UI.
This prevents a scheme mismatch when Qt and Chrome resolve System differently,
and avoids recalculating the app's theme in the browser. Restart the rebuilt app
and reload the extension to enable this. The settings page indicates when an
older running app needs a restart before its theme can be received.

Extension 0.2.3 fixes saving newly added domains: host access requests now use
separate HTTP and HTTPS patterns matching the optional manifest declarations.
It also themes the popup and settings page using the app's appearance preferences.
Restart the rebuilt desktop app and reload the extension, then reopen its settings
page to receive the theme. Existing site choices and transfer settings are retained.

Extension 0.2.2 fixes stale image-button overlays left in already-open pages by
extension reloads. It removes older overlays before installing the current one,
clears hover when the pointer leaves the page or Chrome loses focus, and limits
mouse visibility to the image under the cursor. Keyboard focus still reveals its
button for accessibility. Reload the extension and refresh an affected page once
when upgrading from older versions.

Version 0.2.1 adds Reddit. Reload the extension and refresh any open Reddit tabs;
no desktop-app rebuild is required. Chrome may ask to approve access to the new
Reddit domains. The one-time settings migration adds Reddit while keeping custom
websites, image hosts, and transfer mode. If you later remove Reddit, subsequent
reloads respect that choice.

Reddit support covers ordinary post images, each displayed gallery slide, the
`/media?url=…` viewer, and expanded old-Reddit images. Known Reddit preview URLs
resolve to their original `i.redd.it` media-ID filename, so the same image has one
filename across feed, gallery, and viewer. External-preview URLs retain their
signed query string and may be previews rather than originals. Open shadow roots
and roots attached after page load are scanned; small thumbnails/avatars remain
excluded. A gallery is saved one image at a time as you browse its slides.

Reddit video players, closed shadow roots, bulk gallery saving, and external
sites such as Imgur are not added in this release. Add an external image host in
settings when needed. Requests ask Reddit's CDN for image bytes and reject HTML
responses and redirects. No Reddit API key, account export, or Qt change is needed.

Version 0.2.0 fixes the quit crash with connected browsers, adds filename-policy
settings, and checks existing files through two-way Native Messaging. Rebuild and
restart the desktop app, reload the extension, and refresh your JoyReactor tabs.
The checkmark means a matching filename exists in the selected save folder; it
does not claim byte equality. Subfolder scans and hashing are future catalog work.

Version 0.1.2 fixes the `WorkerGlobalScope: Illegal invocation` error introduced
in 0.1.1 by binding the native `fetch` function to its worker global. The transfer
regression test now reproduces Chrome's function-receiver check.

Version 0.1.1 fixes missing source-page referrers in browser transfers. A public
JoyReactor image returned different bytes with and without its page referrer, even
without cookies. Each image fetch now gets a temporary, exact-URL header rule
restricted to this extension's own background GET request. The rule is removed
when response headers arrive. The fetch bypasses the cache so an older response
obtained without the referrer cannot be reused. This uses the
`declarativeNetRequestWithHostAccess` permission on already permitted image hosts.

Keep **Chrome transfers the image file** selected in the extension settings.
Browser mode sends the image **body** through Native Messaging; it still makes a
new HTTP request rather than extracting the page's already-loaded response.
**Desktop app downloads the URL** deliberately sends only the URL and does not
carry the browser session or page referrer. It can therefore receive a watermarked
variant. The extension continues to prefer a linked full-size image when present.

The equivalent command-line registration on macOS is:

```sh
python3 scripts/register_host.py \
  --host "$PWD/build/qdownloadmanager.app/Contents/MacOS/qdm-native-host"
```

On Linux/Windows, pass the corresponding native-host executable path. To inspect
the generated manifest without changing Chrome registration, add
`--manifest-dir build/native-manifest`. Remove registration with
`python3 scripts/register_host.py --uninstall`.

The bridge identifies as `cc.qdownloadmanager.bridge`. If you remove/change the
extension's manifest key or publish under another ID, update `extension/identity.json`,
rebuild, and register again. The manifest contains a **public** key only.

## Validation

```sh
ctest --test-dir build --output-on-failure
npm test
npm run check
python3 tests/database_test.py
python3 tests/integration.py \
  --app build/qdownloadmanager.app/Contents/MacOS/qdownloadmanager \
  --host build/qdownloadmanager.app/Contents/MacOS/qdm-native-host
```

The Qt UI tests load the actual QML, click the theme/settings controls, render
all eight palette/scheme combinations, check system-following behavior and native
title-bar fallback, and verify close-to-tray behavior. On macOS, run
`QT_QUICK_BACKEND=software build/qdm-ui-tests` to additionally check native
traffic-light metrics; CTest runs its portable offscreen version.

The integration test uses isolated settings, an offscreen UI, the real bridge
process, and a temporary loopback HTTP fixture server. It checks startup order,
multi-chunk byte equality, queue advancement, name collisions, disconnect cleanup,
native downloading, HTTP failures, and graceful quit with a live client and
unfinished transfer. It does not install anything into Chrome.
Use the equivalent executable paths on Linux/Windows.

The optional automated DOM/CSS test runs in a temporary headless browser profile:

```sh
npm install --no-save playwright
# Or point QDM_PLAYWRIGHT_MODULE to an existing playwright/index.mjs.
QDM_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node tests/browser-ui.mjs
QDM_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node tests/reddit-browser.mjs
QDM_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node tests/extension-pages.mjs
```

It loads the real content script with a controlled message responder and checks
hover/focus visibility, busy state, persistent checkmarks, disk-status refresh,
and lazy-image changes. Reddit fixtures also cover shadow DOM, recycled gallery
slides, viewer URLs, delayed components, and legacy post metadata. It does not exercise Chrome's actual native-host launch;
the separate integration test covers the real bridge and desktop app.

`extension-pages.mjs` loads the actual unpacked extension in an isolated Chrome
profile (requires Chrome with the `Extensions.loadUnpacked` debugging API). It
tests settings saves with granted sites, Chrome's manifest pattern validation,
denied-permission handling, all eight palette/scheme combinations, live theme
sync, and offline/older-app behavior. The native app boundary and a denied prompt
are controlled fixtures; it does not click Chrome's native permission dialog.
Set `QDM_CAPTURE_DIR` to save light/dark popup and settings screenshots.
To compare against actual Qt-rendered themes, run CTest with
`QDM_UI_CAPTURE_DIR=/tmp/qdm-qt-themes`, then run `extension-pages.mjs` with
`QDM_QT_THEMES=/tmp/qdm-qt-themes/themes.json`. The browser checks every exported
color and verifies that Qt's scheme wins when Chrome prefers the opposite mode.

For a browser smoke test:

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory tests/fixtures
```

Add `localhost` to the extension's enabled websites, visit
`http://localhost:8765`, save the large image, then add a lazy image and save it.
The 40px avatar should have no button. Try pausing/cancelling a larger transfer,
closing/reopening the app, and downloading the same image twice.

For an isolated UI capture, use `--data-dir`, `--screenshot`, and `--quit-after`
(add `--settings` to capture Appearance):

```sh
QT_QPA_PLATFORM=offscreen QT_QUICK_BACKEND=software \
  build/qdownloadmanager.app/Contents/MacOS/qdownloadmanager \
  --data-dir build/preview-data --screenshot build/preview.png --quit-after 2000
```

The bridge honors `QDM_DATA_DIR` for the same isolated setup. Never set it in a
normal Chrome registration unless the UI is also using that directory.

## Current limits

- This is a development build, with an unpacked extension. Store publishing,
  signing/notarization, automatic updates, and production installers are not yet
  included. Build/install output needs Qt runtime deployment before distribution.
- Browser transfers are capped at 2 GiB. Only HTTP(S) image resources are supported;
  page-owned `blob:` URLs, video-as-GIF players, canvas content, and DRM content
  are outside this version. Images smaller than 100×80 displayed pixels are skipped.
- Being visible on a page does not guarantee an image is fetchable. SameSite/
  partitioned cookies, anti-bot protections, hotlink checks, and redirects may
  still prevent transfer. Browser mode rejects redirects rather than fetching
  an unapproved destination. It never exports cookies to the desktop app.
- Browser-mode pause retains bytes, but a prolonged pause may cause the image
  server to close its stream. Native URL-mode pause restarts from byte zero.
  Interrupted jobs appear as failed on restart and need to be requested again.
- The app records successful and failed history locally. URLs and browser cookies
  are not written into history. Temporary files are removed on ordinary failure,
  cancellation, or disconnect; a hard process crash can leave `.qdm-*.part` files.
- macOS is the locally validated platform. Windows and Linux paths/code are
  included but need testing on those operating systems.

See [docs/protocol.md](docs/protocol.md) for framing, commands, and lifecycle rules.

The proposed shared catalog is in [docs/database/README.md](docs/database/README.md),
with an executable draft schema and tests. It is not integrated into the app.

Reddit validation (0.2.1): automated URL/permissions/migration tests, service-worker
byte-transfer tests, and real Chromium DOM fixtures. A public `i.redd.it` original
returned HTTP 200 with PNG bytes. Reddit presented a human-verification challenge
to the separate signed-out browser probe, so live logged-in Reddit layout testing
remains to be confirmed in the user's session.
