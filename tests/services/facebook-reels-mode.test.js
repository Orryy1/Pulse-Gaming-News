"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { resolveFacebookReelsMode } = require("../../lib/platforms/facebook-reels-mode");
const { buildPlatformOperationalConfig } = require("../../lib/ops/platform-status");

test("Facebook Reels mode defaults to enabled after manual + Graph proof", () => {
  const mode = resolveFacebookReelsMode({});
  assert.equal(mode.enabled, true);
  assert.equal(mode.state, "enabled");
  assert.equal(mode.reason, "facebook_reels_default_enabled");
});

test("Facebook Reels mode keeps an explicit operator kill switch", () => {
  for (const value of ["false", "0", "no", "off", " FALSE "]) {
    const mode = resolveFacebookReelsMode({ FACEBOOK_REELS_ENABLED: value });
    assert.equal(mode.enabled, false);
    assert.equal(mode.state, "disabled");
    assert.equal(mode.reason, "facebook_reels_operator_disabled");
  }
});

test("Facebook Reels mode accepts explicit enable values", () => {
  for (const value of ["true", "1", "yes", "on", " TRUE "]) {
    const mode = resolveFacebookReelsMode({ FACEBOOK_REELS_ENABLED: value });
    assert.equal(mode.enabled, true);
    assert.equal(mode.state, "enabled");
    assert.equal(mode.reason, "facebook_reels_enabled");
  }
});

test("Facebook Reels mode disables invalid flag values instead of guessing", () => {
  const mode = resolveFacebookReelsMode({ FACEBOOK_REELS_ENABLED: "maybe" });
  assert.equal(mode.enabled, false);
  assert.equal(mode.state, "disabled");
  assert.equal(mode.reason, "facebook_reels_invalid_flag");
});

test("platform operational config reports default-enabled Facebook Reels", () => {
  const config = buildPlatformOperationalConfig({});
  assert.deepEqual(config.facebook_reel, {
    state: "enabled",
    reason: "facebook_reels_default_enabled",
  });
});

test("publisher uses Facebook Reels mode helper, not a true-only gate", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "publisher.js"),
    "utf8",
  );
  assert.match(src, /resolveFacebookReelsMode\(process\.env\)/);
  assert.doesNotMatch(src, /FACEBOOK_REELS_ENABLED\s*===\s*"true"/);
});
