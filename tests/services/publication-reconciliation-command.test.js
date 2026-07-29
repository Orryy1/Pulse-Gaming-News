"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const {
  executePublicationReconciliationCommand,
  openReadOnlyReconciliationRepos,
} = require("../../lib/ops/publication-reconciliation-command");
const {
  createYoutubePublicObjectVerifier,
} = require("../../lib/services/youtube-public-object-verifier");

const candidate = {
  platform_post_id: 42,
  story_id: "story-42",
  channel_id: "pulse-gaming",
  platform: "youtube",
  status: "failed",
  external_id: "yt-public-42",
  external_url: "https://www.youtube.com/watch?v=yt-public-42",
};

function reposWith(candidates = [candidate]) {
  return {
    publicationGovernance: {
      listReconciliationCandidates() {
        return candidates;
      },
    },
    platformPosts: {},
    db: {},
  };
}

test("operator command defaults to read-only candidate inventory", async () => {
  let verifierCalls = 0;
  let reconcileCalls = 0;
  let inventoryOptions;
  const now = new Date("2026-07-27T12:00:00.000Z");
  const report = await executePublicationReconciliationCommand({
    repos: {
      ...reposWith(),
      publicationGovernance: {
        listReconciliationCandidates(options) {
          inventoryOptions = options;
          return [candidate];
        },
      },
    },
    now,
    verifyPlatformObject: async () => {
      verifierCalls += 1;
    },
    reconcile: async () => {
      reconcileCalls += 1;
    },
  });

  assert.equal(report.mode, "inventory");
  assert.equal(report.dry_run, true);
  assert.equal(report.candidate_count, 1);
  assert.deepEqual(report.mutations_performed, []);
  assert.equal(verifierCalls, 0);
  assert.equal(reconcileCalls, 0);
  assert.equal(inventoryOptions.now, now);
});

test("read-only reconciliation inventory cannot migrate or mutate the database", async () => {
  const root = path.resolve(__dirname, "..", "..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-reconcile-ro-"));
  const dbPath = path.join(dir, "pulse.db");
  const setup = new Database(dbPath);
  for (const filename of fs
    .readdirSync(path.join(root, "db", "migrations"))
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort()) {
    setup.exec(
      fs.readFileSync(
        path.join(root, "db", "migrations", filename),
        "utf8",
      ),
    );
  }
  setup.close();
  const hash = () =>
    crypto.createHash("sha256").update(fs.readFileSync(dbPath)).digest("hex");
  const before = hash();
  const opened = openReadOnlyReconciliationRepos(dbPath);
  try {
    const report = await executePublicationReconciliationCommand({
      repos: opened.repos,
    });
    assert.equal(report.mode, "inventory");
  } finally {
    opened.close();
  }
  assert.equal(hash(), before);
});

test("apply request stays dry-run without both environment and candidate gates", async () => {
  let received;
  const report = await executePublicationReconciliationCommand({
    repos: reposWith(),
    candidateId: 42,
    applyRequested: true,
    confirmationId: 42,
    env: {},
    verifyPlatformObject: async () => ({
      confirmed: true,
      externalId: candidate.external_id,
      verifiedAt: "2026-07-27T12:00:00.000Z",
      evidence: { public: true },
    }),
    reconcile: async (input) => {
      received = input;
      return {
        applied: false,
        ready_to_apply: true,
        blockers: ["explicit_apply_authorisation_required"],
        mutations_performed: [],
      };
    },
  });

  assert.equal(received.apply, false);
  assert.equal(report.mode, "dry_run");
  assert.equal(report.dry_run, true);
  assert.ok(
    report.command_blockers.includes(
      "reconciliation_apply_environment_gate_required",
    ),
  );
});

test("apply fails closed outside an explicit primary HUMAN_REVIEW maintenance window", async () => {
  let received;
  const report = await executePublicationReconciliationCommand({
    repos: reposWith(),
    candidateId: 42,
    applyRequested: true,
    confirmationId: 42,
    env: {
      PULSE_RECONCILIATION_APPLY: "true",
    },
    verifyPlatformObject: async () => ({
      confirmed: true,
      externalId: candidate.external_id,
      verifiedAt: "2026-07-27T12:00:00.000Z",
      evidence: { public: true },
    }),
    reconcile: async (input) => {
      received = input;
      return {
        applied: false,
        ready_to_apply: true,
        blockers: ["explicit_apply_authorisation_required"],
        mutations_performed: [],
      };
    },
  });

  assert.equal(received.apply, false);
  assert.deepEqual(report.command_blockers, [
    "reconciliation_human_review_mode_required",
    "reconciliation_maintenance_mode_required",
    "reconciliation_kill_switch_required",
    "reconciliation_primary_instance_required",
    "reconciliation_change_window_id_required",
  ]);
  assert.equal(report.mode, "dry_run");
  assert.equal(report.dry_run, true);
});

test("apply reaches the service only with the complete maintenance contract", async () => {
  let received;
  const report = await executePublicationReconciliationCommand({
    repos: reposWith(),
    candidateId: 42,
    applyRequested: true,
    confirmationId: 42,
    env: {
      PULSE_RECONCILIATION_APPLY: "true",
      PULSE_OPERATING_MODE: "HUMAN_REVIEW",
      PULSE_RECONCILIATION_MAINTENANCE: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "true",
      PULSE_PRIMARY_INSTANCE: "true",
      PULSE_RECONCILIATION_CHANGE_WINDOW_ID: "change-window-42",
      RECONCILIATION_OPERATOR_APPROVED: "true",
      RECONCILIATION_OPERATOR_ID: "operator-1",
      RECONCILIATION_REASON: "Verified legacy YouTube publication",
      RECONCILIATION_BACKUP_VERIFIED: "true",
      RECONCILIATION_BACKUP_ID: "backup-1",
      RECONCILIATION_BACKUP_SHA256: "a".repeat(64),
      RECONCILIATION_BACKUP_VERIFIED_AT: "2026-07-27T11:00:00.000Z",
    },
    now: new Date("2026-07-27T12:00:00.000Z"),
    verifyPlatformObject: async () => ({
      confirmed: true,
      externalId: candidate.external_id,
      verifiedAt: "2026-07-27T12:00:00.000Z",
      evidence: { public: true },
    }),
    reconcile: async (input) => {
      received = input;
      return {
        applied: true,
        blockers: [],
        mutations_performed: ["platform_posts"],
      };
    },
  });

  assert.equal(received.apply, true);
  assert.equal(received.operatorDecision.actorId, "operator-1");
  assert.equal(
    received.operatorDecision.changeWindowId,
    "change-window-42",
  );
  assert.equal(received.backupEvidence.backup_id, "backup-1");
  assert.equal(report.mode, "apply");
  assert.equal(report.dry_run, false);
  assert.equal(report.change_window_id, "change-window-42");
  assert.equal(report.result.applied, true);
});

test("YouTube verifier distinguishes existence from public visibility", async () => {
  const calls = [];
  const verifier = createYoutubePublicObjectVerifier({
    now: () => new Date("2026-07-27T12:00:00.000Z"),
    maxAttempts: 1,
    sleep: async () => {},
    youtubeClient: {
      videos: {
        async list(input) {
          calls.push(input);
          return {
            data: {
              items: [
                {
                  id: "yt-private-1",
                  status: {
                    privacyStatus: "private",
                    uploadStatus: "processed",
                  },
                },
              ],
            },
          };
        },
      },
    },
  });

  const result = await verifier({
    platform: "youtube",
    external_id: "yt-private-1",
  });

  assert.equal(result.confirmed, false);
  assert.equal(result.externalId, "yt-private-1");
  assert.equal(result.evidence.platform_object_confirmed, true);
  assert.equal(result.evidence.public, false);
  assert.equal(result.evidence.privacy_status, "private");
  assert.equal(result.reason, "youtube_privacy_not_public");
  assert.equal(result.exhausted, true);
  assert.deepEqual(calls[0].part, ["status"]);
  assert.deepEqual(calls[0].id, ["yt-private-1"]);
});

test("YouTube verifier reports a missing object without fabricating evidence", async () => {
  const verifier = createYoutubePublicObjectVerifier({
    now: () => new Date("2026-07-27T12:00:00.000Z"),
    maxAttempts: 1,
    sleep: async () => {},
    youtubeClient: {
      videos: {
        async list() {
          return { data: { items: [] } };
        },
      },
    },
  });

  const result = await verifier({
    platform: "youtube",
    external_id: "missing-video",
  });

  assert.equal(result.confirmed, false);
  assert.equal(result.externalId, "missing-video");
  assert.equal(result.externalUrl, null);
  assert.equal(result.evidence.public, false);
  assert.equal(result.evidence.platform_object_confirmed, false);
  assert.equal(result.reason, "youtube_object_not_found");
  assert.equal(result.exhausted, true);
});
