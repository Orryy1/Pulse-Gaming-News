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
        profile_or_landing_page_cta: overrides.profileCta || `Story source page: /p/${storyId}`,
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
    shot_plan: overrides.shotPlan || [],
    sound_transition_plan: {
      sfx: { cues: [{ id: overrides.sfxCue || `cue-${storyId}`, family: overrides.sfxFamily || `sfx-${storyId}` }] },
    },
  });
  await fs.outputJson(path.join(artifactDir, "sfx_manifest.json"), {
    cues: [{ id: overrides.sfxCue || `cue-${storyId}`, family: overrides.sfxFamily || `sfx-${storyId}` }],
    selected_assets: overrides.selectedSfxAssets || [],
    source_plan: {
      selected_assets: overrides.selectedSfxAssets || [],
    },
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

test("Goal 20 excludes upstream-skipped stories from active anti-spam blockers", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal20-skipped-"));
  const readyStory = await makeStoryPackage(root, "story-ready", {
    title: "Forza Adds A Real Weather Detail",
  });
  const skippedStory = await makeStoryPackage(root, "story-skipped", {
    title: "This gaming story",
    firstLine: "This gaming story just got bigger.",
    carouselCards: ["cover", "source", "player impact", "related links"],
    xPost: "This gaming story just got bigger.",
    threadsPost: "This gaming story just got bigger.",
    footageFamily: "shared-gameplay-family",
  });

  const report = await buildGoal20AntiSpamUniquenessEngine({
    storyPackages: [readyStory, skippedStory],
    upstreamControlTowerReport: {
      stories: [
        { story_id: "story-ready", verdict: "GREEN", blockers: [] },
        {
          story_id: "story-skipped",
          status: "skipped",
          skipped_status: "visual_source_deferred",
          skipped_reason: "defer_until_rights_backed_media_available",
          blockers: [],
        },
      ],
    },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-29T01:05:00.000Z",
  });

  const ready = report.stories.find((story) => story.story_id === "story-ready");
  const skipped = report.stories.find((story) => story.story_id === "story-skipped");

  assert.equal(report.verdict, "PASS");
  assert.equal(report.direct_uniqueness_verdict, "PASS");
  assert.equal(report.summary.story_count, 2);
  assert.equal(report.summary.active_story_count, 1);
  assert.equal(report.summary.skipped_story_count, 1);
  assert.equal(report.summary.uniqueness_ready_story_count, 1);
  assert.equal(ready.status, "ready");
  assert.equal(skipped.status, "skipped");
  assert.deepEqual(report.blocker_counts, {});
  assert.deepEqual(report.direct_risk_counts, {});
  assert.equal(report.uniqueness_report.stories.length, 1);
  assert.equal(report.repetition_risk_score.stories.length, 1);
  assert.equal(report.variation_recommendations.stories.length, 1);
});

test("Goal 20 treats varied licensed SFX assets as a different sound pattern", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal20-sfx-assets-"));
  const shared = {
    title: "Distinct Story",
    firstLine: "A named game has a sharper update today.",
    thumbnail: "SHARPER UPDATE",
    cta: "Follow Pulse Gaming for the next useful update.",
    footageFamily: "shared-source-family",
    layout: "studio-v4-proof-card",
    transitions: ["snap-card", "source-lock"],
    sfxCue: "hook-hit",
    sfxFamily: "impact-hit",
    postStructure: "platform-native-v4",
    carouselCards: ["cover", "source", "impact", "context"],
  };
  const storyA = await makeStoryPackage(root, "story-a", {
    ...shared,
    title: "Hades 2 Patch Changes Builds",
    selectedSfxAssets: [{ asset_id: "impact-a", role: "impact" }],
  });
  const storyB = await makeStoryPackage(root, "story-b", {
    ...shared,
    title: "Forza Horizon 6 Adds Weather",
    selectedSfxAssets: [{ asset_id: "impact-b", role: "impact" }],
  });

  const report = await buildGoal20AntiSpamUniquenessEngine({
    storyPackages: [storyA, storyB],
    upstreamControlTowerReport: readyGoal19("story-a", "story-b"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-28T20:10:00.000Z",
  });

  assert.equal(report.stories[0].uniqueness_checks.repeated_sfx.status, "pass");
  assert.equal(report.stories[1].uniqueness_checks.repeated_sfx.status, "pass");
  assert.equal((report.warning_counts || {})["anti_spam:sfx_pattern_reused"] || 0, 0);
});

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

test("Goal 20 ignores source-only pinned comments and compares real shot layouts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal20-cta-layout-signal-"));
  const storyA = await makeStoryPackage(root, "story-a", {
    title: "Hades 2 Patch Changes Builds",
    firstLine: "Hades 2 just changed the build conversation.",
    cta: "Source: Xbox.",
    profileCta: "Full Hades 2 source page: /p/hades-2-builds",
    layout: "visual_v4_director_brain",
    shotPlan: [
      { kind: "hook_slam", label: "PATCH SHIFT" },
      { kind: "proof_card", label: "SOURCE LOCK" },
      { kind: "motion_clip", label: "BUILD FOOTAGE" },
    ],
  });
  const storyB = await makeStoryPackage(root, "story-b", {
    title: "Forza Horizon 6 Adds Weather",
    firstLine: "Forza Horizon 6 just changed the track conversation.",
    cta: "Source: Xbox.",
    profileCta: "Full Forza source page: /p/forza-weather",
    layout: "visual_v4_director_brain",
    shotPlan: [
      { kind: "hook_slam", label: "WEATHER SHIFT" },
      { kind: "motion_clip", label: "TRACK FOOTAGE" },
      { kind: "price_snap", label: "GAME PASS CONTEXT" },
    ],
  });

  const report = await buildGoal20AntiSpamUniquenessEngine({
    storyPackages: [storyA, storyB],
    upstreamControlTowerReport: readyGoal19("story-a", "story-b"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-29T01:20:00.000Z",
  });

  assert.equal(report.stories[0].uniqueness_checks.repeated_ctas.status, "pass");
  assert.equal(report.stories[1].uniqueness_checks.repeated_ctas.status, "pass");
  assert.equal(report.stories[0].uniqueness_checks.repeated_layouts.status, "pass");
  assert.equal(report.stories[1].uniqueness_checks.repeated_layouts.status, "pass");
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

test("Goal 20 can defer duplicate candidates without blocking the remaining active batch", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal20-defer-duplicates-"));
  const storyA = await makeStoryPackage(root, "story-a", {
    title: "Forza Horizon 6 Reviews Are In",
    firstLine: "Forza Horizon 6 reviews are finally in.",
    footageFamily: "shared-forza-family",
  });
  const storyB = await makeStoryPackage(root, "story-b", {
    title: "Forza Horizon 6 Scores 84 On PC Gamer",
    firstLine: "Forza Horizon 6 reviews are finally in.",
    footageFamily: "shared-forza-family",
  });

  const report = await buildGoal20AntiSpamUniquenessEngine({
    storyPackages: [storyA, storyB],
    upstreamControlTowerReport: readyGoal19("story-a", "story-b"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-29T02:08:00.000Z",
    deferDuplicateCandidates: true,
  });

  const keeper = report.stories.find((story) => story.story_id === "story-a");
  const deferred = report.stories.find((story) => story.story_id === "story-b");

  assert.equal(report.verdict, "PASS");
  assert.equal(report.direct_uniqueness_verdict, "PASS");
  assert.equal(report.summary.active_story_count, 1);
  assert.equal(report.summary.skipped_story_count, 1);
  assert.equal(report.summary.duplicate_deferred_story_count, 1);
  assert.equal(keeper.status, "ready");
  assert.equal(deferred.status, "skipped");
  assert.equal(deferred.skipped_status, "anti_spam_duplicate_deferred");
  assert.deepEqual(report.blocker_counts, {});
  assert.deepEqual(report.direct_risk_counts, {});
  assert.equal(report.uniqueness_report.stories.length, 1);
});

test("Goal 20 uses governed social derivative carousel plans over stale generic companions", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal20-social-carousel-"));
  const staleCarousel = ["cover", "source", "player impact", "related links"];
  const storyA = await makeStoryPackage(root, "story-a", {
    title: "Forza Adds A Real Weather Detail",
    carouselCards: staleCarousel,
  });
  const storyB = await makeStoryPackage(root, "story-b", {
    title: "Subnautica Devs Explain A Predator Patch",
    carouselCards: staleCarousel,
  });

  const report = await buildGoal20AntiSpamUniquenessEngine({
    storyPackages: [storyA, storyB],
    upstreamControlTowerReport: readyGoal19("story-a", "story-b"),
    upstreamSocialDerivativesReport: {
      carousel_manifest: {
        stories: [
          {
            story_id: "story-a",
            format_signature: "cover>source_proof>score_check>quote_card>story_prompt>related_links",
            cards: [
              { type: "cover" },
              { type: "source_proof" },
              { type: "score_check" },
              { type: "quote_card" },
              { type: "story_prompt" },
              { type: "related_links" },
            ],
          },
          {
            story_id: "story-b",
            format_signature: "cover>quote_card>leak_boundary>source_proof>story_prompt>related_links",
            cards: [
              { type: "cover" },
              { type: "quote_card" },
              { type: "leak_boundary" },
              { type: "source_proof" },
              { type: "story_prompt" },
              { type: "related_links" },
            ],
          },
        ],
      },
    },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-29T01:18:00.000Z",
  });

  assert.equal(report.verdict, "PASS");
  assert.equal(report.direct_uniqueness_verdict, "PASS");
  assert.equal(report.stories[0].uniqueness_checks.instagram_carousel_formats.status, "pass");
  assert.equal(report.stories[1].uniqueness_checks.instagram_carousel_formats.status, "pass");
  assert.notEqual(
    report.stories[0].signals.instagram_carousel_signature,
    report.stories[1].signals.instagram_carousel_signature,
  );
});

test("Goal 20 uses governed X derivatives over stale repeated platform posts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal20-social-x-"));
  const repeatedX = "I want the next official beat to show whether this actually changes the game, the launch or the platform plan.";
  const storyA = await makeStoryPackage(root, "story-a", {
    title: "Forza Horizon 6 Reviews Are In",
    xPost: repeatedX,
  });
  const storyB = await makeStoryPackage(root, "story-b", {
    title: "Subnautica 2 Dev Calls Out Leakers",
    xPost: repeatedX,
  });

  const report = await buildGoal20AntiSpamUniquenessEngine({
    storyPackages: [storyA, storyB],
    upstreamControlTowerReport: readyGoal19("story-a", "story-b"),
    upstreamSocialDerivativesReport: {
      x_publish_pack: {
        stories: [
          { story_id: "story-a", hot_take_post: "Forza Horizon 6 has a score now. The question is whether that number changes the launch conversation." },
          { story_id: "story-b", hot_take_post: "Subnautica 2 is already a leak-control story. The next developer response matters more than the build itself." },
        ],
      },
    },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-29T01:55:00.000Z",
  });

  assert.equal(report.verdict, "PASS");
  assert.equal(report.direct_uniqueness_verdict, "PASS");
  assert.equal(report.stories[0].uniqueness_checks.x_thread_uniqueness.status, "pass");
  assert.equal(report.stories[1].uniqueness_checks.x_thread_uniqueness.status, "pass");
  assert.notEqual(report.stories[0].signals.x_signature, report.stories[1].signals.x_signature);
});

test("Goal 20 does not collapse distinct unmarked titles into one generic structure", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal20-title-structure-"));
  const storyA = await makeStoryPackage(root, "story-a", {
    title: "Xbox Controller Deal Has One Catch",
  });
  const storyB = await makeStoryPackage(root, "story-b", {
    title: "Star Wars Racer Date Leaked Early",
  });

  const report = await buildGoal20AntiSpamUniquenessEngine({
    storyPackages: [storyA, storyB],
    upstreamControlTowerReport: readyGoal19("story-a", "story-b"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-29T01:57:00.000Z",
  });

  assert.equal(report.verdict, "PASS");
  assert.equal(report.direct_uniqueness_verdict, "PASS");
  assert.equal(report.stories[0].uniqueness_checks.repeated_title_structures.status, "pass");
  assert.equal(report.stories[1].uniqueness_checks.repeated_title_structures.status, "pass");
  assert.notEqual(report.stories[0].signals.title_structure, report.stories[1].signals.title_structure);
});

test("Goal 20 treats reused CTA and affiliate offer patterns as review risk", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal20-warning-"));
  const storyA = await makeStoryPackage(root, "story-a", {
    title: "Avowed Patch Adds New Combat Detail",
    cta: "Follow Pulse Gaming for the gaming stories behind the headline.",
    profileCta: "Follow Pulse Gaming for the gaming stories behind the headline.",
    affiliateOffer: { label: "Xbox Controller", merchant: "Amazon" },
  });
  const storyB = await makeStoryPackage(root, "story-b", {
    title: "Hades 2 Update Changes A Boss Fight",
    cta: "Follow Pulse Gaming for the gaming stories behind the headline.",
    profileCta: "Follow Pulse Gaming for the gaming stories behind the headline.",
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
