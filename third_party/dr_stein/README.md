# Dr Stein UI conventions

The theme palette data in `qml/Theme.qml` and `extension/palettes.js`, `qml/FrameResizer.qml`, and the
window-chrome helpers in `src/app/platform/` are adapted from
[streamx3/dr_stein](https://github.com/streamx3/dr_stein), inspected at commit
`eb49eb8ef8ba740f2823c799e378bccb0d073fac`. Its MIT license is reproduced in
[LICENSE](LICENSE). The source repository is not modified or required to build
QDownloadManager.

The extension ships its own copy of the MIT notice in `extension/LICENSE.dr-stein`.
Its palette data is checked against the QML palettes by `tests/theme.test.js`.

The integrated header and caption-button layout follow its TopBar and
WindowControls conventions, fitted to QDownloadManager's compact window. Our
existing Canvas icon renderer draws the caption glyphs; no Codicons assets or
Dr Stein disk-management code are included.

macOS uses the same transparent expanded client area, empty unified toolbar,
hidden native title, and measured traffic-light insets. This adaptation adds
ARC ownership, an offscreen-platform guard for tests, window-local light/dark
appearance, and the current AppKit titlebar-separator API.
