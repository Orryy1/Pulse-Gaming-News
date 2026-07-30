"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const { handlers } = require("../../lib/job-handlers");
const { runMigrations } = require("../../lib/migrate");
const {
  bind: bindJobs,
} = require("../../lib/repositories/jobs");
const {
  captureBreakingSourceEvidence,
} = require("../../lib/services/breaking-source-evidence");
const {
  enqueueGovernedEditorialEvidence,
} = require("../../lib/services/governed-editorial-evidence-ingress");

const NOW = "2026-07-28T14:05:00.000Z";
const XBOX_URL =
  "https://news.xbox.com/en-us/2026/07/28/xbox-classics-on-pc/";

function governedStory(overrides = {}) {
  return {
    id: "rss-xbox-classics",
    title: "Xbox confirms four classics are coming to PC",
    article_url: XBOX_URL,
    url: XBOX_URL,
    source_type: "rss",
    subreddit: "Xbox Wire",
    timestamp: "2026-07-28T13:30:00.000Z",
    created_at: "2026-07-28T13:31:00.000Z",
    breaking_score: 55,
    channel_id: "pulse-gaming",
    ...overrides,
  };
}

function governedDecision(storyId, overrides = {}) {
  return {
    story_id: storyId,
    channel_id: "pulse-gaming",
    decision: "auto",
    total: 92,
    hard_stops: [],
    inputs: {
      topicality_decision: "accept",
      topicality_category: "gaming",
    },
    scored_at: "2026-07-28T13:45:00.000Z",
    scorer_version: "v1.0",
    ...overrides,
  };
}

test("ordinary hunt routes governed current stories into breaking and editorial evidence lanes, never publishing", async () => {
  const breaking = governedStory();
  const editorial = governedStory({
    id: "rss-ign-current",
    title: "A current Xbox report worth preserving for the weekly recap",
    article_url:
      "https://www.ign.com/articles/current-xbox-report",
    url: "https://www.ign.com/articles/current-xbox-report",
    breaking_score: 40,
  });
  const staleDistractor = governedStory({
    id: "reddit-temu-stale",
    title: "I got a 4TB external drive off Temu",
    article_url:
      "https://news.xbox.com/en-us/2026/07/18/old-item/",
    url: "https://news.xbox.com/en-us/2026/07/18/old-item/",
    timestamp: "2026-07-18T13:30:00.000Z",
    breaking_score: 120,
  });
  const stories = [breaking, editorial, staleDistractor];
  const decisions = new Map([
    [breaking.id, governedDecision(breaking.id)],
    [
      editorial.id,
      governedDecision(editorial.id, {
        decision: "review",
        total: 70,
      }),
    ],
    [
      staleDistractor.id,
      governedDecision(staleDistractor.id, {
        total: 118,
      }),
    ],
  ]);
  const queued = [];

  const result = await handlers.hunt(
    {
      kind: "hunt",
      channel_id: "pulse-gaming",
      payload: {
        reason: "scheduled_current_news",
        now: NOW,
      },
    },
    {
      async hunter() {
        return stories;
      },
      async processStories() {},
      async autoApprove() {
        return { scored: 3 };
      },
      repos: {
        stories: {
          get(id) {
            return stories.find((story) => story.id === id) || null;
          },
        },
        scoring: {
          latest(id) {
            return decisions.get(id) || null;
          },
        },
        jobs: {
          enqueue(input) {
            queued.push(input);
            return { id: queued.length, ...input };
          },
        },
      },
    },
  );

  assert.deepEqual(
    queued.map((job) => job.kind),
    [
      "breaking_story_discovery",
      "governed_editorial_evidence_discovery",
    ],
  );
  assert.equal(queued[0].story_id, undefined);
  assert.equal(queued[0].payload.story.id, breaking.id);
  assert.equal(
    queued[0].payload.story.breaking_score,
    governedDecision(breaking.id).total,
  );
  assert.equal(queued[1].story_id, editorial.id);
  assert.equal(queued.some((job) => job.kind === "publish"), false);
  assert.equal(
    queued.some(
      (job) =>
        job.payload?.story?.id === staleDistractor.id ||
        job.story_id === staleDistractor.id,
    ),
    false,
  );
  assert.equal(result.governed_story_fanout.breaking_queued, 1);
  assert.equal(result.governed_story_fanout.editorial_queued, 1);
  assert.equal(result.governed_story_fanout.held, 1);
});

test("ordinary hunt fail-closed holds a newly discovered story with no scoring decision", async () => {
  const scored = governedStory();
  const unscored = governedStory({
    id: "rss-xbox-unscored",
    title: "A newly discovered Xbox story awaiting scoring",
    article_url:
      "https://news.xbox.com/en-us/2026/07/28/unscored-story/",
    url:
      "https://news.xbox.com/en-us/2026/07/28/unscored-story/",
  });
  const stories = [scored, unscored];
  const queued = [];

  const result = await handlers.hunt(
    {
      kind: "hunt",
      channel_id: "pulse-gaming",
      payload: {
        bootstrap_bucket: "2026-07-29T00:15:00.000Z",
        bootstrap_catch_up: true,
        governed_multi_lane: true,
        human_admission_required: true,
        human_review_required: true,
        live_publish_enabled: false,
        now: NOW,
        publish_authority: false,
        scheduler_profile: "governed_multi_lane",
      },
    },
    {
      async hunter() {
        return stories;
      },
      async processStories() {},
      async autoApprove() {
        return { scored: 1 };
      },
      repos: {
        stories: {
          get(id) {
            return stories.find((story) => story.id === id) || null;
          },
        },
        scoring: {
          latest(id) {
            return id === scored.id
              ? governedDecision(scored.id)
              : null;
          },
        },
        jobs: {
          enqueue(input) {
            queued.push(input);
            return { id: queued.length, ...input };
          },
        },
      },
    },
  );

  assert.equal(result.governed_story_fanout.assessed, 2);
  assert.equal(result.governed_story_fanout.breaking_queued, 1);
  assert.equal(result.governed_story_fanout.editorial_queued, 0);
  assert.equal(result.governed_story_fanout.held, 1);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].kind, "breaking_story_discovery");
  assert.equal(queued[0].payload.story.id, scored.id);
  assert.equal(
    queued.some(
      (job) =>
        job.payload?.story?.id === unscored.id ||
        job.story_id === unscored.id,
    ),
    false,
  );
  assert.equal(queued.some((job) => job.kind === "publish"), false);
});

test("repeated real hunts recognise the same breaking discovery despite a later observation time", async (t) => {
  const db = new Database(":memory:");
  runMigrations(db, {
    log() {},
    env: { PULSE_RUNTIME_MODE: "LOCAL_PROOF" },
  });
  db.prepare(
    "INSERT INTO channels (id, name) VALUES (?, ?)",
  ).run("pulse-gaming", "Pulse Gaming");
  t.after(() => db.close());
  const jobs = bindJobs(db);
  const breaking = governedStory();
  const latestDecision = governedDecision(breaking.id);
  const context = {
    async hunter() {
      return [breaking];
    },
    async processStories() {},
    async autoApprove() {
      return { scored: 1 };
    },
    repos: {
      stories: {
        get(id) {
          return id === breaking.id ? breaking : null;
        },
      },
      scoring: {
        latest(id) {
          return id === breaking.id ? latestDecision : null;
        },
      },
      jobs,
    },
  };

  const first = await handlers.hunt(
    {
      kind: "hunt",
      channel_id: "pulse-gaming",
      payload: { now: NOW },
    },
    context,
  );
  const second = await handlers.hunt(
    {
      kind: "hunt",
      channel_id: "pulse-gaming",
      payload: { now: "2026-07-28T14:06:00.000Z" },
    },
    context,
  );

  const discoveries = jobs
    .listPending()
    .filter((job) => job.kind === "breaking_story_discovery");
  assert.equal(first.governed_story_fanout.breaking_queued, 1);
  assert.equal(second.governed_story_fanout.breaking_queued, 0);
  assert.equal(discoveries.length, 1);
  assert.equal(discoveries[0].payload.story.id, breaking.id);
});

test("editorial evidence discovery stops after sufficient official body proof and queues inventory, not a breaking re-hunt", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-editorial-evidence-discovery-"),
  );
  t.after(() => fs.remove(outDir));
  const queuedIngress = [];
  const ingress = enqueueGovernedEditorialEvidence({
    story: governedStory(),
    latestDecision: governedDecision("rss-xbox-classics", {
      decision: "review",
      total: 70,
    }),
    jobs: {
      enqueue(input) {
        queuedIngress.push(input);
        return { id: 80, ...input };
      },
    },
    now: NOW,
  });
  assert.equal(ingress.queued, true);

  const exactClaim =
    "Xbox confirmed four classic games are coming to PC with achievements planned.";
  const packet = await captureBreakingSourceEvidence({
    story: {
      id: "rss-xbox-classics",
      title: governedStory().title,
      subject_ids: ["xbox"],
      source_candidates: [XBOX_URL],
    },
    sourcePolicy: {
      official_first_party: [
        {
          source_id: "xbox-wire",
          owner: "Microsoft Gaming",
          hosts: ["news.xbox.com"],
          subject_ids: ["xbox"],
        },
      ],
      trusted_editorial: [],
    },
    async fetchCapture({ url }) {
      return {
        status: 200,
        final_url: url,
        content_type: "text/html",
        bytes: Buffer.from(`<article>${exactClaim}</article>`),
      };
    },
    async extractClaims() {
      return {
        extractor: {
          id: "fixture-editorial-body-extractor",
          version: "1.0.0",
        },
        claims: [
          {
            claim_key: "xbox.classics.pc.achievements",
            text: exactClaim,
            location: "body",
          },
        ],
      };
    },
    now: NOW,
  });
  assert.equal(packet.verified_for_planning, true);

  const queued = [];
  const result =
    await handlers.governed_editorial_evidence_discovery(
      {
        ...queuedIngress[0],
        payload: {
          ...queuedIngress[0].payload,
          out_dir: outDir,
        },
      },
      {
        async captureBreakingSourceEvidence(options) {
          assert.equal(
            options.stopAfterOfficialConfirmation,
            true,
          );
          assert.equal(
            options.stopAfterEvidenceConfirmation,
            true,
          );
          return packet;
        },
        breakingFetchCapture: async () => {
          throw new Error("injected capture packet");
        },
        breakingClaimExtractor: async () => {
          throw new Error("injected capture packet");
        },
        repos: {
          stories: {
            get() {
              return governedStory({
                _extra: JSON.stringify({
                  franchise: "Xbox",
                  platform: "Xbox Series X|S",
                }),
              });
            },
          },
          jobs: {
            enqueue(input) {
              queued.push(input);
              return { id: 81, ...input };
            },
          },
        },
        log() {},
      },
    );

  assert.equal(
    result.verdict,
    "READY_FOR_INVENTORY",
    JSON.stringify(result),
  );
  assert.equal(queued.length, 1);
  assert.equal(queued[0].kind, "prepare_editorial_inventory");
  assert.equal(queued[0].story_id, "rss-xbox-classics");
  assert.equal(
    queued[0].payload.breaking_source_evidence.canonical_sha256,
    packet.packet_sha256,
  );
  assert.equal(queued.some((job) => job.kind === "hunt"), false);
  assert.equal(queued.some((job) => job.kind === "publish"), false);
  assert.equal(await fs.pathExists(result.source_evidence_json), true);
  const report = await fs.readJson(result.report_json);
  assert.equal(report.capture_deadline_ms, 90_000);
});

test("READY editorial inventory immediately wakes both evergreen and flagship planning", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-inventory-lane-wake-"),
  );
  t.after(() => fs.remove(outDir));
  const queued = [];
  const workflowRevision = "9".repeat(64);
  const result = await handlers.prepare_editorial_inventory(
    {
      kind: "prepare_editorial_inventory",
      channel_id: "pulse-gaming",
      story_id: "rss-xbox-classics",
      payload: {
        story: {
          id: "rss-xbox-classics",
          title: governedStory().title,
          franchise: "Xbox",
          platform: "Xbox Series X|S",
          topic_key: "xbox",
          published_at: NOW,
          primary_source_url: XBOX_URL,
          verification_status: "CONFIRMED",
          subject_ids: ["xbox"],
        },
        breaking_source_evidence: {
          path: "C:/proof/source-evidence.json",
          file_sha256: "1".repeat(64),
          canonical_sha256: "2".repeat(64),
        },
        out_dir: outDir,
        root_dir: path.dirname(outDir),
        now: NOW,
        publish_authority: false,
        human_review_required: true,
      },
    },
    {
      async runGovernedEditorialInventoryWorkflow() {
        return {
          verdict: "READY",
          blockers: [],
          paths: {
            report: path.join(outDir, "workflow.json"),
            summary: path.join(outDir, "workflow.md"),
            inventory: path.join(outDir, "inventory.json"),
          },
          report: {
            workflow_revision_sha256: workflowRevision,
          },
        };
      },
      repos: {
        jobs: {
          enqueue(input) {
            queued.push(input);
            return { id: 90 + queued.length, ...input };
          },
        },
      },
    },
  );

  assert.equal(result.status, "READY", JSON.stringify(result));
  assert.deepEqual(
    queued.map((job) => job.kind),
    ["evergreen_candidate_builder", "plan_weekly_longform"],
  );
  assert.ok(
    queued.every(
      (job) =>
        job.payload.publish_authority === false &&
        job.payload.live_publish_enabled === false &&
        job.payload.human_review_required === true &&
        job.idempotency_key.includes(workflowRevision),
    ),
  );
  assert.deepEqual(
    result.followup_jobs.map((job) => job.kind),
    ["evergreen_candidate_builder", "plan_weekly_longform"],
  );
});

test("official current-week backfill deterministically seeds no more than six editorial evidence jobs", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-editorial-backfill-"),
  );
  t.after(() => fs.remove(outDir));
  const stories = Array.from({ length: 7 }, (_, index) =>
    governedStory({
      id: `official-${index + 1}`,
      title: `Official Xbox update ${index + 1}`,
      article_url:
        `https://news.xbox.com/en-us/2026/07/28/official-${index + 1}/`,
      url:
        `https://news.xbox.com/en-us/2026/07/28/official-${index + 1}/`,
      timestamp:
        `2026-07-28T${String(13 - index).padStart(2, "0")}:30:00.000Z`,
    }),
  );
  const decisions = stories.map((story, index) =>
    governedDecision(story.id, {
      total: 100 - index,
    }),
  );
  const queued = [];

  const result =
    await handlers.governed_editorial_evidence_backfill(
      {
        kind: "governed_editorial_evidence_backfill",
        channel_id: "pulse-gaming",
        payload: {
          now: NOW,
          out_dir: outDir,
          stories,
          latest_decisions: decisions,
          scheduler_profile: "governed_multi_lane",
          governed_multi_lane: true,
          planning_only: true,
          live_publish_enabled: false,
          publish_authority: false,
          human_admission_required: true,
          human_review_required: true,
        },
      },
      {
        repos: {
          jobs: {
            enqueue(input) {
              queued.push(input);
              return { id: 100 + queued.length, ...input };
            },
          },
        },
        log() {},
      },
    );

  assert.equal(result.status, "READY", JSON.stringify(result));
  assert.equal(result.queued_count, 6);
  assert.equal(queued.length, 6);
  assert.ok(
    queued.every(
      (job) =>
        job.kind === "governed_editorial_evidence_discovery" &&
        job.payload.publish_authority === false &&
        job.payload.external_posting_authorised === false,
    ),
  );
  assert.equal(
    queued.some((job) => job.kind === "publish"),
    false,
  );
  const report = await fs.readJson(result.report_json);
  assert.equal(report.selection.summary.selected_count, 6);
  assert.equal(report.selection.summary.deferred_count, 1);
});

test("editorial backfill rotates past recently attempted stories before filling its bounded batch", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-editorial-backfill-rotation-"),
  );
  t.after(() => fs.remove(outDir));
  const stories = Array.from({ length: 8 }, (_, index) =>
    governedStory({
      id: `rotation-${index + 1}`,
      title: `Official Xbox rotation update ${index + 1}`,
      article_url:
        `https://news.xbox.com/en-us/2026/07/28/rotation-${index + 1}/`,
      url:
        `https://news.xbox.com/en-us/2026/07/28/rotation-${index + 1}/`,
      timestamp:
        `2026-07-28T${String(13 - index).padStart(2, "0")}:30:00.000Z`,
    }),
  );
  const queued = [];
  let recentAttemptQuerySeen = false;

  const result =
    await handlers.governed_editorial_evidence_backfill(
      {
        kind: "governed_editorial_evidence_backfill",
        channel_id: "pulse-gaming",
        payload: {
          now: NOW,
          out_dir: outDir,
          stories,
          latest_decisions: stories.map((item, index) =>
            governedDecision(item.id, {
              total: 100 - index,
            }),
          ),
          scheduler_profile: "governed_multi_lane",
          governed_multi_lane: true,
          planning_only: true,
          live_publish_enabled: false,
          publish_authority: false,
          human_admission_required: true,
          human_review_required: true,
        },
      },
      {
        repos: {
          db: {
            prepare(sql) {
              recentAttemptQuerySeen =
                sql.includes("FROM jobs") &&
                sql.includes(
                  "governed_editorial_evidence_discovery",
                );
              return {
                all() {
                  return stories.slice(0, 2).map((item) => ({
                    story_id: item.id,
                  }));
                },
              };
            },
          },
          jobs: {
            enqueue(input) {
              queued.push(input);
              return { id: 200 + queued.length, ...input };
            },
          },
        },
        log() {},
      },
    );

  assert.equal(recentAttemptQuerySeen, true);
  assert.equal(result.status, "READY", JSON.stringify(result));
  assert.deepEqual(
    queued.map((item) => item.story_id),
    stories.slice(2).map((item) => item.id),
  );
  const report = await fs.readJson(result.report_json);
  assert.equal(report.selection.summary.selected_count, 6);
  assert.equal(report.selection.summary.rejected_count, 2);
  assert.ok(
    report.selection.rejected.every((item) =>
      item.blockers.includes(
        "editorial_backfill_story_recently_attempted",
      ),
    ),
  );
});

test("editorial backfill advances past permanent idempotency conflicts instead of starving deferred official stories", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-editorial-backfill-conflict-rotation-"),
  );
  t.after(() => fs.remove(outDir));
  const stories = Array.from({ length: 8 }, (_, index) =>
    governedStory({
      id: `conflict-rotation-${index + 1}`,
      title: `Official Xbox conflict rotation update ${index + 1}`,
      article_url:
        `https://news.xbox.com/en-us/2026/07/28/conflict-rotation-${index + 1}/`,
      url:
        `https://news.xbox.com/en-us/2026/07/28/conflict-rotation-${index + 1}/`,
      timestamp:
        `2026-07-28T${String(13 - index).padStart(2, "0")}:30:00.000Z`,
    }),
  );
  const conflictingIds = new Set(
    stories.slice(0, 6).map((story) => story.id),
  );
  const queued = [];
  const existingByKey = new Map();

  const result =
    await handlers.governed_editorial_evidence_backfill(
      {
        kind: "governed_editorial_evidence_backfill",
        channel_id: "pulse-gaming",
        payload: {
          now: NOW,
          out_dir: outDir,
          stories,
          latest_decisions: stories.map((item, index) =>
            governedDecision(item.id, {
              total: 100 - index,
            }),
          ),
          scheduler_profile: "governed_multi_lane",
          governed_multi_lane: true,
          planning_only: true,
          live_publish_enabled: false,
          publish_authority: false,
          human_admission_required: true,
          human_review_required: true,
        },
      },
      {
        repos: {
          jobs: {
            getByIdempotencyKey(key) {
              return existingByKey.get(key) || null;
            },
            enqueue(input) {
              if (conflictingIds.has(input.story_id)) {
                existingByKey.set(input.idempotency_key, {
                  id: 250 + existingByKey.size,
                  status: "done",
                  ...input,
                });
                const error = new Error("job_idempotency_conflict");
                error.code = "job_idempotency_conflict";
                throw error;
              }
              queued.push(input);
              return { id: 300 + queued.length, ...input };
            },
          },
        },
        log() {},
      },
    );

  assert.equal(result.status, "READY", JSON.stringify(result));
  assert.equal(result.queued_count, 2);
  assert.deepEqual(
    queued.map((item) => item.story_id),
    stories.slice(6).map((item) => item.id),
  );
  const report = await fs.readJson(result.report_json);
  assert.equal(report.enqueue_summary.attempted_count, 8);
  assert.equal(report.enqueue_summary.already_scheduled_count, 6);
  assert.equal(report.enqueue_summary.queued_count, 2);
  assert.deepEqual(
    report.enqueue_attempts
      .filter(
        (attempt) =>
          attempt.reason ===
          "governed_editorial_evidence_already_scheduled",
      )
      .map((attempt) => attempt.story_id),
    stories.slice(0, 6).map((item) => item.id),
  );
});

test("editorial backfill reports all-conflict supply as already scheduled, never up to date", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-editorial-backfill-all-conflict-"),
  );
  t.after(() => fs.remove(outDir));
  const stories = Array.from({ length: 3 }, (_, index) =>
    governedStory({
      id: `all-conflict-${index + 1}`,
      title: `Official Xbox existing evidence ${index + 1}`,
      article_url:
        `https://news.xbox.com/en-us/2026/07/28/all-conflict-${index + 1}/`,
      url:
        `https://news.xbox.com/en-us/2026/07/28/all-conflict-${index + 1}/`,
    }),
  );
  const existingByKey = new Map();

  const result =
    await handlers.governed_editorial_evidence_backfill(
      {
        kind: "governed_editorial_evidence_backfill",
        channel_id: "pulse-gaming",
        payload: {
          now: NOW,
          out_dir: outDir,
          stories,
          latest_decisions: stories.map((item) =>
            governedDecision(item.id),
          ),
          scheduler_profile: "governed_multi_lane",
          governed_multi_lane: true,
          planning_only: true,
          live_publish_enabled: false,
          publish_authority: false,
          human_admission_required: true,
          human_review_required: true,
        },
      },
      {
        repos: {
          jobs: {
            getByIdempotencyKey(key) {
              return existingByKey.get(key) || null;
            },
            enqueue(input) {
              existingByKey.set(input.idempotency_key, {
                id: 400 + existingByKey.size,
                status: "done",
                ...input,
              });
              const error = new Error("job_idempotency_conflict");
              error.code = "job_idempotency_conflict";
              throw error;
            },
          },
        },
        log() {},
      },
    );

  assert.equal(result.status, "ALREADY_SCHEDULED");
  assert.notEqual(result.status, "UP_TO_DATE");
  assert.equal(result.queued_count, 0);
  const report = await fs.readJson(result.report_json);
  assert.equal(report.enqueue_summary.attempted_count, 3);
  assert.equal(report.enqueue_summary.already_scheduled_count, 3);
  assert.equal(report.enqueue_summary.queued_count, 0);
});

test("editorial backfill re-admits an old terminal HOLD once and fences the revision against duplicate work", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-editorial-backfill-revision-"),
  );
  t.after(() => fs.remove(outDir));
  const db = new Database(":memory:");
  runMigrations(db, {
    log() {},
    env: { PULSE_RUNTIME_MODE: "LOCAL_PROOF" },
  });
  db.prepare(
    "INSERT INTO channels (id, name) VALUES (?, ?)",
  ).run("pulse-gaming", "Pulse Gaming");
  t.after(() => db.close());
  const jobs = bindJobs(db);
  const currentStory = governedStory({
    timestamp: "2026-07-28T04:30:00.000Z",
    created_at: "2026-07-28T04:31:00.000Z",
  });
  const latestDecision = governedDecision(currentStory.id, {
    scored_at: "2026-07-28T04:45:00.000Z",
  });
  db.prepare(`
    INSERT INTO stories
      (id, title, url, timestamp, channel_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    currentStory.id,
    currentStory.title,
    currentStory.url,
    currentStory.timestamp,
    currentStory.channel_id,
  );
  const initial = enqueueGovernedEditorialEvidence({
    story: currentStory,
    latestDecision,
    jobs,
    now: "2026-07-28T05:00:00.000Z",
  });
  const claimed = jobs.claim("terminal-hold-worker", {
    kinds: ["governed_editorial_evidence_discovery"],
  });
  jobs.complete(
    claimed.id,
    "terminal-hold-worker",
    claimed.claim_token,
    {
      log: JSON.stringify({
        ok: true,
        verdict: "HOLD",
        blockers: [
          "official_or_corroborated_body_evidence_required",
        ],
      }),
    },
  );
  db.prepare(`
    UPDATE jobs
    SET created_at = '2026-07-28 05:00:00',
        updated_at = '2026-07-28 05:05:00',
        completed_at = '2026-07-28 05:05:00'
    WHERE id = ?
  `).run(initial.job.id);

  const inputJob = {
    kind: "governed_editorial_evidence_backfill",
    channel_id: "pulse-gaming",
    payload: {
      now: NOW,
      out_dir: outDir,
      stories: [currentStory],
      latest_decisions: [latestDecision],
      recent_attempted_story_ids: [],
      scheduler_profile: "governed_multi_lane",
      governed_multi_lane: true,
      planning_only: true,
      live_publish_enabled: false,
      publish_authority: false,
      human_admission_required: true,
      human_review_required: true,
    },
  };
  const context = {
    repos: { db, jobs },
    log() {},
  };

  const first =
    await handlers.governed_editorial_evidence_backfill(
      inputJob,
      context,
    );
  const second =
    await handlers.governed_editorial_evidence_backfill(
      inputJob,
      context,
    );
  const pending = jobs.listPending();
  const firstReport = await fs.readJson(first.report_json);

  assert.equal(first.status, "READY", JSON.stringify(first));
  assert.equal(first.queued_count, 1);
  assert.equal(
    first.enqueue_attempts[0].reason,
    "governed_editorial_evidence_revision_enqueued",
  );
  assert.equal(second.status, "ALREADY_SCHEDULED");
  assert.equal(second.queued_count, 0);
  assert.equal(pending.length, 1);
  assert.match(
    pending[0].idempotency_key,
    /^governed-editorial-evidence:v2:rss-xbox-classics:[a-f0-9]{64}:[a-f0-9]{64}$/,
  );
  assert.equal(
    pending[0].payload.evidence_attempt_revision
      .bucket_started_at,
    "2026-07-28T12:00:00.000Z",
  );
  assert.equal(
    pending[0].payload.evidence_attempt_revision
      .bucket_ends_at,
    "2026-07-28T18:00:00.000Z",
  );
  assert.notEqual(
    pending[0].idempotency_key,
    initial.job.idempotency_key,
  );
  assert.equal(
    firstReport.rotation.evidence_refresh_bucket_hours,
    6,
  );
  assert.equal(
    firstReport.rotation.recent_attempt_window_hours,
    5,
  );
});
