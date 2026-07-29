"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  createGovernedAutonomousDatabaseStoryBinding,
  validateGovernedAutonomousDatabaseStoryBinding,
} = require("../../lib/services/governed-autonomous-database-story-binding");
const {
  canonicalHash,
} = require("../../lib/services/url-canonical");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fixture() {
  const canonicalIdentityUrl =
    "https://news.xbox.com/en-us/2026/07/30/classics-return/";
  return createGovernedAutonomousDatabaseStoryBinding({
    canonical_story_id:
      `official_${canonicalHash(canonicalIdentityUrl)}`,
    database_story_id: "rss_xbox_classics_return",
    canonical_identity_url: canonicalIdentityUrl,
    inventory_file_sha256: sha256("inventory"),
    final_script_sha256: sha256("script"),
  });
}

test("creates one immutable canonical-to-database binding over the SHA-verified inventory and script", () => {
  const binding = fixture();
  assert.deepEqual(
    validateGovernedAutonomousDatabaseStoryBinding(binding),
    binding,
  );
  assert.equal(binding.database_story_id, "rss_xbox_classics_return");
  assert.match(binding.binding_sha256, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(binding), true);
});

test("rejects canonical identity, inventory, script and binding hash drift", () => {
  for (const [field, value] of [
    ["canonical_story_id", "official_000000000000"],
    ["inventory_file_sha256", sha256("different-inventory")],
    ["final_script_sha256", sha256("different-script")],
    ["binding_sha256", sha256("fabricated-binding")],
  ]) {
    const tampered = { ...fixture(), [field]: value };
    assert.throws(
      () =>
        validateGovernedAutonomousDatabaseStoryBinding(tampered),
      (error) =>
        error?.name ===
        "GovernedAutonomousDatabaseStoryBindingError",
    );
  }
});
