"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  DEFAULT_LOCAL_EXTENSION_TARGET_WORDS,
  REQUIRED_CTA,
  applyLocalScriptExtensionAudio,
  buildLocalScriptExtensionPlan,
  extendScriptToLocalFlash,
  renderLocalScriptExtensionMarkdown,
  stripRequiredCta,
} = require("../../lib/ops/local-script-extension");
const {
  resolveAcceptedLocalVoiceReference,
} = require("../../lib/studio/v2/local-voice-reference");

const ROOT = path.resolve(__dirname, "..", "..");
const ACCEPTED_SLEEPY_LIAM = resolveAcceptedLocalVoiceReference();
const READY_TTS = {
  ready: true,
  status: "ok",
  phase: "ready",
  voice: {
    alias: "liam",
    loaded: true,
    ref_resolved: true,
    accepted_reference_id: ACCEPTED_SLEEPY_LIAM.id,
    accepted_reference_file: ACCEPTED_SLEEPY_LIAM.fileName,
    reference_sha1: ACCEPTED_SLEEPY_LIAM.referenceHash,
  },
};

function queueItem(id, words = 140) {
  return {
    story_id: id,
    title: "GTA 6 evidence is stacking up",
    action: "extend_script_before_local_repair",
    runtime: {
      wordCount: words,
      minWords: 146,
      maxWords: 178,
    },
  };
}

function variedScript(subject, count = 24) {
  const templates = [
    "{subject} has a confirmed update today.",
    "The player-facing detail is specific enough to explain quickly.",
    "An official source gives the story a hard edge.",
    "Players now have a concrete reason to pay attention.",
    "The timing detail matters because it changes what happens next.",
    "This is not just another vague rumour.",
    "There is enough evidence here for a clean short.",
    "The headline has an official detail behind it.",
    "Chatter is turning into a practical consequence.",
    "The clearest angle is what players can actually do.",
    "That practical impact should stay near the front.",
    "The script should explain the update without hype.",
    "It works best when the facts stay narrow.",
    "A follow-up only matters if it adds proof.",
    "The next official update is now worth watching.",
    "The useful part is that the outcome is specific.",
    "The source trail should stay visible throughout.",
    "The story matters because the change is concrete.",
    "The next confirmed move will decide the bigger picture.",
    "There is enough context to avoid filler.",
    "The player-facing change should lead the short.",
    "The short needs one simple decision point.",
    "Careful wording matters more than speculation here.",
    "The unknowns should stay clearly labelled.",
    "The source pack gives the update a useful boundary.",
    "This belongs in the short because the effect is clear.",
    "Here is what players should watch next.",
  ];
  return templates
    .slice(0, count)
    .map((line) => line.replace("{subject}", subject))
    .join(" ");
}

test("local script extension expands short Liam scripts into the 61-75s local Flash range", () => {
  const draft = extendScriptToLocalFlash({
    story: {
      id: "rss_short",
      title: "GTA 6 evidence is stacking up",
      subreddit: "GameSpot",
      content_pillar: "Confirmed Drop",
      full_script: variedScript("GTA 6", 17),
    },
    queueItem: queueItem("rss_short", 136),
    cleanText: (text) => text.replace(/\bGTA\s*6\b/gi, "G T A six"),
    env: {},
  });

  assert.equal(draft.action, "ready_for_local_liam_audio");
  assert.equal(draft.cta_exactly_once, true);
  assert.match(draft.proposed_full_script, new RegExp(`${REQUIRED_CTA.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
  assert.equal(draft.runtime.result, "pass");
  assert.ok(draft.proposed_words >= draft.runtime.minWords);
  assert.ok(draft.proposed_words <= draft.runtime.maxWords);
  assert.ok(draft.estimated_seconds >= 61);
});

test("local script extension targets the middle of the Liam-safe range, not the ceiling", () => {
  const draft = extendScriptToLocalFlash({
    story: {
      id: "rss_midrange",
      title: "Xbox confirms a new update",
      full_script: variedScript("Xbox", 25),
    },
    queueItem: queueItem("rss_midrange", 150),
    env: {},
  });

  assert.equal(DEFAULT_LOCAL_EXTENSION_TARGET_WORDS, 166);
  assert.equal(draft.target_words, draft.target_word_range.min);
  assert.deepEqual(draft.target_seconds, [64, 70]);
  assert.ok(draft.target_word_range.min >= 183);
  assert.ok(draft.target_word_range.max <= 200);
  assert.ok(draft.proposed_words >= draft.runtime.minWords);
  assert.ok(draft.proposed_words <= draft.runtime.maxWords);
});

test("local script extension uses conservative Liam proof pacing instead of optimistic 200 WPM planning", () => {
  const draft = extendScriptToLocalFlash({
    story: {
      id: "valorant_vanguard",
      title: "Valorant Vanguard update needs careful anti-cheat wording",
      full_script: variedScript("Valorant", 20),
    },
    queueItem: queueItem("valorant_vanguard", 190),
    env: {},
  });

  assert.equal(draft.action, "ready_for_local_liam_audio");
  assert.deepEqual(draft.target_seconds, [64, 70]);
  assert.ok(draft.target_word_range.min >= 183);
  assert.ok(draft.target_word_range.max <= 200);
  assert.ok(draft.proposed_words >= draft.runtime.minWords);
  assert.ok(draft.proposed_words <= draft.runtime.maxWords);
  assert.ok(draft.estimated_seconds >= 61);
  assert.ok(draft.estimated_seconds <= 75);
});

test("local script extension repairs underfloor Liam proofs toward 64-70s rather than the 61s floor", () => {
  const draft = extendScriptToLocalFlash({
    story: {
      id: "rss_underfloor",
      title: "Xbox confirms a new update",
      full_script: variedScript("Xbox", 21),
    },
    queueItem: {
      ...queueItem("rss_underfloor", 168),
      failure_code: "duration_too_short",
      media: { audioDurationSeconds: 58.4 },
    },
    env: {},
  });

  assert.equal(draft.action, "ready_for_local_liam_audio");
  assert.deepEqual(draft.target_seconds, [64, 70]);
  assert.ok(draft.proposed_words >= draft.runtime.minWords);
  assert.ok(draft.proposed_words <= draft.runtime.maxWords);
  assert.ok(draft.estimated_seconds >= 61);
  assert.ok(draft.estimated_seconds <= 75);
});

test("local script extension refuses to invent excessive copy for very thin scripts", () => {
  const draft = extendScriptToLocalFlash({
    story: {
      id: "batman_beyond_underfloor",
      title: "Jason Schreier debunks Batman Beyond leak",
      subreddit: "GameSpot",
      content_pillar: "Confirmed Drop",
      full_script: [
        "That Batman Beyond leak just got debunked by the industry's most trusted insider.",
        "Jason Schreier confirmed the 4chan rumour claiming Rocksteady is developing Batman Beyond is fake.",
        "The leak circulated across gaming forums claiming the studio was building a game around a Nemesis system.",
        "Schreier shut it down fast.",
        "That means Rocksteady's actual next project remains unknown.",
      ].join(" "),
    },
    queueItem: {
      ...queueItem("batman_beyond_underfloor", 172),
      failure_code: "duration_too_short",
      media: { audioDurationSeconds: 59.68 },
    },
    env: {},
  });

  assert.equal(draft.action, "review_extended_script");
  assert.ok(draft.manual_review_flags.includes("insufficient_story_specific_extension_material"));
  assert.ok(draft.proposed_words < 180);
});

test("local script extension reports per-story planning failures without aborting the batch", () => {
  const plan = buildLocalScriptExtensionPlan({
    queueReport: {
      items: [
        queueItem("bad_story", 136),
        queueItem("good_story", 136),
      ],
    },
    storiesById: {
      bad_story: {
        id: "bad_story",
        title: "Bad story",
        full_script: variedScript("Bad story marker", 25),
      },
      good_story: {
        id: "good_story",
        title: "Good story",
        full_script: variedScript("Xbox", 25),
      },
    },
    cleanText: (text) => {
      if (/Bad story|bad_story/i.test(text)) throw new Error("synthetic clean failure");
      return text;
    },
    env: {},
  });

  assert.equal(plan.counts.total, 2);
  assert.equal(plan.counts.ready, 1);
  assert.equal(plan.counts.failed, 1);
  assert.equal(plan.drafts.length, 1);
  assert.equal(plan.drafts[0].story_id, "good_story");
  assert.equal(plan.skipped[0].story_id, "bad_story");
  assert.equal(plan.skipped[0].failure_code, "script_extension_planning_failed");
  assert.match(renderLocalScriptExtensionMarkdown(plan), /bad_story: script_extension_planning_failed/);
});

test("local script extension uses compact bridge lines instead of overshooting near the minimum", () => {
  const draft = extendScriptToLocalFlash({
    story: {
      id: "rss_near_minimum",
      title: "Marathon Drops To 15K Daily CCU Peak On Steam, Exits Top 50 On PlayStation & Top 100 On Xbox Best-Sellers Lists",
      subreddit: "PCMasterRace",
      content_pillar: "Confirmed Drop",
      full_script: variedScript("Marathon", 25),
    },
    queueItem: queueItem("rss_near_minimum", 160),
    env: {},
  });

  assert.equal(draft.action, "ready_for_local_liam_audio");
  assert.equal(draft.runtime.result, "pass");
  assert.ok(draft.proposed_words >= 204);
  assert.ok(draft.proposed_words <= 250);
  assert.doesNotMatch(draft.proposed_full_script, /The clean read on Marathon Drops/i);
});

test("local script extension never adds internal Pulse strategy boilerplate", () => {
  const draft = extendScriptToLocalFlash({
    story: {
      id: "rss_internal_boilerplate",
      title: "Reported update needs careful wording",
      subreddit: "GameSpot",
      content_pillar: "Confirmed Drop",
      full_script:
        "A reported gaming update still needs careful wording. Players have one confirmed detail today.",
    },
    queueItem: queueItem("rss_internal_boilerplate", 18),
    env: {},
  });

  assert.doesNotMatch(
    draft.proposed_full_script,
    /For Pulse|direction of travel|signal first|safest read|tracking the official follow-up/i,
  );
  assert.ok(!draft.manual_review_flags.some((flag) => /abstract_signal_language/i.test(flag)));
});

test("local script extension never adds policy-memo padding to public narration", () => {
  const draft = extendScriptToLocalFlash({
    story: {
      id: "rss_public_padding",
      title: "Hades II finally shows console gameplay",
      subreddit: "PlayStation Blog",
      content_pillar: "Confirmed Drop",
      full_script: variedScript("Hades II", 17),
    },
    queueItem: queueItem("rss_public_padding", 136),
    env: {},
  });

  assert.doesNotMatch(
    draft.proposed_full_script,
    /the useful question|source material stays|player-facing question is simple/i,
  );
});

test("local script extension routes runtime-valid policy-memo narration to review", () => {
  const draft = extendScriptToLocalFlash({
    story: {
      id: "bungie_generic_padding",
      title:
        "\"Almost All\" Of Bungie Reportedly Didn't Know Destiny 2 Was Ending Active Development Until It Was Announced",
      source_name: "The Game Post",
      content_pillar: "Source Breakdown",
      full_script: [
        "Almost All Of Bungie just got a score its publisher can market hard.",
        "The Game Post reports that Almost All Of Bungie is now sitting on a major review score in the current review conversation.",
        "That is not just a critic badge.",
        "The useful read is about attention: a strong score can shift a game from another release into the title people feel they should check.",
        "The catch is that review momentum still has to survive real players, patches and the first wider weekend.",
        "For players, the value is knowing whether the hype has evidence behind it before the storefront banners arrive.",
        "The split matters: a score can earn attention, but players still need to see whether the wider audience agrees.",
        "That gives the story a cleaner test: does the launch keep building after the first headline fades?",
        "For players, that is the difference between a news recap and a decision filter.",
        "The useful take is not blind hype.",
        "It is separating a real proof point from a marketing line.",
        "If the source is right, this gives players a better filter for the next wave of promotion.",
      ].join(" "),
    },
    queueItem: queueItem("bungie_generic_padding", 196),
    env: {},
  });

  assert.equal(draft.runtime.result, "pass");
  assert.equal(draft.action, "review_extended_script");
  assert.ok(
    draft.manual_review_flags.includes("public_copy_blocked:decision_filter"),
    draft.manual_review_flags.join(", "),
  );
  assert.ok(
    draft.manual_review_flags.includes("public_copy_blocked:generic_marketing_line"),
    draft.manual_review_flags.join(", "),
  );
  assert.equal(draft.source_bound_rewrite_work_order.story_id, "bungie_generic_padding");
  assert.equal(draft.source_bound_rewrite_work_order.blocker_type, "public_copy_blocked");
  assert.equal(draft.source_bound_rewrite_work_order.repair_lane, "source_bound_script_rewrite");
  assert.match(
    draft.source_bound_rewrite_work_order.recommended_command,
    /ops:reprocess-script-failures -- --story-id bungie_generic_padding --force-story --source-bound-only --dry-run --json/,
  );
  assert.equal(draft.source_bound_rewrite_work_order.db_mutation_required, false);
  assert.equal(draft.source_bound_rewrite_work_order.operator_approval_required, true);
});

test("local script extension plan gives source-bound rewrite commands for unsafe review drafts", () => {
  const plan = buildLocalScriptExtensionPlan({
    queueReport: {
      items: [queueItem("bungie_generic_padding", 196)],
    },
    storiesById: {
      bungie_generic_padding: {
        id: "bungie_generic_padding",
        title:
          "\"Almost All\" Of Bungie Reportedly Didn't Know Destiny 2 Was Ending Active Development Until It Was Announced",
        source_type: "reddit",
        subreddit: "GamingLeaksAndRumours",
        article_url: "https://thegamepost.com/bungie-destiny-2-active-development-ending/",
        full_script: [
          "Almost All Of Bungie just got a score its publisher can market hard.",
          "Thegamepost reports that Almost All Of Bungie is now sitting on a major review score in the current review conversation.",
          "That gives the story a cleaner test: does the launch keep building after the first headline fades?",
          "The useful take is not blind hype.",
          "It is separating a real proof point from a marketing line.",
          "If the source is right, this gives players a better filter for the next wave of promotion.",
        ].join(" "),
      },
    },
    env: {},
  });

  assert.equal(plan.counts.review, 1);
  assert.equal(plan.counts.source_bound_rewrite_work_orders, 1);
  assert.equal(
    plan.drafts[0].source_bound_rewrite_work_order.recommended_command,
    "npm run ops:reprocess-script-failures -- --story-id bungie_generic_padding --force-story --source-bound-only --dry-run --json",
  );
  assert.match(
    renderLocalScriptExtensionMarkdown(plan),
    /Source-bound rewrite: `npm run ops:reprocess-script-failures -- --story-id bungie_generic_padding --force-story --source-bound-only --dry-run --json`/,
  );
});

test("local script extension refuses generic padding on underwritten scripts", () => {
  const draft = extendScriptToLocalFlash({
    story: {
      id: "forza_underwritten",
      title:
        "Forza Horizon 6 immediately beats its predecessor's all-time Steam record with 130,000 concurrent players",
      subreddit: "pcgaming",
      content_pillar: "Source Breakdown",
      full_script: [
        "Japan's calling. Forza Horizon 6 just smashed the Steam record with 130,000 concurrent players before the full release.",
        "According to GamesRadar, the figure comes from people who paid for early access.",
        "That is a huge opening for Xbox's racing series.",
        REQUIRED_CTA,
      ].join(" "),
    },
    queueItem: queueItem("forza_underwritten", 62),
    env: {},
  });

  assert.equal(draft.action, "review_extended_script");
  assert.ok(
    draft.manual_review_flags.includes("insufficient_story_specific_extension_material"),
    draft.manual_review_flags.join(", "),
  );
  assert.doesNotMatch(
    draft.proposed_full_script,
    /This is a Source Breakdown story|The strongest follow-up would be|Keep the next step concrete|direction is clear/i,
  );
});

test("local script extension strips duplicate CTA before appending the required outro once", () => {
  const draft = extendScriptToLocalFlash({
    story: {
      id: "rss_cta",
      title: "Pokemon Go event starts today",
      full_script: `Pokemon Go has a confirmed event today. ${REQUIRED_CTA} `.repeat(22),
    },
    queueItem: queueItem("rss_cta", 154),
    env: {},
  });

  const matches = draft.proposed_full_script.match(/follow pulse gaming so you never miss a beat/gi) || [];
  assert.equal(matches.length, 1);
});

test("local script extension keeps hygiene warnings as manual review flags", () => {
  const draft = extendScriptToLocalFlash({
    story: {
      id: "rss_mojibake",
      title: "PokÃ©mon Go event starts today",
      full_script: "GTA 6 has a confirmed clue today. ".repeat(17),
    },
    queueItem: queueItem("rss_mojibake", 136),
    cleanText: (text) => text.replace(/\bGTA\s*6\b/gi, "G T A six"),
    env: {},
  });

  assert.equal(draft.action, "review_extended_script");
  assert.ok(draft.manual_review_flags.includes("title_hygiene_warn"));
});

test("local script extension sends low-value personal posts to review", () => {
  const draft = extendScriptToLocalFlash({
    story: {
      id: "reddit_personal",
      title: "Even tho I can’t download you. You will always be on my phone.",
      full_script: "A community post is getting attention today. ".repeat(35),
    },
    queueItem: queueItem("reddit_personal", 180),
    env: {},
  });

  assert.equal(draft.action, "review_extended_script");
  assert.ok(draft.manual_review_flags.includes("low_value_personal_post"));
});

test("local script extension sends incoherent source claims to review", () => {
  const draft = extendScriptToLocalFlash({
    story: {
      id: "bad_bill_script",
      title:
        "California bill backed by Stop Killing Games campaign passes key hurdle",
      source_type: "rss",
      subreddit: "Rock Paper Shotgun",
      content_pillar: "Source Breakdown",
      full_script:
        "Ubisoft's AB 1921 just passed a key committee vote. According to Rock Paper Shotgun, California's AB 1921, championed by the Stop ending Games campaign, has cleared its first hurdle.",
      cta: REQUIRED_CTA,
    },
    queueItem: queueItem("bad_bill_script", 27),
    env: {},
  });

  assert.equal(draft.action, "review_extended_script");
  assert.ok(
    draft.manual_review_flags.includes(
      "script_coherence:false_bill_ownership",
    ),
    draft.manual_review_flags.join(", "),
  );
  assert.ok(
    draft.manual_review_flags.includes(
      "script_coherence:mangled_stop_killing_games_campaign",
    ),
    draft.manual_review_flags.join(", "),
  );
});

test("local script extension plan only consumes repair queue extension items", () => {
  const plan = buildLocalScriptExtensionPlan({
    queueReport: {
      items: [
        queueItem("rss_short", 136),
        { story_id: "rss_ready", action: "ready_local_audio_render_repair" },
      ],
    },
    storiesById: {
      rss_short: {
        id: "rss_short",
        title: "Xbox confirms a new update",
        full_script: "Xbox confirmed a new update today. ".repeat(25),
      },
    },
    env: {},
  });

  assert.equal(plan.counts.total, 1);
  assert.equal(plan.drafts[0].story_id, "rss_short");
  assert.equal(plan.safety.mutates_production_db, false);
  assert.equal(plan.safety.posts_to_platforms, false);
});

test("local script extension plan skips stories with existing voice-ready proofs", () => {
  const plan = buildLocalScriptExtensionPlan({
    queueReport: {
      items: [
        queueItem("already_ready", 136),
        queueItem("needs_repair", 136),
      ],
    },
    storiesById: {
      already_ready: {
        id: "already_ready",
        title: "Already repaired story",
        full_script: variedScript("Xbox", 17),
      },
      needs_repair: {
        id: "needs_repair",
        title: "Needs repair story",
        full_script: variedScript("PlayStation", 17),
      },
    },
    existingReadyStoryIds: ["already_ready"],
    env: {},
  });

  assert.equal(plan.counts.total, 2);
  assert.equal(plan.counts.ready, 1);
  assert.equal(plan.counts.skipped_existing_ready, 1);
  assert.equal(plan.drafts.length, 1);
  assert.equal(plan.drafts[0].story_id, "needs_repair");
  assert.equal(plan.skipped[0].story_id, "already_ready");
  assert.equal(plan.skipped[0].failure_code, "existing_voice_ready_proof");
  assert.match(renderLocalScriptExtensionMarkdown(plan), /already_ready: existing_voice_ready_proof/);
});

test("local script extension plan can target one story without bulk audio work", () => {
  const plan = buildLocalScriptExtensionPlan({
    queueReport: {
      items: [
        queueItem("skip_me", 136),
        queueItem("target_story", 136),
      ],
    },
    storiesById: {
      skip_me: {
        id: "skip_me",
        title: "Skip this story",
        full_script: "Xbox confirmed a new update today. ".repeat(25),
      },
      target_story: {
        id: "target_story",
        title: "GTA 6 Owner Passed On A Legacy Franchise",
        full_script: "Take-Two has a confirmed story today. ".repeat(24),
      },
    },
    storyId: "target_story",
    env: {},
  });

  assert.equal(plan.counts.total, 1);
  assert.equal(plan.drafts[0].story_id, "target_story");
});

test("local script extension plan can explicitly recover a measured-short proof outside the queue", () => {
  const plan = buildLocalScriptExtensionPlan({
    queueReport: { items: [] },
    storiesById: {
      measured_short: {
        id: "measured_short",
      title: "MindsEye update drops today",
      subreddit: "GameSpot",
      content_pillar: "Confirmed Drop",
        full_script: variedScript("MindsEye", 20),
      },
    },
    storyId: "measured_short",
    env: {},
  });

  assert.equal(plan.counts.total, 1);
  assert.equal(plan.drafts[0].story_id, "measured_short");
  assert.equal(plan.drafts[0].action, "ready_for_local_liam_audio");
  assert.ok(plan.drafts[0].estimated_seconds >= 64);
  assert.equal(plan.safety.mutates_production_db, false);
});

test("local script extension refuses title-only recovery drafts", () => {
  const plan = buildLocalScriptExtensionPlan({
    queueReport: { items: [] },
    storiesById: {
      title_only: {
        id: "title_only",
        title:
          "Forza Horizon 6 immediately beats its predecessor's all-time Steam record",
        subreddit: "pcgaming",
        content_pillar: "Manual Review",
      },
    },
    storyId: "title_only",
    env: {},
  });

  assert.equal(plan.counts.total, 1);
  assert.equal(plan.counts.ready, 0);
  assert.equal(plan.counts.review, 1);
  assert.equal(plan.drafts[0].action, "review_extended_script");
  assert.equal(plan.drafts[0].base_script_present, false);
  assert.ok(plan.drafts[0].manual_review_flags.includes("missing_base_script"));
  assert.doesNotMatch(plan.drafts[0].proposed_full_script, /Manual Review/);
});

test("local script extension markdown is operator-readable and local-only", () => {
  const plan = buildLocalScriptExtensionPlan({
    queueReport: { items: [] },
    env: {},
  });
  const md = renderLocalScriptExtensionMarkdown(plan);

  assert.match(md, /Local Flash Script Extension Plan/);
  assert.match(md, /Local dry-run only/);
  assert.match(md, /Does not write story rows/);
});

test("local script extension CLI is local-only and does not publish", () => {
  const tool = fs.readFileSync(
    path.join(ROOT, "tools", "local-script-extension.js"),
    "utf8",
  );
  assert.match(tool, /local_script_extension_plan\.json/);
  assert.match(tool, /--story/);
  assert.match(tool, /--apply-local-audio/);
  assert.match(tool, /probeLocalAudioAcoustics/);
  assert.match(tool, /createLocalTtsBatchRecovery/);
  assert.match(tool, /recoverLocalTts/);
  assert.match(tool, /local_script_extension_audio_apply\.json/);
  assert.match(tool, /local_tts_overnight_report\.json/);
  assert.match(tool, /existingReadyStoryIds/);
  assert.doesNotMatch(tool, /postShort|uploadShort|publishAll|autonomous\/publish/);
});

test("stripRequiredCta removes existing outro variants", () => {
  assert.equal(
    stripRequiredCta("Story body. Follow Pulse Gaming so you never miss a beat."),
    "Story body.",
  );
});

test("apply local script extension audio writes ready Liam proofs only", async () => {
  const generated = [];
  const result = await applyLocalScriptExtensionAudio({
    plan: {
      drafts: [
        {
          story_id: "ready_one",
          action: "ready_for_local_liam_audio",
          proposed_full_script: "Ready script. Follow Pulse Gaming so you never miss a beat.",
          proposed_words: 230,
          estimated_seconds: 64.4,
        },
        {
          story_id: "review_one",
          action: "review_extended_script",
          proposed_full_script: "Review script.",
          proposed_words: 230,
        },
      ],
    },
    generateTts: async (text, outputRel, rate) => {
      generated.push({ text, outputRel, rate });
    },
    measureDuration: async () => 65.8,
    localTts: READY_TTS,
  });

  assert.equal(generated.length, 1);
  assert.equal(generated[0].rate, 1.0);
  assert.match(generated[0].outputRel, /test\/output\/local-script-extension\/audio\/ready_one_liam_extended\.mp3/);
  assert.equal(result.applied[0].duration_verdict, "pass");
  assert.equal(result.safety.mutates_production_db, false);
  assert.equal(result.safety.posts_to_platforms, false);
});

test("apply local script extension audio stamps accepted Sleepy Liam metadata", async () => {
  const previousApproval = process.env.STUDIO_V2_LOCAL_VOICE_APPROVED;
  process.env.STUDIO_V2_LOCAL_VOICE_APPROVED = "true";
  const outputDir = path.join(ROOT, "test", "output", "tmp-local-script-extension");
  fs.rmSync(outputDir, { recursive: true, force: true });

  try {
    const result = await applyLocalScriptExtensionAudio({
      plan: {
        drafts: [
          {
            story_id: "ready_meta",
            action: "ready_for_local_liam_audio",
            proposed_full_script: "Ready script. Follow Pulse Gaming so you never miss a beat.",
            proposed_words: 190,
            estimated_seconds: 64.2,
          },
        ],
      },
      outputRelDir: outputDir,
      generateTts: async (_text, outputRel) => {
        fs.mkdirSync(path.dirname(outputRel), { recursive: true });
        fs.writeFileSync(outputRel, "fake mp3 bytes");
        fs.writeFileSync(
          outputRel.replace(/\.mp3$/, "_timestamps.json"),
          JSON.stringify({
            characters: Array.from("Ready script. Follow Pulse Gaming so you never miss a beat."),
            character_start_times_seconds: [],
            character_end_times_seconds: [],
            meta: {
              acoustic: { medianPitchHz: 118 },
              voiceDiagnostics: {
                selectedCandidate: "configured",
                metrics: { median_f0_hz: 118 },
              },
            },
          }),
        );
      },
      measureDuration: async () => 65.2,
      localTts: READY_TTS,
    });

    const applied = result.applied[0];
    const timestamps = JSON.parse(
      fs.readFileSync(
        path.join(outputDir, "ready_meta_liam_extended_timestamps.json"),
        "utf8",
      ),
    );
    assert.equal(applied.local_voice_metadata, "stamped");
    assert.equal(applied.failure_code, null);
    assert.equal(applied.acoustic.medianPitchHz, 118);
    assert.equal(applied.spoken_outro_present, true);
    assert.equal(applied.local_voice_reference.referencePresent, true);
    assert.equal(timestamps.meta.provider, "local");
    assert.equal(timestamps.meta.source, "provided-local-tts-audio");
    assert.equal(timestamps.meta.acoustic.medianPitchHz, 118);
    assert.match(timestamps.meta.transcript, /Follow Pulse Gaming so you never miss a beat/);
    assert.equal(timestamps.meta.approvedLocalVoice, true);
    assert.equal(timestamps.meta.acceptedLocalVoice.id, "pulse-sleepy-liam-20260502");
    assert.equal(timestamps.meta.acceptedLocalVoice.referencePresent, true);
  } finally {
    if (previousApproval === undefined) delete process.env.STUDIO_V2_LOCAL_VOICE_APPROVED;
    else process.env.STUDIO_V2_LOCAL_VOICE_APPROVED = previousApproval;
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("apply local script extension audio probes acoustic diagnostics when timestamps omit them", async () => {
  const previousApproval = process.env.STUDIO_V2_LOCAL_VOICE_APPROVED;
  process.env.STUDIO_V2_LOCAL_VOICE_APPROVED = "true";
  const outputDir = path.join(ROOT, "test", "output", "tmp-local-script-extension-probe");
  fs.rmSync(outputDir, { recursive: true, force: true });
  const probed = [];

  try {
    const result = await applyLocalScriptExtensionAudio({
      plan: {
        drafts: [
          {
            story_id: "ready_probe",
            action: "ready_for_local_liam_audio",
            proposed_full_script: "Ready script. Follow Pulse Gaming so you never miss a beat.",
            proposed_words: 190,
            estimated_seconds: 64.2,
          },
        ],
      },
      outputRelDir: outputDir,
      generateTts: async (_text, outputRel) => {
        fs.mkdirSync(path.dirname(outputRel), { recursive: true });
        fs.writeFileSync(outputRel, "fake mp3 bytes");
        fs.writeFileSync(
          outputRel.replace(/\.mp3$/, "_timestamps.json"),
          JSON.stringify({
            characters: Array.from("Ready script. Follow Pulse Gaming so you never miss a beat."),
            character_start_times_seconds: [],
            character_end_times_seconds: [],
            meta: {},
          }),
        );
      },
      acousticProbe: async (audioPath) => {
        probed.push(audioPath);
        return {
          medianPitchHz: 118,
          integratedLufs: -16,
          truePeakDb: -1.3,
        };
      },
      measureDuration: async () => 65.2,
      localTts: READY_TTS,
    });

    const applied = result.applied[0];
    const timestamps = JSON.parse(
      fs.readFileSync(
        path.join(outputDir, "ready_probe_liam_extended_timestamps.json"),
        "utf8",
      ),
    );
    assert.equal(probed.length, 1);
    assert.match(probed[0], /ready_probe_liam_extended\.mp3$/);
    assert.equal(applied.failure_code, null);
    assert.equal(applied.acoustic.medianPitchHz, 118);
    assert.equal(timestamps.meta.acoustic.medianPitchHz, 118);
    assert.equal(timestamps.meta.voiceDiagnostics.source, "local_acoustic_probe");
  } finally {
    if (previousApproval === undefined) delete process.env.STUDIO_V2_LOCAL_VOICE_APPROVED;
    else process.env.STUDIO_V2_LOCAL_VOICE_APPROVED = previousApproval;
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("apply local script extension audio marks underfloor proofs rejected", async () => {
  const result = await applyLocalScriptExtensionAudio({
    plan: {
      drafts: [
        {
          story_id: "ready_short",
          action: "ready_for_local_liam_audio",
          proposed_full_script: "Ready script. Follow Pulse Gaming so you never miss a beat.",
          proposed_words: 230,
          estimated_seconds: 64.4,
        },
      ],
    },
    generateTts: async () => null,
    measureDuration: async () => 58.9,
    localTts: READY_TTS,
  });

  assert.equal(result.applied[0].duration_verdict, "reject_duration");
  assert.equal(result.applied[0].failure_code, "duration_too_short");
});

test("apply local script extension audio records TTS failures and keeps going", async () => {
  const generated = [];
  const result = await applyLocalScriptExtensionAudio({
    plan: {
      drafts: [
        {
          story_id: "fails_once",
          action: "ready_for_local_liam_audio",
          proposed_full_script: "Ready script one. Follow Pulse Gaming so you never miss a beat.",
          proposed_words: 190,
          estimated_seconds: 62.7,
        },
        {
          story_id: "still_runs",
          action: "ready_for_local_liam_audio",
          proposed_full_script: "Ready script two. Follow Pulse Gaming so you never miss a beat.",
          proposed_words: 191,
          estimated_seconds: 63.03,
        },
      ],
    },
    generateTts: async (text, outputRel) => {
      generated.push(outputRel);
      if (outputRel.includes("fails_once")) throw new Error("read ECONNRESET");
    },
    measureDuration: async () => 66.4,
    localTts: READY_TTS,
  });

  assert.equal(generated.length, 2);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].story_id, "fails_once");
  assert.equal(result.skipped[0].reason, "generate_tts_failed");
  assert.equal(result.skipped[0].failure_code, "connection_reset");
  assert.equal(result.skipped[0].server_reset_recorded, true);
  assert.match(result.skipped[0].error, /ECONNRESET/);
  assert.equal(result.applied.length, 1);
  assert.equal(result.applied[0].story_id, "still_runs");
});

test("apply local script extension audio restarts local TTS once on recoverable failures", async () => {
  const generated = [];
  const recoveries = [];
  const result = await applyLocalScriptExtensionAudio({
    plan: {
      drafts: [
        {
          story_id: "recovers_once",
          action: "ready_for_local_liam_audio",
          proposed_full_script: "Ready script one. Follow Pulse Gaming so you never miss a beat.",
          proposed_words: 190,
          estimated_seconds: 62.7,
        },
      ],
    },
    generateTts: async (_text, outputRel) => {
      generated.push(outputRel);
      if (generated.length === 1) throw new Error("read ECONNRESET");
    },
    recoverLocalTts: async (context) => {
      recoveries.push(context);
      return { ok: true, action: "restart", after: { status: "ok" } };
    },
    measureDuration: async () => 66.4,
    localTts: READY_TTS,
  });

  assert.equal(generated.length, 2);
  assert.equal(recoveries.length, 1);
  assert.equal(recoveries[0].storyId, "recovers_once");
  assert.equal(recoveries[0].failure.code, "connection_reset");
  assert.equal(result.skipped.length, 0);
  assert.equal(result.applied.length, 1);
  assert.equal(result.applied[0].story_id, "recovers_once");
  assert.equal(result.applied[0].tts_attempts, 2);
  assert.equal(result.applied[0].server_recovery.action, "restart");
});

test("apply local script extension audio skips ready drafts when local voice is not Liam", async () => {
  let generated = 0;
  const result = await applyLocalScriptExtensionAudio({
    plan: {
      local_tts: {
        ready: true,
        status: "ok",
        phase: "ready",
        voice: {
          alias: "christopher",
          loaded: true,
          ref_resolved: true,
        },
      },
      drafts: [
        {
          story_id: "ready_bad_voice",
          action: "ready_for_local_liam_audio",
          proposed_full_script: "Ready script. Follow Pulse Gaming so you never miss a beat.",
          proposed_words: 190,
          estimated_seconds: 64.2,
        },
      ],
    },
    generateTts: async () => {
      generated += 1;
    },
  });

  assert.equal(generated, 0);
  assert.equal(result.applied.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reason, "unsafe_voice");
  assert.equal(result.skipped[0].failure_code, "unsafe_voice");
});

test("apply local script extension audio records missing timestamps as a proof failure", async () => {
  const result = await applyLocalScriptExtensionAudio({
    plan: {
      drafts: [
        {
          story_id: "ready_missing_ts",
          action: "ready_for_local_liam_audio",
          proposed_full_script: "Ready script. Follow Pulse Gaming so you never miss a beat.",
          proposed_words: 190,
          estimated_seconds: 64.4,
        },
      ],
    },
    generateTts: async () => null,
    measureDuration: async () => 66.4,
    localTts: READY_TTS,
  });

  assert.equal(result.applied[0].duration_verdict, "pass");
  assert.equal(result.applied[0].failure_code, "missing_timestamps");
  assert.match(result.applied[0].local_voice_metadata, /not_stamped:timestamps_missing/);
});

test("apply local script extension audio records duration measurement failures without aborting the batch", async () => {
  const result = await applyLocalScriptExtensionAudio({
    plan: {
      drafts: [
        {
          story_id: "extended_measure_fails",
          action: "ready_for_local_liam_audio",
          proposed_full_script: "Ready script one. Follow Pulse Gaming so you never miss a beat.",
          proposed_words: 190,
          estimated_seconds: 64.4,
        },
        {
          story_id: "extended_measure_ok",
          action: "ready_for_local_liam_audio",
          proposed_full_script: "Ready script two. Follow Pulse Gaming so you never miss a beat.",
          proposed_words: 191,
          estimated_seconds: 65.1,
        },
      ],
    },
    generateTts: async () => null,
    measureDuration: async (outputRel) => {
      if (outputRel.includes("extended_measure_fails")) throw new Error("ffprobe duration failed");
      return 66.4;
    },
    localTts: READY_TTS,
  });

  assert.equal(result.applied.length, 2);
  assert.equal(result.applied[0].story_id, "extended_measure_fails");
  assert.equal(result.applied[0].duration_verdict, "unknown");
  assert.equal(result.applied[0].failure_code, "duration_unknown");
  assert.equal(result.applied[1].story_id, "extended_measure_ok");
  assert.equal(result.applied[1].duration_verdict, "pass");
});
