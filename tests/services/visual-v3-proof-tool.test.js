"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");

test("Visual V3 proof tool is registered as render-only", () => {
  const pkg = require("../../package.json");
  const src = fs.readFileSync(
    path.join(ROOT, "tools", "visual-v3-proof.js"),
    "utf8",
  );

  assert.equal(pkg.scripts["studio:v3:proof"], "node tools/visual-v3-proof.js");
  assert.equal(pkg.scripts["studio:v3:still-deck"], "node tools/studio-v3-still-deck.js");
  assert.match(src, /buildVisualV3OverlayPlan/);
  assert.match(src, /buildVisualV3OverlayFilter/);
  assert.match(src, /No DB rows, tokens, OAuth settings or platform posts are mutated/);
  assert.doesNotMatch(src, /\.saveStories|UPDATE\s+stories|INSERT\s+INTO\s+stories/i);
});

test("Visual V3 still-deck runner enables local-only V3 overlays", () => {
  const src = fs.readFileSync(
    path.join(ROOT, "tools", "studio-v3-still-deck.js"),
    "utf8",
  );

  assert.match(src, /asset-acquisition-pro\.js/);
  assert.match(src, /studio-v2-still-deck-ingestion\.js/);
  assert.match(src, /--visual-v3/);
  assert.match(src, /--use-official-trailer-clips/);
  assert.match(src, /STUDIO_V3_VISUALS/);
  assert.match(src, /It does not[\s\S]*publish, mutate OAuth, write production DB rows or change scheduler state/);
});

test("Visual V3 still-deck runner refreshes official-only motion before render", () => {
  const src = fs.readFileSync(
    path.join(ROOT, "tools", "studio-v3-still-deck.js"),
    "utf8",
  );

  assert.match(src, /--no-motion-refresh/);
  assert.match(src, /function refreshOfficialMotionInventory/);
  assert.match(src, /function refreshTrustedFootageRegistry/);
  assert.match(src, /trusted-footage-registry\.js/);
  assert.match(src, /--trusted-footage-registry-report/);
  assert.match(src, /official-trailer-reference-resolver\.js/);
  assert.match(src, /controlled-frame-extraction-plan\.js/);
  assert.match(src, /controlled-frame-extraction-worker\.js/);
  assert.match(src, /official-trailer-segment-validator\.js/);
  assert.match(src, /--deep-scan/);
  assert.match(src, /--include-frame-anchored-windows/);
  assert.match(src, /--candidate-windows-per-source",\s*"8"/);
  assert.match(src, /Array\.from\(\s*\{\s*length:\s*58\s*\}/);
  assert.match(src, /--merge-previous/);
  assert.doesNotMatch(src, /--allow-unvalidated-official-clips/);
});
