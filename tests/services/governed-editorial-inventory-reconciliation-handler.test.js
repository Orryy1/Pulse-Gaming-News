"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { handlers } = require("../../lib/job-handlers");

const NOW = "2026-07-28T12:00:00.000Z";

function governedPayload(root, overrides = {}) {
  return {
    root_dir: root,
    breaking_discovery_root: path.join(root, "breaking-discovery"),
    inventory_root_dir: path.join(root, "editorial-inventory"),
    out_dir: path.join(root, "reconciliation"),
    now: NOW,
    scheduler_profile: "governed_multi_lane",
    governed_multi_lane: true,
    planning_only: true,
    live_publish_enabled: false,
    publish_authority: false,
    human_admission_required: true,
    human_review_required: true,
    ...overrides,
  };
}

function emptyInventoryReport() {
  return {
    schema_version:
      "pulse-governed-editorial-inventory-registry-v1",
    generated_at: NOW,
    mode: "LOCAL_PROOF",
    verdict: "HOLD",
    blockers: ["governed_editorial_inventory_root_required"],
    entries: [],
    rejected: [],
    evergreen_stories: [],
    weekly_longform_candidates: [],
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

test("reconciliation handler is registered and fans exact evidence into governed inventory preparation", async (t) => {
  assert.equal(
    typeof handlers.reconcile_editorial_inventory,
    "function",
  );
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-reconcile-handler-"),
  );
  t.after(() => fs.remove(root));
  const queued = [];
  const inventoryReport = emptyInventoryReport();
  let reconciliationInput = null;

  const result = await handlers.reconcile_editorial_inventory(
    {
      kind: "reconcile_editorial_inventory",
      channel_id: "pulse-gaming",
      payload: governedPayload(root),
    },
    {
      async scanGovernedEditorialInventory() {
        return inventoryReport;
      },
      async reconcileBreakingEditorialInventory(input) {
        reconciliationInput = input;
        return {
          schema_version:
            "pulse-breaking-editorial-inventory-reconciliation-v1",
          generated_at: NOW,
          mode: "LOCAL_PROOF",
          verdict: "READY",
          blockers: [],
          work_items: [
            {
              story_id: "xbox-reconcile-1",
              breaking_source_evidence: {
                path: path.join(root, "breaking-discovery", "source.json"),
                file_sha256: "a".repeat(64),
                canonical_sha256: "b".repeat(64),
              },
            },
            {
              story_id: "missing-canonical-story",
              breaking_source_evidence: {
                path: path.join(root, "breaking-discovery", "missing.json"),
                file_sha256: "c".repeat(64),
                canonical_sha256: "d".repeat(64),
              },
            },
          ],
          skipped: [],
          rejected: [],
          traversal: {
            entries_visited: 2,
            directories_visited: 1,
            candidate_count: 2,
            limit_reached: false,
          },
          summary: {
            candidate_count: 2,
            work_item_count: 2,
            skipped_count: 0,
            rejected_count: 0,
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
      },
      repos: {
        stories: {
          get(storyId) {
            if (storyId !== "xbox-reconcile-1") return null;
            return {
              id: storyId,
              title: "Xbox confirms a major compatibility expansion",
              url: "https://news.xbox.com/en-us/example/",
              timestamp: NOW,
              subject_ids: ["xbox"],
              _extra: "{}",
            };
          },
        },
        jobs: {
          enqueue(request) {
            const row = { id: queued.length + 1, ...request };
            queued.push(row);
            return row;
          },
        },
      },
    },
  );

  assert.equal(
    reconciliationInput.governedInventoryReport,
    inventoryReport,
  );
  assert.equal(queued.length, 1);
  assert.equal(queued[0].kind, "prepare_editorial_inventory");
  assert.equal(queued[0].story_id, "xbox-reconcile-1");
  assert.equal(queued[0].payload.story.franchise, "Xbox");
  assert.equal(
    queued[0].payload.story.platform,
    "Xbox Series X|S",
  );
  assert.equal(
    queued[0].payload.story.verification_status,
    "CONFIRMED",
  );
  assert.equal(
    queued[0].payload.breaking_source_evidence.canonical_sha256,
    "b".repeat(64),
  );
  assert.equal(queued[0].payload.publish_authority, false);
  assert.equal(queued[0].payload.human_review_required, true);
  assert.equal(
    queued[0].idempotency_key,
    `editorial-inventory:xbox-reconcile-1:${"b".repeat(64)}`,
  );
  assert.equal(result.status, "PARTIAL");
  assert.equal(result.queued_count, 1);
  assert.deepEqual(result.held, [
    {
      story_id: "missing-canonical-story",
      blocker: "canonical_story_not_found",
    },
  ]);
  assert.equal(await fs.pathExists(result.report_json), true);
  assert.equal(await fs.pathExists(result.report_markdown), true);
  assert.equal(result.no_publish, true);
  assert.equal(result.no_external_posting, true);
});

test("reconciliation handler fails closed before scanning when the governed safety envelope is absent", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-reconcile-handler-hold-"),
  );
  t.after(() => fs.remove(root));
  let scannerCalled = false;
  const queued = [];

  const result = await handlers.reconcile_editorial_inventory(
    {
      kind: "reconcile_editorial_inventory",
      payload: governedPayload(root, {
        governed_multi_lane: false,
        publish_authority: true,
      }),
    },
    {
      async reconcileBreakingEditorialInventory() {
        scannerCalled = true;
      },
      repos: {
        jobs: {
          enqueue(request) {
            queued.push(request);
          },
        },
      },
    },
  );

  assert.equal(scannerCalled, false);
  assert.deepEqual(queued, []);
  assert.equal(result.status, "HOLD");
  assert.ok(
    result.blockers.includes(
      "governed_editorial_inventory_reconciliation_safety_envelope_required",
    ),
  );
  assert.equal(result.no_publish, true);
});
