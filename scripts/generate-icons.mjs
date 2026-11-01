// Run on macOS with Sharp installed, or QDM_SHARP_MODULE pointing to its entry.
// Outputs are checked in; normal app builds do not need Node, Sharp, or iconutil.
import { mkdir, readFile, writeFile, copyFile, mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const { default: sharp } = await import(process.env.QDM_SHARP_MODULE || "sharp");
const root = fileURLToPath(new URL("../", import.meta.url));
const assets = join(root, "assets/icons"), extension = join(root, "extension/icons");
await mkdir(extension, { recursive: true });
const source = await readFile(join(assets, "download-helper.svg"));
const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];
const pngs = new Map();
for (const size of sizes) {
  const png = await sharp(source, { density: 192 }).resize(size, size).png().toBuffer();
  pngs.set(size, png);
  await writeFile(join(assets, `download-helper-${size}.png`), png);
  if ([16, 32, 48, 128].includes(size)) await writeFile(join(extension, `icon-${size}.png`), png);
}
// Windows supports PNG-compressed ICO entries, including the 256px image.
const icoSizes = sizes.filter(size => size <= 256);
const header = Buffer.alloc(6 + 16 * icoSizes.length);
header.writeUInt16LE(1, 2); header.writeUInt16LE(icoSizes.length, 4);
let offset = header.length;
icoSizes.forEach((size, index) => {
  const at = 6 + index * 16, png = pngs.get(size);
  header[at] = header[at + 1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(png.length, at + 8); header.writeUInt32LE(offset, at + 12);
  offset += png.length;
});
await writeFile(join(assets, "download-helper.ico"), Buffer.concat([header, ...icoSizes.map(size => pngs.get(size))]));
if (process.platform !== "darwin") throw new Error("PNG/ICO generated; run on macOS to regenerate the ICNS with iconutil.");
const temporary = await mkdtemp(join(tmpdir(), "qdm-icons-"));
try {
  const iconset = join(temporary, "download-helper.iconset");
  await mkdir(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) await copyFile(join(assets, `download-helper-${size * scale}.png`),
      join(iconset, `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`));
  }
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", join(assets, "download-helper.icns")]);
} finally { await rm(temporary, { recursive: true, force: true }); }
console.log("Generated Qt, macOS, Windows, and Chrome icons from download-helper.svg");
