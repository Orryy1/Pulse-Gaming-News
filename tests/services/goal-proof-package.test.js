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
    audio_path: "output/audio/forza-green-proof.mp3",
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
  assert.doesNotMatch(outputs.youtube_shorts.cover_frame.headline, /\b(?:MAKE|HAS|TO|INTO|WITH)$/i);
  assert.equal(mediaHousePrivate.platformCopyTooPlain(pack.platform_publish_manifest), false);
  assert.equal(
    mediaHousePrivate.weakFirstFrameOrThumbnailCopy({}, pack.platform_publish_manifest),
    false,
  );
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
  assert.match(youtube.title, /\bDemo Trust Test\b/i);
  assert.doesNotMatch(youtube.title, /\bPS5 Survival Risk\b/i);
  assert.match(youtube.description, /\b(?:trust|problem|before launch|test)\b/i);
  assert.doesNotMatch(youtube.cover_frame.headline, /^GRANBLUE FANTASY RELINK DEMO$/i);
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

  const description = pack.platform_publish_manifest.outputs.youtube_shorts.description;
  assert.match(description, /\b(?:retro|trust|problem|combat|exploration)\b/i);
  assert.equal(mediaHousePrivate.platformCopyTooPlain(pack.platform_publish_manifest), false);
});

test("goal proof package gives Free Play Days roundups a free-access risk description", () => {
  const story = greenStory();
  story.id = "free-play-days-copy-pack";
  story.canonical_subject = "Free Play Days";
  story.canonical_game = "Free Play Days";
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

  const description = pack.platform_publish_manifest.outputs.youtube_shorts.description;
  assert.match(description, /\b(?:free|risk|worth keeping|trial|tonight)\b/i);
  assert.equal(mediaHousePrivate.platformCopyTooPlain(pack.platform_publish_manifest), false);
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
  assert.deepEqual(pack.source_manifest.blockers, []);
  assert.deepEqual(pack.claim_inventory.confirmed, story.confirmed_claims);
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
  assert.equal(renderManifest.visual_tier, "local_proof_motion_graphic");
  assert.equal(renderManifest.final_publish_render, false);
});
