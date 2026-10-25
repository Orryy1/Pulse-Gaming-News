"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");

const {
  materialiseAutonomousAdmissionControlProofs,
} = require("../../lib/services/autonomous-admission-control-proof");
const {
  PUBLICATION_ADMISSION_LEASE_NAME,
} = require("../../lib/services/publication-admission-lock");
const { SCHEDULER_LEASE_NAME } = require("../../lib/services/scheduler-lock");

const NOW = "2026-07-29T17:45:00.000Z";
const roots = [];

function liveEnv(overrides = {}) {
  return {
    PULSE_OPERATING_MODE: "LIVE_GUARDED",
    PULSE_YOUTUBE_OAUTH_CLIENT_SHA256: "a".repeat(64),
    AUTO_PUBLISH: "true",
    PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
    USE_JOB_QUEUE: "true",
    USE_SQLITE: "true",
    PULSE_PRIMARY_INSTANCE: "true",
    PULSE_MULTI_LANE_WORKERS: "true",
    PULSE_SCHEDULER_PROFILE: "governed_multi_lane",
    ...overrides,
  };
}

async function fixture({ claimScope = "STORY" } = {}) {
  const workspaceRoot = await fsp.mkdtemp(
    path.join(os.tmpdir(), "pulse-autonomous-control-proof-"),
  );
  roots.push(workspaceRoot);
  const scheduler = {
    name: SCHEDULER_LEASE_NAME,
    owner_id: "scheduler:host:100:secret-scheduler-id",
    acquired_at: NOW,
    heartbeat_at: NOW,
    expires_at: "2026-07-29T17:46:30.000Z",
  };
  const publicationAdmission = {
    name: PUBLICATION_ADMISSION_LEASE_NAME,
    owner_id: "publication-admission:host:100:secret-admission-id",
    acquired_at: NOW,
    heartbeat_at: NOW,
    expires_at: "2026-07-29T17:46:30.000Z",
    metadata: JSON.stringify({
      schema_version: "pulse-runtime-generation-publication-admission-lease-v1",
      scope: "PUBLICATION_ADMISSION_ONLY",
      operation:
        claimScope === "WINDOW"
          ? "governed_autonomous_pre_t90_window_preparation"
          : "autonomous_t75_jit_admission",
      job_kind:
        claimScope === "WINDOW"
          ? "prepare_governed_autonomous_pre_t90_window"
          : "admit_governed_publication",
      claim_scope: claimScope,
      channel_id: claimScope === "WINDOW" ? null : "pulse-gaming",
      story_id:
        claimScope === "WINDOW" ? null : "official_3b8d305c4e17",
      claimed_job_authority_sha256: "c".repeat(64),
      operational_publish_authority: false,
      dispatch_authorised: false,
      external_create_authority: false,
      platform_mutation_authority: false,
      platform_contact_authority: false,
    }),
  };
  const runtimeLeases = {
    get(name) {
      if (name === SCHEDULER_LEASE_NAME) return { ...scheduler };
      if (name === PUBLICATION_ADMISSION_LEASE_NAME) {
        return { ...publicationAdmission };
      }
      return null;
    },
  };
  return {
    workspaceRoot,
    outputDir: path.join(workspaceRoot, "proof", "attempt-000001"),
    scheduler,
    publicationAdmission,
    runtimeLeases,
    request: {
      storyId: "official_3b8d305c4e17",
      channelId: "pulse-gaming",
      workspaceRoot,
      outputDir: path.join(workspaceRoot, "proof", "attempt-000001"),
      repos: { runtimeLeases },
      env: liveEnv(),
      publicationAdmissionLease: Object.defineProperties({
        acquired: true,
        lease_name: PUBLICATION_ADMISSION_LEASE_NAME,
        expires_at: publicationAdmission.expires_at,
        current_lock_owner_sha256: crypto
          .createHash("sha256")
          .update(publicationAdmission.owner_id)
          .digest("hex"),
        claimed_job_authority_sha256: "c".repeat(64),
      }, {
        assertHealthy: {
          enumerable: false,
          value() {
            return true;
          },
        },
      }),
    },
  };
}

afterEach(async () => {
  while (roots.length) {
    await fsp.rm(roots.pop(), { recursive: true, force: true });
  }
});

test("materialises kill-switch and publication-admission owner proofs without raw authority", async () => {
  const current = await fixture();
  const result = await materialiseAutonomousAdmissionControlProofs(
    current.request,
    { clock: () => new Date(NOW) },
  );

  assert.equal(
    result.schema_version,
    "pulse-autonomous-admission-control-proof-result-v2",
  );
  assert.equal(result.verdict, "GREEN");
  assert.equal(result.operational_publish_authority, false);
  assert.equal(result.database_mutated, false);
  assert.equal(result.platform_contacted, false);
  assert.match(result.kill_switch_proof.sha256, /^[a-f0-9]{64}$/);
  assert.match(
    result.publication_admission_owner_proof.sha256,
    /^[a-f0-9]{64}$/,
  );

  const kill = JSON.parse(
    await fsp.readFile(result.kill_switch_proof.path, "utf8"),
  );
  const owner = JSON.parse(
    await fsp.readFile(result.publication_admission_owner_proof.path, "utf8"),
  );
  assert.deepEqual(kill, {
    schema_version: "pulse-kill-switch-health-proof-v1",
    story_id: "official_3b8d305c4e17",
    checked_at: NOW,
    valid_until: "2026-07-29T17:46:00.000Z",
    kill_switch_healthy: true,
    emergency_kill_switch_tripped: false,
    primary_kill_switch_tripped: false,
  });
  assert.equal(
    owner.schema_version,
    "pulse-publication-admission-owner-proof-v1",
  );
  assert.equal(owner.story_id, "official_3b8d305c4e17");
  assert.equal(owner.checked_at, NOW);
  assert.equal(owner.valid_until, "2026-07-29T17:46:00.000Z");
  assert.equal(
    owner.publication_admission_lease_expires_at,
    current.publicationAdmission.expires_at,
  );
  assert.equal(owner.active_scheduler_owner_count, 1);
  assert.equal(owner.active_publication_admission_owner_count, 1);
  assert.equal(owner.scheduler_owner_healthy, true);
  assert.equal(owner.publication_admission_owner_healthy, true);
  assert.match(owner.scheduler_owner_sha256, /^[a-f0-9]{64}$/);
  assert.match(owner.publication_admission_owner_sha256, /^[a-f0-9]{64}$/);
  assert.equal(
    owner.publication_admission_claimed_job_authority_sha256,
    "c".repeat(64),
  );
  assert.equal(JSON.stringify(owner).includes("secret-scheduler-id"), false);
  assert.equal(JSON.stringify(owner).includes("secret-admission-id"), false);

  assert.equal(
    result.kill_switch_proof.sha256,
    crypto
      .createHash("sha256")
      .update(await fsp.readFile(result.kill_switch_proof.path))
      .digest("hex"),
  );
  assert.equal(
    result.publication_admission_owner_proof.sha256,
    crypto
      .createHash("sha256")
      .update(await fsp.readFile(result.publication_admission_owner_proof.path))
      .digest("hex"),
  );
});

test("a window-scoped pre-T90 lease can prove each exact candidate without inventing a job story", async () => {
  const current = await fixture({ claimScope: "WINDOW" });
  const result = await materialiseAutonomousAdmissionControlProofs(
    current.request,
    { clock: () => new Date(NOW) },
  );
  const owner = JSON.parse(
    await fsp.readFile(
      result.publication_admission_owner_proof.path,
      "utf8",
    ),
  );

  assert.equal(result.verdict, "GREEN");
  assert.equal(owner.story_id, "official_3b8d305c4e17");
  assert.equal(
    owner.publication_admission_claimed_job_authority_sha256,
    "c".repeat(64),
  );
});

test("fails closed before writing when live control or either exact lease is not healthy", async () => {
  for (const mutate of [
    (current) => {
      current.request.env.PULSE_KILL_SWITCH = "true";
    },
    (current) => {
      current.request.env.PULSE_OPERATING_MODE = "HUMAN_REVIEW";
      current.request.env.AUTO_PUBLISH = "false";
    },
    (current) => {
      current.request.publicationAdmissionLease.current_lock_owner_sha256 =
        "d".repeat(64);
    },
    (current) => {
      current.publicationAdmission.expires_at = NOW;
      current.request.publicationAdmissionLease.expires_at = NOW;
    },
    (current) => {
      current.runtimeLeases.get = () => null;
    },
  ]) {
    const current = await fixture();
    mutate(current);
    await assert.rejects(
      materialiseAutonomousAdmissionControlProofs(current.request, {
        clock: () => new Date(NOW),
      }),
      /autonomous_admission_control_/,
    );
    await assert.rejects(fsp.access(current.outputDir));
  }
});

test("requires all output to stay under a real trusted workspace root", async () => {
  const current = await fixture();
  current.request.outputDir = path.join(
    path.dirname(current.workspaceRoot),
    "escaped-proof",
  );
  await assert.rejects(
    materialiseAutonomousAdmissionControlProofs(current.request, {
      clock: () => new Date(NOW),
    }),
    /autonomous_admission_control_output_outside_workspace/,
  );
});

test("uses atomic no-clobber output so a retry cannot replace control evidence", async () => {
  const current = await fixture();
  await materialiseAutonomousAdmissionControlProofs(current.request, {
    clock: () => new Date(NOW),
  });

  await assert.rejects(
    materialiseAutonomousAdmissionControlProofs(current.request, {
      clock: () => new Date("2026-07-29T17:45:01.000Z"),
    }),
    /autonomous_admission_control_output_exists/,
  );
});
