"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildGoal07DirectorBrain,
  validateDirectorPlan,
  writeGoal07DirectorBrain,
} = require("../../lib/goal07-director-brain");

async function makePackage(root, storyId, directorPlan) {
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
    canonical_subject: "Forza Horizon 6",
  });
  await fs.outputJson(path.join(artifactDir, "director_beat_map.json"), directorPlan);
  return {
    story_id: storyId,
    artifact_dir: artifactDir,
    artefacts: ["canonical_story_manifest.json", "director_beat_map.json"],
  };
}

function readyDirectorPlan(storyId = "story-director") {
  return {
    schema_version: 1,
    story_id: storyId,
    execution_mode: "visual_v4_director_brain",
    local_only: true,
    readiness: {
      status: "director_ready",
      blockers: [],
      warnings: [],
    },
    shot_budget: {
      min_actual_motion_clips: 5,
      available_motion_clips: 5,
      min_distinct_motion_families: 4,
      available_distinct_motion_families: 5,
      max_static_card_ratio: 0.35,
      max_static_card_seconds: 24,
      target_motion_ratio: 0.64,
    },
    shot_plan: [
      {
        id: "hook_slam",
        kind: "hook_slam",
        startS: 0,
        durationS: 1.1,
        label: "THE HEADLINE",
        visual_treatment: "instant motion hit, no text stack",
      },
      {
        id: "motion_clip_01",
        kind: "motion_clip",
        startS: 0.35,
        durationS: 3,
        source_family: "steam",
        media_path: "output/video/clip-1.mp4",
      },
      {
        id: "source_lock",
        kind: "source_lock",
        startS: 2.2,
        durationS: 2.6,
        source: "IGN",
        visual_treatment: "large readable source bug",
      },
      {
        id: "proof_card",
        kind: "proof_card",
        startS: 14.2,
        durationS: 5.1,
        label: "SOURCE LOCKED",
      },
      {
        id: "motion_clip_02",
        kind: "motion_clip",
        startS: 27,
        durationS: 3,
        source_family: "xbox",
        media_path: "output/video/clip-2.mp4",
      },
      {
        id: "motion_clip_03",
        kind: "motion_clip",
        startS: 22,
        durationS: 3,
        source_family: "steamdb",
        media_path: "output/video/clip-3.mp4",
      },
      {
        id: "motion_clip_04",
        kind: "motion_clip",
        startS: 30,
        durationS: 3,
        source_family: "publisher",
        media_path: "output/video/clip-4.mp4",
      },
      {
        id: "motion_clip_05",
        kind: "motion_clip",
        startS: 39,
        durationS: 3,
        source_family: "gameplay",
        media_path: "output/video/clip-5.mp4",
      },
    ],
    sound_transition_plan: {
      duration_s: 70,
      readiness: { verdict: "pass", blockers: [], warnings: [] },
    },
    transition_plan: {
      planned: [
        { into: "motion_clip_01", atS: 0.31, family: "speed_ramp" },
        { into: "source_lock", atS: 2.16, family: "source_wipe" },
        { into: "proof_card", atS: 14.16, family: "hard_cut" },
        { into: "motion_clip_02", atS: 26.96, family: "whip_pan" },
      ],
      max_same_transition_run: 1,
    },
    sfx_plan: {
      cue_count: 8,
      cues: [
        { id: "sfx_01", target: "hook_slam", target_kind: "hook_slam", atS: 0, family: "impact" },
        { id: "sfx_02", target: "motion_clip_01", target_kind: "motion_clip", atS: 0.35, family: "whoosh" },
        { id: "sfx_03", target: "source_lock", target_kind: "source_lock", atS: 2.2, family: "source_tick" },
        { id: "sfx_04", target: "proof_card", target_kind: "proof_card", atS: 14.2, family: "transition_hit" },
        { id: "sfx_05", target: "motion_clip_02", target_kind: "motion_clip", atS: 27, family: "whoosh" },
        { id: "sfx_06", target: "motion_clip_03", target_kind: "motion_clip", atS: 22, family: "transition_hit" },
        { id: "sfx_07", target: "motion_clip_04", target_kind: "motion_clip", atS: 30, family: "whoosh" },
        { id: "sfx_08", target: "motion_clip_05", target_kind: "motion_clip", atS: 39, family: "transition_hit" },
      ],
      max_same_family_run: 1,
      mastering: {
        duck_under_narration: true,
        local_only: true,
      },
    },
    visual_obligations: {
      forbid_empty_rectangles: true,
      forbid_text_on_text: true,
      source_locks_must_be_readable: true,
      use_actual_motion_before_static_cards: true,
    },
    caption_policy: {
      subtitles_last: true,
      clean_manual_captions: true,
      avoid_lower_third_collisions: true,
    },
    safety: {
      planner_only: true,
      social_posting_triggered: false,
      oauth_triggered: false,
      production_db_mutated: false,
    },
  };
}

test("Goal 07 director brain enforces the current V5 source-lock range", () => {
  for (const [durationS, expectedStatus] of [
    [1.6, "too_short"],
    [1.9, "pass"],
    [2.6, "pass"],
    [3.1, "pass"],
  ]) {
    const plan = readyDirectorPlan(`story-source-${durationS}`);
    plan.shot_plan.find((shot) => shot.kind === "source_lock").durationS = durationS;

    const validation = validateDirectorPlan(plan);
    const evidence = validation.metrics.card_timing_evidence.find(
      (shot) => shot.kind === "source_lock",
    );
    const sourceTimingBlockers = validation.blockers.filter(
      (blocker) => /(?:card|source_lock)_dwell_too_(?:short|long)$/.test(blocker),
    );

    assert.equal(evidence.status, expectedStatus, `source lock at ${durationS}s`);
    assert.deepEqual(
      sourceTimingBlockers,
      expectedStatus === "too_short"
        ? ["director:card_dwell_too_short", "director:source_lock_dwell_too_short"]
        : [],
      `source lock blockers at ${durationS}s`,
    );
  }
});

test("Goal 07 director brain accepts current narrative proof beats and emits role-aware timing evidence", () => {
  const longProofText =
    "THE FULL PLAYER IMPACT ACROSS RELEASE DATE PRICE PLATFORMS EDITIONS AND UPGRADES";

  for (const durationS of [5.1, 5.8]) {
    const plan = readyDirectorPlan(`story-proof-${durationS}`);
    plan.shot_plan.find((shot) => shot.kind === "source_lock").durationS = 2.6;
    const proof = plan.shot_plan.find((shot) => shot.kind === "proof_card");
    proof.durationS = durationS;
    proof.label = longProofText;

    const validation = validateDirectorPlan(plan);

    assert.equal(validation.blockers.includes("director:card_dwell_too_short"), false);
    assert.equal(validation.blockers.includes("director:card_dwell_too_long"), false);
  }

  const evidencePlan = readyDirectorPlan("story-timing-evidence");
  evidencePlan.shot_plan.find((shot) => shot.kind === "source_lock").durationS = 2.6;
  const evidenceProof = evidencePlan.shot_plan.find((shot) => shot.kind === "proof_card");
  evidenceProof.durationS = 5.1;
  evidenceProof.label = longProofText;
  const validation = validateDirectorPlan(evidencePlan);

  assert.equal(validation.metrics.card_timing_contract_version, "pulse_card_timing_v3");
  assert.deepEqual(validation.metrics.card_timing_evidence, [
    {
      id: "source_lock",
      kind: "source_lock",
      role: "source",
      duration_s: 2.6,
      minimum_visible_duration_s: 1.9,
      target_visible_duration_s: 2.6,
      maximum_visible_duration_s: 3.1,
      contract_version: "pulse_card_timing_v3",
      status: "pass",
    },
    {
      id: "proof_card",
      kind: "proof_card",
      role: "proof",
      duration_s: 5.1,
      minimum_visible_duration_s: 3.4,
      target_visible_duration_s: 5.1,
      maximum_visible_duration_s: 5.8,
      contract_version: "pulse_card_timing_v3",
      status: "pass",
    },
  ]);
});

test("Goal 07 director brain blocks cards above their role-specific timing ceiling", () => {
  for (const cardCase of [
    {
      kind: "source_lock",
      durationS: 3.2,
      expectedBlockers: [
        "director:card_dwell_too_long",
        "director:source_lock_dwell_too_long",
      ],
    },
    {
      kind: "proof_card",
      durationS: 5.9,
      expectedBlockers: ["director:card_dwell_too_long"],
    },
  ]) {
    const plan = readyDirectorPlan(`story-overlong-${cardCase.kind}`);
    plan.shot_plan.find((shot) => shot.kind === "source_lock").durationS = 2.6;
    plan.shot_plan.find((shot) => shot.kind === "proof_card").durationS = 5.1;
    plan.shot_plan.find((shot) => shot.kind === cardCase.kind).durationS = cardCase.durationS;

    const validation = validateDirectorPlan(plan);
    const evidence = validation.metrics.card_timing_evidence.find(
      (shot) => shot.kind === cardCase.kind,
    );

    assert.equal(evidence.status, "too_long");
    for (const blocker of cardCase.expectedBlockers) {
      assert.ok(validation.blockers.includes(blocker), `${cardCase.kind}: ${blocker}`);
    }
    assert.equal(validation.metrics.too_long_readable_card_count, 1);
  }
});

test("Goal 07 director brain passes a timed plan with early visual change, motion and SFX alignment", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal07-ready-"));
  const storyPackage = await makePackage(root, "story-ready", readyDirectorPlan("story-ready"));

  const report = await buildGoal07DirectorBrain({
    storyPackages: [storyPackage],
    workspaceRoot: root,
    outputDir: path.join(root, "goal-07"),
    generatedAt: "2026-05-25T22:10:00.000Z",
  });

  assert.equal(report.verdict, "PASS");
  assert.equal(report.summary.ready_story_count, 1);
  assert.equal(report.stories[0].status, "ready");
  assert.equal(report.timeline_plan.stories[0].timeline.length, 8);
  assert.equal(report.retention_intent_map.stories[0].first_1_5s_visual_change, true);
  assert.equal(report.retention_intent_map.stories[0].first_3s_strength, "strong");
});

test("Goal 07 director brain blocks source and proof cards that are too quick to read", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal07-short-card-dwell-"));
  const shortCards = readyDirectorPlan("story-short-card-dwell");
  for (const shot of shortCards.shot_plan) {
    if (shot.kind === "source_lock") shot.durationS = 1.6;
    if (shot.kind === "proof_card") shot.durationS = 3.3;
  }
  const storyPackage = await makePackage(root, "story-short-card-dwell", shortCards);

  const report = await buildGoal07DirectorBrain({
    storyPackages: [storyPackage],
    workspaceRoot: root,
    outputDir: path.join(root, "goal-07"),
    generatedAt: "2026-06-24T22:05:00.000Z",
  });

  const blockers = report.stories[0].blockers;
  assert.equal(report.verdict, "BLOCKED");
  assert.ok(blockers.includes("director:card_dwell_too_short"));
  assert.ok(blockers.includes("director:source_lock_dwell_too_short"));
  assert.equal(report.stories[0].metrics.too_short_readable_card_count, 2);
});

test("Goal 07 director brain does not count readable source overlays as card-only beats over live motion", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal07-overlay-card-motion-"));
  const overlayPlan = readyDirectorPlan("story-overlay-card-motion");
  overlayPlan.sound_transition_plan.duration_s = 36;
  overlayPlan.shot_budget.max_static_card_ratio = 0.28;
  overlayPlan.shot_budget.max_static_card_seconds = 14;
  overlayPlan.shot_plan = [
    { id: "hook_slam", kind: "hook_slam", startS: 0, durationS: 2.4, label: "THE HEADLINE", visual_treatment: "instant motion hit, no text stack" },
    { id: "motion_clip_01", kind: "motion_clip", startS: 0.35, durationS: 3.6, source_family: "clip_1", media_path: "output/video/clip-1.mp4" },
    { id: "source_lock", kind: "source_lock", startS: 2.75, durationS: 2.6, source: "IGN", visual_treatment: "large readable source bug" },
    { id: "proof_card", kind: "proof_card", startS: 4.45, durationS: 5.8, label: "PROOF", visual_treatment: "large readable source card" },
    { id: "motion_clip_02", kind: "motion_clip", startS: 5.2, durationS: 3.6, source_family: "clip_2", media_path: "output/video/clip-2.mp4" },
    { id: "motion_clip_03", kind: "motion_clip", startS: 10.8, durationS: 3.6, source_family: "clip_3", media_path: "output/video/clip-3.mp4" },
    { id: "motion_clip_04", kind: "motion_clip", startS: 16.6, durationS: 3.6, source_family: "clip_4", media_path: "output/video/clip-4.mp4" },
    { id: "motion_clip_05", kind: "motion_clip", startS: 23.4, durationS: 3.6, source_family: "clip_5", media_path: "output/video/clip-5.mp4" },
  ];
  overlayPlan.sfx_plan.cues = overlayPlan.shot_plan.map((shot, index) => ({
    id: `sfx_${index + 1}`,
    target: shot.id,
    target_kind: shot.kind,
    atS: shot.startS,
    family: index % 2 ? "whoosh" : "transition_hit",
  }));
  overlayPlan.sfx_plan.cue_count = overlayPlan.sfx_plan.cues.length;
  const storyPackage = await makePackage(root, "story-overlay-card-motion", overlayPlan);

  const report = await buildGoal07DirectorBrain({
    storyPackages: [storyPackage],
    workspaceRoot: root,
    outputDir: path.join(root, "goal-07"),
    generatedAt: "2026-06-28T05:30:00.000Z",
  });

  assert.equal(report.verdict, "PASS");
  assert.equal(report.stories[0].metrics.card_seconds, 2.7);
  assert.equal(report.stories[0].metrics.card_ratio, 0.075);
  assert.ok(!report.stories[0].blockers.includes("director:too_many_card_only_beats"));
});

test("Goal 07 director brain blocks repeated timestamp windows from the same base video", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal07-base-source-repeat-"));
  const repeatedBasePlan = readyDirectorPlan("story-base-source-repeat");
  let index = 0;
  for (const shot of repeatedBasePlan.shot_plan) {
    if (shot.kind !== "motion_clip") continue;
    index += 1;
    shot.source_family = `halo_campaign_window_${index}`;
    shot.base_source_family = index <= 3
      ? "url:https://example.com/halo-campaign-trailer-a.mp4"
      : "url:https://example.com/halo-campaign-trailer-b.mp4";
  }
  repeatedBasePlan.shot_budget.min_distinct_motion_source_assets = 4;
  repeatedBasePlan.shot_budget.available_distinct_motion_source_assets = 2;
  const storyPackage = await makePackage(root, "story-base-source-repeat", repeatedBasePlan);

  const report = await buildGoal07DirectorBrain({
    storyPackages: [storyPackage],
    workspaceRoot: root,
    outputDir: path.join(root, "goal-07"),
    generatedAt: "2026-06-24T22:20:00.000Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.ok(report.stories[0].blockers.includes("director:distinct_motion_source_assets_minimum_not_met"));
  assert.equal(report.stories[0].metrics.motion_shot_count, 5);
  assert.equal(report.stories[0].metrics.distinct_motion_family_count, 5);
  assert.equal(report.stories[0].metrics.distinct_motion_source_asset_count, 2);
});

test("Goal 07 director brain blocks repeated exact motion clip assets even when labels look diverse", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal07-repeated-clip-asset-"));
  const repeatedClipPlan = readyDirectorPlan("story-repeated-clip-asset");
  let index = 0;
  for (const shot of repeatedClipPlan.shot_plan) {
    if (shot.kind !== "motion_clip") continue;
    index += 1;
    shot.source_family = `unique_family_${index}`;
    shot.media_path = index <= 3
      ? "output/video/reused-hook-loop.mp4"
      : `output/video/unique-clip-${index}.mp4`;
    shot.media_start_s = 0;
    shot.media_end_s = 3;
  }
  const storyPackage = await makePackage(root, "story-repeated-clip-asset", repeatedClipPlan);

  const report = await buildGoal07DirectorBrain({
    storyPackages: [storyPackage],
    workspaceRoot: root,
    outputDir: path.join(root, "goal-07"),
    generatedAt: "2026-06-28T05:15:00.000Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.ok(report.stories[0].blockers.includes("director:repeated_motion_clip_asset"));
  assert.equal(report.stories[0].metrics.repeated_motion_clip_asset_count, 1);
  assert.equal(report.stories[0].metrics.repeated_motion_clip_instance_count, 3);
});

test("Goal 07 director brain blocks upstream director holds without pretending the plan is ready", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal07-upstream-"));
  const blocked = readyDirectorPlan("story-blocked");
  blocked.readiness = {
    status: "director_blocked",
    blockers: ["actual_motion_clip_minimum_not_met", "distinct_motion_families_minimum_not_met"],
  };
  const storyPackage = await makePackage(root, "story-blocked", blocked);

  const report = await buildGoal07DirectorBrain({
    storyPackages: [storyPackage],
    workspaceRoot: root,
    outputDir: path.join(root, "goal-07"),
    generatedAt: "2026-05-25T22:11:00.000Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.ok(report.stories[0].blockers.includes("director:actual_motion_clip_minimum_not_met"));
  assert.ok(report.stories[0].blockers.includes("director:distinct_motion_families_minimum_not_met"));
});

test("Goal 07 director brain clears stale official-product motion holds when the current shot plan proves the minimums", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal07-stale-motion-"));
  const repaired = readyDirectorPlan("story-stale-motion");
  repaired.readiness = {
    status: "director_blocked",
    blockers: [
      "official_product_motion_clip_minimum_not_met",
      "official_product_motion_family_minimum_not_met",
    ],
    warnings: ["product_story_limited_motion_budget_requires_premium_owned_motion"],
  };
  const storyPackage = await makePackage(root, "story-stale-motion", repaired);

  const report = await buildGoal07DirectorBrain({
    storyPackages: [storyPackage],
    workspaceRoot: root,
    outputDir: path.join(root, "goal-07"),
    generatedAt: "2026-05-25T22:11:30.000Z",
  });

  assert.equal(report.verdict, "PASS");
  assert.equal(report.stories[0].status, "ready");
  assert.equal(report.stories[0].metrics.motion_shot_count, 5);
  assert.equal(report.stories[0].metrics.distinct_motion_family_count, 5);
  assert.ok(!report.stories[0].blockers.includes("director:official_product_motion_clip_minimum_not_met"));
  assert.ok(!report.stories[0].blockers.includes("director:official_product_motion_family_minimum_not_met"));
});

test("Goal 07 director brain clears stale actual-motion holds when current benchmarked direct-video evidence proves the shortened render", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal07-shortened-direct-motion-"));
  const repaired = readyDirectorPlan("story-shortened-direct-motion");
  const extraMotion = Array.from({ length: 6 }, (_, index) => ({
    id: `motion_clip_extra_${index + 1}`,
    kind: "motion_clip",
    startS: 31 + index * 2,
    durationS: 1.8,
    source_family: `direct_video_family_${(index % 6) + 1}`,
    media_path: `output/video/direct-${index + 1}.mp4`,
  }));
  repaired.shot_plan = repaired.shot_plan.concat(extraMotion);
  repaired.sfx_plan.cues = repaired.sfx_plan.cues.concat(
    extraMotion.map((shot, index) => ({
      id: `sfx_extra_${index + 1}`,
      target: shot.id,
      target_kind: "motion_clip",
      atS: shot.startS,
      family: index % 2 ? "transition_hit" : "whoosh",
    })),
  );
  repaired.sfx_plan.cue_count = repaired.sfx_plan.cues.length;
  repaired.shot_budget = {
    ...repaired.shot_budget,
    min_actual_motion_clips: 13,
    available_motion_clips: 11,
    min_distinct_motion_families: 6,
    available_distinct_motion_families: 6,
  };
  repaired.readiness = {
    status: "director_blocked",
    blockers: ["actual_motion_clip_minimum_not_met"],
    warnings: [],
  };
  repaired.media_house_benchmark = {
    result: "pass",
    failures: [],
    scores: {
      motion_density_score: 100,
      media_house_polish_score: 95,
    },
    thresholds: {
      motion_density_score: 75,
      media_house_polish_score: 75,
    },
    visual_evidence_profile: {
      direct_video_motion_asset_count: 11,
      direct_video_motion_family_count: 6,
      generated_only_motion_deck: false,
      blockers: [],
    },
  };
  const storyPackage = await makePackage(root, "story-shortened-direct-motion", repaired);

  const report = await buildGoal07DirectorBrain({
    storyPackages: [storyPackage],
    workspaceRoot: root,
    outputDir: path.join(root, "goal-07"),
    generatedAt: "2026-05-25T22:11:45.000Z",
  });

  assert.equal(report.verdict, "PASS");
  assert.equal(report.stories[0].status, "ready");
  assert.equal(report.stories[0].metrics.motion_shot_count, 11);
  assert.equal(report.stories[0].metrics.distinct_motion_family_count, 11);
  assert.ok(!report.stories[0].blockers.includes("director:actual_motion_clip_minimum_not_met"));
});

test("Goal 07 director brain accepts official product-page hybrid motion when direct proof and real media families cover the final plan", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal07-product-hybrid-motion-"));
  const repaired = readyDirectorPlan("story-product-hybrid-motion");
  const extraMotion = Array.from({ length: 3 }, (_, index) => ({
    id: `official_still_motion_${index + 1}`,
    kind: "motion_clip",
    startS: 31 + index * 2,
    durationS: 1.8,
    source_family: `official_still_family_${index + 1}`,
    media_path: `output/video/official-still-${index + 1}.mp4`,
  }));
  repaired.shot_plan = repaired.shot_plan.concat(extraMotion);
  repaired.sfx_plan.cues = repaired.sfx_plan.cues.concat(
    extraMotion.map((shot, index) => ({
      id: `sfx_official_still_${index + 1}`,
      target: shot.id,
      target_kind: "motion_clip",
      atS: shot.startS,
      family: index % 2 ? "transition_hit" : "whoosh",
    })),
  );
  repaired.sfx_plan.cue_count = repaired.sfx_plan.cues.length;
  repaired.shot_budget = {
    ...repaired.shot_budget,
    min_actual_motion_clips: 13,
    available_motion_clips: 8,
    min_distinct_motion_families: 6,
    available_distinct_motion_families: 8,
  };
  repaired.readiness = {
    status: "director_blocked",
    blockers: ["actual_motion_clip_minimum_not_met"],
    warnings: ["product_page_hybrid_motion_uses_official_stills_after_direct_video_floor"],
  };
  repaired.media_house_benchmark = {
    result: "pass",
    failures: [],
    scores: {
      motion_density_score: 100,
      media_house_polish_score: 92,
    },
    thresholds: {
      motion_density_score: 75,
      media_house_polish_score: 75,
    },
    visual_evidence_profile: {
      direct_video_motion_asset_count: 2,
      direct_video_motion_family_count: 2,
      real_motion_asset_count: 20,
      real_media_family_count: 14,
      generated_only_motion_deck: false,
      blockers: [],
    },
  };
  const storyPackage = await makePackage(root, "story-product-hybrid-motion", repaired);

  const report = await buildGoal07DirectorBrain({
    storyPackages: [storyPackage],
    workspaceRoot: root,
    outputDir: path.join(root, "goal-07"),
    generatedAt: "2026-05-25T22:11:50.000Z",
  });

  assert.equal(report.verdict, "PASS");
  assert.equal(report.stories[0].status, "ready");
  assert.equal(report.stories[0].metrics.motion_shot_count, 8);
  assert.equal(report.stories[0].metrics.distinct_motion_family_count, 8);
  assert.ok(!report.stories[0].blockers.includes("director:actual_motion_clip_minimum_not_met"));
});

test("Goal 07 director brain blocks weak first seconds, card-heavy edits and missing SFX coverage", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal07-weak-"));
  const weak = readyDirectorPlan("story-weak");
  weak.shot_plan = [
    { id: "hook_slam", kind: "hook_slam", startS: 0, durationS: 2.8 },
    { id: "source_lock", kind: "source_lock", startS: 3.2, durationS: 3, source: "SOURCE", visual_treatment: "tiny bug" },
    { id: "proof_1", kind: "proof_card", startS: 6.5, durationS: 5 },
    { id: "proof_2", kind: "proof_card", startS: 12, durationS: 5 },
  ];
  weak.sound_transition_plan.duration_s = 30;
  weak.sfx_plan = { cues: [{ target: "hook_slam", atS: 0, family: "impact" }], cue_count: 1 };
  const storyPackage = await makePackage(root, "story-weak", weak);

  const report = await buildGoal07DirectorBrain({
    storyPackages: [storyPackage],
    workspaceRoot: root,
    outputDir: path.join(root, "goal-07"),
    generatedAt: "2026-05-25T22:12:00.000Z",
  });

  const blockers = report.stories[0].blockers;
  assert.equal(report.verdict, "BLOCKED");
  assert.ok(blockers.includes("director:no_visual_change_first_1_5s"));
  assert.ok(blockers.includes("director:weak_first_3s"));
  assert.ok(blockers.includes("director:too_many_card_only_beats"));
  assert.ok(blockers.includes("director:source_lock_not_readable"));
  assert.ok(blockers.includes("director:sfx_alignment_missing"));
});

test("Goal 07 director brain writes readiness, beat map, timeline and retention artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal07-write-"));
  const storyPackage = await makePackage(root, "story-write", readyDirectorPlan("story-write"));
  const report = await buildGoal07DirectorBrain({
    storyPackages: [storyPackage],
    workspaceRoot: root,
    outputDir: path.join(root, "goal-07"),
    generatedAt: "2026-05-25T22:13:00.000Z",
  });

  const written = await writeGoal07DirectorBrain(report, {
    outputDir: path.join(root, "goal-07"),
  });

  assert.equal(await fs.pathExists(written.readinessJson), true);
  assert.equal(await fs.pathExists(written.readinessMarkdown), true);
  assert.equal(await fs.pathExists(written.directorBeatMap), true);
  assert.equal(await fs.pathExists(written.timelinePlan), true);
  assert.equal(await fs.pathExists(written.retentionIntentMap), true);
  const markdown = await fs.readFile(written.readinessMarkdown, "utf8");
  assert.match(markdown, /Goal 07 Director Brain/);
  assert.match(markdown, /story-write: ready/);
});
