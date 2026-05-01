"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

test("public URL switch: local mode prefers LOCAL_PUBLIC_URL over Railway URL", () => {
  const dm = require("../../lib/deployment-mode");
  assert.equal(
    dm.getPublicUrl({
      DEPLOYMENT_MODE: "local",
      LOCAL_PUBLIC_URL: "https://pulse-local.example",
      RAILWAY_PUBLIC_URL: "https://railway.example",
    }),
    "https://pulse-local.example",
  );
});

test("public URL switch: OAuth and media-fetch paths use deployment-mode URL helper", () => {
  const files = [
    "server.js",
    "upload_tiktok.js",
    "upload_instagram.js",
    "upload_facebook.js",
    "publisher.js",
    path.join("lib", "job-handlers.js"),
  ];

  for (const file of files) {
    const src = read(file);
    assert.match(src, /getPublicUrl/);
    assert.doesNotMatch(src, /marvelous-curiosity-production\.up\.railway\.app/);
  }
});
