"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildGoalProofPackage,
  writeGoalProofPackageArtifacts,
} = require("../../lib/goal-proof-package");
const { buildAffiliateLinkManifest } = require("../../lib/commercial-intelligence-engine");
const { _private: mediaHousePrivate } = require("../../lib/pulse-media-house-score");

const story = require("../../test/fixtures/goal/mixtape-governance-story.json");
const rightsLedger = require("../../test/fixtures/goal/mixtape-rights-ledger.json");

function greenStory() {
  const clips = Array.from({ length: 7 }, (_, index) => ({
    id: `forza-clip-${index + 1}`,
    type: "official_trailer_clip",
    path: `output/video/forza-clip-${index + 1}.mp4`,
    source_url: `https://cdn.example.com/forza-clip-${index + 1}.mp4`,
    rights_risk_class: "official_reference_only",
    source_type: "official_trailer",
    source_family: `forza_family_${index + 1}`,
    durationS: 2.8,
    validated: true,
  }));
  const sfxAssets = [
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
      asset_id: "soundly-hit-01",
      role: "transition",
      family: "transition_hit",
      provider_id: "soundly",
      source_url: "file://audio/licensed-sfx/soundly/hit-01.wav",
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
      asset_id: "sonniss-chart-01",
      role: "ui_tick",
      family: "chart_tick",
      provider_id: "sonniss",
      source_url: "file://audio/licensed-sfx/sonniss/chart-01.wav",
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
  return {
    id: "forza-green-proof",
    canonical_subject: "Forza Horizon 6",
    canonical_game: "Forza Horizon 6",
    canonical_angle: "paid early access created a major Steam demand signal",
    title: "Forza Horizon 6 Steam Peak Exposes Xbox's Early-Access Bet",
    suggested_title: "Forza Horizon 6 Steam Peak Exposes Xbox's Early-Access Bet",
    public_title: "Forza Horizon 6 Steam Peak Exposes Xbox's Early-Access Bet",
    suggested_thumbnail_text: "FORZA STEAM SPIKE",
    thumbnail_source_label: "GamesRadar+",
    source_card_label: "GamesRadar+",
    source_name: "GamesRadar+",
    primary_source: "GamesRadar+",
    article_url: "https://www.gamesradar.com/forza-horizon-6-steam",
    manual_caption_generated: true,
    transformative_edit_evidence: true,
    exported_path: "output/final/forza-green-proof.mp4",
    render_manifest: {
      final_publish_render: true,
      output_path: "output/final/forza-green-proof.mp4",
      duration_seconds: 48.2,
      quality_gate_status: "post_render_forensics_passed",
      post_render_forensic_result: "pass",
    },
    audio_path: "output/audio/forza-green-proof.mp3",
    narration_audio_path: "output/audio/forza-green-proof.mp3",
    timestamps_path: "output/audio/forza-green-proof_timestamps.json",
    word_timestamps_path: "output/audio/forza-green-proof_timestamps.json",
    word_timestamp_source: "local_whisper_word_alignment",
    word_timestamp_count: 3,
    word_timestamps: [
      { word: "Forza", start: 0, end: 0.28 },
      { word: "Horizon", start: 0.29, end: 0.68 },
      { word: "6", start: 0.69, end: 0.82 },
    ],
    audio_manifest: {
      voice_status: "materialized",
      narration_audio_path: "output/audio/forza-green-proof.mp3",
      word_timestamps_path: "output/audio/forza-green-proof_timestamps.json",
      word_timestamp_source: "local_whisper_word_alignment",
      word_timestamp_count: 3,
    },
    full_script:
      "Forza Horizon 6 just gave Xbox the paid access warning it needed. GamesRadar+ reports 178,009 concurrent Steam players and a 92 Metacritic aggregate. The catch is that this happened before the standard launch, with some players paying $120. That split matters because paid early demand proves attention, but it does not prove the wider audience is already locked in. If the cheaper wave holds, this becomes a real momentum story instead of a premium-week screenshot. Follow Pulse Gaming so you never miss a beat.",
    video_clips: clips,
    sfx_asset_inventory: sfxAssets,
    affiliate_link_manifest: {
      story_id: "forza-green-proof",
      vertical: "gaming",
      disclosure_required: false,
      primary_link: null,
      fallback_links: [],
    },
  };
}

function rightsForGreenStory(story) {
  return [
    ...story.video_clips.map((clip) => ({
      asset_id: clip.id,
      path: clip.path,
      source_url: clip.source_url,
      source_type: clip.source_type,
      licence_basis: "official_reference_transformative_short",
      allowed_platforms: ["youtube", "tiktok", "instagram", "facebook"],
      commercial_use_allowed: true,
      risk_score: 0.18,
      evidence_file: `rights/${clip.id}.json`,
    })),
    {
      asset_id: `${story.id}_audio_path`,
      path: story.audio_path,
      source_url: "local://tts/liam",
      source_type: "local_tts_voice",
      licence_basis: "owned_local_voice_model",
      allowed_platforms: ["youtube", "tiktok", "instagram", "facebook"],
      commercial_use_allowed: true,
      risk_score: 0.05,
      evidence_file: "rights/local-tts.json",
    },
    ...story.sfx_asset_inventory.map((asset) => ({
      ...asset,
      asset_type: "sfx",
      allowed_platforms: ["youtube", "tiktok", "instagram", "facebook", "x", "threads", "pinterest"],
      risk_score: 0.08,
      evidence_file: `rights/${asset.asset_id}.json`,
    })),
  ];
}

function normalise(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

test("goal proof package builds the remaining creative and commercial artefacts", () => {
  const pack = buildGoalProofPackage({
    story,
    rightsLedger,
    generatedAt: "2026-05-21T19:45:00.000Z",
  });

  assert.equal(pack.story_id, "mixtape-governance-proof");
  assert.equal(pack.script_scorecard.story_id, story.id);
  assert.equal(pack.footage_inventory.story_id, story.id);
  assert.equal(pack.director_beat_map.story_id, story.id);
  assert.equal(pack.audio_manifest.story_id, story.id);
  assert.equal(pack.sfx_manifest.cue_count, pack.audio_manifest.sfx_cue_count);
  assert.equal(pack.affiliate_link_manifest.story_id, story.id);
  assert.equal(pack.platform_publish_manifest.platform_mirroring_detection.verdict, "pass");
  assert.equal(pack.safety.no_publishing_side_effects, true);
  assert.equal(pack.safety.production_db_mutated, false);
});

test("goal proof package produces a GREEN acceptance entry only when every core gate passes", () => {
  const story = greenStory();
  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-05-21T19:46:00.000Z",
  });

  assert.equal(pack.acceptance_entry.verdict, "GREEN");
  assert.equal(pack.acceptance_entry.story_id, "forza-green-proof");
  assert.equal(pack.sfx_manifest.source_plan.readiness.status, "pass");
  assert.ok(pack.acceptance_entry.artefacts.includes("script_scorecard.json"));
  assert.ok(pack.acceptance_entry.artefacts.includes("platform_publish_manifest.json"));
});

test("goal proof package does not keep stale footage blocker after materialised direct-motion proof", () => {
  const story = greenStory();
  story.id = "gta-windowed-motion-proof";
  story.canonical_subject = "Grand Theft Auto VI";
  story.canonical_game = "Grand Theft Auto VI";
  story.title = "GTA VI Cover Art Starts The Pre-Order Fight";
  story.public_title = "GTA VI Cover Art Starts The Pre-Order Fight";
  story.suggested_title = "GTA VI Cover Art Starts The Pre-Order Fight";
  story.suggested_thumbnail_text = "GTA VI PREORDER TEST";
  story.source_name = "Xbox Wire";
  story.primary_source = "Xbox Wire";
  story.article_url = "https://www.xbox.com/en-US/games/store/grand-theft-auto-vi/9NNZSNHLR63L";
  story.full_script =
    "Grand Theft Auto VI just made the buying argument real. Xbox Wire says pre-orders open on June 25. The payoff is simple: players finally get to argue about price, editions and whether locking in early is smart. Follow Pulse Gaming so you never miss a beat.";
  story.video_clips = Array.from({ length: 8 }, (_, index) => ({
    id: `gta-window-${index + 1}`,
    type: "motion_clip",
    path: `output/video/gta-window-${index + 1}.mp4`,
    source_url: `https://media.rockstargames.com/VI/trailer-${(index % 3) + 1}.mp4`,
    source_type: "official_trailer_segment",
    rights_risk_class: "official_reference_only",
    source_family: `rockstar_gta_vi_window_${index + 1}`,
    durationS: 4.8,
    validated: true,
  }));

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-06-26T19:45:00.000Z",
  });

  assert.equal(pack.publish_verdict.reason_codes.includes("footage:v4_motion_blocked"), false);
  assert.equal(pack.publish_verdict.reason_codes.includes("distinct_motion_source_assets_minimum_not_met"), false);
});

test("goal proof package proves each social pack is platform-native rather than mirrored", () => {
  const story = greenStory();
  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-05-22T15:45:00.000Z",
  });

  const evidence = pack.platform_publish_manifest.platform_native_evidence;
  assert.equal(evidence.verdict, "pass");
  assert.deepEqual(
    evidence.platforms.map((item) => item.platform).sort(),
    [
      "facebook_reels",
      "instagram_reels",
      "pinterest",
      "threads",
      "tiktok",
      "x",
      "youtube_shorts",
    ],
  );
  assert.equal(evidence.blind_duplicate_pairs.length, 0);
  assert.equal(pack.platform_variant_scorecard.platform_native_evidence.verdict, "pass");
  assert.doesNotMatch(pack.youtube_publish_pack.description, /useful question behind the headline/i);
  assert.match(pack.youtube_publish_pack.description, /paid early access|Steam demand|cheaper launch wave/i);
  assert.equal(pack.tiktok_publish_pack.commercial_content_setting_recommendation, "not_required_unless_brand_or_product_promoted");
  assert.equal(pack.instagram_publish_pack.carousel_companion.required, true);
  assert.equal(pack.pinterest_publish_pack.landing_page_required, true);
  assert.notEqual(
    normalise(pack.x_publish_pack.source_safe_post),
    normalise(pack.threads_publish_pack.discussion_post),
  );
});

test("goal proof package turns source-admin copy into attention-led Shorts packaging", () => {
  const story = greenStory();
  story.id = "steam-next-fest-attention-pack";
  story.canonical_subject = "Steam Next Fest";
  story.canonical_game = "Steam Next Fest";
  story.canonical_angle = "Confirmed Drop";
  story.public_title = "Steam Next Fest Turns Demos Into A Trust Fight";
  story.title = "Steam Next Fest Turns Demos Into A Trust Fight";
  story.suggested_thumbnail_text = "STEAM NEXT FEST";
  story.primary_source = "Steam";
  story.source_name = "Steam";
  story.description =
    "Steam Next Fest is turning demos into a public trust test for PC games. One playable slice can win wishlists or expose weak controls before launch.";
  story.full_script =
    "Steam Next Fest is the moment a PC game stops hiding behind trailers. A demo exposes what marketing can dodge: controls, performance and whether the first mechanic feels good. Follow Pulse Gaming so you never miss a beat.";

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-06-19T14:10:00.000Z",
  });

  const outputs = pack.platform_publish_manifest.outputs;
  assert.doesNotMatch(outputs.youtube_shorts.description, /Confirmed Drop|Sources and related links/i);
  assert.match(outputs.youtube_shorts.description, /trust test|wishlists|weak controls/i);
  assert.notEqual(outputs.youtube_shorts.cover_frame.headline, "STEAM NEXT FEST");
  assert.equal(outputs.youtube_shorts.cover_frame.headline, "STEAM DEMO FIGHT");
  assert.doesNotMatch(outputs.youtube_shorts.cover_frame.headline, /\b(?:MAKE|HAS|TO|INTO|WITH)$/i);
  assert.equal(mediaHousePrivate.platformCopyTooPlain(pack.platform_publish_manifest), false);
  assert.equal(
    mediaHousePrivate.weakFirstFrameOrThumbnailCopy({}, pack.platform_publish_manifest),
    false,
  );
});

test("goal proof package uses repaired attention copy for visual quality first-frame checks", () => {
  const story = greenStory();
  story.id = "gta-vi-screenshot-caveat";
  story.canonical_subject = "GTA 6";
  story.canonical_game = "GTA 6";
  story.title =
    "GTA 6 Looks Amazing, but the 63 New Screenshots Probably Don't Represent Gameplay, Tech Experts Believe";
  story.public_title = story.title;
  story.suggested_title = story.title;
  story.suggested_thumbnail_text = "GTA 6 LOOKS";
  story.first_frame_text = "GTA 6 LOOKS";
  story.primary_source = "IGN";
  story.source_name = "IGN";
  story.article_url =
    "https://www.ign.com/articles/gta-6-looks-amazing-but-the-63-new-screenshots-probably-dont-represent-gameplay-tech-experts-believe";
  story.description =
    "IGN says tech experts believe the 63 new GTA 6 screenshots probably do not represent gameplay.";
  story.full_script =
    "GTA VI's new screenshots look incredible, but they are not gameplay proof yet. IGN says tech experts believe the 63 new screenshots probably do not represent gameplay. That matters because still images can prove art direction, density and atmosphere, but not driving feel, mission pacing or how the world behaves when players control it. That means the smart debate is restraint: get excited by the image quality, but wait for Rockstar to show the game moving before calling it proof. Follow Pulse Gaming so you never miss a beat.";

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-06-25T12:30:00.000Z",
  });

  assert.equal(pack.canonical_story_manifest.public_title, "GTA VI Screenshots Are Not Gameplay Proof");
  assert.equal(pack.canonical_story_manifest.thumbnail_headline, "GTA VI NOT GAMEPLAY");
  assert.equal(pack.canonical_story_manifest.first_frame_text, "GTA VI NOT GAMEPLAY");
  assert.equal(pack.visual_quality_report.frame_rules.first_frame_text, "GTA VI NOT GAMEPLAY");
  assert.doesNotMatch(pack.visual_quality_report.frame_rules.first_frame_text, /GTA 6 LOOKS/);
});

test("goal proof package preserves concrete closure-risk titles in downstream platform copy", () => {
  const story = greenStory();
  story.id = "state-of-decay-closure-risk";
  story.canonical_subject = "State of Decay";
  story.canonical_game = "State of Decay";
  story.title =
    "State of Decay studio Undead Labs potentially up for closure, sources claim, with Bethesda and Blizzard also facing layoffs";
  story.public_title = "State Of Decay Studio Has A Closure Risk";
  story.selected_title = "State Of Decay Studio Has A Closure Risk";
  story.suggested_title = "State Of Decay Studio Has A Closure Risk";
  story.primary_source = "Rock Paper Shotgun";
  story.source_name = "Rock Paper Shotgun";
  story.article_url = "https://www.rockpapershotgun.com/state-of-decay-undead-labs-closure-risk";
  story.description =
    "Rock Paper Shotgun says sources claim Undead Labs could be affected as Microsoft cuts spread across gaming teams.";
  story.full_script =
    "State of Decay fans just got the kind of studio risk story that changes the mood fast. Rock Paper Shotgun says sources claim Undead Labs could be affected as wider Microsoft gaming cuts hit teams including Bethesda and Blizzard. That does not prove what happens to the next game, but it does change the question players are asking: is the project protected, delayed or suddenly less certain? The payoff is uncomfortable. A survival game can survive a long wait; it is much harder when players start worrying about the studio behind it. Follow Pulse Gaming so you never miss a beat.";

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-06-30T16:35:00.000Z",
  });

  assert.equal(pack.canonical_story_manifest.public_title, "State Of Decay Studio Has A Closure Risk");
  assert.equal(pack.canonical_story_manifest.selected_title, "State Of Decay Studio Has A Closure Risk");
  assert.equal(pack.canonical_story_manifest.canonical_title, "State Of Decay Studio Has A Closure Risk");
  assert.equal(pack.platform_publish_manifest.outputs.youtube_shorts.title, "State Of Decay Studio Has A Closure Risk");
});

test("goal proof package keeps hyphenated game titles clean in cover headlines", () => {
  const story = greenStory();
  story.id = "gears-e-day-attention-pack";
  story.canonical_subject = "Gears of War E-Day";
  story.canonical_game = "Gears of War E-Day";
  story.canonical_angle = "PC requirements list a 130 GB SSD install";
  story.public_title = "Gears E-Day Has A 130GB Problem";
  story.title = "Gears E-Day Has A 130GB Problem";
  story.suggested_thumbnail_text = "GEARS OF WAR";
  story.primary_source = "PC Gamer";
  story.source_name = "PC Gamer";
  story.description = "Gears of War E-Day PC requirements list a 130 GB SSD install.";
  story.full_script =
    "Gears of War E-Day just made its PC pitch very simple. The question is not only whether your rig can run it, but whether a 130 gig install is now normal for a campaign-first blockbuster. Follow Pulse Gaming so you never miss a beat.";

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-06-19T14:20:00.000Z",
  });

  assert.equal(pack.platform_publish_manifest.outputs.youtube_shorts.cover_frame.headline, "GEARS E-DAY 130GB TEST");
  assert.match(
    pack.platform_publish_manifest.outputs.youtube_shorts.description,
    /asking players for 130 GB|storage into part of the launch pitch/i,
  );
  assert.doesNotMatch(
    pack.platform_publish_manifest.outputs.youtube_shorts.description,
    /^Gears of War E-Day PC requirements list a 130 GB SSD install\. Source: PC Gamer\.$/i,
  );
  assert.equal(
    mediaHousePrivate.platformCopyTooPlain({
      outputs: {
        youtube_shorts: {
          description: "Gears of War E-Day PC requirements list a 130 GB SSD install. Source: PC Gamer.",
        },
      },
    }),
    true,
  );
});

test("goal proof package does not turn article boilerplate into Shorts descriptions", () => {
  const story = greenStory();
  story.id = "ea-play-boilerplate-attention-pack";
  story.canonical_subject = "EA SPORTS FC 26";
  story.canonical_game = "EA SPORTS FC 26";
  story.canonical_angle = "The post EA SPORTS FC 26 Is Now on EA Play appeared first on XBOX Wire.";
  story.public_title = "EA SPORTS FC 26 Is Now On EA Play";
  story.title = "EA SPORTS FC 26 Is Now On EA Play";
  story.suggested_thumbnail_text = "EA PLAY TEST";
  story.primary_source = "Xbox Wire";
  story.source_name = "Xbox Wire";
  story.description =
    "The post EA SPORTS FC 26 Is Now on EA Play appeared first on XBOX Wire. [&#8230;]";
  story.full_script =
    "EA SPORTS FC 26 just changed the pitch on Xbox. The question is whether EA Play makes it feel like a low-risk trial or just another subscription filler slot. Follow Pulse Gaming so you never miss a beat.";

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-06-19T15:45:00.000Z",
  });

  const description = pack.platform_publish_manifest.outputs.youtube_shorts.description;
  assert.doesNotMatch(description, /appeared first|&#8230;/i);
  assert.match(description, /Source: Xbox Wire\.$/i);
  assert.match(description, /subscription|worth trying|EA Play/i);
  assert.equal(mediaHousePrivate.platformCopyTooPlain(pack.platform_publish_manifest), false);
  assert.equal(
    mediaHousePrivate.platformCopyTooPlain({
      outputs: {
        youtube_shorts: {
          description:
            "The post EA SPORTS FC 26 Is Now on EA Play appeared first on XBOX Wire. Source: Xbox Wire.",
        },
      },
    }),
    true,
  );
});

test("goal proof package repairs weak RSS titles into attention-led Shorts packaging", () => {
  const story = greenStory();
  story.id = "steam-deck-rss-title-repair-pack";
  story.canonical_subject = "Steam Deck";
  story.canonical_game = "Steam Deck";
  story.canonical_angle = "reservation timing makes the price worth checking now";
  story.public_title = "If You Haven't Reserved Steam Deck Yet, The Price Just Changed";
  story.title = "If You Haven't Reserved Steam Deck Yet, The Price Just Changed";
  story.suggested_thumbnail_text = "IF YOU HAVEN'T";
  story.primary_source = "GameSpot";
  story.source_name = "GameSpot";
  story.description =
    "Steam Deck reservations are open again, but the useful part is whether the current price makes waiting more expensive.";
  story.full_script =
    "Steam Deck just turned a reservation reminder into a price timing problem. If you were waiting, the useful question is whether holding off still saves money or just leaves you behind the next wave. Follow Pulse Gaming so you never miss a beat.";

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-06-19T20:05:00.000Z",
  });

  const manifest = pack.platform_publish_manifest;
  const youtube = manifest.outputs.youtube_shorts;
  assert.doesNotMatch(youtube.title, /^if you haven'?t\b/i);
  assert.match(youtube.title, /Steam Deck/i);
  assert.match(youtube.title, /\b(?:price|problem|timing|risk|test)\b/i);
  assert.doesNotMatch(youtube.cover_frame.headline, /^IF YOU HAVEN'?T\b/i);
  assert.match(youtube.cover_frame.headline, /\b(?:PRICE|RISK|TEST|PROBLEM)\b/i);
  assert.equal(mediaHousePrivate.platformTitlesTooPlain(manifest, pack.canonical_story_manifest), false);
  assert.equal(mediaHousePrivate.weakFirstFrameOrThumbnailCopy(pack.canonical_story_manifest, manifest), false);
});

test("goal proof package writes grammatical descriptions for predicate-style angles", () => {
  const story = greenStory();
  story.id = "planet-crafter-predicate-angle-pack";
  story.canonical_subject = "The Planet Crafter";
  story.canonical_game = "The Planet Crafter";
  story.canonical_angle = "is about to find out whether its survival loop works on PS5";
  story.public_title = "The Planet Crafter Is Testing PS5 Survival Fans";
  story.title = "The Planet Crafter Is Testing PS5 Survival Fans";
  story.primary_source = "PlayStation Blog";
  story.source_name = "PlayStation Blog";
  story.description =
    "Hello! I'm Amélie from Miju Games. We're so excited for you to finally get to try our survival game The Planet Crafter when it launches on PS5 next month.&#160;";
  story.full_script =
    "The Planet Crafter is about to test whether its chill survival loop works on PS5. Follow Pulse Gaming so you never miss a beat.";

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-06-19T15:55:00.000Z",
  });

  const description = pack.platform_publish_manifest.outputs.youtube_shorts.description;
  assert.doesNotMatch(description, /useful question behind the headline:\s+is/i);
  assert.match(description, /^The Planet Crafter/i);
  assert.equal(mediaHousePrivate.platformTitlesTooPlain(pack.platform_publish_manifest, pack.canonical_story_manifest), false);
  assert.equal(mediaHousePrivate.platformCopyTooPlain(pack.platform_publish_manifest), false);
  assert.equal(mediaHousePrivate.weakFirstFrameOrThumbnailCopy(pack.canonical_story_manifest, pack.platform_publish_manifest), false);
});

test("goal proof package turns demo news into attention-led Shorts copy", () => {
  const story = greenStory();
  story.id = "granblue-demo-attention-pack";
  story.canonical_subject = "Granblue Fantasy Relink";
  story.canonical_game = "Granblue Fantasy Relink";
  story.public_title = "Granblue Fantasy Relink Gets A New Demo";
  story.title = "Granblue Fantasy Relink Gets A New Demo";
  story.suggested_thumbnail_text = "GRANBLUE FANTASY RELINK DEMO";
  story.primary_source = "PlayStation Blog";
  story.source_name = "PlayStation Blog";
  story.description =
    "A new playable demo lets players try Granblue Fantasy Relink before launch on PlayStation.";
  story.full_script =
    "Granblue Fantasy Relink has a new playable demo, but this is not just trailer hype. The demo is where the combat either wins trust fast or exposes the problem before launch. Follow Pulse Gaming so you never miss a beat.";

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-06-19T20:15:00.000Z",
  });

  const youtube = pack.platform_publish_manifest.outputs.youtube_shorts;
  assert.match(youtube.title, /Granblue Fantasy/i);
  assert.match(youtube.title, /\bDemo Is The Real Proof\b/i);
  assert.doesNotMatch(youtube.title, /\bDemo Trust Test\b/i);
  assert.doesNotMatch(youtube.title, /\bPS5 Survival Risk\b/i);
  assert.match(youtube.description, /\b(?:proof|problem|before launch|demo)\b/i);
  assert.doesNotMatch(youtube.description, /\bDemo Trust Test\b/i);
  assert.doesNotMatch(youtube.cover_frame.headline, /^GRANBLUE FANTASY RELINK DEMO$/i);
  assert.equal(mediaHousePrivate.platformTitlesTooPlain(pack.platform_publish_manifest, pack.canonical_story_manifest), false);
  assert.equal(mediaHousePrivate.platformCopyTooPlain(pack.platform_publish_manifest), false);
  assert.equal(mediaHousePrivate.weakFirstFrameOrThumbnailCopy(pack.canonical_story_manifest, pack.platform_publish_manifest), false);
});

test("goal proof package turns free upgrade news into owner-led Shorts packaging", () => {
  const story = greenStory();
  story.id = "gta-5-free-upgrade-pack";
  story.canonical_subject = "GTA 5";
  story.canonical_game = "GTA 5";
  story.canonical_angle = "digital PS4 and Xbox One owners can claim the PS5 and Xbox Series upgrade free";
  story.public_title = "GTA 5's $40 Upgrade Is Suddenly Free";
  story.title = "GTA 5's $40 Upgrade Is Suddenly Free";
  story.suggested_thumbnail_text = "$40 UPGRADE FREE";
  story.primary_source = "GameSpot";
  story.source_name = "GameSpot";
  story.description =
    "GameSpot reports digital PS4 and Xbox One GTA 5 owners can claim the PS5 and Xbox Series upgrade free from June 18th before July's Kortz Center Heist.";
  story.full_script =
    "Grand Theft Auto Five's current gen upgrade just became free, but only for the right owners. GameSpot reports digital PlayStation 4 and Xbox One owners can claim the PlayStation 5 and Xbox Series upgrade free before the next online update lands. Follow Pulse Gaming so you never miss a beat.";

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-06-23T02:05:00.000Z",
  });

  const evidence = pack.platform_publish_manifest.platform_native_evidence;
  const youtube = pack.platform_publish_manifest.outputs.youtube_shorts;
  assert.equal(youtube.title, "GTA 5 Has A Free Upgrade Catch");
  assert.equal(youtube.cover_frame.headline, "GTA 5 FREE UPGRADE");
  assert.match(youtube.description, /eligible PS4 and Xbox One owners/i);
  assert.equal(evidence.verdict, "pass");
  assert.equal(
    evidence.failures.some((failure) => /weak_platform_title|weak_cover_headline|plain_platform_description/.test(failure.reason)),
    false,
  );
  assert.equal(mediaHousePrivate.platformTitlesTooPlain(pack.platform_publish_manifest, pack.canonical_story_manifest), false);
  assert.equal(mediaHousePrivate.platformCopyTooPlain(pack.platform_publish_manifest), false);
  assert.equal(mediaHousePrivate.weakFirstFrameOrThumbnailCopy(pack.canonical_story_manifest, pack.platform_publish_manifest), false);
});

test("goal proof package does not misclassify PlayStation strategy stories as survival news", () => {
  const story = greenStory();
  story.id = "playstation-strategy-attention-pack";
  story.canonical_subject = "PlayStation";
  story.canonical_game = "PlayStation";
  story.canonical_angle = "a first-party PC launch focus changed in Sony's latest business document";
  story.public_title = "PlayStation Just Changed Its PC Launch Signal";
  story.title = "PlayStation Just Changed Its PC Launch Signal";
  story.suggested_thumbnail_text = "PLAYSTATION PC SHIFT";
  story.primary_source = "IGN";
  story.source_name = "IGN";
  story.description =
    "Analysis of a new PlayStation business document highlighted an official change to Sony's multiplatform release strategy, with PC no longer described as part of the first-party launch focus.";
  story.full_script =
    "PlayStation just changed the PC signal in its own business language. That does not kill PC ports, but it does change what fans should expect at launch. Follow Pulse Gaming so you never miss a beat.";

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-06-19T20:25:00.000Z",
  });

  const youtube = pack.platform_publish_manifest.outputs.youtube_shorts;
  assert.doesNotMatch(youtube.title, /\bPS5 Survival Risk\b/i);
  assert.doesNotMatch(youtube.cover_frame.headline, /\bPS5 SURVIVAL RISK\b/i);
  assert.match(youtube.title, /\bPC Port Trust Problem\b/i);
  assert.match(youtube.cover_frame.headline, /\bPLAYSTATION PC\b/i);
  assert.match(youtube.description, /\bPC port trust problem\b/i);
  assert.equal(mediaHousePrivate.platformTitlesTooPlain(pack.platform_publish_manifest, pack.canonical_story_manifest), false);
  assert.equal(mediaHousePrivate.platformCopyTooPlain(pack.platform_publish_manifest), false);
});

test("goal proof package repairs dangling thumbnail fragments", () => {
  const story = greenStory();
  story.id = "dave-diver-dangling-cover-pack";
  story.canonical_subject = "Dave The Diver";
  story.canonical_game = "Dave The Diver";
  story.canonical_angle = "a new update gives players a reason to return";
  story.public_title = "Dave The Diver Gets A New Update";
  story.title = "Dave The Diver Gets A New Update";
  story.suggested_thumbnail_text = "DAVE THE DIVER WHY YOU";
  story.primary_source = "Xbox Wire";
  story.source_name = "Xbox Wire";
  story.description =
    "Dave The Diver is getting a new update, but the real test is whether it gives players a reason to return.";
  story.full_script =
    "Dave The Diver is getting more content, but the real test is whether it gives players a reason to come back now. Follow Pulse Gaming so you never miss a beat.";

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-06-19T20:30:00.000Z",
  });

  const headline = pack.platform_publish_manifest.outputs.youtube_shorts.cover_frame.headline;
  assert.doesNotMatch(headline, /\bWHY YOU$/i);
  assert.equal(mediaHousePrivate.weakFirstFrameOrThumbnailCopy(pack.canonical_story_manifest, pack.platform_publish_manifest), false);
});

test("goal proof package gives retro preview stories a player-stakes description", () => {
  const story = greenStory();
  story.id = "elliot-retro-preview-copy-pack";
  story.canonical_subject = "The Adventures Of Elliot";
  story.canonical_game = "The Adventures Of Elliot";
  story.canonical_angle = "source_locked_update";
  story.public_title = "Elliot Is Square Enix's Retro Test";
  story.title = "How The Adventures of Elliot: The Millennium Tales Balances Exploration, Combat, and Discovery";
  story.primary_source = "Xbox Wire";
  story.source_name = "Xbox Wire";
  story.description =
    "The post How The Adventures of Elliot: The Millennium Tales Balances Exploration, Combat, and Discovery appeared first on XBOX Wire.";
  story.full_script =
    "The Adventures Of Elliot is making Square Enix's retro pitch more specific. Xbox Wire breaks down how exploration, combat and discovery are meant to work together. Follow Pulse Gaming so you never miss a beat.";

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-06-19T20:35:00.000Z",
  });

  const youtube = pack.platform_publish_manifest.outputs.youtube_shorts;
  const description = pack.platform_publish_manifest.outputs.youtube_shorts.description;
  assert.equal(youtube.title, "The Adventures Of Elliot Has A Combat Discovery Test");
  assert.equal(youtube.cover_frame.headline, "ELLIOT COMBAT TEST");
  assert.match(description, /\b(?:retro|trust|problem|combat|exploration)\b/i);
  assert.equal(mediaHousePrivate.platformTitlesTooPlain(pack.platform_publish_manifest, pack.canonical_story_manifest), false);
  assert.equal(mediaHousePrivate.weakFirstFrameOrThumbnailCopy(pack.canonical_story_manifest, pack.platform_publish_manifest), false);
  assert.equal(mediaHousePrivate.platformCopyTooPlain(pack.platform_publish_manifest), false);
});

test("goal proof package gives OG season and dark action previews concrete story hooks", () => {
  const cases = [
    {
      id: "fortnite-og-map-pack",
      subject: "Fortnite OG Season 9",
      description:
        "Fortnite OG Season 9 has a start time, OG Pass, live events and map changes for players coming back to Chapter 1.",
      expectedTitle: "Fortnite OG Season 9 Has A Map Change Test",
      expectedCover: "FORTNITE OG MAP TEST",
    },
    {
      id: "end-of-abyss-combat-pack",
      subject: "End of Abyss",
      description:
        "End of Abyss mixes exploration, combat and Little Nightmare pressure inside a hostile facility where readability matters.",
      expectedTitle: "End of Abyss Has A Combat Readability Test",
      expectedCover: "ABYSS COMBAT TEST",
    },
  ];

  for (const item of cases) {
    const story = greenStory();
    story.id = item.id;
    story.canonical_subject = item.subject;
    story.canonical_game = item.subject;
    story.canonical_angle = "source_locked_update";
    story.public_title = item.subject;
    story.title = item.subject;
    story.suggested_thumbnail_text = `WHY ${item.subject.toUpperCase()} COULD SPLIT PLAYERS`;
    story.primary_source = "Xbox Wire";
    story.source_name = "Xbox Wire";
    story.description = item.description;
    story.full_script =
      `${item.subject} has a concrete player-facing update now. Xbox Wire gives enough detail for players to judge whether it is worth another look. The useful question is whether that specific change creates real momentum, or just another update people scroll past. Follow Pulse Gaming so you never miss a beat.`;

    const pack = buildGoalProofPackage({
      story,
      rightsLedger: rightsForGreenStory(story),
      generatedAt: "2026-06-20T12:50:00.000Z",
    });

    const evidence = pack.platform_publish_manifest.platform_native_evidence;
    const youtube = pack.platform_publish_manifest.outputs.youtube_shorts;
    assert.equal(youtube.title, item.expectedTitle);
    assert.equal(youtube.cover_frame.headline, item.expectedCover);
    assert.equal(
      evidence.failures.some((failure) => failure.platform === "youtube_shorts"),
      false,
      item.id,
    );
  }
});

test("goal proof package gives Sea of Thieves Custom Seas a concrete split-risk hook", () => {
  const story = greenStory();
  story.id = "sea-custom-seas-pack";
  story.canonical_subject = "Sea of Thieves";
  story.canonical_game = "Sea of Thieves";
  story.canonical_angle = "Custom Seas lets crews create private sessions with their own rules";
  story.public_title = "Why Sea of Thieves Could Split Players";
  story.title = "Sea of Thieves Custom Seas Update Details Revealed";
  story.suggested_thumbnail_text = "SEA THIEVES PLAYER TEST";
  story.primary_source = "Xbox Wire";
  story.source_name = "Xbox Wire";
  story.description =
    "Xbox Wire says Sea of Thieves Custom Seas lets crews create private sessions with rule controls for events, training and friend groups.";
  story.full_script =
    "Sea of Thieves just made its biggest social gamble in years. Xbox Wire says Custom Seas will let crews create private sessions with their own rules. That sounds perfect for story nights, training runs and players who hate being ambushed. Follow Pulse Gaming so you never miss a beat.";

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-06-21T18:25:00.000Z",
  });

  const youtube = pack.platform_publish_manifest.outputs.youtube_shorts;
  assert.equal(youtube.title, "Sea of Thieves Custom Seas Could Split Crews");
  assert.equal(youtube.cover_frame.headline, "SEA OF THIEVES CUSTOM SEAS");
  assert.match(youtube.description, /Custom Seas, a private mode where players can set their own rules/i);
  assert.equal(mediaHousePrivate.platformTitlesTooPlain(pack.platform_publish_manifest, pack.canonical_story_manifest), false);
  assert.equal(mediaHousePrivate.weakFirstFrameOrThumbnailCopy(pack.canonical_story_manifest, pack.platform_publish_manifest), false);
  assert.equal(mediaHousePrivate.platformCopyTooPlain(pack.platform_publish_manifest), false);
});

test("goal proof package replaces Could Split Players fallback for official gameplay reveal footage", () => {
  const story = greenStory();
  story.id = "tekken-gameplay-reveal-copy-pack";
  story.canonical_subject = "TEKKEN 8";
  story.canonical_game = "TEKKEN 8";
  story.public_title = "Why TEKKEN 8 Could Split Players";
  story.title = "TEKKEN 8 - Bob Gameplay Reveal Trailer";
  story.suggested_thumbnail_text = "BOB GAMEPLAY";
  story.primary_source = "Bandai Namco";
  story.source_name = "Bandai Namco";
  story.description =
    "Bandai Namco shows Bob in a new TEKKEN 8 gameplay reveal trailer with fresh combat footage and matchup pressure.";
  story.full_script =
    "TEKKEN 8 just made Bob the next character test. Bandai Namco shows fresh gameplay footage built around movement, pressure and matchup reads. The real question is whether Bob looks fun to fight or exhausting to defend against. Follow Pulse Gaming so you never miss a beat.";

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-06-29T12:40:00.000Z",
  });

  const youtube = pack.platform_publish_manifest.outputs.youtube_shorts;
  assert.equal(youtube.title, "TEKKEN 8 Finally Shows Real Gameplay");
  assert.doesNotMatch(youtube.title, /Could Split Players/i);
  assert.equal(mediaHousePrivate.platformTitlesTooPlain(pack.platform_publish_manifest, pack.canonical_story_manifest), false);
});

test("goal proof package gives Free Play Days roundups a free-access risk description", () => {
  const story = greenStory();
  story.id = "free-play-days-copy-pack";
  story.canonical_subject = "Free Play Days - PGA";
  story.canonical_game = "Free Play Days - PGA";
  story.canonical_angle = "PGA Tour 2K25, Two Point Museum, Assetto Corsa and Dead by Daylight are in the latest free access window";
  story.public_title = "Free Play Days Adds Four Games";
  story.title = "Free Play Days - PGA Tour 2K25, Two Point Museum, Assetto Corsa and Dead by Daylight";
  story.primary_source = "Xbox Wire";
  story.source_name = "Xbox Wire";
  story.description =
    "The post Free Play Days - PGA Tour 2K25, Two Point Museum, Assetto Corsa and Dead by Daylight appeared first on XBOX Wire.";
  story.full_script =
    "Free Play Days has four games in the window, but free only matters if one of them is worth keeping installed. Follow Pulse Gaming so you never miss a beat.";

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-06-19T20:40:00.000Z",
  });

  const youtube = pack.platform_publish_manifest.outputs.youtube_shorts;
  const evidence = pack.platform_publish_manifest.platform_native_evidence;
  assert.equal(pack.canonical_story_manifest.canonical_subject, "Free Play Days");
  assert.equal(youtube.title, "Free Play Days Has A Free-Access Risk");
  assert.equal(youtube.cover_frame.headline, "FREE PLAY DAYS FREE RISK");
  const description = pack.platform_publish_manifest.outputs.youtube_shorts.description;
  assert.match(description, /\b(?:free|risk|worth keeping|trial|tonight)\b/i);
  assert.equal(
    evidence.failures.some((failure) => failure.platform === "youtube_shorts"),
    false,
  );
  assert.equal(mediaHousePrivate.platformCopyTooPlain(pack.platform_publish_manifest), false);
});

test("goal proof package normalises conversational GTA 6 source headlines before cover packaging", () => {
  const story = greenStory();
  story.id = "gta-6-demo-source-pack";
  story.canonical_subject = "I Hope GTA 6";
  story.canonical_game = "I Hope GTA 6";
  story.canonical_angle = "developer quote about a playable demo becoming the proof point";
  story.public_title = "I Hope GTA 6 Demo Is The Real Proof";
  story.title = "I Hope GTA 6 Demo Is The Real Proof";
  story.suggested_thumbnail_text = "I HOPE GTA TRUST PROBLEM";
  story.primary_source = "GameSpot";
  story.source_name = "GameSpot";
  story.description =
    "GameSpot reported a developer quote about hoping GTA 6 has a playable demo before launch.";
  story.full_script =
    "GTA 6 has one proof point players can judge immediately: the demo. It can win wishlists fast or expose the problem before launch. Follow Pulse Gaming so you never miss a beat.";

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-06-20T13:05:00.000Z",
  });

  const youtube = pack.platform_publish_manifest.outputs.youtube_shorts;
  const evidence = pack.platform_publish_manifest.platform_native_evidence;
  assert.equal(pack.canonical_story_manifest.canonical_subject, "GTA 6");
  assert.equal(youtube.title, "GTA 6 Demo Is The Real Proof");
  assert.equal(youtube.cover_frame.headline, "GTA 6 DEMO RISK");
  assert.equal(
    evidence.failures.some((failure) => failure.platform === "youtube_shorts"),
    false,
  );
});

test("goal proof package repairs generic canonical subjects before platform packaging", () => {
  const story = greenStory();
  story.id = "ninja-theory-generic-subject-pack";
  story.canonical_subject = "This Game";
  story.canonical_game = "This Game";
  story.canonical_angle = "source_locked_update";
  story.public_title = "This Game Now Has A Real Question";
  story.title = "How Ninja Theory Paved A Way For The Elden Ring Movie";
  story.primary_source = "GameSpot";
  story.source_name = "GameSpot";
  story.description =
    "Ninja Theory helped shape Hollywood storytelling around game-like action, and that matters again because the Elden Ring movie is now being judged by players.";
  story.full_script =
    "Ninja Theory is back in the conversation because its cinematic game work now hangs over the Elden Ring movie. Follow Pulse Gaming so you never miss a beat.";

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-06-19T20:45:00.000Z",
  });

  const youtube = pack.platform_publish_manifest.outputs.youtube_shorts;
  assert.equal(pack.canonical_story_manifest.canonical_subject, "Ninja Theory");
  assert.doesNotMatch(youtube.title, /\bThis Game\b/i);
  assert.doesNotMatch(youtube.description, /\bThis Game\b/i);
  assert.equal(mediaHousePrivate.platformTitlesTooPlain(pack.platform_publish_manifest, pack.canonical_story_manifest), false);
  assert.equal(mediaHousePrivate.platformCopyTooPlain(pack.platform_publish_manifest), false);
});

test("goal proof package extracts Steam Controller from reservation headlines", () => {
  const story = greenStory();
  story.id = "steam-controller-reservation-pack";
  story.canonical_subject = "If You Haven't Reserved Steam";
  story.canonical_game = "If You Haven't Reserved Steam";
  story.canonical_angle = "source_locked_update";
  story.public_title = "If You Haven't Reserved Steam Just Changed The Watchlist";
  story.title = "If You Haven't Reserved A Steam Controller Yet, You'll Have To Wait Until Next Year";
  story.primary_source = "GameSpot";
  story.source_name = "GameSpot";
  story.description =
    "Valve says new Steam Controller orders will not be fulfilled until 2027 at the earliest after demand outweighed supply.";
  story.full_script =
    "Steam Controller demand just turned into a waiting list problem. Follow Pulse Gaming so you never miss a beat.";

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-06-19T20:55:00.000Z",
  });

  const youtube = pack.platform_publish_manifest.outputs.youtube_shorts;
  assert.equal(pack.canonical_story_manifest.canonical_subject, "Steam Controller");
  assert.doesNotMatch(youtube.title, /Hollywood/i);
  assert.doesNotMatch(youtube.description, /Hollywood/i);
  assert.match(youtube.cover_frame.headline, /STEAM CONTROLLER/i);
  assert.match(youtube.title, /\b(?:Steam Controller|wait|risk|problem|timing)\b/i);
  assert.equal(mediaHousePrivate.platformTitlesTooPlain(pack.platform_publish_manifest, pack.canonical_story_manifest), false);
  assert.equal(mediaHousePrivate.platformCopyTooPlain(pack.platform_publish_manifest), false);
});

test("goal proof package repairs overlong possessive subjects before platform packaging", () => {
  const story = greenStory();
  story.id = "pragmata-overlong-subject-pack";
  story.canonical_subject = "Pragmata's development team included group";
  story.canonical_game = "Pragmata's development team included group";
  story.canonical_angle = "source_locked_update";
  story.public_title = "Pragmata's Development Team Included Group Is Worth Watching Again";
  story.title =
    "Pragmata's development team included a group of women known as the Diana Police to capture Diana's child-like innocence";
  story.primary_source = "Eurogamer";
  story.source_name = "Eurogamer";
  story.description =
    "Capcom's long-in-the-works space game Pragmata finally showed more of Diana and Hugh, but the real test is whether the character work makes players trust the story.";
  story.full_script =
    "Pragmata is being judged on more than sci-fi combat now. The character work around Diana is either the thing that makes players care or the detail that feels overexplained. Follow Pulse Gaming so you never miss a beat.";

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-06-19T20:50:00.000Z",
  });

  const youtube = pack.platform_publish_manifest.outputs.youtube_shorts;
  assert.equal(pack.canonical_story_manifest.canonical_subject, "Pragmata");
  assert.doesNotMatch(youtube.title, /development team included group/i);
  assert.doesNotMatch(youtube.description, /development team included group/i);
  assert.doesNotMatch(youtube.description, /useful question behind the headline|^'s\b/i);
  assert.equal(mediaHousePrivate.platformTitlesTooPlain(pack.platform_publish_manifest, pack.canonical_story_manifest), false);
  assert.equal(mediaHousePrivate.platformCopyTooPlain(pack.platform_publish_manifest), false);
});

test("goal proof package marks generic trust-template packs as non-native evidence", () => {
  const story = greenStory();
  story.id = "guild-wars-generic-trust-template-pack";
  story.canonical_subject = "Guild Wars 3";
  story.canonical_game = "Guild Wars 3";
  story.canonical_angle = "source_locked_update";
  story.public_title = "Guild Wars 3 Has A Player Trust Test";
  story.title = "Guild Wars 3 Has A Player Trust Test";
  story.primary_source = "PC Gamer";
  story.source_name = "PC Gamer";
  story.description =
    "Guild Wars 3 has a real source detail, but not enough practical consequence for a strong Pulse short yet.";
  story.full_script =
    "Guild Wars 3 has one new detail players are watching. Follow Pulse Gaming so you never miss a beat.";

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-06-20T01:20:00.000Z",
  });

  const evidence = pack.platform_publish_manifest.platform_native_evidence;
  assert.equal(evidence.verdict, "fail");
  assert.doesNotMatch(pack.youtube_publish_pack.title, /player trust test/i);
  assert.doesNotMatch(
    pack.platform_publish_manifest.outputs.youtube_shorts.cover_frame.headline,
    /player trust test/i,
  );
  assert.match(pack.youtube_publish_pack.title, /Guild Wars 3/i);
  assert.ok(
    evidence.failures.some((failure) => failure.reason === "internal_review_language_in_public_copy"),
  );
});

test("goal proof package blocks generic split-player fallback packaging", () => {
  const story = greenStory();
  story.id = "vesper-underground-generic-split-player-pack";
  story.canonical_subject = "Vesper Underground";
  story.canonical_game = "Vesper Underground";
  story.canonical_angle = "source_locked_update";
  story.public_title = "Vesper Underground";
  story.title = "Vesper Underground";
  story.primary_source = "PlayStation Blog";
  story.source_name = "PlayStation Blog";
  story.description =
    "Vesper Underground needs one concrete player-facing detail before it becomes more than a feed item.";
  story.full_script =
    "Vesper Underground has one update players are watching. Follow Pulse Gaming so you never miss a beat.";

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-06-20T01:45:00.000Z",
  });

  const evidence = pack.platform_publish_manifest.platform_native_evidence;
  assert.equal(evidence.verdict, "fail");
  assert.match(pack.youtube_publish_pack.title, /Vesper Underground/i);
  assert.ok(evidence.failures.some((failure) => failure.reason === "weak_platform_title"));
  assert.ok(
    evidence.failures.some((failure) => failure.reason === "internal_review_language_in_public_copy"),
  );
});

test("goal proof package does not infer price risk from generic scaffold evidence", () => {
  const story = greenStory();
  story.id = "doom-composer-generic-price-scaffold";
  story.canonical_subject = "Doom Composer";
  story.canonical_game = "Doom Composer";
  story.title = "Doom soundtrack composer Bobby Prince dies aged 81";
  story.public_title = "Doom soundtrack composer Bobby Prince dies aged 81";
  story.source_name = "Eurogamer";
  story.primary_source = "Eurogamer";
  story.description =
    "Doom soundtrack composer Bobby Prince dies aged 81. The useful question is what players, creators or the wider community can actually judge next: footage, release timing, price, platform access or a feature that changes how the game feels.";
  story.full_script =
    "Doom soundtrack composer Bobby Prince dies aged 81. The useful question is what players, creators or the wider community can actually judge next: footage, release timing, price, platform access or a feature that changes how the game feels. Follow Pulse Gaming so you never miss a beat.";

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-06-21T18:40:00.000Z",
  });

  assert.doesNotMatch(pack.youtube_publish_pack.title, /Price Timing Risk/i);
  assert.ok(
    pack.platform_publish_manifest.platform_native_evidence.failures.some(
      (failure) => failure.reason === "internal_review_language_in_public_copy",
    ),
  );
});

test("goal proof package rewrites current high-interest stories away from split-player fallbacks", () => {
  const cases = [
    {
      id: "guild-wars-mmo-identity-pack",
      subject: "Guild Wars 3",
      description:
        "Guild Wars 3 is significantly more of an MMO than the first game, but ArenaNet says all three games can coexist as different experiences.",
      expectedTitle: /Guild Wars 3 Has An MMO Identity Fight/i,
      expectedCover: /MMO IDENTITY/i,
    },
    {
      id: "path-economy-pack",
      subject: "Path of Exile 2",
      description:
        "Path of Exile 2's director says players exploiting a system to become in-game millionaires ruined Christmas for the team.",
      expectedTitle: /Path of Exile 2 Has A Loot Economy Problem/i,
      expectedCover: /LOOT ECONOMY/i,
    },
    {
      id: "pubg-ai-teammate-pack",
      subject: "PUBG",
      publicTitle: "PUBG Just Changed The Watchlist",
      description:
        "PUBG has GenAI team mates now capable of intelligent decision-making, while Krafton is also working on bots for the military.",
      expectedTitle: /PUBG Has An AI Teammate Risk/i,
      expectedCover: /AI TEAMMATE/i,
    },
  ];

  for (const item of cases) {
    const story = greenStory(item.id);
    story.canonical_subject = item.subject;
    story.canonical_game = item.subject;
    story.canonical_angle = "source_locked_update";
    story.public_title = item.publicTitle || item.subject;
    story.title = item.publicTitle || item.subject;
    story.suggested_thumbnail_text = `WHY ${item.subject.toUpperCase()} COULD SPLIT PLAYERS`;
    story.primary_source = "PC Gamer";
    story.source_name = "PC Gamer";
    story.description = item.description;
    story.full_script =
      `${item.subject} has a player-facing update that changes the debate around what comes next. PC Gamer reports the detail with enough specificity to judge the risk. The useful question is whether this improves the game or exposes a bigger trust problem. Follow Pulse Gaming so you never miss a beat.`;

    const pack = buildGoalProofPackage({
      story,
      rightsLedger: rightsForGreenStory(story),
      generatedAt: "2026-06-20T02:55:00.000Z",
    });

    const youtube = pack.platform_publish_manifest.outputs.youtube_shorts;
    assert.match(youtube.title, item.expectedTitle);
    assert.match(youtube.cover_frame.headline, item.expectedCover);
    assert.doesNotMatch(youtube.title, /Could Split Players/i);
    assert.doesNotMatch(youtube.cover_frame.headline, /COULD SPLIT PLAYERS/i);
  }
});

test("goal proof package repairs sentence-style cover headlines into compact stop-scroll hooks", () => {
  const story = greenStory();
  story.id = "sea-of-thieves-sentence-cover-pack";
  story.canonical_subject = "Sea of Thieves";
  story.canonical_game = "Sea of Thieves";
  story.canonical_angle = "source_locked_update";
  story.public_title = "Sea of Thieves";
  story.title = "Sea of Thieves";
  story.suggested_thumbnail_text = "WHY SEA OF THIEVES COULD SPLIT PLAYERS";
  story.primary_source = "Xbox Wire";
  story.source_name = "Xbox Wire";
  story.description = "Sea of Thieves is testing a risky idea: safer seas.";
  story.full_script =
    "Sea of Thieves is testing a risky idea with safer seas. The player question is whether that makes the game easier to enter or splits the community around risk. Follow Pulse Gaming so you never miss a beat.";

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-06-20T02:25:00.000Z",
  });

  const evidence = pack.platform_publish_manifest.platform_native_evidence;
  const youtube = pack.platform_publish_manifest.outputs.youtube_shorts;
  assert.equal(evidence.verdict, "pass");
  assert.equal(youtube.title, "Sea of Thieves Has A Safer Seas Risk");
  assert.equal(youtube.cover_frame.headline, "SAFER SEAS RISK");
  assert.doesNotMatch(youtube.cover_frame.headline, /^WHY SEA OF THIEVES COULD SPLIT PLAYERS$/i);
  assert.doesNotMatch(
    evidence.failures.map((failure) => failure.reason).join("\n"),
    /weak_cover_headline|plain_platform_description|weak_platform_title/,
  );
});

test("goal proof package gives current platform and content stories concrete stop-scroll titles", () => {
  const cases = [
    {
      id: "planet-crafter-ps5-pack",
      subject: "The Planet Crafter",
      source: "PlayStation Blog",
      description: "The Planet Crafter launches on PS5 on July 21, bringing its survival terraforming loop to console players.",
      expectedTitle: "The Planet Crafter Lands On PS5",
      expectedCover: "PLANET CRAFTER PS5",
    },
    {
      id: "fc-26-ea-play-pack",
      subject: "EA SPORTS FC 26",
      source: "Xbox Wire",
      description: "EA SPORTS FC 26 is now available through EA Play for football fans who skipped the full-price launch.",
      expectedTitle: "EA SPORTS FC 26 Just Hit EA Play",
      expectedCover: "FC 26 EA PLAY",
    },
    {
      id: "dave-diver-jungle-pack",
      subject: "Dave The Diver",
      source: "Xbox Wire",
      description: "Dave The Diver's In The Jungle DLC is out now, adding a new biome to the dive, serve and upgrade loop.",
      expectedTitle: "Dave The Diver Just Hit The Jungle",
      expectedCover: "DAVE DIVER JUNGLE",
    },
  ];

  for (const item of cases) {
    const story = greenStory();
    story.id = item.id;
    story.canonical_subject = item.subject;
    story.canonical_game = item.subject;
    story.canonical_angle = "source_locked_update";
    story.public_title = item.subject;
    story.title = item.subject;
    story.suggested_thumbnail_text = `WHY ${item.subject.toUpperCase()} COULD SPLIT PLAYERS`;
    story.primary_source = item.source;
    story.source_name = item.source;
    story.description = item.description;
    story.full_script =
      `${item.subject} has a concrete player-facing update now. ${item.source} gives enough detail for players to judge whether it is worth another look. The useful question is whether that specific change creates real momentum, or just another update people scroll past. Follow Pulse Gaming so you never miss a beat.`;

    const pack = buildGoalProofPackage({
      story,
      rightsLedger: rightsForGreenStory(story),
      generatedAt: "2026-06-20T12:35:00.000Z",
    });

    const evidence = pack.platform_publish_manifest.platform_native_evidence;
    const youtube = pack.platform_publish_manifest.outputs.youtube_shorts;
    assert.equal(youtube.title, item.expectedTitle);
    assert.equal(youtube.cover_frame.headline, item.expectedCover);
    assert.equal(
      evidence.failures.some(
        (failure) => failure.platform === "youtube_shorts" && failure.reason === "weak_platform_title",
      ),
      false,
      item.id,
    );
    assert.equal(
      evidence.failures.some(
        (failure) => failure.platform === "youtube_shorts" && failure.reason === "weak_cover_headline",
      ),
      false,
      item.id,
    );
  }
});

test("goal proof package blocks long article-list excerpts in platform descriptions", () => {
  const story = greenStory();
  story.id = "steam-next-fest-long-excerpt-pack";
  story.canonical_subject = "Steam Next Fest";
  story.canonical_game = "Steam Next Fest";
  story.canonical_angle = "June demos are creating choice overload";
  story.public_title = "Steam Next Fest Has A Demo Overload Problem";
  story.title = "Steam Next Fest Has A Demo Overload Problem";
  story.primary_source = "GameSpot";
  story.source_name = "GameSpot";
  story.description =
    "We're spoiled for choice these days when it comes to video games, with hundreds of new titles released each month. What should you play? What's worth a roll of the dice? Duskfade https://youtu.be/example See on Steam Burn-9 https://youtu.be/example See on Steam Read more.";
  story.full_script =
    "Steam Next Fest has a discovery problem now. Thousands of demos sound exciting, but the real story is whether players can spot the few games worth their time. Follow Pulse Gaming so you never miss a beat.";

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-06-19T16:00:00.000Z",
  });

  const description = pack.platform_publish_manifest.outputs.youtube_shorts.description;
  assert.doesNotMatch(description, /https?:|See on Steam|Read more/i);
  assert.match(description, /trailers stop doing the work|playable slice|wishlists/i);
  assert.equal(
    mediaHousePrivate.platformCopyTooPlain({
      outputs: {
        youtube_shorts: {
          description:
            "We're spoiled for choice these days when it comes to video games. Duskfade https://youtu.be/example See on Steam Burn-9 https://youtu.be/example See on Steam Read more. Source: GameSpot.",
        },
      },
    }),
    true,
  );
});

test("goal proof package records a story-format signature for anti-spam variation", () => {
  const dealStory = greenStory();
  dealStory.id = "mario-deal-proof";
  dealStory.canonical_subject = "Super Mario RPG";
  dealStory.canonical_game = "Super Mario RPG";
  dealStory.canonical_angle = "price access deal";
  dealStory.public_title = "Super Mario RPG Drops To $15";
  dealStory.title = "Super Mario RPG Drops To $15";

  const gameplayStory = greenStory();
  gameplayStory.id = "expanse-gameplay-proof";
  gameplayStory.canonical_subject = "The Expanse: Osiris Reborn";
  gameplayStory.canonical_game = "The Expanse: Osiris Reborn";
  gameplayStory.canonical_angle = "first real gameplay reveal";
  gameplayStory.public_title = "The Expanse Shows Real Gameplay";
  gameplayStory.title = "The Expanse Shows Real Gameplay";

  const dealPack = buildGoalProofPackage({
    story: dealStory,
    rightsLedger: rightsForGreenStory(dealStory),
    generatedAt: "2026-05-29T01:25:00.000Z",
  });
  const gameplayPack = buildGoalProofPackage({
    story: gameplayStory,
    rightsLedger: rightsForGreenStory(gameplayStory),
    generatedAt: "2026-05-29T01:25:00.000Z",
  });

  const dealSignature = dealPack.platform_publish_manifest.platform_native_evidence.format_signature;
  const gameplaySignature = gameplayPack.platform_publish_manifest.platform_native_evidence.format_signature;

  assert.match(dealSignature, /game price watch/);
  assert.match(gameplaySignature, /gameplay showcase/);
  assert.notEqual(dealSignature, gameplaySignature);
});

test("goal proof package falls back to story source evidence when governance evidence is empty", () => {
  const story = greenStory();
  story.id = "source-evidence-proof";
  story.primary_source = "Xbox Wire";
  story.source_name = "Xbox Wire";
  story.primary_source_url = "https://news.xbox.com/en-us/2026/06/10/halo-campaign-evolved-hands-on-demo-2/";
  story.source_published_at = "2026-06-10T00:00:00.000Z";
  story.approved_direct_media_url = "https://assets.xbox.com/halo-campaign-evolved/gameplay-trailer.mp4";
  story.direct_media_candidates = [
    {
      direct_media_url: story.approved_direct_media_url,
      label: "Campaign Gameplay Trailer",
      source_family: "halo_campaign_gameplay_trailer",
      source_type: "official_xbox_video",
    },
    {
      direct_media_url: "https://assets.xbox.com/halo-campaign-evolved/developer-direct.mp4",
      label: "Developer Direct",
      source_family: "halo_campaign_developer_direct",
      source_type: "official_xbox_video",
    },
  ];
  story.confirmed_claims = [
    "Xbox Wire says Halo: Campaign Evolved showed Assault on the Control Room in hands-on demo form.",
  ];

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-06-12T10:00:00.000Z",
  });

  assert.equal(pack.source_manifest.primary_source.name, "Xbox Wire");
  assert.equal(pack.source_manifest.primary_source.url, story.primary_source_url);
  assert.equal(pack.source_manifest.primary_source.published_at, story.source_published_at);
  assert.equal(
    pack.source_manifest.primary_source.direct_media_url_if_available,
    story.approved_direct_media_url,
  );
  assert.equal(pack.source_manifest.direct_media_url_if_available, story.approved_direct_media_url);
  assert.equal(pack.source_manifest.approved_direct_media_url, story.approved_direct_media_url);
  assert.deepEqual(
    pack.source_manifest.direct_media_candidates.map((candidate) => candidate.source_family),
    ["halo_campaign_gameplay_trailer", "halo_campaign_developer_direct"],
  );
  assert.deepEqual(
    pack.source_manifest.primary_source.direct_media_candidates.map((candidate) => candidate.direct_media_url),
    [
      "https://assets.xbox.com/halo-campaign-evolved/gameplay-trailer.mp4",
      "https://assets.xbox.com/halo-campaign-evolved/developer-direct.mp4",
    ],
  );
  assert.deepEqual(pack.source_manifest.blockers, []);
  assert.deepEqual(pack.claim_inventory.confirmed, story.confirmed_claims);
});

test("goal proof package turns official direct media into trusted footage intake references", () => {
  const story = {
    id: "halo-direct-media-only-proof",
    title: "Halo: Campaign Evolved Has A Demo Trust Test",
    canonical_subject: "Halo: Campaign Evolved",
    canonical_game: "Halo: Campaign Evolved",
    suggested_thumbnail_text: "HALO DEMO TEST",
    source_name: "Xbox Wire",
    primary_source: "Xbox Wire",
    primary_source_url: "https://news.xbox.com/en-us/2026/06/10/halo-campaign-evolved-hands-on-demo-2/",
    source_published_at: "2026-06-10T00:00:00.000Z",
    direct_media_candidates: [
      {
        direct_media_url: "https://assets.xbox.com/halo-campaign-evolved/gameplay-trailer.mp4",
        label: "Campaign Gameplay Trailer",
        source_family: "halo_campaign_gameplay_trailer",
        source_type: "official_xbox_video",
      },
      {
        direct_media_url: "https://assets.xbox.com/halo-campaign-evolved/developer-direct.mp4",
        label: "Developer Direct",
        source_family: "halo_campaign_developer_direct",
        source_type: "official_xbox_video",
      },
    ],
    confirmed_claims: [
      "Xbox Wire says Halo: Campaign Evolved showed Assault on the Control Room in hands-on demo form.",
    ],
    full_script:
      "Halo: Campaign Evolved just put the remake debate where it belongs. Xbox Wire says Halo Studios showed Assault on the Control Room in hands-on form. Follow Pulse Gaming so you never miss a beat.",
  };

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: [],
    generatedAt: "2026-06-24T10:00:00.000Z",
  });

  assert.deepEqual(
    pack.source_manifest.direct_media_candidates.map((candidate) => candidate.source_family),
    ["halo_campaign_gameplay_trailer", "halo_campaign_developer_direct"],
  );
  assert.equal(pack.footage_inventory.trusted_source_pipeline.references_found, 2);
  assert.deepEqual(
    [...pack.footage_inventory.trusted_source_pipeline.distinct_reference_families].sort(),
    ["halo_campaign_gameplay_trailer", "halo_campaign_developer_direct"].sort(),
  );
  assert.deepEqual(
    pack.footage_inventory.trusted_source_pipeline.intake_queue.map((source) => source.reference_url).sort(),
    [
      "https://assets.xbox.com/halo-campaign-evolved/gameplay-trailer.mp4",
      "https://assets.xbox.com/halo-campaign-evolved/developer-direct.mp4",
    ].sort(),
  );
  assert.ok(
    !pack.footage_inventory.readiness.blockers.includes("no_trusted_footage_references_for_story"),
  );
  assert.ok(pack.footage_inventory.readiness.blockers.includes("actual_motion_clip_minimum_not_met"));
});

test("goal proof package preserves official YouTube references in source manifest", () => {
  const pack = buildGoalProofPackage({
    story: {
      id: "seed_capcom_spotlight_pressure_20260625",
      title: "Capcom Spotlight Has To Prove These Games Are More Than Names",
      canonical_subject: "Capcom Spotlight",
      canonical_game: "Capcom Spotlight",
      source_type: "official_showcase_page",
      primary_source: {
        name: "Capcom Spotlight",
        url: "https://www.capcom-games.com/showcase/spotlight/",
        type: "official_showcase_page",
      },
      source_published_at: "2026-06-25T00:00:00.000Z",
      direct_media_candidates: [
        {
          direct_media_url: "https://www.youtube.com/watch?v=cwpiuMofOeo",
          label: "Teaser: Capcom Spotlight US",
          source_family: "capcom_spotlight_us_teaser",
          source_type: "official_youtube_reference",
        },
        {
          direct_media_url_if_available: "https://www.youtube.com/watch?v=_m8DUO8gjnE",
          label: "Teaser: Capcom Spotlight UK",
          source_family: "capcom_spotlight_uk_teaser",
          source_type: "official_youtube_reference",
        },
      ],
      confirmed_claims: [
        "Capcom's official Spotlight page lists the June 25 showcase.",
      ],
      full_script:
        "Capcom has thirty minutes tonight to make three very different games feel urgent. Players need a demo, date or gameplay hook before the showcase can change what they buy, wait for or skip. Follow Pulse Gaming so you never miss a beat.",
    },
    generatedAt: "2026-06-25T11:00:00.000Z",
  });

  assert.equal(pack.source_manifest.direct_media_url_if_available, null);
  assert.equal(pack.source_manifest.approved_direct_media_url, null);
  assert.deepEqual(
    pack.source_manifest.direct_media_candidates.map((candidate) => ({
      url: candidate.direct_media_url,
      type: candidate.source_type,
      family: candidate.source_family,
      segment_validation_eligible: candidate.segment_validation_eligible,
    })),
    [
      {
        url: "https://www.youtube.com/watch?v=cwpiuMofOeo",
        type: "official_youtube_reference",
        family: "capcom_spotlight_us_teaser",
        segment_validation_eligible: false,
      },
      {
        url: "https://www.youtube.com/watch?v=_m8DUO8gjnE",
        type: "official_youtube_reference",
        family: "capcom_spotlight_uk_teaser",
        segment_validation_eligible: false,
      },
    ],
  );
});

test("goal proof package preserves explicit Grand Theft Auto VI canonical subject", () => {
  const story = greenStory("gta-vi-proof");
  story.title = "GTA VI Cover Art Reveal Sets Up The Pre-Order Fight";
  story.canonical_subject = "Grand Theft Auto VI";
  story.canonical_game = "Grand Theft Auto VI";
  story.suggested_thumbnail_text = "GTA VI PREORDER TEST";
  story.full_script =
    "Rockstar just put Jason and Lucia back at the centre of Grand Theft Auto VI. Rockstar Newswire says the new cover art is live and pre-orders open on June 25. Pre-order because it is gaming's safest blockbuster, or wait until Rockstar proves what the money actually buys. Follow Pulse Gaming so you never miss a beat.";

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-06-24T10:00:00.000Z",
  });

  assert.equal(pack.canonical_story_manifest.canonical_subject, "Grand Theft Auto VI");
  assert.equal(pack.canonical_story_manifest.canonical_game, "Grand Theft Auto VI");
  assert.equal(pack.canonical_story_manifest.thumbnail_headline, "GTA VI PREORDER TEST");
});

test("goal proof package separates adjacent story formats for anti-spam variation", () => {
  const tacticsStory = greenStory();
  tacticsStory.id = "star-wars-tactics-proof";
  tacticsStory.canonical_subject = "Star Wars Zero Company";
  tacticsStory.canonical_game = "Star Wars Zero Company";
  tacticsStory.canonical_angle = "tactics comparison";
  tacticsStory.public_title = "Star Wars Zero Company Is More Than XCOM";
  tacticsStory.title = "Star Wars Zero Company Is More Than XCOM";

  const productionStory = greenStory();
  productionStory.id = "pragmata-handmade-proof";
  productionStory.canonical_subject = "Pragmata";
  productionStory.canonical_game = "Pragmata";
  productionStory.canonical_angle = "handmade production process";
  productionStory.public_title = "Pragmata's AI-Look Stage Was Handmade";
  productionStory.title = "Pragmata's AI-Look Stage Was Handmade";

  const hardwareDateStory = greenStory();
  hardwareDateStory.id = "steam-controller-date-proof";
  hardwareDateStory.canonical_subject = "Steam Controller";
  hardwareDateStory.canonical_game = "Steam Controller";
  hardwareDateStory.canonical_angle = "hardware release date leak";
  hardwareDateStory.public_title = "Steam Controller Date May Have Leaked";
  hardwareDateStory.title = "Steam Controller Date May Have Leaked";

  const releaseDateStory = greenStory();
  releaseDateStory.id = "star-wars-racer-date-proof";
  releaseDateStory.canonical_subject = "Star Wars Racer";
  releaseDateStory.canonical_game = "Star Wars Racer";
  releaseDateStory.canonical_angle = "release date leak";
  releaseDateStory.public_title = "Star Wars Racer Date Leaked Early";
  releaseDateStory.title = "Star Wars Racer Date Leaked Early";

  const signatures = [tacticsStory, productionStory, hardwareDateStory, releaseDateStory].map((story) =>
    buildGoalProofPackage({
      story,
      rightsLedger: rightsForGreenStory(story),
      generatedAt: "2026-05-29T02:10:00.000Z",
    }).platform_publish_manifest.platform_native_evidence.format_signature,
  );

  assert.match(signatures[0], /tactics comparison/);
  assert.match(signatures[1], /creative process/);
  assert.match(signatures[2], /hardware release watch/);
  assert.match(signatures[3], /release date watch/);
  assert.equal(new Set(signatures).size, signatures.length);
});

test("goal proof package never exposes internal source-lock placeholders in social packs", () => {
  const story = greenStory();
  story.id = "star-fox-placeholder-angle";
  story.canonical_subject = "Star Fox";
  story.canonical_game = "Star Fox";
  story.canonical_angle = "source_locked_update";
  story.title = "Star Fox Just Got A Switch 2 Route";
  story.suggested_title = "Star Fox Just Got A Switch 2 Route";
  story.public_title = "Star Fox Just Got A Switch 2 Route";
  story.suggested_thumbnail_text = "STAR FOX SWITCH 2";
  story.full_script =
    "Star Fox just got a Switch 2 route for players who missed the original window. IGN reports the feature is tied to the Nintendo Switch 2 camera setup. The useful point is access, not hype.";

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-05-22T17:15:00.000Z",
  });

  const publicSocialCopy = JSON.stringify(pack.platform_publish_manifest.outputs);
  assert.doesNotMatch(publicSocialCopy, /source_locked_update/i);
  assert.doesNotMatch(publicSocialCopy, /practical catch/i);
  assert.match(pack.x_publish_pack.concise_news_post, /Switch 2 route/i);
});

test("goal proof package keeps subject parity and grammar for mascot kart derivative packs", () => {
  const story = greenStory();
  story.id = "super-yooka-kart-proof";
  story.canonical_subject = "Super Yooka-Laylee Kart";
  story.canonical_game = "Super Yooka-Laylee Kart";
  story.title = "Yooka-Laylee Kart Has A Diddy Kong Risk";
  story.suggested_title = story.title;
  story.public_title = story.title;
  story.suggested_thumbnail_text = "DIDDY KONG RISK";
  story.description =
    "Super Yooka-Laylee Kart is chasing one dangerous Diddy Kong Racing comparison, so players need to decide whether to wishlist it now or wait until the handling proves nostalgia is not doing the work.";
  story.full_script =
    "Super Yooka-Laylee Kart is going after one of racing's most dangerous comparisons. IGN says ex-Rare developers are aiming to revive the spirit of Diddy Kong Racing. The catch is handling: if the karting feels floaty, the comparison eats it alive. Follow Pulse Gaming so you never miss a beat.";
  story.source_name = "IGN";
  story.primary_source = "IGN";
  story.source_card_label = "IGN";
  story.thumbnail_source_label = "IGN";
  story.article_url =
    "https://www.ign.com/articles/super-yooka-laylee-kart-preview-ex-rare-devs-take-aim-at-reviving-the-spirit-of-diddy-kong-racing";
  story.primary_source_url = story.article_url;

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-06-22T00:20:00.000Z",
  });

  const outputs = pack.platform_publish_manifest.outputs;
  assert.equal(outputs.youtube_shorts.cover_frame.headline, "YOOKA-LAYLEE KART DIDDY RISK");
  assert.equal(outputs.instagram_reels.cover_frame.subject, "Super Yooka-Laylee Kart");
  assert.equal(outputs.instagram_reels.cover_frame.headline, "YOOKA-LAYLEE KART DIDDY RISK");
  assert.doesNotMatch(outputs.facebook_reels.explanatory_framing, /\bbecause\s+is\b/i);
  assert.doesNotMatch(outputs.x.hot_take_post, /:\s+is\s+/i);
  assert.doesNotMatch(outputs.pinterest.pin_description, /:\s+is\s+/i);
});

test("goal proof package preserves proper game-name casing in Facebook framing", () => {
  const story = greenStory();
  story.id = "marvel-tokon-proof";
  story.canonical_subject = "MARVEL Tokon: Fighting Souls";
  story.canonical_game = "MARVEL Tokon: Fighting Souls";
  story.title = "MARVEL Tokon Just Started A Roster Fight";
  story.suggested_title = story.title;
  story.public_title = story.title;
  story.suggested_thumbnail_text = "TOKON ROSTER FIGHT";
  story.description =
    "MARVEL Tokon Fighting Souls just gave fighting-game fans three reasons to argue before launch. Watch the assists, not just the faces: this reveal either makes the whole game look deeper, or exposes the exact thing it still has to prove. Source: GameSpot.";
  story.full_script =
    "MARVEL Tokon Fighting Souls just gave fighting-game fans three reasons to argue before launch. GameSpot shows Blade, Loki and Deadpool in new gameplay for Arc System Works' 4v4 tag fighter, and the roster reveal is really a team-building test. Follow Pulse Gaming so you never miss a beat.";
  story.source_name = "GameSpot";
  story.primary_source = "GameSpot";
  story.source_card_label = "GameSpot";
  story.thumbnail_source_label = "GameSpot";
  story.article_url =
    "https://www.gamespot.com/videos/marvel-tokon-fighting-souls-blade-loki-and-deadpool-gameplay-reveal-trailer-team-samurai-outriders/";
  story.primary_source_url = story.article_url;

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-07-01T22:15:00.000Z",
  });

  const framing = pack.platform_publish_manifest.outputs.facebook_reels.explanatory_framing;
  assert.match(framing, /MARVEL Tokon/);
  assert.doesNotMatch(framing, /\bmARVEL\b/);
  assert.doesNotMatch(framing, /\bfacebook_reels\b|source_locked_update/i);
});

test("goal proof package does not rewrite unrelated nostalgia copy into Diddy framing", () => {
  const story = greenStory();
  story.id = "halo-ps5-account-proof";
  story.canonical_subject = "Halo: Campaign Evolved";
  story.canonical_game = "Halo: Campaign Evolved";
  story.title = "Halo's PS5 Account Catch";
  story.suggested_title = story.title;
  story.public_title = story.title;
  story.suggested_thumbnail_text = "PS5 ACCOUNT CATCH";
  story.description =
    "Halo: Campaign Evolved on PS5 now has an Xbox account catch. Check it before you buy, because one extra sign-in can turn split-screen co-op from an easy nostalgia play into setup friction. Source: Eurogamer.";
  story.full_script =
    "Halo: Campaign Evolved has a PS5 catch players should know before they buy. Eurogamer reports the campaign is coming to PlayStation, but an Xbox account is still part of the setup. That matters because split-screen nostalgia only works if the setup feels painless. Follow Pulse Gaming so you never miss a beat.";
  story.source_name = "Eurogamer";
  story.primary_source = "Eurogamer";
  story.source_card_label = "Eurogamer";
  story.thumbnail_source_label = "Eurogamer";
  story.article_url = "https://www.eurogamer.net/halo-campaign-evolved-ps5-xbox-account";
  story.primary_source_url = story.article_url;

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-06-22T00:25:00.000Z",
  });

  const outputs = pack.platform_publish_manifest.outputs;
  assert.doesNotMatch(outputs.youtube_shorts.cover_frame.headline, /DIDDY/i);
  assert.doesNotMatch(outputs.instagram_reels.cover_frame.headline, /DIDDY/i);
  assert.doesNotMatch(JSON.stringify(outputs.facebook_reels), /DIDDY/i);
});

test("goal proof package carries landing-page attribution into publish packs", () => {
  const story = greenStory();
  story.affiliate_link_manifest = buildAffiliateLinkManifest({
    story,
    tag: "pulsegaming-21",
    generatedAt: "2026-05-22T16:45:00.000Z",
  });

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-05-22T16:46:00.000Z",
  });

  assert.equal(pack.landing_page_manifest.attribution_manifest.verdict, "pass");
  assert.equal(Object.keys(pack.landing_page_manifest.attribution_manifest.platforms).length, 7);
  assert.equal(
    pack.landing_page_manifest.link_pack.primary_link.id,
    story.affiliate_link_manifest.primary_link.id,
  );
  assert.equal(pack.platform_publish_manifest.landing_page_attribution.verdict, "pass");
  assert.match(
    pack.platform_publish_manifest.landing_page_attribution.platforms.youtube.landing_page_url,
    /utm_source=youtube/,
  );
  assert.match(pack.x_publish_pack.landing_page_link, /^\/p\//);
});

test("goal proof package keeps incomplete packages out of GREEN acceptance", () => {
  const pack = buildGoalProofPackage({
    story,
    rightsLedger,
    generatedAt: "2026-05-21T19:47:00.000Z",
  });

  assert.equal(pack.acceptance_entry.verdict, "RED");
  assert.ok(pack.acceptance_entry.blockers.includes("script:rewrite_required"));
  assert.ok(pack.acceptance_entry.blockers.includes("footage:v4_motion_blocked"));
  assert.ok(pack.publish_verdict.blockers.includes("script_scorecard:script_verdict_rewrite_required"));
  assert.ok(pack.publish_verdict.blockers.includes("footage:v4_motion_blocked"));
  assert.ok(pack.publish_verdict.blockers.includes("render:final_publish_render_missing"));
});

test("goal proof package surfaces native Shorts title description and cover failures in publish blockers", () => {
  const badCopyStory = greenStory();
  badCopyStory.id = "guild-wars-native-copy-failure";
  badCopyStory.canonical_subject = "Guild Wars 3";
  badCopyStory.canonical_game = "Guild Wars 3";
  badCopyStory.canonical_angle =
    "Guild Wars 3 needs one concrete player-facing detail before it becomes more than a feed item.";
  badCopyStory.title = "Guild Wars 3 Has An MMO Identity Fight";
  badCopyStory.suggested_title = badCopyStory.title;
  badCopyStory.public_title = badCopyStory.title;
  badCopyStory.suggested_thumbnail_text = "GUILD WARS 3 MMO IDENTITY";
  badCopyStory.description =
    "Guild Wars 3 needs one concrete player-facing detail before it becomes more than a feed item.";
  badCopyStory.source_name = "PC Gamer";
  badCopyStory.primary_source = "PC Gamer";
  badCopyStory.source_card_label = "PC Gamer";
  badCopyStory.thumbnail_source_label = "PC Gamer";
  badCopyStory.article_url = "https://www.pcgamer.com/guild-wars-3-identity";

  const pack = buildGoalProofPackage({
    story: badCopyStory,
    rightsLedger: rightsForGreenStory(badCopyStory),
    generatedAt: "2026-06-20T12:15:00.000Z",
  });

  assert.equal(pack.platform_publish_manifest.platform_native_evidence.verdict, "fail");
  assert.ok(
    pack.publish_verdict.reason_codes.includes(
      "platform_native:youtube_shorts:internal_review_language_in_public_copy",
    ),
  );
  assert.ok(
    pack.acceptance_entry.blockers.includes(
      "platform_native:youtube_shorts:internal_review_language_in_public_copy",
    ),
  );
  assert.equal(pack.publish_verdict.can_auto_publish, false);
});

test("goal proof package writes media-house score and blocks weak Shorts packaging", async () => {
  const badCopyStory = greenStory();
  badCopyStory.id = "weak-shorts-feed-packaging";
  badCopyStory.canonical_subject = "Path of Exile 2";
  badCopyStory.canonical_game = "Path of Exile 2";
  badCopyStory.title = "Path of Exile 2 Has A Loot Economy Problem";
  badCopyStory.public_title = badCopyStory.title;
  badCopyStory.suggested_thumbnail_text = "PATH EXILE 2 LOOT ECONOMY";
  badCopyStory.description =
    "Path of Exile 2 needs one concrete player-facing detail before it becomes more than a feed item.";
  badCopyStory.full_script =
    "Path of Exile 2 has one update players are watching. Follow Pulse Gaming so you never miss a beat.";
  badCopyStory.source_name = "PC Gamer";
  badCopyStory.primary_source = "PC Gamer";

  const pack = buildGoalProofPackage({
    story: badCopyStory,
    rightsLedger: rightsForGreenStory(badCopyStory),
    generatedAt: "2026-06-20T13:30:00.000Z",
  });

  assert.equal(pack.pulse_media_house_score.verdict, "RED");
  assert.ok(
    pack.pulse_media_house_score.hard_failures.includes("media_house:shorts_feed_competition_weak"),
    JSON.stringify(pack.pulse_media_house_score, null, 2),
  );
  assert.ok(
    pack.publish_verdict.reason_codes.includes("media_house:shorts_feed_competition_weak"),
    JSON.stringify(pack.publish_verdict, null, 2),
  );
  assert.ok(
    pack.acceptance_entry.blockers.includes("media_house:shorts_feed_competition_weak"),
    JSON.stringify(pack.acceptance_entry, null, 2),
  );

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-media-house-pack-"));
  await writeGoalProofPackageArtifacts(pack, { outputDir: tmp });
  assert.ok(await fs.pathExists(path.join(tmp, "pulse_media_house_score.json")));
});

test("goal proof package keeps roguelite podracing hooks instead of generic split-player copy", () => {
  const pack = buildGoalProofPackage({
    story: {
      id: "star-wars-galactic-racer",
      title: "Star Wars Podracing Has A Roguelite Risk",
      public_title: "Star Wars Podracing Has A Roguelite Risk",
      selected_title: "Star Wars Podracing Has A Roguelite Risk",
      canonical_subject: "Star Wars: Galactic Racer",
      source_name: "Xbox Wire",
      article_url: "https://news.xbox.com/en-us/2026/06/23/star-wars-galactic-racer-turns-podracing-into-roguelite/",
      suggested_thumbnail_text: "STAR WARS ROGUELITE RISK",
      thumbnail_headline: "STAR WARS ROGUELITE RISK",
      full_script: [
        "Star Wars: Galactic Racer is turning podracing into something harsher than a nostalgia lap.",
        "Xbox Wire says the new reveal frames it as a roguelite racer, where each run has to survive changing hazards, upgrades and wipeout pressure.",
        "Players have to decide whether to wishlist it for that repeat-run risk, or wait for one uncut race before trusting the pitch.",
        "If the handling makes every crash feel like a new route, this becomes a genuine wishlist fight; if it is only a familiar logo on repeat, fans will skip before lap two.",
        "Follow Pulse Gaming so you never miss a beat.",
      ].join(" "),
    },
    rightsLedger: [],
  });

  assert.equal(pack.canonical_story_manifest.public_title, "Star Wars Podracing Has A Roguelite Risk");
  assert.equal(pack.canonical_story_manifest.thumbnail_headline, "STAR WARS ROGUELITE RISK");
  assert.doesNotMatch(pack.canonical_story_manifest.public_title, /Could Split Players/i);
  assert.doesNotMatch(pack.canonical_story_manifest.thumbnail_headline, /PLAYER TEST/i);
  assert.ok(
    !pack.platform_publish_manifest.platform_native_evidence.failures.some((failure) =>
      /weak_platform_title|weak_cover_headline|plain_platform_description/.test(failure.reason),
    ),
    JSON.stringify(pack.platform_publish_manifest.platform_native_evidence.failures),
  );
  assert.match(pack.youtube_publish_pack.description, /repeat runs, wipeout pressure and handling/i);
});

test("goal proof package keeps Fatal Fury Kenshiro roster copy instead of generic platform fallbacks", () => {
  const fatalFuryStory = greenStory();
  fatalFuryStory.id = "fatal-fury-kenshiro-roster-proof";
  fatalFuryStory.canonical_subject = "Fatal Fury City Of The Wolves";
  fatalFuryStory.canonical_game = "Fatal Fury City Of The Wolves";
  fatalFuryStory.title = "Fatal Fury City Of The Wolves Gets A Kenshiro Roster Fight";
  fatalFuryStory.canonical_angle =
    "Kenshiro joining Fatal Fury City Of The Wolves turns the crossover into a real roster fight";
  fatalFuryStory.suggested_title = fatalFuryStory.title;
  fatalFuryStory.public_title = fatalFuryStory.title;
  fatalFuryStory.selected_title = fatalFuryStory.title;
  fatalFuryStory.suggested_thumbnail_text = "KENSHIRO ROSTER FIGHT";
  fatalFuryStory.thumbnail_headline = "KENSHIRO ROSTER FIGHT";
  fatalFuryStory.source_name = "Xbox Wire";
  fatalFuryStory.primary_source = "Xbox Wire";
  fatalFuryStory.source_card_label = "Xbox Wire";
  fatalFuryStory.thumbnail_source_label = "Xbox Wire";
  fatalFuryStory.article_url = "https://news.xbox.com/en-us/2026/06/30/fatal-fury-city-of-the-wolves-kenshiro/";
  fatalFuryStory.description =
    "Xbox Wire says the Fist of the North Star icon is joining Fatal Fury, so players have a choice: jump back in for a wilder roster or wait until the moveset proves it belongs. If he feels pasted in, the crossover becomes noise. Source: Xbox Wire.";
  fatalFuryStory.full_script = [
    "City of the Wolves just pulled in Kenshiro.",
    "Xbox Wire says the Fist of the North Star icon is joining Fatal Fury, so players have a choice: jump back in for a wilder roster or wait until the moveset proves it belongs.",
    "Guest fighters work when they change range, pressure and rhythm.",
    "They fail when they look wild in a trailer and play like a costume.",
    "Kenshiro has to bring manga weight into SNK's clean flow without making the roster feel desperate.",
    "If he lands, City of the Wolves gets a new audience fight.",
    "If he feels pasted in, the crossover becomes noise.",
    "Follow Pulse Gaming so you never miss a beat.",
  ].join(" ");

  const pack = buildGoalProofPackage({
    story: fatalFuryStory,
    rightsLedger: rightsForGreenStory(fatalFuryStory),
    generatedAt: "2026-06-30T13:30:00.000Z",
  });

  assert.equal(pack.youtube_publish_pack.title, "Fatal Fury City Of The Wolves Gets A Kenshiro Roster Fight");
  assert.equal(pack.canonical_story_manifest.thumbnail_headline, "KENSHIRO ROSTER FIGHT");
  assert.equal(pack.canonical_story_manifest.first_frame_text, "KENSHIRO ROSTER FIGHT");
  assert.doesNotMatch(pack.youtube_publish_pack.title, /Could Split Players/i);
  assert.match(pack.youtube_publish_pack.description, /Kenshiro/i);
  assert.match(pack.youtube_publish_pack.description, /roster argument|moveset|guest/i);
  assert.match(pack.instagram_publish_pack.caption, /Kenshiro/i);
  assert.match(pack.facebook_publish_pack.page_caption, /Kenshiro/i);
  assert.ok(
    !pack.publish_verdict.reason_codes.some((reason) =>
      /public_output:thumbnail_missing_canonical_subject|public_copy:platform_copy_missing_canonical_subject/.test(reason),
    ),
    JSON.stringify(pack.publish_verdict.reason_codes, null, 2),
  );
  assert.ok(
    !pack.platform_publish_manifest.platform_native_evidence.failures.some((failure) =>
      /weak_platform_title|plain_platform_description/.test(failure.reason),
    ),
    JSON.stringify(pack.platform_publish_manifest.platform_native_evidence.failures),
  );
});

test("goal proof package writes goal-named artefacts", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-proof-"));
  const pack = buildGoalProofPackage({
    story,
    rightsLedger,
    generatedAt: "2026-05-21T19:50:00.000Z",
  });

  const written = await writeGoalProofPackageArtifacts(pack, { outputDir: tmp });

  for (const basename of [
    "script_scorecard.json",
    "footage_inventory.json",
    "director_beat_map.json",
    "audio_manifest.json",
    "sfx_manifest.json",
    "visual_quality_report.json",
    "forensic_qa_report.json",
    "benchmark_report.json",
    "affiliate_link_manifest.json",
    "finance_crypto_risk_report.json",
    "uniqueness_report.json",
    "retention_report.json",
    "experiment_manifest.json",
    "platform_publish_manifest.json",
    "platform_variant_scorecard.json",
  ]) {
    assert.equal(await fs.pathExists(path.join(tmp, basename)), true, basename);
  }
  assert.equal(Object.keys(written).length >= 15, true);
});

test("goal proof package writes explicit materialised motion clip evidence", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-proof-motion-"));
  const clipA = path.join(tmp, "clip-a.mp4");
  const clipB = path.join(tmp, "clip-b.mp4");
  await fs.writeFile(clipA, "fake mp4 a");
  await fs.writeFile(clipB, "fake mp4 b");
  const motionStory = {
    ...greenStory(),
    id: "motion-evidence-story",
    video_clips: [
      {
        id: "clip-a",
        path: clipA,
        source_url: "https://example.com/clip-a.mp4",
        source_family: "family-a",
        source_type: "official_game_site_news_page",
        validated: true,
        materialized: true,
        local_materialized_path: clipA,
      },
      {
        id: "clip-b",
        path: clipB,
        source_url: "https://example.com/clip-b.mp4",
        source_family: "family-b",
        source_type: "official_game_site_news_page",
        validated: true,
        materialized: true,
        local_materialized_path: clipB,
      },
    ],
  };
  const pack = buildGoalProofPackage({
    story: motionStory,
    rightsLedger: rightsForGreenStory(motionStory),
    generatedAt: "2026-06-23T10:00:00.000Z",
  });

  await writeGoalProofPackageArtifacts(pack, { outputDir: tmp });
  const motion = await fs.readJson(path.join(tmp, "materialised_motion_clips.json"));

  assert.equal(motion.status, "ready");
  assert.equal(motion.clip_count, 2);
  assert.equal(motion.distinct_motion_family_count, 2);
  assert.equal(motion.clips[0].local_materialized_path, clipA);
  assert.equal(motion.clips[1].local_materialized_path, clipB);
});

test("goal proof package materialises every claimed GREEN acceptance artefact", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-proof-complete-"));
  const story = greenStory();
  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-05-21T23:40:00.000Z",
  });

  assert.equal(pack.acceptance_entry.verdict, "GREEN");
  await writeGoalProofPackageArtifacts(pack, { outputDir: tmp });

  for (const basename of pack.acceptance_entry.artefacts) {
    assert.equal(await fs.pathExists(path.join(tmp, basename)), true, basename);
  }
  const renderStat = await fs.stat(path.join(tmp, "visual_v4_render.mp4"));
  assert.ok(renderStat.size > 1000, "visual_v4_render.mp4 should be a real local proof video");
  const renderManifest = await fs.readJson(path.join(tmp, "render_manifest.json"));
  assert.equal(renderManifest.final_publish_render, true);
  assert.equal(renderManifest.quality_gate_status, "post_render_forensics_passed");
});

test("goal proof package carries failed final-render forensic blockers into publish verdict", () => {
  const story = greenStory();
  story.render_manifest = {
    ...story.render_manifest,
    quality_gate_status: "post_render_forensics_failed",
    post_render_forensic_result: "fail",
    rendered_duration_s: 32.879,
    post_render_forensic_blockers: [
      "distinct_motion_families_minimum_not_met",
      "voice_cadence:wpm_too_fast",
      "visual_quality_failed",
    ],
  };

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-05-21T23:45:00.000Z",
  });

  assert.equal(pack.acceptance_entry.verdict, "RED");
  assert.ok(pack.publish_verdict.reason_codes.includes("render:post_render_forensics_missing"));
  assert.ok(pack.publish_verdict.reason_codes.includes("normal_production_duration_below_quality_floor:32.879"));
  assert.ok(pack.publish_verdict.reason_codes.includes("distinct_motion_families_minimum_not_met"));
  assert.ok(pack.publish_verdict.reason_codes.includes("voice_cadence:wpm_too_fast"));
  assert.ok(pack.publish_verdict.reason_codes.includes("visual_quality_failed"));
  assert.ok(!pack.publish_verdict.reason_codes.includes("render:final_publish_render_missing"));
});

test("goal proof package does not overwrite an existing final render with a local proof render", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-proof-preserve-final-"));
  const finalRenderPath = path.join(tmp, "visual_v4_render.mp4");
  const existingBytes = Buffer.alloc(4096, 9);
  await fs.outputFile(finalRenderPath, existingBytes);
  const story = greenStory();
  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsForGreenStory(story),
    generatedAt: "2026-05-21T23:45:00.000Z",
  });

  assert.equal(pack.render_manifest.final_publish_render, true);
  await writeGoalProofPackageArtifacts(pack, { outputDir: tmp });

  assert.deepEqual(await fs.readFile(finalRenderPath), existingBytes);
});
