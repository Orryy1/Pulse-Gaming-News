"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  ARTIFACT_SCHEMA_VERSION,
  MODE,
  REQUEST_SCHEMA_VERSION,
  canonicalSha256,
  materialiseGovernedAutonomousWindowReservationSet,
  validateGovernedAutonomousWindowReservationSet,
} = require("../../lib/services/governed-autonomous-window-reservation-set");

const GENERATED_AT = "2026-07-30T07:20:00.000Z";
const SCHEDULED_FOR = "2026-07-30T09:00:00.000Z";

async function fixture(t) {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-window-reservation-"),
  );
  t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
  return {
    workspaceRoot,
    outputPath: path.join(
      workspaceRoot,
      "proof",
      "2026-07-30T09-00-00.000Z.reservation-set.json",
    ),
  };
}

function request(workspaceRoot, outputPath, overrides = {}) {
  return {
    schema_version: REQUEST_SCHEMA_VERSION,
    mode: MODE,
    generated_at: GENERATED_AT,
    scheduled_for: SCHEDULED_FOR,
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    reservations: [
      { role: "PRIMARY", story_id: "story-primary" },
      { role: "STANDBY", story_id: "story-standby" },
    ],
    workspace_root: workspaceRoot,
    output_path: outputPath,
    ...overrides,
  };
}

test("materialises one immutable local-proof reservation set for a guarded YouTube window", async (t) => {
  const { workspaceRoot, outputPath } = await fixture(t);

  const result =
    await materialiseGovernedAutonomousWindowReservationSet(
      request(workspaceRoot, outputPath),
    );

  assert.equal(result.status, "CREATED");
  assert.equal(result.path, outputPath);
  assert.deepEqual(result.reservation_set, {
    schema_version: ARTIFACT_SCHEMA_VERSION,
    mode: MODE,
    state: "RESERVED_LOCAL_PROOF",
    binding_scope: "WINDOW_STORY_ROLE_ONLY",
    generated_at: GENERATED_AT,
    scheduled_for: SCHEDULED_FOR,
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    reservations: [
      { role: "PRIMARY", story_id: "story-primary" },
      { role: "STANDBY", story_id: "story-standby" },
    ],
    safety: {
      local_proof_only: true,
      database_authority: false,
      database_mutated: false,
      network_authority: false,
      network_used: false,
      oauth_or_token_authority: false,
      oauth_or_tokens_mutated: false,
      platform_contacted: false,
      publish_authority: false,
      scheduler_authority: false,
      external_publish_authorised: false,
    },
    reservation_set_sha256: result.reservation_set.reservation_set_sha256,
  });
  const body = { ...result.reservation_set };
  delete body.reservation_set_sha256;
  assert.equal(
    result.reservation_set.reservation_set_sha256,
    canonicalSha256(body),
  );
  assert.deepEqual(
    validateGovernedAutonomousWindowReservationSet(
      JSON.parse(await fs.readFile(outputPath, "utf8")),
    ),
    result.reservation_set,
  );
});

test("accepts both guarded UTC hours and requires generation strictly before T90", async (t) => {
  const { workspaceRoot, outputPath } = await fixture(t);
  const eveningPath = path.join(
    path.dirname(outputPath),
    "2026-07-30T19-00-00.000Z.reservation-set.json",
  );

  const evening =
    await materialiseGovernedAutonomousWindowReservationSet(
      request(workspaceRoot, eveningPath, {
        generated_at: "2026-07-30T17:20:00.000Z",
        scheduled_for: "2026-07-30T19:00:00.000Z",
      }),
    );

  assert.equal(
    evening.reservation_set.scheduled_for,
    "2026-07-30T19:00:00.000Z",
  );
  await assert.rejects(
    materialiseGovernedAutonomousWindowReservationSet(
      request(workspaceRoot, outputPath, {
        generated_at: "2026-07-30T07:30:00.000Z",
      }),
    ),
    (error) =>
      error?.code === "window_reservation_must_precede_t90",
  );
});

test("fails closed on non-guarded windows, identity drift and duplicate role stories", async (t) => {
  const { workspaceRoot, outputPath } = await fixture(t);
  const attempts = [
    {
      overrides: {
        scheduled_for: "2026-07-30T14:00:00.000Z",
      },
      code: "window_reservation_guarded_window_required",
    },
    {
      overrides: { channel_id: "stacked" },
      code: "window_reservation_request_identity_invalid",
    },
    {
      overrides: { lane_id: "evergreen_verdict" },
      code: "window_reservation_request_identity_invalid",
    },
    {
      overrides: { platform: "tiktok" },
      code: "window_reservation_request_identity_invalid",
    },
    {
      overrides: {
        reservations: [
          { role: "PRIMARY", story_id: "same-story" },
          { role: "STANDBY", story_id: "same-story" },
        ],
      },
      code: "window_reservation_distinct_stories_required",
    },
    {
      overrides: {
        reservations: [
          { role: "PRIMARY", story_id: "story-primary" },
          { role: "PRIMARY", story_id: "story-standby" },
        ],
      },
      code: "window_reservation_roles_invalid",
    },
  ];

  for (const attempt of attempts) {
    await assert.rejects(
      materialiseGovernedAutonomousWindowReservationSet(
        request(workspaceRoot, outputPath, attempt.overrides),
      ),
      (error) => error?.code === attempt.code,
      attempt.code,
    );
  }
});

test("replays identical bytes and refuses to clobber an existing different artifact", async (t) => {
  const { workspaceRoot, outputPath } = await fixture(t);
  const exactRequest = request(workspaceRoot, outputPath);
  const created =
    await materialiseGovernedAutonomousWindowReservationSet(
      exactRequest,
    );
  const replayed =
    await materialiseGovernedAutonomousWindowReservationSet(
      exactRequest,
    );

  assert.equal(created.status, "CREATED");
  assert.equal(replayed.status, "REPLAYED");
  assert.equal(replayed.file_sha256, created.file_sha256);

  await assert.rejects(
    materialiseGovernedAutonomousWindowReservationSet({
      ...exactRequest,
      generated_at: "2026-07-30T07:19:59.000Z",
    }),
    (error) =>
      error?.code === "window_reservation_output_conflict",
  );
  assert.deepEqual(
    JSON.parse(await fs.readFile(outputPath, "utf8")),
    created.reservation_set,
  );
});

test("rejects paths outside the workspace and closed-schema authority smuggling", async (t) => {
  const { workspaceRoot, outputPath } = await fixture(t);
  const outsidePath = path.join(
    path.dirname(workspaceRoot),
    `${path.basename(workspaceRoot)}-outside.json`,
  );
  t.after(() => fs.rm(outsidePath, { force: true }));

  await assert.rejects(
    materialiseGovernedAutonomousWindowReservationSet(
      request(workspaceRoot, outsidePath),
    ),
    (error) =>
      error?.code ===
      "window_reservation_output_outside_workspace",
  );
  await assert.rejects(
    materialiseGovernedAutonomousWindowReservationSet({
      ...request(workspaceRoot, outputPath),
      publish_authority: true,
    }),
    (error) =>
      error?.code === "window_reservation_request_fields_invalid",
  );
});

test("artifact validation detects canonical tampering and nested authority injection", async (t) => {
  const { workspaceRoot, outputPath } = await fixture(t);
  const { reservation_set: reservationSet } =
    await materialiseGovernedAutonomousWindowReservationSet(
      request(workspaceRoot, outputPath),
    );

  const changedStory = structuredClone(reservationSet);
  changedStory.reservations[0].story_id = "different-primary";
  assert.throws(
    () =>
      validateGovernedAutonomousWindowReservationSet(
        changedStory,
      ),
    (error) =>
      error?.code === "window_reservation_sha256_mismatch",
  );

  const smuggled = structuredClone(reservationSet);
  smuggled.reservations[0].publish_authority = true;
  const smuggledBody = { ...smuggled };
  delete smuggledBody.reservation_set_sha256;
  smuggled.reservation_set_sha256 =
    canonicalSha256(smuggledBody);
  assert.throws(
    () => validateGovernedAutonomousWindowReservationSet(smuggled),
    (error) =>
      error?.code ===
      "window_reservation_reservation_fields_invalid",
  );

  const authorised = structuredClone(reservationSet);
  authorised.safety.publish_authority = true;
  const authorisedBody = { ...authorised };
  delete authorisedBody.reservation_set_sha256;
  authorised.reservation_set_sha256 =
    canonicalSha256(authorisedBody);
  assert.throws(
    () =>
      validateGovernedAutonomousWindowReservationSet(authorised),
    (error) =>
      error?.code ===
      "window_reservation_publish_authority_forbidden",
  );
});
