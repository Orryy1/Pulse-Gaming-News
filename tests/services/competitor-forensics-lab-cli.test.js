"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { parseArgs, usage } = require("../../tools/competitor-forensics-lab");

test("competitor forensics lab CLI parses safe local-proof paths", () => {
  const args = parseArgs([
    "--registry", "test/fixtures/competitors.json",
    "--metadata", "test/fixtures/videos.json",
    "--out-dir", "test/output/competitor-lab",
    "--generated-at", "2026-06-07T12:00:00.000Z",
    "--json",
  ]);

  assert.equal(args.registryPath, "test/fixtures/competitors.json");
  assert.equal(args.metadataPath, "test/fixtures/videos.json");
  assert.equal(args.outDir, "test/output/competitor-lab");
  assert.equal(args.generatedAt, "2026-06-07T12:00:00.000Z");
  assert.equal(args.json, true);
});

test("competitor forensics lab CLI usage documents safety limits", () => {
  assert.match(usage(), /does not download competitor videos/i);
  assert.match(usage(), /does not publish/i);
});
