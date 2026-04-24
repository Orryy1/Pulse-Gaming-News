/**
 * tests/services/tiktok-privacy-level.test.js
 *
 * 2026-04-24 — pin the TIKTOK_PRIVACY_LEVEL env-var contract added
 * to upload_tiktok.js after today's live probe confirmed the 403
 * failures are caused by
 *   error code: `unaudited_client_can_only_post_to_private_accounts`
 *
 * The 403 is app-level (the Pulse Gaming app is awaiting TikTok's
 * Content Posting API audit). While audit is pending, setting
 * `TIKTOK_PRIVACY_LEVEL=SELF_ONLY` in the Railway env lets TikTok
 * uploads complete — as private drafts visible only to the
 * creator. Useful for smoke-testing and for letting the operator
 * manually publish good content from the TikTok app.
 *
 * Contract:
 *   - Unset / empty      → PUBLIC_TO_EVERYONE (default, post-audit goal)
 *   - Valid TikTok value → that value
 *   - Unknown / typo     → fall back to default + log a warning
 *   - Case-insensitive   → "self_only" and "SELF_ONLY" both resolve
 *
 * Tests drive the resolver directly + pin the source-scan invariants
 * so the privacy_level isn't silently re-hardcoded in a future edit.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Clean re-import each test so process.env changes take effect.
function loadTikTok() {
  delete require.cache[require.resolve("../../upload_tiktok.js")];
  return require("../../upload_tiktok.js");
}

test.beforeEach(() => {
  delete process.env.TIKTOK_PRIVACY_LEVEL;
});

test("resolveTikTokPrivacyLevel: defaults to PUBLIC_TO_EVERYONE when unset", () => {
  delete process.env.TIKTOK_PRIVACY_LEVEL;
  const { resolveTikTokPrivacyLevel } = loadTikTok();
  assert.equal(resolveTikTokPrivacyLevel(), "PUBLIC_TO_EVERYONE");
});

test("resolveTikTokPrivacyLevel: empty / whitespace → default", () => {
  const { resolveTikTokPrivacyLevel } = loadTikTok();
  for (const val of ["", "  ", "\t\n"]) {
    process.env.TIKTOK_PRIVACY_LEVEL = val;
    assert.equal(resolveTikTokPrivacyLevel(), "PUBLIC_TO_EVERYONE");
  }
});

test("resolveTikTokPrivacyLevel: SELF_ONLY honoured (audit-pending workaround)", () => {
  process.env.TIKTOK_PRIVACY_LEVEL = "SELF_ONLY";
  const { resolveTikTokPrivacyLevel } = loadTikTok();
  assert.equal(resolveTikTokPrivacyLevel(), "SELF_ONLY");
});

test("resolveTikTokPrivacyLevel: all TikTok-valid levels honoured", () => {
  const { resolveTikTokPrivacyLevel, TIKTOK_ALLOWED_PRIVACY_LEVELS } =
    loadTikTok();
  for (const lvl of TIKTOK_ALLOWED_PRIVACY_LEVELS) {
    process.env.TIKTOK_PRIVACY_LEVEL = lvl;
    assert.equal(resolveTikTokPrivacyLevel(), lvl);
  }
});

test("resolveTikTokPrivacyLevel: case-insensitive", () => {
  process.env.TIKTOK_PRIVACY_LEVEL = "self_only";
  const { resolveTikTokPrivacyLevel } = loadTikTok();
  assert.equal(resolveTikTokPrivacyLevel(), "SELF_ONLY");
});

test("resolveTikTokPrivacyLevel: unknown value falls back to default (not silently accepted)", () => {
  process.env.TIKTOK_PRIVACY_LEVEL = "FRIENDS_OF_FRIENDS_ONLY";
  const { resolveTikTokPrivacyLevel } = loadTikTok();
  assert.equal(resolveTikTokPrivacyLevel(), "PUBLIC_TO_EVERYONE");
});

test("resolveTikTokPrivacyLevel: injection attempt falls back safely", () => {
  // Defence: never use the raw env string verbatim in the API
  // payload. If the operator somehow sets something weird, the
  // resolver must normalise to a known-safe option.
  process.env.TIKTOK_PRIVACY_LEVEL = 'PUBLIC_TO_EVERYONE","injected":"yes';
  const { resolveTikTokPrivacyLevel } = loadTikTok();
  assert.equal(resolveTikTokPrivacyLevel(), "PUBLIC_TO_EVERYONE");
});

test("TIKTOK_ALLOWED_PRIVACY_LEVELS: covers the 4 TikTok-documented options", () => {
  const { TIKTOK_ALLOWED_PRIVACY_LEVELS } = loadTikTok();
  for (const lvl of [
    "PUBLIC_TO_EVERYONE",
    "MUTUAL_FOLLOW_FRIENDS",
    "FOLLOWER_OF_CREATOR",
    "SELF_ONLY",
  ]) {
    assert.ok(
      TIKTOK_ALLOWED_PRIVACY_LEVELS.has(lvl),
      `expected ${lvl} in the allow-list`,
    );
  }
});

test("TIKTOK_DEFAULT_PRIVACY_LEVEL is PUBLIC_TO_EVERYONE (post-audit goal)", () => {
  const { TIKTOK_DEFAULT_PRIVACY_LEVEL } = loadTikTok();
  assert.equal(TIKTOK_DEFAULT_PRIVACY_LEVEL, "PUBLIC_TO_EVERYONE");
});

// ---------- source-scan pins -----------------------------------

test("upload_tiktok.js: privacy_level comes from the resolver, not a hard-coded string (source-scan)", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "upload_tiktok.js"),
    "utf8",
  );
  // The init-request post_info block must call
  // `resolveTikTokPrivacyLevel()` — not a bare string literal.
  // If a future edit reverts to `privacy_level: "PUBLIC_TO_EVERYONE"`
  // hard-coded, this test catches it.
  const match = src.match(
    /post_info\s*:\s*\{[^}]*?privacy_level\s*:\s*([\s\S]+?),\s*disable_duet/,
  );
  assert.ok(match, "init request's post_info block must contain privacy_level");
  const privacyLevelValue = match[1];
  assert.ok(
    /resolveTikTokPrivacyLevel\(\)/.test(privacyLevelValue),
    `privacy_level must be computed from resolveTikTokPrivacyLevel(), got: ${privacyLevelValue.slice(0, 120)}`,
  );
});

test('upload_tiktok.js: no orphan `privacy_level: "PUBLIC_TO_EVERYONE"` literal in the request-building code (regression pin)', () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "upload_tiktok.js"),
    "utf8",
  );
  // Strip comments before checking so the doc-strings that explain
  // the old pattern don't trigger a false positive.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/([^:])\/\/[^\n]*/g, "$1");
  assert.doesNotMatch(
    code,
    /privacy_level\s*:\s*["']PUBLIC_TO_EVERYONE["']/,
    "No hard-coded privacy_level: 'PUBLIC_TO_EVERYONE' in upload_tiktok.js code — must go through resolveTikTokPrivacyLevel()",
  );
});
