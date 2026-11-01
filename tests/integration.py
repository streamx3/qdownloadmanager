#!/usr/bin/env python3
"""Exercise the real app + stdio bridge in isolated directories, without Chrome."""
import argparse
import base64
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import queue
import struct
import subprocess
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
IDENTITY = json.loads((ROOT / "extension/identity.json").read_text())


class Bridge:
    def __init__(self, path, env):
        self.process = subprocess.Popen([str(path), f"chrome-extension://{IDENTITY['extensionId']}/"], env=env,
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.replies = queue.Queue()
        self.counter = 0
        threading.Thread(target=self.read, daemon=True).start()

    def read(self):
        try:
            while header := self.process.stdout.read(4):
                length, = struct.unpack("=I", header)
                assert 0 < length <= 512 * 1024
                self.replies.put(json.loads(self.process.stdout.read(length)))
        except Exception as error:
            self.replies.put(error)

    def request(self, kind, **fields):
        self.counter += 1
        payload = json.dumps({**fields, "v": 1, "id": str(self.counter), "type": kind}).encode()
        self.process.stdin.write(struct.pack("=I", len(payload)) + payload)
        self.process.stdin.flush()
        response = self.replies.get(timeout=15)
        if isinstance(response, Exception):
            raise response
        assert response["id"] == str(self.counter), response
        return response

    def close(self):
        self.process.stdin.close()
        self.process.wait(timeout=5)
        assert self.process.returncode == 0, self.process.stderr.read().decode()


def require_ok(response):
    assert response.get("ok"), response
    return response


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", required=True, type=Path)
    parser.add_argument("--host", required=True, type=Path)
    parser.add_argument("--screenshot", type=Path)
    args = parser.parse_args()
    data = (ROOT / "tests/fixtures/image.svg").read_bytes() + b"\n<!--" + b"image-transfer-test" * 30000 + b"-->"

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/missing":
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", "image/svg+xml")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            if self.path == "/slow":
                self.wfile.write(data[:32]); self.wfile.flush()
                time.sleep(2)
                try:
                    self.wfile.write(data[32:])
                except (BrokenPipeError, ConnectionResetError):
                    pass
            else:
                self.wfile.write(data)

        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix="qdm-integration-") as temp:
        directory = Path(temp)
        downloads = directory / "downloads"
        downloads.mkdir()
        env = {**os.environ, "QDM_DATA_DIR": str(directory), "QT_QPA_PLATFORM": "offscreen", "QT_QUICK_BACKEND": "software"}
        (directory / "settings.ini").write_text(f"[General]\nsetupComplete=true\nconcurrency=1\nfolder={downloads.as_posix()}\n")
        bridge = Bridge(args.host.resolve(), env)
        assert bridge.request("hello")["error"]["code"] == "app_not_running"
        print("PASS: user-launched app can be absent when the bridge starts")
        log = open(directory / "app.log", "w+")
        command = [str(args.app.resolve()), "--data-dir", str(directory), "--quit-after", "7000"]
        if args.screenshot:
            command += ["--screenshot", str(args.screenshot.resolve())]
        app = subprocess.Popen(command, env=env, stdout=log, stderr=log)
        try:
            deadline = time.monotonic() + 10
            while True:
                hello = bridge.request("hello")
                if hello.get("ok"):
                    break
                assert app.poll() is None, "App failed during startup"
                assert time.monotonic() < deadline, hello
                time.sleep(0.1)
            assert hello["setupComplete"] and hello["accepting"], hello
            appearance = hello["appearance"]
            assert appearance["palette"] == "blurple" and appearance["colorScheme"] == "dark", appearance
            assert appearance["resolvedScheme"] == "dark" and appearance["colors"]["bg"] == "#161826", appearance
            assert len(appearance["colors"]) == 12, appearance
            print("PASS: bridge connects when the app starts")
            first = require_ok(bridge.request("begin", url="https://joyreactor.cc/image.svg", name="../../image.svg", total=len(data)))["jobId"]
            second = require_ok(bridge.request("begin", url="https://joyreactor.com/image.svg", name="second.svg", total=len(data)))["jobId"]
            assert bridge.request("jobStatus", jobId=second)["state"] == "queued"
            assert not bridge.request("chunk", jobId=second, offset=0, data="YWJj")["accepted"]
            for job in [first, second]:
                for offset in range(0, len(data), 192 * 1024):
                    result = require_ok(bridge.request("chunk", jobId=job, offset=offset, data=base64.b64encode(data[offset:offset + 192 * 1024]).decode()))
                    assert result["accepted"]
                require_ok(bridge.request("finish", jobId=job, size=len(data)))
            expected = hashlib.sha256(data).digest()
            for name in ["image.svg", "second.svg"]:
                assert hashlib.sha256((downloads / name).read_bytes()).digest() == expected
            duplicate = require_ok(bridge.request("begin", url="https://joyreactor.cc/image.svg", name="image.svg"))
            assert duplicate["state"] == "skipped" and "jobId" not in duplicate
            status = require_ok(bridge.request("filesStatus", names=["image.svg", "absent.png"]))["files"]
            assert status[0]["exists"] and not status[1]["exists"]
            print("PASS: exact chunked bytes, queue advancement, safe paths, and duplicate checks")
            interrupted = require_ok(bridge.request("begin", url="https://joyreactor.cc/interrupted.png", name="interrupted.png"))["jobId"]
            require_ok(bridge.request("chunk", jobId=interrupted, offset=0, data="YWJj"))
            bridge.close()
            deadline = time.monotonic() + 5
            while list(downloads.glob("*.part")) or list(downloads.glob(".qdm-*.part")):
                assert time.monotonic() < deadline
                time.sleep(0.05)
            assert not (downloads / "interrupted.png").exists()
            print("PASS: Chrome disconnect cleans up unfinished files")
            bridge = Bridge(args.host.resolve(), env)
            require_ok(bridge.request("hello"))
            job = require_ok(bridge.request("enqueue", url=f"http://127.0.0.1:{server.server_port}/download.svg", name="network.svg"))["jobId"]
            deadline = time.monotonic() + 10
            while True:
                state = require_ok(bridge.request("jobStatus", jobId=job))["state"]
                if state == "completed":
                    break
                assert state != "failed" and time.monotonic() < deadline, state
                time.sleep(0.05)
            assert hashlib.sha256((downloads / "network.svg").read_bytes()).digest() == expected
            missing = require_ok(bridge.request("enqueue", url=f"http://127.0.0.1:{server.server_port}/missing", name="missing.png"))["jobId"]
            deadline = time.monotonic() + 5
            while bridge.request("jobStatus", jobId=missing)["state"] != "failed":
                assert time.monotonic() < deadline
                time.sleep(0.05)
            assert not (downloads / "missing.png").exists()
            print("PASS: native HTTP downloading and HTTP error handling")
            # Keep the socket and an unfinished file alive through QApplication::quit.
            shutdown_job = require_ok(bridge.request("begin", url="https://joyreactor.cc/shutdown.png"))["jobId"]
            require_ok(bridge.request("chunk", jobId=shutdown_job, offset=0, data="YWJj"))
            app.wait(timeout=10)
            assert app.returncode == 0, f"Graceful quit crashed: {app.returncode}"
            assert not list(downloads.glob(".qdm-*.part"))
            assert not (downloads / "shutdown.png").exists()
            bridge.close()
            print("PASS: graceful app quit with a live bridge and unfinished transfer")
        finally:
            if bridge.process.poll() is None:
                bridge.process.terminate()
                bridge.process.wait(timeout=5)
            if app.poll() is None:
                app.terminate()
                app.wait(timeout=5)
            log.seek(0)
            output = log.read()
            log.close()
            assert "QQmlApplicationEngine failed" not in output, output
            assert "ReferenceError" not in output and "TypeError" not in output, output
            if output.strip():
                print("App diagnostics:", output.strip())
    # Also exercise network-reply teardown with QObject callbacks still connected.
    with tempfile.TemporaryDirectory(prefix="qdm-network-quit-") as temp:
        directory = Path(temp)
        downloads = directory / "downloads"
        downloads.mkdir()
        (directory / "settings.ini").write_text(f"[General]\nsetupComplete=true\nfolder={downloads.as_posix()}\n")
        env = {**os.environ, "QDM_DATA_DIR": str(directory), "QT_QPA_PLATFORM": "offscreen", "QT_QUICK_BACKEND": "software"}
        app = subprocess.Popen([str(args.app.resolve()), "--data-dir", str(directory), "--quit-after", "1500"],
                               env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        bridge = Bridge(args.host.resolve(), env)
        try:
            deadline = time.monotonic() + 5
            while not bridge.request("hello").get("ok"):
                assert app.poll() is None and time.monotonic() < deadline
                time.sleep(0.05)
            job = require_ok(bridge.request("enqueue", url=f"http://127.0.0.1:{server.server_port}/slow", name="slow.svg"))["jobId"]
            assert bridge.request("jobStatus", jobId=job)["state"] == "downloading"
            _, diagnostics = app.communicate(timeout=5)
            assert app.returncode == 0, diagnostics.decode()
            assert not list(downloads.glob(".qdm-*.part")) and not (downloads / "slow.svg").exists()
            print("PASS: graceful quit aborts an active HTTP response and removes its partial file")
        finally:
            bridge.close()
            if app.poll() is None:
                app.terminate(); app.wait(timeout=5)
    server.shutdown()
    print("All native integration checks passed.")


if __name__ == "__main__":
    main()
