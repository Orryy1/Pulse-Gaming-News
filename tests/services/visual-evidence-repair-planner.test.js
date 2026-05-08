"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildVisualEvidenceRepairPlan,
  renderVisualEvidenceRepairMarkdown,
  classifyRepair,
} = require("../../lib/ops/visual-evidence-repair-planner");

const ROOT = path.resolve(__dirname, "..", "..");

function row(overrides = {}) {
  return {
    story_id: "story_visual",
    title: "GTA story needs better gameplay stills",
    stage: "needs_visual_evidence_repair",
    blocking_dimensions: ["visual_evidence", "validated_motion"],
    audio: { ready: true },
    visuals: {
      visual_evidence_gate_ready: false,
      exact_subject_count: 8,
      cover_dominated_exact_asset_count: 6,
      cover_dominated_exact_asset_share: 0.75,
      wrong_story_exact_asset_count: 0,
      unverified_store_exact_asset_count: 0,
      missing_motion_entities: ["GTA"],
    },
    ...overrides,
  };
}

test("visual repair planner turns cover-dominated Flash rows into gameplay-still commands", () => {
  const report = buildVisualEvidenceRepairPlan({
    currentStateReport: { rows: [row()] },
  });

  const repair = report.rows[0];
  assert.equal(repair.repair_class, "cover_dominated_exact_assets");
  assert.equal(repair.action, "replace_covers_with_gameplay_stills");
  assert.equal(repair.cover_dominated_exact_asset_share, 0.75);
  assert.ok(repair.commands.some((item) => item.command.includes("--prefer-gameplay-stills")));
  assert.ok(repair.commands.some((item) => item.safety === "apply_local_under_test_output_only"));
  assert.ok(
    repair.commands.some((item) =>
      item.command.includes("--reference-report test/output/official_trailer_references_v1_story_story_visual.json"),
    ),
  );
  assert.equal(report.summary.cover_dominated, 1);
});

test("visual repair planner prioritises wrong-story exact assets over cover repair", () => {
  const repair = classifyRepair(
    row({
      visuals: {
        visual_evidence_gate_ready: false,
        exact_subject_count: 6,
        cover_dominated_exact_asset_count: 4,
        cover_dominated_exact_asset_share: 0.667,
        wrong_story_exact_asset_count: 3,
        wrong_story_exact_asset_groups: ["Metro 2033"],
      },
    }),
  );

  assert.equal(repair.repair_class, "wrong_story_exact_assets");
  assert.equal(repair.action, "rerun_entity_filtered_gameplay_still_search");
});

test("visual repair planner adds verified-store repair command for unverified exact assets", () => {
  const report = buildVisualEvidenceRepairPlan({
    currentStateReport: {
      rows: [
        row({
          visuals: {
            visual_evidence_gate_ready: false,
            exact_subject_count: 5,
            cover_dominated_exact_asset_count: 0,
            wrong_story_exact_asset_count: 0,
            unverified_store_exact_asset_count: 5,
          },
        }),
      ],
    },
  });

  assert.equal(report.rows[0].repair_class, "unverified_store_assets");
  assert.match(report.rows[0].commands[0].command, /--verified-store-metadata/);
  assert.equal(report.summary.unverified_store, 1);
});

test("visual repair planner ignores non-visual-repair rows", () => {
  const report = buildVisualEvidenceRepairPlan({
    currentStateReport: {
      rows: [
        row({
          story_id: "needs_audio",
          stage: "needs_local_liam_audio",
          blocking_dimensions: ["audio"],
          visuals: {
            visual_evidence_gate_ready: true,
            exact_subject_count: 0,
            cover_dominated_exact_asset_count: 0,
          },
        }),
      ],
    },
  });

  assert.equal(report.rows.length, 0);
  assert.equal(report.summary.repair_candidates, 0);
});

test("visual repair markdown is operator-readable and safety labelled", () => {
  const report = buildVisualEvidenceRepairPlan({
    currentStateReport: { rows: [row({ title: "GTA | Red Dead cover problem" })] },
  });
  const md = renderVisualEvidenceRepairMarkdown(report);

  assert.match(md, /Visual Evidence Repair Plan/);
  assert.match(md, /GTA \\| Red Dead cover problem/);
  assert.match(md, /media:enrich-stills/);
  assert.match(md, /No Railway, OAuth, production DB, scheduler, renderer, TTS, upload or social posting behaviour is changed/);
});

test("visual repair command is registered and read-only", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.scripts["studio:v2:visual-repair"], "node tools/visual-evidence-repair-planner.js");
  assert.equal(pkg.scripts["ops:visual-repair"], "node tools/visual-evidence-repair-planner.js");
  const tool = fs.readFileSync(path.join(ROOT, "tools", "visual-evidence-repair-planner.js"), "utf8");
  assert.match(tool, /visual_evidence_repair_plan\.json/);
  assert.match(tool, /Does not download, render, call TTS, post, mutate DB, touch Railway or trigger OAuth/);
});
