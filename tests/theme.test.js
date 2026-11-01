import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { palettes } from "../extension/palettes.js";
import { themeColors } from "../extension/theme.js";
import { cacheAppearance } from "../extension/appearance.js";

test("extension palettes stay identical to the desktop's Dr Stein palettes", () => {
  const qml = readFileSync(new URL("../qml/Theme.qml", import.meta.url), "utf8");
  const literal = qml.split("readonly property var palettes: (")[1].split("\n    })")[0] + "\n    }";
  assert.deepEqual(palettes, JSON.parse(JSON.stringify(runInNewContext(`(${literal})`))));
  for (const palette of Object.keys(palettes)) {
    for (const colorScheme of ["dark", "light"]) {
      const theme = themeColors({ palette, colorScheme });
      assert.equal(theme.colors.bg, palettes[palette][colorScheme].bg);
      assert.equal(theme.colors.text, palettes[palette][colorScheme].text);
      assert.ok(Object.values(theme.colors).every(color => /^#[0-9a-f]{6}$/.test(color)));
    }
  }
});

test("system themes follow OS changes while explicit schemes do not", () => {
  assert.equal(themeColors({ palette: "teal", colorScheme: "system" }, true).dark, true);
  assert.equal(themeColors({ palette: "teal", colorScheme: "system" }, false).dark, false);
  assert.equal(themeColors({ palette: "blue", colorScheme: "dark" }, false).dark, true);
  assert.equal(themeColors({ palette: "blue", colorScheme: "light" }, true).dark, false);
  assert.equal(themeColors({ palette: "unknown", colorScheme: "unknown" }).palette, "blurple");
});

test("appearance cache survives older apps and avoids redundant storage events", async () => {
  let saved, writes = 0;
  const storage = { async get() { return { appearance: saved }; }, async set({ appearance }) { saved = appearance; writes++; } };
  await cacheAppearance(storage, { palette: "teal", colorScheme: "system", unused: "not stored" });
  assert.deepEqual(saved, { palette: "teal", colorScheme: "system" });
  await cacheAppearance(storage, saved);
  await cacheAppearance(storage, undefined);
  await cacheAppearance(storage, { palette: "unknown", colorScheme: "light" });
  assert.equal(writes, 1);
  await cacheAppearance(storage, { palette: "grey", colorScheme: "light" });
  assert.equal(writes, 2);
});
