"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { handlers } = require("../../lib/job-handlers");
const {
  RUNTIME_POLICY_SCHEMA_VERSION,
} = require("../../lib/services/governed-autonomous-production-request-builder");
const {
  createGovernedAutonomousDatabaseStoryBinding,
} = require("../../lib/services/governed-autonomous-database-story-binding");
const {
  canonicalHash,
} = require("../../lib/services/url-canonical");

const GENERATED_AT = "2026-07-30T07:00:00.000Z";
const SCHEDULED_FOR = "2026-07-30T09:00:00.000Z";

function runtimePolicy() {
  return {
    narration: {
      provider: "elevenlabs",
      voice_id: "pulse-approved",
      model_id: "eleven_multilingual_v2",
      speed: 1,
    },
    visual_qa: {
      reviewers: [
        {
          provider: "ollama",
          model: "gemma3:12b",
          endpoint_origin: "http://127.0.0.1:11434",
        },
        {
          provider: "ollama",
          model: "qwen3.5:27b",
          endpoint_origin: "http://127.0.0.1:11434",
        },
      ],
    },
    disclosure_policy: {
      policy_id: "pulse-youtube-synthetic-media",
      policy_version: "1",
    },
  };
}

function readyEntry(root, storyId, hashCharacter) {
  return {
    registry_path: path.join(
      root,
      storyId,
      "governed-editorial-inventory.json",
    ),
    registry_file_sha256: hashCharacter.repeat(64),
    story: {
      id: storyId,
      primary_source_url:
        `https://news.xbox.com/en-us/${storyId}/`,
      published_at: "2026-07-29T18:00:00.000Z",
      verification_status: "CONFIRMED",
    },
    references: {
      breaking_source_evidence: {
        path: path.join(root, storyId, "source.json"),
        file_sha256: "a".repeat(64),
        canonical_sha256: "b".repeat(64),
      },
    },
    blockers: [],
  };
}

function scanReport(entries, rejected = []) {
  return {
    schema_version:
      "pulse-governed-editorial-inventory-registry-v1",
    mode: "LOCAL_PROOF",
    verdict: entries.length ? "READY" : "HOLD",
    blockers: [],
    entries,
    rejected,
    summary: {
      registry_count: entries.length + rejected.length,
      ready_count: entries.length,
      rejected_count: rejected.length,
    },
    safety: {
      read_only: true,
      network_used: false,
      database_mutated: false,
      oauth_mutated: false,
      platform_contacted: false,
      publish_authority_created: false,
    },
  };
}

function dbStory(storyId) {
  return {
    id: storyId,
    title: `${storyId} official update`,
    full_script:
      `${storyId} is officially confirmed for players today with a clear release change and exact platform details.`,
    breaking_score: storyId.endsWith("beta") ? 120 : 100,
    published_at: "2026-07-29T18:00:00.000Z",
    approved: 1,
    auto_approved: 1,
    youtube_post_id: null,
    publish_status: "review",
    _extra: "{}",
  };
}

function compiledCandidate(storyId, verifiedAt) {
  return {
    schema_version:
      "pulse-governed-autonomous-window-production-candidate-v1",
    mode: "LOCAL_PROOF",
    story_id: canonicalCandidateId(storyId),
    scheduled_for: SCHEDULED_FOR,
    verified_at: verifiedAt,
    eligibility_verdict: "GREEN",
  };
}

function canonicalCandidateId(storyId) {
  return (
    "official_" +
    crypto
      .createHash("sha1")
      .update(storyId)
      .digest("hex")
      .slice(0, 12)
  );
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(String(value))
    .digest("hex");
}

function plannerSafety() {
  return {
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
  };
}

function realPlannerCandidate({
  workspaceRoot,
  canonicalStoryId,
  canonicalIdentityUrl,
  databaseStoryId,
  generatedAt,
  selectionScore,
}) {
  const finalScript =
    `${canonicalStoryId} is a confirmed official gaming update with a clear player consequence.`;
  const inventoryFileSha256 =
    sha256(`${canonicalStoryId}:inventory`);
  return {
    schema_version:
      "pulse-governed-autonomous-window-production-candidate-v1",
    mode: "LOCAL_PROOF",
    story_id: canonicalStoryId,
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    scheduled_for: SCHEDULED_FOR,
    source_type: "official",
    verification_status: "CONFIRMED",
    eligibility_verdict: "GREEN",
    source_evidence_sha256:
      sha256(`${canonicalStoryId}:source-evidence`),
    source_published_at: "2026-07-30T06:30:00.000Z",
    verified_at: "2026-07-30T06:45:00.000Z",
    selection_score: selectionScore,
    locked_intake_binding: {
      story_id: canonicalStoryId,
      locked_intake: {
        database_story_binding:
          createGovernedAutonomousDatabaseStoryBinding({
            canonical_story_id: canonicalStoryId,
            database_story_id: databaseStoryId,
            canonical_identity_url: canonicalIdentityUrl,
            inventory_file_sha256: inventoryFileSha256,
            final_script_sha256: sha256(finalScript),
          }),
        inventory_path: path.join(
          workspaceRoot,
          "inventory",
          `${canonicalStoryId}.json`,
        ),
        inventory_file_sha256: inventoryFileSha256,
        inventory_root: path.join(
          workspaceRoot,
          "inventory",
        ),
        allowed_roots: [
          path.join(workspaceRoot, "inventory"),
          path.join(workspaceRoot, "candidate-source"),
        ],
        canonical_identity_url: canonicalIdentityUrl,
        final_script: finalScript,
        final_script_sha256: sha256(finalScript),
        script_claim_bindings: [
          {
            claim_key: `${canonicalStoryId}:claim`,
            source_index: 0,
          },
        ],
        presentation_claim_bindings: [
          {
            claim_key: `${canonicalStoryId}:claim`,
            scene_index: 0,
          },
        ],
        supplemental_official_sources: [],
        contract: {
          editorial_lane_id: "breaking_short",
        },
        freshness: {
          publish_by: "2026-07-30T12:00:00.000Z",
        },
        visual_brief: {
          format: "game_native_news",
        },
        experiment_dimensions: {
          eligible: false,
        },
      },
    },
    creative_package: {
      scenes: [
        {
          asset_id:
            `${canonicalStoryId}:official-hero`,
          role: "hook_slam",
        },
      ],
      title: `${canonicalStoryId} Confirmed`,
      description:
        `${canonicalStoryId} has been officially confirmed.`,
      official_source_url: canonicalIdentityUrl,
      required_attributions: [
        "Official source: Xbox Wire",
      ],
      subject_terms: [canonicalStoryId],
    },
    runtime_policy: {
      schema_version: RUNTIME_POLICY_SCHEMA_VERSION,
      mode: "LOCAL_PROOF",
      generated_at: generatedAt,
      workspace_root: workspaceRoot,
      candidate_source_root: path.join(
        workspaceRoot,
        "candidate-source",
        canonicalStoryId,
      ),
      ...runtimePolicy(),
      safety: plannerSafety(),
    },
    candidate_revision_sha256:
      sha256(`${canonicalStoryId}:revision`),
    request_fingerprint:
      sha256(`${canonicalStoryId}:request`),
  };
}

function queuedPlan(compiled) {
  return {
    status: "CREATED",
    path: "production-plan.json",
    file_sha256: "f".repeat(64),
    plan: {
      verdict: "QUEUED_LOCAL_PROOF",
      eligible_candidate_count: compiled.length,
      selected_candidates: compiled.slice(0, 2).map(
        (candidate, index) => ({
          story_id: candidate.story_id,
          role: index === 0 ? "PRIMARY" : "STANDBY",
        }),
      ),
      production_jobs: compiled.slice(0, 2).map(
        (candidate, index) => ({
          job_id: index + 1,
          story_id: candidate.story_id,
        }),
      ),
      story_approval_mutated: false,
      human_approval_dependency: false,
      platform_contacted: false,
      oauth_or_tokens_mutated: false,
      publish_authority_created: false,
      scheduler_authority_created: false,
      external_posting: false,
    },
  };
}

function job() {
  return {
    kind: "plan_governed_autonomous_window_production",
    channel_id: "pulse-gaming",
    payload: {
      generated_at: GENERATED_AT,
      scheduled_for: SCHEDULED_FOR,
      mode: "LOCAL_PROOF",
      publish_authority: false,
      external_posting: false,
    },
  };
}

function realPlannerHandlerHarness({
  workspaceRoot,
  clockValues,
}) {
  const inventoryRoot = path.join(
    workspaceRoot,
    "output",
    "editorial-inventory",
  );
  fs.mkdirSync(inventoryRoot, { recursive: true });
  const entries = [
    readyEntry(inventoryRoot, "rss-alpha", "1"),
    readyEntry(inventoryRoot, "rss-beta", "2"),
  ];
  const canonicalIds = new Map([
    [
      "rss-alpha",
      "https://news.xbox.com/en-us/2026/07/30/alpha/",
    ],
    [
      "rss-beta",
      "https://news.xbox.com/en-us/2026/07/30/beta/",
    ],
  ]);
  const enqueued = [];
  let clockReads = 0;
  const context = {
    now() {
      const value =
        clockValues[
          Math.min(
            clockReads,
            clockValues.length - 1,
          )
        ];
      clockReads += 1;
      return value;
    },
    autonomousProductionWorkspaceRoot: workspaceRoot,
    governedEditorialInventoryRoot: inventoryRoot,
    governedEditorialInventoryAllowedRoots: [
      path.join(workspaceRoot, "output"),
    ],
    governedAutonomousBreakingRuntimePolicy:
      runtimePolicy(),
    repos: {
      jobs: {
        enqueueBatch(requests) {
          enqueued.push(...structuredClone(requests));
          return requests.map((request, index) => ({
            id: index + 1,
            ...structuredClone(request),
          }));
        },
      },
      stories: {
        get(storyId) {
          return dbStory(storyId);
        },
      },
    },
    async scanGovernedEditorialInventory() {
      return scanReport(entries);
    },
    async hydrateGovernedEditorialInventoryCandidates(input) {
      return {
        schema_version:
          "pulse-governed-editorial-inventory-candidate-hydration-v1",
        verdict: "READY",
        candidates: input.candidates.map((candidate) => ({
          ...candidate,
          verification_status: "CONFIRMED",
          verified_for_planning: true,
        })),
        hydrated: input.candidates.map((candidate) => ({
          story_id: candidate.story_id,
        })),
        rejected: [],
        skipped: [],
        safety: {
          read_only: true,
          network_used: false,
          database_mutated: false,
          oauth_mutated: false,
          platform_contacted: false,
          publish_authority_created: false,
        },
      };
    },
    async compileGovernedAutonomousBreakingCandidateContract(
      input,
    ) {
      const canonicalIdentityUrl =
        canonicalIds.get(input.story.id);
      return realPlannerCandidate({
        workspaceRoot,
        canonicalStoryId:
          `official_${canonicalHash(canonicalIdentityUrl)}`,
        canonicalIdentityUrl,
        databaseStoryId: input.story.id,
        generatedAt: input.generated_at,
        selectionScore:
          input.story.id === "rss-alpha" ? 100 : 120,
      });
    },
  };
  return {
    context,
    enqueued,
    get clockReads() {
      return clockReads;
    },
  };
}

test("gathers exact READY inventory identities and DB rows before compiling and planning two autonomous production jobs", async (t) => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "pulse-autonomous-window-handler-",
    ),
  );
  t.after(() =>
    fs.rmSync(workspaceRoot, {
      recursive: true,
      force: true,
    }),
  );
  const inventoryRoot = path.join(
    workspaceRoot,
    "output",
    "editorial-inventory",
  );
  const entries = [
    readyEntry(inventoryRoot, "rss-alpha", "1"),
    readyEntry(inventoryRoot, "rss-beta", "2"),
    readyEntry(inventoryRoot, "rss-longform", "3"),
  ];
  const storyLookups = [];
  const hydrationCalls = [];
  const timingDiscoveryCalls = [];
  const compilationCalls = [];
  const planningCalls = [];
  const jobs = {
    marker: "durable-jobs",
    enqueueBatch() {},
  };

  const result = await handlers[
    "plan_governed_autonomous_window_production"
  ](job(), {
    now: () => GENERATED_AT,
    autonomousProductionWorkspaceRoot: workspaceRoot,
    governedEditorialInventoryRoot: inventoryRoot,
    governedEditorialInventoryAllowedRoots: [
      path.join(workspaceRoot, "output"),
    ],
    governedAutonomousBreakingRuntimePolicy:
      runtimePolicy(),
    env: {
      PULSE_STATE_ROOT: path.join(
        workspaceRoot,
        "runtime-state",
      ),
    },
    repos: {
      jobs,
      stories: {
        get(storyId) {
          storyLookups.push(storyId);
          return storyId === "rss-longform"
            ? {
                ...dbStory(storyId),
                _extra: JSON.stringify({
                  editorial_format: "weekly_longform",
                }),
              }
            : dbStory(storyId);
        },
      },
    },
    async scanGovernedEditorialInventory() {
      return scanReport(entries);
    },
    async hydrateGovernedEditorialInventoryCandidates(input) {
      hydrationCalls.push(input);
      return {
        schema_version:
          "pulse-governed-editorial-inventory-candidate-hydration-v1",
        verdict: "READY",
        candidates: input.candidates.map((candidate) => ({
          ...candidate,
          verification_status: "CONFIRMED",
          verified_for_planning: true,
        })),
        hydrated: input.candidates.map((candidate) => ({
          story_id: candidate.story_id,
        })),
        rejected: [],
        skipped: [],
        safety: {
          read_only: true,
          network_used: false,
          database_mutated: false,
          oauth_mutated: false,
          platform_contacted: false,
          publish_authority_created: false,
        },
      };
    },
    async discoverGovernedAutonomousNarrationTimingEvidence(
      input,
    ) {
      timingDiscoveryCalls.push(input);
      return {
        path: path.join(
          input.stateRoot,
          `${input.legacyStoryId}.json`,
        ),
        file_sha256:
          input.legacyStoryId === "rss-alpha"
            ? "7".repeat(64)
            : "8".repeat(64),
      };
    },
    async compileGovernedAutonomousBreakingCandidateContract(
      input,
    ) {
      compilationCalls.push(input);
      return compiledCandidate(
        input.story.id,
        "2026-07-30T06:45:00.000Z",
      );
    },
    async planGovernedAutonomousWindowProduction(
      input,
      options,
    ) {
      planningCalls.push({ input, options });
      return queuedPlan(input.candidates);
    },
  });

  assert.deepEqual(storyLookups, [
    "rss-alpha",
    "rss-beta",
    "rss-longform",
  ]);
  assert.equal(hydrationCalls.length, 1);
  assert.deepEqual(
    hydrationCalls[0].candidates.map(
      (candidate) => candidate.story_id,
    ),
    ["rss-alpha", "rss-beta"],
  );
  assert.equal(compilationCalls.length, 2);
  assert.deepEqual(
    timingDiscoveryCalls.map((call) => ({
      legacyStoryId: call.legacyStoryId,
      storyId: call.storyId,
      scriptSha256: call.scriptSha256,
    })),
    ["rss-alpha", "rss-beta"].map((storyId) => ({
      legacyStoryId: storyId,
      storyId:
        `official_${canonicalHash(
          `https://news.xbox.com/en-us/${storyId}/`,
        )}`,
      scriptSha256: crypto
        .createHash("sha256")
        .update(dbStory(storyId).full_script)
        .digest("hex"),
    })),
  );
  assert.equal(
    compilationCalls[0].candidate.story_id,
    "rss-alpha",
  );
  assert.equal(
    compilationCalls[0].story.id,
    "rss-alpha",
  );
  assert.deepEqual(
    compilationCalls.map(
      (call) => call.narration_timing_evidence,
    ),
    [
      {
        path: path.join(
          workspaceRoot,
          "runtime-state",
          "rss-alpha.json",
        ),
        file_sha256: "7".repeat(64),
      },
      {
        path: path.join(
          workspaceRoot,
          "runtime-state",
          "rss-beta.json",
        ),
        file_sha256: "8".repeat(64),
      },
    ],
  );
  assert.equal(planningCalls.length, 1);
  assert.equal(planningCalls[0].options.jobs, jobs);
  assert.deepEqual(
    planningCalls[0].input.candidates.map(
      (candidate) => candidate.story_id,
    ),
    [
      canonicalCandidateId("rss-alpha"),
      canonicalCandidateId("rss-beta"),
    ],
  );
  assert.equal(result.status, "autonomous_window_production_planned");
  assert.equal(result.verdict, "GREEN");
  assert.deepEqual(result.counts, {
    inventory_ready: 3,
    inventory_rejected: 0,
    db_rows_found: 2,
    db_rows_missing: 0,
    db_rows_approval_rejected: 0,
    lane_eligibility_rejected: 1,
    hydrated: 2,
    hydration_rejected: 0,
    compilation_succeeded: 2,
    compilation_rejected: 0,
    stale_rejected: 0,
    eligible: 2,
    queued_jobs: 2,
  });
  assert.deepEqual(
    result.rejected.find(
      (entry) => entry.story_id === "rss-longform",
    )?.blockers,
    [
      "governed_autonomous_window_explicit_non_fast_news_format",
    ],
  );
  assert.equal(result.human_approval_dependency, false);
  assert.equal(result.publish_authority_created, false);
  assert.equal(result.no_publish, true);
  assert.equal(result.no_external_posting, true);
});

test("real default planner keeps one attempt-bound timestamp while boundary clocks advance", async (t) => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "pulse-autonomous-window-real-planner-binding-",
    ),
  );
  t.after(() =>
    fs.rmSync(workspaceRoot, {
      recursive: true,
      force: true,
    }),
  );
  const harness = realPlannerHandlerHarness({
    workspaceRoot,
    clockValues: [
      "2026-07-30T07:00:00.000Z",
      "2026-07-30T07:00:00.001Z",
      "2026-07-30T07:00:00.002Z",
    ],
  });

  const result = await handlers[
    "plan_governed_autonomous_window_production"
  ](
    {
      ...job(),
      attempt_count: 1,
      max_attempts: 8,
    },
    harness.context,
  );

  assert.equal(
    result.verdict,
    "GREEN",
    JSON.stringify(result),
  );
  assert.equal(
    result.status,
    "autonomous_window_production_planned",
  );
  assert.equal(harness.clockReads, 3);
  assert.equal(harness.enqueued.length, 2);
  assert.ok(
    harness.enqueued.every(
      (request) =>
        request.run_at ===
        "2026-07-30T07:00:00.000Z",
    ),
  );
});

test("real default planner rechecks T-109 immediately before enqueueBatch after awaited filesystem work", async (t) => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "pulse-autonomous-window-real-planner-cutoff-",
    ),
  );
  t.after(() =>
    fs.rmSync(workspaceRoot, {
      recursive: true,
      force: true,
    }),
  );
  const harness = realPlannerHandlerHarness({
    workspaceRoot,
    clockValues: [
      "2026-07-30T07:00:00.000Z",
      "2026-07-30T07:00:00.000Z",
      "2026-07-30T07:12:00.000Z",
    ],
  });

  const result = await handlers[
    "plan_governed_autonomous_window_production"
  ](
    {
      ...job(),
      attempt_count: 1,
      max_attempts: 8,
    },
    harness.context,
  );

  assert.equal(harness.clockReads, 3);
  assert.equal(harness.enqueued.length, 0);
  assert.equal(result.verdict, "HOLD");
  assert.deepEqual(result.blockers, [
    "governed_autonomous_window_planning_must_precede_production_cutoff",
  ]);
  assert.equal(result.job_outcome, "TERMINAL");
  assert.equal(result.retryable, false);
  assert.equal(result.publish_authority_created, false);
  assert.equal(result.no_external_posting, true);
});

test("non-terminal predecessor lineage retries only while bounded attempts and T-109 runway remain", async (t) => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "pulse-autonomous-window-lineage-retry-",
    ),
  );
  t.after(() =>
    fs.rmSync(workspaceRoot, {
      recursive: true,
      force: true,
    }),
  );
  const harness = realPlannerHandlerHarness({
    workspaceRoot,
    clockValues: [
      "2026-07-30T07:00:00.000Z",
      "2026-07-30T07:00:00.001Z",
    ],
  });
  harness.context.planGovernedAutonomousWindowProduction =
    async () => {
      const error = new Error(
        "autonomous_window_planner_prior_jobs_not_terminal",
      );
      error.code =
        "autonomous_window_planner_prior_jobs_not_terminal";
      throw error;
    };

  const retry = await handlers[
    "plan_governed_autonomous_window_production"
  ](
    {
      ...job(),
      attempt_count: 1,
      max_attempts: 8,
    },
    harness.context,
  );
  assert.deepEqual(retry.blockers, [
    "autonomous_window_planner_prior_jobs_not_terminal",
  ]);
  assert.equal(retry.job_outcome, "RETRY");
  assert.equal(retry.retry_after_seconds, 300);
  assert.equal(retry.attempt_count, 1);
  assert.equal(retry.max_attempts, 8);

  const exhausted = await handlers[
    "plan_governed_autonomous_window_production"
  ](
    {
      ...job(),
      attempt_count: 8,
      max_attempts: 8,
    },
    harness.context,
  );
  assert.equal(exhausted.job_outcome, "TERMINAL");
  assert.equal(exhausted.retryable, false);
  assert.equal(
    Object.hasOwn(exhausted, "retry_after_seconds"),
    false,
  );
  assert.equal(harness.enqueued.length, 0);
});

test("holds with explicit missing and stale evidence counts before the planner can enqueue", async (t) => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "pulse-autonomous-window-handler-hold-",
    ),
  );
  t.after(() =>
    fs.rmSync(workspaceRoot, {
      recursive: true,
      force: true,
    }),
  );
  const inventoryRoot = path.join(
    workspaceRoot,
    "output",
    "editorial-inventory",
  );
  const entries = [
    readyEntry(inventoryRoot, "rss-fresh", "1"),
    readyEntry(inventoryRoot, "rss-stale", "2"),
    readyEntry(inventoryRoot, "rss-missing", "3"),
  ];
  let plannerCalled = false;
  const retryJob = {
    ...job(),
    attempt_count: 1,
    max_attempts: 8,
  };

  const result = await handlers[
    "plan_governed_autonomous_window_production"
  ](retryJob, {
    now: () => GENERATED_AT,
    autonomousProductionWorkspaceRoot: workspaceRoot,
    governedEditorialInventoryRoot: inventoryRoot,
    governedEditorialInventoryAllowedRoots: [
      path.join(workspaceRoot, "output"),
    ],
    governedAutonomousBreakingRuntimePolicy:
      runtimePolicy(),
    repos: {
      jobs: {
        marker: "durable-jobs",
        enqueueBatch() {},
      },
      stories: {
        get(storyId) {
          return storyId === "rss-missing"
            ? null
            : dbStory(storyId);
        },
      },
    },
    async scanGovernedEditorialInventory() {
      return scanReport(entries);
    },
    async hydrateGovernedEditorialInventoryCandidates(input) {
      return {
        schema_version:
          "pulse-governed-editorial-inventory-candidate-hydration-v1",
        verdict: "READY",
        candidates: input.candidates,
        hydrated: input.candidates.map((candidate) => ({
          story_id: candidate.story_id,
        })),
        rejected: [],
        skipped: [],
        safety: {
          read_only: true,
          network_used: false,
          database_mutated: false,
          oauth_mutated: false,
          platform_contacted: false,
          publish_authority_created: false,
        },
      };
    },
    async compileGovernedAutonomousBreakingCandidateContract(
      input,
    ) {
      return compiledCandidate(
        input.story.id,
        input.story.id === "rss-stale"
          ? "2026-07-30T00:30:00.000Z"
          : "2026-07-30T06:30:00.000Z",
      );
    },
    async planGovernedAutonomousWindowProduction() {
      plannerCalled = true;
    },
  });

  assert.equal(plannerCalled, false);
  assert.equal(result.status, "held");
  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes(
      "governed_autonomous_window_two_compilable_candidates_required",
    ),
  );
  assert.equal(result.job_outcome, "RETRY");
  assert.equal(result.retryable, true);
  assert.equal(result.retry_after_seconds, 300);
  assert.equal(
    result.retry_deadline,
    "2026-07-30T07:11:00.000Z",
  );
  assert.equal(
    result.pre_t94_dependency_at,
    "2026-07-30T07:26:00.000Z",
  );
  assert.equal(
    result.minimum_production_runway_seconds,
    900,
  );
  assert.equal(result.attempt_count, 1);
  assert.equal(result.max_attempts, 8);
  assert.equal(result.catch_up_allowed, false);
  assert.deepEqual(result.counts, {
    inventory_ready: 3,
    inventory_rejected: 0,
    db_rows_found: 2,
    db_rows_missing: 1,
    db_rows_approval_rejected: 0,
    lane_eligibility_rejected: 0,
    hydrated: 2,
    hydration_rejected: 0,
    compilation_succeeded: 2,
    compilation_rejected: 0,
    stale_rejected: 1,
    eligible: 1,
    queued_jobs: 0,
  });
  assert.deepEqual(
    result.rejected.map((entry) => [
      entry.story_id,
      entry.blockers[0],
    ]),
    [
      [
        "rss-missing",
        "governed_autonomous_window_db_story_missing",
      ],
      [
        "rss-stale",
        "governed_autonomous_window_source_evidence_stale",
      ],
    ],
  );
  assert.equal(result.human_approval_dependency, false);
  assert.equal(result.publish_authority_created, false);
  assert.equal(result.no_publish, true);
  assert.equal(result.no_external_posting, true);
  assert.equal(result.no_oauth_or_token_change, true);
});

test("candidate-supply HOLD becomes terminal before the production runway for T-94", async (t) => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "pulse-autonomous-window-handler-t90-boundary-",
    ),
  );
  t.after(() =>
    fs.rmSync(workspaceRoot, {
      recursive: true,
      force: true,
    }),
  );
  const inventoryRoot = path.join(
    workspaceRoot,
    "output",
    "editorial-inventory",
  );

  const result = await handlers[
    "plan_governed_autonomous_window_production"
  ](
    {
      ...job(),
      attempt_count: 8,
      max_attempts: 8,
      payload: {
        ...job().payload,
        generated_at: "2026-07-30T06:35:00.000Z",
      },
    },
    {
      now: () => "2026-07-30T07:10:00.000Z",
      autonomousProductionWorkspaceRoot: workspaceRoot,
      governedEditorialInventoryRoot: inventoryRoot,
      governedEditorialInventoryAllowedRoots: [
        path.join(workspaceRoot, "output"),
      ],
      governedAutonomousBreakingRuntimePolicy:
        runtimePolicy(),
      repos: {
        jobs: {
          enqueueBatch() {},
        },
        stories: {
          get() {
            return null;
          },
        },
      },
      async scanGovernedEditorialInventory() {
        return scanReport([]);
      },
    },
  );

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes(
      "governed_autonomous_window_two_compilable_candidates_required",
    ),
  );
  assert.equal(result.job_outcome, "TERMINAL");
  assert.equal(result.retryable, false);
  assert.equal(
    Object.hasOwn(result, "retry_after_seconds"),
    false,
  );
  assert.equal(
    result.retry_deadline,
    "2026-07-30T07:11:00.000Z",
  );
  assert.equal(
    result.pre_t94_dependency_at,
    "2026-07-30T07:26:00.000Z",
  );
  assert.equal(
    result.minimum_production_runway_seconds,
    900,
  );
  assert.equal(result.attempt_count, 8);
  assert.equal(result.max_attempts, 8);
  assert.equal(result.catch_up_allowed, false);
  assert.equal(result.publish_authority_created, false);
  assert.equal(result.no_external_posting, true);
});

test("trusted attempt time prevents a frozen payload timestamp from reopening a closed window", async (t) => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "pulse-autonomous-window-handler-trusted-clock-",
    ),
  );
  t.after(() =>
    fs.rmSync(workspaceRoot, {
      recursive: true,
      force: true,
    }),
  );
  const inventoryRoot = path.join(
    workspaceRoot,
    "output",
    "editorial-inventory",
  );
  let scanCalled = false;

  const result = await handlers[
    "plan_governed_autonomous_window_production"
  ](
    {
      ...job(),
      attempt_count: 1,
      max_attempts: 8,
      payload: {
        ...job().payload,
        generated_at: "2026-07-30T06:35:00.000Z",
      },
    },
    {
      now: () => "2026-07-30T07:35:00.000Z",
      autonomousProductionWorkspaceRoot: workspaceRoot,
      governedEditorialInventoryRoot: inventoryRoot,
      governedEditorialInventoryAllowedRoots: [
        path.join(workspaceRoot, "output"),
      ],
      governedAutonomousBreakingRuntimePolicy:
        runtimePolicy(),
      repos: {
        jobs: {
          enqueueBatch() {},
        },
        stories: {
          get() {
            return null;
          },
        },
      },
      async scanGovernedEditorialInventory() {
        scanCalled = true;
        return scanReport([]);
      },
    },
  );

  assert.equal(scanCalled, false);
  assert.equal(result.verdict, "HOLD");
  assert.deepEqual(result.blockers, [
    "governed_autonomous_window_planning_must_precede_production_cutoff",
  ]);
  assert.notEqual(result.job_outcome, "RETRY");
  assert.equal(result.publish_authority_created, false);
  assert.equal(result.no_external_posting, true);
});

test("candidate-supply retry preserves fifteen minutes for production before T-94", async (t) => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "pulse-autonomous-window-handler-production-runway-",
    ),
  );
  t.after(() =>
    fs.rmSync(workspaceRoot, {
      recursive: true,
      force: true,
    }),
  );
  const inventoryRoot = path.join(
    workspaceRoot,
    "output",
    "editorial-inventory",
  );

  const result = await handlers[
    "plan_governed_autonomous_window_production"
  ](
    {
      ...job(),
      attempt_count: 7,
      max_attempts: 8,
      payload: {
        ...job().payload,
        generated_at: "2026-07-30T06:35:00.000Z",
      },
    },
    {
      now: () => "2026-07-30T07:05:00.000Z",
      autonomousProductionWorkspaceRoot: workspaceRoot,
      governedEditorialInventoryRoot: inventoryRoot,
      governedEditorialInventoryAllowedRoots: [
        path.join(workspaceRoot, "output"),
      ],
      governedAutonomousBreakingRuntimePolicy:
        runtimePolicy(),
      repos: {
        jobs: {
          enqueueBatch() {},
        },
        stories: {
          get() {
            return null;
          },
        },
      },
      async scanGovernedEditorialInventory() {
        return scanReport([]);
      },
    },
  );

  assert.equal(result.job_outcome, "RETRY");
  assert.equal(result.retryable, true);
  assert.equal(result.retry_after_seconds, 300);
  assert.equal(
    result.retry_deadline,
    "2026-07-30T07:11:00.000Z",
  );
  assert.equal(
    result.pre_t94_dependency_at,
    "2026-07-30T07:26:00.000Z",
  );
  assert.equal(
    result.minimum_production_runway_seconds,
    900,
  );
  assert.equal(result.catch_up_allowed, false);
});

test("planner re-samples trusted time after asynchronous preparation and cannot enqueue across the production cutoff", async (t) => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "pulse-autonomous-window-handler-cutoff-race-",
    ),
  );
  t.after(() =>
    fs.rmSync(workspaceRoot, {
      recursive: true,
      force: true,
    }),
  );
  const inventoryRoot = path.join(
    workspaceRoot,
    "output",
    "editorial-inventory",
  );
  const entries = [
    readyEntry(inventoryRoot, "rss-alpha", "1"),
    readyEntry(inventoryRoot, "rss-beta", "2"),
  ];
  const clockValues = [
    "2026-07-30T07:00:00.000Z",
    "2026-07-30T07:12:00.000Z",
  ];
  let clockReads = 0;
  let plannerCalls = 0;

  const result = await handlers[
    "plan_governed_autonomous_window_production"
  ](
    {
      ...job(),
      attempt_count: 1,
      max_attempts: 8,
    },
    {
      now() {
        const value =
          clockValues[
            Math.min(
              clockReads,
              clockValues.length - 1,
            )
          ];
        clockReads += 1;
        return value;
      },
      autonomousProductionWorkspaceRoot: workspaceRoot,
      governedEditorialInventoryRoot: inventoryRoot,
      governedEditorialInventoryAllowedRoots: [
        path.join(workspaceRoot, "output"),
      ],
      governedAutonomousBreakingRuntimePolicy:
        runtimePolicy(),
      repos: {
        jobs: {
          enqueueBatch() {
            throw new Error(
              "cutoff-crossed planning must not enqueue",
            );
          },
        },
        stories: {
          get(storyId) {
            return dbStory(storyId);
          },
        },
      },
      async scanGovernedEditorialInventory() {
        return scanReport(entries);
      },
      async hydrateGovernedEditorialInventoryCandidates(input) {
        return {
          schema_version:
            "pulse-governed-editorial-inventory-candidate-hydration-v1",
          verdict: "READY",
          candidates: input.candidates.map((candidate) => ({
            ...candidate,
            verification_status: "CONFIRMED",
            verified_for_planning: true,
          })),
          hydrated: input.candidates.map((candidate) => ({
            story_id: candidate.story_id,
          })),
          rejected: [],
          skipped: [],
          safety: {
            read_only: true,
            network_used: false,
            database_mutated: false,
            oauth_mutated: false,
            platform_contacted: false,
            publish_authority_created: false,
          },
        };
      },
      async compileGovernedAutonomousBreakingCandidateContract(
        input,
      ) {
        return compiledCandidate(
          input.story.id,
          "2026-07-30T06:45:00.000Z",
        );
      },
      async planGovernedAutonomousWindowProduction() {
        plannerCalls += 1;
        return queuedPlan(
          entries.map((entry) =>
            compiledCandidate(
              entry.story.id,
              "2026-07-30T06:45:00.000Z",
            ),
          ),
        );
      },
    },
  );

  assert.equal(clockReads, 2);
  assert.equal(plannerCalls, 0);
  assert.equal(result.verdict, "HOLD");
  assert.deepEqual(result.blockers, [
    "governed_autonomous_window_planning_must_precede_production_cutoff",
  ]);
  assert.equal(result.job_outcome, "TERMINAL");
  assert.equal(result.retryable, false);
  assert.equal(result.counts.eligible, 2);
  assert.equal(result.counts.queued_jobs, 0);
  assert.equal(result.publish_authority_created, false);
  assert.equal(result.no_external_posting, true);
});

test("holds before planning when DB rows are unapproved or only manually approved", async (t) => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "pulse-autonomous-window-handler-approval-",
    ),
  );
  t.after(() =>
    fs.rmSync(workspaceRoot, {
      recursive: true,
      force: true,
    }),
  );
  const inventoryRoot = path.join(
    workspaceRoot,
    "output",
    "editorial-inventory",
  );
  const entries = [
    readyEntry(inventoryRoot, "rss-auto", "1"),
    readyEntry(inventoryRoot, "rss-manual", "2"),
    readyEntry(inventoryRoot, "rss-unapproved", "3"),
  ];
  const stories = new Map([
    ["rss-auto", dbStory("rss-auto")],
    [
      "rss-manual",
      {
        ...dbStory("rss-manual"),
        approved: true,
        auto_approved: 0,
      },
    ],
    [
      "rss-unapproved",
      {
        ...dbStory("rss-unapproved"),
        approved: false,
        auto_approved: false,
      },
    ],
  ]);
  const compiledStoryIds = [];
  let plannerCalled = false;

  const result = await handlers[
    "plan_governed_autonomous_window_production"
  ](job(), {
    now: () => GENERATED_AT,
    autonomousProductionWorkspaceRoot: workspaceRoot,
    governedEditorialInventoryRoot: inventoryRoot,
    governedEditorialInventoryAllowedRoots: [
      path.join(workspaceRoot, "output"),
    ],
    governedAutonomousBreakingRuntimePolicy:
      runtimePolicy(),
    repos: {
      jobs: {
        enqueueBatch() {},
      },
      stories: {
        get(storyId) {
          return stories.get(storyId);
        },
      },
    },
    async scanGovernedEditorialInventory() {
      return scanReport(entries);
    },
    async hydrateGovernedEditorialInventoryCandidates(input) {
      return {
        schema_version:
          "pulse-governed-editorial-inventory-candidate-hydration-v1",
        verdict: "READY",
        candidates: input.candidates,
        hydrated: input.candidates.map((candidate) => ({
          story_id: candidate.story_id,
        })),
        rejected: [],
        skipped: [],
        safety: {
          read_only: true,
          network_used: false,
          database_mutated: false,
          oauth_mutated: false,
          platform_contacted: false,
          publish_authority_created: false,
        },
      };
    },
    async compileGovernedAutonomousBreakingCandidateContract(
      input,
    ) {
      compiledStoryIds.push(input.story.id);
      return compiledCandidate(
        input.story.id,
        "2026-07-30T06:30:00.000Z",
      );
    },
    async planGovernedAutonomousWindowProduction() {
      plannerCalled = true;
    },
  });

  assert.equal(result.verdict, "HOLD");
  assert.equal(plannerCalled, false);
  assert.deepEqual(compiledStoryIds, ["rss-auto"]);
  assert.deepEqual(result.counts, {
    inventory_ready: 3,
    inventory_rejected: 0,
    db_rows_found: 1,
    db_rows_missing: 0,
    db_rows_approval_rejected: 2,
    lane_eligibility_rejected: 0,
    hydrated: 1,
    hydration_rejected: 0,
    compilation_succeeded: 1,
    compilation_rejected: 0,
    stale_rejected: 0,
    eligible: 1,
    queued_jobs: 0,
  });
  assert.deepEqual(
    result.rejected.map((entry) => [
      entry.story_id,
      entry.blockers,
    ]),
    [
      [
        "rss-manual",
        [
          "governed_autonomous_window_db_story_not_auto_approved",
        ],
      ],
      [
        "rss-unapproved",
        [
          "governed_autonomous_window_db_story_not_approved",
          "governed_autonomous_window_db_story_not_auto_approved",
        ],
      ],
    ],
  );
  assert.equal(
    stories.get("rss-manual").auto_approved,
    0,
  );
  assert.equal(
    stories.get("rss-unapproved").approved,
    false,
  );
  assert.equal(result.story_approval_mutated, false);
  assert.equal(result.publish_authority_created, false);
});

test("default runtime policy uses two distinct installed loopback visual reviewers and honours safe model overrides", async (t) => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "pulse-autonomous-window-handler-runtime-",
    ),
  );
  t.after(() =>
    fs.rmSync(workspaceRoot, {
      recursive: true,
      force: true,
    }),
  );
  const inventoryRoot = path.join(
    workspaceRoot,
    "output",
    "editorial-inventory",
  );
  const entries = [
    readyEntry(inventoryRoot, "rss-alpha", "1"),
    readyEntry(inventoryRoot, "rss-beta", "2"),
  ];
  async function captureRuntimePolicy(env) {
    const runtimePolicies = [];
    const result = await handlers[
      "plan_governed_autonomous_window_production"
    ](job(), {
      now: () => GENERATED_AT,
      autonomousProductionWorkspaceRoot: workspaceRoot,
      governedEditorialInventoryRoot: inventoryRoot,
      governedEditorialInventoryAllowedRoots: [
        path.join(workspaceRoot, "output"),
      ],
      env,
      repos: {
        jobs: {
          enqueueBatch() {},
        },
        stories: {
          get(storyId) {
            return dbStory(storyId);
          },
        },
      },
      async scanGovernedEditorialInventory() {
        return scanReport(entries);
      },
      async hydrateGovernedEditorialInventoryCandidates(input) {
        return {
          schema_version:
            "pulse-governed-editorial-inventory-candidate-hydration-v1",
          verdict: "READY",
          candidates: input.candidates,
          hydrated: input.candidates.map((candidate) => ({
            story_id: candidate.story_id,
          })),
          rejected: [],
          skipped: [],
          safety: {
            read_only: true,
            network_used: false,
            database_mutated: false,
            oauth_mutated: false,
            platform_contacted: false,
            publish_authority_created: false,
          },
        };
      },
      async compileGovernedAutonomousBreakingCandidateContract(
        input,
      ) {
        runtimePolicies.push(input.runtime_policy);
        return compiledCandidate(
          input.story.id,
          "2026-07-30T06:30:00.000Z",
        );
      },
      async planGovernedAutonomousWindowProduction(input) {
        return queuedPlan(input.candidates);
      },
    });
    return { result, runtimePolicies };
  }

  const defaults = await captureRuntimePolicy({
    ELEVENLABS_VOICE_ID: "pulse-approved",
  });
  assert.equal(defaults.result.verdict, "GREEN");
  assert.equal(defaults.runtimePolicies.length, 2);
  assert.deepEqual(
    defaults.runtimePolicies[0].visual_qa.reviewers,
    [
      {
        provider: "ollama",
        model: "gemma3:12b",
        endpoint_origin: "http://127.0.0.1:11434",
      },
      {
        provider: "ollama",
        model: "qwen3.5:27b",
        endpoint_origin: "http://127.0.0.1:11434",
      },
    ],
  );
  assert.equal(
    JSON.stringify(defaults.runtimePolicies).includes(
      "qwen2.5vl",
    ),
    false,
  );

  const overrides = await captureRuntimePolicy({
    ELEVENLABS_VOICE_ID: "pulse-approved",
    PULSE_VISUAL_QA_PRIMARY_MODEL: "gemma3:4b",
    PULSE_VISUAL_QA_SECONDARY_MODEL: "qwen3.5:27b",
  });
  assert.equal(overrides.result.verdict, "GREEN");
  assert.deepEqual(
    overrides.runtimePolicies[0].visual_qa.reviewers,
    [
      {
        provider: "ollama",
        model: "gemma3:4b",
        endpoint_origin: "http://127.0.0.1:11434",
      },
      {
        provider: "ollama",
        model: "qwen3.5:27b",
        endpoint_origin: "http://127.0.0.1:11434",
      },
    ],
  );

  const duplicateReviewers = await captureRuntimePolicy({
    ELEVENLABS_VOICE_ID: "pulse-approved",
    PULSE_VISUAL_QA_PRIMARY_MODEL: "gemma3:12b",
    PULSE_VISUAL_QA_SECONDARY_MODEL: "GEMMA3:12B",
  });
  assert.equal(duplicateReviewers.result.verdict, "HOLD");
  assert.ok(
    duplicateReviewers.result.blockers.includes(
      "governed_autonomous_window_runtime_policy_unavailable",
    ),
  );
  assert.equal(
    duplicateReviewers.runtimePolicies.length,
    0,
  );
});
