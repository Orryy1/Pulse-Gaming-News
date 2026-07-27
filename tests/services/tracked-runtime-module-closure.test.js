"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");

function trackedPaths() {
  return new Set(
    execFileSync("git", ["ls-files", "--cached", "-z"], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .split("\0")
      .filter(Boolean)
      .map((filePath) => filePath.replace(/\\/g, "/")),
  );
}

function resolveRelativeModule(fromPath, specifier) {
  const base = path.resolve(path.dirname(fromPath), specifier);
  const candidates = [
    `${base}.js`,
    `${base}.cjs`,
    `${base}.mjs`,
    `${base}.json`,
    path.join(base, "index.js"),
    base,
  ];
  return candidates.find((candidate) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

test("tracked production code has a tracked relative-module closure", () => {
  const tracked = trackedPaths();
  const productionFiles = [...tracked].filter(
    (filePath) =>
      /\.(?:js|cjs|mjs)$/.test(filePath) &&
      !filePath.startsWith("test/") &&
      !filePath.startsWith("tests/"),
  );
  const missing = [];
  const importPattern =
    /(?:require\s*\(|from\s+|import\s*\()\s*["'](\.{1,2}\/[^"']+)["']/g;

  for (const filePath of productionFiles) {
    const absolutePath = path.join(ROOT, filePath);
    const source = fs.readFileSync(absolutePath, "utf8");
    let match;
    while ((match = importPattern.exec(source))) {
      const resolved = resolveRelativeModule(absolutePath, match[1]);
      if (!resolved) continue;
      const relative = path.relative(ROOT, resolved).replace(/\\/g, "/");
      if (!tracked.has(relative)) {
        missing.push(`${filePath} -> ${relative}`);
      }
    }
  }

  assert.deepEqual(
    [...new Set(missing)].sort(),
    [],
    `tracked production imports resolve through untracked files:\n${missing.join("\n")}`,
  );
});

test("npm operator commands point to tracked entrypoints", () => {
  const tracked = trackedPaths();
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
  );
  const missing = [];

  for (const [name, command] of Object.entries(packageJson.scripts || {})) {
    const match = String(command).match(
      /\bnode\s+(["']?)([^\s"']+\.(?:js|cjs|mjs))\1/,
    );
    if (!match) continue;
    const target = match[2].replace(/\\/g, "/");
    if (fs.existsSync(path.join(ROOT, target)) && !tracked.has(target)) {
      missing.push(`${name} -> ${target}`);
    }
  }

  assert.deepEqual(
    missing.sort(),
    [],
    `npm scripts reference untracked entrypoints:\n${missing.join("\n")}`,
  );
});
