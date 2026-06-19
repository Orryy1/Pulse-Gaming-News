"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  repairPlatformNativePacks,
} = require("../../lib/goal-platform-native-pack-repair");
const { evaluateGoalPublicCopy } = require("../../lib/goal-public-copy-qa");

async function legacyArtifact() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-native-pack-repair-"));
  const artifactDir = path.join(root, "story-native");
  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "story-native",
    canonical_subject: "Forza Horizon 6",
    canonical_angle: "paid early access created a major Steam demand signal",
    selected_title: "Forza Horizon 6 Steam Peak Exposes Xbox's Early-Access Bet",
    thumbnail_headline: "FORZA STEAM SPIKE",
    first_spoken_line: "Forza Horizon 6 just gave Xbox the paid access warning it needed.",
    primary_source: "GamesRadar+",
  });
  await fs.writeJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    schema_version: 1,
    story_id: "story-native",
    publish_status: "GREEN",
    outputs: {
      youtube_shorts: { duration_seconds: { min: 35, max: 60 }, cta: "Follow for more." },
      tiktok: { duration_seconds: { min: 61, max: 90 }, cta: "Follow for more." },
      instagram_reels: { duration_seconds: { min: 25, max: 60 } },
      facebook_reels: { duration_seconds: { min: 35, max: 60 } },
      x: { duration_seconds: { min: 25, max: 60 } },
    },
    no_publish_triggered: true,
  });
  await fs.writeJson(path.join(artifactDir, "platform_variant_scorecard.json"), {
    status: "ready",
    outputs: {},
  });
  await fs.writeJson(path.join(artifactDir, "affiliate_link_manifest.json"), {
    story_id: "story-native",
    disclosure_required: true,
    primary_link: { merchant: "Amazon UK", url: "https://example.com/controller" },
  });
  await fs.writeJson(path.join(artifactDir, "landing_page_manifest.json"), {
    landing_page_slug: "forza-horizon-6-steam-peak",
  });
  return {
    root,
    storyPackages: [{
      story_id: "story-native",
      verdict: "GREEN",
      blockers: [],
      artifact_dir: artifactDir,
    }],
  };
}

test("platform-native pack repair upgrades legacy candidate artefacts with backups", async () => {
  const { storyPackages, root } = await legacyArtifact();

  const dryRun = await repairPlatformNativePacks({
    storyPackages,
    generatedAt: "2026-05-22T16:05:00.000Z",
    apply: false,
  });

  assert.equal(dryRun.summary.repairable_count, 1);
  assert.equal(dryRun.summary.repaired_count, 0);

  const applied = await repairPlatformNativePacks({
    storyPackages,
    generatedAt: "2026-05-22T16:06:00.000Z",
    apply: true,
    backupRoot: path.join(root, "backups"),
  });

  assert.equal(applied.summary.repairable_count, 1);
  assert.equal(applied.summary.repaired_count, 1);
  assert.equal(applied.safety.no_publish_triggered, true);
  assert.equal(applied.safety.no_db_mutation, true);

  const manifest = await fs.readJson(path.join(storyPackages[0].artifact_dir, "platform_publish_manifest.json"));
  assert.equal(manifest.platform_native_evidence.verdict, "pass");
  assert.equal(manifest.platform_native_evidence.platforms.length, 7);
  assert.equal(manifest.outputs.tiktok.commercial_content_setting_recommendation, "required_for_affiliate_or_brand_promotion");
  assert.equal(manifest.outputs.pinterest.landing_page_required, true);
  assert.equal(await fs.pathExists(applied.repairs[0].backup_files.platform_publish_manifest), true);
  assert.equal(await fs.pathExists(path.join(storyPackages[0].artifact_dir, "threads_publish_pack.json")), true);
});

test("platform-native pack repair refreshes stale media-house score artefacts", async () => {
  const { storyPackages, root } = await legacyArtifact();
  const artifactDir = storyPackages[0].artifact_dir;
  await fs.writeJson(path.join(artifactDir, "pulse_media_house_score.json"), {
    story_id: "story-native",
    verdict: "RED",
    status: "fail",
    scores: {
      title_strength_score: 42,
      first_frame_score: 38,
      overall_media_house_score: 60,
    },
    hard_failures: [
      "media_house:platform_copy_too_plain",
      "media_house:first_frame_or_thumbnail_not_attention_led",
    ],
  });

  const applied = await repairPlatformNativePacks({
    storyPackages,
    generatedAt: "2026-06-19T18:55:00.000Z",
    apply: true,
    backupRoot: path.join(root, "backups-media-house"),
  });

  assert.equal(applied.summary.repaired_count, 1);
  const score = await fs.readJson(path.join(artifactDir, "pulse_media_house_score.json"));
  assert.equal(score.generated_at, "2026-06-19T18:55:00.000Z");
  assert.notEqual(score.scores.title_strength_score, 42);
  assert.notEqual(score.scores.first_frame_score, 38);
  assert.ok(score.scores.first_frame_score > 0);
  assert.ok(!score.hard_failures.includes("media_house:first_frame_or_thumbnail_not_attention_led"));
  assert.ok(applied.repairs[0].repaired_files.includes(path.join(artifactDir, "pulse_media_house_score.json")));
  assert.equal(await fs.pathExists(applied.repairs[0].backup_files.pulse_media_house_score), true);
});

test("platform-native pack repair refreshes stale media-house score even when packs are already native", async () => {
  const { storyPackages, root } = await legacyArtifact();
  const firstPass = await repairPlatformNativePacks({
    storyPackages,
    generatedAt: "2026-06-19T19:00:00.000Z",
    apply: true,
    backupRoot: path.join(root, "backups-first-pass"),
  });
  assert.equal(firstPass.summary.repaired_count, 1);

  const artifactDir = storyPackages[0].artifact_dir;
  await fs.writeJson(path.join(artifactDir, "pulse_media_house_score.json"), {
    story_id: "story-native",
    generated_at: "2026-06-19T18:00:00.000Z",
    verdict: "RED",
    status: "fail",
    scores: {
      title_strength_score: 42,
      first_frame_score: 38,
      overall_media_house_score: 60,
    },
    hard_failures: ["media_house:first_frame_or_thumbnail_not_attention_led"],
  });

  const dryRun = await repairPlatformNativePacks({
    storyPackages,
    generatedAt: "2026-06-19T19:01:00.000Z",
    apply: false,
  });
  assert.equal(dryRun.summary.repairable_count, 1);
  assert.equal(dryRun.items[0].media_house_score_stale, true);

  const applied = await repairPlatformNativePacks({
    storyPackages,
    generatedAt: "2026-06-19T19:02:00.000Z",
    apply: true,
    backupRoot: path.join(root, "backups-media-house-only"),
  });

  assert.equal(applied.summary.repaired_count, 1);
  const score = await fs.readJson(path.join(artifactDir, "pulse_media_house_score.json"));
  assert.equal(score.generated_at, "2026-06-19T19:02:00.000Z");
  assert.notEqual(score.scores.first_frame_score, 38);
  assert.ok(!score.hard_failures.includes("media_house:first_frame_or_thumbnail_not_attention_led"));
});

test("platform-native pack repair exposes target media-house and attention blockers", async () => {
  const { storyPackages } = await legacyArtifact();
  const artifactDir = storyPackages[0].artifact_dir;
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "plain-score-story",
    canonical_subject: "Forza Horizon 6",
    canonical_game: "Forza Horizon 6",
    canonical_angle: "review score creates a weak Xbox argument before launch",
    selected_title: "Forza Horizon 6 Scores 84 On PC Gamer",
    canonical_title: "Forza Horizon 6 Scores 84 On PC Gamer",
    thumbnail_headline: "FORZA REVIEW SCORE",
    first_spoken_line: "Forza Horizon 6 now has a score Xbox fans will argue over.",
    narration_script:
      "Forza Horizon 6 now has a score Xbox fans will argue over. The question is whether one review number changes the launch conversation. Follow Pulse Gaming so you never miss a beat.",
    primary_source: "PC Gamer",
    description:
      "Forza Horizon 6 now has a review score players will use in the Xbox argument before launch. Source: PC Gamer.",
  });

  const dryRun = await repairPlatformNativePacks({
    storyPackages,
    generatedAt: "2026-06-19T20:10:00.000Z",
    apply: false,
  });

  assert.equal(dryRun.items[0].target_media_house_verdict, "RED");
  assert.ok(
    dryRun.items[0].target_media_house_hard_failures.includes("media_house:title_lacks_curiosity_gap"),
  );
  assert.ok(
    dryRun.items[0].target_shorts_attention_blockers.includes("title_lacks_curiosity_gap"),
  );
});

test("platform-native pack repair creates missing platform manifests when target copy passes", async () => {
  const { storyPackages, root } = await legacyArtifact();
  const artifactDir = storyPackages[0].artifact_dir;
  await fs.remove(path.join(artifactDir, "platform_publish_manifest.json"));
  await fs.remove(path.join(artifactDir, "platform_variant_scorecard.json"));
  await fs.writeJson(path.join(artifactDir, "render_manifest.json"), {
    rendered_duration_s: 42.4,
  });

  const dryRun = await repairPlatformNativePacks({
    storyPackages,
    generatedAt: "2026-06-18T15:05:00.000Z",
    apply: false,
  });

  assert.equal(dryRun.summary.repairable_count, 1);
  assert.equal(dryRun.items[0].status, "repairable");
  assert.deepEqual(dryRun.items[0].target_public_copy_failures, []);

  const applied = await repairPlatformNativePacks({
    storyPackages,
    generatedAt: "2026-06-18T15:06:00.000Z",
    apply: true,
    backupRoot: path.join(root, "backups-missing-platform-manifest"),
  });

  assert.equal(applied.summary.repaired_count, 1);
  const manifest = await fs.readJson(path.join(artifactDir, "platform_publish_manifest.json"));
  assert.equal(manifest.platform_native_evidence.verdict, "pass");
  assert.equal(await fs.pathExists(path.join(artifactDir, "youtube_publish_pack.json")), true);
  assert.equal(await fs.pathExists(path.join(artifactDir, "instagram_publish_pack.json")), true);
  assert.equal(await fs.pathExists(path.join(artifactDir, "facebook_publish_pack.json")), true);
});

test("platform-native pack repair fixes placeholder social copy even when old evidence passed", async () => {
  const { storyPackages, root } = await legacyArtifact();
  const artifactDir = storyPackages[0].artifact_dir;
  const manifestPath = path.join(artifactDir, "platform_publish_manifest.json");
  const manifest = await fs.readJson(manifestPath);
  manifest.platform_native_evidence = {
    verdict: "pass",
    platforms: [
      { platform: "youtube_shorts", required_fields_present: true },
      { platform: "facebook_reels", required_fields_present: true },
      { platform: "x", required_fields_present: true },
    ],
    blind_duplicate_pairs: [],
  };
  manifest.outputs.facebook_reels = {
    duration_seconds: { min: 35, max: 60 },
    explanatory_framing: "Forza Horizon 6 matters because source_locked_update.",
    page_caption: "Forza Horizon 6: source_locked_update. Source: GamesRadar+.",
  };
  manifest.outputs.x = {
    duration_seconds: { min: 25, max: 60 },
    hot_take_post:
      "Forza Horizon 6 is the part of this story everyone will argue about: source_locked_update.",
    concise_news_post: "Forza Horizon 6: source_locked_update.",
  };
  manifest.outputs.threads = {
    discussion_post: "Forza Horizon 6 is worth a quick source check.",
    duplicate_x_wording_allowed: false,
    landing_page_link: "/p/forza-horizon-6-steam-peak",
    tone: "discussion-led",
  };
  manifest.outputs.pinterest = {
    pin_title: "Forza Horizon 6 story guide",
    pin_description: "source_locked_update.",
    disclosure: "Affiliate links may earn us a commission.",
    landing_page_link: "/p/forza-horizon-6-steam-peak",
    evergreen_only: true,
  };
  await fs.writeJson(manifestPath, manifest, { spaces: 2 });

  const applied = await repairPlatformNativePacks({
    storyPackages,
    generatedAt: "2026-05-22T17:20:00.000Z",
    apply: true,
    backupRoot: path.join(root, "backups-placeholder"),
  });

  assert.equal(applied.summary.repairable_count, 1);
  assert.equal(applied.summary.repaired_count, 1);
  const repaired = await fs.readJson(manifestPath);
  assert.doesNotMatch(JSON.stringify(repaired.outputs), /source_locked_update/i);
  assert.match(repaired.outputs.x.concise_news_post, /paid early access/i);
});

test("platform-native pack repair fixes stale subject/source drift even when old native evidence passed", async () => {
  const { storyPackages, root } = await legacyArtifact();
  const artifactDir = storyPackages[0].artifact_dir;
  const canonicalPath = path.join(artifactDir, "canonical_story_manifest.json");
  const canonical = await fs.readJson(canonicalPath);
  await fs.writeJson(
    canonicalPath,
    {
      ...canonical,
      canonical_subject: "Subnautica 2",
      canonical_game: "Subnautica 2",
      canonical_angle: "launch timing may have leaked early",
      selected_title: "Subnautica 2 Leak Timing Got Messy",
      thumbnail_headline: "SUBNAUTICA 2 TIMING",
      first_spoken_line: "Subnautica 2 has a messy early timing claim.",
      primary_source: "Respawnfirst",
      description: "Subnautica 2 has a messy early timing claim. Source: Respawnfirst.",
    },
    { spaces: 2 },
  );

  const manifestPath = path.join(artifactDir, "platform_publish_manifest.json");
  const manifest = await fs.readJson(manifestPath);
  manifest.platform_native_evidence = {
    verdict: "pass",
    platforms: [{ platform: "x", required_fields_present: true }],
    blind_duplicate_pairs: [],
  };
  manifest.outputs.x = {
    hot_take_post:
      "Forza Horizon 6 is the part of this story everyone will argue about.",
    source_safe_post: "Forza Horizon 6 Just Got A Date\n\nSource: Youtube.",
    concise_news_post: "Forza Horizon 6: racing setup.",
    thread_posts: ["Forza Horizon 6 Just Got A Date", "Source: Youtube."],
    poll_candidate: "Is Forza Horizon 6 a buy-now story?",
    landing_page_link: "/p/forza-horizon-6-story-native",
  };
  manifest.outputs.threads = {
    discussion_post: "Forza Horizon 6 is worth watching. Source: Youtube.",
    duplicate_x_wording_allowed: false,
    landing_page_link: "/p/forza-horizon-6-story-native",
    tone: "discussion-led",
  };
  await fs.writeJson(manifestPath, manifest, { spaces: 2 });

  const dryRun = await repairPlatformNativePacks({
    storyPackages,
    generatedAt: "2026-05-23T13:15:00.000Z",
    apply: false,
  });
  assert.equal(dryRun.summary.repairable_count, 1);
  assert.ok(dryRun.items[0].current_public_copy_failures.includes("public_copy:platform_copy_missing_canonical_subject"));
  assert.ok(dryRun.items[0].current_public_copy_failures.includes("public_copy:platform_source_label_mismatch"));

  const applied = await repairPlatformNativePacks({
    storyPackages,
    generatedAt: "2026-05-23T13:16:00.000Z",
    apply: true,
    backupRoot: path.join(root, "backups-stale-platform"),
  });

  assert.equal(applied.summary.repaired_count, 1);
  const repaired = await fs.readJson(manifestPath);
  const qa = evaluateGoalPublicCopy({
    ...(await fs.readJson(canonicalPath)),
    platform_publish_manifest: repaired,
  });
  assert.equal(qa.verdict, "pass", qa.failures.join(", "));
  assert.match(repaired.outputs.x.hot_take_post, /Subnautica 2/);
  assert.match(repaired.outputs.threads.discussion_post, /Subnautica 2/);
  assert.doesNotMatch(JSON.stringify(repaired.outputs), /Source:\s*Youtube/i);
});

test("platform-native pack repair refreshes passed evidence missing story-format signatures", async () => {
  const { storyPackages, root } = await legacyArtifact();
  const artifactDir = storyPackages[0].artifact_dir;
  const manifestPath = path.join(artifactDir, "platform_publish_manifest.json");
  const manifest = await fs.readJson(manifestPath);
  manifest.platform_native_evidence = {
    verdict: "pass",
    platforms: [{ platform: "youtube_shorts", status: "pass" }],
    blind_duplicate_pairs: [],
  };
  await fs.writeJson(manifestPath, manifest, { spaces: 2 });

  const dryRun = await repairPlatformNativePacks({
    storyPackages,
    generatedAt: "2026-05-29T01:25:00.000Z",
    apply: false,
  });

  assert.equal(dryRun.summary.repairable_count, 1);
  assert.equal(dryRun.items[0].status, "repairable");

  const applied = await repairPlatformNativePacks({
    storyPackages,
    generatedAt: "2026-05-29T01:26:00.000Z",
    apply: true,
    backupRoot: path.join(root, "backups-format-signature"),
  });

  assert.equal(applied.summary.repaired_count, 1);
  const repaired = await fs.readJson(manifestPath);
  assert.match(repaired.platform_native_evidence.format_signature, /platform access|game price watch/);
});

test("platform-native pack repair refreshes stale affiliate disclosure and landing route evidence", async () => {
  const { storyPackages, root } = await legacyArtifact();
  const artifactDir = storyPackages[0].artifact_dir;
  const affiliatePath = path.join(artifactDir, "affiliate_link_manifest.json");
  await fs.writeJson(affiliatePath, {
    story_id: "story-native",
    disclosure_required: false,
    primary_link: null,
    fallback_links: [],
    disclosure_copy: {
      short: "No affiliate links are attached to this story.",
      landing: "This page is editorial first.",
    },
    landing_page_route: "/p/story-native-clean",
  });
  await fs.writeJson(path.join(artifactDir, "landing_page_manifest.json"), {
    story_id: "story-native",
    landing_page_slug: "story-native-clean",
    landing_page_route: "/p/story-native-clean",
  });

  const manifestPath = path.join(artifactDir, "platform_publish_manifest.json");
  const manifest = await fs.readJson(manifestPath);
  manifest.platform_native_evidence = {
    verdict: "pass",
    platforms: [{ platform: "youtube_shorts", status: "pass" }],
    blind_duplicate_pairs: [],
    format_signature: "platform access old signature",
  };
  manifest.outputs.youtube_shorts = {
    ...manifest.outputs.youtube_shorts,
    disclosure_status: {
      required: true,
      type: "affiliate",
      caption: "Affiliate links may earn us a commission.",
    },
    description: "Forza Horizon 6. Sources and related links: /p/old-affiliate-route",
    profile_or_landing_page_cta: "Story sources and related links: /p/old-affiliate-route",
  };
  manifest.outputs.tiktok = {
    ...manifest.outputs.tiktok,
    disclosure_flag: "commercial_content_disclosure_required",
    product_link_eligibility: "review_required",
  };
  await fs.writeJson(manifestPath, manifest, { spaces: 2 });

  const dryRun = await repairPlatformNativePacks({
    storyPackages,
    generatedAt: "2026-05-29T02:00:00.000Z",
    apply: false,
  });

  assert.equal(dryRun.summary.repairable_count, 1);
  assert.equal(dryRun.items[0].affiliate_output_stale, true);

  const applied = await repairPlatformNativePacks({
    storyPackages,
    generatedAt: "2026-05-29T02:01:00.000Z",
    apply: true,
    backupRoot: path.join(root, "backups-affiliate-stale"),
  });

  assert.equal(applied.summary.repaired_count, 1);
  const repaired = await fs.readJson(manifestPath);
  assert.equal(repaired.outputs.youtube_shorts.disclosure_status.required, false);
  assert.equal(repaired.outputs.tiktok.product_link_eligibility, "not_used");
  assert.match(repaired.outputs.youtube_shorts.profile_or_landing_page_cta, /story-native-clean/);
});

test("platform-native pack repair refreshes stale cover headlines", async () => {
  const { storyPackages, root } = await legacyArtifact();
  const artifactDir = storyPackages[0].artifact_dir;
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "gears-e-day-cover",
    canonical_subject: "Gears of War: E-Day",
    canonical_game: "Gears of War: E-Day",
    canonical_angle: "PC requirements list a 130 GB SSD install",
    selected_title: "Gears E-Day Has A 130GB Problem",
    canonical_title: "Gears E-Day Has A 130GB Problem",
    thumbnail_headline: "GEARS OF WAR",
    thumbnail_text: "GEARS OF WAR",
    suggested_thumbnail_text: "GEARS OF WAR",
    first_spoken_line: "Gears of War E-Day just made its PC pitch very simple.",
    narration_script:
      "Gears of War E-Day just made its PC pitch very simple. The question is whether a 130 gig install is now normal for a campaign-first blockbuster.",
    primary_source: "PC Gamer",
    description: "Gears of War E-Day PC requirements list a 130 GB SSD install. Source: PC Gamer.",
  });
  await fs.writeJson(path.join(artifactDir, "render_manifest.json"), {
    rendered_duration_s: 52.2,
  });

  await repairPlatformNativePacks({
    storyPackages,
    generatedAt: "2026-06-19T14:45:00.000Z",
    apply: true,
    backupRoot: path.join(root, "backups-native-baseline"),
  });

  const manifestPath = path.join(artifactDir, "platform_publish_manifest.json");
  const manifest = await fs.readJson(manifestPath);
  manifest.platform_native_evidence.verdict = "pass";
  manifest.outputs.youtube_shorts.cover_frame.headline = "GEARS WAR E-DAY 130GB TEST";
  manifest.outputs.tiktok.caption = "Gears of War E-Day just made its PC pitch very simple. Source: PC Gamer.";
  await fs.writeJson(manifestPath, manifest, { spaces: 2 });

  const dryRun = await repairPlatformNativePacks({
    storyPackages,
    generatedAt: "2026-06-19T14:46:00.000Z",
    apply: false,
  });

  assert.equal(dryRun.summary.repairable_count, 1);
  assert.equal(dryRun.items[0].affiliate_output_stale, true);
  assert.equal(dryRun.items[0].target_affiliate_output.youtube_cover_headline, "GEARS E-DAY 130GB TEST");

  const applied = await repairPlatformNativePacks({
    storyPackages,
    generatedAt: "2026-06-19T14:47:00.000Z",
    apply: true,
    backupRoot: path.join(root, "backups-cover-headline"),
  });

  assert.equal(applied.summary.repaired_count, 1);
  const repaired = await fs.readJson(manifestPath);
  assert.equal(repaired.outputs.youtube_shorts.cover_frame.headline, "GEARS E-DAY 130GB TEST");
  assert.match(repaired.outputs.tiktok.caption, /asking players for 130 GB|storage into part of the launch pitch/i);
  const repairedCanonical = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  assert.equal(repairedCanonical.thumbnail_headline, "GEARS E-DAY 130GB TEST");
  assert.equal(repairedCanonical.thumbnail_text, "GEARS E-DAY 130GB TEST");
  assert.equal(repairedCanonical.suggested_thumbnail_text, "GEARS E-DAY 130GB TEST");
  const score = await fs.readJson(path.join(artifactDir, "pulse_media_house_score.json"));
  assert.ok(!score.hard_failures.includes("media_house:first_frame_or_thumbnail_not_attention_led"));
  assert.equal(applied.repairs[0].backup_files.canonical_story_manifest.endsWith("canonical_story_manifest.json"), true);
});

test("platform-native repair derives Facebook Reels duration from render manifest", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-platform-native-repair-"));
  const artifactDir = path.join(tmp, "story");
  await fs.ensureDir(artifactDir);

  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "story_duration_from_render",
    canonical_subject: "Mina the Hollower",
    selected_title: "Mina The Hollower Ending Points At The Sequel Risk",
    primary_source: { name: "GameSpot" },
    first_spoken_line: "Mina the Hollower may have hidden its sequel problem inside the ending.",
    narration_script:
      "Mina the Hollower may have hidden its sequel problem inside the ending. Follow Pulse Gaming so you never miss a beat.",
    thumbnail_headline: "MINA SEQUEL RISK",
  });
  await fs.writeJson(path.join(artifactDir, "render_manifest.json"), {
    rendered_duration_s: 51.266,
  });
  await fs.writeJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    outputs: {
      facebook_reels: {
        platform: "facebook_reels",
        native_role: "context_first_reel",
        explanatory_framing: "Mina the Hollower matters because of the ending.",
        page_caption: "Mina the Hollower: sequel risk. Source: GameSpot.",
        link_routing_strategy: "page_caption_or_comment_link",
      },
    },
    platform_native_evidence: { verdict: "fail" },
  });
  await fs.writeJson(path.join(artifactDir, "platform_variant_scorecard.json"), {});
  await fs.writeJson(path.join(artifactDir, "affiliate_link_manifest.json"), {});
  await fs.writeJson(path.join(artifactDir, "landing_page_manifest.json"), {
    landing_page_slug: "mina-the-hollower-sequel-risk",
  });

  await repairPlatformNativePacks({
    storyPackages: [{ story_id: "story_duration_from_render", artifact_dir: artifactDir }],
    apply: true,
    backupRoot: path.join(tmp, "backups"),
    generatedAt: "2026-06-13T00:00:00.000Z",
  });

  const facebookPack = await fs.readJson(path.join(artifactDir, "facebook_publish_pack.json"));
  const platformManifest = await fs.readJson(path.join(artifactDir, "platform_publish_manifest.json"));
  const facebookEvidence = platformManifest.platform_native_evidence.platforms.find(
    (platform) => platform.platform === "facebook_reels",
  );

  assert.equal(facebookPack.duration_seconds, 51.266);
  assert.equal(facebookEvidence.status, "pass");
  assert.deepEqual(facebookEvidence.missing_fields, []);
  assert.equal(platformManifest.platform_native_evidence.verdict, "pass");
});
