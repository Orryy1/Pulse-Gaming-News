"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ASSEMBLE_CODE = fs.readFileSync(
  path.resolve(__dirname, "..", "..", "assemble.js"),
  "utf8",
);

test("assemble.js centres wide still images before Ken Burns motion", () => {
  assert.match(
    ASSEMBLE_CODE,
    /crop=1080:1920:\(iw-ow\)\/2:/,
    "wide still images must not start from x=0 because that can crop to a black edge",
  );
});

test("assemble.js does not use far-left x=0 crop for still image segments", () => {
  assert.doesNotMatch(
    ASSEMBLE_CODE,
    /crop=1080:1920:0:\$\{i % 3 === 0/,
    "legacy still segments should centre-crop horizontally before pan/zoom",
  );
});
