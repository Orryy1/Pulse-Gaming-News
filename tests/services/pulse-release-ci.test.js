"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOW = path.join(ROOT, ".github", "workflows", "pulse-release.yml");

test("Pulse release workflow enforces lockfile install, tests, build and redacted secret scan", () => {
  const yaml = fs.readFileSync(WORKFLOW, "utf8");

  assert.match(yaml, /permissions:\s*\n\s+contents:\s+read/);
  assert.match(yaml, /pull_request:/);
  assert.match(yaml, /push:/);
  assert.match(yaml, /release\/pulse-v1/);
  assert.match(
    yaml,
    /uses:\s+actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\s+# v7\.0\.1/,
  );
  assert.match(
    yaml,
    /uses:\s+actions\/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e\s+# v6\.4\.0/,
  );
  assert.match(yaml, /node-version:\s+24/);
  assert.match(yaml, /run:\s+npm ci/);
  assert.match(
    yaml,
    /run:\s+node --test tests\/services\/report-governance\.test\.js tests\/services\/ci-secret-scan\.test\.js/,
  );
  assert.match(yaml, /run:\s+node tools\/ci-secret-scan\.js/);
  assert.match(yaml, /run:\s+npm test/);
  assert.match(yaml, /run:\s+npm run build/);
  assert.doesNotMatch(yaml, /\$\{\{\s*secrets\./);
});
