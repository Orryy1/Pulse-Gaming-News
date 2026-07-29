"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  ATTRIBUTION_TEXT,
  validateGovernedSourceMediaManifest,
} = require("../../lib/services/governed-source-media");

const STORY_ID = "official_d86953ca92ca";
const ROOT = path.resolve(__dirname, "..", "..");

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

test("validates the exact Evercold source-media manifest and all seven local assets", (t) => {
  const manifestPath = path.resolve(
    __dirname,
    "../../videos/evercold-bastion-short/source-media-manifest.json",
  );
  const officialAssetDir = path.join(
    path.dirname(manifestPath),
    "assets",
    "official",
  );
  if (!fs.existsSync(officialAssetDir)) {
    t.skip(
      "ephemeral official media is absent; the release gate acquires and validates it explicitly",
    );
    return;
  }
  const manifestBytes = fs.readFileSync(manifestPath);

  const result = validateGovernedSourceMediaManifest({
    manifestPath,
    expectedManifestSha256: sha256(manifestBytes),
    expectedStoryId: STORY_ID,
    compositionDurationSeconds: 28,
    validationBoundaryAt: new Date().toISOString(),
  });

  assert.equal(result.story_id, STORY_ID);
  assert.equal(result.composition_duration_seconds, 28);
  assert.equal(result.components.length, 7);
  assert.equal(
    result.rights_review.evidence.findings.copyright_notice,
    ATTRIBUTION_TEXT,
  );
  for (const component of result.components) {
    assert.equal(component.media_type, "IMAGE");
    assert.equal(component.asset.mime_type, "image/jpeg");
    assert.ok(component.asset.width > 0);
    assert.ok(component.asset.height > 0);
    assert.ok(component.editorial.usage_seconds[0] >= 0);
    assert.ok(component.editorial.usage_seconds[1] <= 28);
  }
});

test("raw official media can never become a tracked release artefact", () => {
  const tracked = spawnSync(
    "git",
    [
      "ls-files",
      "-z",
      "--",
      "videos/evercold-bastion-short/assets/official",
    ],
    {
      cwd: ROOT,
      encoding: "buffer",
      windowsHide: true,
    },
  );
  assert.equal(
    tracked.status,
    0,
    tracked.stderr?.toString("utf8"),
  );
  assert.equal(
    tracked.stdout.length,
    0,
    "raw official media must remain ephemeral and untracked",
  );
});
