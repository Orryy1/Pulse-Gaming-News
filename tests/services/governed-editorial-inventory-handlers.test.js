"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { handlers } = require("../../lib/job-handlers");

const NOW = "2026-07-28T12:00:00.000Z";

function inventoryReport(overrides = {}) {
  return {
    schema_version:
      "pulse-governed-editorial-inventory-registry-v1",
    generated_at: NOW,
    mode: "LOCAL_PROOF",
    verdict: "READY",
    blockers: [],
    entries: [],
    rejected: [],
    evergreen_stories: [],
    weekly_longform_candidates: [],
    summary: {
      registry_count: 2,
      ready_count: 2,
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
    ...overrides,
  };
}

test("scheduled evergreen discovery consumes governed inventory and preserves canonical story fields", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-evergreen-inventory-handler-"),
  );
  t.after(() => fs.remove(outDir));
  let observedStories = null;
  const sourceHash = "1".repeat(64);
  const db = {
    prepare(sql) {
      if (sql.includes("FROM stories")) {
        return {
          all: () => [
            {
              id: "inventory-story-1",
              title: "Canonical title",
              full_script: "A canonical draft script.",
              breaking_score: 98,
              _extra: JSON.stringify({ canonical_marker: true }),
            },
          ],
        };
      }
      if (sql.includes("FROM story_scores")) {
        return { all: () => [] };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };

  const result = await handlers.evergreen_candidate_builder(
    {
      channel_id: "pulse-gaming",
      payload: { now: NOW, out_dir: outDir },
    },
    {
      repos: { db },
      async scanGovernedEditorialInventory() {
        return inventoryReport({
          evergreen_stories: [
            {
              id: "inventory-story-1",
              title: "Verified inventory title",
              franchise: "Halo",
              platform: "xbox",
              topic_key: "halo-update",
              published_at: NOW,
              primary_source_url: "https://news.xbox.com/example",
              verification_status: "CONFIRMED",
              _extra: JSON.stringify({
                source_evidence_path: "C:/proof/source.json",
                source_evidence_sha256: sourceHash,
              }),
            },
            {
              id: "inventory-story-2",
              title: "Second verified inventory story",
              franchise: "Forza",
              platform: "xbox",
              topic_key: "forza-update",
              published_at: NOW,
              primary_source_url: "https://news.xbox.com/second",
              verification_status: "CONFIRMED",
              _extra: JSON.stringify({
                source_evidence_path: "C:/proof/source-2.json",
                source_evidence_sha256: "2".repeat(64),
              }),
            },
          ],
        });
      },
      async buildEvergreenAutonomousDiscoveryInputs({ stories }) {
        observedStories = stories;
        return {
          schema_version:
            "pulse-evergreen-autonomous-input-adapter-v1",
          generated_at: NOW,
          mode: "LOCAL_PROOF",
          verdict: "HOLD",
          blockers: ["fixture_stops_before_generation"],
          discovery_inputs: { stories: [], manifests: [] },
          accepted_inputs: [],
          rejected_inputs: [],
          summary: {
            input_count: stories.length,
            accepted_count: 0,
            rejected_count: stories.length,
          },
          safety: {
            read_only: true,
            network_used: false,
            database_mutated: false,
            oauth_mutated: false,
            publish_authority_created: false,
          },
        };
      },
    },
  );

  assert.equal(observedStories.length, 2);
  const merged = observedStories.find(
    (story) => story.id === "inventory-story-1",
  );
  assert.equal(merged.full_script, "A canonical draft script.");
  assert.equal(merged.title, "Verified inventory title");
  assert.equal(JSON.parse(merged._extra).canonical_marker, true);
  assert.equal(
    JSON.parse(merged._extra).source_evidence_sha256,
    sourceHash,
  );
  assert.equal(result.editorial_inventory_ready_count, 2);
  assert.equal(
    await fs.pathExists(result.editorial_inventory_scan_json),
    true,
  );
  assert.equal(result.no_publish, true);
});

test("weekly planning includes stories already used as Shorts and merges exact inventory evidence", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-weekly-inventory-handler-"),
  );
  t.after(() => fs.remove(outDir));
  let observedCandidates = null;
  let observedSql = null;
  const db = {
    prepare(sql) {
      observedSql = sql;
      if (!sql.includes("FROM stories")) {
        throw new Error(`unexpected SQL: ${sql}`);
      }
      return {
        all: () => [
          {
            id: "weekly-story-1",
            title: "A strong story already used as a Short",
            youtube_post_id: "youtube-short-123",
            published_at: "2026-07-27T12:00:00.000Z",
            breaking_score: 120,
            _extra: "{}",
          },
        ],
      };
    },
  };

  const result = await handlers.plan_weekly_longform(
    {
      channel_id: "pulse-gaming",
      payload: {
        now: NOW,
        out_dir: outDir,
        run_id: "weekly-flagship-2026-W31",
      },
    },
    {
      repos: { db },
      async scanGovernedEditorialInventory() {
        return inventoryReport({
          weekly_longform_candidates: [
            {
              id: "weekly-story-1",
              title: "Verified weekly story",
              published_at: "2026-07-27T12:00:00.000Z",
              primary_source_url: "https://news.xbox.com/weekly",
              verification_status: "CONFIRMED",
              weekly_priority_score: 0,
              source_evidence: {
                path: "C:/proof/weekly-source.json",
                sha256: "3".repeat(64),
              },
              rights_ledger: {
                path: "C:/proof/rights.json",
                sha256: "4".repeat(64),
              },
            },
            {
              id: "weekly-story-2",
              title: "Another verified weekly story",
              published_at: NOW,
              primary_source_url: "https://news.playstation.com/weekly",
              verification_status: "CONFIRMED",
              weekly_priority_score: 80,
              source_evidence: {
                path: "C:/proof/weekly-source-2.json",
                sha256: "5".repeat(64),
              },
              rights_ledger: {
                path: "C:/proof/rights-2.json",
                sha256: "6".repeat(64),
              },
            },
          ],
        });
      },
      async materializeWeeklyLongformWorkOrder({ candidates }) {
        observedCandidates = candidates;
        return {
          workOrder: {
            blockers: ["weekly_verified_candidate_count_must_be_4_to_6"],
            selection: { selected: [] },
            script: {},
            visual_beat_plan: { beat_count: 0 },
          },
          paths: {
            json: path.join(outDir, "work-order.json"),
            markdown: path.join(outDir, "work-order.md"),
          },
          json_sha256: "7".repeat(64),
        };
      },
    },
  );

  assert.doesNotMatch(
    observedSql,
    /WHERE\s+COALESCE\(youtube_post_id/i,
  );
  assert.equal(observedCandidates.length, 2);
  const merged = observedCandidates.find(
    (candidate) => candidate.id === "weekly-story-1",
  );
  assert.equal(merged.title, "Verified weekly story");
  assert.equal(merged.weekly_priority_score, 120);
  assert.equal(merged.source_evidence.sha256, "3".repeat(64));
  assert.equal(result.editorial_inventory_ready_count, 2);
  assert.equal(result.no_publish, true);
});
