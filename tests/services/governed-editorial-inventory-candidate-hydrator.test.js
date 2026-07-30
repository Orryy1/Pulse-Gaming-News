"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  hydrateGovernedEditorialInventoryCandidates,
} = require("../../lib/services/governed-editorial-inventory-candidate-hydrator");
const {
  buildOfficialSourceReleaseBinding,
} = require("../../lib/services/official-source-revalidation");
const {
  buildReadyInventoryFixture,
  canonicalSha256,
  writeJson,
} = require("../helpers/governed-editorial-inventory-fixture");
const {
  buildGovernedStoryIntakeInventoryBridgeFixture,
} = require("../fixtures/governed-story-intake-inventory-bridge");

test("hydrates an exact breaking candidate only from a live READY inventory with canonical source and rights bindings", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-inventory-candidate-hydration-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixture = buildReadyInventoryFixture(root);

  const result =
    await hydrateGovernedEditorialInventoryCandidates({
      candidates: [
        {
          lane_id: "breaking_short",
          story_id: fixture.storyId,
          title: "Canonical DB candidate",
          score: 95,
          stage: "PLANNING",
        },
      ],
      inventoryRoot: fixture.inventoryRoot,
      allowedRoots: [fixture.outputRoot],
    });

  assert.equal(result.verdict, "READY");
  assert.equal(result.hydrated.length, 1);
  assert.deepEqual(result.rejected, []);
  const candidate = result.candidates[0];
  assert.equal(candidate.verification_status, "CONFIRMED");
  assert.equal(candidate.verified_for_planning, true);
  assert.equal(
    candidate.primary_source_url,
    fixture.primarySourceUrl,
  );
  assert.equal(
    candidate.source_evidence_path,
    fixture.sourcePath,
  );
  assert.equal(
    candidate.source_evidence_file_sha256,
    fixture.sourceFileSha256,
  );
  assert.equal(
    candidate.source_evidence_sha256,
    fixture.sourcePacket.packet_sha256,
  );
  assert.equal(
    candidate.publication_source_evidence_path,
    fixture.weeklyPath,
  );
  assert.equal(
    candidate.publication_source_evidence_sha256,
    fixture.weeklyFileSha256,
  );
  assert.deepEqual(
    candidate.official_source_release_binding,
    buildOfficialSourceReleaseBinding({
      storyId: fixture.storyId,
      sourceEvidenceSha256: fixture.weeklyFileSha256,
      sourceEvidence: fixture.weeklySourceEvidence,
    }),
  );
  assert.equal(candidate.rights_ledger_path, fixture.rightsPath);
  assert.equal(
    candidate.rights_ledger_file_sha256,
    fixture.rightsFileSha256,
  );
  assert.equal(
    candidate.rights_ledger_canonical_sha256,
    fixture.ledger.ledger_sha256,
  );
  assert.deepEqual(
    candidate.governed_editorial_inventory_bindings,
    {
      schema_version:
        "pulse-governed-editorial-inventory-planner-bindings-v1",
      story_id: fixture.storyId,
      inventory: {
        path: fixture.registryPath,
        file_sha256: fixture.registryFileSha256,
        canonical_sha256: fixture.registry.inventory_sha256,
      },
      source_evidence: {
        path: fixture.sourcePath,
        file_sha256: fixture.sourceFileSha256,
        canonical_sha256: fixture.sourcePacket.packet_sha256,
      },
      publication_source_evidence: {
        path: fixture.weeklyPath,
        file_sha256: fixture.weeklyFileSha256,
        source_evidence_sha256: fixture.weeklyFileSha256,
        official_source_release_binding:
          buildOfficialSourceReleaseBinding({
            storyId: fixture.storyId,
            sourceEvidenceSha256: fixture.weeklyFileSha256,
            sourceEvidence: fixture.weeklySourceEvidence,
          }),
      },
      rights_ledger: {
        path: fixture.rightsPath,
        file_sha256: fixture.rightsFileSha256,
        canonical_sha256: fixture.ledger.ledger_sha256,
      },
    },
  );
  assert.deepEqual(candidate.governed_source_evidence, {
    verification_status: "CONFIRMED",
    verified_for_planning: true,
    primary_source_url: fixture.primarySourceUrl,
    source_evidence_sha256:
      fixture.sourcePacket.packet_sha256,
    path: fixture.sourcePath,
    file_sha256: fixture.sourceFileSha256,
  });
  assert.deepEqual(result.safety, {
    read_only: true,
    network_used: false,
    database_mutated: false,
    oauth_mutated: false,
    platform_contacted: false,
    publish_authority_created: false,
  });
});

test("uses the exact live READY entry even when an unrelated stale inventory makes the aggregate scan HOLD", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-inventory-candidate-live-entry-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixture = buildReadyInventoryFixture(root);
  const staleFixture = buildReadyInventoryFixture(root, {
    storyId: "rss_unrelated_stale_inventory",
    primarySourceUrl:
      "https://news.xbox.com/en-us/2026/07/28/unrelated/",
  });
  fs.appendFileSync(
    staleFixture.rightsPath,
    "\nchanged-after-inventory\n",
  );

  const result =
    await hydrateGovernedEditorialInventoryCandidates({
      candidates: [
        {
          lane_id: "breaking_short",
          story_id: fixture.storyId,
          stage: "PLANNING",
        },
      ],
      inventoryRoot: fixture.inventoryRoot,
      allowedRoots: [fixture.outputRoot],
    });

  assert.equal(result.scan.verdict, "HOLD");
  assert.equal(result.scan.summary.rejected_count, 1);
  assert.equal(result.verdict, "READY");
  assert.equal(result.hydrated[0].story_id, fixture.storyId);
  assert.equal(
    result.candidates[0].source_evidence_sha256,
    fixture.sourcePacket.packet_sha256,
  );
});

test("exposes only the exact bounded confirmed claim keys and text after the READY inventory has passed hydration", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-inventory-candidate-claims-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixture =
    await buildGovernedStoryIntakeInventoryBridgeFixture(root);

  const result =
    await hydrateGovernedEditorialInventoryCandidates({
      candidates: [
        {
          lane_id: "breaking_short",
          story_id: fixture.storyId,
          stage: "PLANNING",
        },
      ],
      inventoryRoot: fixture.inventoryRoot,
      allowedRoots: [fixture.outputRoot],
    });

  assert.equal(result.verdict, "READY");
  assert.deepEqual(
    result.hydrated[0].confirmed_claims,
    fixture.packet.confirmed_claims.map((group) => ({
      claim_key: group.claim_key,
      text: group.evidence[0].text,
    })),
  );
  assert.equal(
    result.hydrated[0].source_evidence_sha256,
    fixture.packet.packet_sha256,
  );
  assert.equal(
    result.hydrated[0].inventory_file_sha256,
    fixture.registryFileSha256,
  );
  assert.equal(
    Object.hasOwn(
      result.candidates[0],
      "confirmed_claims",
    ),
    false,
  );
});

test("does not hydrate a hash-consistent inventory whose title belongs to different claims", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-inventory-cross-story-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixture = buildReadyInventoryFixture(root, {
    storyId: "rss_cross_story_hydration",
  });
  const registry = JSON.parse(
    fs.readFileSync(fixture.registryPath, "utf8"),
  );
  registry.story = {
    ...registry.story,
    title:
      "Clair Obscur: Expedition 33 devs are working on a Nintendo Switch 2 version",
    franchise: "Nintendo",
    platform: "nintendo switch",
    topic_key: "clair-obscur-expedition-33-switch-2",
  };
  delete registry.inventory_sha256;
  registry.inventory_sha256 = canonicalSha256(registry);
  writeJson(fixture.registryPath, registry);

  const result =
    await hydrateGovernedEditorialInventoryCandidates({
      candidates: [
        {
          lane_id: "breaking_short",
          story_id: fixture.storyId,
          stage: "PLANNING",
        },
      ],
      inventoryRoot: fixture.inventoryRoot,
      allowedRoots: [fixture.outputRoot],
    });

  assert.equal(result.verdict, "HOLD");
  assert.equal(result.hydrated.length, 0);
  assert.deepEqual(result.candidates, []);
  assert.ok(
    result.rejected[0].blockers.includes(
      "editorial_inventory_story_source_claim_identity_mismatch",
    ),
  );
});

test("fails closed when file hashes are refreshed around a source packet whose canonical binding is stale", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-inventory-source-canonical-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixture = buildReadyInventoryFixture(root);
  const sourcePacket = JSON.parse(
    fs.readFileSync(fixture.sourcePath, "utf8"),
  );
  sourcePacket.confirmed_claims[0].claim_key =
    "tampered.claim.with.stale.canonical.hash";
  const sourceFileSha256 = writeJson(
    fixture.sourcePath,
    sourcePacket,
  );
  const registry = JSON.parse(
    fs.readFileSync(fixture.registryPath, "utf8"),
  );
  registry.breaking_source_evidence.file_sha256 =
    sourceFileSha256;
  delete registry.inventory_sha256;
  registry.inventory_sha256 = canonicalSha256(registry);
  writeJson(fixture.registryPath, registry);

  const result =
    await hydrateGovernedEditorialInventoryCandidates({
      candidates: [
        {
          lane_id: "breaking_short",
          story_id: fixture.storyId,
          stage: "PLANNING",
        },
      ],
      inventoryRoot: fixture.inventoryRoot,
      allowedRoots: [fixture.outputRoot],
    });

  assert.equal(result.verdict, "HOLD");
  assert.equal(result.hydrated.length, 0);
  assert.ok(
    result.rejected[0].blockers.includes(
      "breaking_source_packet_sha256_mismatch",
    ),
  );
});

test("fails closed when a rights ledger changes behind a refreshed file and inventory hash", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-inventory-rights-canonical-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixture = buildReadyInventoryFixture(root);
  const ledger = JSON.parse(
    fs.readFileSync(fixture.rightsPath, "utf8"),
  );
  ledger.items[0].rights_basis = "LICENSED";
  const rightsFileSha256 = writeJson(fixture.rightsPath, ledger);
  const registry = JSON.parse(
    fs.readFileSync(fixture.registryPath, "utf8"),
  );
  registry.rights_ledger.file_sha256 = rightsFileSha256;
  delete registry.inventory_sha256;
  registry.inventory_sha256 = canonicalSha256(registry);
  writeJson(fixture.registryPath, registry);

  const result =
    await hydrateGovernedEditorialInventoryCandidates({
      candidates: [
        {
          lane_id: "breaking_short",
          story_id: fixture.storyId,
          stage: "PLANNING",
        },
      ],
      inventoryRoot: fixture.inventoryRoot,
      allowedRoots: [fixture.outputRoot],
    });

  assert.equal(result.verdict, "HOLD");
  assert.equal(result.hydrated.length, 0);
  assert.ok(
    result.rejected[0].blockers.includes(
      "rights_ledger_canonical_sha256_mismatch",
    ),
  );
});

test("fails closed on escaped refs and conflicting pre-existing candidate hashes", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-inventory-containment-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixture = buildReadyInventoryFixture(root);
  const conflicting =
    await hydrateGovernedEditorialInventoryCandidates({
      candidates: [
        {
          lane_id: "breaking_short",
          story_id: fixture.storyId,
          stage: "PLANNING",
          source_evidence_sha256: "f".repeat(64),
        },
      ],
      inventoryRoot: fixture.inventoryRoot,
      allowedRoots: [fixture.outputRoot],
    });
  assert.equal(conflicting.verdict, "HOLD");
  assert.deepEqual(conflicting.candidates, []);
  assert.ok(
    conflicting.rejected[0].blockers.includes(
      "candidate_source_evidence_canonical_sha256_mismatch",
    ),
  );

  const nestedConflicting =
    await hydrateGovernedEditorialInventoryCandidates({
      candidates: [
        {
          lane_id: "breaking_short",
          story_id: fixture.storyId,
          stage: "PLANNING",
          governed_source_evidence: {
            verification_status: "CONFIRMED",
            verified_for_planning: true,
            primary_source_url: fixture.primarySourceUrl,
            source_evidence_sha256: "e".repeat(64),
            path: fixture.sourcePath,
            file_sha256: fixture.sourceFileSha256,
          },
        },
      ],
      inventoryRoot: fixture.inventoryRoot,
      allowedRoots: [fixture.outputRoot],
    });
  assert.equal(nestedConflicting.verdict, "HOLD");
  assert.deepEqual(nestedConflicting.candidates, []);
  assert.ok(
    nestedConflicting.rejected[0].blockers.includes(
      "candidate_governed_source_evidence_mismatch",
    ),
  );

  const outsideSourcePath = path.join(
    root,
    "outside",
    "source-evidence.json",
  );
  const outsideSourceFileSha256 = writeJson(
    outsideSourcePath,
    fixture.sourcePacket,
  );
  const registry = JSON.parse(
    fs.readFileSync(fixture.registryPath, "utf8"),
  );
  registry.breaking_source_evidence.path = outsideSourcePath;
  registry.breaking_source_evidence.file_sha256 =
    outsideSourceFileSha256;
  delete registry.inventory_sha256;
  registry.inventory_sha256 = canonicalSha256(registry);
  writeJson(fixture.registryPath, registry);

  const escaped =
    await hydrateGovernedEditorialInventoryCandidates({
      candidates: [
        {
          lane_id: "breaking_short",
          story_id: fixture.storyId,
          stage: "PLANNING",
        },
      ],
      inventoryRoot: fixture.inventoryRoot,
      allowedRoots: [fixture.outputRoot],
    });
  assert.equal(escaped.verdict, "HOLD");
  assert.equal(escaped.hydrated.length, 0);
  assert.deepEqual(escaped.candidates, []);
  assert.ok(
    escaped.rejected[0].blockers.includes(
      "breaking_source_evidence_path_outside_inventory_root",
    ),
  );
});
