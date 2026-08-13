"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildPulseMediaHouseScore,
  _private,
} = require("../../lib/pulse-media-house-score");

function strongStory(overrides = {}) {
  const canonical = {
    selected_title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
    canonical_subject: "Forza Horizon 6",
    first_spoken_line: "Forza Horizon 6 just broke the one Xbox ceiling that matters on Steam.",
    narration_script:
      "Forza Horizon 6 just broke the one Xbox ceiling that matters on Steam. Steam interest gives Xbox a cleaner PC story before launch. The payoff is simple: Game Pass messaging now has to compete with where PC players are already paying attention. Follow Pulse Gaming so you never miss a beat.",
  };
  const director = {
    shot_plan: [
      { id: "hook", kind: "hook_slam", startS: 0, durationS: 1.4 },
      { id: "proof", kind: "motion_clip", startS: 0.3, durationS: 2.7, source_family: "official_a" },
      { id: "source", kind: "source_lock", startS: 2.6, durationS: 1.6 },
    ],
    transition_plan: { planned: [{ family: "impact_cut" }, { family: "source_wipe" }], max_same_family_run: 1 },
    sound_transition_plan: {
      sfx: {
        cue_count: 7,
        max_same_family_run: 1,
        cues: [{ family: "impact", atS: 0 }, { family: "whoosh", atS: 0.4 }],
        mastering: { duck_under_narration: true, narration_priority: true },
      },
    },
    caption_policy: { clean_manual_captions: true, avoid_lower_third_collisions: true },
  };
  return {
    canonical,
    scriptScorecard: { verdict: "viral_ready", viral_score: 88, blockers: [] },
    visualQuality: {
      result: "pass",
      scores: {
        motion_density_score: 91,
        first_3_seconds_hook_score: 89,
        source_lock_quality_score: 86,
        caption_legibility_score: 90,
        card_hierarchy_score: 82,
        transition_energy_score: 87,
        sfx_impact_score: 84,
        rights_risk_score: 95,
        media_house_polish_score: 90,
      },
      visual_evidence_profile: {
        generated_only_motion_deck: false,
        motion_asset_count: 9,
        real_media_family_count: 5,
        blockers: [],
      },
      failures: [],
    },
    director,
    audio: {
      voice_status: "materialized",
      word_timestamp_count: 120,
      mix_rules: { narration_priority: true, duck_under_narration: true, limiter: true },
    },
    loudness: { verdict: "pass", metrics: { valid_segment_count: 4, max_peak_db: -1.2, mean_range_db: 2 } },
    affiliate: {
      commercial_intent_type: "story_relevant_game_page",
      disclosure_required: true,
      disclosure_copy: { short: "Affiliate links may earn us a commission." },
      primary_link: { story_relevance: 88, merchant: "Steam", url: "https://store.steampowered.com/app/example" },
    },
    platformManifest: {
      outputs: {
        youtube_shorts: {
          title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
          description:
            "Forza Horizon 6 just turned Xbox's PC pitch into a Steam audience test before launch. Players now get to judge whether the next racer can grow beyond Game Pass. Source: Eurogamer.",
          cover_frame: { headline: "STEAM CEILING BROKEN" },
        },
        tiktok: {
          caption:
            "Forza Horizon 6 just turned Xbox's PC pitch into a Steam audience test before launch. Players now get to judge whether the next racer can grow beyond Game Pass. Source: Eurogamer.",
        },
      },
    },
    renderManifest: {
      final_publish_render: true,
      output_path: "C:\\media\\forza-horizon-6-final.mp4",
      file_size_bytes: 18000000,
    },
    captionQa: {
      status: "pass",
      display_text: canonical.narration_script,
    },
    materialisedMotionClips: {
      status: "ready",
      clips: Array.from({ length: 5 }, (_, index) => ({
        id: `forza-motion-${index + 1}`,
        path: `C:\\media\\forza-motion-${index + 1}.mp4`,
        source_family: `official_forza_family_${index + 1}`,
        media_kind: "direct_video",
        counts_towards_motion_readiness: true,
      })),
      distinct_motion_families: Array.from(
        { length: 5 },
        (_, index) => `official_forza_family_${index + 1}`,
      ),
    },
    uniqueness: { verdict: "pass", failures: [] },
    benchmark: { result: "pass", failures: [] },
    ...overrides,
  };
}

test("strong Pulse-original package passes competitor-informed score", () => {
  const report = buildPulseMediaHouseScore(strongStory());
  assert.equal(report.verdict, "GREEN");
  assert.ok(report.scores.overall_media_house_score >= 85);
  assert.ok(report.scores.competitor_parity_score >= 80);
  assert.ok(report.scores.competitor_surpass_score >= 75);
  assert.ok(report.scores.source_lock_score >= 80);
  assert.equal(report.source_lock_report.status, "pass");
  assert.equal(report.professional_source_diversity_report.policy_tier, "normal_strict_green");
  assert.equal(report.professional_source_diversity_report.status, "not_required");
  assert.equal(report.production_grammar_alignment_report.status, "pass");
  assert.deepEqual(report.hard_failures, []);
});

test("approved YouTube descriptions are judged on editorial copy rather than retained credit administration", () => {
  const approvedDescription = [
    "Half-Life 2 RTX makes Ravenholm and Nova Prospekt look spectacular, but this demo carries hefty PC requirements. First-time players should start with Valve's release before returning for the lighting showcase.",
    "Source: Digital Foundry (muted comparison excerpt)",
    "https://www.youtube.com/watch?v=QHRS0TO89UI",
    "Footage: NVIDIA GeForce (muted RTX ON/OFF excerpt)",
    "https://www.youtube.com/watch?v=j31ISEd8xRM",
    "Music: Carbon by Truvio via Epidemic Sound.",
  ].join("\n\n");

  assert.equal(
    _private.platformCopyTooPlain({
      outputs: {
        youtube_shorts: {
          description: approvedDescription,
        },
      },
    }),
    false,
  );
});

test("media-house score fails closed when exact final inputs are abstract despite unused real-media inventory", () => {
  const base = strongStory();
  const ownedClips = Array.from({ length: 3 }, (_, index) => ({
    asset_id: `xbox-owned-motion-${index + 1}`,
    path: `C:\\media\\owned-motion-${index + 1}.mp4`,
    source_url: `local://pulse-generated-motion/xbox/${index + 1}`,
    source_type: "internally_generated_motion_graphic",
    media_kind: "owned_explainer_motion",
    licence_basis: "owned_generated_editorial_motion_graphic",
    source_family: `owned_motion_${index + 1}`,
  }));
  const unusedOfficialClips = Array.from({ length: 5 }, (_, index) => ({
    asset_id: `xbox-official-${index + 1}`,
    path: `C:\\media\\xbox-official-${index + 1}.mp4`,
    source_url: `https://cdn.xbox.com/games/xbox-official-${index + 1}.mp4`,
    source_type: "official_platform_product_page",
    media_kind: "direct_video",
    subject_match_quality: "exact_platform_match",
    exact_subject_group: "xbox",
    source_family: `xbox_official_${index + 1}`,
  }));
  const report = buildPulseMediaHouseScore(strongStory({
    canonical: {
      ...base.canonical,
      canonical_subject: "Xbox",
      canonical_game: "Xbox",
      selected_title: "4 Xbox Classics Hit PC, Achievements Come Later",
      first_spoken_line: "Four original Xbox games just crossed onto PC.",
      narration_script:
        "Four original Xbox games just crossed onto PC. Xbox Wire confirms the games and the ownership carry-over. Follow Pulse Gaming so you never miss a beat.",
    },
    renderManifest: {
      ...base.renderManifest,
      selected_input_assets: {
        schema_version: 2,
        authoritative: true,
        complete: true,
        asset_count: ownedClips.length,
        assets: ownedClips.map((clip) => ({
          asset_id: clip.asset_id,
          kind: "video",
          path: clip.path,
          source_url: clip.source_url,
        })),
        blockers: [],
      },
    },
    materialisedMotionClips: {
      status: "ready",
      clips: [...ownedClips, ...unusedOfficialClips],
      distinct_motion_families: [
        ...ownedClips,
        ...unusedOfficialClips,
      ].map((clip) => clip.source_family),
    },
  }));

  assert.equal(report.verdict, "RED");
  assert.equal(
    report.selected_render_visual_evidence_profile.evidence_scope,
    "authoritative_final_render_selection",
  );
  assert.equal(
    report.selected_render_visual_evidence_profile.subject_matched_editorial_media_count,
    0,
  );
  assert.ok(
    report.hard_failures.includes(
      "media_house:subject_matched_editorial_media_missing",
    ),
  );
});

test("media-house score accepts exact selected subject-matched editorial media", () => {
  const base = strongStory();
  const officialClips = Array.from({ length: 5 }, (_, index) => ({
    asset_id: `forza-official-${index + 1}`,
    path: `C:\\media\\forza-official-${index + 1}.mp4`,
    source_url: `https://cdn.xbox.com/games/forza-horizon-6/clip-${index + 1}.mp4`,
    source_type: "official_platform_product_page",
    media_kind: "direct_video",
    subject_match_quality: "exact_game_match",
    exact_subject_group: "forza horizon 6",
    source_family: `forza_official_${index + 1}`,
    counts_towards_motion_readiness: true,
  }));
  const report = buildPulseMediaHouseScore(strongStory({
    renderManifest: {
      ...base.renderManifest,
      selected_input_assets: {
        schema_version: 2,
        authoritative: true,
        complete: true,
        asset_count: officialClips.length,
        assets: officialClips.map((clip) => ({
          asset_id: clip.asset_id,
          kind: "video",
          path: clip.path,
          source_url: clip.source_url,
        })),
        blockers: [],
      },
    },
    materialisedMotionClips: {
      status: "ready",
      clips: officialClips,
      distinct_motion_families: officialClips.map((clip) => clip.source_family),
    },
  }));

  assert.equal(report.verdict, "GREEN");
  assert.equal(
    report.selected_render_visual_evidence_profile.subject_matched_editorial_media_count,
    5,
  );
  assert.ok(
    !report.hard_failures.includes(
      "media_house:subject_matched_editorial_media_missing",
    ),
  );
});

test("ultimate professional source diversity fails closed without authoritative provenance", () => {
  const report = buildPulseMediaHouseScore(strongStory({
    source_diversity_tier: "ultimate_professional",
  }));

  assert.equal(report.verdict, "RED");
  assert.equal(report.professional_source_diversity_report.policy_tier, "ultimate_professional");
  assert.equal(report.professional_source_diversity_report.status, "blocked");
  assert.ok(
    report.professional_source_diversity_report.blockers.includes(
      "professional_source_diversity_evidence_missing",
    ),
  );
  assert.ok(report.hard_failures.includes("media_house:professional_source_diversity_not_verified"));
});

test("ultimate professional source diversity accepts complete authoritative base identities", () => {
  const report = buildPulseMediaHouseScore(strongStory({
    source_diversity_tier: "ultimate_professional",
    professional_source_diversity: {
      policy_tier: "ultimate_professional",
      authoritative: true,
      status: "GREEN",
      required_genuine_base_source_count: 2,
      observed_genuine_base_source_count: 2,
      unresolved_clips: [],
      ambiguous_base_sources: [],
      blockers: [],
      base_sources: [
        {
          base_source_asset_id: "official-trailer-master",
          base_source_identity_basis: "master_sha256",
          master_sha256: "a".repeat(64),
        },
        {
          base_source_asset_id: "official-gameplay-master",
          base_source_identity_basis: "sampled_visual_fingerprint",
          sampled_visual_fingerprint: "b".repeat(64),
        },
      ],
    },
  }));

  assert.equal(report.professional_source_diversity_report.status, "pass");
  assert.equal(report.professional_source_diversity_report.complete_identity_record_count, 2);
  assert.equal(
    report.hard_failures.includes("media_house:professional_source_diversity_not_verified"),
    false,
  );
  assert.equal(report.verdict, "GREEN");
});

test("ultimate professional source diversity accepts producer-style SHA identities", () => {
  const firstHash = "1".repeat(64);
  const secondHash = "2".repeat(64);
  const report = buildPulseMediaHouseScore(strongStory({
    source_diversity_tier: "ultimate_professional",
    professional_source_diversity: {
      policy_tier: "ultimate_professional",
      authoritative: true,
      status: "pass",
      required_genuine_base_source_count: 2,
      observed_genuine_base_source_count: 2,
      unresolved_clips: [],
      blockers: [],
      identity_evidence: [
        {
          base_source_asset_id: `sha256:${firstHash}`,
          base_source_identity_basis: "master_sha256",
          identity_evidence: [
            { kind: "master_sha256", alias: `sha256:${firstHash}` },
          ],
        },
        {
          base_source_asset_id: `sha256:${secondHash}`,
          base_source_identity_basis: "master_sha256",
          identity_evidence: [
            { kind: "master_sha256", alias: `sha256:${secondHash}` },
          ],
        },
      ],
    },
  }));

  assert.equal(report.professional_source_diversity_report.status, "pass");
  assert.equal(report.professional_source_diversity_report.complete_identity_record_count, 2);
  assert.equal(report.professional_source_diversity_report.distinct_verified_base_identity_count, 2);
  assert.equal(report.verdict, "GREEN");
});

test("ultimate professional source diversity accepts producer-style sampled fingerprints", () => {
  const firstFingerprint = Array.from({ length: 5 }, (_, index) =>
    (index + 1).toString(16).repeat(16),
  ).join(":");
  const secondFingerprint = Array.from({ length: 5 }, (_, index) =>
    (index + 9).toString(16).repeat(16),
  ).join(":");
  const report = buildPulseMediaHouseScore(strongStory({
    source_diversity_tier: "ultimate_professional",
    professional_source_diversity: {
      policy_tier: "ultimate_professional",
      authoritative: true,
      status: "pass",
      required_genuine_base_source_count: 2,
      observed_genuine_base_source_count: 2,
      unresolved_clips: [],
      blockers: [],
      identity_evidence: [firstFingerprint, secondFingerprint].map((fingerprint) => ({
        base_source_asset_id: `fingerprint:${fingerprint}`,
        base_source_identity_basis: "sampled_visual_fingerprint",
        identity_evidence: [
          { kind: "sampled_visual_fingerprint", alias: `fingerprint:${fingerprint}` },
        ],
      })),
    },
  }));

  assert.equal(report.professional_source_diversity_report.status, "pass");
  assert.equal(report.professional_source_diversity_report.complete_identity_record_count, 2);
  assert.equal(report.professional_source_diversity_report.distinct_verified_base_identity_count, 2);
  assert.equal(report.verdict, "GREEN");
});

test("ultimate professional source diversity rejects ambiguous family-only identities", () => {
  const report = buildPulseMediaHouseScore(strongStory({
    source_diversity_tier: "ultimate_professional",
    professional_source_diversity: {
      policy_tier: "ultimate_professional",
      authoritative: true,
      status: "GREEN",
      required_genuine_base_source_count: 2,
      observed_genuine_base_source_count: 2,
      unresolved_clips: [],
      blockers: [],
      base_sources: [
        {
          base_source_asset_id: "window-family-a",
          base_source_identity_basis: "source_family",
          canonical_source_url: "https://example.com/trailer.mp4",
        },
        {
          base_source_asset_id: "window-family-b",
          base_source_identity_basis: "derivative_path",
          master_sha256: "c".repeat(64),
        },
      ],
    },
  }));

  assert.equal(report.verdict, "RED");
  assert.equal(report.professional_source_diversity_report.status, "blocked");
  assert.ok(
    report.professional_source_diversity_report.blockers.includes(
      "professional_source_diversity_provenance_incomplete",
    ),
  );
});

test("ultimate professional source diversity rejects renamed rows with one master identity", () => {
  const sharedMaster = "f".repeat(64);
  const report = buildPulseMediaHouseScore(strongStory({
    source_diversity_tier: "ultimate_professional",
    professional_source_diversity: {
      policy_tier: "ultimate_professional",
      authoritative: true,
      status: "GREEN",
      required_genuine_base_source_count: 2,
      observed_genuine_base_source_count: 2,
      unresolved_clips: [],
      blockers: [],
      base_sources: [
        {
          base_source_asset_id: "trailer-upload-a",
          base_source_identity_basis: "master_sha256",
          master_sha256: sharedMaster,
        },
        {
          base_source_asset_id: "trailer-mirror-b",
          base_source_identity_basis: "master_sha256",
          master_sha256: sharedMaster,
        },
      ],
    },
  }));

  assert.equal(report.verdict, "RED");
  assert.ok(
    report.professional_source_diversity_report.blockers.includes(
      "professional_source_diversity_duplicate_base_identities",
    ),
  );
});

test("ultimate professional source diversity rejects URL-only base identities", () => {
  const report = buildPulseMediaHouseScore(strongStory({
    source_diversity_tier: "ultimate_professional",
    professional_source_diversity: {
      policy_tier: "ultimate_professional",
      authoritative: true,
      status: "GREEN",
      required_genuine_base_source_count: 2,
      observed_genuine_base_source_count: 2,
      unresolved_clips: [],
      blockers: [],
      base_sources: [
        {
          base_source_asset_id: "upload-a",
          base_source_identity_basis: "canonical_source_url",
          canonical_source_url: "https://example.com/upload-a.mp4",
        },
        {
          base_source_asset_id: "upload-b",
          base_source_identity_basis: "canonical_source_url",
          canonical_source_url: "https://mirror.example.com/upload-b.mp4",
        },
      ],
    },
  }));

  assert.equal(report.verdict, "RED");
  assert.ok(
    report.professional_source_diversity_report.blockers.includes(
      "professional_source_diversity_provenance_incomplete",
    ),
  );
});

test("authoritative professional-tier evidence cannot be downgraded by a normal caller tier", () => {
  const report = buildPulseMediaHouseScore(strongStory({
    source_diversity_tier: "normal_strict_green",
    professional_source_diversity: {
      policy_tier: "ultimate_professional",
      authoritative: false,
      status: "AMBER",
    },
  }));

  assert.equal(report.professional_source_diversity_report.policy_tier, "ultimate_professional");
  assert.equal(report.professional_source_diversity_report.status, "blocked");
  assert.equal(report.verdict, "RED");
});

test("normal tier still preserves a present authoritative diversity RED", () => {
  const report = buildPulseMediaHouseScore(strongStory({
    source_diversity_tier: "normal_strict_green",
    professional_source_diversity: {
      policy_tier: "normal_strict_green",
      authoritative: true,
      status: "RED",
      blockers: ["genuine_base_source_minimum_not_met"],
    },
  }));

  assert.equal(report.professional_source_diversity_report.policy_tier, "normal_strict_green");
  assert.equal(report.professional_source_diversity_report.status, "blocked");
  assert.ok(
    report.professional_source_diversity_report.blockers.includes(
      "genuine_base_source_minimum_not_met",
    ),
  );
  assert.equal(report.verdict, "RED");
});

test("vivid transformations, superlatives and comparisons clear Shorts attention gates", () => {
  const cases = [
    {
      subject: "The Mound: Omen of Cthulhu",
      title: "The Mound Makes Your Own Co-op Team The Threat",
      cover: "YOUR TEAM IS LYING",
      description:
        "The Mound launches with a madness system that makes co-op players doubt what they see and hear. That turns voice chat into the scariest threat. Source: Xbox Wire.",
    },
    {
      subject: "Paleo Pines",
      title: "Paleo Pines Just Ended Its Worst Dinosaur Grind",
      cover: "RARE DINO, GUARANTEED",
      description:
        "Paleo Pines' free Players' Choice update removes some of its most frustrating grind. The new skin tracker can guarantee a chosen dinosaur colour and pattern when the tracked rarity next appears. Source: Paleo Pines.",
    },
    {
      subject: "Fogpiercer",
      title: "Fogpiercer Turns Your Train Into A Deck Of Cards",
      cover: "YOUR TRAIN IS THE DECK",
      description:
        "Fogpiercer launches on Game Pass on July 17. Its train is more than transport: the carriages you assemble determine your starting deck before each tactical run. Sources: Xbox Wire and the official Steam page.",
    },
  ];

  for (const item of cases) {
    const base = strongStory();
    const report = buildPulseMediaHouseScore(strongStory({
      canonical: {
        ...base.canonical,
        selected_title: item.title,
        public_title: item.title,
        canonical_subject: item.subject,
        first_spoken_line: item.title,
        thumbnail_headline: item.cover,
        first_frame_text: item.cover,
      },
      platformManifest: {
        outputs: {
          youtube_shorts: {
            title: item.title,
            description: item.description,
            cover_frame: { headline: item.cover },
          },
          instagram_reels: {
            title: item.title,
            caption: item.description,
            cover_frame: { headline: item.cover },
          },
          facebook_reels: {
            title: item.title,
            page_caption: item.description,
            cover_frame: { headline: item.cover },
          },
        },
      },
    }));

    assert.equal(report.hard_failures.includes("media_house:title_lacks_curiosity_gap"), false);
    assert.equal(report.hard_failures.includes("media_house:platform_title_too_plain"), false);
    assert.equal(report.hard_failures.includes("media_house:platform_copy_too_plain"), false);
    assert.equal(report.hard_failures.includes("media_house:shorts_feed_competition_weak"), false);
    assert.notEqual(report.shorts_feed_competition_report.status, "blocked");
  }
});

test("media-house score treats GTA VI as Grand Theft Auto VI subject parity", () => {
  const report = buildPulseMediaHouseScore(strongStory({
    canonical: {
      ...strongStory().canonical,
      selected_title: "GTA VI Cover Art Starts The Pre-Order Fight",
      public_title: "GTA VI Cover Art Starts The Pre-Order Fight",
      canonical_subject: "Grand Theft Auto VI",
      canonical_game: "Grand Theft Auto VI",
      first_spoken_line: "GTA VI just made the buying argument real.",
      narration_script:
        "GTA VI just made the buying argument real. Rockstar says pre-orders open on June 25. The payoff is simple: players finally get to argue about price, editions and whether locking in early is smart. Follow Pulse Gaming so you never miss a beat.",
      thumbnail_headline: "GTA VI PREORDER TEST",
      first_frame_text: "GTA VI PREORDER TEST",
    },
    platformManifest: {
      outputs: {
        youtube_shorts: {
          title: "GTA VI Cover Art Starts The Pre-Order Fight",
          description:
            "GTA VI just turned cover art into a real pre-order debate: price, editions and whether buying early is smart. Source: Rockstar Newswire.",
          cover_frame: { headline: "GTA VI PREORDER TEST" },
        },
        instagram_reels: {
          caption:
            "GTA VI just turned cover art into a real pre-order debate. Source: Rockstar Newswire.",
          cover_frame: { headline: "GTA VI PREORDER TEST" },
        },
      },
    },
  }));

  assert.equal(report.hard_failures.includes("media_house:source_title_mismatch"), false);
  assert.equal(report.hard_failures.includes("media_house:platform_title_too_plain"), false);
  assert.equal(report.shorts_feed_competition_report.signals.title_has_subject, true);
});

test("fresh direct-motion family proof cannot launder a genuine base-source blocker", () => {
  for (const blocker of [
    "distinct_motion_source_assets_minimum_not_met",
    "genuine_base_source_minimum_not_met",
  ]) {
    const report = buildPulseMediaHouseScore(strongStory({
      footageEmpireV2: {
        verdict: "v4_motion_blocked",
        blockers: [blocker],
      },
      distinctMotionFamily: {
        status: "ready",
        summary: {
          clip_count: 8,
          distinct_motion_family_count: 8,
          direct_video_motion_family_count: 8,
          minimum_required_distinct_motion_families: 4,
        },
      },
    }));

    assert.equal(report.verdict, "RED");
    assert.equal(report.source_lock_report.status, "blocked");
    assert.ok(report.source_lock_report.blockers.includes(blocker));
    assert.ok(report.hard_failures.includes("media_house:source_lock_not_verified"));
  }
});

test("materialised direct-motion windows cannot override a genuine base-source blocker", () => {
  const clips = Array.from({ length: 8 }, (_, index) => ({
    id: `clip-${index + 1}`,
    path: `C:\\media\\gta-vi-${index + 1}.mp4`,
    source_family: `rockstar_gta_vi_official_${index + 1}`,
    motion_family: `rockstar_gta_vi_official_${index + 1}`,
    source_url: `https://media.rockstargames.com/VI/trailer-${index + 1}.mp4`,
    media_kind: "direct_video",
    validated: true,
    counts_towards_motion_readiness: true,
  }));
  const report = buildPulseMediaHouseScore(strongStory({
    footageEmpireV2: {
      verdict: "v4_motion_blocked",
      readiness: {
        status: "v4_motion_blocked",
        blockers: ["distinct_motion_source_assets_minimum_not_met"],
      },
      blockers: ["distinct_motion_source_assets_minimum_not_met"],
    },
    materialisedMotionClips: {
      status: "ready",
      clip_count: clips.length,
      distinct_motion_family_count: clips.length,
      distinct_motion_families: clips.map((clip) => clip.source_family),
      clips,
      materialised_clips: clips,
    },
  }));

  assert.equal(report.source_lock_report.status, "blocked");
  assert.equal(report.source_lock_report.evidence.distinct_motion_family_count, 8);
  assert.equal(report.source_lock_report.evidence.direct_video_motion_family_count, 8);
  assert.ok(report.source_lock_report.blockers.includes("distinct_motion_source_assets_minimum_not_met"));
  assert.ok(report.hard_failures.includes("media_house:source_lock_not_verified"));
});

test("generic title fails", () => {
  const report = buildPulseMediaHouseScore(strongStory({
    canonical: { ...strongStory().canonical, selected_title: "Gaming news update" },
  }));
  assert.equal(report.verdict, "RED");
  assert.ok(report.hard_failures.includes("media_house:generic_title"));
});

test("template social titles fail even when they contain a named platform", () => {
  for (const selectedTitle of [
    "PlayStation Just Got A New Signal",
    "This Game Now Has A Real Question",
    "Pragmata's development team included group Is Worth Watching Again",
  ]) {
    const report = buildPulseMediaHouseScore(strongStory({
      canonical: { ...strongStory().canonical, selected_title: selectedTitle },
    }));
    assert.equal(report.verdict, "RED", selectedTitle);
    assert.ok(report.hard_failures.includes("media_house:generic_title"), selectedTitle);
  }
});

test("weak hook fails", () => {
  const base = strongStory();
  const report = buildPulseMediaHouseScore(strongStory({
    canonical: {
      ...base.canonical,
      first_spoken_line: "Here is what happened in gaming news today.",
      narration_script: "Here is what happened in gaming news today. Forza Horizon 6 has some context.",
    },
  }));
  assert.equal(report.verdict, "RED");
  assert.ok(report.hard_failures.includes("media_house:first_3_seconds_weak"));
});

test("plain platform descriptions fail the media-house gate", () => {
  const report = buildPulseMediaHouseScore(strongStory({
    platformManifest: {
      outputs: {
        youtube_shorts: {
          title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
          description: "Forza Horizon 6: Confirmed Drop. Source: PC Gamer. Sources and related links: /p/forza",
          cover_frame: { headline: "STEAM CEILING BROKEN" },
        },
        instagram_reels: {
          caption: "Forza Horizon 6: Confirmed Drop. Full source list is on the story page.",
        },
      },
    },
  }));

  assert.equal(report.verdict, "RED");
  assert.ok(report.hard_failures.includes("media_house:platform_copy_too_plain"));
});

test("generic platform descriptions fail even without source-admin boilerplate", () => {
  const report = buildPulseMediaHouseScore(strongStory({
    platformManifest: {
      outputs: {
        youtube_shorts: {
          title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
          description:
            "Forza Horizon 6 has a new trailer and fans are talking about the game this week.",
          cover_frame: { headline: "STEAM CEILING BROKEN" },
        },
      },
    },
  }));

  assert.equal(report.verdict, "RED");
  assert.ok(report.hard_failures.includes("media_house:platform_copy_too_plain"));
  assert.equal(report.shorts_attention_report.status, "blocked");
});

test("platform descriptions fail when a stale demo template contradicts the current story angle", () => {
  const base = strongStory();
  const report = buildPulseMediaHouseScore(strongStory({
    canonical: {
      ...base.canonical,
      canonical_subject: "MARVEL Tokon",
      selected_title: "MARVEL Tokon Turns Its Roster Into A Meta Fight",
      first_spoken_line: "MARVEL Tokon has 20 playable fighters.",
      narration_script:
        "MARVEL Tokon has 20 playable fighters. Four-versus-four teams make readable swaps the launch test. The roster sells the fantasy, but clear team fights will sell the game. Follow Pulse Gaming so you never miss a beat.",
    },
    platformManifest: {
      outputs: {
        youtube_shorts: {
          title: "MARVEL Tokon Turns Its Roster Into A Meta Fight",
          description:
            "MARVEL Tokon has one proof point players can judge immediately: the demo. It can win wishlists fast or expose the problem before launch. Source: PlayStation Blog.",
          cover_frame: { headline: "MARVEL'S 4V4 META FIGHT" },
        },
      },
    },
  }));

  assert.equal(report.verdict, "RED");
  assert.ok(
    report.hard_failures.includes("media_house:platform_copy_story_angle_mismatch"),
    report.hard_failures.join(", "),
  );
});

test("plain Shorts titles fail even when source and subject are present", () => {
  const report = buildPulseMediaHouseScore(strongStory({
    canonical: {
      ...strongStory().canonical,
      selected_title: "Forza Horizon 6 Scores 84 On PC Gamer",
    },
    platformManifest: {
      outputs: {
        youtube_shorts: {
          title: "Forza Horizon 6 Scores 84 On PC Gamer",
          description:
            "Forza Horizon 6 now has a review score players will use in the Xbox argument before launch.",
          cover_frame: { headline: "FORZA REVIEW SCORE" },
        },
      },
    },
  }));

  assert.equal(report.verdict, "RED");
  assert.ok(report.hard_failures.includes("media_house:title_lacks_curiosity_gap"));
  assert.ok(report.hard_failures.includes("media_house:platform_title_too_plain"));
  assert.equal(report.shorts_attention_report.status, "blocked");
});

test("stakes-led Shorts titles and covers pass the attention gate", () => {
  const report = buildPulseMediaHouseScore(strongStory({
    canonical: {
      ...strongStory().canonical,
      selected_title: "Gears E-Day Has A 130GB Problem",
      canonical_subject: "Gears of War: E-Day",
      first_spoken_line: "Gears of War E-Day just turned storage into part of the launch pitch.",
      thumbnail_headline: "GEARS E-DAY 130GB TEST",
    },
    platformManifest: {
      outputs: {
        youtube_shorts: {
          title: "Gears E-Day Has A 130GB Problem",
          description:
            "Gears of War E-Day just turned a 130 GB install into the first real PC launch question.",
          cover_frame: { headline: "GEARS E-DAY 130GB TEST" },
        },
      },
    },
  }));

  assert.equal(report.shorts_attention_report.status, "pass");
  assert.ok(!report.hard_failures.includes("media_house:title_lacks_curiosity_gap"));
  assert.ok(!report.hard_failures.includes("media_house:platform_title_too_plain"));
});

test("comeback-led Game Pass stories pass the attention gate", () => {
  const report = buildPulseMediaHouseScore(strongStory({
    canonical: {
      ...strongStory().canonical,
      selected_title: "Palworld 1.0 Makes Game Pass The Comeback Button",
      canonical_subject: "Palworld 1.0",
      first_spoken_line: "Palworld 1.0 just got the cleanest comeback button Xbox can give it.",
      thumbnail_headline: "PALWORLD COMEBACK BUTTON",
      narration_script:
        "Palworld 1.0 just got the cleanest comeback button Xbox can give it. Game Pass gives lapsed players a low-friction route back in before the full launch verdict lands. If it works, Palworld gets a second wave. Follow Pulse Gaming so you never miss a beat.",
    },
    platformManifest: {
      outputs: {
        youtube_shorts: {
          title: "Palworld 1.0 Makes Game Pass The Comeback Button",
          description:
            "Palworld 1.0 just got the cleanest comeback button Xbox can give it. Game Pass gives lapsed players a low-friction route back in, but the full launch now has to prove the loop feels better. Source: Xbox Wire.",
          cover_frame: { headline: "PALWORLD COMEBACK BUTTON" },
        },
      },
    },
  }));

  assert.equal(report.shorts_attention_report.status, "pass");
  assert.ok(!report.hard_failures.includes("media_house:title_lacks_curiosity_gap"));
  assert.ok(!report.hard_failures.includes("media_house:platform_title_too_plain"));
  assert.ok(!report.hard_failures.includes("media_house:first_frame_or_thumbnail_not_attention_led"));
});

test("feed-stop Shorts descriptions with concrete viewer stakes pass the attention gate", () => {
  for (const story of [
    {
      title: "Steam Next Fest Turns Demos Into A Trust Fight",
      subject: "Steam Next Fest",
      firstLine: "Steam Next Fest is the moment a PC game stops hiding behind trailers.",
      description:
        "Steam Next Fest is turning demos into a public trust test for PC games. The best trailer may get attention, but the demo players remember is the one that wins the week. Source: Steam.",
      cover: "STEAM DEMO FIGHT",
    },
    {
      title: "Gears E-Day Has A 130GB Problem",
      subject: "Gears of War: E-Day",
      firstLine: "Gears of War E-Day just turned PC specs into the story.",
      description:
        "Gears of War: E-Day is asking players for 130 GB before the campaign even starts. That turns storage into part of the launch pitch. Source: PC Gamer.",
      cover: "GEARS E-DAY 130GB TEST",
    },
    {
      title: "Granblue Fantasy: Relink Demo Is The Real Proof",
      subject: "Granblue Fantasy: Relink",
      firstLine: "Granblue Fantasy: Relink has one proof point players can judge immediately: the demo.",
      description:
        "Granblue Fantasy: Relink has one proof point players can judge immediately: the demo. It can win wishlists fast or expose the problem before launch. Source: PlayStation Blog.",
      cover: "RELINK PLAYABLE DEMO",
    },
    {
      title: "Ghost at Dawn Has A Jump-Scare Risk",
      subject: "Ghost at Dawn",
      firstLine: "Ghost at Dawn is selling horror without leaning on jump scares.",
      description:
        "Ghost at Dawn is selling horror without leaning on jump scares. Players have to judge whether the choices feel personal, because atmosphere matters more than monsters here. Source: Xbox Wire.",
      cover: "GHOST AT DAWN JUMP SCARE RISK",
    },
  ]) {
    const report = buildPulseMediaHouseScore(strongStory({
      canonical: {
        ...strongStory().canonical,
        selected_title: story.title,
        canonical_subject: story.subject,
        first_spoken_line: story.firstLine,
        thumbnail_headline: story.cover,
      },
      platformManifest: {
        outputs: {
          youtube_shorts: {
            title: story.title,
            description: story.description,
            cover_frame: { headline: story.cover },
          },
        },
      },
    }));

    assert.equal(report.shorts_attention_report.status, "pass", story.title);
    assert.ok(!report.hard_failures.includes("media_house:platform_copy_too_plain"), story.title);
    assert.ok(!report.hard_failures.includes("media_house:first_frame_or_thumbnail_not_attention_led"), story.title);
  }
});

test("standout Shorts packaging records a feed-competition report", () => {
  const report = buildPulseMediaHouseScore(strongStory({
    canonical: {
      ...strongStory().canonical,
      selected_title: "Gears E-Day Has A 130GB Problem",
      canonical_subject: "Gears of War: E-Day",
      first_spoken_line: "Gears of War E-Day just turned PC specs into the story.",
      thumbnail_headline: "GEARS E-DAY 130GB TEST",
    },
    platformManifest: {
      outputs: {
        youtube_shorts: {
          title: "Gears E-Day Has A 130GB Problem",
          description:
            "Gears of War: E-Day is asking players for 130 GB before the campaign even starts. That turns storage into part of the launch pitch. Source: PC Gamer.",
          cover_frame: { headline: "GEARS E-DAY 130GB TEST" },
        },
        instagram_reels: {
          caption:
            "Gears of War: E-Day is asking players for 130 GB before the campaign even starts. That turns storage into part of the launch pitch. Source: PC Gamer.",
          cover_frame: { headline: "GEARS E-DAY 130GB TEST" },
        },
      },
    },
  }));

  assert.equal(report.shorts_feed_competition_report.status, "standout");
  assert.ok(report.shorts_feed_competition_report.score >= 82);
  assert.deepEqual(report.shorts_feed_competition_report.blockers, []);
  assert.ok(!report.hard_failures.includes("media_house:shorts_feed_competition_weak"));
});

test("tracked primary affiliate route inherits trustworthy fallback relevance metadata", () => {
  const report = buildPulseMediaHouseScore(strongStory({
    canonical: {
      ...strongStory().canonical,
      selected_title: "Forza Horizon 6 Just Gave Xbox A Scoreboard Win",
      canonical_subject: "Forza Horizon 6",
      first_spoken_line: "Forza Horizon 6 just gave Xbox a scoreboard win before launch.",
      thumbnail_headline: "XBOX SCOREBOARD WIN",
    },
    platformManifest: {
      outputs: {
        youtube_shorts: {
          title: "Forza Horizon 6 Just Gave Xbox A Scoreboard Win",
          description:
            "Forza Horizon 6 is leading Metacritic's 2026 list, but the useful question is whether that score changes the full-price decision. Source: Metacritic.",
          cover_frame: { headline: "XBOX SCOREBOARD WIN" },
        },
        instagram_reels: {
          title: "Forza Horizon 6 Just Gave Xbox A Scoreboard Win",
          caption:
            "Forza Horizon 6 is leading Metacritic's 2026 list, but the useful question is whether that score changes the full-price decision. Source: Metacritic.",
          cover_frame: { headline: "XBOX SCOREBOARD WIN" },
        },
      },
    },
    affiliate: {
      disclosure_required: true,
      disclosure_copy: { short: "Affiliate links may earn us a commission." },
      primary_link: {
        label: "Racing wheel",
        tracking_url: "/go/forza/racing-wheel",
      },
      fallback_links: [
        {
          label: "Racing wheel",
          story_relevance: 86,
          audience_fit: 86,
          merchant_trust: 84,
          tracking_url: "/go/forza/racing-wheel",
        },
      ],
    },
  }));

  assert.ok(!report.hard_failures.includes("media_house:commercial_route_not_trustworthy"));
});

test("attention reports use current platform-native copy when canonical copy is stale", () => {
  const report = buildPulseMediaHouseScore(strongStory({
    canonical: {
      ...strongStory().canonical,
      selected_title: "Granblue Fantasy: Relink Demo Is The Real Proof",
      canonical_subject: "Granblue Fantasy: Relink",
      first_spoken_line: "Granblue Fantasy Relink just gave players proof most updates never give them.",
      thumbnail_headline: "RELINK PLAYABLE DEMO",
    },
    platformManifest: {
      outputs: {
        youtube_shorts: {
          title: "Granblue Relink Demo Has A Reinstall Catch",
          description:
            "Granblue Fantasy: Relink has a playable Endless Ragnarok demo, not just another trailer. The catch is whether lapsed players feel enough combat snap to reinstall before losing another weekend. Source: PlayStation Blog.",
          cover_frame: { headline: "RELINK REINSTALL CATCH" },
        },
        instagram_reels: {
          title: "Granblue Relink Demo Has A Reinstall Catch",
          caption:
            "Granblue Fantasy: Relink has a playable Endless Ragnarok demo, not just another trailer. The catch is whether lapsed players feel enough combat snap to reinstall before losing another weekend. Source: PlayStation Blog.",
          cover_frame: { headline: "RELINK REINSTALL CATCH" },
        },
      },
    },
  }));

  assert.equal(report.shorts_attention_report.title, "Granblue Relink Demo Has A Reinstall Catch");
  assert.deepEqual(report.shorts_attention_report.platform_titles, ["Granblue Relink Demo Has A Reinstall Catch"]);
  assert.deepEqual(report.shorts_attention_report.first_frame_or_thumbnail_copy, ["RELINK REINSTALL CATCH"]);
  assert.equal(report.shorts_feed_competition_report.title, "Granblue Relink Demo Has A Reinstall Catch");
  assert.deepEqual(report.shorts_feed_competition_report.first_frame_or_thumbnail_copy, ["RELINK REINSTALL CATCH"]);
  assert.equal(report.shorts_feed_competition_report.status, "standout");
});

test("Custom Seas packaging counts as concrete feed detail instead of abstract player-test copy", () => {
  const report = buildPulseMediaHouseScore(strongStory({
    canonical: {
      ...strongStory().canonical,
      selected_title: "Sea of Thieves Custom Seas Could Split Crews",
      canonical_subject: "Sea of Thieves",
      first_spoken_line: "Sea of Thieves just made its biggest social gamble in years.",
      thumbnail_headline: "CUSTOM SEAS RISK",
    },
    platformManifest: {
      outputs: {
        youtube_shorts: {
          title: "Sea of Thieves Custom Seas Could Split Crews",
          description:
            "Sea of Thieves is adding Custom Seas, a private mode where players can set their own rules. That helps events and training, but it could drain the public seas that make the game dangerous. Source: Xbox Wire.",
          cover_frame: { headline: "CUSTOM SEAS RISK" },
        },
        instagram_reels: {
          title: "Sea of Thieves Custom Seas Could Split Crews",
          caption:
            "Sea of Thieves is adding Custom Seas, a private mode where players can set their own rules. That helps events and training, but it could drain the public seas that make the game dangerous. Source: Xbox Wire.",
          cover_frame: { headline: "CUSTOM SEAS RISK" },
        },
      },
    },
  }));

  assert.equal(report.shorts_attention_report.title, "Sea of Thieves Custom Seas Could Split Crews");
  assert.deepEqual(report.shorts_feed_competition_report.first_frame_or_thumbnail_copy, ["CUSTOM SEAS RISK"]);
  assert.equal(report.shorts_feed_competition_report.status, "standout");
  assert.ok(!report.hard_failures.includes("media_house:first_frame_or_thumbnail_not_attention_led"));
  assert.ok(!report.hard_failures.includes("media_house:shorts_feed_competition_weak"));
});

test("template-fatigue Shorts packaging fails the feed-competition gate", () => {
  const report = buildPulseMediaHouseScore(strongStory({
    canonical: {
      ...strongStory().canonical,
      selected_title: "Halo Campaign Evolved Has One Player Trust Test",
      canonical_subject: "Halo Campaign Evolved",
      first_spoken_line: "Halo Campaign Evolved now has something players can judge before launch.",
      thumbnail_headline: "HALO PLAYER TEST",
    },
    platformManifest: {
      outputs: {
        youtube_shorts: {
          title: "Halo Campaign Evolved Has One Player Trust Test",
          description:
            "Halo Campaign Evolved has one player trust test before launch. Players get to judge whether the remake changes what Xbox can sell next. Source: Xbox Wire.",
          cover_frame: { headline: "HALO PLAYER TEST" },
        },
        instagram_reels: {
          caption:
            "Halo Campaign Evolved has one player trust test before launch. Players get to judge whether the remake changes what Xbox can sell next. Source: Xbox Wire.",
          cover_frame: { headline: "HALO PLAYER TEST" },
        },
      },
    },
  }));

  assert.equal(report.verdict, "RED");
  assert.equal(report.shorts_feed_competition_report.status, "blocked");
  assert.ok(report.shorts_feed_competition_report.blockers.includes("feed_title_template_fatigue"));
  assert.ok(report.shorts_feed_competition_report.blockers.includes("feed_cover_too_abstract"));
  assert.ok(report.hard_failures.includes("media_house:shorts_feed_competition_weak"));
});

test("game sequel numbers do not rescue trust-template Shorts packaging", () => {
  const report = buildPulseMediaHouseScore(strongStory({
    canonical: {
      ...strongStory().canonical,
      selected_title: "Guild Wars 3 Has A Player Trust Test",
      canonical_subject: "Guild Wars 3",
      first_spoken_line: "Guild Wars 3 has one new detail players are watching.",
      thumbnail_headline: "GUILD WARS 3 TRUST PROBLEM",
    },
    platformManifest: {
      outputs: {
        youtube_shorts: {
          title: "Guild Wars 3 Has A Player Trust Test",
          description:
            "Guild Wars 3 has a real source detail, but not enough practical consequence for a strong Pulse short yet. Source: PC Gamer.",
          cover_frame: { headline: "GUILD WARS 3 TRUST PROBLEM" },
        },
        instagram_reels: {
          caption:
            "Guild Wars 3 has a real source detail, but not enough practical consequence for a strong Pulse short yet. Source: PC Gamer.",
          cover_frame: { headline: "GUILD WARS 3 TRUST PROBLEM" },
        },
      },
    },
  }));

  assert.equal(report.verdict, "RED");
  assert.equal(report.shorts_feed_competition_report.status, "blocked");
  assert.ok(report.shorts_feed_competition_report.blockers.includes("feed_title_template_fatigue"));
  assert.ok(report.shorts_feed_competition_report.blockers.includes("feed_cover_too_abstract"));
  assert.ok(report.hard_failures.includes("media_house:platform_copy_too_plain"));
  assert.ok(report.hard_failures.includes("media_house:first_frame_or_thumbnail_not_attention_led"));
  assert.ok(report.hard_failures.includes("media_house:shorts_feed_competition_weak"));
});

test("proof-card thumbnail text fails when it lacks instant viewer stakes", () => {
  const report = buildPulseMediaHouseScore(strongStory({
    canonical: {
      ...strongStory().canonical,
      selected_title: "Steam Next Fest Turns Demos Into A Trust Fight",
      canonical_subject: "Steam Next Fest",
      first_spoken_line: "Steam Next Fest is the moment a PC game stops hiding behind trailers.",
      thumbnail_headline: "STEAM NEXT FEST TRUST TEST",
    },
    platformManifest: {
      outputs: {
        youtube_shorts: {
          title: "Steam Next Fest Turns Demos Into A Trust Fight",
          description:
            "Steam Next Fest is turning demos into a public trust test for PC games. The best trailer may get attention, but the demo players remember is the one that wins the week. Source: Steam.",
          cover_frame: { headline: "STEAM NEXT FEST TRUST TEST" },
        },
      },
    },
  }));

  assert.equal(report.verdict, "RED");
  assert.ok(report.hard_failures.includes("media_house:first_frame_or_thumbnail_not_attention_led"));
  assert.equal(report.shorts_attention_report.status, "blocked");
});

test("valid but mild platform descriptions fail when they lack a viewer stake", () => {
  const report = buildPulseMediaHouseScore(strongStory({
    platformManifest: {
      outputs: {
        youtube_shorts: {
          title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
          description:
            "Forza Horizon 6 has a useful source-backed update. The useful question is what it means for players next. Source: Eurogamer.",
          cover_frame: { headline: "STEAM CEILING BROKEN" },
        },
      },
    },
  }));

  assert.equal(report.verdict, "RED");
  assert.ok(report.hard_failures.includes("media_house:platform_copy_too_plain"));
  assert.equal(report.shorts_attention_report.status, "blocked");
});

test("subject-only or dangling thumbnail text fails the media-house gate", () => {
  const base = strongStory();
  const report = buildPulseMediaHouseScore(strongStory({
    canonical: {
      ...base.canonical,
      first_frame_text: "Forza Horizon 6",
      thumbnail_headline: "FORZA HORIZON 6 HAS TO MAKE",
    },
    platformManifest: {
      outputs: {
        youtube_shorts: {
          title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
          description: "Forza Horizon 6 just put Xbox's PC strategy under pressure before launch.",
          cover_frame: { headline: "FORZA HORIZON 6 HAS TO MAKE" },
        },
      },
    },
  }));

  assert.equal(report.verdict, "RED");
  assert.ok(report.hard_failures.includes("media_house:first_frame_or_thumbnail_not_attention_led"));
});

test("generic update thumbnails fail even when the title is acceptable", () => {
  const report = buildPulseMediaHouseScore(strongStory({
    canonical: {
      ...strongStory().canonical,
      thumbnail_headline: "NINJA GAIDEN UPDATE",
    },
    platformManifest: {
      outputs: {
        youtube_shorts: {
          title: "Ninja Gaiden 4 Just Put Xbox's Action Bet Under Pressure",
          description:
            "Ninja Gaiden 4 just turned Xbox's action pitch into something players can judge before launch. Source: Xbox Wire.",
          cover_frame: { headline: "NINJA GAIDEN UPDATE" },
        },
      },
    },
  }));

  assert.equal(report.verdict, "RED");
  assert.ok(report.hard_failures.includes("media_house:first_frame_or_thumbnail_not_attention_led"));
});

test("placeholder cover text fails even when the title is acceptable", () => {
  for (const headline of ["EA SPORTS FC STORY TEST", "IF YOU HAVEN'T"]) {
    const report = buildPulseMediaHouseScore(strongStory({
      platformManifest: {
        outputs: {
          youtube_shorts: {
            title: "EA Sports FC 26 Just Became Easier To Trial",
            description:
              "EA SPORTS FC 26 just moved into a subscription, which changes the pitch from full-price risk to worth trying tonight. Source: Xbox Wire.",
            cover_frame: { headline },
          },
        },
      },
    }));
    assert.equal(report.verdict, "RED", headline);
    assert.ok(report.hard_failures.includes("media_house:first_frame_or_thumbnail_not_attention_led"), headline);
  }
});

test("article-length platform descriptions fail the media-house gate", () => {
  const report = buildPulseMediaHouseScore(strongStory({
    platformManifest: {
      outputs: {
        youtube_shorts: {
          title: "Steam Next Fest Has A Demo Overload Problem",
          description:
            "We're spoiled for choice these days when it comes to video games. Duskfade https://youtu.be/example See on Steam. Burn-9 https://youtu.be/example See on Steam. Read more. Source: GameSpot.",
          cover_frame: { headline: "STEAM NEXT FEST DEMO TEST" },
        },
      },
    },
  }));

  assert.equal(report.verdict, "RED");
  assert.ok(report.hard_failures.includes("media_house:platform_copy_too_plain"));
});

test("copied competitor style fails", () => {
  const report = buildPulseMediaHouseScore(strongStory({
    competitorSimilarity: { max_similarity_score: 0.92, closest_channel: "IGN", copied_template_risk: true },
  }));
  assert.equal(report.verdict, "RED");
  assert.ok(report.hard_failures.includes("media_house:competitor_mimicry_risk"));
});

test("poor SFX and audio fail even when visuals pass", () => {
  const base = strongStory();
  const report = buildPulseMediaHouseScore(strongStory({
    director: {
      ...base.director,
      sound_transition_plan: {
        sfx: {
          cue_count: 1,
          max_same_family_run: 4,
          cues: [{ family: "tick", atS: 0 }, { family: "tick", atS: 1 }, { family: "tick", atS: 2 }],
          mastering: { duck_under_narration: false, narration_priority: false },
        },
      },
    },
    loudness: { verdict: "fail", blockers: ["voice_buried"], metrics: { valid_segment_count: 1, max_peak_db: 0.2 } },
  }));

  assert.equal(report.verdict, "RED");
  assert.ok(report.hard_failures.includes("media_house:poor_sfx_audio"));
});

test("source cards cannot monopolise the opening momentum", () => {
  const base = strongStory();
  const report = buildPulseMediaHouseScore(strongStory({
    director: {
      ...base.director,
      shot_plan: [
        { id: "hook", kind: "hook_slam", startS: 0, durationS: 1.1 },
        { id: "source", kind: "source_lock", startS: 1.1, durationS: 12 },
        { id: "motion", kind: "motion_clip", startS: 13.1, durationS: 2.4, source_family: "official_a" },
      ],
    },
  }));

  assert.equal(report.verdict, "RED");
  assert.ok(report.hard_failures.includes("media_house:source_card_kills_momentum"));
  assert.equal(report.premium_output_contract.status, "blocked");
  assert.ok(report.premium_output_contract.blockers.includes("premium_output:source_card_dwell_too_long"));
});

test("repeated direct-motion segments cannot pass as premium output", () => {
  const repeatedClip = {
    path: "C:\\media\\halo-campaign-evolved-trailer.mp4",
    source_url: "https://cdn.example.com/halo-campaign-evolved-trailer.mp4",
    source_family: "xbox_halo_campaign_evolved_official",
    start_s: 4,
    end_s: 7,
    media_kind: "direct_video",
    counts_towards_motion_readiness: true,
  };
  const report = buildPulseMediaHouseScore(strongStory({
    materialisedMotionClips: {
      status: "ready",
      clips: [
        repeatedClip,
        repeatedClip,
        { ...repeatedClip, start_s: 9, end_s: 12 },
        { ...repeatedClip, start_s: 13, end_s: 16 },
        { ...repeatedClip, start_s: 17, end_s: 20 },
        { ...repeatedClip, start_s: 21, end_s: 24 },
      ],
      distinct_motion_families: ["xbox_halo_campaign_evolved_official"],
    },
  }));

  assert.equal(report.verdict, "RED");
  assert.ok(report.hard_failures.includes("media_house:direct_motion_repeats_too_much"));
  assert.ok(report.premium_output_contract.blockers.includes("premium_output:repeated_motion_segments"));
  assert.ok(report.premium_output_contract.blockers.includes("premium_output:motion_family_dominance"));
});

test("missing direct-motion evidence cannot pass as premium output", () => {
  const report = buildPulseMediaHouseScore(strongStory({
    materialisedMotionClips: {},
  }));

  assert.equal(report.verdict, "RED");
  assert.ok(report.hard_failures.includes("media_house:direct_motion_not_verified"));
  assert.ok(report.premium_output_contract.blockers.includes("premium_output:direct_motion_not_verified"));
  assert.equal(report.premium_output_contract.checks.direct_motion_repeats.status, "blocked");
});

test("multi-game stories cannot use one game's footage for the entire video", () => {
  const clips = Array.from({ length: 8 }, (_, index) => ({
    id: `palworld-${index + 1}`,
    path: `C:\\media\\palworld-${index + 1}.mp4`,
    source_family: `steamstatic:/store_trailers/1623730/trailer_${index + 1}_window_36_5`,
    source_url: `https://video.akamai.steamstatic.com/store_trailers/1623730/trailer-${index + 1}.m3u8`,
    media_kind: "direct_video",
    counts_towards_motion_readiness: true,
  }));
  const base = strongStory();
  const report = buildPulseMediaHouseScore(strongStory({
    canonical: {
      ...base.canonical,
      selected_title: "Game Pass Just Created An Install Fight",
      canonical_subject: "Xbox Game Pass July Wave",
      canonical_game: "Xbox Game Pass",
      canonical_angle: "multiple Game Pass drops compete for player time",
      first_spoken_line: "Xbox Game Pass just made July feel like a download queue problem.",
      narration_script:
        "Xbox Game Pass just put Tony Hawk, The Planet Crafter and Palworld into one wave. Which game earns the install? Follow Pulse Gaming so you never miss a beat.",
    },
    materialisedMotionClips: { clips },
  }));

  assert.ok(report.hard_failures.includes("media_house:multi_entity_motion_coverage_missing"));
  assert.equal(report.premium_output_contract.checks.multi_entity_motion_coverage.required, true);
  assert.equal(report.premium_output_contract.checks.multi_entity_motion_coverage.distinct_visual_entities, 1);
});

test("local proof renders cannot masquerade as final publish renders", () => {
  const report = buildPulseMediaHouseScore(strongStory({
    renderManifest: {
      final_publish_render: false,
      output_bytes: 22894,
      output_path: "output/fresh-green-refill/story/visual_v4_render.mp4",
    },
  }));

  assert.equal(report.verdict, "RED");
  assert.ok(report.hard_failures.includes("media_house:final_publish_render_not_proven"));
  assert.ok(report.premium_output_contract.blockers.includes("premium_output:final_publish_render_not_proven"));
});

test("missing final-render evidence cannot pass the media-house gate", () => {
  const report = buildPulseMediaHouseScore(strongStory({
    renderManifest: {},
  }));

  assert.equal(report.verdict, "RED");
  assert.ok(report.hard_failures.includes("media_house:final_publish_render_not_proven"));
  assert.ok(report.premium_output_contract.blockers.includes("premium_output:final_publish_render_not_proven"));
  assert.equal(report.premium_output_contract.checks.final_render.status, "blocked");
});

test("bad caption display for GTA and years blocks premium output", () => {
  const report = buildPulseMediaHouseScore(strongStory({
    captionQa: {
      status: "fail",
      display_text: "G T A SIX launches in twenty twenty six.",
    },
  }));

  assert.equal(report.verdict, "RED");
  assert.ok(report.hard_failures.includes("media_house:caption_display_not_platform_native"));
  assert.ok(report.premium_output_contract.blockers.includes("premium_output:caption_display_not_platform_native"));
});

test("missing caption-display evidence cannot pass the media-house gate", () => {
  const report = buildPulseMediaHouseScore(strongStory({
    captionQa: {},
  }));

  assert.equal(report.verdict, "RED");
  assert.ok(report.hard_failures.includes("media_house:caption_display_not_verified"));
  assert.ok(report.premium_output_contract.blockers.includes("premium_output:caption_display_not_verified"));
  assert.equal(report.premium_output_contract.checks.caption_display.status, "blocked");
});

test("Footage Empire v2 red evidence blocks source-locked media-house approval", () => {
  const report = buildPulseMediaHouseScore(strongStory({
    footageEmpireV2: {
      verdict: "red",
      blockers: [
        "no_trusted_footage_references_for_story",
        "trusted_footage_story_mismatch_or_missing",
      ],
      motion: { available_motion_clips: 0, available_distinct_families: 0 },
      trusted_sources: { references_found: 0 },
      rights_coverage: { verdict: "pass", approved_family_count: 0 },
    },
  }));

  assert.equal(report.verdict, "RED");
  assert.ok(report.scores.source_lock_score < 70);
  assert.ok(report.hard_failures.includes("media_house:source_lock_not_verified"));
  assert.deepEqual(report.source_lock_report.blockers, [
    "no_trusted_footage_references_for_story",
    "trusted_footage_story_mismatch_or_missing",
  ]);
});

module.exports = {
  strongStory,
};
