"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "..", "..", "server.js"),
  "utf8",
);

test("public legal pages use the Pulse Gaming News identity", () => {
  assert.match(source, /Terms of Service - Pulse Gaming News/);
  assert.match(source, /Privacy Policy - Pulse Gaming News/);
  assert.match(source, /Data Deletion Instructions - Pulse Gaming News/);
  assert.doesNotMatch(source, /title>[^<]+ - Pulse Gaming<\/title>/);
});

test("public legal copy does not claim broad autonomous cross-platform publishing", () => {
  assert.doesNotMatch(
    source,
    /provides automated gaming news content across YouTube, TikTok and Instagram/i,
  );
  assert.match(
    source,
    /publishes reviewed gaming news, primarily on YouTube/i,
  );
});
