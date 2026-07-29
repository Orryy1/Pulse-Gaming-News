"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  materializeGovernedLockedStoryIntakeFromInventory,
  materializeGovernedStoryIntakeFromLegacyPackage,
  materializeGovernedStoryIntakeFromInventory,
} = require("../../lib/services/governed-story-intake-inventory-bridge");
const {
  validateStoryIntakeManifest,
} = require("../../lib/services/governed-story-intake");
const {
  canonicalHash,
} = require("../../lib/services/url-canonical");
const {
  buildGovernedStoryIntakeInventoryBridgeFixture,
  buildLockedYazdInventoryFixture,
  buildYazdLegacyPackageFixture,
} = require("../fixtures/governed-story-intake-inventory-bridge");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

test("materialises a validator-compliant canonical intake from the exact READY breaking inventory", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-canonical-intake-bridge-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixture =
    await buildGovernedStoryIntakeInventoryBridgeFixture(root);

  const result = await materializeGovernedStoryIntakeFromInventory({
    inventoryPath: fixture.registryPath,
    inventoryFileSha256: fixture.registryFileSha256,
    inventoryRoot: fixture.inventoryRoot,
    allowedRoots: [fixture.outputRoot],
    experimentDimensions: {
      eligible: true,
      experiment_id: "pulse-v1-controlled-12",
      matrix_version: "pulse-controlled-12-v1",
      expected_cell_id: "what_changes_for_players:direct:short",
      topic: "backwards compatibility expansion",
      game: "Original Xbox catalogue",
      subject_platform: "Xbox",
    },
    outputDir: fixture.outputDir,
  });

  assert.equal(result.verdict, "VALID");
  assert.equal(result.publish_verdict, "HOLD");
  assert.equal(result.publish_authority_created, false);
  assert.equal(result.database_mutated, false);
  assert.equal(result.oauth_mutated, false);
  assert.equal(result.platform_contacted, false);

  const validation = validateStoryIntakeManifest({
    manifestPath: result.paths.story_intake,
  });
  const expectedStoryId =
    `official_${canonicalHash(fixture.officialUrl)}`;
  assert.equal(validation.storyId, expectedStoryId);
  assert.notEqual(validation.storyId, fixture.storyId);
  assert.equal(validation.wordCount, 37);
  assert.equal(
    validation.experimentDimensions?.expected_cell_id,
    "what_changes_for_players:direct:short",
  );
  assert.equal(
    validation.experimentDimensions?.subject_platform,
    "Xbox",
  );
  assert.ok(
    validation.manifest.claims.every(
      (claim) => typeof claim === "string",
    ),
  );
  assert.deepEqual(
    validation.manifest.claims,
    [...fixture.claims]
      .sort((left, right) =>
        left.claim_key.localeCompare(right.claim_key),
      )
      .map((claim) => claim.text),
  );
  assert.equal(
    validation.sourceEvidence.schema_version,
    "pulse-source-evidence-v1",
  );
  assert.equal(
    validation.sourceEvidence.story_id,
    expectedStoryId,
  );
  assert.deepEqual(
    validation.sourceEvidence.claims,
    validation.manifest.claims,
  );
  assert.ok(
    validation.sourceEvidence.claims.every(
      (claim) => typeof claim === "string",
    ),
  );
  assert.deepEqual(
    validation.sourceEvidence.official_source_snapshot,
    fixture.weeklySourceEvidence.official_source_snapshot,
  );
  assert.equal(
    validation.manifest.source_evidence_sha256,
    sha256(fs.readFileSync(result.paths.source_evidence)),
  );

  const proof = JSON.parse(
    fs.readFileSync(result.paths.proof, "utf8"),
  );
  assert.match(
    fs.readFileSync(result.paths.summary, "utf8"),
    /Publication verdict: \*\*HOLD\*\*/,
  );
  assert.equal(proof.schema_version,
    "pulse-governed-story-intake-inventory-bridge-proof-v1");
  assert.equal(proof.stages.canonical_validator, "PASS");
  assert.equal(proof.quality.publishable, false);
  assert.deepEqual(proof.quality.blockers, [
    "exact_subject_media_and_human_quality_review_required",
  ]);
});

test("materialises the locked YAZD script against clean exact News and Store API evidence while preserving its canonical identity", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-locked-yazd-intake-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixture = await buildLockedYazdInventoryFixture(root);

  const result =
    await materializeGovernedLockedStoryIntakeFromInventory({
      inventoryPath: fixture.registryPath,
      inventoryFileSha256: fixture.registryFileSha256,
      inventoryRoot: fixture.inventoryRoot,
      allowedRoots: [fixture.outputRoot, root],
      canonicalIdentityUrl: fixture.canonicalIdentityUrl,
      finalScript: fixture.script,
      finalScriptSha256: fixture.scriptSha256,
      scriptClaimBindings: fixture.scriptClaimBindings,
      presentationClaimBindings:
        fixture.presentationClaimBindings,
      supplementalOfficialSources: [
        {
          path: fixture.supplementalPath,
          file_sha256: fixture.supplementalFileSha256,
          canonical_sha256: fixture.storePacket.packet_sha256,
        },
      ],
      contract: fixture.contract,
      freshness: fixture.freshness,
      visualBrief: fixture.visualBrief,
      experimentDimensions: {
        eligible: false,
        ineligibility_reason:
          "Breaking high-cadence stories are outside the controlled calibration.",
      },
      outputDir: fixture.outputDir,
    });

  const validation = validateStoryIntakeManifest({
    manifestPath: result.paths.story_intake,
  });
  assert.equal(validation.storyId, fixture.storyId);
  assert.equal(validation.scriptSha256, fixture.scriptSha256);
  assert.equal(validation.wordCount, 106);
  assert.equal(
    validation.manifest.canonical_identity_url,
    fixture.canonicalIdentityUrl,
  );
  assert.deepEqual(
    validation.manifest.story.visual_brief,
    fixture.visualBrief,
  );
  assert.equal(
    validation.experimentDimensions?.eligible,
    false,
  );
  assert.equal(
    validation.sourceEvidence.canonical_identity_url,
    fixture.canonicalIdentityUrl,
  );
  assert.ok(
    validation.sourceEvidence.claims.includes(
      "YAZD HD Is FREE for a Limited Time!",
    ),
  );
  assert.equal(
    validation.sourceEvidence.claims.some((claim) =>
      claim.includes("[h3]"),
    ),
    false,
  );
  assert.equal(
    validation.sourceEvidence.supporting_official_source_snapshots
      .length,
    1,
  );
  assert.equal(
    validation.sourceEvidence.script_claim_bindings.length,
    6,
  );
  assert.equal(
    validation.sourceEvidence.presentation_claim_bindings.length,
    2,
  );
  assert.equal(
    validation.sourceEvidence.safety.claims_synthesised,
    false,
  );
  assert.equal(result.publish_authority_created, false);
  assert.equal(result.proof.stages.script_claim_binding, "PASS");
  assert.equal(result.proof.stages.canonical_identity_binding, "PASS");
});

test("locked official intake derives a deterministic canonical identity from an exact inventory-bound RSS story", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-locked-rss-story-identity-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const storyId = "rss_locked_yazd_official";
  const fixture = await buildLockedYazdInventoryFixture(root, {
    storyId,
  });
  const canonicalIdentityUrl = fixture.newsUrl;

  const result =
    await materializeGovernedLockedStoryIntakeFromInventory({
      inventoryPath: fixture.registryPath,
      inventoryFileSha256: fixture.registryFileSha256,
      inventoryRoot: fixture.inventoryRoot,
      allowedRoots: [fixture.outputRoot, root],
      canonicalIdentityUrl,
      finalScript: fixture.script,
      finalScriptSha256: fixture.scriptSha256,
      scriptClaimBindings: fixture.scriptClaimBindings,
      presentationClaimBindings:
        fixture.presentationClaimBindings,
      supplementalOfficialSources: [
        {
          path: fixture.supplementalPath,
          file_sha256: fixture.supplementalFileSha256,
          canonical_sha256: fixture.storePacket.packet_sha256,
        },
      ],
      contract: fixture.contract,
      freshness: fixture.freshness,
      visualBrief: fixture.visualBrief,
      experimentDimensions: {
        eligible: false,
        ineligibility_reason:
          "Breaking high-cadence stories are outside the controlled calibration.",
      },
      outputDir: fixture.outputDir,
    });

  const validation = validateStoryIntakeManifest({
    manifestPath: result.paths.story_intake,
  });
  const canonicalStoryId =
    `official_${canonicalHash(canonicalIdentityUrl)}`;
  assert.equal(result.verdict, "VALID");
  assert.equal(result.legacy_story_id, storyId);
  assert.equal(result.story_id, canonicalStoryId);
  assert.equal(validation.storyId, canonicalStoryId);
  assert.equal(
    validation.manifest.canonical_identity_url,
    canonicalIdentityUrl,
  );
  assert.equal(
    validation.sourceEvidence.story_id,
    canonicalStoryId,
  );
});

test("fails closed when archived official Store bytes drift behind a hash-bound packet", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-locked-yazd-source-drift-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixture = await buildLockedYazdInventoryFixture(root);
  fs.writeFileSync(
    fixture.storeArchivePath,
    Buffer.from(
      "{\"674750\":{\"success\":true,\"data\":{\"name\":\"Unsupported replacement\"}}}",
      "utf8",
    ),
  );

  await assert.rejects(
    materializeGovernedLockedStoryIntakeFromInventory({
      inventoryPath: fixture.registryPath,
      inventoryFileSha256: fixture.registryFileSha256,
      inventoryRoot: fixture.inventoryRoot,
      allowedRoots: [fixture.outputRoot, root],
      canonicalIdentityUrl: fixture.canonicalIdentityUrl,
      finalScript: fixture.script,
      finalScriptSha256: fixture.scriptSha256,
      scriptClaimBindings: fixture.scriptClaimBindings,
      supplementalOfficialSources: [
        {
          path: fixture.supplementalPath,
          file_sha256: fixture.supplementalFileSha256,
          canonical_sha256: fixture.storePacket.packet_sha256,
        },
      ],
      contract: fixture.contract,
      freshness: fixture.freshness,
      outputDir: fixture.outputDir,
    }),
    (error) => {
      assert.equal(
        error.name,
        "GovernedStoryIntakeInventoryBridgeError",
      );
      assert.ok(
        error.blockers.includes(
          "supplemental_official_source_0_source_archive_hash_mismatch",
        ),
      );
      return true;
    },
  );
  assert.equal(fs.existsSync(fixture.outputDir), false);
});

test("bridges the hash-bound YAZD legacy seed and proof package without rewriting the legacy evidence", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-yazd-intake-bridge-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixture = buildYazdLegacyPackageFixture(root);
  const inputHashesBefore = {
    seed: sha256(fs.readFileSync(fixture.seedPath)),
    canonical: sha256(
      fs.readFileSync(fixture.canonicalStoryManifestPath),
    ),
    source: sha256(
      fs.readFileSync(fixture.sourceManifestPath),
    ),
  };

  const result =
    await materializeGovernedStoryIntakeFromLegacyPackage({
      seedPath: fixture.seedPath,
      seedFileSha256: fixture.seedFileSha256,
      canonicalStoryManifestPath:
        fixture.canonicalStoryManifestPath,
      canonicalStoryManifestFileSha256:
        fixture.canonicalStoryManifestFileSha256,
      sourceManifestPath: fixture.sourceManifestPath,
      sourceManifestFileSha256:
        fixture.sourceManifestFileSha256,
      allowedRoots: [fixture.root],
      finalScript: fixture.script,
      finalScriptSha256: fixture.scriptSha256,
      scriptClaimBindings: fixture.scriptClaimBindings,
      outputDir: fixture.outputDir,
    });

  const validation = validateStoryIntakeManifest({
    manifestPath: result.paths.story_intake,
  });
  assert.equal(result.verdict, "VALID");
  assert.equal(result.publish_verdict, "HOLD");
  assert.equal(validation.wordCount, 46);
  assert.equal(validation.script, fixture.script);
  assert.equal(
    validation.storyId,
    `official_${canonicalHash(fixture.sourceUrl)}`,
  );
  assert.deepEqual(validation.manifest.claims, fixture.claims);
  assert.deepEqual(
    {
      seed: sha256(fs.readFileSync(fixture.seedPath)),
      canonical: sha256(
        fs.readFileSync(fixture.canonicalStoryManifestPath),
      ),
      source: sha256(
        fs.readFileSync(fixture.sourceManifestPath),
      ),
    },
    inputHashesBefore,
  );
  assert.equal(result.proof.stages.legacy_inputs_unchanged, "PASS");
  assert.equal(result.proof.stages.script_claim_binding, "PASS");
  assert.equal(result.proof.quality.publishable, false);
  assert.match(
    fs.readFileSync(result.paths.summary, "utf8"),
    /46 words/,
  );
});

test("refuses the original 49-word YAZD draft instead of weakening the 47-word maximum", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-yazd-long-script-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixture = buildYazdLegacyPackageFixture(root);
  const longScript =
    "Yet Another Zombie Defense HD is free to keep on Steam, but only until 30 July. It mixes top-down shooting with tower defence: build barricades by day, then survive the night solo or with up to four players. Claim it now and the full game stays in your library.";

  await assert.rejects(
    materializeGovernedStoryIntakeFromLegacyPackage({
      seedPath: fixture.seedPath,
      seedFileSha256: fixture.seedFileSha256,
      canonicalStoryManifestPath:
        fixture.canonicalStoryManifestPath,
      canonicalStoryManifestFileSha256:
        fixture.canonicalStoryManifestFileSha256,
      sourceManifestPath: fixture.sourceManifestPath,
      sourceManifestFileSha256:
        fixture.sourceManifestFileSha256,
      allowedRoots: [fixture.root],
      finalScript: longScript,
      finalScriptSha256: sha256(Buffer.from(longScript, "utf8")),
      scriptClaimBindings: [],
      outputDir: fixture.outputDir,
    }),
    (error) => {
      assert.equal(
        error.name,
        "GovernedStoryIntakeInventoryBridgeError",
      );
      assert.ok(
        error.blockers.includes("script_word_count_out_of_range"),
      );
      return true;
    },
  );
  assert.equal(fs.existsSync(fixture.outputDir), false);
});

test("fails closed when a hash-bound legacy package tries to retain the wrong RSS identity or drift its claims", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-yazd-identity-drift-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixture = buildYazdLegacyPackageFixture(root);
  const canonical = JSON.parse(
    fs.readFileSync(
      fixture.canonicalStoryManifestPath,
      "utf8",
    ),
  );
  canonical.story_id = "rss_wrong_legacy_identity";
  canonical.confirmed_claims[0] =
    "A materially different unsupported claim.";
  fs.writeFileSync(
    fixture.canonicalStoryManifestPath,
    `${JSON.stringify(canonical, null, 2)}\n`,
    "utf8",
  );
  const changedHash = sha256(
    fs.readFileSync(fixture.canonicalStoryManifestPath),
  );

  await assert.rejects(
    materializeGovernedStoryIntakeFromLegacyPackage({
      seedPath: fixture.seedPath,
      seedFileSha256: fixture.seedFileSha256,
      canonicalStoryManifestPath:
        fixture.canonicalStoryManifestPath,
      canonicalStoryManifestFileSha256: changedHash,
      sourceManifestPath: fixture.sourceManifestPath,
      sourceManifestFileSha256:
        fixture.sourceManifestFileSha256,
      allowedRoots: [fixture.root],
      finalScript: fixture.script,
      finalScriptSha256: fixture.scriptSha256,
      scriptClaimBindings: fixture.scriptClaimBindings,
      outputDir: fixture.outputDir,
    }),
    (error) => {
      assert.ok(
        error.blockers.includes("legacy_story_identity_mismatch"),
      );
      assert.ok(
        error.blockers.includes(
          "legacy_confirmed_claim_inventory_mismatch",
        ),
      );
      return true;
    },
  );
  assert.equal(fs.existsSync(fixture.outputDir), false);
});
