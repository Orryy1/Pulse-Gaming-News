"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { runSecretScan } = require("../../tools/ci-secret-scan");

test("CI secret scan fails closed and never returns a possible credential value", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-ci-secret-scan-"));
  await fs.mkdir(path.join(root, "lib"), { recursive: true });
  await fs.writeFile(
    path.join(root, "lib", "safe.js"),
    "module.exports = { mode: 'LOCAL_PROOF' };\n",
  );

  const clean = await runSecretScan({
    workspaceRoot: root,
    sourceRoots: ["lib"],
  });
  assert.equal(clean.ok, true);
  assert.equal(clean.finding_count, 0);

  const syntheticValue = "noncredential-sentinel-abcdefghijklmnopqrst";
  await fs.writeFile(
    path.join(root, "lib", "unsafe.js"),
    `const token = '${syntheticValue}';\n`,
  );

  const blocked = await runSecretScan({
    workspaceRoot: root,
    sourceRoots: ["lib"],
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.finding_count, 1);
  assert.deepEqual(blocked.findings, [
    {
      file: "lib/unsafe.js",
      line: 1,
      kind: "hardcoded_token",
      severity: "high",
    },
  ]);
  assert.doesNotMatch(JSON.stringify(blocked), new RegExp(syntheticValue));
});
