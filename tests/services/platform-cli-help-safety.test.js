"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..", "..");

async function runGuardedHelp(toolPath) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cli-help-"));
  const preloadPath = path.join(tempDir, "side-effect-guard.cjs");
  await fs.writeFile(
    preloadPath,
    [
      '"use strict";',
      'const Module = require("node:module");',
      "const originalLoad = Module._load;",
      "const blocked = new Set([",
      '  "dotenv",',
      '  "../lib/db",',
      '  "../upload_tiktok",',
      "]);",
      "Module._load = function guardedLoad(request, parent, isMain) {",
      "  if (blocked.has(request)) {",
      '    throw new Error(`HELP_SIDE_EFFECT:${request}`);',
      "  }",
      "  return originalLoad.call(this, request, parent, isMain);",
      "};",
      "",
    ].join("\n"),
    "utf8",
  );

  return spawnSync(
    process.execPath,
    ["--require", preloadPath, path.resolve(ROOT, toolPath), "--help"],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env },
      timeout: 15_000,
    },
  );
}

for (const [name, toolPath] of [
  ["platform status", "tools/platform-status.js"],
  ["platform readiness doctor", "tools/platform-readiness-doctor.js"],
]) {
  test(`${name} help exits before loading credentials, DB or token code`, async () => {
    const result = await runGuardedHelp(toolPath);
    const output = `${result.stdout || ""}\n${result.stderr || ""}`;

    assert.equal(result.status, 0, output);
    assert.match(result.stdout, /^Usage:/m);
    assert.doesNotMatch(output, /HELP_SIDE_EFFECT:/);
    assert.doesNotMatch(output, /\[db\] opened SQLite/);
  });
}
