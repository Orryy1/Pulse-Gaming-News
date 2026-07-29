"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { handlers } = require("../../lib/job-handlers");
const {
  SAFETY_ENVELOPE_SCHEMA,
} = require("../../lib/services/governed-editorial-inventory-workflow");

const NOW = "2026-07-28T12:00:00.000Z";

function exactJobPayload(overrides = {}) {
  return {
    story: {
      id: "xbox-editorial-inventory-1",
      title: "Xbox confirms a compatibility expansion",
      franchise: "Xbox",
      platform: "Xbox Series X|S",
      topic_key: "xbox-compatibility-expansion",
      published_at: NOW,
      primary_source_url: "https://news.xbox.com/example",
      verification_status: "CONFIRMED",
      subject_ids: ["xbox-backcompat"],
    },
    breaking_source_evidence: {
      path: "C:/proof/breaking-source-evidence.json",
      file_sha256: "1".repeat(64),
      canonical_sha256: "2".repeat(64),
    },
    publish_authority: false,
    human_review_required: true,
    ...overrides,
  };
}

test("inventory handler runs the exact local-only workflow and creates no external authority", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-inventory-job-"),
  );
  t.after(() => fs.remove(outDir));
  let observed = null;

  const result = await handlers.prepare_editorial_inventory(
    {
      kind: "prepare_editorial_inventory",
      payload: exactJobPayload({
        out_dir: outDir,
        root_dir: path.dirname(outDir),
        now: NOW,
      }),
    },
    {
      env: {
        PULSE_EMERGENCY_KILL_SWITCH: "false",
        PULSE_KILL_SWITCH: "false",
      },
      async runGovernedEditorialInventoryWorkflow(input) {
        observed = input;
        return {
          verdict: "READY",
          blockers: [],
          paths: {
            report: path.join(outDir, "workflow.json"),
            summary: path.join(outDir, "workflow.md"),
            inventory: path.join(outDir, "inventory.json"),
          },
          report: {
            workflow_revision_sha256: "3".repeat(64),
          },
          safety: {
            network_used: false,
            database_mutated: false,
            oauth_mutated: false,
            platform_contacted: false,
            publish_authority_created: false,
          },
        };
      },
    },
  );

  assert.equal(observed.story.id, "xbox-editorial-inventory-1");
  assert.equal(
    observed.breaking_source_evidence.file_sha256,
    "1".repeat(64),
  );
  assert.equal(observed.safety.schema_version, SAFETY_ENVELOPE_SCHEMA);
  assert.equal(observed.safety.publish_authority, false);
  assert.equal(observed.safety.network_authorised, false);
  assert.equal(observed.safety.database_mutation_authorised, false);
  assert.equal(observed.safety.oauth_mutation_authorised, false);
  assert.equal(observed.safety.emergency_kill_switch_engaged, false);
  assert.equal(result.status, "READY");
  assert.equal(result.no_publish, true);
  assert.equal(result.no_external_posting, true);
});

test("inventory handler holds incomplete evidence before invoking media generation", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-inventory-job-held-"),
  );
  t.after(() => fs.remove(outDir));
  let called = false;

  const result = await handlers.prepare_editorial_inventory(
    {
      kind: "prepare_editorial_inventory",
      payload: exactJobPayload({
        out_dir: outDir,
        root_dir: path.dirname(outDir),
        breaking_source_evidence: {
          path: "C:/proof/breaking-source-evidence.json",
        },
      }),
    },
    {
      async runGovernedEditorialInventoryWorkflow() {
        called = true;
      },
    },
  );

  assert.equal(called, false);
  assert.equal(result.status, "HOLD");
  assert.ok(
    result.blockers.includes(
      "breaking_source_evidence_file_sha256_required",
    ),
  );
  assert.equal(await fs.pathExists(result.report_json), true);
  assert.equal(result.no_publish, true);
});

test("governed breaking hunt fans out both urgent planning and background inventory preparation", async () => {
  const queued = [];
  const fingerprint = "a".repeat(64);
  const sourceFileHash = "b".repeat(64);
  const sourceCanonicalHash = "c".repeat(64);
  const result = await handlers.hunt(
    {
      channel_id: "pulse-gaming",
      payload: {
        breaking_story_id: "breaking-hunt-1",
        breaking_event_fingerprint_sha256: fingerprint,
        verification_status: "CONFIRMED",
        primary_source_url: "https://news.xbox.com/example",
        source_evidence_sha256: sourceCanonicalHash,
        source_evidence_path: "C:/proof/source.json",
        source_evidence_file_sha256: sourceFileHash,
      },
    },
    {
      async hunter() {
        return [{ id: "breaking-hunt-1" }];
      },
      async processStories() {},
      async autoApprove() {
        return { scored: 1 };
      },
      repos: {
        stories: {
          get() {
            return {
              id: "breaking-hunt-1",
              title: "Xbox confirms a compatibility expansion",
              published_at: NOW,
              primary_source_url: "https://news.xbox.com/example",
              subject_ids: ["xbox-backcompat"],
              _extra: JSON.stringify({
                platform: "Xbox Series X|S",
                franchise: "Xbox",
              }),
            };
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
    ["governed_multi_lane_plan", "prepare_editorial_inventory"],
  );
  assert.equal(
    queued[0].payload.source_evidence_path,
    "C:/proof/source.json",
  );
  assert.equal(
    queued[1].payload.breaking_source_evidence.file_sha256,
    sourceFileHash,
  );
  assert.equal(queued[1].payload.publish_authority, false);
  assert.equal(result.followup_plan_job_id, 1);
  assert.equal(result.editorial_inventory_job_id, 2);
});
