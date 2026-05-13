"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const MAIN_PATH = path.join(ROOT, "src", "main.tsx");
const BOUNDARY_PATH = path.join(ROOT, "src", "components", "AppErrorBoundary.tsx");

test("React dashboard root is wrapped in an app-level error boundary", () => {
  const main = fs.readFileSync(MAIN_PATH, "utf8");

  assert.match(main, /import\s+AppErrorBoundary\s+from\s+['"]\.\/components\/AppErrorBoundary['"]/);
  assert.match(main, /<AppErrorBoundary>\s*<App\s*\/>\s*<\/AppErrorBoundary>/s);
});

test("AppErrorBoundary catches render crashes and presents an operator recovery UI", () => {
  assert.equal(fs.existsSync(BOUNDARY_PATH), true);

  const source = fs.readFileSync(BOUNDARY_PATH, "utf8");
  assert.match(source, /class\s+AppErrorBoundary\s+extends\s+Component/);
  assert.match(source, /static\s+getDerivedStateFromError/);
  assert.match(source, /componentDidCatch/);
  assert.match(source, /Dashboard render failed/);
  assert.match(source, /Reload dashboard/);
  assert.match(source, /does not include tokens or secrets/);
});
