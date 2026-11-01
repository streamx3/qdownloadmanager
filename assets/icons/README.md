# Download Helper icon

`download-helper.svg` is the source: the existing download arrow in teal
(`#3fc9c4`) on a dark (`#0c1619`) squircle. The background is fixed across app
themes so the brand remains recognizable in Finder, the Dock, and Chrome.

The checked-in PNGs supply Qt's runtime icon at multiple resolutions. macOS also
needs `download-helper.icns` in the bundle's Resources directory and the
`CFBundleIconFile` entry in Info.plist; CMake configures both. Windows uses the ICO
through a compiled resource. Chrome uses copies of the small PNGs in
`extension/icons`, including its toolbar, extension manager, and page headers.

To regenerate on macOS, install Sharp for Node and run:

```sh
node scripts/generate-icons.mjs
```

Alternatively set `QDM_SHARP_MODULE` to an existing Sharp entry module. The script
uses Apple's `iconutil` to build the ICNS with standard and Retina representations.
Ordinary CMake builds use the checked-in assets and do not need these tools.
