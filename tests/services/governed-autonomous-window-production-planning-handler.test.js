"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { handlers } = require("../../lib/job-handlers");

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
  ];
  const storyLookups = [];
  const hydrationCalls = [];
  const compilationCalls = [];
  const planningCalls = [];
  const jobs = {
    marker: "durable-jobs",
    enqueueBatch() {},
  };

  const result = await handlers[
    "plan_governed_autonomous_window_production"
  ](job(), {
    autonomousProductionWorkspaceRoot: workspaceRoot,
    governedEditorialInventoryRoot: inventoryRoot,
    governedEditorialInventoryAllowedRoots: [
      path.join(workspaceRoot, "output"),
    ],
    governedAutonomousBreakingRuntimePolicy:
      runtimePolicy(),
    repos: {
      jobs,
      stories: {
        get(storyId) {
          storyLookups.push(storyId);
          return dbStory(storyId);
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

  assert.deepEqual(storyLookups, ["rss-alpha", "rss-beta"]);
  assert.equal(hydrationCalls.length, 1);
  assert.deepEqual(
    hydrationCalls[0].candidates.map(
      (candidate) => candidate.story_id,
    ),
    ["rss-alpha", "rss-beta"],
  );
  assert.equal(compilationCalls.length, 2);
  assert.equal(
    compilationCalls[0].candidate.story_id,
    "rss-alpha",
  );
  assert.equal(
    compilationCalls[0].story.id,
    "rss-alpha",
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
    inventory_ready: 2,
    inventory_rejected: 0,
    db_rows_found: 2,
    db_rows_missing: 0,
    db_rows_approval_rejected: 0,
    hydrated: 2,
    hydration_rejected: 0,
    compilation_succeeded: 2,
    compilation_rejected: 0,
    stale_rejected: 0,
    eligible: 2,
    queued_jobs: 2,
  });
  assert.equal(result.human_approval_dependency, false);
  assert.equal(result.publish_authority_created, false);
  assert.equal(result.no_publish, true);
  assert.equal(result.no_external_posting, true);
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

  const result = await handlers[
    "plan_governed_autonomous_window_production"
  ](job(), {
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
  assert.deepEqual(result.counts, {
    inventory_ready: 3,
    inventory_rejected: 0,
    db_rows_found: 2,
    db_rows_missing: 1,
    db_rows_approval_rejected: 0,
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
