"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..", "..");
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "output",
  "snapshots",
  "test",
  "tests",
  "videos",
]);

function javascriptFiles(dir = ROOT) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...javascriptFiles(absolute));
    else if (entry.isFile() && /\.(?:c?js|mjs)$/i.test(entry.name)) files.push(absolute);
  }
  return files;
}

test("runtime and operator code never lets dotenv overwrite inherited environment", () => {
  const unsafe = javascriptFiles()
    .filter((file) =>
      /override\s*:\s*true/.test(fs.readFileSync(file, "utf8")),
    )
    .map((file) => path.relative(ROOT, file).replaceAll("\\", "/"))
    .sort();

  assert.deepEqual(unsafe, []);
});
