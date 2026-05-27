const assert = require("node:assert/strict");
const test = require("node:test");

function strongDirectorPlan() {
  const shotPlan = [
    { id: "hook_slam", kind: "hook_slam", startS: 0, durationS: 2.2 },
    { id: "source_lock", kind: "source_lock", startS: 2.2, durationS: 1.8 },
    { id: "steam_chart", kind: "steam_chart", startS: 4.2, durationS: 3 },
    { id: "motion_1", kind: "motion_clip", startS: 7, source_family: "official_trailer_a" },
    { id: "motion_2", kind: "motion_clip", startS: 11, source_family: "official_trailer_b" },
    { id: "motion_3", kind: "motion_clip", startS: 15, source_family: "steam_trailer" },
    { id: "motion_4", kind: "motion_clip", startS: 19, source_family: "publisher_clip" },
    { id: "motion_5", kind: "motion_clip", startS: 24, source_family: "gameplay_clip" },
    { id: "motion_6", kind: "motion_clip", startS: 30, source_family: "storefront_clip" },
    { id: "motion_7", kind: "motion_clip", startS: 36, source_family: "official_short" },
    { id: "motion_8", kind: "motion_clip", startS: 43, source_family: "platform_clip" },
    { id: "payoff", kind: "pattern_interrupt", startS: 50, durationS: 2 },
  ];
  return {
    story_id: "forza_ref",
    shot_plan: shotPlan,
    transition_plan: {
      planned: shotPlan.slice(1).map((shot, index) => ({
        into: shot.id,
        atS: Math.max(0, shot.startS - 0.04),
        family: ["hard_cut", "speed_ramp", "chart_slam", "source_wipe", "whip_pan", "wipe"][index % 6],
      })),
      max_same_transition_run: 1,
    },
    sound_transition_plan: {
      sfx: {
        cue_count: 12,
        max_same_family_run: 1,
        cues: [
          { family: "impact", atS: 0, gainDb: -7 },
          { family: "chart_tick", atS: 4.2, gainDb: -12 },
          { family: "whoosh", atS: 7, gainDb: -10 },
          { family: "transition_hit", atS: 11, gainDb: -10 },
          { family: "riser", atS: 50, gainDb: -11 },
        ],
        mastering: { limiter: true, target_peak_db: -1.5 },
      },
    },
    caption_policy: {
      clean_manual_captions: true,
      manual_caption_generated: true,
      subtitle_timing_source: "timestamps",
      snap_to_local_word_timing: true,
      max_caption_desync_ms: 100,
      avoid_lower_third_collisions: true,
    },
  };
}

test("media-house benchmark emits every requested workbook-derived score", () => {
  const { runMediaHouseBenchmark } = require("../../lib/media-house-benchmark");

  const benchmark = runMediaHouseBenchmark({
    story: {
      id: "forza_ref",
      title: "Forza Horizon 6 Steam Numbers Skyrocket",
      suggested_title: "Forza Horizon 6 Steam Numbers Skyrocket",
      hook: "Forza Horizon 6 just exposed the Xbox problem everyone wanted.",
      full_script:
        "Forza Horizon 6 just exposed the Xbox problem everyone wanted. GamesRadar reports 130,000 concurrent Steam players. That number matters because paid early access is already beating older Forza launches. Follow Pulse Gaming for the gaming stories behind the headline.",
      suggested_thumbnail_text: "FORZA NUMBERS EXPLODE",
      source_card_label: "GamesRadar+",
      article_url: "https://www.gamesradar.com/forza-horizon-6-steam",
      downloaded_images: [
        { rights_risk_class: "storefront_promotional", source_url: "https://store.steampowered.com/app/example" },
      ],
      video_clips: Array.from({ length: 8 }, (_, index) => ({
        rights_risk_class: "storefront_promotional_video",
        source_url: `https://cdn.example.com/clip-${index}.mp4`,
      })),
      subtitle_timing_source: "timestamps",
      clean_manual_captions: true,
    },
    directorPlan: strongDirectorPlan(),
    requireGate: true,
  });

  assert.equal(benchmark.result, "pass");
  assert.deepEqual(benchmark.reference_pack_used, [
    "Gaming News Core",
    "Official Publisher Motion",
    "Explainer / Data Graphics",
    "Pacing / Retention / Impact",
  ]);
  for (const key of [
    "motion_density_score",
    "first_3_seconds_hook_score",
    "source_lock_quality_score",
    "caption_legibility_score",
    "card_hierarchy_score",
    "transition_energy_score",
    "sfx_impact_score",
    "rights_risk_score",
    "stale_wording_risk",
    "media_house_polish_score",
  ]) {
    assert.equal(typeof benchmark.scores[key], "number", key);
  }
  assert.ok(benchmark.scores.motion_density_score >= 95);
  assert.ok(benchmark.scores.media_house_polish_score >= 85);
});

test("media-house benchmark preserves director caption policy when story fields are absent", () => {
  const { runMediaHouseBenchmark } = require("../../lib/media-house-benchmark");

  const benchmark = runMediaHouseBenchmark({
    story: {
      id: "forza_ref",
      title: "Forza Horizon 6 Steam Numbers Skyrocket",
      suggested_title: "Forza Horizon 6 Steam Numbers Skyrocket",
      hook: "Forza Horizon 6 just exposed the Xbox problem everyone wanted.",
      full_script:
        "Forza Horizon 6 just exposed the Xbox problem everyone wanted. GamesRadar reports 130,000 concurrent Steam players. That number matters because paid early access is already beating older Forza launches.",
      suggested_thumbnail_text: "FORZA NUMBERS EXPLODE",
      source_card_label: "GamesRadar+",
      video_clips: Array.from({ length: 8 }, (_, index) => ({
        rights_risk_class: "storefront_promotional_video",
        source_url: `https://cdn.example.com/clip-${index}.mp4`,
      })),
    },
    directorPlan: strongDirectorPlan(),
    requireGate: true,
  });

  assert.ok(benchmark.scores.caption_legibility_score >= 70);
  assert.ok(!benchmark.failures.includes("gold_standard:caption_legibility_below_reference"));
});

test("media-house benchmark recognises distinctive subtitle tokens in canonical subjects", () => {
  const { runMediaHouseBenchmark } = require("../../lib/media-house-benchmark");

  const benchmark = runMediaHouseBenchmark({
    story: {
      id: "dawn_of_war_subject",
      canonical_subject: "Warhammer 40,000: Dawn of War 4",
      title: "Dawn Of War 4 Has A Date",
      suggested_title: "Dawn Of War 4 Has A Date",
      hook: "Warhammer 40,000: Dawn of War 4 finally has a release date.",
      full_script:
        "Warhammer 40,000: Dawn of War 4 finally has a release date. GameSpot reports the sequel is planned for next year. That matters because the series has been absent for years, and strategy fans now have a clear window instead of another teaser.",
      suggested_thumbnail_text: "DAWN HAS A DATE",
      source_card_label: "GameSpot",
      video_clips: Array.from({ length: 8 }, (_, index) => ({
        rights_risk_class: "official_reference_clip",
        source_url: `https://cdn.example.com/dawn-${index}.mp4`,
      })),
      clean_manual_captions: true,
      subtitle_timing_source: "timestamps",
    },
    directorPlan: strongDirectorPlan(),
    requireGate: true,
  });

  assert.ok(benchmark.scores.first_3_seconds_hook_score >= 75);
  assert.ok(!benchmark.failures.includes("gold_standard:first_3_seconds_hook_below_reference"));
});

test("media-house benchmark scores string clip paths through the rights ledger", () => {
  const { runMediaHouseBenchmark } = require("../../lib/media-house-benchmark");
  const clips = Array.from({ length: 8 }, (_, index) => `output/video_cache/clip-${index}.mp4`);

  const benchmark = runMediaHouseBenchmark({
    story: {
      id: "forza_rights",
      title: "Forza Horizon 6 Steam Numbers Skyrocket",
      suggested_title: "Forza Horizon 6 Steam Numbers Skyrocket",
      hook: "Forza Horizon 6 just exposed the Xbox problem everyone wanted.",
      full_script:
        "Forza Horizon 6 just exposed the Xbox problem everyone wanted. GamesRadar reports 130,000 concurrent Steam players. Follow Pulse Gaming for the gaming stories behind the headline.",
      suggested_thumbnail_text: "FORZA NUMBERS EXPLODE",
      source_card_label: "GamesRadar+",
      video_clips: clips,
      rights_ledger: clips.map((clip) => ({
        path: clip,
        rights_risk_class: "official_reference_only",
        source_type: "official_reference_clip",
        source_url: `https://cdn.example.com/${clip}`,
      })),
      subtitle_timing_source: "timestamps",
      clean_manual_captions: true,
    },
    directorPlan: strongDirectorPlan(),
    requireGate: true,
  });

  assert.equal(benchmark.result, "pass");
  assert.ok(benchmark.scores.rights_risk_score >= 70);
});

test("media-house benchmark recognises repaired rights-ledger licence basis", () => {
  const { runMediaHouseBenchmark } = require("../../lib/media-house-benchmark");
  const clips = Array.from({ length: 7 }, (_, index) => ({
    id: `v4_motion_${index + 1}`,
    path: `output/video_cache/repaired-${index + 1}.mp4`,
    source_type: "licensed_direct_media_url",
    source_url: `https://cdn.example.com/repaired-${index + 1}.mp4`,
  }));

  const benchmark = runMediaHouseBenchmark({
    story: {
      id: "forza_repaired_rights",
      title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
      suggested_title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
      canonical_subject: "Forza Horizon 6",
      hook: "Forza Horizon 6 just broke the one Xbox ceiling that usually matters on Steam.",
      full_script:
        "Forza Horizon 6 just broke the one Xbox ceiling that usually matters on Steam. The source claim is simple: interest is already loud before launch. Follow Pulse Gaming for the gaming stories behind the headline.",
      suggested_thumbnail_text: "FORZA BROKE STEAM",
      source_card_label: "The Phrasemaker",
      video_clips: clips,
      rights_ledger: clips.map((clip) => ({
        asset_id: clip.id,
        path: clip.path,
        source_url: clip.source_url,
        source_type: "licensed_direct_media_url",
        licence_basis: "official_reference_only",
        approval_status: "approved_for_transformative_editorial_use",
        commercial_use_allowed: true,
      })),
      subtitle_timing_source: "timestamps",
      clean_manual_captions: true,
    },
    directorPlan: strongDirectorPlan(),
    requireGate: true,
  });

  assert.equal(benchmark.result, "pass");
  assert.ok(!benchmark.failures.includes("gold_standard:rights_risk_above_reference"));
  assert.ok(benchmark.scores.rights_risk_score >= 70);
});

test("media-house benchmark recognises approved screenshot-derived motion rights", () => {
  const { runMediaHouseBenchmark } = require("../../lib/media-house-benchmark");
  const clips = Array.from({ length: 8 }, (_, index) => ({
    id: `steam-screenshot-motion-${index + 1}`,
    path: `output/video_cache/steam-screenshot-motion-${index + 1}.mp4`,
    source_url: `https://shared.akamai.steamstatic.com/store_item_assets/app/shot-${index + 1}.jpg`,
    source_type: "screenshot",
    source_family: `steam_screenshot_${index + 1}`,
    media_kind: "visual_still",
  }));

  const benchmark = runMediaHouseBenchmark({
    story: {
      id: "expanse_screenshot_motion",
      canonical_subject: "The Expanse: Osiris Reborn",
      title: "The Expanse Shows Real Gameplay",
      suggested_title: "The Expanse Shows Real Gameplay",
      hook: "The Expanse: Osiris Reborn finally showed real gameplay.",
      full_script:
        "The Expanse: Osiris Reborn finally showed real gameplay. Xbox showed the first real look at the game in motion, which matters because licensed sci-fi games often hide the playable bit for too long.",
      suggested_thumbnail_text: "EXPANSE GAMEPLAY",
      source_card_label: "Xbox",
      video_clips: clips,
      rights_ledger: clips.map((clip) => ({
        asset_id: clip.id,
        asset_type: "screenshot_derived_motion_clip",
        kind: "video",
        path: clip.path,
        source_url: clip.source_url,
        source_type: "screenshot",
        licence_basis: "source_documented_transformative_editorial_use",
        allowed_use: "screenshot_derived_editorial_motion",
        commercial_use_allowed: true,
        risk_score: 0.32,
        approval_status: "approved_for_transformative_editorial_use",
      })),
      clean_manual_captions: true,
      subtitle_timing_source: "timestamps",
    },
    directorPlan: strongDirectorPlan(),
    requireGate: true,
  });

  assert.ok(benchmark.scores.rights_risk_score >= 90);
  assert.ok(!benchmark.failures.includes("gold_standard:rights_risk_above_reference"));
});

test("media-house benchmark does not let stripped audit asset rows overwrite approved rights records", () => {
  const { runMediaHouseBenchmark } = require("../../lib/media-house-benchmark");
  const clips = Array.from({ length: 8 }, (_, index) => ({
    id: `owned-motion-${index + 1}`,
    path: `output/generated-motion/xbox-controller/${index + 1}.mp4`,
    source_url: `local://pulse-generated-motion/xbox-controller/${index + 1}`,
    source_type: "internally_generated_motion_graphic",
    source_family: `owned_motion_${index + 1}`,
    media_kind: "owned_explainer_motion",
    licence_basis: "owned_generated_editorial_motion_graphic",
  }));
  const approvedRecords = clips.map((clip) => ({
    asset_id: clip.id,
    path: clip.path,
    source_url: clip.source_url,
    source_type: clip.source_type,
    licence_basis: "owned_generated_editorial_motion_graphic",
    allowed_use: "owned_editorial_motion_graphic",
    approval_status: "approved_for_commercial_editorial_use",
    commercial_use_allowed: true,
    risk_score: 0.01,
  }));
  const strippedAuditRows = clips.map((clip, index) => ({
    asset_id: `production_motion_${index + 1}`,
    path: clip.path,
    source_type: "video",
    rights_risk_class: "",
  }));

  const benchmark = runMediaHouseBenchmark({
    story: {
      id: "xbox_controller_rights",
      canonical_subject: "Xbox Controller",
      title: "Xbox Controller Deal Has One Catch",
      suggested_title: "Xbox Controller Deal Has One Catch",
      hook: "Xbox Controller buyers just got one useful catch before they buy.",
      full_script:
        "Xbox Controller buyers just got one useful catch before they buy. The source points to a hardware deal with a clear platform angle.",
      suggested_thumbnail_text: "XBOX DEAL CATCH",
      source_card_label: "Xbox",
      video_clips: clips,
      rights_ledger: [...approvedRecords, ...strippedAuditRows],
      clean_manual_captions: true,
      subtitle_timing_source: "timestamps",
    },
    directorPlan: strongDirectorPlan(),
    requireGate: true,
  });

  assert.ok(benchmark.scores.rights_risk_score >= 90);
  assert.ok(!benchmark.failures.includes("gold_standard:rights_risk_above_reference"));
});

test("media-house benchmark rewards proof cards for strong non-stat stories", () => {
  const { runMediaHouseBenchmark } = require("../../lib/media-house-benchmark");
  const shotPlan = [
    { id: "hook_slam", kind: "hook_slam", startS: 0, durationS: 2.2 },
    { id: "source_lock", kind: "source_lock", startS: 2.2, durationS: 1.8 },
    { id: "gameplay_proof", kind: "proof_card", startS: 4.4, durationS: 2.4 },
    ...Array.from({ length: 8 }, (_, index) => ({
      id: `owned_motion_${index + 1}`,
      kind: "motion_clip",
      startS: 7 + index * 4,
      source_family: `owned_generated_family_${index + 1}`,
    })),
  ];

  const benchmark = runMediaHouseBenchmark({
    story: {
      id: "expanse_proof_card",
      canonical_subject: "The Expanse",
      title: "The Expanse Game Finally Looks Real",
      suggested_title: "The Expanse Game Finally Looks Real",
      hook: "The Expanse: Osiris Reborn finally has the thing licensed games usually hide: real gameplay.",
      full_script:
        "The Expanse: Osiris Reborn finally has the thing licensed games usually hide: real gameplay. Xbox showed a narrative sci-fi action game built around The Expanse universe. But the catch is brutal: a famous licence only helps if the game actually feels worth playing. Follow Pulse Gaming so you never miss a beat.",
      suggested_thumbnail_text: "EXPANSE GAMEPLAY",
      source_card_label: "Xbox",
      video_clips: Array.from({ length: 8 }, (_, index) => ({
        id: `official-motion-${index + 1}`,
        rights_risk_class: "official_reference_clip",
        source_url: `https://cdn.example.com/expanse/${index + 1}.mp4`,
      })),
      clean_manual_captions: true,
      subtitle_timing_source: "timestamps",
    },
    directorPlan: {
      shot_plan: shotPlan,
      transition_plan: {
        planned: shotPlan.slice(1).map((shot, index) => ({
          into: shot.id,
          atS: Math.max(0, Number(shot.startS || 0) - 0.04),
          family: ["hard_cut", "speed_ramp", "source_wipe", "whip_pan", "wipe"][index % 5],
        })),
        max_same_transition_run: 1,
        rules: { cards_are_context_only: true, chart_numbers_must_be_large: true },
      },
      sound_transition_plan: {
        sfx: {
          cue_count: 12,
          max_same_family_run: 1,
          cues: [
            { family: "impact", atS: 0 },
            { family: "whoosh", atS: 4.4 },
            { family: "transition_hit", atS: 7 },
            { family: "riser", atS: 35 },
          ],
          mastering: { limiter: true, target_peak_db: -1.5 },
        },
      },
      caption_policy: {
        clean_manual_captions: true,
        subtitle_timing_source: "timestamps",
        max_caption_desync_ms: 100,
      },
      visual_obligations: {
        forbid_text_on_text: true,
        cards_are_context_only: true,
      },
    },
    requireGate: true,
  });

  assert.equal(benchmark.result, "pass");
  assert.ok(benchmark.scores.card_hierarchy_score >= 65);
});

test("media-house benchmark fails amateur technically-valid renders when gate is required", () => {
  const { runMediaHouseBenchmark } = require("../../lib/media-house-benchmark");

  const benchmark = runMediaHouseBenchmark({
    story: {
      id: "weak_render",
      title: "Gaming news update",
      suggested_title: "Gaming news update",
      hook: "Here is what happened in gaming news today.",
      full_script:
        "Here is what happened in gaming news today. The story is developing and more details could arrive soon. Follow Pulse Gaming so you never miss a beat.",
      suggested_thumbnail_text: "THIS GAMING STORY HAS A LOT OF CONTEXT TO EXPLAIN",
      downloaded_images: [{ rights_risk_class: "unknown" }],
      video_clips: [],
      subtitle_timing_source: "synthetic",
    },
    directorPlan: {
      shot_plan: [{ id: "static_card", kind: "card", startS: 0 }],
      transition_plan: { planned: [], max_same_transition_run: 0 },
      sound_transition_plan: { sfx: { cue_count: 0, cues: [], mastering: {} } },
      caption_policy: { snap_to_local_word_timing: false },
    },
    requireGate: true,
  });

  assert.equal(benchmark.result, "fail");
  assert.ok(benchmark.failures.includes("gold_standard:motion_density_below_reference"));
  assert.ok(benchmark.failures.includes("gold_standard:first_3_seconds_hook_below_reference"));
  assert.ok(benchmark.failures.includes("gold_standard:media_house_polish_below_reference"));
  assert.ok(benchmark.scores.stale_wording_risk > 30);
});

test("media-house benchmark fails cue-rich SFX plans without creator-studio source evidence", () => {
  const { runMediaHouseBenchmark } = require("../../lib/media-house-benchmark");

  const benchmark = runMediaHouseBenchmark({
    story: {
      id: "bad_sfx_source",
      title: "Forza Horizon 6 Broke Xbox's Steam Ceiling",
      suggested_title: "Forza Horizon 6 Broke Xbox's Steam Ceiling",
      canonical_subject: "Forza Horizon 6",
      hook: "Forza Horizon 6 just broke the one Xbox ceiling that matters on Steam.",
      full_script:
        "Forza Horizon 6 just broke the one Xbox ceiling that matters on Steam. The Steam number gives Xbox a cleaner PC story before launch.",
      suggested_thumbnail_text: "FORZA BROKE STEAM",
      source_card_label: "Steam",
      video_clips: Array.from({ length: 8 }, (_, index) => ({
        id: `official-motion-${index + 1}`,
        rights_risk_class: "official_reference_clip",
        source_url: `https://cdn.example.com/forza/${index + 1}.mp4`,
      })),
      clean_manual_captions: true,
      subtitle_timing_source: "timestamps",
    },
    directorPlan: {
      shot_plan: strongDirectorPlan().shot_plan,
      transition_plan: strongDirectorPlan().transition_plan,
      sound_transition_plan: {
        sfx: {
          cue_count: 12,
          max_same_family_run: 1,
          cues: [
            { family: "impact", atS: 0 },
            { family: "whoosh", atS: 4.4 },
            { family: "transition_hit", atS: 7 },
            { family: "riser", atS: 35 },
          ],
          source_plan: {
            readiness: {
              status: "blocked",
              blockers: ["sfx_source:local_bespoke_or_generated_only"],
            },
          },
          mastering: { limiter: true, target_peak_db: -1.5 },
        },
      },
      caption_policy: {
        clean_manual_captions: true,
        subtitle_timing_source: "timestamps",
      },
      visual_obligations: {
        forbid_text_on_text: true,
        cards_are_context_only: true,
      },
    },
    requireGate: true,
  });

  assert.equal(benchmark.result, "fail");
  assert.ok(benchmark.failures.includes("gold_standard:sfx_source_quality_below_reference"));
  assert.ok(benchmark.scores.sfx_impact_score < 65);
});

test("media-house benchmark rejects generated-only orange-card motion decks", () => {
  const { runMediaHouseBenchmark } = require("../../lib/media-house-benchmark");

  const clips = Array.from({ length: 8 }, (_, index) => ({
    id: `playstation-owned-motion-${index + 1}`,
    path: `output/generated-motion/playstation/${index + 1}.mp4`,
    source_url: `local://pulse-generated-motion/playstation/${index + 1}`,
    source_type: "internally_generated_motion_graphic",
    rights_risk_class: "owned_generated_motion",
    source_family: `playstation_card_${index + 1}`,
  }));
  const benchmark = runMediaHouseBenchmark({
    story: {
      id: "generated_only_cards",
      canonical_subject: "PlayStation Store",
      title: "PlayStation's Pricing Test Has A Legal Problem",
      suggested_title: "PlayStation's Pricing Test Has A Legal Problem",
      hook: "PlayStation Store dynamic pricing may have a legal problem in Europe.",
      full_script:
        "PlayStation Store dynamic pricing may have a legal problem in Europe. Eurogamer reports the claim, but players need to check the live price before buying.",
      suggested_thumbnail_text: "PS STORE LEGAL RISK",
      source_card_label: "Eurogamer",
      video_clips: clips,
      rights_ledger: clips.map((clip) => ({
        ...clip,
        licence_basis: "owned_generated_editorial_motion_graphic",
      })),
      clean_manual_captions: true,
      subtitle_timing_source: "timestamps",
    },
    directorPlan: strongDirectorPlan(),
    requireGate: true,
  });

  assert.equal(benchmark.result, "fail");
  assert.ok(benchmark.scores.motion_density_score < 75);
  assert.ok(benchmark.scores.media_house_polish_score < 75);
  assert.equal(benchmark.visual_evidence_profile.generated_only_motion_deck, true);
  assert.ok(
    benchmark.failures.includes("gold_standard:visual_evidence:generated_only_motion_deck"),
  );
});
