"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("fs-extra");
const path = require("node:path");

const {
  assertSafeArtifactDir,
  buildFreshRefillViewerScript,
  runFreshRefillScriptRewrite,
} = require("../../lib/ops/fresh-refill-script-rewrite");
const { auditMassAudienceClarity } = require("../../lib/ops/transcript-audience-audit");

const ROOT = path.resolve(__dirname, "..", "..");
const TEST_ROOT = path.join(ROOT, "test", "output", "fresh-refill-script-rewrite");
const GENERIC_SCRIPT =
  "Tekken 8 has a new source detail, but the real question is still what players can do with it. Eurogamer says Tekken 8 is adding Bob to its roster and players seem pretty hyped, despite the fighting game's mounting struggles. If it changes when people buy, download, wishlist or return, the update matters. If it only repeats a headline, it needs stronger proof before it deserves attention. The next official detail has to make that choice clear: play now, wait, skip or watch for gameplay. Follow Pulse Gaming so you never miss a beat.";

function officialSourceEvidence(claim, sourceUrl) {
  return {
    status: "pass",
    source_url: sourceUrl,
    claims: [{
      text: claim,
      evidence_text: claim,
      source_url: sourceUrl,
      origin: "source_body",
    }],
  };
}

test("fresh refill rewrite preserves a concrete ESO Season One argument", () => {
  const script = buildFreshRefillViewerScript({
    job: {
      story_id: "rss_eso_season_one",
      title: "Season One: Return of the Thieves Guild is Now Live in The Elder Scrolls Online",
      source: {
        name: "The Elder Scrolls Online",
        url: "https://www.elderscrollsonline.com/en-us/news/post/70123",
      },
    },
    manifest: {
      story_id: "rss_eso_season_one",
      canonical_subject: "The Elder Scrolls Online",
      canonical_title: "The Elder Scrolls Online's Thieves Guild Has A Paid Catch",
      primary_source: "The Elder Scrolls Online",
      primary_source_url: "https://www.elderscrollsonline.com/en-us/news/post/70123",
      confirmed_claims: [
        "Season One adds eight new Thieves Guild story quests in Glenumbra.",
        "The Daggerfall Thieves Den adds access to heists, daily quests and a new Mythic reward.",
        "Every player receives a free Tamriel Tome reward track, with optional paid upgrades.",
      ],
    },
  });

  assert.equal(script.verdict, "viral_ready");
  assert.equal(script.suggested_title, "The Elder Scrolls Online's Thieves Guild Has A Paid Catch");
  assert.equal(script.suggested_thumbnail_text, "ELDER SCROLLS: FREE OR PAID?");
  assert.match(script.full_script, /^The Elder Scrolls Online just brought back the Thieves Guild, but its reward track has a paid catch\./);
  assert.match(script.full_script, /eight story quests/i);
  assert.match(script.full_script, /Tamriel Tome/i);
  assert.match(script.description, /Every player gets a free Tamriel Tome/i);
  assert.doesNotMatch(script.full_script, /Source-Proof Risk|Player Test/i);
});

function tekkenBobJob(artifactDir) {
  return {
    story_id: "rss_4a07e21d3192fd7c",
    title: "Tekken 8 Finally Shows Real Gameplay",
    artifact_dir: artifactDir,
    source: {
      name: "Eurogamer",
      url: "https://www.eurogamer.net/tekken-8-bob-gameplay-trailer",
      type: "rss",
      published_at: "Mon, 29 Jun 2026 11:23:29 +0000",
    },
    current_script: GENERIC_SCRIPT,
    scorecard_verdict: "rewrite_required",
    scorecard_blockers: [
      "generic_title_template",
      "persuasive_authority_trope",
      "internal_audience_scaffold",
    ],
  };
}

function canonicalManifest() {
  return {
    story_id: "rss_4a07e21d3192fd7c",
    canonical_subject: "Tekken 8",
    canonical_game: "Tekken 8",
    canonical_title: "Tekken 8 Finally Shows Real Gameplay",
    primary_source: "Eurogamer",
    primary_source_url: "https://www.eurogamer.net/tekken-8-bob-gameplay-trailer",
    source_published_at: "Mon, 29 Jun 2026 11:23:29 +0000",
    confirmed_claims: [
      "Tekken 8 is adding Bob to its roster and players seem pretty hyped, despite the fighting game's mounting struggles",
    ],
    selected_title: "Tekken 8 Finally Shows Real Gameplay",
    short_title: "Tekken 8 Just Got A New Signal",
    narration_hook:
      "Tekken 8 has a new source detail, but the real question is still what players can do with it.",
    first_spoken_line:
      "Tekken 8 has a new source detail, but the real question is still what players can do with it.",
    narration_script: GENERIC_SCRIPT,
    tts_script: GENERIC_SCRIPT,
    spoken_narration_script: GENERIC_SCRIPT,
    description: "Source: Eurogamer.",
    title: "Tekken 8 Finally Shows Real Gameplay",
    public_title: "Tekken 8 Finally Shows Real Gameplay",
  };
}

function platformManifest() {
  return {
    schema_version: 1,
    story_id: "rss_4a07e21d3192fd7c",
    operating_mode: "LOCAL_PROOF",
    publish_status: "RED",
    outputs: {
      youtube_shorts: {
        title: "Tekken 8 Finally Shows Real Gameplay",
        description: "Generic description.",
        cover_frame: { headline: "TEKKEN 8 FINALLY SHOWS REAL GAMEPLAY" },
      },
      instagram_reels: {
        caption: "Generic caption.",
        cover_frame: { headline: "TEKKEN 8 FINALLY SHOWS REAL GAMEPLAY" },
      },
      facebook_reels: {
        duration_seconds: { min: 35, max: 60 },
        page_caption: "Generic page caption.",
      },
      x: {
        hot_take_post: "Generic X post.",
        thread_posts: ["Generic thread."],
      },
    },
    platform_native_evidence: {
      schema_version: 1,
      verdict: "fail",
      platforms: [
        {
          platform: "youtube_shorts",
          status: "pass",
          copy_fingerprint: "generic description old weak title",
        },
        {
          platform: "instagram_reels",
          status: "pass",
          copy_fingerprint: "generic caption old weak cover",
        },
      ],
      failures: [
        { platform: "youtube_shorts", reason: "weak_cover_headline" },
        { platform: "instagram_reels", reason: "weak_cover_headline" },
      ],
    },
  };
}

async function writeFixture(name = "case") {
  const artifactDir = path.join(TEST_ROOT, name, "artifact");
  await fs.remove(path.join(TEST_ROOT, name));
  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), canonicalManifest(), {
    spaces: 2,
  });
  await fs.writeJson(path.join(artifactDir, "platform_publish_manifest.json"), platformManifest(), {
    spaces: 2,
  });
  await fs.writeJson(path.join(artifactDir, "script_scorecard.json"), {
    verdict: "rewrite_required",
    blockers: ["internal_audience_scaffold"],
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "coherence_report.json"), {
    result: "fail",
    failures: ["script_coherence:vague_filler:internal_audience_scaffold"],
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "publish_verdict.json"), {
    verdict: "RED",
    can_auto_publish: false,
    reason_codes: [
      "script:rewrite_required",
      "platform_native:youtube_shorts:weak_platform_title",
      "platform_native:youtube_shorts:weak_cover_headline",
      "platform_native:instagram_reels:weak_cover_headline",
      "media_house:title_lacks_curiosity_gap",
      "media_house:platform_title_too_plain",
      "media_house:first_frame_or_thumbnail_not_attention_led",
      "render:final_publish_render_missing",
      "audio:narration_audio_missing",
      "captions:word_timestamps_missing",
    ],
    blockers: [
      "script:rewrite_required",
      "platform_native:youtube_shorts:weak_platform_title",
      "media_house:title_lacks_curiosity_gap",
      "render:final_publish_render_missing",
    ],
    package_quality_gate: {
      verdict: "script_blocked",
      blockers: [
        "script:rewrite_required",
        "platform_native:youtube_shorts:weak_cover_headline",
        "media_house:first_frame_or_thumbnail_not_attention_led",
        "audio:narration_audio_missing",
      ],
    },
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "goal_package_summary.json"), {
    story_id: "rss_4a07e21d3192fd7c",
    verdict: "RED",
    blockers: [
      "script:rewrite_required",
      "media_house:title_lacks_curiosity_gap",
      "platform_native:youtube_shorts:weak_cover_headline",
      "render:final_publish_render_missing",
    ],
  }, { spaces: 2 });

  const workOrderPath = path.join(TEST_ROOT, name, "work_order.json");
  await fs.writeJson(workOrderPath, {
    schema_version: 1,
    source: "test",
    jobs: [tekkenBobJob(artifactDir)],
    safety: {
      local_only: true,
      no_publish: true,
      no_db_mutation: true,
      no_oauth_or_token_mutation: true,
    },
  }, { spaces: 2 });

  return { artifactDir, workOrderPath };
}

test("fresh refill viewer script turns a generic Bob script into viral-ready narration", () => {
  const script = buildFreshRefillViewerScript({
    job: tekkenBobJob(path.join(TEST_ROOT, "unused")),
    manifest: canonicalManifest(),
  });

  assert.equal(script.verdict, "viral_ready", JSON.stringify(script.quality, null, 2));
  assert.match(script.full_script, /^Tekken 8 bringing Bob back\b/);
  assert.match(script.full_script, /Bob|roster|matchups|lapsed players/i);
  assert.match(script.full_script, /Follow Pulse Gaming so you never miss a beat\.$/);
  assert.doesNotMatch(
    script.full_script,
    /new source detail|real question|play now, wait, skip|source-backed update|the player impact is/i,
  );
  assert.deepEqual(script.quality.blockers, []);
  assert.equal(script.coherence.result, "pass");
});

test("fresh refill viewer script gives Forza Metacritic stories a concrete viral angle", () => {
  const script = buildFreshRefillViewerScript({
    job: {
      story_id: "1tdwz8e",
      title: "Forza Horizon 6 Becomes Highest Rated Game of 2026 on Metacritic",
      artifact_dir: path.join(TEST_ROOT, "unused"),
      source: {
        name: "Metacritic",
        url: "https://www.metacritic.com/game/forza-horizon-6/",
        type: "rss",
      },
      current_script:
        "Forza just gave Xbox the headline it badly needed. Metacritic says Forza Horizon 6 has moved to the top of Metacritic's 2026 list with the top Metacritic slot. Follow Pulse Gaming so you never miss a beat.",
    },
    manifest: {
      story_id: "1tdwz8e",
      canonical_subject: "Forza Horizon 6",
      canonical_game: "Forza Horizon 6",
      canonical_title: "Forza Horizon 6 Becomes Highest Rated Game of 2026 on Metacritic",
      primary_source: "Metacritic",
      primary_source_url: "https://www.metacritic.com/game/forza-horizon-6/",
      confirmed_claims: ["Forza Horizon 6 is Metacritic's highest-rated game of the year"],
      narration_script:
        "Forza just gave Xbox the headline it badly needed. Metacritic says Forza Horizon 6 has moved to the top of Metacritic's 2026 list with the top Metacritic slot. Follow Pulse Gaming so you never miss a beat.",
    },
  });

  assert.equal(script.verdict, "viral_ready", JSON.stringify(script.quality, null, 2));
  assert.equal(script.suggested_title, "Forza Horizon 6 Score Gives Xbox A Launch Test");
  assert.match(script.full_script, /^Critics love Forza Horizon 6, but that is not the real test/i);
  assert.match(script.full_script, /Metacritic/i);
  assert.match(script.full_script, /Game Pass|full-price|review score/i);
  assert.doesNotMatch(script.full_script, /top of Metacritic's 2026 list with the top Metacritic slot/i);
  assert.doesNotMatch(script.suggested_title, /Low-Risk Trial|Trust Test/i);
  assert.match(script.full_script, /Follow Pulse Gaming so you never miss a beat\.$/);
});

test("fresh refill viewer script keeps Marvel Tokon roster gameplay copy concrete early", () => {
  const script = buildFreshRefillViewerScript({
    job: {
      story_id: "rss_228f6f28b62f8426",
      title: "Blade, Loki, Deadpool Announced For MARVEL Tokon Finally Shows Real Gameplay",
      artifact_dir: path.join(TEST_ROOT, "unused"),
      source: {
        name: "PlayStation Blog",
        url: "https://blog.playstation.com/2026/06/28/blade-loki-deadpool-announced-for-marvel-tokon-fighting-souls/",
        type: "rss",
      },
      current_script:
        "PlayStation Blog says Blade, Loki, Deadpool announced for MARVEL Tokon: Fighting Souls.",
    },
    manifest: {
      story_id: "rss_228f6f28b62f8426",
      confirmed_claims: [
        "Blade, Loki and Deadpool were announced for MARVEL Tokon: Fighting Souls",
      ],
    },
  });

  assert.equal(script.verdict, "viral_ready", JSON.stringify(script.quality, null, 2));
  assert.equal(script.canonical_subject, "MARVEL Tokon");
  assert.match(script.full_script, /combat styles|movement problem/i);
  assert.match(script.full_script, /Each hero needs to create a different movement problem/i);
  assert.doesNotMatch(script.full_script, /It is about whether|players have to whether|The real question is/i);
  assert.deepEqual(script.quality.blockers, []);
  assert.equal(script.coherence.result, "pass");
});

test("fresh refill viewer script does not turn Phantom Blade in a roundup into Tokon roster news", () => {
  const sourceUrl =
    "https://blog.playstation.com/2026/07/14/19-unmissable-ps5-games-still-releasing-in-2026/";
  const script = buildFreshRefillViewerScript({
    job: {
      story_id: "rss_marvel_tokon_roundup",
      title: "MARVEL Tokon: Fighting Souls - August 6",
      source: {
        name: "PlayStation Blog",
        url: sourceUrl,
        title: "19 unmissable PS5 games still releasing in 2026",
        type: "rss",
      },
      source_evidence: {
        status: "pass",
        source_url: sourceUrl,
        headline: "19 unmissable PS5 games still releasing in 2026",
        claims: [
          {
            text: "MARVEL Tokon: Fighting Souls launches August 6 with 20 playable base heroes and villains.",
            evidence_text: "MARVEL Tokon: Fighting Souls launches August 6 with 20 playable base heroes and villains.",
            source_url: sourceUrl,
            origin: "source_body",
          },
          {
            text: "The 4v4 roster ranges from Black Panther and Doctor Doom to Spider-Man and Carnage.",
            evidence_text: "The 4v4 roster ranges from Black Panther and Doctor Doom to Spider-Man and Carnage.",
            source_url: sourceUrl,
            origin: "source_body",
          },
          {
            text: "Phantom Blade Zero is another game in the same PlayStation roundup.",
            evidence_text: "Phantom Blade Zero is another game in the same PlayStation roundup.",
            source_url: sourceUrl,
            origin: "source_body",
          },
          {
            text: "A tutorial, single-player mode and easier combo inputs are included for newcomers.",
            evidence_text: "A tutorial, single-player mode and easier combo inputs are included for newcomers.",
            source_url: sourceUrl,
            origin: "source_body",
          },
        ],
      },
    },
    manifest: {
      story_id: "rss_marvel_tokon_roundup",
      canonical_subject: "MARVEL Tokon",
      canonical_title: "MARVEL Tokon: Fighting Souls - August 6",
      primary_source: "PlayStation Blog",
      primary_source_url: sourceUrl,
      confirmed_claims: ["19 unmissable PS5 games still releasing in 2026"],
    },
  });

  assert.equal(script.verdict, "viral_ready", JSON.stringify(script.quality, null, 2));
  assert.equal(script.canonical_subject, "MARVEL Tokon");
  assert.match(script.suggested_title, /4v4|Roster/i);
  assert.match(script.full_script, /20 playable|twenty playable/i);
  assert.match(script.full_script, /Black Panther|Doctor Doom|Spider-Man|Carnage/i);
  assert.doesNotMatch(script.full_script, /Blade, Loki|Loki and Deadpool/i);
  assert.equal(script.coherence.result, "pass");
});

test("fresh refill viewer script preserves Palworld price source and does not invent Game Pass", () => {
  const script = buildFreshRefillViewerScript({
    job: {
      story_id: "seed_palworld_price_20260709",
      title: "Palworld 1.0 Just Dodged The Price Backlash",
      artifact_dir: path.join(TEST_ROOT, "unused"),
      source: {
        name: "Eurogamer",
        url: "https://www.eurogamer.net/palworld-full-release-price",
        type: "rss",
        published_at: "2026-07-08T16:00:00.000Z",
      },
      current_script:
        "Palworld just avoided the easiest way to anger its comeback crowd. Eurogamer reports Pocketpair will not raise the price for the 1.0 launch.",
    },
    manifest: {
      story_id: "seed_palworld_price_20260709",
      canonical_subject: "Palworld",
      canonical_game: "Palworld",
      primary_source: "Eurogamer",
      primary_source_url: "https://www.eurogamer.net/palworld-full-release-price",
      confirmed_claims: [
        "Eurogamer reports Pocketpair decided not to raise Palworld's price ahead of its 1.0 launch.",
      ],
    },
  });

  assert.equal(script.verdict, "viral_ready", JSON.stringify(script.quality, null, 2));
  assert.match(script.full_script, /Eurogamer reports Pocketpair/i);
  assert.match(script.full_script, /not raise Palworld's price|price steady|price/i);
  assert.doesNotMatch(script.full_script, /Xbox Wire|Game Pass|July 10, 2026/i);
  assert.deepEqual(script.quality.blockers, []);
  assert.equal(script.coherence.result, "pass");
});

test("fresh refill viewer script keeps Buckshot Roulette title clean and avoids headline recitation", () => {
  const script = buildFreshRefillViewerScript({
    job: {
      story_id: "seed_buckshot_game_pass_20260709",
      title: "Buckshot Roulette Just Turned Game Pass Into A Dare",
      artifact_dir: path.join(TEST_ROOT, "unused"),
      source: {
        name: "Xbox Wire",
        url: "https://news.xbox.com/en-us/2026/07/08/buckshot-roulette-xbox-game-pass/",
        type: "official_platform_news",
        published_at: "2026-07-08T15:00:00.000Z",
      },
      current_script:
        "Buckshot Roulette just turned Game Pass into a dare. Xbox Wire says Buckshot Roulette joined Xbox Game Pass on 2026-07-08.",
    },
    manifest: {
      story_id: "seed_buckshot_game_pass_20260709",
      canonical_subject: "Buckshot Roulette",
      canonical_game: "Buckshot Roulette",
      primary_source: "Xbox Wire",
      primary_source_url: "https://news.xbox.com/en-us/2026/07/08/buckshot-roulette-xbox-game-pass/",
      confirmed_claims: [
        "Xbox Wire says Buckshot Roulette joined Xbox Game Pass on 2026-07-08.",
      ],
    },
  });

  assert.equal(script.verdict, "viral_ready", JSON.stringify(script.quality, null, 2));
  assert.match(script.full_script, /^Buckshot Roulette just/i);
  assert.match(script.full_script, /Xbox Wire says Buckshot Roulette joined Xbox Game Pass/i);
  assert.doesNotMatch(script.full_script, /Buckshot Roulette Just Turned Game Pass Into A Dare is available/i);
  assert.deepEqual(script.quality.blockers, []);
  assert.equal(script.coherence.result, "pass");
});

test("fresh refill viewer script turns Star Wars Monopoly abilities into a clear family-drama hook", () => {
  const script = buildFreshRefillViewerScript({
    job: {
      story_id: "rss_e622e340996cda19",
      title: "Star Wars Monopoly Heroes Vs Villains Character Abilities",
      artifact_dir: path.join(TEST_ROOT, "unused"),
      source: {
        name: "Xbox Wire",
        url: "https://news.xbox.com/en-us/2026/06/29/monopoly-star-wars-heroes-villains-character-abilities/",
        type: "rss",
      },
      current_script:
        "Xbox Wire says Monopoly Star Wars Heroes versus Villains gives characters their own abilities.",
    },
    manifest: {
      story_id: "rss_e622e340996cda19",
      canonical_subject: "Monopoly Star Wars",
      canonical_game: "Monopoly Star Wars",
      confirmed_claims: [
        "Heroes versus Villains gives each character abilities in Monopoly Star Wars",
      ],
    },
  });

  assert.equal(script.verdict, "viral_ready", JSON.stringify(script.quality, null, 2));
  assert.equal(script.suggested_title, "Star Wars Monopoly Could Start Family Arguments");
  assert.equal(script.suggested_thumbnail_text, "FORCE POWERS FIGHT");
  assert.ok(script.word_count >= 100 && script.word_count <= 110, `expected a motion-safe short script, got ${script.word_count} words`);
  assert.match(script.full_script, /Heroes versus Villains gives characters unique abilities/i);
  assert.match(script.full_script, /safe gift, or another box that gets one bored match/i);
  assert.match(script.full_script, /kids get chaos and parents get stories/i);
  assert.match(script.full_script, /people argue to replay/i);
  assert.doesNotMatch(script.full_script, /proper table chaos|branded board|branded box|shelf filler|shell filler/i);
  assert.deepEqual(script.quality.blockers, []);
  assert.equal(script.coherence.result, "pass");
});

test("fresh refill viewer script blocks title-only claims even when generated copy adds details", () => {
  const sourceTitle = "Star Wars Monopoly Heroes Vs Villains Character Abilities";
  const script = buildFreshRefillViewerScript({
    job: {
      story_id: "rss_title_only_monopoly",
      title: sourceTitle,
      source: {
        name: "Xbox Wire",
        url: "https://news.xbox.com/en-us/2026/06/29/monopoly-star-wars-heroes-villains-character-abilities/",
        title: sourceTitle,
        description: "Generated copy says this is a safe gift that creates family drama.",
      },
      current_script:
        "Generated narration says kids get chaos, parents get stories and people will argue to replay.",
    },
    manifest: {
      canonical_subject: "Monopoly Star Wars",
      canonical_title: sourceTitle,
      title_candidates: [sourceTitle],
      description: "Generated copy says this is a safe gift that creates family drama.",
      confirmed_claims: [sourceTitle],
    },
  });

  assert.equal(script.verdict, "blocked");
  assert.equal(script.reason, "rewritten_angle_not_supported_by_source_claims");
  assert.ok(script.quality.blockers.includes("source_claim_scope_mismatch"));
});

test("fresh refill viewer script uses official source-body evidence for Starward", () => {
  const sourceUrl = "https://news.xbox.com/en-us/2026/07/09/meet-the-star-operator-1/";
  const evidenceSentences = [
    "Starward Version 3.1 is now live and adds Pliszka.",
    "The Wing Rider Assembly increases Pliszka's firepower and mobility but also increases her hitbox size and descent speed.",
    "Players can detach the assembly mid-battle for a more agile playstyle.",
  ];
  const script = buildFreshRefillViewerScript({
    job: {
      story_id: "rss_starward_source_body",
      title: "Starward Patch Check",
      source: {
        name: "Xbox Wire",
        url: sourceUrl,
        title: "Meet the Star Operator Who Rewrites the Ranged Rulebook in Starward V3.1",
        body: evidenceSentences.join(" "),
      },
      source_evidence: {
        status: "pass",
        source_url: sourceUrl,
        claims: evidenceSentences.map((text) => ({
          text,
          evidence_text: text,
          source_url: sourceUrl,
          origin: "source_body",
        })),
      },
      current_script: "Starward just got a boring-looking system update.",
    },
    manifest: {
      canonical_subject: "Starward",
      canonical_title: "Starward Patch Check",
      confirmed_claims: ["Meet the Star Operator Who Rewrites the Ranged Rulebook in Starward V3.1"],
    },
  });

  assert.equal(script.verdict, "viral_ready", JSON.stringify(script.quality, null, 2));
  assert.equal(script.suggested_title, "Starward's New Fighter Has A Huge Trade-Off");
  assert.match(script.full_script, /Pliszka/);
  assert.match(script.full_script, /larger hitbox|enlarges her hitbox|bigger target/i);
  assert.match(script.full_script, /detach|ditch/i);
  assert.match(script.full_script, /most controversial fighter/i);
  assert.doesNotMatch(script.full_script, /argued-over fighter/i);
  assert.doesNotMatch(script.full_script, /system update|patch notes|save|controller reliability/i);
});

test("fresh refill viewer script blocks generic review-signal fallback copy", () => {
  const sourceUrl = "https://example.com/zaxoid-review";
  const evidence =
    "Zaxoid is now sitting on a major review score in the current review conversation.";
  const script = buildFreshRefillViewerScript({
    job: {
      story_id: "rss_generic_review_signal",
      title: "Zaxoid Review Update",
      source: {
        name: "Example Reviews",
        url: sourceUrl,
        title: "Zaxoid Review Update",
        body: evidence,
      },
      source_evidence: {
        status: "pass",
        source_url: sourceUrl,
        claims: [{
          text: evidence,
          evidence_text: evidence,
          source_url: sourceUrl,
          origin: "source_body",
        }],
      },
    },
    manifest: {
      canonical_subject: "Zaxoid",
      canonical_title: "Zaxoid Review Update",
    },
  });

  assert.equal(script.verdict, "rewrite_required");
  assert.ok(script.quality.blockers.includes("generic_review_signal_template"));
});

test("fresh refill viewer script blocks an ended confirmed event before rewriting", () => {
  const script = buildFreshRefillViewerScript({
    now: new Date("2026-07-13T09:00:00.000Z"),
    job: {
      story_id: "rss_expired_free_play_days",
      title: "Xbox Free Play Days Has One Clear Winner",
      source: {
        name: "Xbox Wire",
        url: "https://news.xbox.com/en-us/2026/07/09/free-play-days-07-09-2026/",
        confirmed_event_window: {
          status: "confirmed",
          starts_at: "2026-07-09T00:00:00.000Z",
          ends_at: "2026-07-12T23:59:59.999Z",
        },
      },
      source_evidence: {
        status: "pass",
        claims: [{
          text: "MLB The Show 26, The Alters and Stuffed were available until Sunday, July 12.",
          evidence_text: "MLB The Show 26, The Alters and Stuffed were available until Sunday, July 12.",
          source_url: "https://news.xbox.com/en-us/2026/07/09/free-play-days-07-09-2026/",
          origin: "source_body",
        }],
      },
    },
    manifest: {
      canonical_subject: "Xbox Free Play Days",
      confirmed_claims: ["Free Play Days - MLB The Show 26, The Alters and Stuffed"],
    },
  });

  assert.equal(script.verdict, "blocked");
  assert.equal(script.reason, "confirmed_event_window_ended");
  assert.deepEqual(script.quality.blockers, ["confirmed_event_window_ended"]);
});

test("fresh refill viewer script rewrites Echoes of Aincrad without repeating the title", () => {
  const script = buildFreshRefillViewerScript({
    job: {
      story_id: "steam_echoes_of_aincrad_system_trailer_20260706",
      title: "Echoes of Aincrad Just Dodged A Release-Date Fight",
      artifact_dir: path.join(TEST_ROOT, "unused"),
      source: {
        name: "Steam Store",
        url: "https://store.steampowered.com/app/2244210/Echoes_of_Aincrad/",
        type: "official_storefront",
        published_at: "2026-07-06T20:45:00.000Z",
      },
      current_script:
        "Echoes of Aincrad just blinked in one of the year's most crowded release windows.",
    },
    manifest: {
      story_id: "steam_echoes_of_aincrad_system_trailer_20260706",
      canonical_subject: "Echoes of Aincrad",
      canonical_game: "Echoes of Aincrad",
      confirmed_claims: [
        "Echoes of Aincrad is listed on Steam with a 10 July 2026 release date.",
        "The official Steam listing includes system, demo and pre-order trailer footage.",
      ],
    },
  });

  assert.equal(script.verdict, "viral_ready", JSON.stringify(script.quality, null, 2));
  assert.match(script.full_script, /^Echoes of Aincrad is walking into launch week\b/);
  assert.match(script.full_script, /movement, hits, menus and enemy pressure/i);
  assert.match(script.full_script, /That means Steam's 10 July listing turns this trailer into a trust test/i);
  assert.match(script.full_script, /Follow Pulse Gaming so you never miss a beat\.$/);
  assert.doesNotMatch(
    script.full_script,
    /Echoes of Aincrad Has A Launch Week Trust Test.*Echoes of Aincrad Has A Launch Week Trust Test|just showed the part trailers usually hide|source-backed update|The argument is no longer only quality/i,
  );
  assert.deepEqual(script.quality.blockers, []);
  assert.equal(script.coherence.result, "pass");
});

test("fresh refill viewer script keeps Fatal Fury City Of The Wolves in the public title", () => {
  const script = buildFreshRefillViewerScript({
    job: {
      story_id: "rss_f2f7097c7ad52e30",
      title: "City of the Wolves Just Got Kenshiro",
      artifact_dir: path.join(TEST_ROOT, "unused"),
      source: {
        name: "Xbox Wire",
        url: "https://news.xbox.com/en-us/2026/06/29/fatal-fury-fist-of-the-north-star-kenshiro/",
        type: "rss",
      },
      current_script:
        "Xbox Wire says Kenshiro from Fist of the North Star is coming to Fatal Fury: City of the Wolves.",
    },
    manifest: {
      story_id: "rss_f2f7097c7ad52e30",
      canonical_subject: "City of the Wolves",
      confirmed_claims: [
        "Kenshiro from Fist of the North Star is coming to FATAL FURY: City of the Wolves",
      ],
    },
  });

  assert.equal(script.verdict, "viral_ready", JSON.stringify(script.quality, null, 2));
  assert.equal(script.suggested_title, "Fatal Fury City Of The Wolves Gets A Kenshiro Roster Fight");
  assert.ok(
    script.word_count >= 106 && script.word_count <= 110,
    `expected a duration-safe short script, got ${script.word_count} words`,
  );
  assert.match(script.full_script, /^Fatal Fury City of the Wolves just turned Kenshiro into a ranked-mode problem\./);
  assert.match(script.full_script, /reach, pressure, counters, combat rhythm/i);
  assert.match(script.full_script, /players will call it out fast/i);
  assert.doesNotMatch(script.full_script, /crossover becomes noise|crossover is a huge/i);
  assert.doesNotMatch(script.suggested_title, /:/, "avoid title punctuation that creates TTS title pauses");
  assert.deepEqual(script.quality.blockers, []);
  assert.equal(script.coherence.result, "pass");
  const massAudience = auditMassAudienceClarity({
    script: script.full_script,
    title: script.suggested_title,
    sourceName: "Xbox Wire",
    canonicalSubject: "Fatal Fury: City Of The Wolves",
  });
  assert.equal(massAudience.result, "pass", JSON.stringify(massAudience, null, 2));
  assert.equal(massAudience.concrete_detail_count >= 3, true);
});

test("fresh refill viewer script keeps Palworld Game Pass comeback scripts motion-safe", () => {
  const script = buildFreshRefillViewerScript({
    job: {
      story_id: "seed_palworld_10_game_pass_20260708",
      title: "Palworld 1.0 Comes To Game Pass",
      artifact_dir: path.join(TEST_ROOT, "unused"),
      source: {
        name: "Xbox Wire",
        url: "https://news.xbox.com/en-us/2026/07/08/game-pass-palworld-1-0-july-2026/",
        type: "rss",
        published_at: "2026-07-08T09:00:00.000Z",
      },
      current_script:
        "Xbox Wire reports Palworld 1.0 comes to Game Pass on July 10, 2026.",
    },
    manifest: {
      story_id: "seed_palworld_10_game_pass_20260708",
      canonical_subject: "Palworld 1.0",
      canonical_game: "Palworld",
      confirmed_claims: [
        "Xbox Wire reports Palworld 1.0 comes to Game Pass on July 10, 2026.",
      ],
    },
  });

  assert.equal(script.verdict, "viral_ready", JSON.stringify(script.quality, null, 2));
  assert.equal(script.suggested_title, "Palworld 1.0 Gets A Game Pass Comeback Test");
  assert.ok(
    script.word_count >= 88 && script.word_count <= 94,
    `expected a motion-safe Game Pass script, got ${script.word_count} words`,
  );
  assert.match(script.full_script, /^Palworld 1\.0 just got the comeback test it needed\./);
  assert.match(script.full_script, /Game Pass on July 10, 2026/i);
  assert.match(script.full_script, /reinstall first, then judge the loop/i);
  assert.match(script.full_script, /not the download count/i);
  assert.match(script.full_script, /real second launch/i);
  assert.doesNotMatch(script.full_script, /patch notes|live system update|source-backed update|the signal is/i);
  assert.doesNotMatch(script.suggested_title, /:/, "avoid title punctuation that creates TTS title pauses");
  assert.deepEqual(script.quality.blockers, []);
  assert.equal(script.coherence.result, "pass");
  const massAudience = auditMassAudienceClarity({
    script: script.full_script,
    title: script.suggested_title,
    sourceName: "Xbox Wire",
    canonicalSubject: "Palworld 1.0",
  });
  assert.equal(massAudience.result, "pass", JSON.stringify(massAudience, null, 2));
  assert.equal(massAudience.concrete_detail_count >= 3, true);
});

test("fresh refill viewer script blocks Switch 2 screen angles when the source only supports original Switch discontinuation", () => {
  const script = buildFreshRefillViewerScript({
    job: {
      story_id: "rss_456229ed9244c942",
      title: "Switch 2 Screen Rumour Has A Ghosting Test",
      artifact_dir: path.join(TEST_ROOT, "unused"),
      source: {
        name: "GameSpot",
        url: "https://www.gamespot.com/articles/original-nintendo-switch-will-be-discontinued-in-europe/",
        type: "rss",
        published_at: "Tue, 07 Jul 2026 00:18:17 +0000",
        title: "Original Nintendo Switch Will Be Discontinued In Europe",
        description: "Nintendo is discontinuing the original Switch model in Europe.",
      },
      current_script:
        "Switch 2's screen rumour is about the flaw players can actually see.",
    },
    manifest: {
      story_id: "rss_456229ed9244c942",
      canonical_subject: "Nintendo Switch",
      canonical_title: "Original Nintendo Switch Will Be Discontinued In Europe",
      primary_source: "GameSpot",
      primary_source_url:
        "https://www.gamespot.com/articles/original-nintendo-switch-will-be-discontinued-in-europe/",
      source_title: "Original Nintendo Switch Will Be Discontinued In Europe",
      article_title: "Original Nintendo Switch Will Be Discontinued In Europe",
      description: "Nintendo is discontinuing the original Switch model in Europe.",
      confirmed_claims: [
        "Nintendo is discontinuing the original Switch model in Europe.",
      ],
    },
  });

  assert.equal(script.verdict, "blocked");
  assert.equal(script.reason, "rewritten_angle_not_supported_by_source_claims");
  assert.deepEqual(script.quality.blockers, [
    "switch_2_screen_angle_missing_source_support",
    "ghosting_claim_missing_source_support",
    "oled_claim_missing_source_support",
  ]);
});

test("fresh refill viewer script writes Black Flag Resynced narration that is ASR-safe and audience clear", () => {
  const script = buildFreshRefillViewerScript({
    job: {
      story_id: "rss_476510b5f312fbec",
      title: "Assassin's Creed Black Flag Resynced PS5 Pro enhancements detailed",
      artifact_dir: path.join(TEST_ROOT, "unused"),
      source: {
        name: "PlayStation Blog",
        url: "https://blog.playstation.com/2026/06/30/assassins-creed-black-flag-resynced-ps5-pro-enhancements/",
        type: "rss",
      },
      current_script:
        "PlayStation Blog says Assassin's Creed Black Flag Resynced has PS5 Pro enhancements.",
    },
    manifest: {
      story_id: "rss_476510b5f312fbec",
      canonical_subject: "Assassin's Creed Black Flag Resynced",
      confirmed_claims: [
        "PlayStation Blog details PS5 Pro enhancements for Assassin's Creed Black Flag Resynced",
      ],
    },
  });

  assert.equal(script.verdict, "viral_ready", JSON.stringify(script.quality, null, 2));
  assert.equal(script.suggested_title, "Black Flag Resynced Has A PS5 Pro Proof Problem");
  assert.equal(script.suggested_thumbnail_text, "BLACK FLAG PS5 PRO TEST");
  assert.ok(
    script.word_count >= 82 && script.word_count <= 86,
    `expected a motion-dwell-safe short script, got ${script.word_count} words`,
  );
  assert.match(script.full_script, /^Assassin's Creed Black Flag Resynced has one job\. Make the pirate loop feel dangerous again\./);
  assert.match(script.full_script, /the real test is motion, not screenshots/i);
  assert.match(script.full_script, /If this restores that rhythm, lapsed players get a reason to reinstall/i);
  assert.match(script.full_script, /Follow Pulse Gaming so you never miss a beat\.$/);
  assert.doesNotMatch(script.full_script, /open-sea|gets ugly fast|\bNext\b|source-backed update|the player impact is|ocean still feels alive|wallpaper|fans will notice/i);
  assert.doesNotMatch(script.suggested_title, /:/, "avoid title punctuation that creates TTS title pauses");
  assert.deepEqual(script.quality.blockers, []);
  assert.equal(script.coherence.result, "pass");
  const massAudience = auditMassAudienceClarity({
    script: script.full_script,
    title: script.suggested_title,
    sourceName: "PlayStation Blog",
    canonicalSubject: "Assassin's Creed Black Flag Resynced",
  });
  assert.equal(massAudience.result, "pass", JSON.stringify(massAudience, null, 2));
  assert.equal(massAudience.concrete_detail_count >= 3, true);
});

test("fresh refill viewer script does not replace Black Flag monetisation coverage with stale PS5 Pro copy", () => {
  const script = buildFreshRefillViewerScript({
    job: {
      story_id: "rss_black_flag_backlash",
      title: "Black Flag Resynced Steam reviews criticise microtransactions",
      artifact_dir: path.join(TEST_ROOT, "unused"),
      source: {
        name: "Kotaku",
        url: "https://kotaku.com/black-flag-resynced-microtransactions",
        type: "rss",
      },
      current_script:
        "Kotaku reports Ubisoft says the standard edition is the full complete experience after negative Steam reviews criticised microtransactions and paid DLC.",
    },
    manifest: {
      story_id: "rss_black_flag_backlash",
      canonical_subject: "Assassin's Creed Black Flag Resynced",
      confirmed_claims: [
        "Ubisoft says the standard edition is the full complete experience.",
        "Negative Steam reviews criticised microtransactions and paid DLC.",
      ],
    },
  });

  assert.equal(script.verdict, "viral_ready", JSON.stringify(script.quality, null, 2));
  assert.match(script.suggested_title, /Backlash|Ubisoft|Steam/i);
  assert.match(script.full_script, /standard edition/i);
  assert.match(script.full_script, /microtransactions|paid DLC/i);
  assert.match(script.full_script, /Kotaku/i);
  assert.doesNotMatch(`${script.suggested_title} ${script.full_script}`, /PS5 Pro|PlayStation Blog|motion proof/i);
});

test("fresh refill viewer script ignores unrelated subjects in related-story source text", () => {
  const personaUrl = "https://www.polygon.com/tv/999999/persona-netflix-live-action-series";
  const personaClaim =
    "Polygon reports Atlus and Sega are adapting Persona as a live-action Netflix series.";
  const script = buildFreshRefillViewerScript({
    job: {
      story_id: "rss_persona_netflix",
      title: "Persona is getting a live-action Netflix series",
      source: {
        name: "Polygon",
        url: personaUrl,
        type: "rss",
      },
      current_script: personaClaim,
      source_evidence: officialSourceEvidence(personaClaim, personaUrl),
    },
    manifest: {
      story_id: "rss_persona_netflix",
      canonical_subject: "Persona",
      canonical_title: "Persona is getting a live-action Netflix series",
      primary_source: "Polygon",
      primary_source_url: personaUrl,
      confirmed_claims: [
        personaClaim,
        "Related stories: Black Flag Resynced faces microtransaction criticism.",
        "Related stories: Marvel Tokon adds Blade, Loki and Deadpool.",
      ],
    },
  });

  assert.equal(script.verdict, "viral_ready", JSON.stringify(script.quality, null, 2));
  assert.equal(script.suggested_title, "Netflix Persona Has One Huge Trap");
  assert.equal(script.canonical_subject, "Persona");
  assert.match(script.full_script, /^Persona going live-action on Netflix is a dangerous swing\./);
  assert.doesNotMatch(`${script.suggested_title} ${script.full_script}`, /Black Flag|Marvel Tokon|Blade|Loki|Deadpool/i);
});

test("fresh refill viewer script quarantines multi-game listicles until one story is source-locked", () => {
  const sourceUrl =
    "https://blog.playstation.com/2026/07/14/19-unmissable-ps5-games-still-releasing-in-2026/";
  const script = buildFreshRefillViewerScript({
    job: {
      story_id: "rss_ps5_listicle",
      title: "GTA 6's Launch Endgame",
      source: {
        name: "PlayStation Blog",
        url: sourceUrl,
        title: "19 unmissable PS5 games still releasing in 2026",
        type: "rss",
      },
      current_script:
        "GTA 6 may finally be shifting from delay fear to launch countdown. Follow Pulse Gaming so you never miss a beat.",
      source_evidence: {
        status: "pass",
        source_url: sourceUrl,
        headline: "19 unmissable PS5 games still releasing in 2026",
        claims: [
          {
            text: "The article lists 19 different PlayStation 5 games releasing in 2026.",
            evidence_text: "The article lists 19 different PlayStation 5 games releasing in 2026.",
            source_url: sourceUrl,
            origin: "source_body",
          },
        ],
      },
    },
    manifest: {
      story_id: "rss_ps5_listicle",
      canonical_subject: "19 unmissable PS5 games still",
      canonical_title: "GTA 6's Launch Endgame",
      primary_source: "PlayStation Blog",
      primary_source_url: sourceUrl,
      source_evidence: {
        headline: "19 unmissable PS5 games still releasing in 2026",
      },
      confirmed_claims: [
        "The article lists 19 different PlayStation 5 games releasing in 2026.",
      ],
    },
  });

  assert.equal(script.verdict, "blocked");
  assert.equal(script.reason, "multi_subject_source_requires_narrowing");
  assert.deepEqual(script.quality.blockers, ["multi_subject_source_requires_narrowing"]);
  assert.equal(script.safety.no_publish, true);
  assert.equal(script.full_script, "");
});

test("fresh refill viewer script uses the reported outlet for Bethesda roadmap and union stories", () => {
  const cases = [
    {
      id: "bethesda-roadmap",
      title: "Fallout 5 and The Elder Scrolls 6 as Xbox layoffs hit Bethesda",
      sourceName: "IGN",
      claim: "IGN reports layoffs hit Bethesda while Fallout 5 and The Elder Scrolls 6 remain in Xbox's future pipeline.",
      expected: /Fallout 5|Elder Scrolls 6/i,
    },
    {
      id: "bethesda-union",
      title: "Bethesda union plans protest after Xbox layoffs",
      sourceName: "Eurogamer",
      claim: "Eurogamer reports Bethesda workers represented by the union are planning a protest after Xbox layoffs.",
      expected: /workers|protest/i,
    },
  ];

  for (const item of cases) {
    const script = buildFreshRefillViewerScript({
      job: {
        story_id: item.id,
        title: item.title,
        artifact_dir: path.join(TEST_ROOT, "unused"),
        source: { name: item.sourceName, url: `https://example.com/${item.id}`, type: "rss" },
        current_script: item.claim,
      },
      manifest: {
        story_id: item.id,
        canonical_subject: "Bethesda",
        confirmed_claims: [item.claim],
      },
    });

    assert.equal(script.verdict, "viral_ready", JSON.stringify(script.quality, null, 2));
    assert.match(script.full_script, new RegExp(item.sourceName, "i"));
    assert.match(script.full_script, item.expected);
    assert.doesNotMatch(script.full_script, /PC Gamer reports|Needs One Real Proof Point|watch signal/i);
  }
});

test("fresh refill viewer script repairs current official-source extraction and DLC stories without generic filler", () => {
  const cases = [
    {
      title: "Delta Force Has An Extraction Map Test",
      sourceUrl:
        "https://news.xbox.com/en-us/2026/06/30/reinventing-extraction-inside-delta-forces-most-ambitious-map-yet/",
      confirmed:
        "Reinventing Extraction: Inside Delta Force's Most Ambitious Map Yet",
      expectedTitle: "Delta Force New Extraction Map Has One Real Test",
      expectedHook: /^Delta Force is making one promise extraction shooters cannot fake\./,
      expectedDetail: /routes, risk, loot pressure and whether squads can read danger quickly/i,
      canonicalSubject: "Delta Force",
    },
    {
      title: "Why Doom: The Dark Ages Could Split Players",
      sourceUrl:
        "https://news.xbox.com/en-us/2026/07/01/doom-the-dark-ages-revelations-chain-spear-preview/",
      confirmed: "DOOM: The Dark Ages Goes Supersonic With New DLC Chain Spear",
      expectedTitle: "Doom The Dark Ages Chain Spear Changes The Fight",
      expectedHook: /^Doom The Dark Ages just made its next DLC about speed, not size\./,
      expectedDetail: /Chain Spear|Revelations|push-forward combat/i,
      canonicalSubject: "Doom: The Dark Ages",
    },
    {
      title: "Why Hunt Death Cult in Diablo Could Split Players",
      sourceUrl:
        "https://news.blizzard.com/en-us/article/24268702/hunt-the-death-cult-in-season-of-death-awakening#new_tab",
      confirmed: "Hunt the Death Cult in Diablo IV Season 14",
      expectedTitle: "Diablo IV Season 14 Needs A Real Chase",
      expectedHook: /^Diablo IV Season 14 has one job: make the hunt feel worth repeating\./,
      expectedDetail: /Death Cult|Season of Death Awakening|loot/i,
      canonicalSubject: "Diablo IV Season 14",
    },
  ];

  for (const item of cases) {
    const script = buildFreshRefillViewerScript({
      job: {
        story_id: `test_${item.expectedTitle.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
        title: item.title,
        artifact_dir: path.join(TEST_ROOT, "unused"),
        source: {
          name: item.sourceUrl.includes("blizzard.com") ? "Blizzard" : "Xbox Wire",
          url: item.sourceUrl,
          type: "rss",
        },
        source_evidence: officialSourceEvidence(item.confirmed, item.sourceUrl),
        current_script: `${item.title} has a new source detail, but the real question is still what players can do with it.`,
      },
      manifest: {
        canonical_subject: item.canonicalSubject,
        canonical_title: item.title,
        primary_source: item.sourceUrl.includes("blizzard.com") ? "Blizzard" : "Xbox Wire",
        primary_source_url: item.sourceUrl,
        confirmed_claims: [item.confirmed],
      },
    });

    assert.equal(script.verdict, "viral_ready", JSON.stringify(script.quality, null, 2));
    assert.equal(script.suggested_title, item.expectedTitle);
    assert.match(script.full_script, item.expectedHook);
    assert.match(script.full_script, item.expectedDetail);
    assert.match(script.full_script, /Follow Pulse Gaming so you never miss a beat\.$/);
    assert.doesNotMatch(
      `${script.suggested_title} ${script.full_script}`,
      /Could Split Players|Player Impact|new source detail|real question|play now, wait, skip|source-backed update|the player impact is/i,
    );
    assert.doesNotMatch(script.suggested_title, /:/, "avoid title punctuation that creates TTS title pauses");
    assert.deepEqual(script.quality.blockers, []);
    assert.equal(script.coherence.result, "pass");
    const massAudience = auditMassAudienceClarity({
      script: script.full_script,
      title: script.suggested_title,
      sourceName: item.sourceUrl.includes("blizzard.com") ? "Blizzard" : "Xbox Wire",
      canonicalSubject: item.canonicalSubject,
    });
    assert.equal(massAudience.result, "pass", JSON.stringify(massAudience, null, 2));
    assert.equal(massAudience.concrete_detail_count >= 3, true);
  }
});

test("fresh refill viewer script repairs current access stories without fallback filler", () => {
  const cases = [
    {
      title: "Why Enter The Pit Could Split Players",
      sourceUrl: "https://news.xbox.com/en-us/2026/07/02/enter-the-pit-xbox-insiders-can-play-pit-of-goblin-today/",
      sourceName: "Xbox Wire",
      confirmed: "Enter The Pit: XBOX Insiders Can Play Pit of Goblin Today!",
      expectedTitle: "Pit Of Goblin Insider Test Needs Real Runs",
      expectedHook: /^Pit of Goblin just became something Xbox players can actually test\./,
      expectedDetail: /Xbox Insiders|hands-on|wishlist|demo/i,
      canonicalSubject: "Pit of Goblin",
    },
  ];

  for (const item of cases) {
    const script = buildFreshRefillViewerScript({
      job: {
        story_id: `test_${item.expectedTitle.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
        title: item.title,
        artifact_dir: path.join(TEST_ROOT, "unused"),
        source: {
          name: item.sourceName,
          url: item.sourceUrl,
          type: "rss",
        },
        source_evidence: officialSourceEvidence(item.confirmed, item.sourceUrl),
        current_script: `${item.title} has one detail worth checking before it becomes background noise.`,
      },
      manifest: {
        canonical_subject: item.canonicalSubject,
        canonical_title: item.title,
        primary_source: item.sourceName,
        primary_source_url: item.sourceUrl,
        confirmed_claims: [item.confirmed],
      },
    });

    assert.equal(script.verdict, "viral_ready", JSON.stringify(script.quality, null, 2));
    assert.equal(script.suggested_title, item.expectedTitle);
    assert.match(script.full_script, item.expectedHook);
    assert.match(script.full_script, item.expectedDetail);
    assert.match(script.full_script, /Follow Pulse Gaming so you never miss a beat\.$/);
    assert.doesNotMatch(
      `${script.suggested_title} ${script.full_script}`,
      /Could Split Players|Needs One Real Proof|new source detail|real question|background noise|play now, wait, skip|source-backed update|the player impact is/i,
    );
    assert.doesNotMatch(script.suggested_title, /:/, "avoid title punctuation that creates TTS title pauses");
    assert.deepEqual(script.quality.blockers, []);
    assert.equal(script.coherence.result, "pass");
    const massAudience = auditMassAudienceClarity({
      script: script.full_script,
      title: script.suggested_title,
      sourceName: item.sourceName,
      canonicalSubject: item.canonicalSubject,
    });
    assert.equal(massAudience.result, "pass", JSON.stringify(massAudience, null, 2));
    assert.equal(massAudience.concrete_detail_count >= 3, true);
  }
});

test("fresh refill viewer script keeps Xbox Insider playtests bound to their named game", () => {
  const script = buildFreshRefillViewerScript({
    job: {
      story_id: "rss_6825aa8e2c6d7ebc",
      title: "Wreck Runners Has A Low-Risk Trial",
      artifact_dir: path.join(TEST_ROOT, "unused"),
      source: {
        name: "Xbox Wire",
        url: "https://news.xbox.com/en-us/2026/07/09/wreck-runners-join-the-xbox-insider-playtest/",
        type: "rss",
      },
      current_script:
        "Wreck Runners has a useful question before launch. Xbox Wire says Xbox Insiders can join the Wreck Runners playtest. The first few minutes need to prove movement, hit feedback and team flow. Follow Pulse Gaming so you never miss a beat.",
    },
    manifest: {
      canonical_subject: "Wreck Runners",
      canonical_title: "Wreck Runners Has A Low-Risk Trial",
      primary_source: "Xbox Wire",
      primary_source_url:
        "https://news.xbox.com/en-us/2026/07/09/wreck-runners-join-the-xbox-insider-playtest/",
      confirmed_claims: [
        "Xbox Wire says Wreck Runners has joined the Xbox Insider playtest.",
      ],
    },
  });

  assert.equal(script.verdict, "viral_ready", JSON.stringify(script.quality, null, 2));
  assert.match(script.suggested_title, /^Wreck Runners\b/);
  assert.match(script.full_script, /^Wreck Runners\b/);
  assert.match(script.full_script, /Xbox Insiders|playtest/i);
  assert.match(script.full_script, /Follow Pulse Gaming so you never miss a beat\.$/);
  assert.doesNotMatch(
    `${script.suggested_title} ${script.full_script}`,
    /Pit of Goblin|Enter The Pit|goblin demo/i,
  );
  assert.equal(script.coherence.result, "pass");
});

test("fresh refill viewer script blocks rewritten angles that are not grounded in source claims", () => {
  const script = buildFreshRefillViewerScript({
    job: {
      story_id: "rss_456229ed9244c942",
      title: "Switch 2 Screen Rumour Has A Ghosting Test",
      artifact_dir: path.join(TEST_ROOT, "unused"),
      source: {
        name: "GameSpot",
        url: "https://www.gamespot.com/articles/original-nintendo-switch-will-be-discontinued-in-europe/",
        type: "rss",
      },
      current_script: "Switch 2 Screen Rumour Has A Ghosting Test has one detail worth checking before it becomes background noise.",
    },
    manifest: {
      canonical_subject: "Nintendo Switch 2",
      canonical_title: "Switch 2 Screen Rumour Has A Ghosting Test",
      primary_source: "GameSpot",
      primary_source_url: "https://www.gamespot.com/articles/original-nintendo-switch-will-be-discontinued-in-europe/",
      confirmed_claims: [
        "The original Nintendo Switch will be discontinued in Europe.",
      ],
    },
  });

  assert.equal(script.verdict, "blocked");
  assert.equal(script.reason, "rewritten_angle_not_supported_by_source_claims");
  assert.match(script.grounding?.reason || "", /switch_2_screen_angle_missing_source_support/);
  assert.equal(script.safety.no_publish, true);
  assert.equal(script.safety.no_db_mutation, true);
});

test("fresh refill viewer script repairs current subscription and layoffs stories into clear public narration", () => {
  const cases = [
    {
      title: "Why Step Into Modern Era in Could Split Players",
      sourceUrl: "https://news.xbox.com/en-us/2026/07/02/ea-play-july/",
      sourceName: "Xbox Wire",
      confirmed: "Step Into the Modern Era in EA SPORTS College Football 27 with EA Play",
      expectedTitle: "College Football 27 Has An EA Play Trust Test",
      expectedHook: /^College Football 27 has a subscription problem before kickoff\./,
      expectedDetail: /EA Play|sports games live on habit|sample first|roster refresh/i,
      canonicalSubject: "EA SPORTS College Football 27",
    },
    {
      title: "Bethesda Game Studios and ZeniMax Has A Studio Risk",
      sourceUrl:
        "https://www.pcgamer.com/gaming-industry/bethesda-game-studios-and-zenimax-hit-hard-by-xbox-layoffs-says-union/",
      sourceName: "PCGamer",
      confirmed: "Bethesda Game Studios and ZeniMax hit hard by Xbox layoffs, says union",
      expectedTitle: "Bethesda Workers Take Xbox's Layoff Fight Public",
      expectedHook: /^Bethesda workers just turned Xbox's layoffs into a public warning\./,
      expectedDetail: /slower updates, thinner support|force Xbox to explain|public trust fight/i,
      canonicalSubject: "Bethesda Game Studios and ZeniMax",
    },
  ];

  for (const item of cases) {
    const script = buildFreshRefillViewerScript({
      job: {
        story_id: `test_${item.expectedTitle.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
        title: item.title,
        artifact_dir: path.join(TEST_ROOT, "unused"),
        source: {
          name: item.sourceName,
          url: item.sourceUrl,
          type: "rss",
        },
        source_evidence: officialSourceEvidence(item.confirmed, item.sourceUrl),
        current_script: `${item.title} has one detail worth checking before it becomes background noise.`,
      },
      manifest: {
        canonical_subject: item.canonicalSubject,
        canonical_title: item.title,
        primary_source: item.sourceName,
        primary_source_url: item.sourceUrl,
        confirmed_claims: [item.confirmed],
      },
    });

    assert.equal(script.verdict, "viral_ready", JSON.stringify(script.quality, null, 2));
    assert.equal(script.suggested_title, item.expectedTitle);
    assert.match(script.full_script, item.expectedHook);
    assert.match(script.full_script, item.expectedDetail);
    assert.match(script.full_script, /Follow Pulse Gaming so you never miss a beat\.$/);
    assert.doesNotMatch(
      `${script.suggested_title} ${script.full_script}`,
      /Could Split Players|Needs One Real Proof|new source detail|real question|background noise|play now, wait, skip|source-backed update|the player impact is|watch signal|not a verdict/i,
    );
    assert.doesNotMatch(script.suggested_title, /:/, "avoid title punctuation that creates TTS title pauses");
    assert.deepEqual(script.quality.blockers, []);
    assert.equal(script.coherence.result, "pass");
    const massAudience = auditMassAudienceClarity({
      script: script.full_script,
      title: script.suggested_title,
      sourceName: item.sourceName,
      canonicalSubject: item.canonicalSubject,
    });
    assert.equal(massAudience.result, "pass", JSON.stringify(massAudience, null, 2));
    assert.equal(massAudience.concrete_detail_count >= 3, true);
  }
});

test("fresh refill script rewrite dry-run leaves local proof files unchanged", async () => {
  const { artifactDir, workOrderPath } = await writeFixture("dry-run");
  const manifestPath = path.join(artifactDir, "canonical_story_manifest.json");
  const before = await fs.readFile(manifestPath, "utf8");

  const report = await runFreshRefillScriptRewrite({
    root: ROOT,
    workOrderPath,
    outDir: path.join(TEST_ROOT, "dry-run", "report"),
    applyLocal: false,
  });

  assert.equal(report.summary.pass_count, 1);
  assert.equal(report.summary.applied_count, 0);
  assert.equal(report.summary.would_apply_count, 1);
  assert.equal(report.output_dir, path.join(TEST_ROOT, "dry-run", "report"));
  assert.equal(await fs.readFile(manifestPath, "utf8"), before);
});

test("fresh refill script rewrite story filter applies only the requested story", async () => {
  const caseRoot = path.join(TEST_ROOT, "story-filter");
  await fs.remove(caseRoot);

  const skippedArtifactDir = path.join(caseRoot, "skipped", "artifact");
  const selectedArtifactDir = path.join(caseRoot, "selected", "artifact");
  await fs.ensureDir(skippedArtifactDir);
  await fs.ensureDir(selectedArtifactDir);

  await fs.writeJson(path.join(skippedArtifactDir, "canonical_story_manifest.json"), canonicalManifest(), {
    spaces: 2,
  });
  await fs.writeJson(path.join(skippedArtifactDir, "platform_publish_manifest.json"), platformManifest(), {
    spaces: 2,
  });

  await fs.writeJson(
    path.join(selectedArtifactDir, "canonical_story_manifest.json"),
    {
      ...canonicalManifest(),
      story_id: "rss_e2914175f30e0777",
      canonical_subject: "Doom: The Dark Ages",
      canonical_game: "Doom: The Dark Ages",
      canonical_title: "Why Doom: The Dark Ages Could Split Players",
      title: "Why Doom: The Dark Ages Could Split Players",
      primary_source: "Xbox Wire",
      primary_source_url:
        "https://news.xbox.com/en-us/2026/07/01/doom-the-dark-ages-revelations-chain-spear-preview/",
      confirmed_claims: ["DOOM: The Dark Ages Goes Supersonic With New DLC Chain Spear"],
      narration_script:
        "Doom: The Dark Ages has a new source detail, but the real question is still what players can do with it.",
      tts_script:
        "Doom: The Dark Ages has a new source detail, but the real question is still what players can do with it.",
      spoken_narration_script:
        "Doom: The Dark Ages has a new source detail, but the real question is still what players can do with it.",
    },
    { spaces: 2 },
  );
  await fs.writeJson(path.join(selectedArtifactDir, "platform_publish_manifest.json"), platformManifest(), {
    spaces: 2,
  });

  const skippedBefore = await fs.readFile(
    path.join(skippedArtifactDir, "canonical_story_manifest.json"),
    "utf8",
  );
  const workOrderPath = path.join(caseRoot, "work_order.json");
  await fs.writeJson(
    workOrderPath,
    {
      schema_version: 1,
      source: "test",
      jobs: [
        tekkenBobJob(skippedArtifactDir),
        {
          story_id: "rss_e2914175f30e0777",
          title: "Why Doom: The Dark Ages Could Split Players",
          artifact_dir: selectedArtifactDir,
          source: {
            name: "Xbox Wire",
            url:
              "https://news.xbox.com/en-us/2026/07/01/doom-the-dark-ages-revelations-chain-spear-preview/",
            type: "rss",
          },
          source_evidence: officialSourceEvidence(
            "DOOM: The Dark Ages Goes Supersonic With New DLC Chain Spear",
            "https://news.xbox.com/en-us/2026/07/01/doom-the-dark-ages-revelations-chain-spear-preview/",
          ),
          current_script:
            "Doom: The Dark Ages has a new source detail, but the real question is still what players can do with it.",
          scorecard_verdict: "rewrite_required",
          scorecard_blockers: ["generic_title_template"],
        },
      ],
    },
    { spaces: 2 },
  );

  const report = await runFreshRefillScriptRewrite({
    root: ROOT,
    workOrderPath,
    outDir: path.join(caseRoot, "report"),
    applyLocal: true,
    storyIds: ["rss_e2914175f30e0777"],
  });

  assert.deepEqual(report.requested_story_ids, ["rss_e2914175f30e0777"]);
  assert.equal(report.summary.job_count, 1);
  assert.equal(report.summary.applied_count, 1);
  assert.equal(report.items[0].story_id, "rss_e2914175f30e0777");
  assert.equal(
    await fs.readFile(path.join(skippedArtifactDir, "canonical_story_manifest.json"), "utf8"),
    skippedBefore,
  );

  const selectedManifest = await fs.readJson(
    path.join(selectedArtifactDir, "canonical_story_manifest.json"),
  );
  assert.equal(selectedManifest.title, "Doom The Dark Ages Chain Spear Changes The Fight");
  assert.match(selectedManifest.narration_script, /^Doom The Dark Ages just made its next DLC about speed/i);
});

test("fresh refill script rewrite apply updates only local proof artefacts", async () => {
  const { artifactDir, workOrderPath } = await writeFixture("apply");

  const report = await runFreshRefillScriptRewrite({
    root: ROOT,
    workOrderPath,
    outDir: path.join(TEST_ROOT, "apply", "report"),
    applyLocal: true,
  });

  assert.equal(report.summary.pass_count, 1);
  assert.equal(report.summary.applied_count, 1);

  const manifest = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  assert.match(manifest.narration_script, /^Tekken 8 bringing Bob back\b/);
  assert.doesNotMatch(manifest.narration_script, /new source detail|real question|play now, wait, skip/i);
  assert.equal(manifest.title, "Tekken 8 Bob DLC Turns Into A Roster Comeback Test");
  assert.equal(manifest.canonical_title, "Tekken 8 Bob DLC Turns Into A Roster Comeback Test");
  assert.equal(manifest.selected_title, "Tekken 8 Bob DLC Turns Into A Roster Comeback Test");
  assert.equal(manifest.public_title, "Tekken 8 Bob DLC Turns Into A Roster Comeback Test");
  assert.equal(manifest.script_repair.local_only, true);
  assert.equal(manifest.script_repair.no_db_mutation, true);

  const scorecard = await fs.readJson(path.join(artifactDir, "script_scorecard.json"));
  assert.equal(scorecard.verdict, "viral_ready", JSON.stringify(scorecard, null, 2));
  assert.deepEqual(scorecard.blockers, []);

  const coherence = await fs.readJson(path.join(artifactDir, "coherence_report.json"));
  assert.equal(coherence.result, "pass", JSON.stringify(coherence, null, 2));
  assert.equal(coherence.story_id, manifest.story_id);
  assert.equal(coherence.manifest.narration_script, manifest.narration_script);
  assert.equal(coherence.repair_source, "fresh_refill_source_bound_viewer_rewrite");

  const platform = await fs.readJson(path.join(artifactDir, "platform_publish_manifest.json"));
  assert.equal(platform.outputs.youtube_shorts.title, "Tekken 8 Bob DLC Turns Into A Roster Comeback Test");
  assert.match(platform.outputs.youtube_shorts.description, /Bob|Eurogamer/i);
  assert.doesNotMatch(platform.outputs.instagram_reels.caption, /new source detail|real question/i);
  assert.equal(platform.platform_native_evidence.verdict, "pass", JSON.stringify(platform.platform_native_evidence, null, 2));
  assert.ok(
    !platform.platform_native_evidence.failures.some((failure) => /weak_cover_headline|weak_platform_title/.test(failure.reason)),
    JSON.stringify(platform.platform_native_evidence.failures),
  );
  const youtubeEvidence = platform.platform_native_evidence.platforms.find((item) => item.platform === "youtube_shorts");
  assert.match(youtubeEvidence.copy_fingerprint, /bob|eurogamer/i);
  assert.doesNotMatch(youtubeEvidence.copy_fingerprint, /generic description old weak title/i);
});

test("fresh refill script rewrite persists a narrowed canonical subject before motion discovery", async () => {
  const caseRoot = path.join(TEST_ROOT, "apply-narrowed-subject");
  const artifactDir = path.join(caseRoot, "artifact");
  const workOrderPath = path.join(caseRoot, "work_order.json");
  await fs.remove(caseRoot);
  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "rss_marvel_tokon_listicle",
    canonical_subject: "19 unmissable PS5 games still",
    canonical_game: "19 unmissable PS5 games still",
    canonical_title: "Marvel Tokon Roster Just Got Louder",
    primary_source: "PlayStation Blog",
    primary_source_url: "https://blog.playstation.com/2026/07/14/19-unmissable-ps5-games-still-releasing-in-2026/",
    confirmed_claims: [
      "PlayStation Blog says Blade, Loki and Deadpool are joining MARVEL Tokon: Fighting Souls.",
    ],
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "platform_publish_manifest.json"), { outputs: {} }, { spaces: 2 });
  await fs.writeJson(workOrderPath, {
    jobs: [{
      story_id: "rss_marvel_tokon_listicle",
      title: "Marvel Tokon Roster Just Got Louder",
      artifact_dir: artifactDir,
      source: {
        name: "PlayStation Blog",
        url: "https://blog.playstation.com/2026/07/14/19-unmissable-ps5-games-still-releasing-in-2026/",
        type: "rss",
      },
      current_script:
        "PlayStation Blog says Blade, Loki and Deadpool are joining MARVEL Tokon: Fighting Souls.",
    }],
  }, { spaces: 2 });

  const report = await runFreshRefillScriptRewrite({
    root: ROOT,
    workOrderPath,
    outDir: path.join(caseRoot, "report"),
    applyLocal: true,
  });
  const manifest = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));

  assert.equal(report.summary.applied_count, 1);
  assert.equal(manifest.canonical_subject, "MARVEL Tokon");
  assert.equal(manifest.canonical_game, "MARVEL Tokon");
});

test("fresh refill script rewrite persists official source provenance and event windows", async () => {
  const { artifactDir, workOrderPath } = await writeFixture("apply-source-evidence");
  const workOrder = await fs.readJson(workOrderPath);
  const sourceUrl = "https://www.eurogamer.net/tekken-8-bob-gameplay-trailer";
  const confirmedEventWindow = {
    status: "confirmed",
    starts_at: "2026-07-13T00:00:00.000Z",
    ends_at: "2026-07-20T23:59:59.999Z",
    source_url: sourceUrl,
  };
  workOrder.jobs[0].source.confirmed_event_window = confirmedEventWindow;
  workOrder.jobs[0].source_evidence = {
    status: "pass",
    source_url: sourceUrl,
    headline: "Tekken 8 adds Bob",
    source_text_sha256: "b".repeat(64),
    confirmed_event_window: confirmedEventWindow,
    claims: [{
      text: "Tekken 8 is adding Bob to its roster.",
      evidence_text: "Tekken 8 is adding Bob to its roster.",
      source_url: sourceUrl,
      origin: "source_body",
    }],
  };
  await fs.writeJson(workOrderPath, workOrder, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "source_manifest.json"), {
    primary_source: { name: "Eurogamer", url: sourceUrl },
  }, { spaces: 2 });

  const report = await runFreshRefillScriptRewrite({
    root: ROOT,
    workOrderPath,
    outDir: path.join(TEST_ROOT, "apply-source-evidence", "report"),
    applyLocal: true,
    generatedAt: "2026-07-13T10:00:00.000Z",
  });
  const manifest = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  const sourceManifest = await fs.readJson(path.join(artifactDir, "source_manifest.json"));

  assert.equal(report.summary.applied_count, 1);
  assert.equal(manifest.source_evidence.source_text_sha256, "b".repeat(64));
  assert.deepEqual(manifest.confirmed_event_window, confirmedEventWindow);
  assert.equal(sourceManifest.source_evidence.source_text_sha256, "b".repeat(64));
  assert.deepEqual(sourceManifest.confirmed_event_window, confirmedEventWindow);
});

test("fresh refill script rewrite quarantines expired source evidence in local proof", async () => {
  const { artifactDir, workOrderPath } = await writeFixture("apply-expired-source-evidence");
  const workOrder = await fs.readJson(workOrderPath);
  const sourceUrl = "https://news.xbox.com/en-us/2026/07/09/free-play-days-07-09-2026/";
  const confirmedEventWindow = {
    status: "confirmed",
    starts_at: "2026-07-09T00:00:00.000Z",
    ends_at: "2026-07-12T23:59:59.999Z",
    source_url: sourceUrl,
  };
  workOrder.jobs[0].source.url = sourceUrl;
  workOrder.jobs[0].source.confirmed_event_window = confirmedEventWindow;
  workOrder.jobs[0].source_evidence = {
    status: "pass",
    source_url: sourceUrl,
    headline: "Free Play Days",
    source_text_sha256: "c".repeat(64),
    confirmed_event_window: confirmedEventWindow,
    claims: [{
      text: "The offer was available until Sunday, July 12.",
      evidence_text: "The offer was available until Sunday, July 12.",
      source_url: sourceUrl,
      origin: "source_body",
    }],
  };
  await fs.writeJson(workOrderPath, workOrder, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "source_manifest.json"), {
    primary_source: { name: "Xbox Wire", url: sourceUrl },
    freshness_gate: "pass",
    blockers: [],
  }, { spaces: 2 });

  const report = await runFreshRefillScriptRewrite({
    root: ROOT,
    workOrderPath,
    outDir: path.join(TEST_ROOT, "apply-expired-source-evidence", "report"),
    applyLocal: true,
    generatedAt: "2026-07-13T10:00:00.000Z",
  });
  const manifest = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  const sourceManifest = await fs.readJson(path.join(artifactDir, "source_manifest.json"));
  const scorecard = await fs.readJson(path.join(artifactDir, "script_scorecard.json"));

  assert.equal(report.summary.blocked_count, 1);
  assert.equal(manifest.source_evidence.source_text_sha256, "c".repeat(64));
  assert.deepEqual(manifest.confirmed_event_window, confirmedEventWindow);
  assert.equal(sourceManifest.freshness_gate, "blocked");
  assert.ok(sourceManifest.blockers.includes("confirmed_event_window_ended"));
  assert.equal(scorecard.verdict, "rewrite_required");
  assert.ok(scorecard.blockers.includes("confirmed_event_window_ended"));
});

test("fresh refill script rewrite apply updates sibling motion-hydrated artefacts", async () => {
  const caseRoot = path.join(TEST_ROOT, "apply-motion-hydrated");
  const baseArtifactDir = path.join(caseRoot, "goal-proof-batch", "rss_4a07e21d3192fd7c");
  const hydratedArtifactDir = path.join(
    caseRoot,
    "goal-proof-batch",
    "motion-hydrated",
    "rss_4a07e21d3192fd7c",
  );
  await fs.remove(caseRoot);
  for (const artifactDir of [baseArtifactDir, hydratedArtifactDir]) {
    await fs.ensureDir(artifactDir);
    await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), canonicalManifest(), {
      spaces: 2,
    });
    await fs.writeJson(path.join(artifactDir, "platform_publish_manifest.json"), platformManifest(), {
      spaces: 2,
    });
  }
  const workOrderPath = path.join(caseRoot, "work_order.json");
  await fs.writeJson(workOrderPath, {
    schema_version: 1,
    source: "test",
    jobs: [tekkenBobJob(baseArtifactDir)],
  }, { spaces: 2 });

  const report = await runFreshRefillScriptRewrite({
    root: ROOT,
    workOrderPath,
    outDir: path.join(caseRoot, "report"),
    applyLocal: true,
  });

  assert.equal(report.summary.applied_count, 1);
  assert.deepEqual(
    report.items[0].applied_artifact_dirs.sort(),
    [
      path.relative(ROOT, baseArtifactDir),
      path.relative(ROOT, hydratedArtifactDir),
    ].sort(),
  );

  const baseManifest = await fs.readJson(path.join(baseArtifactDir, "canonical_story_manifest.json"));
  const hydratedManifest = await fs.readJson(path.join(hydratedArtifactDir, "canonical_story_manifest.json"));
  assert.match(baseManifest.narration_script, /^Tekken 8 bringing Bob back\b/);
  assert.equal(hydratedManifest.narration_script, baseManifest.narration_script);
  assert.equal(hydratedManifest.title, "Tekken 8 Bob DLC Turns Into A Roster Comeback Test");
});

test("fresh refill script rewrite clears stale public-copy blockers but keeps real media blockers", async () => {
  const { artifactDir, workOrderPath } = await writeFixture("stale-copy-blockers");

  await runFreshRefillScriptRewrite({
    root: ROOT,
    workOrderPath,
    outDir: path.join(TEST_ROOT, "stale-copy-blockers", "report"),
    applyLocal: true,
  });

  const verdict = await fs.readJson(path.join(artifactDir, "publish_verdict.json"));
  const allVerdictBlockers = [
    ...verdict.reason_codes,
    ...verdict.blockers,
    ...verdict.package_quality_gate.blockers,
  ];
  assert.ok(!allVerdictBlockers.some((blocker) => /script:|weak_platform_title|weak_cover_headline|title_lacks_curiosity_gap|platform_title_too_plain|first_frame_or_thumbnail_not_attention_led/.test(blocker)));
  assert.ok(allVerdictBlockers.includes("render:final_publish_render_missing"));
  assert.ok(allVerdictBlockers.includes("audio:narration_audio_missing"));
  assert.ok(allVerdictBlockers.includes("captions:word_timestamps_missing"));

  const summary = await fs.readJson(path.join(artifactDir, "goal_package_summary.json"));
  assert.deepEqual(summary.blockers, ["render:final_publish_render_missing"]);
});

test("fresh refill script rewrite refuses artifact directories outside local output roots", () => {
  assert.throws(
    () => assertSafeArtifactDir(path.resolve(ROOT, "..", "outside-artifact"), ROOT),
    /unsafe_artifact_dir/,
  );
});
