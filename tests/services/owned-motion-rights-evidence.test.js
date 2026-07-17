"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  ASSET_KIND_POLICIES,
  evaluateOwnedMotionRightsEvidence,
  materializeOwnedMotionRightsEvidence,
} = require("../../lib/owned-motion-rights-evidence");

const ALL_PLATFORMS = [
  "youtube_shorts",
  "tiktok",
  "instagram_reels",
  "facebook_reels",
  "x",
  "threads",
  "pinterest",
];

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function fingerprint(filePath) {
  const bytes = await fs.readFile(filePath);
  return {
    sha256: sha256(bytes),
    size_bytes: bytes.length,
  };
}

async function ownedInput(root, assetKind, overrides = {}) {
  const policy = ASSET_KIND_POLICIES[assetKind];
  const extension = assetKind === "procedural_clip" || assetKind === "platform_variant"
    ? ".mp4"
    : ".wav";
  const assetId = `${assetKind}-asset`;
  const assetPath = path.join(root, `${assetId}${extension}`);
  await fs.writeFile(assetPath, Buffer.from(`current-${assetKind}-bytes`));
  return {
    asset_id: assetId,
    asset_kind: assetKind,
    asset_path: assetPath,
    evidence_path: path.join(root, `${assetId}.rights-evidence.json`),
    ownership_basis: "wholly_owned_generated_asset",
    licence_basis: policy.licence_basis,
    rights_grant: true,
    commercial_use_allowed: true,
    allowed_platforms: [...ALL_PLATFORMS],
    source_owner: "Pulse Gaming",
    source_type: policy.source_type,
    source_url: `local://pulse-owned/${assetId}`,
    provenance: {
      origin: "pulse_gaming_internal_generation",
      generator_name: `pulse-${assetKind}-generator`,
      generator_version: "1.0.0",
      generated_at: "2026-07-17T10:15:00.000Z",
      creation_method: policy.creation_method,
      third_party_inputs: false,
      third_party_sources: [],
    },
    ...overrides,
  };
}

test("materialises current scheduler-compatible evidence for every wholly owned asset kind", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-owned-rights-"));

  for (const assetKind of Object.keys(ASSET_KIND_POLICIES)) {
    const input = await ownedInput(root, assetKind);
    const result = await materializeOwnedMotionRightsEvidence(input);
    const assetFingerprint = await fingerprint(input.asset_path);
    const evidenceFingerprint = await fingerprint(input.evidence_path);
    const sidecar = await fs.readJson(input.evidence_path);

    assert.equal(result.status, "materialized");
    assert.equal(result.evaluation.status, "pass");
    assert.equal(result.record.kind, ASSET_KIND_POLICIES[assetKind].scheduler_kind);
    assert.equal(result.record.path, path.resolve(input.asset_path));
    assert.equal(result.record.local_materialized_path, path.resolve(input.asset_path));
    assert.equal(result.record.asset_sha256, assetFingerprint.sha256);
    assert.equal(result.record.asset_size_bytes, assetFingerprint.size_bytes);
    assert.equal(result.record.evidence_file, path.resolve(input.evidence_path));
    assert.equal(result.record.evidence_sha256, evidenceFingerprint.sha256);
    assert.equal(result.record.evidence_size_bytes, evidenceFingerprint.size_bytes);
    assert.equal(result.record.rights_grant, true);
    assert.equal(result.record.commercial_use_allowed, true);
    assert.deepEqual(result.record.allowed_platforms, ALL_PLATFORMS);
    assert.deepEqual(result.record.provenance, input.provenance);

    assert.equal(sidecar.schema, "pulse_owned_asset_rights_evidence_v1");
    assert.equal(sidecar.asset_sha256, assetFingerprint.sha256);
    assert.equal(sidecar.asset_size_bytes, assetFingerprint.size_bytes);
    assert.equal(sidecar.ownership_basis, "wholly_owned_generated_asset");
    assert.equal(sidecar.rights_grant, true);
    assert.equal(sidecar.commercial_use_allowed, true);
    assert.deepEqual(sidecar.allowed_platforms, ALL_PLATFORMS);
    assert.deepEqual(sidecar.provenance, input.provenance);
  }
});

test("requires an exact explicit platform set in both the record and evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-owned-platforms-"));
  const input = await ownedInput(root, "procedural_clip");
  const { record } = await materializeOwnedMotionRightsEvidence(input);

  const missingPlatform = await evaluateOwnedMotionRightsEvidence({
    record,
    required_platforms: ALL_PLATFORMS.slice(0, -1),
  });
  assert.equal(missingPlatform.status, "fail");
  assert.ok(missingPlatform.blockers.includes("required_platforms_exact_mismatch"));

  const wildcardInput = await ownedInput(root, "sfx", {
    asset_id: "wildcard-sfx",
    allowed_platforms: ["all"],
  });
  await assert.rejects(
    materializeOwnedMotionRightsEvidence(wildcardInput),
    /allowed_platform_invalid:all/,
  );
});

test("fails closed for missing assets and missing or unreadable evidence sidecars", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-owned-missing-"));
  const missingInput = await ownedInput(root, "narration");
  await fs.remove(missingInput.asset_path);
  await assert.rejects(
    materializeOwnedMotionRightsEvidence(missingInput),
    /asset_file_missing/,
  );

  const input = await ownedInput(root, "narration", {
    asset_id: "valid-narration",
  });
  const { record } = await materializeOwnedMotionRightsEvidence(input);
  await fs.remove(input.evidence_path);
  const missingEvidence = await evaluateOwnedMotionRightsEvidence({ record });
  assert.equal(missingEvidence.status, "fail");
  assert.ok(missingEvidence.blockers.includes("evidence_file_missing"));

  await fs.writeFile(input.evidence_path, "not-json");
  const unreadableEvidence = await evaluateOwnedMotionRightsEvidence({
    record: {
      ...record,
      evidence_sha256: (await fingerprint(input.evidence_path)).sha256,
      evidence_size_bytes: (await fingerprint(input.evidence_path)).size_bytes,
    },
  });
  assert.equal(unreadableEvidence.status, "fail");
  assert.ok(unreadableEvidence.blockers.includes("evidence_json_unreadable"));
});

test("detects stale asset and evidence hashes and sizes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-owned-stale-"));
  const input = await ownedInput(root, "platform_variant", {
    platform: "youtube_shorts",
  });
  const { record } = await materializeOwnedMotionRightsEvidence(input);

  await fs.appendFile(input.asset_path, "-changed");
  const staleAsset = await evaluateOwnedMotionRightsEvidence({ record });
  assert.equal(staleAsset.status, "fail");
  assert.ok(staleAsset.blockers.includes("asset_sha256_mismatch"));
  assert.ok(staleAsset.blockers.includes("asset_size_mismatch"));

  await fs.writeFile(input.asset_path, Buffer.from("current-platform_variant-bytes"));
  await fs.appendFile(input.evidence_path, " ");
  const staleEvidence = await evaluateOwnedMotionRightsEvidence({ record });
  assert.equal(staleEvidence.status, "fail");
  assert.ok(staleEvidence.blockers.includes("evidence_sha256_mismatch"));
  assert.ok(staleEvidence.blockers.includes("evidence_size_mismatch"));
});

test("fails closed when current files have missing or invalid declared fingerprints", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-owned-fingerprints-"));
  const input = await ownedInput(root, "procedural_clip");
  const { record } = await materializeOwnedMotionRightsEvidence(input);
  const assessment = await evaluateOwnedMotionRightsEvidence({
    record: {
      ...record,
      asset_sha256: "not-a-sha256",
      asset_size_bytes: null,
      evidence_sha256: "",
      rights_evidence_sha256: "",
      evidence_size_bytes: 0,
    },
  });

  assert.equal(assessment.status, "fail");
  assert.ok(assessment.blockers.includes("asset_sha256_missing"));
  assert.ok(assessment.blockers.includes("asset_size_missing"));
  assert.ok(assessment.blockers.includes("evidence_sha256_missing"));
  assert.ok(assessment.blockers.includes("evidence_size_missing"));
});

test("rejects bare pass flags without material evidence", async () => {
  const assessment = await evaluateOwnedMotionRightsEvidence({
    record: {
      asset_id: "bare-pass",
      status: "pass",
      verdict: "pass",
      rights_grant: true,
      commercial_use_allowed: true,
    },
  });

  assert.equal(assessment.status, "fail");
  assert.ok(assessment.blockers.includes("bare_pass_flags_rejected"));
  assert.ok(assessment.blockers.includes("asset_path_missing"));
  assert.ok(assessment.blockers.includes("evidence_path_missing"));
});

test("rejects third-party source claims even when hashes are current", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-owned-third-party-"));
  const input = await ownedInput(root, "procedural_clip", {
    source_type: "official_third_party_trailer",
    source_url: "https://www.youtube.com/watch?v=third-party",
  });

  await assert.rejects(
    materializeOwnedMotionRightsEvidence(input),
    /source_type_not_owned_generated/,
  );

  const validInput = await ownedInput(root, "sfx", { asset_id: "owned-sfx" });
  const { record } = await materializeOwnedMotionRightsEvidence(validInput);
  const sidecar = await fs.readJson(validInput.evidence_path);
  sidecar.provenance.third_party_inputs = true;
  sidecar.provenance.third_party_sources = ["https://audio.example/licensed.wav"];
  await fs.writeJson(validInput.evidence_path, sidecar);
  const currentEvidence = await fingerprint(validInput.evidence_path);
  const assessment = await evaluateOwnedMotionRightsEvidence({
    record: {
      ...record,
      evidence_sha256: currentEvidence.sha256,
      evidence_size_bytes: currentEvidence.size_bytes,
    },
  });

  assert.equal(assessment.status, "fail");
  assert.ok(assessment.blockers.includes("evidence_third_party_inputs_present"));
  assert.ok(assessment.blockers.includes("evidence_third_party_sources_present"));
});

test("rejects rights_grant false and commercial use other than explicit true", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-owned-grant-"));
  const falseGrant = await ownedInput(root, "narration", { rights_grant: false });
  await assert.rejects(
    materializeOwnedMotionRightsEvidence(falseGrant),
    /rights_grant_not_explicitly_true/,
  );

  const noCommercialUse = await ownedInput(root, "sfx", {
    asset_id: "non-commercial-sfx",
    commercial_use_allowed: false,
  });
  await assert.rejects(
    materializeOwnedMotionRightsEvidence(noCommercialUse),
    /commercial_use_not_explicitly_allowed/,
  );

  const validInput = await ownedInput(root, "procedural_clip", {
    asset_id: "evaluator-false-grant",
  });
  const { record } = await materializeOwnedMotionRightsEvidence(validInput);
  const assessment = await evaluateOwnedMotionRightsEvidence({
    record: { ...record, rights_grant: false },
  });
  assert.equal(assessment.status, "fail");
  assert.ok(assessment.blockers.includes("rights_grant_not_explicitly_true"));
});

test("rejects incorrect owned basis and incomplete provenance", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-owned-provenance-"));
  const licensedInput = await ownedInput(root, "procedural_clip", {
    licence_basis: "licensed_third_party_editorial_use",
  });
  await assert.rejects(
    materializeOwnedMotionRightsEvidence(licensedInput),
    /licence_basis_not_owned_generated/,
  );

  const missingProvenance = await ownedInput(root, "platform_variant", {
    asset_id: "variant-without-generator",
    provenance: {
      origin: "pulse_gaming_internal_generation",
      generator_version: "1.0.0",
      generated_at: "2026-07-17T10:15:00.000Z",
      creation_method: "owned_asset_transcode",
      third_party_inputs: false,
      third_party_sources: [],
    },
  });
  await assert.rejects(
    materializeOwnedMotionRightsEvidence(missingProvenance),
    /provenance_generator_name_missing/,
  );
});
