"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  REQUIRED_CTA,
  applyLocalScriptExtensionAudio,
  buildLocalScriptExtensionPlan,
  extendScriptToLocalFlash,
  renderLocalScriptExtensionMarkdown,
  stripRequiredCta,
} = require("../../lib/ops/local-script-extension");

const ROOT = path.resolve(__dirname, "..", "..");

function queueItem(id, words = 140) {
  return {
    story_id: id,
    title: "GTA 6 evidence is stacking up",
    action: "extend_script_before_local_repair",
    runtime: {
      wordCount: words,
      minWords: 185,
      maxWords: 227,
    },
  };
}

test("local script extension expands short Liam scripts into the 61-75s local Flash range", () => {
  const draft = extendScriptToLocalFlash({
    story: {
      id: "rss_short",
      title: "GTA 6 evidence is stacking up",
      subreddit: "GameSpot",
      content_pillar: "Confirmed Drop",
      full_script: "GTA 6 has a confirmed clue today. ".repeat(17),
    },
    queueItem: queueItem("rss_short", 136),
    cleanText: (text) => text.replace(/\bGTA\s*6\b/gi, "G T A six"),
    env: {},
  });

  assert.equal(draft.action, "ready_for_local_liam_audio");
  assert.equal(draft.cta_exactly_once, true);
  assert.match(draft.proposed_full_script, new RegExp(`${REQUIRED_CTA.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
  assert.equal(draft.runtime.result, "pass");
  assert.ok(draft.proposed_words >= 185);
  assert.ok(draft.proposed_words <= 227);
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
  assert.match(tool, /--apply-local-audio/);
  assert.match(tool, /local_script_extension_audio_apply\.json/);
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
  });

  assert.equal(generated.length, 1);
  assert.equal(generated[0].rate, 1.0);
  assert.match(generated[0].outputRel, /test\/output\/local-script-extension\/audio\/ready_one_liam_extended\.mp3/);
  assert.equal(result.applied[0].duration_verdict, "pass");
  assert.equal(result.safety.mutates_production_db, false);
  assert.equal(result.safety.posts_to_platforms, false);
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
  });

  assert.equal(result.applied[0].duration_verdict, "reject_duration");
});
