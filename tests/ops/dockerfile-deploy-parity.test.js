"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DOCKERFILE = fs.readFileSync(
  path.join(__dirname, "..", "..", "Dockerfile"),
  "utf8",
);

test("Dockerfile builds the Vite dashboard for Railway deployments", () => {
  const copySourceIndex = DOCKERFILE.indexOf("COPY . .");
  const buildIndex = DOCKERFILE.indexOf("npm run build");

  assert.notEqual(copySourceIndex, -1, "Dockerfile must copy source files");
  assert.notEqual(buildIndex, -1, "Dockerfile must run npm run build");
  assert.ok(
    buildIndex > copySourceIndex,
    "npm run build must run after source files are copied so dist/ is generated from the deployed commit",
  );
  assert.doesNotMatch(
    DOCKERFILE,
    /npm\s+install\s+--omit=dev/,
    "Vite lives in devDependencies, so the Dockerfile must not omit dev dependencies before npm run build",
  );
});

test("Dockerfile prunes dev dependencies after dashboard build", () => {
  const buildIndex = DOCKERFILE.indexOf("npm run build");
  const pruneIndex = DOCKERFILE.indexOf("npm prune --omit=dev");

  assert.notEqual(pruneIndex, -1, "Dockerfile should prune dev dependencies after building");
  assert.ok(
    pruneIndex > buildIndex,
    "npm prune --omit=dev must happen after npm run build",
  );
});
