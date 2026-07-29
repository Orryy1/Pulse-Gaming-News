"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const {
  buildLockedYazdInventoryFixture,
  buildYazdLegacyPackageFixture,
} = require("../fixtures/governed-story-intake-inventory-bridge");

const TOOL = path.resolve(
  __dirname,
  "../../tools/governed-story-intake-inventory-bridge.js",
);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeRequest(fixture) {
  const requestPath = path.join(fixture.root, "bridge-request.json");
  const request = {
    schema_version:
      "pulse-governed-story-intake-inventory-bridge-request-v1",
    input_kind: "LEGACY_SEED_AND_PROOF_PACKAGE",
    inputs: {
      seed_path: fixture.seedPath,
      seed_file_sha256: fixture.seedFileSha256,
      canonical_story_manifest_path:
        fixture.canonicalStoryManifestPath,
      canonical_story_manifest_file_sha256:
        fixture.canonicalStoryManifestFileSha256,
      source_manifest_path: fixture.sourceManifestPath,
      source_manifest_file_sha256:
        fixture.sourceManifestFileSha256,
      allowed_roots: [fixture.root],
    },
    final_script: fixture.script,
    final_script_sha256: fixture.scriptSha256,
    script_claim_bindings: fixture.scriptClaimBindings,
    output_dir: fixture.outputDir,
    safety: {
      local_proof_only: true,
      database_mutation_authorised: false,
      oauth_mutation_authorised: false,
      platform_contact_authorised: false,
      publish_authority: false,
    },
  };
  const bytes = Buffer.from(
    `${JSON.stringify(request, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(requestPath, bytes);
  return { requestPath, requestSha256: sha256(bytes) };
}

test("CLI requires an exact request hash and explicit local materialisation", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-intake-bridge-cli-"),
  );
  try {
    const fixture = buildYazdLegacyPackageFixture(root);
    const request = writeRequest(fixture);
    const denied = spawnSync(
      process.execPath,
      [TOOL, "--request", request.requestPath],
      { cwd: path.resolve(__dirname, "../.."), encoding: "utf8" },
    );
    assert.notEqual(denied.status, 0);
    assert.equal(fs.existsSync(fixture.outputDir), false);

    const applied = spawnSync(
      process.execPath,
      [
        TOOL,
        "--request",
        request.requestPath,
        "--materialize",
        "--confirm-request-sha256",
        request.requestSha256,
      ],
      { cwd: path.resolve(__dirname, "../.."), encoding: "utf8" },
    );
    assert.equal(applied.status, 0, applied.stderr);
    const result = JSON.parse(applied.stdout);
    assert.equal(result.verdict, "VALID");
    assert.equal(result.publish_verdict, "HOLD");
    assert.equal(result.word_count, 46);
    assert.equal(fs.existsSync(result.paths.story_intake), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("CLI materialises a hash-confirmed locked-script inventory request without creating publish authority", async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-locked-intake-bridge-cli-"),
  );
  try {
    const fixture = await buildLockedYazdInventoryFixture(root);
    const requestPath = path.join(
      root,
      "locked-bridge-request.json",
    );
    const request = {
      schema_version:
        "pulse-governed-story-intake-inventory-bridge-request-v1",
      input_kind:
        "READY_INVENTORY_AND_LOCKED_OFFICIAL_SCRIPT",
      inputs: {
        inventory_path: fixture.registryPath,
        inventory_file_sha256: fixture.registryFileSha256,
        inventory_root: fixture.inventoryRoot,
        allowed_roots: [fixture.outputRoot, root],
      },
      canonical_identity_url: fixture.canonicalIdentityUrl,
      final_script: fixture.script,
      final_script_sha256: fixture.scriptSha256,
      script_claim_bindings: fixture.scriptClaimBindings,
      presentation_claim_bindings:
        fixture.presentationClaimBindings,
      supplemental_official_sources: [
        {
          path: fixture.supplementalPath,
          file_sha256: fixture.supplementalFileSha256,
          canonical_sha256: fixture.storePacket.packet_sha256,
        },
      ],
      contract: fixture.contract,
      freshness: fixture.freshness,
      visual_brief: fixture.visualBrief,
      output_dir: fixture.outputDir,
      safety: {
        local_proof_only: true,
        database_mutation_authorised: false,
        oauth_mutation_authorised: false,
        platform_contact_authorised: false,
        publish_authority: false,
      },
    };
    const bytes = Buffer.from(
      `${JSON.stringify(request, null, 2)}\n`,
      "utf8",
    );
    fs.writeFileSync(requestPath, bytes);
    const applied = spawnSync(
      process.execPath,
      [
        TOOL,
        "--request",
        requestPath,
        "--materialize",
        "--confirm-request-sha256",
        sha256(bytes),
      ],
      { cwd: path.resolve(__dirname, "../.."), encoding: "utf8" },
    );

    assert.equal(applied.status, 0, applied.stderr);
    const result = JSON.parse(applied.stdout);
    assert.equal(result.story_id, fixture.storyId);
    assert.equal(result.word_count, 106);
    assert.equal(result.safety.publish_authority_created, false);
    assert.equal(fs.existsSync(result.paths.story_intake), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
