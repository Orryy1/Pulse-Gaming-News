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

test("visual repair planner turns cover-dominated proof candidates into gameplay-still repair", () => {
  const report = buildVisualEvidenceRepairPlan({
    proofCandidateReport: {
      candidates: [
        {
          story_id: "story_cover",
          title: "Legacy game cover deck",
          verdict: "needs_motion_or_exact_assets",
          blockers: ["flash_proof_requires_four_exact_subject_assets"],
          audio: { ready: false, status: "local_liam_audio_not_flash_ready" },
          visuals: {
            exact_subject_count: 6,
            cover_dominated_exact_asset_count: 4,
            cover_dominated_exact_asset_share: 0.667,
            wrong_story_exact_asset_count: 0,
            validated_clip_ref_count: 0,
            validated_clip_source_count: 0,
            story_target_entities: ["Oblivion"],
            validated_clip_entities: [],
          },
        },
      ],
    },
  });

  const repair = report.rows.find((item) => item.story_id === "story_cover");
  assert.equal(repair.action, "replace_covers_with_gameplay_stills");
  assert.equal(repair.primary_action_type, "cover_dominated_deck_repair");
  assert.ok(repair.ranked_actions.some((item) => item.action_type === "exact_subject_gameplay_still_repair"));
  assert.ok(repair.commands.some((item) => item.command.includes("--prefer-gameplay-stills")));
  assert.equal(report.summary.cover_dominated, 1);
});

test("visual repair planner blocks wrong-story proof decks and queues entity-filtered repair", () => {
  const report = buildVisualEvidenceRepairPlan({
    proofCandidateReport: {
      candidates: [
        {
          story_id: "story_wrong",
          title: "GTA story with unrelated exact assets",
          verdict: "needs_motion_or_exact_assets",
          blockers: ["flash_proof_blocks_wrong_story_exact_assets"],
          audio: { ready: true, status: "approved_local_liam_audio_ready" },
          visuals: {
            exact_subject_count: 39,
            cover_dominated_exact_asset_count: 13,
            wrong_story_exact_asset_count: 22,
            wrong_story_exact_asset_groups: ["BioShock", "Red Dead"],
            story_target_entities: ["GTA"],
            validated_clip_ref_count: 9,
            validated_clip_source_count: 4,
            validated_clip_entities: ["GTA", "BioShock", "Red Dead"],
          },
        },
      ],
    },
  });

  const repair = report.rows.find((item) => item.story_id === "story_wrong");
  assert.equal(repair.repair_class, "wrong_story_exact_assets");
  assert.equal(repair.primary_action_type, "wrong_story_deck_rejection");
  assert.ok(repair.ranked_actions.some((item) => item.action_type === "reject_wrong_story_deck"));
  assert.ok(repair.ranked_actions.some((item) => item.action_type === "exact_subject_gameplay_still_repair"));
  assert.equal(repair.render_recommendation, "do_not_render_yet");
  assert.equal(report.summary.wrong_story, 1);
});

test("visual repair planner routes exhausted bad windows to alternate official source intake", () => {
  const report = buildVisualEvidenceRepairPlan({
    proofCandidateReport: {
      candidates: [
        {
          story_id: "story_exhausted",
          title: "Story with exhausted trailer windows",
          verdict: "needs_motion_or_exact_assets",
          blockers: ["footage_backbone_clip_dominance_too_low"],
          audio: { ready: true, status: "approved_local_liam_audio_ready" },
          visuals: {
            exact_subject_count: 8,
            cover_dominated_exact_asset_count: 0,
            wrong_story_exact_asset_count: 0,
            story_target_entities: ["GTA"],
            validated_clip_ref_count: 2,
            validated_clip_source_count: 1,
            validated_clip_entities: ["GTA"],
          },
        },
      ],
    },
    motionGapReport: {
      gaps: [
        {
          story_id: "story_exhausted",
          render_recommendation: "do_not_render_yet",
          motion_gap: {
            missing_validated_clip_refs: 1,
            missing_validated_clip_sources: 1,
            acquisition_strategy: {
              status: "alternate_official_sources_required",
              alternate_source_entities: ["GTA"],
              entity_statuses: {
                GTA: {
                  status: "alternate_source_required",
                  attempted_segments: 18,
                  rejected_segments: 18,
                  validated_segments: 0,
                  top_rejection_reason: "segment_contains_title_or_rating_card",
                },
              },
            },
          },
        },
      ],
    },
  });

  const repair = report.rows.find((item) => item.story_id === "story_exhausted");
  assert.equal(repair.primary_action_type, "official_source_intake_needed");
  assert.ok(repair.ranked_actions.some((item) => item.action_type === "exhausted_bad_windows"));
  assert.ok(repair.ranked_actions.some((item) => item.action_type === "official_source_intake_needed"));
  assert.ok(repair.commands.some((item) => item.command.includes("media:intake-official-sources")));
  assert.equal(report.summary.official_source_intake_needed, 1);
  assert.equal(report.summary.exhausted_bad_windows, 1);
});

test("visual repair planner never marks proof candidates render-ready without validated motion", () => {
  const report = buildVisualEvidenceRepairPlan({
    proofCandidateReport: {
      candidates: [
        {
          story_id: "story_false_ready",
          title: "False ready proof",
          verdict: "ready_flash_proof",
          recommended_command: "npm run studio:v2:local -- --story story_false_ready",
          blockers: [],
          audio: { ready: true, status: "approved_local_liam_audio_ready" },
          visuals: {
            exact_subject_count: 5,
            cover_dominated_exact_asset_count: 0,
            wrong_story_exact_asset_count: 0,
            story_target_entities: ["Marathon"],
            validated_clip_ref_count: 0,
            validated_clip_source_count: 0,
            validated_clip_entities: [],
          },
        },
      ],
    },
  });

  const repair = report.rows.find((item) => item.story_id === "story_false_ready");
  assert.equal(repair.render_recommendation, "do_not_render_yet");
  assert.equal(repair.validated_motion_ready, false);
  assert.ok(!repair.commands.some((item) => item.purpose === "run_local_flash_proof"));
  assert.equal(report.summary.render_ready_blocked_without_validated_motion, 1);
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

test("visual repair planner normalises mojibake titles before operator reports", () => {
  const report = buildVisualEvidenceRepairPlan({
    currentStateReport: {
      rows: [
        row({
          story_id: "story_mojibake",
          title: "Pok\u00c3\u00a9mon don\u00e2\u20ac\u2122t need a cover-only deck",
        }),
      ],
    },
  });
  const md = renderVisualEvidenceRepairMarkdown(report);

  assert.equal(report.rows[0].title, "Pok\u00e9mon don\u2019t need a cover-only deck");
  assert.match(md, /Pok\u00e9mon don\u2019t need a cover-only deck/);
  assert.doesNotMatch(md, /\u00c3|\u00e2/);
});

test("visual repair command is registered and read-only", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.scripts["studio:v2:visual-repair"], "node tools/visual-evidence-repair-planner.js");
  assert.equal(pkg.scripts["ops:visual-repair"], "node tools/visual-evidence-repair-planner.js");
  const tool = fs.readFileSync(path.join(ROOT, "tools", "visual-evidence-repair-planner.js"), "utf8");
  assert.match(tool, /visual_evidence_repair_plan\.json/);
  assert.match(tool, /--test-output-only/);
  assert.match(tool, /if \(!args\.testOutputOnly\)/);
  assert.match(tool, /Does not download, render, call TTS, post, mutate DB, touch Railway or trigger OAuth/);
});
