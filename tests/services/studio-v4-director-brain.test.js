"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildFootageEmpirePlan } = require("../../lib/studio/v4/footage-empire");
const {
  buildVisualV4DirectorPlan,
} = require("../../lib/studio/v4/director-brain");

function story() {
  return {
    id: "forza-v4-director",
    title: "Forza Horizon 6 Hits 92 on Metacritic, Steam Numbers Skyrocket",
    source_name: "Twisted Voxel",
    full_script:
      "Forza just gave Xbox the headline it badly needed. Twisted Voxel says Forza Horizon 6 now sits on a 92 Metacritic aggregate, ahead of Pokemon Pokopia at 89, with SteamDB showing 178,009 concurrent users. But the sharper detail is money: that Steam peak came during Premium Edition early access, around $120 before the standard launch. That means it is not full demand yet. It is a paid-access stress test. Follow Pulse Gaming so you never miss a beat.",
  };
}

function trustedReport() {
  const families = [
    "steam",
    "xbox",
    "forza",
    "twistedvoxel",
    "gamesradar",
    "ign",
    "digitalfoundry",
    "eurogamer",
  ];
  return {
    story_candidates: families.map((family, index) => ({
      story_id: "forza-v4-director",
      entity: "Forza Horizon 6",
      source_id: `${family}-${index + 1}`,
      display_name: family,
      source_tier: family === "digitalfoundry" ? "licensed_creator" : "official",
      source_family: family,
      reference_url: `https://example.test/${family}`,
      source_url_kind: family === "steam" ? "hls_manifest" : "web_page",
      segment_validation_eligible: family === "steam",
      autonomous_motion_candidate: true,
      allowed_render_use:
        family === "digitalfoundry"
          ? "licensed_short_clip_candidate"
          : "reference_only_by_default",
      rights_risk_class:
        family === "digitalfoundry"
          ? "licensed_creator_clip"
          : "official_reference_only",
    })),
  };
}

function localClips(count = 8) {
  const families = [
    "steam",
    "xbox",
    "forza",
    "twistedvoxel",
    "gamesradar",
    "ign",
    "digitalfoundry",
    "eurogamer",
  ];
  return families.slice(0, count).map((family, index) => ({
    id: `${family}-clip`,
    source_family: family,
    path: `C:\\media\\${family}.mp4`,
    durationS: 2.4 + index * 0.18,
    validated: true,
  }));
}

function officialWindowClipsFromFourAssets() {
  return Array.from({ length: 8 }, (_, index) => {
    const asset = index % 4;
    return {
      id: `playstation-window-${index + 1}`,
      source_family: `playstation_blog_marvel_tokon_asset_${asset + 1}_window_${index + 1}_5`,
      path: `C:\\media\\marvel-tokon-window-${index + 1}.mp4`,
      source_url: `https://vulcan.playstation.test/marvel-tokon-asset-${asset + 1}.mp4`,
      durationS: 3.1,
      media_kind: "direct_video",
      source_type: "official_game_site_news_page",
      validation_reason: "trimmed_segment_samples_passed",
      trust_evidence_source: "validated_official_local_motion",
      counts_towards_motion_readiness: true,
      validated: true,
    };
  });
}

function staleBlockedFootagePlan() {
  return {
    readiness: {
      status: "blocked",
      blockers: [
        "actual_motion_clip_minimum_not_met",
        "distinct_motion_families_minimum_not_met",
        "no_trusted_footage_references_for_story",
      ],
    },
    motion_budget: {
      required_motion_scenes: 5,
      available_motion_clips: 0,
      required_distinct_families: 4,
      available_distinct_motion_families: 0,
      max_static_card_ratio: 0.22,
      max_static_card_seconds: 12,
      target_motion_ratio: 0.68,
    },
    motion_inventory: {
      accepted_local_clips: localClips(5),
    },
  };
}

function licensedSfxAssets() {
  return [
    {
      asset_id: "boom-impact-01",
      role: "impact",
      family: "impact",
      provider_id: "boom_library",
      source_url: "file://audio/licensed-sfx/boom/impact-01.wav",
      licence_basis: "boom_library_media_license",
      commercial_use_allowed: true,
      approval_status: "approved_for_commercial_editorial_use",
    },
    {
      asset_id: "soundly-transition-01",
      role: "transition",
      family: "whoosh",
      provider_id: "soundly",
      source_url: "file://audio/licensed-sfx/soundly/transition-01.wav",
      licence_basis: "soundly_pro_commercial_use",
      commercial_use_allowed: true,
      approval_status: "approved_for_commercial_editorial_use",
    },
    {
      asset_id: "sonniss-ui-01",
      role: "ui_tick",
      family: "source_tick",
      provider_id: "sonniss",
      source_url: "file://audio/licensed-sfx/sonniss/ui-01.wav",
      licence_basis: "sonniss_game_audio_gdc_bundle_license",
      commercial_use_allowed: true,
      approval_status: "approved_for_commercial_editorial_use",
    },
    {
      asset_id: "pse-riser-01",
      role: "riser",
      family: "riser",
      provider_id: "pro_sound_effects",
      source_url: "file://audio/licensed-sfx/pse/riser-01.wav",
      licence_basis: "pro_sound_effects_subscription_license",
      commercial_use_allowed: true,
      approval_status: "approved_for_commercial_editorial_use",
    },
    {
      asset_id: "boom-sub-01",
      role: "sub_hit",
      family: "sub_hit",
      provider_id: "boom_library",
      source_url: "file://audio/licensed-sfx/boom/sub-01.wav",
      licence_basis: "boom_library_media_license",
      commercial_use_allowed: true,
      approval_status: "approved_for_commercial_editorial_use",
    },
  ];
}

function localTimeline() {
  return {
    duration_s: 58,
    words: [
      { word: "Forza", start: 0.05, end: 0.28 },
      { word: "headline", start: 0.7, end: 1.1 },
      { word: "Twisted", start: 3.4, end: 3.65 },
      { word: "Voxel", start: 3.7, end: 3.94 },
      { word: "92", start: 8.1, end: 8.42 },
      { word: "Metacritic", start: 8.45, end: 9.1 },
      { word: "178,009", start: 14.2, end: 14.74 },
      { word: "SteamDB", start: 14.8, end: 15.2 },
      { word: "$120", start: 25.4, end: 25.9 },
      { word: "Follow", start: 53.5, end: 53.8 },
    ],
    beats: [
      {
        id: "beat_hook",
        type: "hook",
        start: 0.05,
        end: 2.8,
        text: "Forza just gave Xbox the headline it badly needed.",
      },
      {
        id: "beat_score",
        type: "metric",
        start: 7.8,
        end: 10.4,
        text: "92 Metacritic aggregate",
        metric: "92",
      },
      {
        id: "beat_steam",
        type: "metric",
        start: 13.8,
        end: 16.5,
        text: "SteamDB showing 178,009 concurrent users",
        metric: "178,009",
      },
      {
        id: "beat_price",
        type: "metric",
        start: 24.8,
        end: 28.2,
        text: "around $120 before the standard launch",
        metric: "$120",
      },
      {
        id: "beat_cta",
        type: "cta",
        start: 53.5,
        end: 57.4,
        text: "Follow Pulse Gaming so you never miss a beat.",
      },
    ],
  };
}

function retentionIntelligence() {
  return {
    verdict: "needs_retention_rescue",
    recommendations: [
      {
        id: "move_metric_first",
        action: "Move the Steam chart and concrete number into the opening four seconds.",
      },
      {
        id: "insert_pattern_interrupt_before_drop",
        action: "Add a visual pattern interrupt before the first predicted drop.",
      },
    ],
    visual_v3_adjustments: {
      timeline_events: [
        {
          id: "retention_interrupt_18s",
          kind: "retention_pattern_interrupt",
          label: "WAIT, THAT NUMBER HAS A CATCH",
          detail: "Premium Edition changes the read",
          atS: 18.2,
          durationS: 2.1,
          priority: 94,
        },
      ],
      prompt_directives: [
        "Move the Steam chart and concrete number into the opening four seconds.",
      ],
    },
  };
}

test("Visual V4 Director blocks the render plan when Footage Empire says real motion is not ready", () => {
  const footagePlan = buildFootageEmpirePlan({
    story: story(),
    trustedFootageReport: trustedReport(),
    localMotionClips: localClips(3),
  });
  const plan = buildVisualV4DirectorPlan({
    story: story(),
    footagePlan,
    localTimeline: localTimeline(),
    retentionIntelligence: retentionIntelligence(),
    sfxAssetInventory: licensedSfxAssets(),
  });

  assert.equal(plan.execution_mode, "visual_v4_director_brain");
  assert.equal(plan.local_only, true);
  assert.equal(plan.readiness.status, "director_blocked");
  assert.ok(plan.readiness.blockers.includes("actual_motion_clip_minimum_not_met"));
  assert.ok(plan.readiness.blockers.includes("distinct_motion_families_minimum_not_met"));
  assert.ok(plan.shot_budget.min_actual_motion_clips >= 7);
  assert.ok(plan.shot_budget.max_static_card_ratio <= 0.22);
  assert.ok(plan.visual_obligations.forbid_empty_rectangles);
  assert.ok(plan.visual_obligations.forbid_text_on_text);
  assert.equal(plan.caption_policy.subtitles_last, true);
  assert.equal(plan.caption_policy.clean_manual_captions, true);
  assert.equal(plan.caption_policy.manual_caption_generated, true);
  assert.equal(plan.caption_policy.subtitle_timing_source, "timestamps");
});

test("Visual V4 Director turns Steam, score, price and retention signals into a timed shot plan", () => {
  const footagePlan = buildFootageEmpirePlan({
    story: story(),
    trustedFootageReport: trustedReport(),
    localMotionClips: localClips(8),
  });
  const plan = buildVisualV4DirectorPlan({
    story: story(),
    footagePlan,
    localTimeline: localTimeline(),
    retentionIntelligence: retentionIntelligence(),
    sfxAssetInventory: licensedSfxAssets(),
  });

  assert.equal(plan.readiness.status, "director_ready");
  assert.equal(plan.shot_plan[0].kind, "hook_slam");
  const steam = plan.shot_plan.find((shot) => shot.kind === "steam_chart");
  const score = plan.shot_plan.find((shot) => shot.kind === "review_score_card");
  const price = plan.shot_plan.find((shot) => shot.kind === "price_snap");
  const interrupt = plan.shot_plan.find((shot) => shot.kind === "pattern_interrupt");

  assert.ok(steam);
  assert.ok(steam.startS < 4, `Steam chart starts too late: ${steam.startS}`);
  assert.equal(steam.metric, "178,009");
  assert.ok(score);
  assert.equal(score.metric, "92");
  assert.ok(price);
  assert.equal(price.metric, "$120");
  assert.ok(interrupt);
  assert.match(interrupt.label, /CATCH/);
  assert.ok(plan.shot_plan.some((shot) => shot.kind === "source_lock"));
  assert.ok(plan.media_house_benchmark);
  assert.ok(plan.media_house_benchmark.reference_pack_used.includes("Gaming News Core"));
  assert.ok(
    plan.media_house_benchmark.extraction_targets.includes(
      "media_house_polish_score",
    ),
  );
  assert.equal(plan.creative_identity.category, "review");
  assert.equal(plan.creative_identity.segment_name, "Worth Your Wishlist?");
  assert.equal(plan.creative_rhythm.max_narrative_card_scene_count, 2);
  assert.equal(plan.render_adjustments.creative_system_version, "pulse_visual_identity_v5");
  assert.equal(plan.shot_plan.every((shot) => shot.creative_category === "review"), true);
});

test("Visual V4 Director applies a distinct V5 category grammar to update stories", () => {
  const footagePlan = buildFootageEmpirePlan({
    story: story(),
    trustedFootageReport: trustedReport(),
    localMotionClips: localClips(8),
  });
  const plan = buildVisualV4DirectorPlan({
    story: {
      ...story(),
      id: "halo-update-v5",
      title: "Halo update adds three campaign missions",
      full_script:
        "Halo just added three campaign missions, but the useful question is whether the update changes the full run for returning players.",
    },
    footagePlan,
    localTimeline: localTimeline(),
    sfxAssetInventory: licensedSfxAssets(),
  });

  assert.equal(plan.creative_identity.category, "update");
  assert.equal(plan.creative_identity.code, "PG/UPD");
  assert.equal(plan.creative_identity.transition_cycle[0], "smoothup");
  assert.equal(plan.visual_obligations.no_adjacent_fullscreen_cards, true);
  assert.equal(plan.visual_obligations.fullscreen_cards_are_context_only, true);
});

test("Visual V4 Director uses distinct official clip windows when source assets are limited", () => {
  const clips = officialWindowClipsFromFourAssets();
  const footagePlan = {
    readiness: {
      status: "v4_motion_ready",
      blockers: [],
      warnings: [],
    },
    motion_budget: {
      required_motion_scenes: 5,
      available_motion_clips: clips.length,
      required_distinct_families: 4,
      available_distinct_motion_families: 4,
      required_distinct_source_assets: 4,
      available_distinct_source_assets: 4,
      max_static_card_ratio: 0.28,
      max_static_card_seconds: 14,
      target_motion_ratio: 0.64,
    },
    motion_inventory: {
      accepted_local_clips: clips,
    },
  };

  const plan = buildVisualV4DirectorPlan({
    story: {
      ...story(),
      id: "marvel-tokon-window-selection",
      title: "MARVEL Tokon Turns Its Roster Into A Meta Fight",
      canonical_subject: "MARVEL Tokon",
      full_script:
        "MARVEL Tokon just turned Blade, Loki and Deadpool into a real team-building argument. The useful question is whether these characters create readable assist chains or just crowd the screen. Follow Pulse Gaming so you never miss a beat.",
    },
    footagePlan,
    localTimeline: localTimeline(),
    sfxAssetInventory: licensedSfxAssets(),
  });

  const motionShots = plan.shot_plan.filter((shot) => shot.kind === "motion_clip");
  const clipIds = motionShots.map((shot) => shot.motion_pack_clip_id);

  assert.equal(plan.readiness.status, "director_ready");
  assert.equal(motionShots.length >= 5, true);
  assert.equal(new Set(clipIds).size, clipIds.length, "motion shots must not repeat the exact same clip window");
  assert.equal(plan.shot_budget.available_motion_clips, 8);
  assert.equal(plan.shot_budget.available_distinct_motion_source_assets, 8);
  assert.ok(!plan.readiness.blockers.includes("actual_motion_clip_minimum_not_met"));
});

test("Visual V4 Director fills its shot floor with a second unique window per official video", () => {
  const clips = Array.from({ length: 8 }, (_, index) => {
    const sourceIndex = Math.floor(index / 2) + 1;
    return {
      id: `official-video-${sourceIndex}-window-${(index % 2) + 1}`,
      source_family: `official-video-${sourceIndex}`,
      path: `C:\\media\\official-video-${sourceIndex}-window-${(index % 2) + 1}.mp4`,
      source_url: `https://www.youtube.com/watch?v=official-video-${sourceIndex}`,
      source_type: "official_publisher_trailer_segment",
      media_kind: "direct_video",
      durationS: 6,
      validated: true,
    };
  });
  const footagePlan = {
    readiness: { status: "v4_motion_ready", blockers: [], warnings: [] },
    motion_budget: {
      required_motion_scenes: 5,
      available_motion_clips: clips.length,
      required_distinct_families: 4,
      available_distinct_motion_families: 4,
      required_distinct_source_assets: 4,
      available_distinct_source_assets: 4,
    },
    motion_inventory: { accepted_local_clips: clips },
  };

  const plan = buildVisualV4DirectorPlan({
    story: story(),
    footagePlan,
    localTimeline: localTimeline(),
    sfxAssetInventory: licensedSfxAssets(),
  });
  const motionShots = plan.shot_plan.filter((shot) => shot.kind === "motion_clip");

  assert.equal(plan.readiness.status, "director_ready");
  assert.equal(motionShots.length >= 5, true);
  assert.equal(new Set(motionShots.map((shot) => shot.motion_pack_clip_id)).size, motionShots.length);
  const usesBySource = new Map();
  for (const shot of motionShots) {
    usesBySource.set(shot.base_source_family, (usesBySource.get(shot.base_source_family) || 0) + 1);
  }
  assert.equal(Math.max(...usesBySource.values()) <= 2, true);
});

test("Visual V4 Director gives every card-like beat readable dwell time", () => {
  const footagePlan = buildFootageEmpirePlan({
    story: story(),
    trustedFootageReport: trustedReport(),
    localMotionClips: localClips(8),
  });
  const plan = buildVisualV4DirectorPlan({
    story: story(),
    footagePlan,
    localTimeline: localTimeline(),
    retentionIntelligence: retentionIntelligence(),
    sfxAssetInventory: licensedSfxAssets(),
  });
  const cardLike = plan.shot_plan.filter((shot) =>
    /(?:card|source_lock|steam_chart|price_snap|review_score)/i.test(`${shot.kind} ${shot.id}`),
  );

  assert.ok(cardLike.length >= 3);
  const sourceLocks = cardLike.filter((shot) => shot.kind === "source_lock");
  const proofCards = cardLike.filter((shot) => shot.kind !== "source_lock");
  assert.equal(
    proofCards.every((shot) => Number(shot.durationS) >= 3.6 && Number(shot.durationS) <= 6.4),
    true,
    JSON.stringify(cardLike.map((shot) => ({ id: shot.id, kind: shot.kind, durationS: shot.durationS }))),
  );
  assert.equal(
    sourceLocks.every((shot) => Number(shot.durationS) === 2.6),
    true,
    JSON.stringify(cardLike.map((shot) => ({ id: shot.id, kind: shot.kind, durationS: shot.durationS }))),
  );
});

test("Visual V4 Director recomputes stale motion readiness from materialised clips", () => {
  const plan = buildVisualV4DirectorPlan({
    story: {
      ...story(),
      source_name: "",
      source_card_label: "IGN Preview",
      primary_source: "IGN",
    },
    footagePlan: staleBlockedFootagePlan(),
    localTimeline: localTimeline(),
    retentionIntelligence: retentionIntelligence(),
    sfxAssetInventory: licensedSfxAssets(),
  });
  const sourceLock = plan.shot_plan.find((shot) => shot.kind === "source_lock");

  assert.equal(plan.readiness.status, "director_ready");
  assert.equal(plan.shot_budget.available_motion_clips, 5);
  assert.equal(plan.shot_budget.available_distinct_motion_families, 5);
  assert.ok(!plan.readiness.blockers.includes("actual_motion_clip_minimum_not_met"));
  assert.ok(!plan.readiness.blockers.includes("distinct_motion_families_minimum_not_met"));
  assert.ok(!plan.readiness.blockers.includes("no_trusted_footage_references_for_story"));
  assert.equal(sourceLock.source, "IGN PREVIEW");
});

test("Visual V4 Director preserves the complete Bandai Namco source name", () => {
  const sourceName = "BANDAI NAMCO ENTERTAINMENT AMERICA";
  const plan = buildVisualV4DirectorPlan({
    story: {
      ...story(),
      source_name: sourceName,
    },
    footagePlan: staleBlockedFootagePlan(),
    localTimeline: localTimeline(),
    retentionIntelligence: retentionIntelligence(),
    sfxAssetInventory: licensedSfxAssets(),
  });
  const sourceLock = plan.shot_plan.find((shot) => shot.kind === "source_lock");

  assert.equal(sourceLock.source, sourceName);
});

test("Visual V4 Director exposes complete long source names through stable card fields", () => {
  const sourceName =
    "INTERNATIONAL ASSOCIATION OF INTERACTIVE ENTERTAINMENT PUBLISHERS";
  const plan = buildVisualV4DirectorPlan({
    story: {
      ...story(),
      source_name: sourceName,
    },
    footagePlan: staleBlockedFootagePlan(),
    localTimeline: localTimeline(),
    retentionIntelligence: retentionIntelligence(),
    sfxAssetInventory: licensedSfxAssets(),
  });
  const sourceLock = plan.shot_plan.find((shot) => shot.kind === "source_lock");

  assert.equal(sourceLock.source, sourceName);
  assert.equal(sourceLock.title, "SOURCE");
  assert.equal(sourceLock.label, sourceName);
  assert.ok(sourceLock.label.length > 28);
});

test("Visual V4 Director does not pad premium motion with repeated source-family clips", () => {
  const repeatedClips = Array.from({ length: 6 }, (_, index) => ({
    id: `sea-repeat-${index + 1}`,
    source_family: "steam_1172620_2137521619",
    path: `C:\\media\\sea-repeat-${index + 1}.mp4`,
    durationS: 2.6,
    validated: true,
  }));
  const plan = buildVisualV4DirectorPlan({
    story: {
      ...story(),
      id: "sea-of-thieves-repeat-risk",
      title: "Sea of Thieves Custom Seas Needs Better Footage",
      full_script:
        "Sea of Thieves has a Custom Seas update, but the visual package cannot keep looping one trailer window and call it a premium short.",
    },
    footagePlan: {
      readiness: {
        status: "blocked",
        blockers: [
          "actual_motion_clip_minimum_not_met",
          "distinct_motion_families_minimum_not_met",
        ],
      },
      motion_budget: {
        required_motion_scenes: 5,
        available_motion_clips: repeatedClips.length,
        required_distinct_families: 4,
        available_distinct_motion_families: 1,
        max_static_card_ratio: 0.22,
        max_static_card_seconds: 12,
        target_motion_ratio: 0.68,
      },
      motion_inventory: {
        accepted_local_clips: repeatedClips,
      },
    },
    localTimeline: localTimeline(),
    sfxAssetInventory: licensedSfxAssets(),
  });
  const motionShots = plan.shot_plan.filter((shot) => shot.kind === "motion_clip");

  assert.equal(plan.readiness.status, "director_blocked");
  assert.ok(plan.readiness.blockers.includes("actual_motion_clip_minimum_not_met"));
  assert.ok(plan.readiness.blockers.includes("distinct_motion_families_minimum_not_met"));
  assert.equal(motionShots.length, 1);
  assert.equal(new Set(motionShots.map((shot) => shot.source_family)).size, 1);
});

test("Visual V4 Director does not count timestamp windows from the same source video as distinct assets", () => {
  const repeatedBaseSourceClips = Array.from({ length: 6 }, (_, index) => ({
    id: `granblue-window-${index + 1}`,
    source_family: `playstation_blog_granblue_window_${index + 1}`,
    base_source_family: index < 3
      ? "url:https://example.com/granblue-trailer-a.mp4"
      : "url:https://example.com/granblue-trailer-b.mp4",
    path: `C:\\media\\granblue-window-${index + 1}.mp4`,
    durationS: 2.6,
    validated: true,
  }));
  const plan = buildVisualV4DirectorPlan({
    story: {
      ...story(),
      id: "granblue-window-repeat-risk",
      title: "Granblue Fantasy Relink Needs Better Footage Variety",
      full_script:
        "Granblue Fantasy Relink has official footage, but five slices from two MP4s still look like loops when they repeat in a Short.",
    },
    footagePlan: {
      readiness: {
        status: "ready",
        blockers: [],
      },
      motion_budget: {
        required_motion_scenes: 5,
        available_motion_clips: repeatedBaseSourceClips.length,
        required_distinct_families: 4,
        required_distinct_source_assets: 4,
        available_distinct_motion_families: repeatedBaseSourceClips.length,
        available_distinct_source_assets: 2,
        max_static_card_ratio: 0.22,
        max_static_card_seconds: 12,
        target_motion_ratio: 0.68,
      },
      motion_inventory: {
        accepted_local_clips: repeatedBaseSourceClips,
      },
    },
    localTimeline: localTimeline(),
    sfxAssetInventory: licensedSfxAssets(),
  });
  const motionShots = plan.shot_plan.filter((shot) => shot.kind === "motion_clip");

  assert.equal(plan.readiness.status, "director_blocked");
  assert.ok(plan.readiness.blockers.includes("actual_motion_clip_minimum_not_met"));
  assert.ok(plan.readiness.blockers.includes("distinct_motion_families_minimum_not_met"));
  assert.ok(plan.readiness.blockers.includes("distinct_motion_source_assets_minimum_not_met"));
  assert.equal(motionShots.length, 2);
  assert.equal(new Set(motionShots.map((shot) => shot.base_source_family)).size, 2);
  assert.equal(plan.shot_budget.available_distinct_motion_source_assets, 2);
});

test("Visual V4 Director counts official trailer segment windows as distinct rendered scene assets", () => {
  const officialWindows = Array.from({ length: 8 }, (_, index) => {
    const windowStart = 36 + index * 6;
    return {
      id: `gta-vi-window-${index + 1}`,
      source_family: `rockstar_gta_vi_official_videos__media_02_gtavi_trailer_2_window_${windowStart}_5`,
      source_url:
        "https://media.rockstargames.com/VI/downloads/videos/GTAVI_Trailer_2/GTAVI_Trailer_2.mp4",
      source_type: "official_trailer_segment",
      source_url_kind: "direct_video",
      media_kind: "direct_video",
      path: `C:\\media\\gta-vi-window-${windowStart}.mp4`,
      durationS: 5,
      validated: true,
    };
  });
  const plan = buildVisualV4DirectorPlan({
    story: {
      ...story(),
      id: "gta-vi-official-window-scenes",
      title: "GTA VI Starts The Preorder Fight",
      full_script:
        "Grand Theft Auto VI now has one real preorder catch. Xbox Wire says pre-orders open on June 25 after Rockstar put Jason and Lucia on the official cover art.",
    },
    footagePlan: {
      readiness: {
        status: "ready",
        blockers: [],
      },
      motion_budget: {
        required_motion_scenes: 5,
        available_motion_clips: officialWindows.length,
        required_distinct_families: 4,
        required_distinct_source_assets: 4,
        available_distinct_motion_families: officialWindows.length,
        available_distinct_source_assets: officialWindows.length,
        max_static_card_ratio: 0.22,
        max_static_card_seconds: 12,
        target_motion_ratio: 0.68,
      },
      motion_inventory: {
        accepted_local_clips: officialWindows,
      },
    },
    localTimeline: localTimeline(),
    sfxAssetInventory: licensedSfxAssets(),
  });
  const motionShots = plan.shot_plan.filter((shot) => shot.kind === "motion_clip");

  assert.equal(plan.readiness.status, "director_ready");
  assert.equal(motionShots.length, 8);
  assert.equal(new Set(motionShots.map((shot) => shot.source_family)).size, 8);
  assert.equal(new Set(motionShots.map((shot) => shot.base_source_family)).size, 8);
  assert.equal(plan.shot_budget.available_distinct_motion_source_assets, 8);
});

test("Visual V4 Director treats generated segment variants from one V4 clip as one source asset", () => {
  const segmentVariantClips = [
    {
      id: "story-segment-1",
      source_family: "rss_story_v4_clip_1_segment_direct_motion_1_a1b2c3d4",
      path: "C:\\media\\rss_story_v4_clip_1_segment_direct_motion_1_a1b2c3d4.mp4",
      durationS: 2.8,
      validated: true,
    },
    {
      id: "story-segment-2",
      source_family: "rss_story_v4_clip_1_segment_direct_motion_2_e5f6a7b8",
      path: "C:\\media\\rss_story_v4_clip_1_segment_direct_motion_2_e5f6a7b8.mp4",
      durationS: 2.8,
      validated: true,
    },
    {
      id: "story-segment-3",
      source_family: "rss_story_v4_clip_1_segment_direct_motion_3_ffeeddcc",
      path: "C:\\media\\rss_story_v4_clip_1_segment_direct_motion_3_ffeeddcc.mp4",
      durationS: 2.8,
      validated: true,
    },
    {
      id: "story-alt-1",
      source_family: "rss_story_v4_clip_2_segment_direct_motion_1_c9d0e1f2",
      path: "C:\\media\\rss_story_v4_clip_2_segment_direct_motion_1_c9d0e1f2.mp4",
      durationS: 2.8,
      validated: true,
    },
  ];
  const plan = buildVisualV4DirectorPlan({
    story: {
      ...story(),
      id: "generated-segment-repeat-risk",
      title: "Generated Segment Variants Cannot Pad A Premium Edit",
      full_script:
        "A premium edit cannot repeat tiny windows from the same V4 clip and pretend the motion is fresh.",
    },
    footagePlan: {
      readiness: {
        status: "ready",
        blockers: [],
      },
      motion_budget: {
        required_motion_scenes: 4,
        available_motion_clips: segmentVariantClips.length,
        required_distinct_families: 4,
        required_distinct_source_assets: 4,
        available_distinct_motion_families: segmentVariantClips.length,
        available_distinct_source_assets: segmentVariantClips.length,
      },
      motion_inventory: {
        accepted_local_clips: segmentVariantClips,
      },
    },
    localTimeline: localTimeline(),
    sfxAssetInventory: licensedSfxAssets(),
  });
  const motionShots = plan.shot_plan.filter((shot) => shot.kind === "motion_clip");

  assert.equal(plan.readiness.status, "director_blocked");
  assert.ok(plan.readiness.blockers.includes("actual_motion_clip_minimum_not_met"));
  assert.ok(plan.readiness.blockers.includes("distinct_motion_families_minimum_not_met"));
  assert.ok(plan.readiness.blockers.includes("distinct_motion_source_assets_minimum_not_met"));
  assert.deepEqual(
    motionShots.map((shot) => shot.base_source_family),
    [
      "rss_story_v4_clip_1",
      "rss_story_v4_clip_2",
    ],
  );
});

test("Visual V4 Director refuses extra windows from the same base source even when hashes differ", () => {
  const baseSources = [
    "url:https://example.com/granblue-trailer-a.mp4",
    "url:https://example.com/granblue-trailer-b.mp4",
    "url:https://example.com/granblue-steam-trailer-a.m3u8",
    "url:https://example.com/granblue-steam-trailer-b.m3u8",
  ];
  const officialWindows = Array.from({ length: 8 }, (_, index) => {
    const base = baseSources[index % baseSources.length];
    return {
      id: `granblue-distinct-window-${index + 1}`,
      source_family: `granblue_distinct_window_${index + 1}`,
      base_source_family: base,
      path: `C:\\media\\granblue-distinct-window-${index + 1}.mp4`,
      durationS: 2.8,
      validated: true,
    };
  });
  const plan = buildVisualV4DirectorPlan({
    story: {
      ...story(),
      id: "granblue-enough-base-sources",
      title: "Granblue Fantasy Relink Has Enough Official Motion",
      full_script:
        "Granblue Fantasy Relink has official trailer windows from multiple source videos, so the edit can stay varied without looping the same clip.",
    },
    footagePlan: {
      readiness: {
        status: "ready",
        blockers: [],
      },
      motion_budget: {
        required_motion_scenes: 5,
        available_motion_clips: officialWindows.length,
        required_distinct_families: 4,
        required_distinct_source_assets: 4,
        available_distinct_motion_families: officialWindows.length,
        available_distinct_source_assets: baseSources.length,
        max_static_card_ratio: 0.22,
        max_static_card_seconds: 12,
        target_motion_ratio: 0.68,
      },
      motion_inventory: {
        accepted_local_clips: officialWindows,
      },
    },
    localTimeline: localTimeline(),
    sfxAssetInventory: licensedSfxAssets(),
  });
  const motionShots = plan.shot_plan.filter((shot) => shot.kind === "motion_clip");

  assert.equal(plan.readiness.status, "director_blocked");
  assert.ok(plan.readiness.blockers.includes("actual_motion_clip_minimum_not_met"));
  assert.equal(motionShots.length, 4);
  assert.equal(new Set(motionShots.map((shot) => shot.source_family)).size, 4);
  assert.equal(new Set(motionShots.map((shot) => shot.base_source_family)).size, 4);
});

test("Visual V4 Director keeps separate official YouTube videos as separate motion sources", () => {
  const sourceUrls = [
    "https://cdn.example.test/albion/steam-a.mp4",
    "https://cdn.example.test/albion/steam-b.mp4",
    "https://cdn.example.test/albion/steam-c.mp4",
    "https://www.youtube.com/watch?v=Bu6BPfCtKBQ",
    "https://www.youtube.com/watch?v=Fmdd2nojs4g",
  ];
  const clips = sourceUrls.map((sourceUrl, index) => ({
    id: `albion-motion-${index + 1}`,
    source_family: `albion_family_${index + 1}`,
    source_url: sourceUrl,
    path: `C:\\media\\albion-motion-${index + 1}.mp4`,
    durationS: 5,
    validated: true,
  }));
  const plan = buildVisualV4DirectorPlan({
    story: {
      ...story(),
      id: "albion-distinct-youtube-videos",
      title: "Albion Online's Keepers Just Raised The Stakes",
      full_script:
        "Albion Online has official event footage from separate videos and storefront trailers.",
    },
    footagePlan: {
      readiness: { status: "ready", blockers: [] },
      motion_budget: {
        required_motion_scenes: 5,
        available_motion_clips: clips.length,
        required_distinct_families: 4,
        required_distinct_source_assets: 4,
        available_distinct_motion_families: clips.length,
        available_distinct_source_assets: clips.length,
        max_static_card_ratio: 0.22,
        max_static_card_seconds: 12,
        target_motion_ratio: 0.68,
      },
      motion_inventory: { accepted_local_clips: clips },
    },
    localTimeline: localTimeline(),
    sfxAssetInventory: licensedSfxAssets(),
  });
  const motionShots = plan.shot_plan.filter((shot) => shot.kind === "motion_clip");

  assert.equal(motionShots.length, 5);
  assert.equal(new Set(motionShots.map((shot) => shot.base_source_family)).size, 5);
  assert.equal(plan.readiness.status, "director_ready");
});

test("Visual V4 Director normalises compact Steam k metrics into chart numbers", () => {
  const footagePlan = buildFootageEmpirePlan({
    story: {
      id: "forza-v4-director",
      title: "Forza Horizon 6 passed 273k players on Steam",
      full_script: "Forza Horizon 6 passed 273k players on Steam and beat the last game.",
    },
    trustedFootageReport: trustedReport(),
    localMotionClips: localClips(8),
  });
  const plan = buildVisualV4DirectorPlan({
    story: {
      id: "forza-v4-director",
      title: "Forza Horizon 6 passed 273k players on Steam",
      full_script: "Forza Horizon 6 passed 273k players on Steam and beat the last game.",
    },
    footagePlan,
    generatedAt: "2026-05-20T10:00:00.000Z",
    sfxAssetInventory: licensedSfxAssets(),
  });

  const steam = plan.shot_plan.find((shot) => shot.kind === "steam_chart");
  assert.equal(steam.metric, "273,000");
});

test("Visual V4 Director assigns unique motion source families and varied transitions", () => {
  const footagePlan = buildFootageEmpirePlan({
    story: story(),
    trustedFootageReport: trustedReport(),
    localMotionClips: localClips(8),
  });
  const plan = buildVisualV4DirectorPlan({
    story: story(),
    footagePlan,
    localTimeline: localTimeline(),
    retentionIntelligence: retentionIntelligence(),
    sfxAssetInventory: licensedSfxAssets(),
  });
  const motionShots = plan.shot_plan.filter((shot) => shot.kind === "motion_clip");
  const families = motionShots.map((shot) => shot.source_family);

  assert.ok(motionShots.length >= plan.shot_budget.min_actual_motion_clips);
  assert.equal(new Set(families).size, families.length);
  assert.ok(plan.transition_plan.required_families.includes("hard_cut"));
  assert.ok(plan.transition_plan.required_families.includes("speed_ramp"));
  assert.ok(plan.transition_plan.required_families.includes("chart_slam"));
  assert.ok(plan.transition_plan.required_families.includes("wipe"));
  assert.ok(plan.transition_plan.max_same_transition_run <= 2);
});

test("Visual V4 Director builds a dense but non-repetitive SFX plan", () => {
  const footagePlan = buildFootageEmpirePlan({
    story: story(),
    trustedFootageReport: trustedReport(),
    localMotionClips: localClips(8),
  });
  const plan = buildVisualV4DirectorPlan({
    story: story(),
    footagePlan,
    localTimeline: localTimeline(),
    retentionIntelligence: retentionIntelligence(),
    sfxAssetInventory: licensedSfxAssets(),
  });
  const families = new Set(plan.sfx_plan.cues.map((cue) => cue.family));

  assert.ok(plan.sfx_plan.cues.length >= 8);
  assert.ok(families.has("impact"));
  assert.ok(families.has("whoosh"));
  assert.equal(families.has("riser"), false);
  assert.ok(families.has("chart_tick"));
  assert.ok(families.has("transition_hit"));
  assert.ok(plan.sfx_plan.max_same_family_run <= 2);
  assert.equal(plan.sfx_plan.mastering.duck_under_narration, true);
  assert.equal(plan.sfx_plan.mastering.local_only, true);
});

test("Visual V4 Director adds proof-card beats but does not benchmark generated-only decks as final quality", () => {
  const proofStory = {
    id: "expanse-v4-director",
    canonical_subject: "The Expanse",
    title: "The Expanse Game Finally Looks Real",
    suggested_title: "The Expanse Game Finally Looks Real",
    source_name: "Xbox",
    suggested_thumbnail_text: "EXPANSE GAMEPLAY",
    full_script:
      "The Expanse: Osiris Reborn finally has the thing licensed games usually hide: real gameplay. Xbox showed a narrative sci-fi action game built around The Expanse universe, not just a logo and a promise. That matters because players can now judge the combat, world and Mass Effect-style pitch. But the catch is brutal: a famous licence only helps if the game actually feels worth playing. Follow Pulse Gaming so you never miss a beat.",
    video_clips: localClips(8).map((clip) => ({
      ...clip,
      rights_risk_class: "owned_generated_motion",
    })),
    clean_manual_captions: true,
  };
  const footagePlan = buildFootageEmpirePlan({
    story: proofStory,
    trustedFootageReport: {
      story_candidates: localClips(8).map((clip, index) => ({
        story_id: "expanse-v4-director",
        entity: "The Expanse",
        source_id: `owned-generated-${index + 1}`,
        display_name: "Pulse generated proof motion",
        source_tier: "owned",
        source_family: clip.source_family,
        reference_url: `local://pulse-generated-motion/expanse/${index + 1}`,
        source_url_kind: "direct_video",
        segment_validation_eligible: true,
        autonomous_motion_candidate: true,
        allowed_render_use: "owned_generated_editorial_motion",
        rights_risk_class: "owned_generated_motion",
      })),
    },
    localMotionClips: proofStory.video_clips,
  });
  const plan = buildVisualV4DirectorPlan({
    story: proofStory,
    footagePlan,
    sfxAssetInventory: licensedSfxAssets(),
  });

  assert.equal(plan.readiness.status, "director_ready");
  assert.ok(plan.shot_plan.some((shot) => shot.kind === "proof_card"));
  assert.equal(plan.media_house_benchmark.result, "warn");
  assert.ok(plan.media_house_benchmark.warnings.some((warning) => /visual_evidence/.test(warning)));
  assert.ok(plan.media_house_benchmark.scores.card_hierarchy_score >= 65);
});

test("Visual V4 Director uses story-specific proof cards instead of generic source-lock cards", () => {
  const storyCases = [
    {
      story: {
        id: "zero-company",
        canonical_subject: "Star Wars Zero Company",
        title: "Star Wars Zero Company Is More Than XCOM",
        full_script: "Star Wars Zero Company is more than XCOM because the tactics pitch changes the angle.",
      },
      label: /TACTICS CHECK/,
    },
    {
      story: {
        id: "pragmata",
        canonical_subject: "Pragmata",
        title: "Pragmata's AI-Look Stage Was Handmade",
        full_script: "Pragmata's AI-look stage was handmade, not an AI generation shortcut.",
      },
      label: /HANDMADE STAGE/,
    },
    {
      story: {
        id: "steam-controller",
        canonical_subject: "Steam Controller",
        title: "Steam Controller Date May Have Leaked",
        full_script: "Steam Controller may have leaked its own release date.",
      },
      label: /DATE LEAK/,
    },
    {
      story: {
        id: "star-wars-racer",
        canonical_subject: "Star Wars Racer",
        title: "Star Wars Racer Date Leaked Early",
        full_script: "Star Wars Racer may have leaked its own release date before the official post.",
      },
      label: /RELEASE DATE/,
    },
    {
      story: {
        id: "subnautica",
        canonical_subject: "Subnautica 2",
        title: "Subnautica 2 Reportedly Leaked Early",
        full_script: "Subnautica 2 reportedly leaked before launch.",
      },
      label: /LEAKED BUILD/,
    },
  ];

  for (const item of storyCases) {
    const footagePlan = buildFootageEmpirePlan({
      story: item.story,
      trustedFootageReport: trustedReport(),
      localMotionClips: localClips(8),
    });
    const plan = buildVisualV4DirectorPlan({
      story: item.story,
      footagePlan,
      sfxAssetInventory: licensedSfxAssets(),
    });
    const proof = plan.shot_plan.find((shot) => shot.kind === "proof_card");
    assert.ok(proof);
    assert.match(proof.label, item.label);
    assert.notEqual(proof.label, "SOURCE LOCKED");
  }
});
