"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const sharp = require("sharp");

const ROOT = path.resolve(__dirname, "..", "..");
const DESIGN_PATH = path.join(
  ROOT,
  "assets",
  "brand",
  "pulse-gaming-news-avatar-v1.design.json",
);
const SVG_PATH = path.join(
  ROOT,
  "assets",
  "brand",
  "pulse-gaming-news-avatar-v1.svg",
);

function sha256(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

test("Pulse avatar master is wordless, flat and uses only the governed palette", () => {
  const svg = fs.readFileSync(SVG_PATH, "utf8");
  assert.doesNotMatch(svg, /<(?:text|filter|linearGradient|radialGradient)\b/i);
  assert.match(svg, /#070707/);
  assert.match(svg, /#090909/);
  assert.match(svg, /#FF6B1A/i);
  assert.doesNotMatch(svg, /\b(?:glow|shadow|gradient)\b/i);
});

test("Pulse avatar evidence files are hash-bound and retain tiny-size proofs", async () => {
  const design = JSON.parse(fs.readFileSync(DESIGN_PATH, "utf8"));
  const keyedFiles = {
    master: design.files.master,
    preview_1024: design.files.preview_1024,
    proof_48: design.files.proof_48,
    proof_32: design.files.proof_32,
    proof_24: design.files.proof_24,
    proof_sheet: design.files.proof_sheet,
  };
  for (const [key, relativePath] of Object.entries(keyedFiles)) {
    const absolutePath = path.join(ROOT, relativePath);
    assert.equal(fs.existsSync(absolutePath), true, `missing ${relativePath}`);
    assert.equal(sha256(absolutePath), design.sha256[key]);
  }
  for (const size of [48, 32, 24]) {
    const metadata = await sharp(
      path.join(ROOT, design.files[`proof_${size}`]),
    ).metadata();
    assert.equal(metadata.width, size);
    assert.equal(metadata.height, size);
  }
  assert.equal(design.live_channel_changed, false);
});

test("Pulse avatar mark occupies the required 70–80 per cent of the circle", async () => {
  const { data, info } = await sharp(SVG_PATH)
    .resize(1024, 1024)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let maxX = -1;
  let minY = info.height;
  let maxY = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      if (red > 220 && green > 50 && green < 150 && blue < 60) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  assert.ok(maxX >= minX && maxY >= minY, "amber mark was not detected");
  const widthRatio = (maxX - minX + 1) / 1024;
  const heightRatio = (maxY - minY + 1) / 1024;
  assert.ok(widthRatio >= 0.7 && widthRatio <= 0.8, `${widthRatio}`);
  assert.ok(heightRatio >= 0.7 && heightRatio <= 0.8, `${heightRatio}`);
});
