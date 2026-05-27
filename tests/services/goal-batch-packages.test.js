"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  augmentStoriesWithRevenuePaths,
  buildGoalBatchPackages,
  prepareStoryForGoalProof,
  writeGoalBatchPackages,
} = require("../../lib/goal-batch-packages");

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
}

function greenStory(id = "green-one") {
  const clips = Array.from({ length: 7 }, (_, index) => ({
    id: `${id}-clip-${index + 1}`,
    path: `output/video/${id}-clip-${index + 1}.mp4`,
    source_url: `https://cdn.example.com/${id}-clip-${index + 1}.mp4`,
    source_family: `${id}_family_${index + 1}`,
    source_type: "official_trailer",
    rights_risk_class: "official_reference_only",
    durationS: 2.8,
    validated: true,
  }));
  return {
    id,
    canonical_subject: "Forza Horizon 6",
    canonical_game: "Forza Horizon 6",
    canonical_angle: "paid early access created a major Steam demand signal",
    title: "Forza Horizon 6 Steam Peak Exposes Xbox's Early-Access Bet",
    suggested_title: "Forza Horizon 6 Steam Peak Exposes Xbox's Early-Access Bet",
    suggested_thumbnail_text: "FORZA STEAM SPIKE",
    thumbnail_source_label: "GamesRadar+",
    source_card_label: "GamesRadar+",
    source_name: "GamesRadar+",
    primary_source: "GamesRadar+",
    article_url: "https://www.gamesradar.com/forza-horizon-6-steam",
    manual_caption_generated: true,
    transformative_edit_evidence: true,
    audio_path: `output/audio/${id}.mp3`,
    full_script:
      "Forza Horizon 6 just gave Xbox the paid access warning it needed. GamesRadar+ reports 178,009 concurrent Steam players and a 92 Metacritic aggregate. The catch is that this happened before the standard launch, with some players paying $120. That means demand is real, but the final ceiling is not settled yet. Follow Pulse Gaming so you never miss a beat.",
    video_clips: clips,
    sfx_asset_inventory: licensedSfxAssets(),
    affiliate_link_manifest: { story_id: id, vertical: "gaming", disclosure_required: false },
  };
}

function rightsFor(story) {
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
      source_type: "local_tts_voice",
      licence_basis: "owned_local_voice_model",
      allowed_platforms: ["youtube", "tiktok", "instagram", "facebook"],
      commercial_use_allowed: true,
      risk_score: 0.05,
      evidence_file: "rights/local-tts.json",
    },
    ...(story.sfx_asset_inventory || []).map((asset) => ({
      ...asset,
      asset_type: "sfx",
      allowed_platforms: ["youtube", "tiktok", "instagram", "facebook", "x", "threads", "pinterest"],
      risk_score: 0.08,
      evidence_file: `rights/${asset.asset_id}.json`,
    })),
  ];
}

test("goal batch packages summarise GREEN and blocked story packages honestly", () => {
  const ready = greenStory("green-one");
  const weak = { id: "weak-one", title: "This gaming story", full_script: "This gaming story has a source-backed update." };
  const batch = buildGoalBatchPackages({
    stories: [ready, weak],
    rightsLedgerByStory: { [ready.id]: rightsFor(ready) },
    generatedAt: "2026-05-21T20:05:00.000Z",
  });

  assert.equal(batch.summary.story_count, 2);
  assert.equal(batch.summary.green_count, 1);
  assert.equal(batch.story_packages[0].verdict, "GREEN");
  assert.equal(batch.story_packages[1].verdict, "RED");
});

test("goal batch packages write per-story artefacts and goal-contract story packages", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-batch-"));
  const ready = greenStory("green-one");
  const batch = buildGoalBatchPackages({
    stories: [ready],
    rightsLedgerByStory: { [ready.id]: rightsFor(ready) },
    generatedAt: "2026-05-21T20:10:00.000Z",
  });

  const written = await writeGoalBatchPackages(batch, {
    outputDir: path.join(tmp, "packages"),
    contractOutDir: path.join(tmp, "goal-contract"),
  });

  assert.equal(await fs.pathExists(path.join(tmp, "packages", "green-one", "script_scorecard.json")), true);
  assert.equal(await fs.pathExists(path.join(tmp, "goal-contract", "story-packages.json")), true);
  assert.equal((await fs.readJson(written.storyPackagesPath))[0].verdict, "GREEN");
});

test("goal batch packages can fill audit candidates from revenue paths without marking them ready", () => {
  const stories = augmentStoriesWithRevenuePaths(
    [{ id: "existing", title: "Existing Story" }],
    {
      top_paths: [
        { story_id: "existing", title: "Existing Story" },
        { story_id: "revenue-one", title: "Forza Horizon 6" },
        { story_id: "revenue-two", title: "Steam Deck OLED" },
      ],
    },
    3,
  );

  assert.deepEqual(stories.map((story) => story.id), ["existing", "revenue-one", "revenue-two"]);
  assert.equal(stories[1].source_type, "revenue_path_candidate");
  assert.equal(stories[1].full_script, "");
});

test("goal batch packages hydrate revenue stubs from per-story commercial manifests", () => {
  const stories = augmentStoriesWithRevenuePaths(
    [],
    {
      top_paths: [
        {
          story_id: "1thsxw7",
          title: "Forza Horizon 6",
          commercial_intent_type: "racing_game_setup",
          route: "/p/forza-horizon-6-just-broke-xbox-s-steam-ceiling",
          revenue_manifest: {
            title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
            landing_page: {
              source_links: [
                {
                  label: "Source",
                  url: "https://thephrasemaker.com/2026/05/19/forza-horizon-6-is-already-a-massive-success/",
                },
                {
                  label: "Reddit discussion",
                  url: "https://reddit.com/r/pcmasterrace/comments/1thsxw7/forza_horizon_6_achieved_a_peak_of_over_273k/",
                },
              ],
            },
            disclosure: {
              required: true,
              copy: { short: "Affiliate links may earn us a commission." },
            },
            offer_stack: {
              primary_offer: {
                label: "Racing wheel",
                product_category: "racing wheel",
                tracking_url: "/go/1thsxw7/racing-wheel-racing-wheel-ps5-xbox-pc?platform=story_page&cta=racing%20wheel",
              },
            },
          },
        },
      ],
    },
    1,
  );

  const prepared = prepareStoryForGoalProof(stories[0]);

  assert.equal(stories[0].title, "Forza Horizon 6 Just Broke Xbox's Steam Ceiling");
  assert.equal(stories[0].source_type, "rss");
  assert.equal(stories[0].article_url, "https://thephrasemaker.com/2026/05/19/forza-horizon-6-is-already-a-massive-success/");
  assert.notEqual(prepared.primary_source, "Source");
  assert.match(prepared.full_script, /Forza Horizon 6/i);
  assert.match(prepared.full_script, /The Phrasemaker/i);
  assert.notEqual(prepared.public_title, "Forza Horizon 6");
  assert.equal(prepared.affiliate_disclosure, "Affiliate links may earn us a commission.");
});

test("goal batch packages do not turn source-only stories into GREEN generated-card videos", () => {
  const raw = {
    id: "expanse-proof-motion",
    title: "The Expanse: Osiris Reborn official gameplay trailer",
    suggested_title: "The Expanse Game Finally Looks Real",
    canonical_subject: "The Expanse",
    source_name: "Xbox",
    primary_source: "Xbox",
    source_type: "official",
    article_url: "https://www.youtube.com/watch?v=official-expanse",
    suggested_thumbnail_text: "EXPANSE GAMEPLAY",
    affiliate_url: "https://www.amazon.co.uk/s?k=xbox&tag=orryy-21",
    full_script:
      "The Expanse: Osiris Reborn finally has the thing licensed games usually hide: real gameplay. Xbox showed a narrative sci-fi action game built around The Expanse universe, not just a logo and a promise. That matters because players can now judge the combat, world and Mass Effect-style pitch. But the catch is brutal: a famous licence only helps if the game actually feels worth playing. Follow Pulse Gaming so you never miss a beat.",
  };

  const prepared = prepareStoryForGoalProof(raw);
  const batch = buildGoalBatchPackages({
    stories: [raw],
    generatedAt: "2026-05-21T21:30:00.000Z",
  });

  assert.equal(prepared.video_clips.length, 0);
  assert.equal(prepared.affiliate_disclosure, "Affiliate links may earn us a commission.");
  assert.equal(batch.summary.green_count, 0);
  assert.equal(batch.summary.red_count, 1);
  assert.equal(batch.story_packages[0].verdict, "RED");
  assert.ok(batch.story_packages[0].blockers.includes("footage:v4_motion_blocked"));
});

test("goal batch packages hydrate existing Visual V4 motion packs instead of using generated cards", () => {
  const story = {
    id: "forza-rich-restore",
    title: "Forza Horizon 6 Steam Peak Exposes Xbox's Early-Access Bet",
    suggested_title: "Forza Horizon 6 Steam Peak Exposes Xbox's Early-Access Bet",
    canonical_subject: "Forza Horizon 6",
    source_name: "GamesRadar+",
    source_type: "rss",
    article_url: "https://www.gamesradar.com/forza-horizon-6-steam",
    audio_path: "output/audio/forza-rich-restore.mp3",
    sfx_asset_inventory: licensedSfxAssets(),
    full_script:
      "Forza Horizon 6 just gave Xbox the paid access warning it needed. GamesRadar+ reports a major Steam peak during Premium Edition early access. That makes the number a paid-access stress test, not the final demand ceiling. Follow Pulse Gaming so you never miss a beat.",
  };
  const clips = Array.from({ length: 5 }, (_, index) => ({
    id: `v4-motion-${index + 1}`,
    type: "motion_clip",
    source_family: `forza_official_gameplay_${index + 1}`,
    path: `C:\\media\\forza-rich-restore-${index + 1}.mp4`,
    source_url: `https://video.example.test/forza-rich-restore-${index + 1}.mp4`,
    source_type: "official_trailer_segment",
    rights_risk_class: "official_reference_only",
    allowed_render_use: "reference_only_by_default",
    durationS: 4.8,
    validated: true,
  }));
  const motionPack = {
    readiness: { status: "v4_motion_ready", blockers: [] },
    clips,
    handoff: { visual_v4_local_motion_clips: clips },
  };

  const batch = buildGoalBatchPackages({
    stories: [story],
    motionPackByStory: { [story.id]: motionPack },
    rightsLedgerByStory: { [story.id]: rightsFor({ ...story, video_clips: clips }) },
    generatedAt: "2026-05-23T14:20:00.000Z",
  });

  const pack = batch.packages[0];
  assert.equal(pack.footage_inventory.readiness.status, "v4_motion_ready");
  assert.equal(pack.footage_inventory.motion_inventory.accepted_local_clips.length, 5);
  assert.equal(pack.footage_inventory.motion_inventory.accepted_local_clips[0].source_type, "official_trailer_segment");
  assert.equal(pack.acceptance_entry.verdict, "GREEN");
  assert.equal(batch.summary.green_count, 1);
});

test("goal batch packages rewrite generic one-detail proof titles before publishing packs", () => {
  const raw = {
    id: "price-hike-proof",
    title: "PlayStation Plus Premium and Extra tiers are now more expensive too",
    suggested_title: "PlayStation Plus Has One Detail Players Should Notice",
    canonical_subject: "PlayStation Plus",
    source_name: "Eurogamer",
    primary_source: "Eurogamer",
    source_type: "rss",
    article_url: "https://www.eurogamer.net/playstation-plus-price-increase",
    suggested_thumbnail_text: "PLAYSTATION PLUS",
    full_script:
      "PlayStation Plus just gave subscribers the price warning they needed. Eurogamer says Premium and Extra tiers are now more expensive too. That matters because subscription value changes when the yearly bill moves. Follow Pulse Gaming so you never miss a beat.",
  };

  const prepared = prepareStoryForGoalProof(raw);

  assert.equal(prepared.public_title, "PlayStation Plus Just Got More Expensive");
  assert.doesNotMatch(prepared.public_title, /Has One Detail Players Should Notice/i);
});

test("goal batch packages give deal and general RSS stories non-generic tension titles", () => {
  const deal = prepareStoryForGoalProof({
    id: "star-fox-deal",
    title: "Stream as Fox McCloud in Star Fox With the Nintendo Switch 2 Camera, Now 45% Off",
    suggested_title: "Star Fox Has One Detail Players Should Notice",
    canonical_subject: "Star Fox",
    source_name: "IGN",
    source_type: "rss",
    article_url: "https://www.ign.com/articles/star-fox-camera-deal",
    full_script:
      "Star Fox just gave players the update they needed. IGN says the Nintendo Switch 2 camera is now 45% off. Follow Pulse Gaming so you never miss a beat.",
  });
  const update = prepareStoryForGoalProof({
    id: "helldivers-update",
    title: "Helldivers 2 legendary warbond arrives next week",
    suggested_title: "Helldivers 2 Has One Detail Players Should Notice",
    canonical_subject: "Helldivers 2",
    source_name: "IGN",
    source_type: "rss",
    article_url: "https://www.ign.com/articles/helldivers-2-warbond",
    full_script:
      "Helldivers 2 just gave players the update they needed. IGN says a legendary warbond arrives next week. Follow Pulse Gaming so you never miss a beat.",
  });

  assert.equal(deal.public_title, "Star Fox Deal Has One Catch");
  assert.equal(update.public_title, "Helldivers 2 Just Got A Crossover Push");
});

test("goal batch packages map common RSS angles to varied title structures", () => {
  const cases = [
    [
      "Warhammer 40,000: Chaos Gate Deathwatch Announced at Warhammer Skulls",
      "Warhammer 40,000",
      "Warhammer 40,000 Just Became Official",
    ],
    [
      "Helldivers 2 Is Getting a Warhammer 40,000 Legendary Warbond",
      "Helldivers 2",
      "Helldivers 2 Just Got A Crossover Push",
    ],
    [
      "PlayStation dynamic pricing might violate European law",
      "PlayStation",
      "PlayStation May Have A Legal Problem",
    ],
    [
      "Modern Warfare 4 Reveal Looks Imminent",
      "Modern Warfare 4",
      "Modern Warfare 4 Just Got A Reveal Tease",
    ],
  ];

  for (const [title, subject, expected] of cases) {
    const prepared = prepareStoryForGoalProof({
      id: expected.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      title,
      suggested_title: `${subject} Has One Detail Players Should Notice`,
      canonical_subject: subject,
      source_name: "GameSpot",
      source_type: "rss",
      article_url: "https://www.gamespot.com/articles/example/1100-0000/",
      full_script: `${subject} just gave players the update they needed. GameSpot says ${title}. Follow Pulse Gaming so you never miss a beat.`,
    });
    assert.equal(prepared.public_title, expected);
  }
});

test("goal batch proof scripts paraphrase advertiser-unfriendly source titles", () => {
  const prepared = prepareStoryForGoalProof({
    id: "xbox-leadership-risk",
    title:
      "Xbox hires analyst who said games were losing the attention battle with gambling, crypto and porn as chief strategy officer",
    article_url: "https://www.eurogamer.net/xbox-hires-analyst",
    source_type: "rss",
    source_name: "Eurogamer",
    canonical_subject: "Xbox",
    full_script: "",
  });

  assert.doesNotMatch(prepared.full_script, /\b(?:gambling|porn|casino|betting)\b/i);
  assert.match(prepared.full_script, /Eurogamer says Xbox has made another leadership move/i);
});

test("goal batch packages diversify repeated fallback title patterns across a batch", () => {
  const stories = Array.from({ length: 9 }, (_, index) => ({
    id: `content-update-${index + 1}`,
    title: `Game ${index + 1} gets a content update with a new mode`,
    suggested_title: `Game ${index + 1} Has One Detail Players Should Notice`,
    canonical_subject: `Game ${index + 1}`,
    source_name: "GameSpot",
    source_type: "rss",
    article_url: `https://www.gamespot.com/articles/game-${index + 1}/1100-0000/`,
    full_script: `Game ${index + 1} just gave players the update they needed. GameSpot says a content update adds a new mode. Follow Pulse Gaming so you never miss a beat.`,
  }));

  const batch = buildGoalBatchPackages({
    stories,
    generatedAt: "2026-05-22T01:25:00.000Z",
  });
  const titles = batch.packages.map((pack) => pack.canonical_story_manifest.short_title);
  const suffixCounts = titles.reduce((counts, title) => {
    const suffix = title.replace(/^Game \d+\s+/, "");
    counts[suffix] = (counts[suffix] || 0) + 1;
    return counts;
  }, {});

  assert.equal(Math.max(...Object.values(suffixCounts)), 3);
  assert.ok(new Set(titles).size > 3);
});
