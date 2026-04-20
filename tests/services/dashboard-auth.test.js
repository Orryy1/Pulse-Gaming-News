const { test, before } = require("node:test");
const assert = require("node:assert");

// Unit tests for the dashboard's pure auth helpers. These live in
// src/api/authCore.js as plain JS specifically so `node --test` can
// import them without a TypeScript loader — the browser-only wiring
// (localStorage, window.prompt, URL capture) is in auth.ts on top.
//
// Coverage targets the 2026-04-20 audit finding: the dashboard was
// shipping mutating requests without an Authorization header, so
// every approve/publish/retry button 401ed in production. The
// wrappers under test are what fix that.

// authCore ships as an ESM module (.mjs) because Vite/Rollup needs
// native `export`s to tree-shake it into the browser bundle. Node's
// test runner can still consume it — just via dynamic import rather
// than require.
let normaliseToken;
let buildAuthHeaders;
let redactToken;
let parseTokenFromUrl;
let isAuthError;

before(async () => {
  const mod = await import("../../src/api/authCore.mjs");
  normaliseToken = mod.normaliseToken;
  buildAuthHeaders = mod.buildAuthHeaders;
  redactToken = mod.redactToken;
  parseTokenFromUrl = mod.parseTokenFromUrl;
  isAuthError = mod.isAuthError;
});

// ---------- normaliseToken ----------

test("normaliseToken: rejects empty / whitespace / short junk", () => {
  assert.strictEqual(normaliseToken(""), null);
  assert.strictEqual(normaliseToken("   "), null);
  assert.strictEqual(normaliseToken("abc"), null); // under 8 chars
  assert.strictEqual(normaliseToken(undefined), null);
  assert.strictEqual(normaliseToken(null), null);
  assert.strictEqual(normaliseToken(12345), null); // not a string
});

test("normaliseToken: trims surrounding whitespace", () => {
  assert.strictEqual(
    normaliseToken("   tok_secretvalue123   "),
    "tok_secretvalue123",
  );
});

test("normaliseToken: strips an accidentally-pasted 'Bearer ' prefix", () => {
  assert.strictEqual(
    normaliseToken("Bearer tok_secretvalue123"),
    "tok_secretvalue123",
  );
  assert.strictEqual(
    normaliseToken("bearer tok_secretvalue123"),
    "tok_secretvalue123",
  );
});

test("normaliseToken: strips a full 'Authorization: Bearer …' header copy-paste", () => {
  assert.strictEqual(
    normaliseToken("Authorization: Bearer tok_secretvalue123"),
    "tok_secretvalue123",
  );
});

test("normaliseToken: accepts realistic token shapes untouched", () => {
  const t = "pulse_prod_aV3xK9mQ2nP7rT5uW8yB1cD4fH6jL0oS";
  assert.strictEqual(normaliseToken(t), t);
});

// ---------- buildAuthHeaders ----------

test("buildAuthHeaders: attaches Bearer Authorization when token is present", () => {
  const h = buildAuthHeaders(
    { "Content-Type": "application/json" },
    "tok_secretvalue123",
  );
  assert.strictEqual(h.Authorization, "Bearer tok_secretvalue123");
  assert.strictEqual(h["Content-Type"], "application/json");
});

test("buildAuthHeaders: omits Authorization when token is missing", () => {
  // This is the behaviour that `apiGet` relies on — public endpoints
  // MUST NOT send the header unsolicited. If this regresses, logged-
  // out anonymous reads would suddenly require a token.
  const h = buildAuthHeaders({ "Content-Type": "application/json" }, null);
  assert.strictEqual(h.Authorization, undefined);
  assert.strictEqual(h["Content-Type"], "application/json");

  const h2 = buildAuthHeaders({ "Content-Type": "application/json" }, "");
  assert.strictEqual(h2.Authorization, undefined);
});

test("buildAuthHeaders: does not mutate the caller's headers object", () => {
  const caller = { "Content-Type": "application/json" };
  const snapshot = JSON.stringify(caller);
  buildAuthHeaders(caller, "tok_secretvalue123");
  assert.strictEqual(JSON.stringify(caller), snapshot);
});

test("buildAuthHeaders: tolerates an undefined base headers object", () => {
  const h = buildAuthHeaders(undefined, "tok_secretvalue123");
  assert.strictEqual(h.Authorization, "Bearer tok_secretvalue123");
});

// ---------- redactToken ----------

test("redactToken: masks 'Bearer <value>' sequences in error messages", () => {
  const cleaned = redactToken(
    "fetch failed: Bearer tok_secretvalue123 rejected",
    null,
  );
  assert.strictEqual(cleaned.includes("tok_secretvalue123"), false);
  assert.match(cleaned, /Bearer <redacted>/);
});

test("redactToken: masks a bare copy of the live token", () => {
  // Some libraries stringify the whole request including the auth
  // header into their error message without the "Bearer " prefix.
  const cleaned = redactToken(
    "401 — offending request auth=tok_secretvalue123",
    "tok_secretvalue123",
  );
  assert.strictEqual(cleaned.includes("tok_secretvalue123"), false);
  assert.match(cleaned, /<redacted>/);
});

test("redactToken: leaves regex-metachar-containing tokens harmless", () => {
  // A token with regex metacharacters would blow up if we didn't
  // escape before building the regex. This guards against a
  // "Invalid regular expression" crash in an already-unhappy path.
  const token = "tok.secret+value?123";
  const cleaned = redactToken(`payload contains ${token} here`, token);
  assert.strictEqual(cleaned.includes(token), false);
});

test("redactToken: is a safe no-op on empty / non-string input", () => {
  assert.strictEqual(redactToken("", "tok"), "");
  assert.strictEqual(redactToken(null, "tok"), "");
  assert.strictEqual(redactToken(undefined, "tok"), "");
});

test("redactToken: does not over-redact short tokens (<8 chars)", () => {
  // An 8-char lower bound prevents 3-letter tokens from redacting
  // every occurrence of "the" in an error message. Short tokens
  // should already have been rejected by normaliseToken, but belt-
  // and-braces.
  const cleaned = redactToken("the quick brown fox", "the");
  assert.strictEqual(cleaned, "the quick brown fox");
});

// ---------- parseTokenFromUrl ----------

test("parseTokenFromUrl: extracts ?token=… from the current URL", () => {
  const t = parseTokenFromUrl(
    "https://pulse.example/?highlight=1sxyz&token=tok_secretvalue123",
  );
  assert.strictEqual(t, "tok_secretvalue123");
});

test("parseTokenFromUrl: returns null when no token param is present", () => {
  assert.strictEqual(
    parseTokenFromUrl("https://pulse.example/?highlight=1sxyz"),
    null,
  );
});

test("parseTokenFromUrl: returns null for malformed URL input", () => {
  assert.strictEqual(parseTokenFromUrl("not a url"), null);
  assert.strictEqual(parseTokenFromUrl(""), null);
  assert.strictEqual(parseTokenFromUrl(null), null);
});

test("parseTokenFromUrl: rejects a too-short URL token (same rule as direct input)", () => {
  assert.strictEqual(parseTokenFromUrl("https://pulse.example/?token=x"), null);
});

// ---------- isAuthError ----------

test("isAuthError: true for 401, false for everything else", () => {
  assert.strictEqual(isAuthError({ status: 401 }), true);
  assert.strictEqual(isAuthError({ status: 200 }), false);
  assert.strictEqual(isAuthError({ status: 403 }), false);
  assert.strictEqual(isAuthError({ status: 500 }), false);
  assert.strictEqual(isAuthError(null), false);
  assert.strictEqual(isAuthError(undefined), false);
});
