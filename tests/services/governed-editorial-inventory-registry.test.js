"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  scanGovernedEditorialInventory,
} = require("../../lib/services/governed-editorial-inventory-registry");
const {
  buildReadyInventoryFixture,
  canonicalSha256,
  writeJson,
} = require("../helpers/governed-editorial-inventory-fixture");

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function writeFile(filePath, value) {
  const bytes = Buffer.isBuffer(value)
    ? value
    : Buffer.from(
        typeof value === "string"
          ? value
          : `${JSON.stringify(value, null, 2)}\n`,
        "utf8",
      );
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, bytes);
  return sha256(bytes);
}

function buildInventory(
  root,
  storyId = "inventory-story-1",
  {
    direct = false,
    generatedAt = "2026-07-28T12:00:00.000Z",
    title = "Halo progression has a better answer",
  } = {},
) {
  const storyRoot = direct ? root : path.join(root, storyId);
  const primarySourceUrl =
    "https://news.xbox.com/en-us/halo-progression/";
  const breakingPath = path.join(storyRoot, "breaking-source.json");
  const weeklyPath = path.join(storyRoot, "weekly-source.json");
  const rightsPath = path.join(storyRoot, "rights-ledger.json");
  const motionPath = path.join(storyRoot, "owned-motion-manifest.json");
  const advertiserPath = path.join(
    storyRoot,
    "advertiser-safety.json",
  );
  const breakingCanonical = sha256("breaking-canonical");
  const rightsCanonical = sha256("rights-canonical");
  const refs = {
    breaking_source_evidence: {
      path: breakingPath,
      file_sha256: writeFile(breakingPath, { story_id: storyId }),
      canonical_sha256: breakingCanonical,
    },
    weekly_source_evidence: {
      path: weeklyPath,
      file_sha256: writeFile(weeklyPath, {
        story_id: storyId,
        source_url: primarySourceUrl,
        claims: [
          {
            claim_key: "halo.progression.answer",
            text: "Halo progression has a better answer.",
          },
        ],
      }),
    },
    rights_ledger: {
      path: rightsPath,
      file_sha256: writeFile(rightsPath, { story_id: storyId }),
      canonical_sha256: rightsCanonical,
    },
    owned_motion_manifest: {
      path: motionPath,
      file_sha256: writeFile(motionPath, { story_id: storyId }),
    },
    advertiser_safety_report: {
      path: advertiserPath,
      file_sha256: writeFile(advertiserPath, {
        story_id: storyId,
      }),
    },
  };
  const registryPath = path.join(
    storyRoot,
    "governed-editorial-inventory.json",
  );
  writeFile(registryPath, {
    schema_version: "pulse-governed-editorial-inventory-v1",
    generated_at: generatedAt,
    verdict: "READY",
    story: {
      id: storyId,
      title,
      franchise: "Halo",
      platform: "xbox",
      topic_key: "multiplayer-progression",
      published_at: "2026-07-28T10:00:00.000Z",
      primary_source_url:
        primarySourceUrl,
      verification_status: "CONFIRMED",
    },
    ...refs,
    blockers: [],
    safety: {
      local_proof: true,
      database_mutated: false,
      network_used: false,
      oauth_mutated: false,
      platform_contacted: false,
      publish_authority_created: false,
    },
  });
  return { registryPath, refs };
}

test("selects the newest valid bound revision from one governed story lineage", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-editorial-inventory-revisions-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const storyId = "same-governed-story";
  const revisionsRoot = path.join(root, storyId, "revisions");
  const older = buildInventory(
    path.join(revisionsRoot, "1".repeat(64), "inventory"),
    storyId,
    {
      direct: true,
      generatedAt: "2026-07-28T12:00:00.000Z",
    },
  );
  const newer = buildInventory(
    path.join(revisionsRoot, "2".repeat(64), "inventory"),
    storyId,
    {
      direct: true,
      generatedAt: "2026-07-28T13:00:00.000Z",
    },
  );

  const report = await scanGovernedEditorialInventory({
    rootDir: root,
  });

  assert.equal(report.verdict, "READY");
  assert.equal(report.summary.registry_count, 2);
  assert.equal(report.summary.ready_count, 1);
  assert.equal(report.summary.rejected_count, 0);
  assert.equal(report.entries.length, 1);
  assert.equal(report.entries[0].story.id, storyId);
  assert.equal(report.entries[0].registry_path, newer.registryPath);
  assert.notEqual(report.entries[0].registry_path, older.registryPath);
  assert.equal(report.evergreen_stories.length, 1);
  assert.equal(report.weekly_longform_candidates.length, 1);
});

test("breaks equal revision timestamps by the bound registry hash, not discovery order", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-editorial-inventory-revision-tie-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const storyId = "same-time-governed-story";
  const revisionsRoot = path.join(root, storyId, "revisions");
  buildInventory(
    path.join(revisionsRoot, "a".repeat(64), "inventory"),
    storyId,
    {
      direct: true,
      generatedAt: "2026-07-28T12:00:00.000Z",
    },
  );
  buildInventory(
    path.join(revisionsRoot, "b".repeat(64), "inventory"),
    storyId,
    {
      direct: true,
      generatedAt: "2026-07-28T12:00:00.000Z",
    },
  );

  const report = await scanGovernedEditorialInventory({
    rootDir: root,
  });
  const assessed = await Promise.all(
    (
      await fs.promises.readdir(revisionsRoot)
    ).map(async (revision) => {
      const registryPath = path.join(
        revisionsRoot,
        revision,
        "inventory",
        "governed-editorial-inventory.json",
      );
      return {
        registryPath,
        fileSha256: sha256(await fs.promises.readFile(registryPath)),
      };
    }),
  );
  const expected = assessed.sort(
    (left, right) =>
      right.fileSha256.localeCompare(left.fileSha256) ||
      right.registryPath.localeCompare(left.registryPath),
  )[0];

  assert.equal(report.verdict, "READY");
  assert.equal(report.entries.length, 1);
  assert.equal(report.entries[0].registry_path, expected.registryPath);
});

test("promotes a refresh revision captured after a later-stamped legacy inventory", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-editorial-inventory-migration-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const storyId = "migrated-governed-story";
  const storyRoot = path.join(root, storyId);
  const legacy = buildInventory(
    path.join(storyRoot, "inventory"),
    storyId,
    {
      direct: true,
      generatedAt: "2026-07-28T12:00:00.000Z",
    },
  );
  const revision = buildInventory(
    path.join(
      storyRoot,
      "revisions",
      "c".repeat(64),
      "inventory",
    ),
    storyId,
    {
      direct: true,
      generatedAt: "2026-07-28T14:05:00.000Z",
    },
  );

  const report = await scanGovernedEditorialInventory({
    rootDir: root,
  });

  assert.equal(report.verdict, "READY");
  assert.equal(report.summary.registry_count, 2);
  assert.equal(report.summary.ready_count, 1);
  assert.equal(report.summary.rejected_count, 0);
  assert.equal(report.entries[0].registry_path, revision.registryPath);
  assert.notEqual(report.entries[0].registry_path, legacy.registryPath);
  assert.deepEqual(report.entries[0].revision_lineage, {
    lineage_root: storyRoot,
    revision_sha256: "c".repeat(64),
    physical_revision_count: 2,
  });
});

test("revalidates exact files and emits lane-native candidates without mutating state", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-editorial-inventory-registry-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixture = buildInventory(root);

  const report = await scanGovernedEditorialInventory({
    rootDir: root,
  });

  assert.equal(report.verdict, "READY");
  assert.equal(report.entries.length, 1);
  assert.equal(report.rejected.length, 0);
  assert.equal(report.evergreen_stories.length, 1);
  assert.equal(report.weekly_longform_candidates.length, 1);
  const evergreen = report.evergreen_stories[0];
  const extra = JSON.parse(evergreen._extra);
  assert.equal(
    extra.source_evidence_path,
    fixture.refs.breaking_source_evidence.path,
  );
  assert.equal(
    extra.source_evidence_sha256,
    fixture.refs.breaking_source_evidence.canonical_sha256,
  );
  assert.equal(
    extra.rights_ledger_canonical_sha256,
    fixture.refs.rights_ledger.canonical_sha256,
  );
  assert.equal(
    extra.advertiser_safety_report_path,
    fixture.refs.advertiser_safety_report.path,
  );

  const weekly = report.weekly_longform_candidates[0];
  assert.equal(weekly.verification_status, "CONFIRMED");
  assert.deepEqual(weekly.source_evidence, {
    path: fixture.refs.weekly_source_evidence.path,
    sha256: fixture.refs.weekly_source_evidence.file_sha256,
  });
  assert.deepEqual(weekly.rights_ledger, {
    path: fixture.refs.rights_ledger.path,
    sha256: fixture.refs.rights_ledger.file_sha256,
  });
  assert.equal(report.safety.read_only, true);
  assert.equal(report.safety.publish_authority_created, false);
});

test("holds a tampered binding instead of returning it to either lane", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-editorial-inventory-tamper-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixture = buildInventory(root);
  fs.appendFileSync(
    fixture.refs.rights_ledger.path,
    "\nchanged-after-registry\n",
  );

  const report = await scanGovernedEditorialInventory({
    rootDir: root,
  });

  assert.equal(report.verdict, "HOLD");
  assert.equal(report.entries.length, 0);
  assert.equal(report.rejected.length, 1);
  assert.ok(
    report.rejected[0].blockers.includes(
      "rights_ledger_file_sha256_mismatch",
    ),
  );
  assert.deepEqual(report.evergreen_stories, []);
  assert.deepEqual(report.weekly_longform_candidates, []);
});

test("keeps a manifest with no story identity visible as rejected", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-editorial-inventory-no-identity-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixture = buildInventory(root);
  const registry = JSON.parse(
    fs.readFileSync(fixture.registryPath, "utf8"),
  );
  registry.story.id = "";
  writeFile(fixture.registryPath, registry);

  const report = await scanGovernedEditorialInventory({
    rootDir: root,
  });

  assert.equal(report.verdict, "HOLD");
  assert.equal(report.entries.length, 0);
  assert.equal(report.rejected.length, 1);
  assert.ok(
    report.rejected[0].blockers.includes(
      "editorial_inventory_story_id_required",
    ),
  );
});

test("holds a hash-consistent workspace when its story identity belongs to different source claims", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-editorial-inventory-identity-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixture = buildReadyInventoryFixture(root, {
    storyId: "rss_cross_story_identity",
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

  const report = await scanGovernedEditorialInventory({
    rootDir: fixture.inventoryRoot,
    allowedRoots: [fixture.outputRoot],
  });

  assert.equal(report.verdict, "HOLD");
  assert.equal(report.entries.length, 0);
  assert.equal(report.rejected.length, 1);
  assert.ok(
    report.rejected[0].blockers.includes(
      "editorial_inventory_story_source_claim_identity_mismatch",
    ),
  );
  assert.deepEqual(report.evergreen_stories, []);
  assert.deepEqual(report.weekly_longform_candidates, []);
});

test("rejects duplicate story identities and references that escape the registry root", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-editorial-inventory-ambiguous-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  buildInventory(
    path.join(root, "one", "same-story", "inventory"),
    "same-story",
    { direct: true },
  );
  buildInventory(
    path.join(root, "two", "same-story", "inventory"),
    "same-story",
    { direct: true },
  );

  const duplicateReport = await scanGovernedEditorialInventory({
    rootDir: root,
  });
  assert.equal(duplicateReport.verdict, "HOLD");
  assert.equal(duplicateReport.entries.length, 0);
  assert.equal(duplicateReport.rejected.length, 2);
  assert.ok(
    duplicateReport.rejected.every((entry) =>
      entry.blockers.includes("editorial_inventory_story_id_duplicate"),
    ),
  );

  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const escaped = buildInventory(root, "escaped-story");
  const registry = JSON.parse(
    fs.readFileSync(escaped.registryPath, "utf8"),
  );
  const outside = path.join(path.dirname(root), "outside-rights.json");
  registry.rights_ledger.path = outside;
  registry.rights_ledger.file_sha256 = writeFile(outside, {
    story_id: "escaped-story",
  });
  writeFile(escaped.registryPath, registry);
  t.after(() => fs.rmSync(outside, { force: true }));

  const escapedReport = await scanGovernedEditorialInventory({
    rootDir: root,
  });
  assert.equal(escapedReport.verdict, "HOLD");
  assert.ok(
    escapedReport.rejected[0].blockers.includes(
      "rights_ledger_path_outside_inventory_root",
    ),
  );
});

test("does not follow symlinked registry files", async (t) => {
  if (process.platform === "win32") {
    // Creating symlinks can require an elevated Windows token. The
    // containment and lstat checks are exercised on supported hosts.
    return;
  }
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-editorial-inventory-symlink-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const external = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-editorial-inventory-external-"),
  );
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  const fixture = buildInventory(external, "linked-story");
  const linkedDir = path.join(root, "linked-story");
  fs.mkdirSync(linkedDir, { recursive: true });
  fs.symlinkSync(
    fixture.registryPath,
    path.join(linkedDir, "governed-editorial-inventory.json"),
  );

  const report = await scanGovernedEditorialInventory({
    rootDir: root,
  });
  assert.equal(report.verdict, "HOLD");
  assert.equal(report.entries.length, 0);
  assert.ok(
    report.rejected[0].blockers.includes(
      "editorial_inventory_registry_file_invalid",
    ),
  );
});
