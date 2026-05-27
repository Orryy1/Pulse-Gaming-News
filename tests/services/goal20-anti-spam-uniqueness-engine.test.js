"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  REQUIRED_UNIQUENESS_CHECKS,
  buildGoal20AntiSpamUniquenessEngine,
  writeGoal20AntiSpamUniquenessEngine,
} = require("../../lib/goal20-anti-spam-uniqueness-engine");

async function makeStoryPackage(root, storyId, overrides = {}) {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  const title = overrides.title || `Fresh Angle ${storyId}`;
  const firstLine = overrides.firstLine || `${title} has a new source-backed update.`;
  const cta = overrides.cta || `Follow Pulse Gaming for ${storyId} context.`;
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: title,
    thumbnail_headline: overrides.thumbnail || title.toUpperCase(),
    narration_script: `${firstLine} The rest of the script adds source context without repeating the opener.`,
    pinned_comment: cta,
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    story_id: storyId,
    publish_status: "GREEN",
    outputs: {
      youtube_shorts: {
        title,
        description: `${firstLine} Source: Xbox.`,
        cta,
        cover_frame: { headline: overrides.thumbnail || title.toUpperCase() },
      },
      tiktok: {
        conversational_hook: firstLine,
        caption: `${firstLine} Source: Xbox.`,
        cta,
      },
      instagram_reels: {
        caption: `${firstLine} Source: Xbox.`,
        carousel_companion: {
          cards: overrides.carouselCards || ["cover", "source", "player impact", storyId],
        },
      },
      x: {
        hot_take_post: overrides.xPost || `${title} changes the story.`,
        landing_page_link: `/p/${storyId}`,
      },
      threads: {
        discussion_post: overrides.threadsPost || `${title} gives players a new angle.`,
        duplicate_x_wording_allowed: false,
      },
    },
    platform_native_evidence: {
      blind_duplicate_pairs: [],
      format_signature: overrides.postStructure || `structure-${storyId}`,
    },
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    assets: [
      {
        asset_id: `${storyId}-clip`,
        kind: "video",
        source_family: overrides.footageFamily || `family-${storyId}`,
      },
    ],
  });
  await fs.outputJson(path.join(artifactDir, "director_beat_map.json"), {
    layout_template: overrides.layout || `layout-${storyId}`,
    transition_plan: {
      transitions: overrides.transitions || [`transition-${storyId}`],
    },
    sound_transition_plan: {
      sfx: { cues: [{ id: overrides.sfxCue || `cue-${storyId}`, family: overrides.sfxFamily || `sfx-${storyId}` }] },
    },
  });
  await fs.outputJson(path.join(artifactDir, "sfx_manifest.json"), {
    cues: [{ id: overrides.sfxCue || `cue-${storyId}`, family: overrides.sfxFamily || `sfx-${storyId}` }],
  });
  await fs.outputJson(path.join(artifactDir, "affiliate_link_manifest.json"), {
    primary_link: overrides.affiliateOffer || { label: `Offer ${storyId}`, merchant: `Merchant ${storyId}` },
    fallback_links: [],
  });
  await fs.outputJson(path.join(artifactDir, "uniqueness_report.json"), overrides.existingUniqueness || {
    verdict: "pass",
    failures: [],
    warnings: [],
    matches: [],
  });
  return { story_id: storyId, artifact_dir: artifactDir, title };
}

function readyGoal19(...storyIds) {
  return {
    stories: storyIds.map((storyId) => ({
      story_id: storyId,
      verdict: "GREEN",
      blockers: [],
    })),
  };
}

function blockedGoal19(...storyIds) {
  return {
    stories: storyIds.map((storyId) => ({
      story_id: storyId,
      verdict: "RED",
      blockers: ["upstream:goal18_finance_crypto_firewall_blocked"],
    })),
  };
}

test("Goal 20 preserves Goal 19 blockers while unique direct checks pass", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal20-upstream-"));
  const storyA = await makeStoryPackage(root, "story-a", { title: "Forza Adds A Real Weather Detail" });
  const storyB = await makeStoryPackage(root, "story-b", { title: "Subnautica Devs Explain A Leak" });

  const report = await buildGoal20AntiSpamUniquenessEngine({
    storyPackages: [storyA, storyB],
    upstreamControlTowerReport: blockedGoal19("story-a", "story-b"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T04:37:23.858Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.direct_uniqueness_verdict, "PASS");
  assert.equal(report.summary.story_count, 2);
  assert.equal(report.summary.uniqueness_ready_story_count, 0);
  assert.equal(report.summary.direct_uniqueness_pass_story_count, 2);
  assert.equal(report.summary.publish_now_count, 0);
  assert.ok(report.stories[0].blockers.includes("upstream:goal19_autonomy_control_tower_blocked"));
  for (const check of REQUIRED_UNIQUENESS_CHECKS) {
    assert.equal(report.stories[0].uniqueness_checks[check].status, "pass", check);
  }
  assert.equal(report.uniqueness_report.stories[0].verdict, "pass");
  assert.equal(report.repetition_risk_score.stories[0].risk_score, 0);
});

test("Goal 20 hard-fails repeated structures and duplicated platform copy", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal20-hard-"));
  const common = {
    thumbnail: "JUST GOT BIGGER",
    firstLine: "This gaming story just got bigger.",
    cta: "Follow Pulse Gaming for the gaming stories behind the headline.",
    xPost: "This gaming story just got bigger.",
    threadsPost: "This gaming story just got bigger.",
    footageFamily: "shared-gameplay-family",
    layout: "stacked-news-card",
    transitions: ["zoom-punch", "whip-pan"],
    sfxCue: "news-hit",
    sfxFamily: "impact-hit",
    affiliateOffer: { label: "Xbox Controller", merchant: "Amazon" },
    carouselCards: ["cover", "source", "player impact", "related links"],
  };
  const storyA = await makeStoryPackage(root, "story-a", {
    ...common,
    title: "Forza Horizon 6 Just Got Bigger",
  });
  const storyB = await makeStoryPackage(root, "story-b", {
    ...common,
    title: "Subnautica 2 Just Got Bigger",
  });

  const report = await buildGoal20AntiSpamUniquenessEngine({
    storyPackages: [storyA, storyB],
    upstreamControlTowerReport: readyGoal19("story-a", "story-b"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T04:37:23.858Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.direct_uniqueness_verdict, "BLOCKED");
  for (const blocker of [
    "anti_spam:repeated_title_structure",
    "anti_spam:repeated_thumbnail_structure",
    "anti_spam:repeated_first_line",
    "anti_spam:reused_footage_family",
    "anti_spam:duplicate_x_thread_copy",
    "anti_spam:repeated_instagram_carousel_format",
  ]) {
    assert.ok(report.blocker_counts[blocker] >= 1, blocker);
    assert.ok(report.direct_risk_counts[blocker] >= 1, blocker);
  }
  assert.ok(report.stories[0].repetition_risk.risk_score >= 80);
  assert.equal(report.variation_recommendations.stories[0].status, "blocked_until_variation_repair");
});

test("Goal 20 treats reused CTA and affiliate offer patterns as review risk", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal20-warning-"));
  const storyA = await makeStoryPackage(root, "story-a", {
    title: "Avowed Patch Adds New Combat Detail",
    cta: "Follow Pulse Gaming for the gaming stories behind the headline.",
    affiliateOffer: { label: "Xbox Controller", merchant: "Amazon" },
  });
  const storyB = await makeStoryPackage(root, "story-b", {
    title: "Hades 2 Update Changes A Boss Fight",
    cta: "Follow Pulse Gaming for the gaming stories behind the headline.",
    affiliateOffer: { label: "Xbox Controller", merchant: "Amazon" },
  });

  const report = await buildGoal20AntiSpamUniquenessEngine({
    storyPackages: [storyA, storyB],
    upstreamControlTowerReport: readyGoal19("story-a", "story-b"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T04:37:23.858Z",
  });

  assert.equal(report.verdict, "PARTIAL");
  assert.equal(report.direct_uniqueness_verdict, "PARTIAL");
  assert.equal(report.summary.direct_uniqueness_review_story_count, 2);
  assert.equal(report.stories[0].direct_uniqueness_status, "review");
  assert.ok(report.stories[0].warnings.includes("anti_spam:cta_reused"));
  assert.ok(report.stories[0].warnings.includes("anti_spam:affiliate_offer_reused"));
  assert.equal(report.variation_recommendations.stories[0].status, "variation_recommended");
});

test("Goal 20 writes required anti-spam artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal20-write-"));
  const story = await makeStoryPackage(root, "story-write", { title: "Metroid Prime Shows A Fresh Boss" });
  const report = await buildGoal20AntiSpamUniquenessEngine({
    storyPackages: [story],
    upstreamControlTowerReport: readyGoal19("story-write"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T04:37:23.858Z",
  });
  const written = await writeGoal20AntiSpamUniquenessEngine(report, { outputDir: path.join(root, "out") });

  assert.equal(report.verdict, "PASS");
  assert.equal(await fs.pathExists(written.readinessJson), true);
  assert.equal(await fs.pathExists(written.readinessMarkdown), true);
  assert.equal(await fs.pathExists(written.uniquenessReport), true);
  assert.equal(await fs.pathExists(written.repetitionRiskScore), true);
  assert.equal(await fs.pathExists(written.variationRecommendations), true);
});
