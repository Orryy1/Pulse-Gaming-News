"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildGoalContractReport,
  renderGoalContractMarkdown,
  writeGoalContractArtifacts,
} = require("../../lib/goal-contract");

function completeStoryPackage(id) {
  return {
    story_id: id,
    artefacts: [
      "canonical_story_manifest.json",
      "script_scorecard.json",
      "footage_inventory.json",
      "rights_ledger.json",
      "director_beat_map.json",
      "render_manifest.json",
      "visual_v4_render.mp4",
      "audio_manifest.json",
      "sfx_manifest.json",
      "captions.srt",
      "platform_publish_manifest.json",
      "x_publish_pack.json",
      "instagram_publish_pack.json",
      "affiliate_link_manifest.json",
      "landing_page_manifest.json",
      "platform_policy_report.json",
      "benchmark_report.json",
      "coherence_report.json",
      "publish_verdict.json",
      "analytics_ingest_plan.json",
    ],
    verdict: "GREEN",
  };
}

test("goal contract report turns the /goal into a no-fake-readiness acceptance matrix", () => {
  const report = buildGoalContractReport({
    generatedAt: "2026-05-21T19:00:00.000Z",
    moduleIndex: {
      "lib/public-output-manifest.js": true,
      "lib/studio-governance-engine.js": true,
      "lib/studio/v4/director-brain.js": true,
      "lib/studio/v4/footage-empire.js": true,
      "lib/studio/v4/sound-transition-planner.js": true,
      "lib/studio-enterprise-os.js": true,
      "lib/revenue-path-engine.js": true,
      "lib/intelligence/retention-intelligence.js": true,
    },
    artefactIndex: {
      "canonical_story_manifest.json": true,
      "rights_ledger.json": true,
      "publish_verdict.json": true,
      "platform_policy_report.json": true,
      "coherence_report.json": true,
    },
    testIndex: {
      generic_title_rejection: true,
      this_gaming_story_rejection: true,
      internal_qa_language_rejection: true,
      missing_rights_record_rejection: true,
      finance_crypto_unsafe_wording_rejection: true,
      green_amber_red_control_tower_verdicts: true,
    },
    storyPackages: Array.from({ length: 3 }, (_, index) =>
      completeStoryPackage(`story-${index + 1}`),
    ),
  });

  assert.equal(report.goal_id, "pulse_gaming_enterprise_media_os");
  assert.equal(report.status, "IN_PROGRESS");
  assert.equal(report.no_fake_readiness, true);
  assert.equal(report.required_systems.length, 26);
  assert.ok(report.system_summary.implemented > 0);
  assert.ok(report.system_summary.missing > 0);
  assert.equal(report.acceptance_30_story_gate.required_story_count, 30);
  assert.equal(report.acceptance_30_story_gate.complete_story_count, 3);
  assert.equal(report.acceptance_30_story_gate.status, "blocked");
  assert.ok(report.next_actions[0].reason_code);
  assert.equal(report.safety.no_publish_triggered, true);
  assert.equal(report.safety.no_db_mutation, true);
});

test("goal contract report recognises a complete 30-story package set", () => {
  const moduleIndex = Object.fromEntries(
    [
      "lib/public-output-manifest.js",
      "lib/studio-governance-engine.js",
      "lib/editorial-angle-engine.js",
      "lib/viral-script-intelligence.js",
      "lib/studio/v4/footage-empire.js",
      "lib/studio/v4/director-brain.js",
      "lib/studio/v4/proof-render.js",
      "lib/studio/v4/sound-transition-planner.js",
      "lib/media-house-benchmark.js",
      "lib/intelligence/retention-intelligence.js",
      "lib/intelligence/continuous-learning-loop.js",
      "lib/studio-enterprise-os.js",
      "lib/commercial-intelligence-engine.js",
      "lib/revenue-path-engine.js",
      "lib/intelligence/monetisation-readiness.js",
    ].map((file) => [file, true]),
  );

  const report = buildGoalContractReport({
    moduleIndex,
    artefactIndex: Object.fromEntries(
      [
        "canonical_story_manifest.json",
        "story_scorecard.json",
        "source_manifest.json",
        "claim_inventory.json",
        "script_scorecard.json",
        "footage_inventory.json",
        "rights_ledger.json",
        "director_beat_map.json",
        "render_manifest.json",
        "audio_manifest.json",
        "sfx_manifest.json",
        "visual_quality_report.json",
        "forensic_qa_report.json",
        "benchmark_report.json",
        "coherence_report.json",
        "platform_policy_report.json",
        "affiliate_link_manifest.json",
        "landing_page_manifest.json",
        "publish_verdict.json",
        "analytics_ingest_plan.json",
        "audit_log.json",
        "youtube_publish_pack.json",
        "tiktok_publish_pack.json",
        "instagram_publish_pack.json",
        "facebook_publish_pack.json",
        "x_publish_pack.json",
        "threads_publish_pack.json",
        "pinterest_publish_pack.json",
        "carousel_manifest.json",
        "image_card_manifest.json",
        "thread_manifest.json",
        "observability_report.json",
        "security_report.json",
        "secrets_scan_report.json",
        "deployment_safety_report.json",
        "correction_queue.json",
        "affected_content_report.json",
        "correction_plan.json",
        "takedown_response_log.json",
        "sponsor_media_kit.json",
        "sponsor_pitch_pack.md",
        "brand_safety_report.json",
        "brand_system_manifest.json",
        "visual_style_guide.md",
        "editorial_style_guide.md",
        "recurring_format_registry.json",
        "prompt_model_registry.json",
        "video_lineage_manifest.json",
      ].map((file) => [file, true]),
    ),
    testIndex: {
      generic_title_rejection: true,
      this_gaming_story_rejection: true,
      internal_qa_language_rejection: true,
      source_mismatch_rejection: true,
      thumbnail_title_script_mismatch_rejection: true,
      missing_canonical_subject_rejection: true,
      missing_rights_record_rejection: true,
      affiliate_disclosure_rejection: true,
      finance_crypto_unsafe_wording_rejection: true,
      weak_first_frame_rejection: true,
      unreadable_mobile_text_rejection: true,
      excessive_caveat_ratio_rejection: true,
      repeated_visual_pattern_rejection: true,
      repeated_cta_rejection: true,
      platform_mirroring_detection: true,
      green_amber_red_control_tower_verdicts: true,
      platform_native_publish_pack_generation: true,
      x_thread_generation: true,
      instagram_carousel_generation: true,
      landing_page_generation: true,
      analytics_rule_update_generation: true,
      correction_workflow: true,
      secrets_scan: true,
      dry_run_publishing_mode: true,
    },
    storyPackages: Array.from({ length: 30 }, (_, index) =>
      completeStoryPackage(`story-${index + 1}`),
    ),
  });

  assert.equal(report.status, "GOAL_ACCEPTANCE_READY");
  assert.equal(report.acceptance_30_story_gate.status, "pass");
  assert.equal(report.required_tests_summary.missing, 0);
  assert.equal(report.required_artefacts_summary.missing, 0);
});

test("goal contract reports proof-ready packages as publish-blocked when renders are local proof only", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-cutover-"));
  const storyPackages = [];
  for (let index = 0; index < 30; index += 1) {
    const entry = completeStoryPackage(`story-${index + 1}`);
    const storyDir = path.join(tmp, entry.story_id);
    await fs.ensureDir(storyDir);
    for (const basename of entry.artefacts) {
      if (basename === "render_manifest.json") {
        await fs.outputJson(path.join(storyDir, basename), {
          final_publish_render: false,
          renderer: "visual_v4_local_proof",
        });
      } else {
        await fs.outputFile(path.join(storyDir, basename), basename.endsWith(".json") ? "{}" : "video");
      }
    }
    entry.artifact_dir = storyDir;
    storyPackages.push(entry);
  }

  const report = buildGoalContractReport({
    moduleIndex: Object.fromEntries([
      "lib/public-output-manifest.js",
      "lib/studio-governance-engine.js",
      "lib/editorial-angle-engine.js",
      "lib/viral-script-intelligence.js",
      "lib/studio/v4/footage-empire.js",
      "lib/studio/v4/director-brain.js",
      "lib/studio/v4/proof-render.js",
      "lib/studio/v4/sound-transition-planner.js",
      "lib/media-house-benchmark.js",
      "lib/intelligence/retention-intelligence.js",
      "lib/intelligence/continuous-learning-loop.js",
      "lib/studio-enterprise-os.js",
      "lib/commercial-intelligence-engine.js",
      "lib/revenue-path-engine.js",
      "lib/intelligence/monetisation-readiness.js",
    ].map((file) => [file, true])),
    artefactIndex: Object.fromEntries([
      "canonical_story_manifest.json",
      "story_scorecard.json",
      "source_manifest.json",
      "claim_inventory.json",
      "script_scorecard.json",
      "footage_inventory.json",
      "rights_ledger.json",
      "director_beat_map.json",
      "render_manifest.json",
      "audio_manifest.json",
      "sfx_manifest.json",
      "visual_quality_report.json",
      "forensic_qa_report.json",
      "benchmark_report.json",
      "coherence_report.json",
      "platform_policy_report.json",
      "affiliate_link_manifest.json",
      "landing_page_manifest.json",
      "publish_verdict.json",
      "analytics_ingest_plan.json",
      "audit_log.json",
      "youtube_publish_pack.json",
      "tiktok_publish_pack.json",
      "instagram_publish_pack.json",
      "facebook_publish_pack.json",
      "x_publish_pack.json",
      "threads_publish_pack.json",
      "pinterest_publish_pack.json",
      "carousel_manifest.json",
      "image_card_manifest.json",
      "thread_manifest.json",
      "observability_report.json",
      "security_report.json",
      "secrets_scan_report.json",
      "deployment_safety_report.json",
      "correction_queue.json",
      "affected_content_report.json",
      "correction_plan.json",
      "takedown_response_log.json",
      "sponsor_media_kit.json",
      "sponsor_pitch_pack.md",
      "brand_safety_report.json",
      "brand_system_manifest.json",
      "visual_style_guide.md",
      "editorial_style_guide.md",
      "recurring_format_registry.json",
      "prompt_model_registry.json",
      "video_lineage_manifest.json",
    ].map((file) => [file, true])),
    testIndex: Object.fromEntries([
      "generic_title_rejection",
      "this_gaming_story_rejection",
      "internal_qa_language_rejection",
      "source_mismatch_rejection",
      "thumbnail_title_script_mismatch_rejection",
      "missing_canonical_subject_rejection",
      "missing_rights_record_rejection",
      "affiliate_disclosure_rejection",
      "finance_crypto_unsafe_wording_rejection",
      "weak_first_frame_rejection",
      "unreadable_mobile_text_rejection",
      "excessive_caveat_ratio_rejection",
      "repeated_visual_pattern_rejection",
      "repeated_cta_rejection",
      "platform_mirroring_detection",
      "green_amber_red_control_tower_verdicts",
      "platform_native_publish_pack_generation",
      "x_thread_generation",
      "instagram_carousel_generation",
      "landing_page_generation",
      "analytics_rule_update_generation",
      "correction_workflow",
      "secrets_scan",
      "dry_run_publishing_mode",
    ].map((id) => [id, true])),
    storyPackages,
  });

  assert.equal(report.acceptance_30_story_gate.status, "pass");
  assert.equal(report.publish_cutover_gate.status, "blocked");
  assert.equal(report.publish_cutover_gate.final_publish_render_count, 0);
  assert.equal(report.status, "GOAL_PROOF_READY");
  assert.ok(report.next_actions.some((action) => action.reason_code === "production_render_cutover_not_met"));
});

test("goal contract blocks GREEN story packages when claimed artefacts are not materialised", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-materialised-"));
  const storyDir = path.join(tmp, "story-one");
  await fs.ensureDir(storyDir);
  const packageEntry = completeStoryPackage("story-one");
  packageEntry.artifact_dir = storyDir;
  for (const basename of packageEntry.artefacts.filter((name) => name !== "captions.srt")) {
    await fs.outputFile(path.join(storyDir, basename), basename.endsWith(".json") ? "{}" : "video");
  }

  const report = buildGoalContractReport({
    storyPackages: [
      packageEntry,
      ...Array.from({ length: 29 }, (_, index) => completeStoryPackage(`story-${index + 2}`)),
    ],
  });

  assert.equal(report.acceptance_30_story_gate.status, "blocked");
  assert.equal(report.acceptance_30_story_gate.complete_story_count, 29);
  assert.deepEqual(
    report.acceptance_30_story_gate.incomplete_stories[0].missing_materialised_artefacts,
    ["captions.srt"],
  );
});

test("goal contract artefacts are written as JSON and readable Markdown", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-contract-"));
  const report = buildGoalContractReport({
    generatedAt: "2026-05-21T19:10:00.000Z",
    storyPackages: [completeStoryPackage("one")],
  });

  const artefacts = await writeGoalContractArtifacts(report, { outputDir: tmp });
  const markdown = renderGoalContractMarkdown(report);

  assert.equal(await fs.pathExists(artefacts.jsonPath), true);
  assert.equal(await fs.pathExists(artefacts.markdownPath), true);
  assert.match(markdown, /Pulse Gaming Goal Contract/);
  assert.match(markdown, /Status: IN_PROGRESS/);
  assert.match(markdown, /30-story gate: blocked/);
  assert.doesNotMatch(markdown, /done/i);
});
