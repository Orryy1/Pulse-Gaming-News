"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("story-specific HyperFrames cards validate before render", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "studio-v2-build-story-cards.js"),
    "utf8",
  );
  const match = source.match(
    /async function renderCard[\s\S]*?async function buildStoryCards/,
  );

  assert.ok(match, "renderCard block should exist");
  const body = match[0];
  const lintIndex = body.indexOf('runHyperframes(["lint"], projectDir)');
  const validateIndex = body.indexOf('runHyperframes(["validate"], projectDir)');
  const inspectIndex = body.indexOf('["inspect", ".", "--samples", "3"');
  const renderIndex = body.indexOf('["render", ".", "-o", outPath');
  const shellIndex = body.indexOf("writeHyperframesPremiumShellEvidence");

  assert.ok(lintIndex >= 0, "HyperFrames lint must run");
  assert.ok(validateIndex >= 0, "HyperFrames validate must run");
  assert.ok(inspectIndex >= 0, "HyperFrames inspect must run");
  assert.ok(renderIndex >= 0, "HyperFrames render must run");
  assert.ok(shellIndex >= 0, "premium shell evidence must be written");
  assert.ok(lintIndex < validateIndex, "validate must run after lint");
  assert.ok(validateIndex < inspectIndex, "inspect must run after validate");
  assert.ok(inspectIndex < renderIndex, "inspect must run before render");
  assert.ok(renderIndex < shellIndex, "shell evidence must be written after render");
});
