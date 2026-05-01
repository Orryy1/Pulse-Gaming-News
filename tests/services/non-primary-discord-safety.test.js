"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SERVER_PATH = path.resolve(__dirname, "..", "..", "server.js");
const src = fs.readFileSync(SERVER_PATH, "utf8");

test("server.js: non-primary mirrors skip Discord startup side effects", () => {
  assert.match(src, /const\s+\{\s*isPrimary\s*\}\s*=\s*require\("\.\/lib\/deployment-mode"\)/);
  assert.match(src, /const\s+primaryInstance\s*=\s*isPrimary\(\)/);
  assert.match(src, /buildStartupDeployNotification/);
  assert.match(src, /primaryInstance,\s*\}\)/);
  assert.match(src, /Discord deploy notification skipped - \$\{notification\.reason\}/);
  assert.match(src, /Discord bot skipped - non-primary mirror/);
  assert.match(
    src,
    /if\s*\(\s*!notification\.send\s*\)\s*\{[\s\S]*return;[\s\S]*\}[\s\S]*sendDiscord\(notification\.message\)/,
  );
  assert.match(
    src,
    /if\s*\(\s*!primaryInstance\s*\)\s*\{[\s\S]*Discord bot skipped - non-primary mirror[\s\S]*\}\s*else\s+if\s*\(/,
  );
});
