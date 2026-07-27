"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const PROTOTYPES = [
  path.join(ROOT, "tools", "quality-prototype.js"),
  path.join(ROOT, "tools", "studio-prototype.js"),
];

test("legacy render prototypes are explicit migration-only tools with publishing disabled", () => {
  for (const file of PROTOTYPES) {
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /PULSE_ENABLE_MIGRATION_ONLY_PROTOTYPE/);
    assert.match(source, /production_publish_allowed:\s*false/);
    assert.match(source, /migration_only:\s*true/);
  }
});

test("legacy prototypes and their takeaway template have no generic follow fallback", () => {
  const sources = [
    ...PROTOTYPES.map((file) => fs.readFileSync(file, "utf8")),
    fs.readFileSync(
      path.join(ROOT, "experiments", "hf-takeaway", "index.html"),
      "utf8",
    ),
  ].join("\n");

  assert.doesNotMatch(
    sources,
    /FOLLOW FOR MORE|FOLLOW PULSE GAMING|never miss a beat/i,
  );
});
