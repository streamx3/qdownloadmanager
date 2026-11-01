#!/usr/bin/env python3
"""Register the native bridge for this user; no administrator access is needed."""
import argparse
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
IDENTITY = json.loads((ROOT / "extension/identity.json").read_text())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", type=Path, help="Absolute path to the built qdm-native-host executable")
    parser.add_argument("--manifest-dir", type=Path, help="Write only to this directory (does not change browser registration)")
    parser.add_argument("--uninstall", action="store_true", help="Remove this app's native-host registration")
    args = parser.parse_args()
    if args.manifest_dir:
        directory = args.manifest_dir.resolve()
    elif sys.platform == "darwin":
        directory = Path.home() / "Library/Application Support/Google/Chrome/NativeMessagingHosts"
    elif sys.platform == "win32":
        directory = Path(os.environ["LOCALAPPDATA"]) / "QDownloadManager/DownloadHelper"
    else:
        directory = Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))) / "google-chrome/NativeMessagingHosts"
    manifest = directory / (IDENTITY["host"] + ".json")
    registry_key = "Software\\Google\\Chrome\\NativeMessagingHosts\\" + IDENTITY["host"]
    if args.uninstall:
        manifest.unlink(missing_ok=True)
        if sys.platform == "win32" and not args.manifest_dir:
            import winreg
            try:
                winreg.DeleteKey(winreg.HKEY_CURRENT_USER, registry_key)
            except FileNotFoundError:
                pass
        print(f"Removed registration: {manifest}")
        return
    if not args.host or not args.host.is_file():
        parser.error("--host must point to the built native bridge executable")
    directory.mkdir(parents=True, exist_ok=True)
    document = {
        "name": IDENTITY["host"], "description": "Download Helper local bridge",
        "path": str(args.host.resolve()), "type": "stdio",
        "allowed_origins": [f"chrome-extension://{IDENTITY['extensionId']}/"],
    }
    temporary = manifest.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
    temporary.replace(manifest)
    if sys.platform == "win32" and not args.manifest_dir:
        import winreg
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, registry_key) as key:
            winreg.SetValueEx(key, "", 0, winreg.REG_SZ, str(manifest))
    print(f"Native host manifest: {manifest}")
    print(f"Extension ID: {IDENTITY['extensionId']}")
    if args.manifest_dir:
        print("Manifest generated only; Chrome registration was not changed.")


if __name__ == "__main__":
    main()
