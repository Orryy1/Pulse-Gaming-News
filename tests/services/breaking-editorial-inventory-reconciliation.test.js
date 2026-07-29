"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  captureBreakingSourceEvidence,
  persistBreakingSourceEvidencePacket,
} = require("../../lib/services/breaking-source-evidence");
const {
  reconcileBreakingEditorialInventory,
} = require("../../lib/services/breaking-editorial-inventory-reconciliation");

const NOW = "2026-07-28T12:00:00.000Z";

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
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
    trusted_editorial: [],
  };
}

async function officialPacket(storyId = "xbox-backcompat") {
  const url = `https://news.xbox.com/en-us/${storyId}/`;
  const claim = "Microsoft confirmed this exact Xbox feature for players.";
  return captureBreakingSourceEvidence({
    story: {
      id: storyId,
      title: "Microsoft confirms an Xbox feature",
      subject_ids: ["xbox"],
      source_candidates: [url],
    },
    sourcePolicy: sourcePolicy(),
    now: NOW,
    fetchCapture: async () => ({
      status: 200,
      final_url: url,
      content_type: "text/plain",
      bytes: Buffer.from(claim),
    }),
    extractClaims: async () => ({
      extractor: { id: "fixture", version: "1" },
      claims: [
        {
          claim_key: `microsoft.xbox.${storyId}`,
          text: claim,
          location: "body",
        },
      ],
    }),
  });
}

async function corroboratedPacket(storyId = "editorial-only") {
  const urls = [
    `https://www.ign.com/articles/${storyId}`,
    `https://www.eurogamer.net/${storyId}`,
  ];
  const claim =
    "Two publications independently report this exact Xbox feature.";
  return captureBreakingSourceEvidence({
    story: {
      id: storyId,
      title: "Two publications report an Xbox feature",
      subject_ids: ["xbox"],
      source_candidates: urls,
    },
    sourcePolicy: {
      official_first_party: [],
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
    },
    now: NOW,
    fetchCapture: async ({ url }) => ({
      status: 200,
      final_url: url,
      content_type: "text/plain",
      bytes: Buffer.from(claim),
    }),
    extractClaims: async () => ({
      extractor: { id: "fixture", version: "1" },
      claims: [
        {
          claim_key: `xbox.${storyId}.report`,
          text: claim,
          location: "body",
        },
      ],
    }),
  });
}

test("recursively reconciles an exact official packet into a read-only LOCAL_PROOF work item", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-breaking-reconciliation-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const packet = await officialPacket();
  const persisted = await persistBreakingSourceEvidencePacket({
    packet,
    outputDir: path.join(root, "2026", "07", "28"),
  });

  const report = await reconcileBreakingEditorialInventory({
    breakingDiscoveryRoot: root,
    now: NOW,
  });

  assert.equal(
    report.schema_version,
    "pulse-breaking-editorial-inventory-reconciliation-v1",
  );
  assert.equal(report.generated_at, NOW);
  assert.equal(report.mode, "LOCAL_PROOF");
  assert.equal(report.verdict, "READY");
  assert.deepEqual(report.work_items, [
    {
      story_id: "xbox-backcompat",
      breaking_source_evidence: {
        path: persisted.path,
        file_sha256: persisted.file_sha256,
        canonical_sha256: persisted.packet_sha256,
      },
    },
  ]);
  assert.deepEqual(report.rejected, []);
  assert.equal(report.safety.read_only, true);
  assert.equal(report.safety.network_used, false);
  assert.equal(report.safety.database_mutated, false);
  assert.equal(report.safety.oauth_mutated, false);
  assert.equal(report.safety.publish_authority_created, false);
});

test("skips a story that is already READY in the governed inventory scan", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-breaking-reconciled-ready-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const packet = await officialPacket("already-governed");
  const persisted = await persistBreakingSourceEvidencePacket({
    packet,
    outputDir: path.join(root, "nested"),
  });

  const report = await reconcileBreakingEditorialInventory({
    breakingDiscoveryRoot: root,
    governedInventoryReport: {
      schema_version: "pulse-governed-editorial-inventory-registry-v1",
      mode: "LOCAL_PROOF",
      entries: [
        {
          story: { id: "already-governed" },
          blockers: [],
        },
      ],
      safety: {
        read_only: true,
        publish_authority_created: false,
      },
    },
    now: NOW,
  });

  assert.equal(report.verdict, "READY");
  assert.deepEqual(report.work_items, []);
  assert.deepEqual(report.skipped, [
    {
      story_id: "already-governed",
      reason: "governed_editorial_inventory_ready",
      breaking_source_evidence: {
        path: persisted.path,
        file_sha256: persisted.file_sha256,
        canonical_sha256: persisted.packet_sha256,
      },
    },
  ]);
  assert.equal(report.summary.skipped_count, 1);
});

test("rejects a valid corroborated packet because inventory preparation requires official confirmation", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-breaking-official-only-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const packet = await corroboratedPacket();
  assert.equal(packet.verdict, "CORROBORATED");
  assert.equal(packet.verification_status, "CONFIRMED");
  assert.equal(packet.verified_for_planning, true);
  await persistBreakingSourceEvidencePacket({
    packet,
    outputDir: root,
  });

  const report = await reconcileBreakingEditorialInventory({
    breakingDiscoveryRoot: root,
    now: NOW,
  });

  assert.equal(report.verdict, "HOLD");
  assert.deepEqual(report.work_items, []);
  assert.equal(report.rejected.length, 1);
  assert.deepEqual(report.rejected[0].blockers, [
    "breaking_source_evidence_official_confirmation_required",
  ]);
});

test("does not traverse a secret-bearing directory even when it contains a valid packet", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-breaking-secret-path-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const packet = await officialPacket("secret-copy");
  await persistBreakingSourceEvidencePacket({
    packet,
    outputDir: path.join(root, "tokens", "breaking"),
  });

  const report = await reconcileBreakingEditorialInventory({
    breakingDiscoveryRoot: root,
    now: NOW,
  });

  assert.equal(report.verdict, "HOLD");
  assert.deepEqual(report.work_items, []);
  assert.ok(
    report.rejected.some((entry) =>
      entry.blockers.includes("breaking_source_evidence_secret_path_forbidden"),
    ),
  );
  assert.equal(report.traversal.candidate_count, 0);
});

test("rejects an explicitly selected secret-bearing root", async (t) => {
  const base = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-breaking-secret-root-"),
  );
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, "tokens", "breaking-discovery");
  const packet = await officialPacket("secret-root-copy");
  await persistBreakingSourceEvidencePacket({
    packet,
    outputDir: root,
  });

  const report = await reconcileBreakingEditorialInventory({
    breakingDiscoveryRoot: root,
    now: NOW,
  });

  assert.equal(report.verdict, "HOLD");
  assert.deepEqual(report.work_items, []);
  assert.deepEqual(report.blockers, [
    "breaking_discovery_root_secret_path_forbidden",
  ]);
  assert.equal(report.traversal.entries_visited, 0);
});

test("rejects a linked directory and never discovers evidence beyond the root", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-breaking-symlink-root-"),
  );
  const external = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-breaking-symlink-external-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  t.after(() => fs.rm(external, { recursive: true, force: true }));
  const packet = await officialPacket("outside-via-link");
  await persistBreakingSourceEvidencePacket({
    packet,
    outputDir: external,
  });
  const linkedPath = path.join(root, "linked");
  try {
    await fs.symlink(
      external,
      linkedPath,
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) {
      t.skip(`symlink creation unavailable: ${error.code}`);
      return;
    }
    throw error;
  }

  const report = await reconcileBreakingEditorialInventory({
    breakingDiscoveryRoot: root,
    now: NOW,
  });

  assert.equal(report.verdict, "HOLD");
  assert.deepEqual(report.work_items, []);
  assert.equal(report.traversal.candidate_count, 0);
  assert.deepEqual(report.rejected, [
    {
      path: linkedPath,
      story_id: null,
      blockers: ["breaking_source_evidence_symlink_forbidden"],
    },
  ]);
});

test("re-hashes persisted bytes instead of trusting an earlier file digest", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-breaking-rehash-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const packet = await officialPacket("rehash-bytes");
  const persisted = await persistBreakingSourceEvidencePacket({
    packet,
    outputDir: root,
  });
  await fs.appendFile(persisted.path, "\n");
  const observedBytes = await fs.readFile(persisted.path);

  const report = await reconcileBreakingEditorialInventory({
    breakingDiscoveryRoot: root,
    now: NOW,
  });

  assert.equal(report.verdict, "READY");
  assert.equal(
    report.work_items[0].breaking_source_evidence.file_sha256,
    sha256(observedBytes),
  );
  assert.notEqual(
    report.work_items[0].breaking_source_evidence.file_sha256,
    persisted.file_sha256,
  );
  assert.equal(
    report.work_items[0].breaking_source_evidence.canonical_sha256,
    persisted.packet_sha256,
  );
});

test("revalidates packet content and rejects a forged persisted claim binding", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-breaking-forged-packet-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const packet = await officialPacket("forged-packet");
  const persisted = await persistBreakingSourceEvidencePacket({
    packet,
    outputDir: root,
  });
  const forged = JSON.parse(await fs.readFile(persisted.path, "utf8"));
  forged.primary_source_url = "https://news.xbox.com/en-us/a-different-story/";
  await fs.writeFile(persisted.path, `${JSON.stringify(forged, null, 2)}\n`);

  const report = await reconcileBreakingEditorialInventory({
    breakingDiscoveryRoot: root,
    now: NOW,
  });

  assert.equal(report.verdict, "HOLD");
  assert.deepEqual(report.work_items, []);
  assert.equal(report.rejected.length, 1);
  assert.ok(
    report.rejected[0].blockers.includes(
      "breaking_source_packet_sha256_mismatch",
    ),
  );
  assert.ok(
    report.rejected[0].blockers.includes(
      "breaking_source_planner_evidence_mismatch",
    ),
  );
});

test("an untrusted inventory report cannot suppress an exact work item", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-breaking-untrusted-inventory-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const packet = await officialPacket("not-suppressed");
  await persistBreakingSourceEvidencePacket({
    packet,
    outputDir: root,
  });

  const report = await reconcileBreakingEditorialInventory({
    breakingDiscoveryRoot: root,
    governedInventoryReport: {
      schema_version: "forged-inventory-report",
      mode: "LOCAL_PROOF",
      entries: [
        {
          story: { id: "not-suppressed" },
          blockers: [],
        },
      ],
      safety: {
        read_only: true,
        publish_authority_created: false,
      },
    },
    now: NOW,
  });

  assert.equal(report.verdict, "HOLD");
  assert.equal(report.work_items.length, 1);
  assert.deepEqual(report.skipped, []);
  assert.deepEqual(report.blockers, [
    "governed_editorial_inventory_report_invalid",
  ]);
});

test("stops at the explicit traversal cap and reports the incomplete scan", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-breaking-cap-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "a-unrelated.txt"), "fixture");
  const packet = await officialPacket("beyond-cap");
  await persistBreakingSourceEvidencePacket({
    packet,
    outputDir: path.join(root, "z-nested"),
  });

  const first = await reconcileBreakingEditorialInventory({
    breakingDiscoveryRoot: root,
    maximumEntries: 1,
    now: NOW,
  });
  const second = await reconcileBreakingEditorialInventory({
    breakingDiscoveryRoot: root,
    maximumEntries: 1,
    now: NOW,
  });

  assert.equal(first.verdict, "HOLD");
  assert.deepEqual(first, second);
  assert.ok(
    first.blockers.includes("breaking_discovery_traversal_limit_reached"),
  );
  assert.equal(first.traversal.limit_reached, true);
  assert.equal(first.traversal.entries_visited, 1);
  assert.deepEqual(first.work_items, []);
});
