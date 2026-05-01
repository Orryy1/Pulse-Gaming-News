"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  DEFAULT_TOKEN_DIR,
  resolveTokenDir,
  resolveFacebookTokenPath,
  resolveInstagramTokenPath,
} = require("../../lib/token-paths");

test("resolveTokenDir: defaults to repo tokens directory", () => {
  assert.equal(resolveTokenDir({}), DEFAULT_TOKEN_DIR);
});

test("resolveTokenDir: PULSE_TOKEN_DIR wins", () => {
  assert.equal(resolveTokenDir({ PULSE_TOKEN_DIR: "D:/pulse-data/tokens" }), "D:/pulse-data/tokens");
});

test("resolveFacebookTokenPath: uses shared persistent token dir", () => {
  assert.equal(
    resolveFacebookTokenPath({ PULSE_TOKEN_DIR: "D:/pulse-data/tokens" }),
    path.join("D:/pulse-data/tokens", "facebook_token.json"),
  );
});

test("resolveInstagramTokenPath: specific override wins over shared dir", () => {
  assert.equal(
    resolveInstagramTokenPath({
      PULSE_TOKEN_DIR: "D:/pulse-data/tokens",
      INSTAGRAM_TOKEN_PATH: "E:/custom/instagram_token.json",
    }),
    "E:/custom/instagram_token.json",
  );
});
