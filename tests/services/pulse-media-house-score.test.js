"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildPulseMediaHouseScore,
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
  assert.equal(report.production_grammar_alignment_report.status, "pass");
  assert.deepEqual(report.hard_failures, []);
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

test("feed-stop Shorts descriptions with concrete viewer stakes pass the attention gate", () => {
  for (const story of [
    {
      title: "Steam Next Fest Turns Demos Into A Trust Fight",
      subject: "Steam Next Fest",
      firstLine: "Steam Next Fest is the moment a PC game stops hiding behind trailers.",
      description:
        "Steam Next Fest is turning demos into a public trust test for PC games. The best trailer may get attention, but the demo players remember is the one that wins the week. Source: Steam.",
      cover: "STEAM NEXT FEST TRUST TEST",
    },
    {
      title: "Gears E-Day Has A 130GB Problem",
      subject: "Gears of War: E-Day",
      firstLine: "Gears of War E-Day just turned PC specs into the story.",
      description:
        "Gears of War: E-Day is asking players for 130 GB before the campaign even starts. That turns storage into part of the launch pitch. Source: PC Gamer.",
      cover: "GEARS E-DAY 130GB TEST",
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
