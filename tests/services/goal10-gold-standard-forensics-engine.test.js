"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  GOAL10_BENCHMARK_PACKS,
  buildGoal10GoldStandardForensicsEngine,
  writeGoal10GoldStandardForensicsEngine,
} = require("../../lib/goal10-gold-standard-forensics-engine");

function completeReferenceLibrary(overrides = {}) {
  return {
    workbook_path: overrides.workbook_path || "fixture/gold_standards_reference_library.xlsx",
    summary: {
      total_references: overrides.total_references ?? 50,
      tier_a_references: 26,
      tier_b_references: 24,
      core_legal_rule:
        overrides.core_legal_rule ||
        "Treat every entry as reference-only unless a specific asset has verified reuse rights, licence terms or written permission.",
    },
    references: Array.from({ length: overrides.referenceCount ?? 50 }, (_, index) => ({
      id: `GS-${String(index + 1).padStart(2, "0")}`,
      tier: index < 26 ? "A" : "B",
      cluster: index < 8 ? "Gaming news / editorial" : "Social-first news",
      source_channel: index === 0 ? "IGN" : `Reference ${index + 1}`,
      platform: index % 2 ? "YouTube Shorts" : "Instagram Reels",
      best_used_for: "Reference grammar only",
      what_to_study: "Study hook speed, source locks and mobile pacing.",
      codex_features_to_extract:
        "Hook speed; title structure; first-frame structure; transition rhythm; SFX timing; CTA placement",
      rights_usage_note:
        overrides.rights_usage_note ||
        "Reference only. Do not copy footage, music, graphics or templates without permission/licence.",
      source_url: `https://example.test/reference-${index + 1}`,
    })),
    codex_rules: Array.from({ length: overrides.ruleCount ?? 12 }, (_, index) => ({
      rule_id: `R-${String(index + 1).padStart(2, "0")}`,
      gate_rule: "Use benchmark grammar only and keep source evidence readable.",
      why_it_matters: "The render needs a measurable benchmark basis.",
      suggested_implementation: "Record the benchmark pack and extracted pattern data.",
    })),
    reference_packs: (overrides.packs || GOAL10_BENCHMARK_PACKS).map((pack) => ({
      pack,
      primary_references: "IGN, Reuters, NowThis",
      use_this_when: "Fixture benchmark coverage",
      main_extraction_targets:
        "title structure, hook type, first-frame structure, pacing, motion density, overlays, captions, source cards, SFX timing, CTA placement, commercial integration and platform behaviour",
    })),
  };
}

async function makeBenchmarkStory(root, storyId, overrides = {}) {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: overrides.title || "The Expanse Shows Real Gameplay",
    canonical_subject: "The Expanse: Osiris Reborn",
    canonical_angle: "Confirmed Drop",
    first_spoken_line: "The Expanse: Osiris Reborn finally showed real gameplay.",
    narration_script:
      "The Expanse: Osiris Reborn finally showed real gameplay. Xbox showed the footage. Follow Pulse Gaming for the gaming stories behind the headline.",
    primary_source: "Xbox",
  });
  await fs.outputJson(path.join(artifactDir, "visual_quality_report.json"), {
    benchmark_library: {
      reference_count: 50,
      rule_count: 12,
      legal_rule:
        "Treat every entry as reference-only unless a specific asset has verified reuse rights, licence terms or written permission.",
    },
    reference_pack_used: overrides.referencePackUsed || [
      "Gaming News Core",
      "Official Publisher Motion",
      "Pacing / Retention / Impact",
    ],
    scores: {
      motion_density_score: overrides.motionDensityScore ?? 92,
      first_3_seconds_hook_score: overrides.firstThreeScore ?? 88,
      source_lock_quality_score: 90,
      caption_legibility_score: 91,
      card_hierarchy_score: 86,
      transition_energy_score: 84,
      sfx_impact_score: 83,
      rights_risk_score: overrides.rightsRiskScore ?? 96,
      stale_wording_risk: overrides.staleWordingRisk ?? 0,
      media_house_polish_score: 89,
    },
    thresholds: {
      motion_density_score: 75,
      first_3_seconds_hook_score: 75,
      source_lock_quality_score: 65,
      caption_legibility_score: 70,
      card_hierarchy_score: 65,
      transition_energy_score: 65,
      sfx_impact_score: 65,
      rights_risk_score: 70,
      stale_wording_risk: 30,
      media_house_polish_score: 75,
    },
    result: overrides.visualResult || "pass",
    failures: overrides.visualFailures || [],
  });
  await fs.outputJson(path.join(artifactDir, "director_beat_map.json"), {
    shot_plan: [
      { id: "hook_slam", kind: "hook_slam", startS: 0, durationS: 2.4, visual_treatment: "instant motion hit" },
      { id: "motion_clip_01", kind: "motion_clip", startS: 0.3, durationS: 3.6, visual_treatment: "hook speed-ramp motion" },
      { id: "source_lock", kind: "source_lock", startS: 2.7, durationS: 2.1, visual_treatment: "large readable source bug" },
      { id: "proof_card", kind: "proof_card", startS: 4.5, durationS: 2.2, visual_treatment: "single dominant claim card" },
    ],
    transition_plan: {
      planned: [
        { id: "tr1", family: "speed_ramp", atS: 0.28, durationS: 0.12 },
        { id: "tr2", family: "source_wipe", atS: 2.68, durationS: 0.08 },
      ],
      max_same_family_run: 1,
    },
    sound_transition_plan: {
      duration_s: 38.4,
      sfx: {
        cue_count: 4,
        cues: [
          { id: "sfx1", family: "impact", atS: 0 },
          { id: "sfx2", family: "whoosh", atS: 0.3 },
          { id: "sfx3", family: "source_tick", atS: 2.7 },
          { id: "sfx4", family: "transition_hit", atS: 4.5 },
        ],
        mastering: { music_energy: "medium", duck_under_narration: true },
      },
    },
    caption_policy: {
      clean_manual_captions: true,
      avoid_lower_third_collisions: true,
    },
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: storyId,
    final_publish_render: true,
    rendered_duration_s: 38.4,
    clips: 8,
    input_fingerprint: {
      canonical_snapshot: {
        selected_title: overrides.title || "The Expanse Shows Real Gameplay",
        narration_script:
          "The Expanse: Osiris Reborn finally showed real gameplay. Follow Pulse Gaming for the gaming stories behind the headline.",
        first_spoken_line: "The Expanse: Osiris Reborn finally showed real gameplay.",
      },
    },
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    operating_mode: "DRY_RUN_PUBLISH",
    outputs: {
      youtube_shorts: { cta_style: "identity_follow", native_role: "searchable_short" },
      instagram_reels: {
        cta_style: "bio_link",
        native_role: "cover_first_reel_plus_carousel",
        carousel_companion: { required: true, cards: ["cover", "source", "player impact"] },
      },
      x: {
        cta_style: "source_first_link",
        native_role: "headline_source_post",
        thread_posts: ["headline", "source"],
        hot_take_post: "This official gameplay cut changes the conversation.",
      },
    },
    platform_native_evidence: { verdict: "pass", failures: [] },
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  });
  await fs.outputJson(path.join(artifactDir, "affiliate_link_manifest.json"), {
    disclosure_required: true,
    landing_page_route: "/p/xbox-story",
    landing_page_attribution: {
      verdict: "pass",
      link_tracking: [{ platform: "youtube", landing_page_url: "/p/xbox-story?utm_source=youtube" }],
    },
  });
  return { story_id: storyId, title: overrides.title || "The Expanse Shows Real Gameplay", artifact_dir: artifactDir };
}

test("Goal 10 records benchmark pattern evidence but blocks full readiness when Goal 09 is blocked", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal10-upstream-"));
  const story = await makeBenchmarkStory(root, "story-upstream");

  const report = await buildGoal10GoldStandardForensicsEngine({
    storyPackages: [story],
    referenceLibrary: completeReferenceLibrary(),
    upstreamSoundReport: {
      stories: [{ story_id: "story-upstream", status: "blocked", blockers: ["upstream:goal08_visual_v4_renderer_blocked"] }],
    },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-25T23:35:45.269Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.summary.direct_benchmark_pass_story_count, 1);
  assert.equal(report.summary.benchmark_ready_story_count, 0);
  assert.equal(report.summary.required_pattern_count, 15);
  assert.equal(report.reference_pack_scorecard.missing_required_pack_count, 0);
  assert.deepEqual(report.stories[0].upstream_blockers, [
    "upstream:goal09_sound_design_engine_blocked",
    "upstream:goal08_visual_v4_renderer_blocked",
  ]);
  assert.equal(report.stories[0].direct_benchmark_status, "pass");
  assert.equal(report.stories[0].pattern_data.title_structure.status, "present");
  assert.equal(report.stories[0].pattern_data.platform_behaviour.status, "present");
  assert.equal(report.benchmark_comparison_report.stories[0].non_infringing_use, true);
});

test("Goal 10 blocks missing benchmark packs instead of inventing reference coverage", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal10-packs-"));
  const story = await makeBenchmarkStory(root, "story-pack-gap");
  const sixPackLibrary = completeReferenceLibrary({
    packs: [
      "Gaming News Core",
      "Official Publisher Motion",
      "Social-First News",
      "Explainer / Data Graphics",
      "Pacing / Retention / Impact",
      "Premium Visual Texture",
    ],
  });

  const report = await buildGoal10GoldStandardForensicsEngine({
    storyPackages: [story],
    referenceLibrary: sixPackLibrary,
    upstreamSoundReport: {
      stories: [{ story_id: "story-pack-gap", status: "ready", blockers: [] }],
    },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-25T23:35:45.269Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.reference_pack_scorecard.present_required_pack_count, 6);
  assert.equal(report.reference_pack_scorecard.missing_required_pack_count, 3);
  assert.match(Object.keys(report.blocker_counts).join("\n"), /benchmark_pack:commercial_and_affiliate_mechanics_missing/);
  assert.match(Object.keys(report.blocker_counts).join("\n"), /benchmark_pack:x_hot_take_and_thread_mechanics_missing/);
  assert.match(Object.keys(report.blocker_counts).join("\n"), /benchmark_pack:instagram_carousel_mechanics_missing/);
  assert.equal(report.benchmark_rejection_reasons.rejections.length, 3);
});

test("Goal 10 writes the required forensic benchmark artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal10-write-"));
  const story = await makeBenchmarkStory(root, "story-ready");
  const outputDir = path.join(root, "out");
  const report = await buildGoal10GoldStandardForensicsEngine({
    storyPackages: [story],
    referenceLibrary: completeReferenceLibrary(),
    upstreamSoundReport: { stories: [{ story_id: "story-ready", status: "ready", blockers: [] }] },
    workspaceRoot: root,
    outputDir,
    generatedAt: "2026-05-25T23:35:45.269Z",
  });

  const written = await writeGoal10GoldStandardForensicsEngine(report, { outputDir });

  assert.equal(await fs.pathExists(written.readinessJson), true);
  assert.equal(await fs.pathExists(written.readinessMarkdown), true);
  assert.equal(await fs.pathExists(written.referencePackScorecard), true);
  assert.equal(await fs.pathExists(written.benchmarkComparisonReport), true);
  assert.equal(await fs.pathExists(written.pulseRenderBenchmarkReport), true);
  assert.equal(await fs.pathExists(written.benchmarkRejectionReasons), true);
  const comparison = await fs.readJson(written.benchmarkComparisonReport);
  assert.equal(comparison.stories[0].pattern_coverage.present_count, 15);
});
