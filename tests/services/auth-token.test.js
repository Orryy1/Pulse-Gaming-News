"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { extractBearerToken, tokenMatches } = require("../../lib/auth-token");

test("extractBearerToken accepts Bearer scheme case-insensitively", () => {
  assert.equal(extractBearerToken("Bearer tok_secret123"), "tok_secret123");
  assert.equal(extractBearerToken("bearer tok_secret123"), "tok_secret123");
});

test("extractBearerToken rejects non-Bearer headers", () => {
  assert.equal(extractBearerToken("Basic tok_secret123"), "");
  assert.equal(extractBearerToken("tok_secret123"), "");
  assert.equal(extractBearerToken(null), "");
});

test("tokenMatches requires non-empty strings and exact equality", () => {
  assert.equal(tokenMatches("tok_secret123", "tok_secret123"), true);
  assert.equal(tokenMatches("tok_secret123", "tok_secret124"), false);
  assert.equal(tokenMatches("", "tok_secret123"), false);
  assert.equal(tokenMatches("tok_secret123", ""), false);
  assert.equal(tokenMatches(null, "tok_secret123"), false);
});
