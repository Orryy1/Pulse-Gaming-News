"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  captureBreakingSourceEvidence,
  persistBreakingSourceEvidencePacket,
} = require("../../lib/services/breaking-source-evidence");
const {
  buildEvergreenAutonomousDiscoveryInputs,
} = require("../../lib/services/evergreen-autonomous-input-adapter");
const {
  prepareGovernedEditorialInventory,
} = require("../../lib/services/governed-editorial-inventory-preparer");
const {
  scanGovernedEditorialInventory,
} = require("../../lib/services/governed-editorial-inventory-registry");
const {
  assessRightsLedger,
  hashRightsLedger,
} = require("../../lib/services/publication-evidence-gates");

const NOW = "2026-07-28T12:00:00.000Z";
const OFFICIAL_URL =
  "https://news.xbox.com/en-us/2026/07/28/back-compat-update/";
const PRESS_URL =
  "https://www.ign.com/articles/xbox-back-compat-expansion-update";
const SECOND_PRESS_URL =
  "https://www.eurogamer.net/xbox-back-compat-expansion-update";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeJson(filePath, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, bytes);
  return {
    path: filePath,
    file_sha256: sha256(bytes),
    value,
  };
}

function sourcePolicy() {
  return {
    official_first_party: [
      {
        source_id: "xbox-wire",
        owner: "Microsoft Gaming",
        hosts: ["news.xbox.com"],
        subject_ids: ["xbox"],
      },
    ],
    trusted_editorial: [
      {
        source_id: "ign",
        outlet: "IGN",
        hosts: ["ign.com"],
      },
      {
        source_id: "eurogamer",
        outlet: "Eurogamer",
        hosts: ["eurogamer.net"],
      },
    ],
  };
}

function canonicalStory() {
  return {
    id: "xbox-backcompat-inventory",
    title: "Xbox backwards compatibility expansion achievements update",
    franchise: "Xbox",
    platform: "Xbox",
    topic_key: "xbox-backwards-compatibility",
    published_at: NOW,
    primary_source_url: OFFICIAL_URL,
    subject_ids: ["xbox"],
  };
}

async function breakingEvidence(root, story = canonicalStory()) {
  const claims = [
    {
      claim_key: "xbox.backcompat.expansion",
      text: "The Xbox backwards compatibility expansion adds more original Xbox games.",
      location: "body",
    },
    {
      claim_key: "xbox.backcompat.achievements",
      text: "Supported original Xbox games will receive achievement support.",
      location: "body",
    },
    {
      claim_key: "xbox.backcompat.update",
      text: "The backwards compatibility update is coming to Game Pass.",
      location: "body",
    },
  ];
  const body = Buffer.from(
    `<article>${claims.map((claim) => claim.text).join(" ")}</article>`,
    "utf8",
  );
  const packet = await captureBreakingSourceEvidence({
    story: {
      id: story.id,
      title: story.title,
      subject_ids: story.subject_ids,
      source_candidates: [OFFICIAL_URL, PRESS_URL],
    },
    sourcePolicy: sourcePolicy(),
    now: NOW,
    fetchCapture: async ({ url }) => ({
      status: 200,
      final_url: url,
      content_type: "text/html; charset=utf-8",
      bytes: body,
    }),
    extractClaims: async () => ({
      extractor: { id: "inventory-fixture", version: "1.0.0" },
      claims,
    }),
  });
  const persisted = await persistBreakingSourceEvidencePacket({
    packet,
    outputDir: path.join(root, "breaking"),
  });
  return {
    path: persisted.path,
    file_sha256: persisted.file_sha256,
    canonical_sha256: persisted.packet_sha256,
    packet,
  };
}

async function corroboratedBreakingEvidence(root, story = canonicalStory()) {
  const claims = [
    {
      claim_key: "xbox.backcompat.expansion",
      text: "The Xbox backwards compatibility expansion adds more original Xbox games.",
      location: "body",
    },
    {
      claim_key: "xbox.backcompat.achievements",
      text: "Supported original Xbox games will receive achievement support.",
      location: "body",
    },
    {
      claim_key: "xbox.backcompat.update",
      text: "The backwards compatibility update is coming to Game Pass.",
      location: "body",
    },
  ];
  const body = Buffer.from(
    `<article>${claims.map((claim) => claim.text).join(" ")}</article>`,
    "utf8",
  );
  const packet = await captureBreakingSourceEvidence({
    story: {
      id: story.id,
      title: story.title,
      subject_ids: story.subject_ids,
      source_candidates: [PRESS_URL, SECOND_PRESS_URL],
    },
    sourcePolicy: sourcePolicy(),
    now: NOW,
    fetchCapture: async ({ url }) => ({
      status: 200,
      final_url: url,
      content_type: "text/html; charset=utf-8",
      bytes: body,
    }),
    extractClaims: async () => ({
      extractor: { id: "inventory-fixture", version: "1.0.0" },
      claims,
    }),
  });
  const persisted = await persistBreakingSourceEvidencePacket({
    packet,
    outputDir: path.join(root, "breaking"),
  });
  return {
    path: persisted.path,
    file_sha256: persisted.file_sha256,
    canonical_sha256: persisted.packet_sha256,
    packet,
  };
}

function ownedMotionEvidence(root, story = canonicalStory()) {
  const assetsRoot = path.join(root, "owned-motion", "assets");
  const assetSpecs = [
    ["hook-card.png", "hook_card", "image", null],
    ["proof-map.png", "proof_map", "image", null],
    ["timeline.png", "timeline", "image", null],
    ["player-impact.png", "player_impact", "image", null],
    ["owned-sequence.mp4", "motion_sequence", "video", 28],
  ];
  const assets = assetSpecs.map(
    ([filename, role, mediaType, durationSeconds], index) => {
      const assetPath = path.join(assetsRoot, filename);
      const bytes = Buffer.from(`owned-motion-${index + 1}`, "utf8");
      fs.mkdirSync(path.dirname(assetPath), { recursive: true });
      fs.writeFileSync(assetPath, bytes);
      return {
        path: path.relative(path.join(root, "owned-motion"), assetPath),
        sha256: sha256(bytes),
        media_type: mediaType,
        role,
        ownership: "owned",
        rights_basis: "OWNED",
        attribution_required: false,
        duration_seconds: durationSeconds,
        generator_identity: "pulse-governed-owned-motion-v1",
        provenance: {
          source: "repository_owned_generation",
          third_party_media_used: false,
        },
      };
    },
  );
  return writeJson(path.join(root, "owned-motion", "owned-motion-manifest.json"), {
    schema_version: "pulse-owned-motion-manifest-v1",
    story_id: story.id,
    generated_at: NOW,
    assets,
  });
}

function safeAdvertiserScore(story = canonicalStory()) {
  return {
    story_id: story.id,
    advertiser_safety: 5,
    hard_stops: [],
    scorer_version: "pulse-advertiser-safety-v3",
    scored_at: NOW,
  };
}

test("prepares immutable owned-only inventory that passes the rights gate and evergreen adapter", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-editorial-inventory-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const story = canonicalStory();
  const breaking = await breakingEvidence(root, story);
  const motion = ownedMotionEvidence(root, story);
  const outputDir = path.join(root, "inventory");

  const result = await prepareGovernedEditorialInventory({
    story,
    breaking_source_evidence: breaking,
    owned_motion_manifest: motion,
    advertiser_safety: safeAdvertiserScore(story),
    output_dir: outputDir,
  });

  assert.equal(result.registry.verdict, "READY");
  assert.deepEqual(result.registry.blockers, []);
  assert.equal(
    result.paths.registry,
    path.join(outputDir, "governed-editorial-inventory.json"),
  );
  assert.equal(result.registry.story.verification_status, "CONFIRMED");
  assert.equal(
    result.registry.story.primary_source_url,
    breaking.packet.primary_source_url,
  );
  assert.deepEqual(
    result.weekly_source_evidence.claims.map((claim) => claim.text),
    breaking.packet.confirmed_claims.flatMap((group) =>
      group.evidence
        .filter((evidence) => evidence.source_class === "OFFICIAL_FIRST_PARTY")
        .map((evidence) => evidence.text),
    ),
  );
  assert.deepEqual(
    result.weekly_source_evidence.official_source_snapshot,
    {
      schema_version: "pulse-official-source-snapshot-v1",
      source_url: OFFICIAL_URL,
      source_id: "xbox-wire",
      source_class: "OFFICIAL_FIRST_PARTY",
      canonical_body_algorithm: "pulse-readable-body-v1",
      canonical_body_sha256:
        breaking.packet.sources[0].canonical_body.sha256,
      claims: result.weekly_source_evidence.claims.map(
        ({ claim_key, text, claim_text_sha256 }) => ({
          claim_key,
          text,
          claim_text_sha256,
        }),
      ),
    },
  );

  const rightsAssessment = assessRightsLedger(
    result.rights_ledger,
    result.registry.rights_ledger.canonical_sha256,
  );
  assert.deepEqual(rightsAssessment.blockers, []);
  assert.equal(result.rights_ledger.items.length, 5);
  assert.equal(result.rights_ledger.media_plan.third_party_music, false);
  assert.equal(result.rights_ledger.media_plan.third_party_media, false);
  assert.ok(
    result.rights_ledger.items.every(
      (item) =>
        item.source_url.startsWith("pulse-owned://") &&
        item.rights_basis === "OWNED" &&
        item.owner === "Pulse Gaming" &&
        item.rights_evidence.sha256 === motion.file_sha256,
    ),
  );

  const adapted = await buildEvergreenAutonomousDiscoveryInputs({
    stories: [
      {
        ...story,
        source_evidence_path:
          result.registry.breaking_source_evidence.path,
        source_evidence_file_sha256:
          result.registry.breaking_source_evidence.file_sha256,
        source_evidence_sha256:
          result.registry.breaking_source_evidence.canonical_sha256,
        rights_ledger_path: result.registry.rights_ledger.path,
        rights_ledger_file_sha256:
          result.registry.rights_ledger.file_sha256,
        rights_ledger_canonical_sha256:
          result.registry.rights_ledger.canonical_sha256,
        advertiser_safety_report_path:
          result.registry.advertiser_safety_report.path,
        advertiser_safety_report_sha256:
          result.registry.advertiser_safety_report.file_sha256,
      },
    ],
    root_dir: root,
    now: NOW,
  });
  assert.equal(adapted.summary.accepted_count, 1);
  assert.deepEqual(adapted.rejected_inputs, []);

  const scanned = await scanGovernedEditorialInventory({ rootDir: root });
  assert.equal(scanned.summary.ready_count, 1);
  assert.deepEqual(scanned.rejected, []);
  assert.equal(scanned.evergreen_stories[0].id, story.id);
  assert.equal(scanned.weekly_longform_candidates[0].id, story.id);

  const firstBytes = fs.readFileSync(result.paths.registry);
  const repeated = await prepareGovernedEditorialInventory({
    story,
    breaking_source_evidence: breaking,
    owned_motion_manifest: motion,
    advertiser_safety: safeAdvertiserScore(story),
    output_dir: outputDir,
  });
  assert.equal(repeated.registry.inventory_sha256, result.registry.inventory_sha256);
  assert.deepEqual(fs.readFileSync(result.paths.registry), firstBytes);
});

test("holds the inventory and emits no safety evidence unless the score is explicitly five with no hard stops", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-editorial-inventory-hold-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const story = canonicalStory();
  const breaking = await breakingEvidence(root, story);
  const motion = ownedMotionEvidence(root, story);

  const result = await prepareGovernedEditorialInventory({
    story,
    breaking_source_evidence: breaking,
    owned_motion_manifest: motion,
    advertiser_safety: {
      ...safeAdvertiserScore(story),
      advertiser_safety: 4,
      hard_stops: ["graphic_violence"],
    },
    output_dir: path.join(root, "inventory"),
  });

  assert.equal(result.registry.verdict, "HOLD");
  assert.ok(
    result.registry.blockers.includes(
      "advertiser_safety_not_explicitly_green",
    ),
  );
  assert.ok(
    result.registry.blockers.includes(
      "advertiser_safety_hard_stops_not_clear",
    ),
  );
  assert.equal(result.advertiser_safety_report, null);
  assert.deepEqual(result.registry.advertiser_safety_report, {
    path: null,
    file_sha256: null,
  });
  assert.equal(
    fs.existsSync(
      path.join(root, "inventory", "advertiser-safety-report.json"),
    ),
    false,
  );
  assert.equal(result.registry.safety.publish_authority_created, false);
  assert.equal(result.registry.safety.database_mutated, false);
  assert.equal(result.registry.safety.oauth_mutated, false);
  assert.equal(result.registry.safety.network_used, false);
});

test("holds instead of inventing rights when an owned-motion asset no longer matches its manifest hash", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-editorial-inventory-tamper-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const story = canonicalStory();
  const breaking = await breakingEvidence(root, story);
  const motion = ownedMotionEvidence(root, story);
  const firstAsset = motion.value.assets[0];
  fs.appendFileSync(
    path.resolve(path.dirname(motion.path), firstAsset.path),
    "tampered",
  );

  const result = await prepareGovernedEditorialInventory({
    story,
    breaking_source_evidence: breaking,
    owned_motion_manifest: motion,
    advertiser_safety: safeAdvertiserScore(story),
    output_dir: path.join(root, "inventory"),
  });

  assert.equal(result.registry.verdict, "HOLD");
  assert.ok(
    result.registry.blockers.includes(
      "owned_motion_asset_1_file_sha256_mismatch",
    ),
  );
  assert.equal(result.rights_ledger, null);
  assert.deepEqual(result.registry.rights_ledger, {
    path: null,
    file_sha256: null,
    canonical_sha256: null,
  });
  assert.equal(
    fs.existsSync(path.join(root, "inventory", "rights-ledger.json")),
    false,
  );
});

test("never clears third-party media through the owned-motion inventory path", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-editorial-inventory-third-party-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const story = canonicalStory();
  const breaking = await breakingEvidence(root, story);
  const originalMotion = ownedMotionEvidence(root, story);
  const unsafeManifest = structuredClone(originalMotion.value);
  unsafeManifest.assets[0].ownership = "mixed";
  unsafeManifest.assets[0].rights_basis = "LICENSED";
  unsafeManifest.assets[0].attribution_required = true;
  unsafeManifest.assets[0].provenance.third_party_media_used = true;
  const motion = writeJson(originalMotion.path, unsafeManifest);

  const result = await prepareGovernedEditorialInventory({
    story,
    breaking_source_evidence: breaking,
    owned_motion_manifest: motion,
    advertiser_safety: safeAdvertiserScore(story),
    output_dir: path.join(root, "inventory"),
  });

  assert.equal(result.registry.verdict, "HOLD");
  assert.ok(
    result.registry.blockers.includes("owned_motion_asset_ownership_invalid"),
  );
  assert.ok(
    result.registry.blockers.includes(
      "owned_motion_asset_third_party_media_declaration_required",
    ),
  );
  assert.equal(result.rights_ledger, null);
  assert.equal(result.registry.safety.third_party_media_included, false);
});

test("the evergreen adapter accepts pulse-owned URLs only for Pulse Gaming OWNED records", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-editorial-inventory-owner-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const story = canonicalStory();
  const breaking = await breakingEvidence(root, story);
  const motion = ownedMotionEvidence(root, story);
  const result = await prepareGovernedEditorialInventory({
    story,
    breaking_source_evidence: breaking,
    owned_motion_manifest: motion,
    advertiser_safety: safeAdvertiserScore(story),
    output_dir: path.join(root, "inventory"),
  });
  const foreignOwned = structuredClone(result.rights_ledger);
  foreignOwned.items[0].owner = "Unknown uploader";
  foreignOwned.ledger_sha256 = hashRightsLedger(foreignOwned);
  const foreignRights = writeJson(
    path.join(root, "foreign-rights-ledger.json"),
    foreignOwned,
  );

  const adapted = await buildEvergreenAutonomousDiscoveryInputs({
    stories: [
      {
        ...story,
        source_evidence_path: breaking.path,
        source_evidence_file_sha256: breaking.file_sha256,
        source_evidence_sha256: breaking.canonical_sha256,
        rights_ledger_path: foreignRights.path,
        rights_ledger_file_sha256: foreignRights.file_sha256,
        rights_ledger_canonical_sha256: foreignOwned.ledger_sha256,
        advertiser_safety_report_path:
          result.registry.advertiser_safety_report.path,
        advertiser_safety_report_sha256:
          result.registry.advertiser_safety_report.file_sha256,
      },
    ],
    root_dir: root,
    now: NOW,
  });

  assert.equal(adapted.summary.accepted_count, 0);
  assert.ok(
    adapted.rejected_inputs[0].blockers.includes(
      "rights_asset_record_invalid",
    ),
  );
});

test("does not promote editorial corroboration into an official weekly source record", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-editorial-inventory-corroborated-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const story = {
    ...canonicalStory(),
    primary_source_url: PRESS_URL,
  };
  const breaking = await corroboratedBreakingEvidence(root, story);
  assert.equal(breaking.packet.verdict, "CORROBORATED");

  const result = await prepareGovernedEditorialInventory({
    story,
    breaking_source_evidence: breaking,
    owned_motion_manifest: ownedMotionEvidence(root, story),
    advertiser_safety: safeAdvertiserScore(story),
    output_dir: path.join(root, "inventory"),
  });

  assert.equal(result.registry.verdict, "HOLD");
  assert.ok(
    result.registry.blockers.includes(
      "breaking_source_evidence_official_confirmation_required",
    ),
  );
  assert.equal(result.weekly_source_evidence, null);
  assert.equal(result.registry.weekly_source_evidence.path, null);
});

test("atomically promotes a package into an explicitly pre-created empty output directory", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-editorial-inventory-empty-dir-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const story = canonicalStory();
  const outputDir = path.join(root, "inventory");
  fs.mkdirSync(outputDir, { recursive: true });

  const result = await prepareGovernedEditorialInventory({
    story,
    breaking_source_evidence: await breakingEvidence(root, story),
    owned_motion_manifest: ownedMotionEvidence(root, story),
    advertiser_safety: safeAdvertiserScore(story),
    output_dir: outputDir,
  });

  assert.equal(result.registry.verdict, "READY");
  assert.equal(fs.existsSync(result.paths.registry), true);
});

test("refuses to replace an immutable inventory directory with different evidence", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-editorial-inventory-conflict-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const story = canonicalStory();
  const breaking = await breakingEvidence(root, story);
  const motion = ownedMotionEvidence(root, story);
  const outputDir = path.join(root, "inventory");
  await prepareGovernedEditorialInventory({
    story,
    breaking_source_evidence: breaking,
    owned_motion_manifest: motion,
    advertiser_safety: safeAdvertiserScore(story),
    output_dir: outputDir,
  });

  await assert.rejects(
    prepareGovernedEditorialInventory({
      story,
      breaking_source_evidence: breaking,
      owned_motion_manifest: motion,
      advertiser_safety: {
        ...safeAdvertiserScore(story),
        advertiser_safety: 4,
      },
      output_dir: outputDir,
    }),
    /governed_editorial_inventory_immutable_conflict/,
  );
});

test("revalidates and normalises an explicitly hash-bound advertiser safety report", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-editorial-inventory-safety-report-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const story = canonicalStory();
  const sourceReport = writeJson(
    path.join(root, "source-advertiser-safety.json"),
    {
      schema_version: "pulse-advertiser-safety-report-v1",
      story_id: story.id,
      decision: "GREEN",
      advertiser_safety: 5,
      maximum_score: 5,
      hard_stops: [],
      policy_version: "pulse-advertiser-safety-v3",
      scored_at: NOW,
    },
  );

  const result = await prepareGovernedEditorialInventory({
    story,
    breaking_source_evidence: await breakingEvidence(root, story),
    owned_motion_manifest: ownedMotionEvidence(root, story),
    advertiser_safety_report: sourceReport,
    output_dir: path.join(root, "inventory"),
  });

  assert.equal(result.registry.verdict, "READY");
  assert.equal(result.advertiser_safety_report.decision, "SAFE");
  assert.equal(result.advertiser_safety_report.source.kind, "report_file");
  assert.equal(
    result.advertiser_safety_report.source.file_sha256,
    sourceReport.file_sha256,
  );
});

test("rejects symlinked evidence instead of following it", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-editorial-inventory-symlink-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const story = canonicalStory();
  const breaking = await breakingEvidence(root, story);
  const symlinkPath = path.join(root, "breaking-source-link.json");
  try {
    fs.symlinkSync(breaking.path, symlinkPath, "file");
  } catch (error) {
    if (["EPERM", "EACCES"].includes(error?.code)) {
      fs.symlinkSync(path.dirname(breaking.path), symlinkPath, "junction");
    } else {
      throw error;
    }
  }

  const result = await prepareGovernedEditorialInventory({
    story,
    breaking_source_evidence: {
      ...breaking,
      path: symlinkPath,
    },
    owned_motion_manifest: ownedMotionEvidence(root, story),
    advertiser_safety: safeAdvertiserScore(story),
    output_dir: path.join(root, "inventory"),
  });

  assert.equal(result.registry.verdict, "HOLD");
  assert.ok(
    result.registry.blockers.includes(
      "breaking_source_evidence_symlink_forbidden",
    ),
  );
  assert.equal(result.weekly_source_evidence, null);
});
