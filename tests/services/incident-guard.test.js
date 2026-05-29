"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { evaluateIncidentGuard } = require("../../lib/incident-guard");
const { currentRenderPolicyManifest } = require("../../lib/studio/v4/render-policy");

function cleanVisualEvidence(subject = "Mixtape") {
  const scores = {
    motion_density_score: 92,
    first_3_seconds_hook_score: 88,
    source_lock_quality_score: 86,
    caption_legibility_score: 94,
    card_hierarchy_score: 84,
    media_house_polish_score: 90,
  };
  return {
    visual_quality_report: {
      result: "pass",
      scores,
      frame_rules: {
        first_frame_subject: subject,
        first_frame_text: String(subject).split(/\s+/).slice(0, 4).join(" ").toUpperCase(),
        source_locks_readable: true,
        no_empty_rectangles: true,
        no_text_on_text: true,
      },
      failures: [],
    },
    benchmark_report: {
      result: "pass",
      scores,
      failures: [],
    },
  };
}

function cleanSfxEvidence() {
  return {
    cue_count: 8,
    source_plan: {
      readiness: {
        status: "pass",
        blockers: [],
      },
      selected_assets: [
        {
          asset_id: "boom-impact-01",
          role: "impact",
          provider_id: "boom_library",
          rights_basis: "boom_library_media_license",
        },
        {
          asset_id: "soundly-transition-01",
          role: "transition",
          provider_id: "soundly",
          rights_basis: "soundly_pro_commercial_use",
        },
        {
          asset_id: "sonniss-tick-01",
          role: "ui_tick",
          provider_id: "sonniss",
          rights_basis: "sonniss_game_audio_gdc_bundle_license",
        },
      ],
    },
  };
}

test("incident guard blocks placeholder public copy, leaked QA language and non-final render inputs", () => {
  const report = evaluateIncidentGuard({
    story_id: "mixtape-incident",
    canonical_story_manifest: {
      story_id: "mixtape-incident",
      canonical_subject: "Mixtape",
      canonical_game: "Mixtape",
      selected_title: "This gaming story",
      thumbnail_headline: "MIXTAPE WON'T VANISH",
      first_spoken_line: "This gaming story just got a source-backed update.",
      narration_script:
        "This gaming story just got a source-backed update. The useful caveat is that this is one sourced update, not a blank check to invent extra details. Treat the headline as confirmed only where the named source confirms it. Reddit reaction into evidence.",
      description: "Source: r/Games.",
      primary_source: { name: "r/Games", url: "https://reddit.com/r/Games/example" },
      discovery_source: { name: "r/Games", url: "https://reddit.com/r/Games/example" },
      secondary_sources: [{ name: "Rock Paper Shotgun", url: "https://www.rockpapershotgun.com/example" }],
    },
    render_manifest: {
      final_publish_render: false,
      render_lane: "legacy_multi_image",
      render_quality_class: "standard",
      visual_count: 2,
    },
    publish_verdict: { verdict: "AMBER" },
    platform_publish_manifest: {
      publish_status: "AMBER",
      platform_native_evidence: { verdict: "fail", failures: ["blind_duplicate_copy"] },
      outputs: {
        youtube_shorts: { title: "This gaming story" },
      },
    },
    file_evidence: {
      mp4_ready: false,
      captions_ready: false,
      narration_ready: false,
      word_timestamps_ready: false,
      materialised_motion_ready: false,
      distinct_motion_families_ready: false,
    },
  });

  assert.equal(report.safe_to_publish_boolean, false);
  assert.equal(report.verdict, "fail");
  assert.ok(report.disaster_upload_blockers.includes("incident:title_placeholder"));
  assert.ok(report.disaster_upload_blockers.includes("incident:title_missing_canonical_subject"));
  assert.ok(report.disaster_upload_blockers.includes("incident:internal_qa_language"));
  assert.ok(report.disaster_upload_blockers.includes("incident:discovery_source_used_as_primary"));
  assert.ok(report.disaster_upload_blockers.includes("incident:render_lane_legacy_unapproved"));
  assert.ok(report.disaster_upload_blockers.includes("incident:render_not_final_publish_ready"));
  assert.ok(report.disaster_upload_blockers.includes("incident:mp4_missing"));
  assert.ok(report.disaster_upload_blockers.includes("incident:captions_missing_or_dirty"));
  assert.ok(report.disaster_upload_blockers.includes("incident:narration_missing"));
  assert.ok(report.disaster_upload_blockers.includes("incident:word_timestamps_missing"));
  assert.ok(report.disaster_upload_blockers.includes("incident:materialised_motion_missing"));
  assert.ok(report.disaster_upload_blockers.includes("incident:distinct_motion_families_missing"));
  assert.ok(report.disaster_upload_blockers.includes("incident:platform_native_evidence_failed"));
  assert.ok(report.disaster_upload_blockers.includes("incident:control_tower_verdict_not_green"));
});

test("incident guard passes only when public copy, final inputs and platform evidence agree", () => {
  const report = evaluateIncidentGuard({
    story_id: "mixtape-clean",
    canonical_story_manifest: {
      story_id: "mixtape-clean",
      canonical_subject: "Mixtape",
      canonical_game: "Mixtape",
      selected_title: "Mixtape Just Dodged Delisting Trouble",
      thumbnail_headline: "MIXTAPE WON'T VANISH",
      first_spoken_line: "Mixtape just dodged one of gaming's worst preservation problems.",
      narration_script:
        "Mixtape just dodged one of gaming's worst preservation problems. Rock Paper Shotgun reports the team paid extra to keep the licensed soundtrack intact, which means players are not looking at another music-rights delisting scare.",
      description:
        "Mixtape's soundtrack deal lowers the risk of a future music-rights delisting. Source: Rock Paper Shotgun.",
      primary_source: { name: "Rock Paper Shotgun", url: "https://www.rockpapershotgun.com/example" },
      discovery_source: { name: "r/Games", url: "https://reddit.com/r/Games/example" },
      secondary_sources: [],
    },
    render_manifest: {
      final_publish_render: true,
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      visual_count: 8,
    },
    ...cleanVisualEvidence("Mixtape"),
    sfx_manifest: cleanSfxEvidence(),
    publish_verdict: { verdict: "GREEN" },
    platform_publish_manifest: {
      publish_status: "GREEN",
      platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts", "instagram_reels"] },
      outputs: {
        youtube_shorts: { title: "Mixtape Just Dodged Delisting Trouble" },
        instagram_reels: { caption: "Mixtape's soundtrack news matters if you care about game preservation." },
      },
    },
    file_evidence: {
      mp4_ready: true,
      captions_ready: true,
      narration_ready: true,
      word_timestamps_ready: true,
      materialised_motion_ready: true,
      distinct_motion_families_ready: true,
    },
  });

  assert.equal(report.safe_to_publish_boolean, true);
  assert.equal(report.verdict, "pass");
  assert.deepEqual(report.disaster_upload_blockers, []);
});

test("incident guard blocks stale current-news wording on old event dates", () => {
  const report = evaluateIncidentGuard({
    story_id: "crimson-desert-stale-live",
    generated_at: "2026-05-28T12:00:00.000Z",
    canonical_story_manifest: {
      story_id: "crimson-desert-stale-live",
      canonical_subject: "Crimson Desert",
      canonical_game: "Crimson Desert",
      selected_title: "Crimson Desert Is Already Live",
      thumbnail_headline: "CRIMSON DESERT IS ALREADY LIVE",
      first_spoken_line: "Crimson Desert is out now after years of trailer hype.",
      narration_script:
        "Crimson Desert is out now after years of trailer hype. GameSpot reports Crimson Desert launched on March 19, 2026 after Pearl Abyss confirmed the launch timing.",
      description: "Crimson Desert is out now after Pearl Abyss confirmed the launch timing. Source: GameSpot.",
      primary_source: { name: "GameSpot", url: "https://www.gamespot.com/example" },
      discovery_source: { name: "Reddit", url: "https://www.reddit.com/r/Games/example" },
      confirmed_claims: [
        "Crimson Desert launched on March 19, 2026 after Pearl Abyss confirmed the launch timing.",
      ],
    },
    render_manifest: {
      final_publish_render: true,
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      visual_count: 8,
    },
    ...cleanVisualEvidence("Crimson Desert"),
    sfx_manifest: cleanSfxEvidence(),
    publish_verdict: { verdict: "GREEN" },
    platform_publish_manifest: {
      publish_status: "GREEN",
      platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
      outputs: {
        youtube_shorts: { title: "Crimson Desert Is Already Live" },
      },
    },
    file_evidence: {
      mp4_ready: true,
      captions_ready: true,
      narration_ready: true,
      word_timestamps_ready: true,
      materialised_motion_ready: true,
      distinct_motion_families_ready: true,
      rights_ledger_ready: true,
    },
  });

  assert.equal(report.safe_to_publish_boolean, false);
  assert.ok(report.disaster_upload_blockers.includes("incident:stale_temporal_claim"));
  assert.ok(report.disaster_upload_blockers.includes("incident:current_wording_on_old_event"));
  assert.equal(report.evidence.temporal_freshness.oldest_temporal_claim_age_days >= 60, true);
});

test("incident guard blocks stale production renderer policy versions in dry-run and publish gates", () => {
  const report = evaluateIncidentGuard({
    story_id: "stale-render-policy",
    canonical_story_manifest: {
      story_id: "stale-render-policy",
      canonical_subject: "Mixtape",
      canonical_game: "Mixtape",
      selected_title: "Mixtape Just Dodged Delisting Trouble",
      thumbnail_headline: "MIXTAPE WON'T VANISH",
      first_spoken_line: "Mixtape just dodged one of gaming's worst preservation problems.",
      narration_script:
        "Mixtape just dodged one of gaming's worst preservation problems. Rock Paper Shotgun reports the team paid extra to keep the licensed soundtrack intact, which means players are not looking at another music-rights delisting scare.",
      description:
        "Mixtape's soundtrack deal lowers the risk of a future music-rights delisting. Source: Rock Paper Shotgun.",
      primary_source: { name: "Rock Paper Shotgun", url: "https://www.rockpapershotgun.com/example" },
      discovery_source: { name: "r/Games", url: "https://reddit.com/r/Games/example" },
    },
    render_manifest: {
      final_publish_render: true,
      renderer: "visual_v4_production",
      visual_tier: "production_v4_motion",
      sfx_mix_policy_version: "legacy_placeholder_sfx_v1",
      voice_mix_policy_version: "legacy_voice_chain_v1",
      visual_design_policy_version: "legacy_flat_cards_v1",
      render_quality_class: "premium",
      visual_count: 8,
    },
    ...cleanVisualEvidence("Mixtape"),
    sfx_manifest: cleanSfxEvidence(),
    publish_verdict: { verdict: "GREEN" },
    platform_publish_manifest: {
      publish_status: "GREEN",
      platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts", "instagram_reels"] },
      outputs: {
        youtube_shorts: { title: "Mixtape Just Dodged Delisting Trouble" },
      },
    },
    file_evidence: {
      mp4_ready: true,
      captions_ready: true,
      narration_ready: true,
      word_timestamps_ready: true,
      materialised_motion_ready: true,
      distinct_motion_families_ready: true,
      rights_ledger_ready: true,
    },
  });

  assert.equal(report.safe_to_publish_boolean, false);
  assert.ok(report.disaster_upload_blockers.includes("incident:sfx_mix_policy_stale"));
  assert.ok(report.disaster_upload_blockers.includes("incident:voice_mix_policy_stale"));
  assert.ok(report.disaster_upload_blockers.includes("incident:visual_design_policy_stale"));

  const current = evaluateIncidentGuard({
    story_id: "current-render-policy",
    canonical_story_manifest: {
      story_id: "current-render-policy",
      canonical_subject: "Mixtape",
      canonical_game: "Mixtape",
      selected_title: "Mixtape Just Dodged Delisting Trouble",
      thumbnail_headline: "MIXTAPE WON'T VANISH",
      first_spoken_line: "Mixtape just dodged one of gaming's worst preservation problems.",
      narration_script:
        "Mixtape just dodged one of gaming's worst preservation problems. Rock Paper Shotgun reports the team paid extra to keep the licensed soundtrack intact, which means players are not looking at another music-rights delisting scare.",
      description:
        "Mixtape's soundtrack deal lowers the risk of a future music-rights delisting. Source: Rock Paper Shotgun.",
      primary_source: { name: "Rock Paper Shotgun", url: "https://www.rockpapershotgun.com/example" },
      discovery_source: { name: "r/Games", url: "https://reddit.com/r/Games/example" },
    },
    render_manifest: {
      final_publish_render: true,
      renderer: "visual_v4_production",
      visual_tier: "production_v4_motion",
      ...currentRenderPolicyManifest(),
      render_quality_class: "premium",
      visual_count: 8,
    },
    ...cleanVisualEvidence("Mixtape"),
    sfx_manifest: cleanSfxEvidence(),
    publish_verdict: { verdict: "GREEN" },
    platform_publish_manifest: {
      publish_status: "GREEN",
      platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts", "instagram_reels"] },
      outputs: {
        youtube_shorts: { title: "Mixtape Just Dodged Delisting Trouble" },
      },
    },
    file_evidence: {
      mp4_ready: true,
      captions_ready: true,
      narration_ready: true,
      word_timestamps_ready: true,
      materialised_motion_ready: true,
      distinct_motion_families_ready: true,
      rights_ledger_ready: true,
    },
  });
  assert.equal(current.safe_to_publish_boolean, true);
});

test("incident guard blocks final renders when SFX source evidence is unresolved", () => {
  const report = evaluateIncidentGuard({
    story_id: "sfx-unresolved",
    canonical_story_manifest: {
      story_id: "sfx-unresolved",
      canonical_subject: "Helldivers 2",
      selected_title: "Helldivers 2 Won't Get Space Marines",
      thumbnail_headline: "HELLDIVERS 2 ARMOUR CATCH",
      first_spoken_line: "Helldivers 2 players just got the Warhammer answer they were waiting for.",
      narration_script:
        "Helldivers 2 players just got the Warhammer answer they were waiting for. Arrowhead says the crossover gear is not turning into full Space Marines.",
      description: "Arrowhead clarified the Helldivers 2 Warhammer crossover. Source: Arrowhead.",
      primary_source: "Arrowhead",
      discovery_source: "Arrowhead",
    },
    render_manifest: {
      final_publish_render: true,
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      visual_count: 8,
    },
    ...cleanVisualEvidence("Helldivers 2"),
    sfx_manifest: {
      cue_count: 8,
      source_plan: {
        readiness: {
          status: "blocked",
          blockers: ["sfx_source:local_bespoke_or_generated_only"],
        },
      },
    },
    publish_verdict: { verdict: "GREEN" },
    platform_publish_manifest: {
      publish_status: "GREEN",
      platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
      outputs: {
        youtube_shorts: { title: "Helldivers 2 Won't Get Space Marines" },
      },
    },
    file_evidence: {
      mp4_ready: true,
      captions_ready: true,
      narration_ready: true,
      word_timestamps_ready: true,
      materialised_motion_ready: true,
      distinct_motion_families_ready: true,
      rights_ledger_ready: true,
    },
  });

  assert.equal(report.safe_to_publish_boolean, false);
  assert.ok(report.disaster_upload_blockers.includes("incident:sfx_source_quality_unresolved"));
  assert.ok(report.disaster_upload_blockers.includes("sfx_source:local_bespoke_or_generated_only"));
});

test("incident guard blocks environmental SFX assets even when a stale source plan says pass", () => {
  const report = evaluateIncidentGuard({
    story_id: "sfx-wrong-assets",
    canonical_story_manifest: {
      story_id: "sfx-wrong-assets",
      canonical_subject: "Helldivers 2",
      selected_title: "Helldivers 2 Won't Get Space Marines",
      thumbnail_headline: "HELLDIVERS 2 ARMOUR CATCH",
      first_spoken_line: "Helldivers 2 players just got the Warhammer answer they were waiting for.",
      narration_script:
        "Helldivers 2 players just got the Warhammer answer they were waiting for. Arrowhead says the crossover gear is not turning into full Space Marines.",
      description: "Arrowhead clarified the Helldivers 2 Warhammer crossover. Source: Arrowhead.",
      primary_source: "Arrowhead",
      discovery_source: "Arrowhead",
    },
    render_manifest: {
      final_publish_render: true,
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      visual_count: 8,
    },
    ...cleanVisualEvidence("Helldivers 2"),
    sfx_manifest: {
      cue_count: 8,
      source_plan: {
        readiness: { status: "pass", blockers: [] },
        selected_assets: [
          {
            asset_id: "rain-thunder-sub",
            role: "sub_hit",
            provider_id: "sonniss",
            source_url:
              "file://audio/sonniss/GDC2024/Rain Distant Thunder/Rain_Distant_Thunder_Sub_Hit.wav",
            rights_basis: "sonniss_game_audio_gdc_bundle_license",
            approval_status: "approved_for_commercial_editorial_use",
            commercial_use_allowed: true,
          },
          {
            asset_id: "waterfall-impact",
            role: "impact",
            provider_id: "sonniss",
            source_url:
              "file://audio/sonniss/GDC2024/Small Waterfall/WATRFlow_Small_Waterfall_Impact.wav",
            rights_basis: "sonniss_game_audio_gdc_bundle_license",
            approval_status: "approved_for_commercial_editorial_use",
            commercial_use_allowed: true,
          },
        ],
      },
    },
    publish_verdict: { verdict: "GREEN" },
    platform_publish_manifest: {
      publish_status: "GREEN",
      platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
      outputs: {
        youtube_shorts: { title: "Helldivers 2 Won't Get Space Marines" },
      },
    },
    file_evidence: {
      mp4_ready: true,
      captions_ready: true,
      narration_ready: true,
      word_timestamps_ready: true,
      materialised_motion_ready: true,
      distinct_motion_families_ready: true,
      rights_ledger_ready: true,
    },
  });

  assert.equal(report.safe_to_publish_boolean, false);
  assert.ok(report.disaster_upload_blockers.includes("incident:sfx_selected_asset_not_editorial"));
  assert.ok(report.disaster_upload_blockers.includes("sfx_source:rejected_selected_asset:sub_hit"));
  assert.ok(report.disaster_upload_blockers.includes("sfx_source:rejected_selected_asset:impact"));
});

test("incident guard blocks final renders without rights-ledger evidence", () => {
  const report = evaluateIncidentGuard({
    story_id: "rights-missing",
    canonical_story_manifest: {
      story_id: "rights-missing",
      canonical_subject: "Star Fox",
      selected_title: "Star Fox Just Got A Switch 2 Route",
      thumbnail_headline: "STAR FOX SWITCH 2",
      first_spoken_line: "Star Fox just got a Switch 2 route.",
      narration_script:
        "Star Fox just got a Switch 2 route. IGN reports the Nintendo Switch 2 camera deal now matters if you want the Fox McCloud setup.",
      description: "Star Fox has a Switch 2 camera angle. Source: IGN.",
      primary_source: "IGN",
      discovery_source: "IGN",
    },
    render_manifest: {
      final_publish_render: true,
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      visual_count: 8,
    },
    publish_verdict: { verdict: "GREEN" },
    platform_publish_manifest: {
      publish_status: "GREEN",
      platform_native_evidence: { verdict: "pass", platforms: [] },
      outputs: {
        youtube_shorts: { title: "Star Fox Just Got A Switch 2 Route" },
      },
    },
    file_evidence: {
      mp4_ready: true,
      captions_ready: true,
      narration_ready: true,
      word_timestamps_ready: true,
      materialised_motion_ready: true,
      distinct_motion_families_ready: true,
      rights_ledger_ready: false,
    },
  });

  assert.equal(report.safe_to_publish_boolean, false);
  assert.ok(report.disaster_upload_blockers.includes("incident:rights_ledger_missing"));
});

test("incident guard blocks missing first spoken line even when the script starts cleanly", () => {
  const report = evaluateIncidentGuard({
    story_id: "missing-first-spoken-line",
    canonical_story_manifest: {
      story_id: "missing-first-spoken-line",
      canonical_subject: "Metroid Prime 4",
      selected_title: "Metroid Prime 4 Finally Shows The Catch",
      thumbnail_headline: "METROID PRIME 4 CATCH",
      narration_script:
        "Metroid Prime 4 finally shows the catch. Nintendo's latest trailer gives players a clearer look at the new psychic abilities.",
      description: "Nintendo's latest Metroid Prime 4 trailer shows the new psychic abilities. Source: Nintendo.",
      primary_source: "Nintendo",
      discovery_source: "Nintendo",
    },
    render_manifest: {
      final_publish_render: true,
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      visual_count: 8,
    },
    ...cleanVisualEvidence("Metroid Prime 4"),
    sfx_manifest: cleanSfxEvidence(),
    publish_verdict: { verdict: "GREEN" },
    platform_publish_manifest: {
      publish_status: "GREEN",
      platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
      outputs: {
        youtube_shorts: { title: "Metroid Prime 4 Finally Shows The Catch" },
      },
    },
    file_evidence: {
      mp4_ready: true,
      captions_ready: true,
      narration_ready: true,
      word_timestamps_ready: true,
      materialised_motion_ready: true,
      distinct_motion_families_ready: true,
      rights_ledger_ready: true,
    },
  });

  assert.equal(report.safe_to_publish_boolean, false);
  assert.ok(report.disaster_upload_blockers.includes("incident:first_spoken_line_missing"));
});

test("incident guard blocks required platform disclosures that are not applied", () => {
  const report = evaluateIncidentGuard({
    story_id: "missing-platform-disclosure",
    canonical_story_manifest: {
      story_id: "missing-platform-disclosure",
      canonical_subject: "Cyberpunk 2077",
      selected_title: "Cyberpunk 2077 Just Got A New Trailer",
      thumbnail_headline: "CYBERPUNK 2077 TRAILER",
      first_spoken_line: "Cyberpunk 2077 just got a new trailer.",
      narration_script:
        "Cyberpunk 2077 just got a new trailer. CD Projekt Red showed the update and kept the claim to what appears in the official video.",
      description: "CD Projekt Red showed a new Cyberpunk 2077 trailer. Source: CD Projekt Red.",
      primary_source: "CD Projekt Red",
      discovery_source: "CD Projekt Red",
    },
    render_manifest: {
      final_publish_render: true,
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      visual_count: 8,
    },
    ...cleanVisualEvidence("Cyberpunk 2077"),
    sfx_manifest: cleanSfxEvidence(),
    publish_verdict: { verdict: "GREEN" },
    platform_publish_manifest: {
      publish_status: "GREEN",
      platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
      outputs: {
        youtube_shorts: { title: "Cyberpunk 2077 Just Got A New Trailer" },
      },
    },
    platform_policy_report: {
      status: "pass",
      disclosure_requirements: {
        ai_disclosure: true,
      },
      platform_disclosure: {
        youtube: { ai_disclosure: false },
      },
    },
    file_evidence: {
      mp4_ready: true,
      captions_ready: true,
      narration_ready: true,
      word_timestamps_ready: true,
      materialised_motion_ready: true,
      distinct_motion_families_ready: true,
      rights_ledger_ready: true,
    },
  });

  assert.equal(report.safe_to_publish_boolean, false);
  assert.ok(report.disaster_upload_blockers.includes("incident:platform_disclosure_missing"));
});

test("incident guard blocks final renders without post-render visual QA evidence", () => {
  const report = evaluateIncidentGuard({
    story_id: "visual-qa-missing",
    canonical_story_manifest: {
      story_id: "visual-qa-missing",
      canonical_subject: "Warhammer 40,000: Boltgun 2",
      selected_title: "Boltgun 2 Leaves The Corridors",
      thumbnail_headline: "BOLTGUN 2 OUTDOORS",
      first_spoken_line: "Warhammer 40,000: Boltgun 2 is moving its retro FPS chaos into bigger outdoor spaces.",
      narration_script:
        "Warhammer 40,000: Boltgun 2 is moving its retro FPS chaos into bigger outdoor spaces. IGN previewed the sequel and showed how the arenas change the pace.",
      description: "IGN previewed Warhammer 40,000: Boltgun 2 moving into bigger outdoor spaces. Source: IGN.",
      primary_source: "IGN",
      discovery_source: "IGN",
    },
    render_manifest: {
      final_publish_render: true,
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      visual_count: 8,
    },
    publish_verdict: { verdict: "GREEN" },
    platform_publish_manifest: {
      publish_status: "GREEN",
      platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
      outputs: {
        youtube_shorts: { title: "Boltgun 2 Leaves The Corridors" },
      },
    },
    file_evidence: {
      mp4_ready: true,
      captions_ready: true,
      narration_ready: true,
      word_timestamps_ready: true,
      materialised_motion_ready: true,
      distinct_motion_families_ready: true,
      rights_ledger_ready: true,
    },
  });

  assert.equal(report.safe_to_publish_boolean, false);
  assert.ok(report.disaster_upload_blockers.includes("incident:post_render_visual_qa_missing"));
  assert.ok(report.disaster_upload_blockers.includes("incident:benchmark_qa_missing"));
});

test("incident guard blocks weak first-frame and source-lock evidence despite GREEN labels", () => {
  const report = evaluateIncidentGuard({
    story_id: "visual-qa-weak",
    canonical_story_manifest: {
      story_id: "visual-qa-weak",
      canonical_subject: "Warhammer 40,000: Boltgun 2",
      selected_title: "Boltgun 2 Leaves The Corridors",
      thumbnail_headline: "BOLTGUN 2 OUTDOORS",
      first_spoken_line: "Warhammer 40,000: Boltgun 2 is moving its retro FPS chaos into bigger outdoor spaces.",
      narration_script:
        "Warhammer 40,000: Boltgun 2 is moving its retro FPS chaos into bigger outdoor spaces. IGN previewed the sequel and showed how the arenas change the pace.",
      description: "IGN previewed Warhammer 40,000: Boltgun 2 moving into bigger outdoor spaces. Source: IGN.",
      primary_source: "IGN",
      discovery_source: "IGN",
    },
    render_manifest: {
      final_publish_render: true,
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      visual_count: 8,
    },
    visual_quality_report: {
      result: "pass",
      scores: {
        motion_density_score: 61,
        first_3_seconds_hook_score: 58,
        source_lock_quality_score: 42,
        caption_legibility_score: 64,
        card_hierarchy_score: 51,
        media_house_polish_score: 57,
      },
      frame_rules: {
        first_frame_subject: "Warhammer 40,000: Boltgun 2",
        first_frame_text: "BOLTGUN 2 OUTDOORS",
        source_locks_readable: false,
      },
      failures: [],
    },
    benchmark_report: {
      result: "pass",
      scores: {
        motion_density_score: 61,
        first_3_seconds_hook_score: 58,
        source_lock_quality_score: 42,
        caption_legibility_score: 64,
        card_hierarchy_score: 51,
        media_house_polish_score: 57,
      },
      failures: [],
    },
    publish_verdict: { verdict: "GREEN" },
    platform_publish_manifest: {
      publish_status: "GREEN",
      platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
      outputs: {
        youtube_shorts: { title: "Boltgun 2 Leaves The Corridors" },
      },
    },
    file_evidence: {
      mp4_ready: true,
      captions_ready: true,
      narration_ready: true,
      word_timestamps_ready: true,
      materialised_motion_ready: true,
      distinct_motion_families_ready: true,
      rights_ledger_ready: true,
    },
  });

  assert.equal(report.safe_to_publish_boolean, false);
  assert.ok(report.disaster_upload_blockers.includes("incident:motion_density_too_low"));
  assert.ok(report.disaster_upload_blockers.includes("incident:first_frame_weak"));
  assert.ok(report.disaster_upload_blockers.includes("incident:source_lock_unreadable"));
  assert.ok(report.disaster_upload_blockers.includes("incident:captions_unreadable"));
  assert.ok(report.disaster_upload_blockers.includes("incident:text_hierarchy_weak"));
  assert.ok(report.disaster_upload_blockers.includes("incident:below_benchmark_polish"));
});

test("incident guard blocks public copy that names a different reporting source than the primary source", () => {
  const report = evaluateIncidentGuard({
    story_id: "dawn-of-war-source-mismatch",
    canonical_story_manifest: {
      story_id: "dawn-of-war-source-mismatch",
      canonical_subject: "Dawn of War 4",
      selected_title: "Dawn Of War 4 Finally Shows Gameplay",
      thumbnail_headline: "DAWN OF WAR GAMEPLAY",
      first_spoken_line: "Dawn of War 4 finally shows gameplay.",
      narration_script:
        "Dawn of War 4 finally shows gameplay. IGN says the new Warhammer reveal has a clearer look at combat and factions.",
      description: "IGN says Dawn of War 4 now has gameplay footage. Source: GameSpot.",
      primary_source: "GameSpot",
      discovery_source: "GameSpot",
      secondary_sources: [],
    },
    render_manifest: {
      final_publish_render: true,
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      visual_count: 8,
    },
    publish_verdict: { verdict: "GREEN" },
    platform_publish_manifest: {
      publish_status: "GREEN",
      platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
      outputs: {
        youtube_shorts: { description: "IGN says Dawn of War 4 now has gameplay footage. Source: GameSpot." },
      },
    },
    file_evidence: {
      mp4_ready: true,
      captions_ready: true,
      narration_ready: true,
      word_timestamps_ready: true,
      materialised_motion_ready: true,
      distinct_motion_families_ready: true,
      rights_ledger_ready: true,
    },
  });

  assert.equal(report.safe_to_publish_boolean, false);
  assert.ok(report.disaster_upload_blockers.includes("incident:source_label_mismatch"));
});

test("incident guard blocks Boltgun incident copy and leaked derivative placeholders", () => {
  const report = evaluateIncidentGuard({
    story_id: "boltgun-incident",
    canonical_story_manifest: {
      story_id: "boltgun-incident",
      canonical_subject: "Warhammer 40,000: Boltgun 2",
      canonical_game: "Warhammer 40,000: Boltgun 2",
      selected_title: "Boltgun 2 Already Feels Loud",
      thumbnail_headline: "BOLTGUN 2 ALREADY FEELS LOUD",
      first_spoken_line:
        "Warhammer 40,000: Boltgun 2 already feels loud in its new demo.",
      narration_script:
        "Warhammer 40,000: Boltgun 2 already feels loud in its new demo. IGN reports Warhammer 40,000 Boltgun 2 takes the ultraviolent '90s FPS to the great outdoors. The player angle is simple: check the price, access or platform details before you decide what to play next.",
      description:
        "Warhammer 40,000: Boltgun 2 already feels loud in its new demo. Source: IGN.",
      primary_source: "IGN",
      discovery_source: "IGN",
    },
    render_manifest: {
      final_publish_render: true,
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      visual_count: 8,
    },
    publish_verdict: { verdict: "GREEN" },
    platform_publish_manifest: {
      publish_status: "GREEN",
      platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts", "x"] },
      outputs: {
        youtube_shorts: {
          title: "Boltgun 2 Already Feels Loud",
          description:
            "Warhammer 40,000: Boltgun 2: source_locked_update. Source: IGN.",
        },
        x: {
          hot_take_post:
            "Warhammer 40,000: Boltgun 2 is the part of this story everyone will argue about: source_locked_update.",
        },
      },
    },
    file_evidence: {
      mp4_ready: true,
      captions_ready: true,
      narration_ready: true,
      word_timestamps_ready: true,
      materialised_motion_ready: true,
      distinct_motion_families_ready: true,
      rights_ledger_ready: true,
    },
  });

  assert.equal(report.safe_to_publish_boolean, false);
  assert.ok(report.disaster_upload_blockers.includes("public_copy:weak_title_pattern"));
  assert.ok(report.disaster_upload_blockers.includes("public_copy:lazy_player_angle_sentence"));
  assert.ok(report.disaster_upload_blockers.includes("incident:internal_qa_language"));
});

test("incident guard blocks deal-led public copy without commercial disclosure evidence", () => {
  const report = evaluateIncidentGuard({
    story_id: "switch-power-bank-deal",
    canonical_story_manifest: {
      story_id: "switch-power-bank-deal",
      canonical_subject: "Nintendo Switch 2",
      selected_title: "Nintendo Switch 2 Just Got More Expensive",
      thumbnail_headline: "SWITCH 2 PRICE JUMP",
      first_spoken_line: "Nintendo Switch 2 owners just got a cheaper battery option to check before launch.",
      narration_script:
        "Nintendo Switch 2 owners just got a cheaper battery option to check before launch. IGN says an Iniu power bank is 45% off at Best Buy for $17.",
      description:
        "This Iniu 20,000 Power Bank quadruples your Nintendo Switch 2 play time for $17. Source: IGN.",
      primary_source: "IGN",
      discovery_source: "IGN",
    },
    render_manifest: {
      final_publish_render: true,
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      visual_count: 8,
    },
    publish_verdict: { verdict: "GREEN" },
    platform_publish_manifest: {
      publish_status: "GREEN",
      platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
      outputs: {
        youtube_shorts: { title: "Nintendo Switch 2 Just Got More Expensive" },
      },
    },
    platform_policy_report: {
      disclosure_requirements: { affiliate: false },
    },
    affiliate_link_manifest: {
      disclosure_required: false,
    },
    file_evidence: {
      mp4_ready: true,
      captions_ready: true,
      narration_ready: true,
      word_timestamps_ready: true,
      materialised_motion_ready: true,
      distinct_motion_families_ready: true,
      rights_ledger_ready: true,
    },
  });

  assert.equal(report.safe_to_publish_boolean, false);
  assert.ok(report.disaster_upload_blockers.includes("incident:commercial_deal_disclosure_missing"));
});

test("incident guard blocks confirmed-claim memo language before scheduler action generation", () => {
  const report = evaluateIncidentGuard({
    story_id: "hades-confirmed-claim-memo",
    canonical_story_manifest: {
      story_id: "hades-confirmed-claim-memo",
      canonical_subject: "Hades II",
      selected_title: "Hades II Just Broke PlayStation's Silence",
      thumbnail_headline: "HADES II PLAYSTATION",
      first_spoken_line: "Hades II just broke PlayStation's silence.",
      narration_script:
        "Hades II just broke PlayStation's silence. Xbox showed the latest trailer. The confirmed claim is simple: Hades II is coming to Xbox and PlayStation.",
      description: "Xbox showed the latest Hades II trailer. Source: Xbox.",
      primary_source: "Xbox",
      discovery_source: "Xbox",
    },
    render_manifest: {
      final_publish_render: true,
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      visual_count: 8,
    },
    ...cleanVisualEvidence("Hades II"),
    sfx_manifest: cleanSfxEvidence(),
    publish_verdict: { verdict: "GREEN" },
    platform_publish_manifest: {
      publish_status: "GREEN",
      platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
      outputs: {
        youtube_shorts: { title: "Hades II Just Broke PlayStation's Silence" },
      },
    },
    file_evidence: {
      mp4_ready: true,
      captions_ready: true,
      narration_ready: true,
      word_timestamps_ready: true,
      materialised_motion_ready: true,
      distinct_motion_families_ready: true,
      rights_ledger_ready: true,
    },
  });

  assert.equal(report.safe_to_publish_boolean, false);
  assert.ok(report.disaster_upload_blockers.includes("incident:internal_qa_language"));
  assert.ok(report.disaster_upload_blockers.includes("public_copy:formulaic_public_narration"));
});

test("incident guard blocks stale TTS script fields even when narration_script was repaired", () => {
  const report = evaluateIncidentGuard({
    story_id: "hades-stale-tts-script",
    canonical_story_manifest: {
      story_id: "hades-stale-tts-script",
      canonical_subject: "Hades II",
      selected_title: "Hades II Just Broke PlayStation's Silence",
      thumbnail_headline: "HADES II PLAYSTATION",
      first_spoken_line: "Hades II just broke PlayStation's silence.",
      narration_script:
        "Hades II just broke PlayStation's silence. Xbox showed the latest trailer. Follow Pulse Gaming for the gaming stories behind the headline.",
      full_script:
        "Hades II just broke PlayStation's silence. Xbox showed the latest trailer. The confirmed claim is simple: Hades II is coming to Xbox and PlayStation.",
      tts_script:
        "Hades II just broke PlayStation's silence. Xbox showed the latest trailer. The confirmed claim is simple: Hades II is coming to Xbox and PlayStation.",
      description: "Xbox showed the latest Hades II trailer. Source: Xbox.",
      primary_source: "Xbox",
      discovery_source: "Xbox",
    },
    render_manifest: {
      final_publish_render: true,
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      visual_count: 8,
    },
    ...cleanVisualEvidence("Hades II"),
    sfx_manifest: cleanSfxEvidence(),
    publish_verdict: { verdict: "GREEN" },
    platform_publish_manifest: {
      publish_status: "GREEN",
      platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
      outputs: {
        youtube_shorts: { title: "Hades II Just Broke PlayStation's Silence" },
      },
    },
    file_evidence: {
      mp4_ready: true,
      captions_ready: true,
      narration_ready: true,
      word_timestamps_ready: true,
      materialised_motion_ready: true,
      distinct_motion_families_ready: true,
      rights_ledger_ready: true,
    },
  });

  assert.equal(report.safe_to_publish_boolean, false);
  assert.ok(report.disaster_upload_blockers.includes("incident:internal_qa_language"));
  assert.ok(report.disaster_upload_blockers.includes("public_copy:tts_script_diverges_from_narration"));
});

test("incident guard blocks affiliate candidate links without disclosure copy", () => {
  const report = evaluateIncidentGuard({
    story_id: "affiliate-candidate-without-disclosure",
    canonical_story_manifest: {
      story_id: "affiliate-candidate-without-disclosure",
      canonical_subject: "Destiny 2",
      selected_title: "Destiny 2 Is Getting Its Final Update",
      thumbnail_headline: "DESTINY 2 FINAL UPDATE",
      first_spoken_line: "Destiny 2 is getting its final update.",
      narration_script:
        "Destiny 2 is getting its final update. Bungie says the next content drop changes how long the game keeps moving.",
      description: "Destiny 2 is getting its final update. Source: Bungie.",
      primary_source: "Bungie",
      discovery_source: "Bungie",
    },
    render_manifest: {
      final_publish_render: true,
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      visual_count: 8,
    },
    publish_verdict: { verdict: "GREEN" },
    platform_publish_manifest: {
      publish_status: "GREEN",
      platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
      outputs: {
        youtube_shorts: { title: "Destiny 2 Is Getting Its Final Update" },
      },
    },
    affiliate_link_manifest: {
      disclosure_required: false,
      candidate_links: [
        {
          id: "game-pass-card",
          url: "https://www.amazon.co.uk/s?k=game+pass&tag=pulsegaming-21",
          rejection_reasons: [],
        },
      ],
    },
    file_evidence: {
      mp4_ready: true,
      captions_ready: true,
      narration_ready: true,
      word_timestamps_ready: true,
      materialised_motion_ready: true,
      distinct_motion_families_ready: true,
      rights_ledger_ready: true,
    },
  });

  assert.equal(report.safe_to_publish_boolean, false);
  assert.ok(report.disaster_upload_blockers.includes("incident:affiliate_disclosure_missing"));
});

test("incident guard blocks sale/deal stories even when the public copy avoids affiliate wording", () => {
  const report = evaluateIncidentGuard({
    story_id: "gamesir-g7-pro-deal",
    canonical_story_manifest: {
      story_id: "gamesir-g7-pro-deal",
      canonical_subject: "GameSir G7 Pro",
      selected_title: "GameSir G7 Pro Deal Has One Catch",
      thumbnail_headline: "GAMESIR G7 DEAL",
      first_spoken_line: "GameSir G7 Pro just became a better controller deal for PC players.",
      narration_script:
        "GameSir G7 Pro just became a better controller deal for PC players. IGN says the controller is on sale for Memorial Day, but the catch is whether it fits your setup.",
      description:
        "The Gamesir G7 Pro is on sale for Memorial Day. Source: IGN.",
      primary_source: "IGN",
      discovery_source: "IGN",
    },
    render_manifest: {
      final_publish_render: true,
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      visual_count: 8,
    },
    publish_verdict: { verdict: "GREEN" },
    platform_publish_manifest: {
      publish_status: "GREEN",
      platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
      outputs: {
        youtube_shorts: { title: "GameSir G7 Pro Deal Has One Catch" },
      },
    },
    file_evidence: {
      mp4_ready: true,
      captions_ready: true,
      narration_ready: true,
      word_timestamps_ready: true,
      materialised_motion_ready: true,
      distinct_motion_families_ready: true,
      rights_ledger_ready: true,
    },
  });

  assert.equal(report.safe_to_publish_boolean, false);
  assert.ok(report.disaster_upload_blockers.includes("incident:commercial_deal_disclosure_missing"));
});

test("incident guard does not allow commercial editorial context to replace disclosure copy", () => {
  const report = evaluateIncidentGuard({
    story_id: "commercial-context-without-disclosure",
    canonical_story_manifest: {
      story_id: "commercial-context-without-disclosure",
      canonical_subject: "Xbox Controller",
      selected_title: "Xbox Controller Deal Has One Catch",
      thumbnail_headline: "XBOX CONTROLLER DEAL",
      first_spoken_line: "Xbox Controller buyers just got a cheaper option to check.",
      narration_script:
        "Xbox Controller buyers just got a cheaper option to check. IGN says the controller deal is on sale this week, but the catch is whether it fits your setup.",
      description: "The Xbox Controller deal is on sale this week. Source: IGN.",
      primary_source: "IGN",
      discovery_source: "IGN",
    },
    render_manifest: {
      final_publish_render: true,
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      visual_count: 8,
    },
    publish_verdict: { verdict: "GREEN" },
    platform_publish_manifest: {
      publish_status: "GREEN",
      platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
      outputs: {
        youtube_shorts: { title: "Xbox Controller Deal Has One Catch" },
      },
    },
    platform_policy_report: {
      commercial_editorial_context: true,
      disclosure_requirements: { commercial: true },
    },
    affiliate_link_manifest: {
      commercial_editorial_context: true,
      disclosure_required: false,
    },
    file_evidence: {
      mp4_ready: true,
      captions_ready: true,
      narration_ready: true,
      word_timestamps_ready: true,
      materialised_motion_ready: true,
      distinct_motion_families_ready: true,
      rights_ledger_ready: true,
    },
  });

  assert.equal(report.safe_to_publish_boolean, false);
  assert.ok(report.disaster_upload_blockers.includes("incident:commercial_deal_disclosure_missing"));
});

test("incident guard does not require commercial disclosure for non-affiliate price news", () => {
  const report = evaluateIncidentGuard({
    story_id: "playstation-plus-price-rise",
    canonical_story_manifest: {
      story_id: "playstation-plus-price-rise",
      canonical_subject: "PlayStation Plus",
      selected_title: "PlayStation Plus Just Got More Expensive",
      thumbnail_headline: "PLAYSTATION PLUS PRICE RISE",
      first_spoken_line: "PlayStation Plus just got more expensive for new subscribers.",
      narration_script:
        "PlayStation Plus just got more expensive for new subscribers. Sony says the change applies from the next billing window, so the useful part is checking your current plan before renewal.",
      description:
        "Sony says PlayStation Plus pricing is changing for new subscribers. Source: PlayStation Blog.",
      primary_source: "PlayStation Blog",
      discovery_source: "PlayStation Blog",
    },
    render_manifest: {
      final_publish_render: true,
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      visual_count: 8,
    },
    ...cleanVisualEvidence("PlayStation Plus"),
    sfx_manifest: cleanSfxEvidence(),
    publish_verdict: { verdict: "GREEN" },
    platform_publish_manifest: {
      publish_status: "GREEN",
      platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
      outputs: {
        youtube_shorts: { title: "PlayStation Plus Just Got More Expensive" },
      },
    },
    file_evidence: {
      mp4_ready: true,
      captions_ready: true,
      narration_ready: true,
      word_timestamps_ready: true,
      materialised_motion_ready: true,
      distinct_motion_families_ready: true,
      rights_ledger_ready: true,
    },
  });

  assert.equal(report.safe_to_publish_boolean, true);
  assert.doesNotMatch(report.disaster_upload_blockers.join(","), /commercial_deal_disclosure_missing/);
});

test("incident guard does not treat a reported subscription price as an affiliate deal", () => {
  const report = evaluateIncidentGuard({
    story_id: "playstation-plus-price-currency",
    canonical_story_manifest: {
      story_id: "playstation-plus-price-currency",
      canonical_subject: "PlayStation Plus",
      selected_title: "PlayStation Plus Just Got More Expensive",
      thumbnail_headline: "PLAYSTATION PLUS PRICE RISE",
      first_spoken_line: "PlayStation Plus now costs more for new subscribers.",
      narration_script:
        "PlayStation Plus now costs more for new subscribers. Sony says the Essential tier moves to £15.99 a month in the UK, which means the story is a price-rise warning, not a shopping recommendation.",
      description:
        "Sony says PlayStation Plus Essential is moving to £15.99 a month in the UK. Source: PlayStation Blog.",
      primary_source: "PlayStation Blog",
      discovery_source: "PlayStation Blog",
    },
    render_manifest: {
      final_publish_render: true,
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      visual_count: 8,
    },
    ...cleanVisualEvidence("PlayStation Plus"),
    sfx_manifest: cleanSfxEvidence(),
    publish_verdict: { verdict: "GREEN" },
    platform_publish_manifest: {
      publish_status: "GREEN",
      platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
      outputs: {
        youtube_shorts: { title: "PlayStation Plus Just Got More Expensive" },
      },
    },
    file_evidence: {
      mp4_ready: true,
      captions_ready: true,
      narration_ready: true,
      word_timestamps_ready: true,
      materialised_motion_ready: true,
      distinct_motion_families_ready: true,
      rights_ledger_ready: true,
    },
  });

  assert.equal(report.safe_to_publish_boolean, true);
  assert.doesNotMatch(report.disaster_upload_blockers.join(","), /commercial_deal_disclosure_missing/);
});

test("incident guard does not treat platform duration target metadata as a retail deal", () => {
  const report = evaluateIncidentGuard({
    story_id: "destiny-final-update",
    canonical_story_manifest: {
      story_id: "destiny-final-update",
      canonical_subject: "Destiny 2",
      selected_title: "Destiny 2 Is Getting Its Final Update",
      thumbnail_headline: "DESTINY 2 FINAL UPDATE",
      first_spoken_line: "Destiny 2 is now heading towards its final live-service update.",
      narration_script:
        "Destiny 2 is now heading towards its final live-service update. IGN reports Bungie is shifting focus after the next content drop.",
      description: "Bungie is ending regular Destiny 2 live-service updates in June. Source: IGN.",
      primary_source: "IGN",
      discovery_source: "IGN",
    },
    render_manifest: {
      final_publish_render: true,
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      visual_count: 8,
    },
    ...cleanVisualEvidence("Destiny 2"),
    sfx_manifest: cleanSfxEvidence(),
    publish_verdict: { verdict: "GREEN" },
    platform_publish_manifest: {
      publish_status: "GREEN",
      platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
      outputs: {
        youtube_shorts: {
          duration_strategy: "normal_production_safe_script_expansion",
          duration_basis: "hard window is upload eligibility; target window is the current retention repair creative target",
        },
      },
    },
    file_evidence: {
      mp4_ready: true,
      captions_ready: true,
      narration_ready: true,
      word_timestamps_ready: true,
      materialised_motion_ready: true,
      distinct_motion_families_ready: true,
      rights_ledger_ready: true,
    },
  });

  assert.equal(report.safe_to_publish_boolean, true);
  assert.doesNotMatch(report.disaster_upload_blockers.join(","), /commercial_deal_disclosure_missing/);
});
