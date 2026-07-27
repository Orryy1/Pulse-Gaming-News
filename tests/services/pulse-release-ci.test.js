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
  assert.match(yaml, /node --test/);
  assert.match(yaml, /tests\/services\/report-governance\.test\.js/);
  assert.match(yaml, /tests\/services\/ci-secret-scan\.test\.js/);
  assert.match(yaml, /run:\s+node tools\/ci-secret-scan\.js/);
  assert.match(yaml, /run:\s+npm run ops:agent-rules/);
  assert.match(yaml, /run:\s+npm test/);
  assert.match(yaml, /run:\s+npm run build/);
  assert.doesNotMatch(yaml, /\$\{\{\s*secrets\./);

  const referencedTests = [
    ...yaml.matchAll(/tests\/(?:services|ops)\/[a-z0-9-]+\.test\.js/g),
  ].map((match) => match[0]);
  assert.ok(referencedTests.length > 0);
  for (const testPath of referencedTests) {
    assert.equal(
      fs.existsSync(path.join(ROOT, testPath)),
      true,
      `${testPath} must exist in a clean checkout`,
    );
  }
});

test("Pulse release workflow checks the nested HyperFrames material project", () => {
  const yaml = fs.readFileSync(WORKFLOW, "utf8");

  assert.match(
    yaml,
    /run:\s+npm --prefix videos\/evercold-bastion-short ci/,
  );
  assert.match(
    yaml,
    /run:\s+npm --prefix videos\/evercold-bastion-short run check -- --strict/,
  );
});

test("Pulse release workflow runs every governed service and ops test", () => {
  const yaml = fs.readFileSync(WORKFLOW, "utf8");
  const governedTests = [
    ...["services", "ops"].flatMap((area) => {
      const directory = path.join(ROOT, "tests", area);
      return fs
        .readdirSync(directory)
        .filter((name) => /^governed-.*\.test\.js$/.test(name))
        .map((name) => `tests/${area}/${name}`);
    }),
    "tests/services/guarded-youtube-window.test.js",
    "tests/ops/guarded-youtube-window-cli.test.js",
    "tests/services/platform-safe-zones.test.js",
    "tests/services/evercold-hyperframes-material.test.js",
    "tests/services/evercold-platform-safe-zone-runtime.test.js",
    "tests/ops/agent-operator-command-contract.test.js",
    "tests/services/agent-operating-rules.test.js",
  ];

  for (const testPath of governedTests) {
    assert.match(
      yaml,
      new RegExp(testPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${testPath} must run in the focused release gate`,
    );
  }
});
