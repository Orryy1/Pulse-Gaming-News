"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  repairPlatformNativePacks,
  refreshStoryPackageEntriesFromArtifacts,
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

test("platform-native pack repair clears stale RED publish status after GREEN governance", async () => {
  const { storyPackages, root } = await legacyArtifact();
  const artifactDir = storyPackages[0].artifact_dir;

  const firstPass = await repairPlatformNativePacks({
    storyPackages,
    generatedAt: "2026-06-21T20:50:00.000Z",
    apply: true,
    backupRoot: path.join(root, "backups-first-pass"),
  });
  assert.equal(firstPass.summary.repaired_count, 1);

  const manifestPath = path.join(artifactDir, "platform_publish_manifest.json");
  const manifest = await fs.readJson(manifestPath);
  await fs.writeJson(
    manifestPath,
    {
      ...manifest,
      publish_status: "RED",
      stale_reason: "older package verdict before refreshed governance",
    },
    { spaces: 2 },
  );
  await fs.writeJson(path.join(artifactDir, "publish_verdict.json"), {
    verdict: "GREEN",
    can_auto_publish: true,
    reason_codes: [],
  });

  const dryRun = await repairPlatformNativePacks({
    storyPackages,
    generatedAt: "2026-06-21T20:51:00.000Z",
    apply: false,
  });

  assert.equal(dryRun.summary.repairable_count, 1);
  assert.equal(dryRun.items[0].current_publish_status, "RED");
  assert.equal(dryRun.items[0].target_publish_status, "GREEN");
  assert.equal(dryRun.items[0].publish_status_stale, true);

  const applied = await repairPlatformNativePacks({
    storyPackages,
    generatedAt: "2026-06-21T20:52:00.000Z",
    apply: true,
    backupRoot: path.join(root, "backups-stale-red-status"),
  });

  assert.equal(applied.summary.repaired_count, 1);
  const repaired = await fs.readJson(manifestPath);
  assert.equal(repaired.publish_status, "GREEN");
  assert.equal(repaired.platform_native_evidence.verdict, "pass");
  assert.equal(repaired.no_publish_triggered, true);
  assert.equal(await fs.pathExists(applied.repairs[0].backup_files.platform_publish_manifest), true);
});

test("platform-native pack repair stamps GREEN publish controls from final render and media-house pass", async () => {
  const { storyPackages, root } = await legacyArtifact();
  const artifactDir = storyPackages[0].artifact_dir;
  storyPackages[0].verdict = "local_proof_pending";
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "story-native",
    canonical_subject: "Hellraiser: Revival",
    canonical_game: "Hellraiser: Revival",
    canonical_angle: "October timing raises the bar for a licensed horror game",
    selected_title: "Hellraiser: Revival's October Date Is A Risk",
    canonical_title: "Hellraiser: Revival's October Date Is A Risk",
    title: "Hellraiser: Revival's October Date Is A Risk",
    public_title: "Hellraiser: Revival's October Date Is A Risk",
    thumbnail_headline: "HELLRAISER OCTOBER RISK",
    thumbnail_text: "HELLRAISER OCTOBER RISK",
    suggested_thumbnail_text: "HELLRAISER OCTOBER RISK",
    first_frame_text: "HELLRAISER OCTOBER RISK",
    first_spoken_line: "Hellraiser: Revival picked October 8, and that is brave for all the wrong reasons.",
    narration_script:
      "Hellraiser: Revival picked October 8, and that is brave for all the wrong reasons. Eurogamer says the new trailer locks the game for PS5, Xbox Series X/S and PC, with Saber leaning hard into Pinhead, the Genesis Configuration and first-person gore. That timing is smart because horror fans will look twice in October, but it also raises the bar. Players are not judging whether Hellraiser can be nasty. They are judging whether the combat, the puzzle box powers and the Labyrinth tension can hold up when the licence stops doing the work. If the box power lands, this could be October's weird wildcard. If it feels stiff, the date becomes the problem. Follow Pulse Gaming so you never miss a beat.",
    description:
      "Hellraiser: Revival is set for October 8, 2026 on PS5, Xbox Series X/S and PC after a new trailer. Source: Eurogamer.",
    primary_source: "Eurogamer",
    primary_source_url: "https://www.eurogamer.net/hellraiser-revival-release-date-trailer",
  });
  await fs.writeJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    outputs: {},
    platform_native_evidence: { verdict: "missing" },
  });
  await fs.writeJson(path.join(artifactDir, "affiliate_link_manifest.json"), {});
  await fs.writeJson(path.join(artifactDir, "render_manifest.json"), {
    final_publish_render: true,
    output: "visual_v4_render.mp4",
    rendered_duration_s: 43.5,
  });
  await fs.writeJson(path.join(artifactDir, "script_scorecard.json"), {
    verdict: "viral_ready",
    viral_score: 90,
    blockers: [],
    warnings: [],
  });
  await fs.writeJson(path.join(artifactDir, "visual_quality_report.json"), {
    result: "pass",
    failures: [],
    scores: {
      motion_density_score: 75,
      first_3_seconds_hook_score: 100,
      source_lock_quality_score: 100,
      caption_legibility_score: 100,
      card_hierarchy_score: 85,
      transition_energy_score: 89,
      sfx_impact_score: 100,
      rights_risk_score: 100,
      stale_wording_risk: 0,
      media_house_polish_score: 93,
    },
  });
  await fs.writeJson(path.join(artifactDir, "director_beat_map.json"), {
    readiness: { status: "director_ready", blockers: [] },
    shot_plan: [{ id: "hook", kind: "motion_clip" }],
  });
  await fs.writeJson(path.join(artifactDir, "audio_manifest.json"), {
    voice_status: "materialized",
    word_timestamp_count: 120,
  });
  await fs.writeJson(path.join(artifactDir, "audio_segment_loudness_report.json"), { status: "pass", failures: [] });
  await fs.writeJson(path.join(artifactDir, "benchmark_report.json"), {
    result: "pass",
    failures: [],
    scores: {
      motion_density_score: 75,
      first_3_seconds_hook_score: 100,
      source_lock_quality_score: 100,
      caption_legibility_score: 100,
      card_hierarchy_score: 85,
      transition_energy_score: 89,
      sfx_impact_score: 100,
      rights_risk_score: 100,
      stale_wording_risk: 0,
      media_house_polish_score: 93,
    },
  });
  await fs.writeJson(path.join(artifactDir, "landing_page_manifest.json"), {
    landing_page_slug: "hellraiser-revival-rss-cb82aef32f0c73e9",
  });

  const dryRun = await repairPlatformNativePacks({
    storyPackages,
    generatedAt: "2026-06-22T02:05:00.000Z",
    apply: false,
  });

  assert.equal(dryRun.summary.repairable_count, 1);
  assert.equal(dryRun.items[0].target_native_verdict, "pass");
  assert.equal(dryRun.items[0].target_publish_status, "GREEN");
  assert.equal(dryRun.items[0].target_can_auto_publish, true);
  assert.equal(dryRun.items[0].can_auto_publish_stale, true);

  const applied = await repairPlatformNativePacks({
    storyPackages,
    generatedAt: "2026-06-22T02:06:00.000Z",
    apply: true,
    backupRoot: path.join(root, "backups-final-media-house"),
  });

  assert.equal(applied.summary.repaired_count, 1);
  const repaired = await fs.readJson(path.join(artifactDir, "platform_publish_manifest.json"));
  assert.equal(repaired.publish_status, "GREEN");
  assert.equal(repaired.can_auto_publish, true);
  assert.equal(repaired.platform_native_evidence.verdict, "pass");
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
  assert.ok(!dryRun.items[0].target_media_house_hard_failures.includes("media_house:title_lacks_curiosity_gap"));
  assert.ok(!dryRun.items[0].target_shorts_attention_blockers.includes("title_lacks_curiosity_gap"));
  assert.ok(
    dryRun.items[0].target_media_house_hard_failures.includes("media_house:visuals_look_templated"),
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

test("platform-native pack repair refreshes stale Facebook explanatory framing", async () => {
  const { storyPackages, root } = await legacyArtifact();
  const artifactDir = storyPackages[0].artifact_dir;
  const canonicalPath = path.join(artifactDir, "canonical_story_manifest.json");
  const manifestPath = path.join(artifactDir, "platform_publish_manifest.json");
  const canonical = await fs.readJson(canonicalPath);
  await fs.writeJson(
    canonicalPath,
    {
      ...canonical,
      canonical_subject: "MARVEL Tokon: Fighting Souls",
      canonical_game: "MARVEL Tokon: Fighting Souls",
      canonical_angle:
        "MARVEL Tokon Fighting Souls just gave fighting-game fans three reasons to argue before launch",
      selected_title: "MARVEL Tokon Just Started A Roster Fight",
      thumbnail_headline: "TOKON ROSTER FIGHT",
      first_spoken_line: "MARVEL Tokon Fighting Souls just gave fighting-game fans three reasons to argue before launch.",
      primary_source: "GameSpot",
      description:
        "MARVEL Tokon Fighting Souls just gave fighting-game fans three reasons to argue before launch. Source: GameSpot.",
    },
    { spaces: 2 },
  );

  const firstPass = await repairPlatformNativePacks({
    storyPackages,
    generatedAt: "2026-07-01T22:20:00.000Z",
    apply: true,
    backupRoot: path.join(root, "backups-first-pass"),
  });
  assert.equal(firstPass.summary.repaired_count, 1);

  const manifest = await fs.readJson(manifestPath);
  manifest.outputs.facebook_reels.explanatory_framing =
    "MARVEL Tokon: Fighting Souls matters because mARVEL Tokon Fighting Souls just gave fighting-game fans three reasons to argue before launch.";
  await fs.writeJson(manifestPath, manifest, { spaces: 2 });

  const dryRun = await repairPlatformNativePacks({
    storyPackages,
    generatedAt: "2026-07-01T22:21:00.000Z",
    apply: false,
  });
  assert.equal(dryRun.summary.repairable_count, 1);
  assert.equal(dryRun.items[0].affiliate_output_stale, true);

  const applied = await repairPlatformNativePacks({
    storyPackages,
    generatedAt: "2026-07-01T22:22:00.000Z",
    apply: true,
    backupRoot: path.join(root, "backups-framing"),
  });

  assert.equal(applied.summary.repaired_count, 1);
  const repaired = await fs.readJson(manifestPath);
  assert.match(repaired.outputs.facebook_reels.explanatory_framing, /MARVEL Tokon/);
  assert.doesNotMatch(repaired.outputs.facebook_reels.explanatory_framing, /\bmARVEL\b/);
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
    first_frame_text: "GEARS OF WAR",
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
  assert.equal(repairedCanonical.first_frame_text, "GEARS E-DAY 130GB TEST");
  const score = await fs.readJson(path.join(artifactDir, "pulse_media_house_score.json"));
  assert.ok(!score.hard_failures.includes("media_house:first_frame_or_thumbnail_not_attention_led"));
  assert.equal(applied.repairs[0].backup_files.canonical_story_manifest.endsWith("canonical_story_manifest.json"), true);
});

test("platform-native pack repair preserves repaired Ghost choice-led cover copy", async () => {
  const { storyPackages } = await legacyArtifact();
  const artifactDir = storyPackages[0].artifact_dir;
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "rss_ba849c6ab11e475c",
    canonical_subject: "Ghost at Dawn",
    canonical_game: "Ghost at Dawn",
    canonical_angle: "uses fear, empathy and questionable choices instead of simple jump scares",
    selected_title: "Ghost at Dawn Turns Choices Into Horror",
    canonical_title: "Ghost at Dawn Turns Choices Into Horror",
    title: "Ghost at Dawn Turns Choices Into Horror",
    public_title: "Ghost at Dawn Turns Choices Into Horror",
    thumbnail_headline: "GHOST CHOICES RISK",
    thumbnail_text: "GHOST CHOICES RISK",
    suggested_thumbnail_text: "GHOST CHOICES RISK",
    first_frame_text: "GHOST CHOICES RISK",
    first_spoken_line: "Ghost at Dawn is trying to make player choices scarier than jump scares.",
    narration_script:
      "Ghost at Dawn is trying to make player choices scarier than jump scares. Xbox Wire says the game is built around fear, empathy and questionable choices, with the trailer pushing atmosphere over simple monster reveals. That is the hook: if your decisions actually change the dread, this becomes more than another horror short. If that lands, it sticks. Follow Pulse Gaming so you never miss a beat.",
    description:
      "Ghost at Dawn's trailer is selling horror through player choices, fear and empathy. Source: Xbox Wire.",
    primary_source: { name: "Xbox Wire", url: "https://news.xbox.com/en-us/2026/06/19/ghost-at-dawn-is-about-fear-empathy/" },
  });
  await fs.writeJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    schema_version: 1,
    story_id: "rss_ba849c6ab11e475c",
    publish_status: "RED",
    outputs: {
      youtube_shorts: {
        title: "Ghost at Dawn Turns Choices Into Horror",
        description: "Ghost at Dawn's trailer is selling horror through player choices, fear and empathy. Source: Xbox Wire.",
        cover_frame: { headline: "GHOST CHOICES RISK", subject: "Ghost at Dawn", source_label: "Xbox Wire" },
      },
      instagram_reels: {
        caption: "Ghost at Dawn's trailer is selling horror through player choices, fear and empathy. Source: Xbox Wire.",
        cover_frame: { headline: "GHOST CHOICES RISK", subject: "Ghost at Dawn", source_label: "Xbox Wire" },
      },
      facebook_reels: {
        page_caption: "Ghost at Dawn's trailer is selling horror through player choices, fear and empathy. Source: Xbox Wire.",
        explanatory_framing: "Ghost at Dawn matters because its player choices are the horror risk.",
      },
    },
    platform_native_evidence: { verdict: "pass", platforms: [{ platform: "youtube_shorts", status: "pass" }] },
  });
  await fs.writeJson(path.join(artifactDir, "render_manifest.json"), {
    final_publish_render: true,
    output: "visual_v4_render.mp4",
    rendered_duration_s: 44.367,
  });
  await fs.writeJson(path.join(artifactDir, "script_scorecard.json"), {
    verdict: "viral_ready",
    viral_score: 91,
    blockers: [],
    warnings: [],
  });
  await fs.writeJson(path.join(artifactDir, "visual_quality_report.json"), {
    result: "pass",
    failures: [],
    scores: {
      motion_density_score: 100,
      first_3_seconds_hook_score: 88,
      source_lock_quality_score: 100,
      caption_legibility_score: 100,
      card_hierarchy_score: 85,
      transition_energy_score: 94,
      sfx_impact_score: 100,
      rights_risk_score: 100,
      stale_wording_risk: 0,
      media_house_polish_score: 95,
    },
  });
  await fs.writeJson(path.join(artifactDir, "director_beat_map.json"), {
    readiness: { status: "director_ready", blockers: [] },
    shot_plan: [{ id: "hook", kind: "motion_clip", start_s: 0.1 }],
  });
  await fs.writeJson(path.join(artifactDir, "audio_manifest.json"), {
    voice_status: "materialized",
    word_timestamp_count: 131,
  });
  await fs.writeJson(path.join(artifactDir, "audio_segment_loudness_report.json"), { status: "pass", failures: [] });
  await fs.writeJson(path.join(artifactDir, "benchmark_report.json"), {
    result: "pass",
    failures: [],
    scores: {
      motion_density_score: 100,
      first_3_seconds_hook_score: 88,
      source_lock_quality_score: 100,
      caption_legibility_score: 100,
      card_hierarchy_score: 85,
      transition_energy_score: 94,
      sfx_impact_score: 100,
      rights_risk_score: 100,
      stale_wording_risk: 0,
      media_house_polish_score: 95,
    },
  });
  await fs.writeJson(path.join(artifactDir, "affiliate_link_manifest.json"), {});
  await fs.writeJson(path.join(artifactDir, "landing_page_manifest.json"), {
    landing_page_slug: "ghost-at-dawn-choices-horror",
    landing_page_route: "/p/ghost-at-dawn-choices-horror",
  });
  await fs.writeJson(path.join(artifactDir, "pulse_media_house_score.json"), {
    verdict: "RED",
    status: "fail",
    hard_failures: ["media_house:shorts_feed_competition_weak"],
  });

  const dryRun = await repairPlatformNativePacks({
    storyPackages,
    generatedAt: "2026-06-22T05:40:00.000Z",
    apply: false,
  });

  assert.equal(dryRun.summary.repairable_count, 1);
  assert.equal(dryRun.items[0].target_affiliate_output.youtube_cover_headline, "GHOST CHOICES RISK");
  assert.ok(!dryRun.items[0].target_media_house_hard_failures.includes("media_house:shorts_feed_competition_weak"));
});

test("platform-native pack repair gives Cyberpunk trust stories feed-competitive captions", async () => {
  const { storyPackages } = await legacyArtifact();
  const artifactDir = storyPackages[0].artifact_dir;
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "rss_4921d15c5d54b86d",
    canonical_subject: "Cyberpunk 2077",
    canonical_game: "Cyberpunk 2077",
    selected_title: "Cyberpunk 2077's Trust Debt",
    canonical_title: "Cyberpunk 2077's Trust Debt",
    title: "Cyberpunk 2077's Trust Debt",
    public_title: "Cyberpunk 2077's Trust Debt",
    thumbnail_headline: "CYBERPUNK TRUST DEBT",
    thumbnail_text: "CYBERPUNK TRUST DEBT",
    suggested_thumbnail_text: "CYBERPUNK TRUST DEBT",
    first_frame_text: "CYBERPUNK TRUST DEBT",
    first_spoken_line: "Cyberpunk 2077's biggest launch problem is not bugs anymore.",
    narration_script:
      "Cyberpunk 2077's biggest launch problem is not bugs anymore. PC Gamer reports a CD Projekt Red boss believes some fans were burned so badly by the original launch that the studio may have lost their faith indefinitely. The risk is that a great trailer can still look suspicious if players think the studio is selling belief before proof. If it promises too much again, Cyberpunk becomes the warning label on every new trailer. Follow Pulse Gaming so you never miss a beat.",
    description:
      "CD Projekt Red boss believes some fans were forever burned by Cyberpunk 2077's disastrous launch: 'I'm convinced that we lost the faith of some people indefinitely'. Source: PC Gamer.",
    primary_source: "PC Gamer",
    confirmed_claims: [
      "PC Gamer reports CD Projekt Red boss believes some fans were forever burned by Cyberpunk 2077's disastrous launch.",
    ],
  });
  await fs.writeJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    schema_version: 1,
    story_id: "rss_4921d15c5d54b86d",
    publish_status: "RED",
    outputs: {
      youtube_shorts: {
        title: "Cyberpunk 2077's Trust Debt",
        description:
          "CD Projekt Red boss believes some fans were forever burned by Cyberpunk 2077's disastrous launch. Source: PC Gamer.",
        cover_frame: { headline: "CYBERPUNK TRUST DEBT", subject: "Cyberpunk 2077", source_label: "PC Gamer" },
      },
      instagram_reels: {
        caption:
          "CD Projekt Red boss believes some fans were forever burned by Cyberpunk 2077's disastrous launch. Source: PC Gamer.",
        cover_frame: { headline: "CYBERPUNK TRUST DEBT", subject: "Cyberpunk 2077", source_label: "PC Gamer" },
      },
      facebook_reels: {
        page_caption:
          "CD Projekt Red boss believes some fans were forever burned by Cyberpunk 2077's disastrous launch. Source: PC Gamer.",
      },
    },
    platform_native_evidence: { verdict: "pass", platforms: [{ platform: "youtube_shorts", status: "pass" }] },
  });
  await fs.writeJson(path.join(artifactDir, "render_manifest.json"), {
    final_publish_render: true,
    output: "visual_v4_render.mp4",
    rendered_duration_s: 57.4,
  });
  await fs.writeJson(path.join(artifactDir, "script_scorecard.json"), {
    verdict: "viral_ready",
    viral_score: 94,
    blockers: [],
    warnings: [],
  });
  await fs.writeJson(path.join(artifactDir, "visual_quality_report.json"), {
    result: "pass",
    failures: [],
    scores: {
      motion_density_score: 100,
      first_3_seconds_hook_score: 100,
      source_lock_quality_score: 100,
      caption_legibility_score: 100,
      card_hierarchy_score: 85,
      transition_energy_score: 94,
      sfx_impact_score: 100,
      rights_risk_score: 100,
      stale_wording_risk: 0,
      media_house_polish_score: 95,
    },
  });
  await fs.writeJson(path.join(artifactDir, "director_beat_map.json"), {
    readiness: { status: "director_ready", blockers: [] },
    shot_plan: [{ id: "hook", kind: "motion_clip", start_s: 0.1 }],
  });
  await fs.writeJson(path.join(artifactDir, "audio_manifest.json"), {
    voice_status: "materialized",
    word_timestamp_count: 172,
  });
  await fs.writeJson(path.join(artifactDir, "audio_segment_loudness_report.json"), { status: "pass", failures: [] });
  await fs.writeJson(path.join(artifactDir, "benchmark_report.json"), {
    result: "pass",
    failures: [],
    scores: {
      motion_density_score: 100,
      first_3_seconds_hook_score: 100,
      source_lock_quality_score: 100,
      caption_legibility_score: 100,
      card_hierarchy_score: 85,
      transition_energy_score: 94,
      sfx_impact_score: 100,
      rights_risk_score: 100,
      stale_wording_risk: 0,
      media_house_polish_score: 95,
    },
  });
  await fs.writeJson(path.join(artifactDir, "affiliate_link_manifest.json"), {});
  await fs.writeJson(path.join(artifactDir, "landing_page_manifest.json"), {
    landing_page_slug: "cyberpunk-2077-trust-debt",
    landing_page_route: "/p/cyberpunk-2077-trust-debt",
  });
  await fs.writeJson(path.join(artifactDir, "pulse_media_house_score.json"), {
    verdict: "RED",
    status: "fail",
    hard_failures: ["media_house:platform_copy_too_plain"],
  });

  const dryRun = await repairPlatformNativePacks({
    storyPackages,
    generatedAt: "2026-06-22T06:25:00.000Z",
    apply: false,
  });

  assert.equal(dryRun.summary.repairable_count, 1);
  assert.match(dryRun.items[0].target_affiliate_output.youtube_description_route, /gameplay proof before hype/i);
  assert.ok(!dryRun.items[0].target_media_house_hard_failures.includes("media_house:platform_copy_too_plain"));
  assert.ok(!dryRun.items[0].target_media_house_hard_failures.includes("media_house:shorts_feed_competition_weak"));
});

test("platform-native repair keeps update stories specific enough for Shorts competition", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-platform-native-update-copy-"));
  const artifactDir = path.join(tmp, "story");
  await fs.ensureDir(artifactDir);

  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "official_callofduty_blackops7_s04_reloaded_20260625",
    canonical_subject: "Call of Duty: Black Ops 7",
    canonical_game: "Call of Duty: Black Ops 7",
    selected_title: "Call of Duty: Black Ops 7 Has A Player-Return Problem",
    primary_source: { name: "Call of Duty" },
    first_spoken_line:
      "Call of Duty: Black Ops 7 has a June 25 update trying to win back lapsed players fast.",
    description:
      "Call of Duty says the June 25 update adds remastered maps, Endgame and Zombies content, progression changes and weapon prestige for returning players.",
    narration_script:
      "Call of Duty: Black Ops 7 has a June 25 update trying to win back lapsed players fast. The useful detail is not just more content. It is whether maps, Zombies, Endgame and weapon prestige give people a reason to reinstall. Follow Pulse Gaming so you never miss a beat.",
    thumbnail_headline: "CALL OF DUTY RETURN RISK",
  });
  await fs.writeJson(path.join(artifactDir, "render_manifest.json"), {
    final_publish_render: false,
    output: "visual_v4_render.mp4",
    rendered_duration_s: 48.2,
  });
  await fs.writeJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    publish_status: "GREEN",
    outputs: {
      youtube_shorts: {
        platform: "youtube_shorts",
        title: "Call of Duty: Black Ops 7 Has A Player-Return Problem",
        description:
          "Call of Duty: Black Ops 7 has a player-return problem to solve. More content only matters if it gives people a real reason to come back now. Source: Call of Duty.",
        cover_frame: { headline: "CALL OF DUTY: ONE BRUTAL" },
      },
      instagram_reels: {
        platform: "instagram_reels",
        caption:
          "Call of Duty: Black Ops 7 has a player-return problem to solve. More content only matters if it gives people a real reason to come back now. Source: Call of Duty.",
        cover_frame: { headline: "CALL OF DUTY: ONE BRUTAL" },
      },
    },
    platform_native_evidence: { verdict: "fail" },
  });
  await fs.writeJson(path.join(artifactDir, "platform_variant_scorecard.json"), {});
  await fs.writeJson(path.join(artifactDir, "script_scorecard.json"), {
    status: "pass",
    scores: { hook_strength: 90, specificity: 88 },
  });
  await fs.writeJson(path.join(artifactDir, "visual_quality_report.json"), {
    scores: { first_3_seconds_hook_score: 96, source_lock_quality_score: 96 },
  });
  await fs.writeJson(path.join(artifactDir, "director_beat_map.json"), {
    readiness: { status: "director_ready", blockers: [] },
    shot_plan: [{ id: "hook", kind: "motion_clip", start_s: 0.1 }],
  });
  await fs.writeJson(path.join(artifactDir, "audio_manifest.json"), {
    voice_status: "materialized",
    word_timestamp_count: 130,
  });
  await fs.writeJson(path.join(artifactDir, "audio_segment_loudness_report.json"), { status: "pass", failures: [] });
  await fs.writeJson(path.join(artifactDir, "benchmark_report.json"), {
    result: "pass",
    failures: [],
    scores: {
      motion_density_score: 100,
      first_3_seconds_hook_score: 100,
      source_lock_quality_score: 100,
      caption_legibility_score: 100,
      transition_energy_score: 94,
      sfx_impact_score: 96,
      rights_risk_score: 100,
      media_house_polish_score: 95,
    },
  });
  await fs.writeJson(path.join(artifactDir, "affiliate_link_manifest.json"), {});
  await fs.writeJson(path.join(artifactDir, "landing_page_manifest.json"), {
    landing_page_slug: "black-ops-7-june-25-update",
  });
  await fs.writeJson(path.join(artifactDir, "pulse_media_house_score.json"), {
    verdict: "RED",
    status: "fail",
    hard_failures: ["media_house:platform_copy_too_plain", "media_house:shorts_feed_competition_weak"],
  });
  await fs.writeJson(path.join(artifactDir, "publish_verdict.json"), {
    verdict: "RED",
    can_auto_publish: false,
    reason_codes: [
      "platform_native:youtube_shorts:weak_platform_title",
      "media_house:platform_copy_too_plain",
      "media_house:shorts_feed_competition_weak",
      "render:final_publish_render_missing",
    ],
    blockers: [
      "platform_native:youtube_shorts:weak_platform_title",
      "media_house:platform_copy_too_plain",
      "media_house:shorts_feed_competition_weak",
      "render:final_publish_render_missing",
    ],
  });

  const dryRun = await repairPlatformNativePacks({
    storyPackages: [{
      story_id: "official_callofduty_blackops7_s04_reloaded_20260625",
      verdict: "GREEN",
      blockers: [],
      artifact_dir: artifactDir,
    }],
    generatedAt: "2026-06-27T03:30:00.000Z",
    apply: false,
  });

  assert.equal(dryRun.summary.repairable_count, 1);
  assert.match(dryRun.items[0].target_youtube_title, /June 25 Update/i);
  assert.match(dryRun.items[0].target_youtube_description, /Call of Duty: Black Ops 7/i);
  assert.match(dryRun.items[0].target_youtube_description, /maps/i);
  assert.match(dryRun.items[0].target_youtube_description, /Zombies/i);
  assert.match(dryRun.items[0].target_youtube_description, /reinstall/i);
  assert.doesNotMatch(dryRun.items[0].target_youtube_title, /Player-Return Problem/i);
  assert.ok(!dryRun.items[0].target_media_house_hard_failures.includes("media_house:platform_copy_too_plain"));
  assert.ok(!dryRun.items[0].target_media_house_hard_failures.includes("media_house:shorts_feed_competition_weak"));

  await repairPlatformNativePacks({
    storyPackages: [{
      story_id: "official_callofduty_blackops7_s04_reloaded_20260625",
      verdict: "GREEN",
      blockers: [],
      artifact_dir: artifactDir,
    }],
    generatedAt: "2026-06-27T03:31:00.000Z",
    apply: true,
    backupRoot: path.join(tmp, "backups"),
  });
  const repairedCanonical = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  assert.match(repairedCanonical.description, /Call of Duty: Black Ops 7/i);
  assert.match(repairedCanonical.description, /reinstall/i);
  const refreshedPublishVerdict = await fs.readJson(path.join(artifactDir, "publish_verdict.json"));
  assert.ok(!refreshedPublishVerdict.reason_codes.includes("media_house:platform_copy_too_plain"));
  assert.ok(!refreshedPublishVerdict.reason_codes.includes("media_house:shorts_feed_competition_weak"));
  assert.ok(refreshedPublishVerdict.reason_codes.includes("render:final_publish_render_missing"));

  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    ...repairedCanonical,
    description:
      "The official Call of Duty page lists maps, Endgame and Zombies, but the real test is whether lapsed players reinstall. Source: Call of Duty.",
  });
  const canonicalOnlyRepair = await repairPlatformNativePacks({
    storyPackages: [{
      story_id: "official_callofduty_blackops7_s04_reloaded_20260625",
      verdict: "GREEN",
      blockers: [],
      artifact_dir: artifactDir,
    }],
    generatedAt: "2026-06-27T03:31:30.000Z",
    apply: true,
    backupRoot: path.join(tmp, "backups-canonical-only"),
  });
  const canonicalOnlyRefreshed = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  assert.equal(canonicalOnlyRepair.summary.repairable_count, 1);
  assert.equal(canonicalOnlyRepair.summary.repaired_count, 1);
  assert.equal(canonicalOnlyRepair.items[0].canonical_public_copy_stale, true);
  assert.match(canonicalOnlyRefreshed.description, /Call of Duty: Black Ops 7/i);

  await fs.writeJson(path.join(artifactDir, "publish_verdict.json"), {
    verdict: "RED",
    can_auto_publish: false,
    reason_codes: [
      "platform_native:youtube_shorts:weak_platform_title",
      "media_house:platform_copy_too_plain",
      "media_house:shorts_feed_competition_weak",
      "render:final_publish_render_missing",
    ],
    blockers: [
      "platform_native:youtube_shorts:weak_platform_title",
      "media_house:platform_copy_too_plain",
      "media_house:shorts_feed_competition_weak",
      "render:final_publish_render_missing",
    ],
  });
  const verdictOnlyRepair = await repairPlatformNativePacks({
    storyPackages: [{
      story_id: "official_callofduty_blackops7_s04_reloaded_20260625",
      verdict: "GREEN",
      blockers: [],
      artifact_dir: artifactDir,
    }],
    generatedAt: "2026-06-27T03:32:00.000Z",
    apply: true,
    backupRoot: path.join(tmp, "backups-verdict-only"),
  });
  const verdictOnlyRefreshed = await fs.readJson(path.join(artifactDir, "publish_verdict.json"));
  assert.equal(verdictOnlyRepair.summary.repairable_count, 1);
  assert.equal(verdictOnlyRepair.summary.repaired_count, 1);
  assert.ok(!verdictOnlyRefreshed.reason_codes.includes("media_house:platform_copy_too_plain"));
});

test("platform-native repair keeps Robo-Ky delay copy story-specific instead of generic fallback", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-platform-native-roboky-copy-"));
  const artifactDir = path.join(tmp, "story");
  await fs.ensureDir(artifactDir);

  const script =
    "Robo-Ky just turned Guilty Gear Strive into a release-date argument. GameSpot is carrying the new Robo-Ky footage after the character moved away from the crowded release calendar. That sounds small, but fighting game players know why it matters. A weird DLC character needs lab time, matchup practice and a clean first weekend, not a launch buried under bigger releases. The catch is whether the delay means polish, or whether Robo-Ky was not ready to stand beside the current roster. If he arrives balanced, readable and ridiculous, the wait becomes smart scheduling. If he feels half-finished, the delay becomes the first warning sign. Follow Pulse Gaming so you never miss a beat.";

  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "rss_42c92208a8c02a65",
    canonical_subject: "Robo-Ky",
    canonical_game: "Guilty Gear Strive",
    canonical_angle: "Robo-Ky moved away from a crowded release calendar",
    selected_title: "Robo-Ky Delay Puts Guilty Gear On Trial",
    canonical_title: "Robo-Ky Delay Puts Guilty Gear On Trial",
    title: "Robo-Ky Delay Puts Guilty Gear On Trial",
    first_spoken_line: "Robo-Ky just turned Guilty Gear Strive into a release-date argument.",
    narration_script: script,
    description:
      "Robo-Ky moved away from the crowded release calendar, making the useful question whether the delay means polish or warning signs for Guilty Gear Strive players. Source: GameSpot.",
    thumbnail_headline: "ROBO-KY DELAY TEST",
    primary_source: { name: "GameSpot" },
  });
  await fs.writeJson(path.join(artifactDir, "render_manifest.json"), {
    final_publish_render: true,
    output: "visual_v4_render.mp4",
    rendered_duration_s: 44.63,
  });
  await fs.writeJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    publish_status: "RED",
    outputs: {
      youtube_shorts: {
        platform: "youtube_shorts",
        title: "GUILTY GEAR -STRIVE- Robo-Ky Official Just Dodged A Release-Date Fight",
        description:
          "Robo-Ky has a player-facing question now: gUILTY GEAR -STRIVE- Robo-Ky Official Trailer. Source: GameSpot.",
        cover_frame: { headline: "ROBO-KY DELAY TEST" },
      },
      instagram_reels: {
        platform: "instagram_reels",
        caption:
          "Robo-Ky has a player-facing question now: gUILTY GEAR -STRIVE- Robo-Ky Official Trailer. Source: GameSpot.",
        cover_frame: { headline: "ROBO-KY DELAY TEST" },
      },
      facebook_reels: {
        platform: "facebook_reels",
        page_caption:
          "Robo-Ky has a player-facing question now: gUILTY GEAR -STRIVE- Robo-Ky Official Trailer. Source: GameSpot.",
        cover_frame: { headline: "ROBO-KY DELAY TEST" },
      },
    },
    platform_native_evidence: { verdict: "fail" },
  });
  await fs.writeJson(path.join(artifactDir, "platform_variant_scorecard.json"), {});
  await fs.writeJson(path.join(artifactDir, "script_scorecard.json"), {
    verdict: "viral_ready",
    status: "pass",
    viral_score: 93,
    blockers: [],
    warnings: [],
    scores: { hook_strength: 92, specificity: 91, payoff: 90 },
  });
  await fs.writeJson(path.join(artifactDir, "visual_quality_report.json"), {
    result: "pass",
    failures: [],
    scores: {
      motion_density_score: 100,
      first_3_seconds_hook_score: 96,
      source_lock_quality_score: 100,
      caption_legibility_score: 100,
      card_hierarchy_score: 92,
      transition_energy_score: 94,
      sfx_impact_score: 96,
      rights_risk_score: 100,
      media_house_polish_score: 95,
    },
  });
  await fs.writeJson(path.join(artifactDir, "director_beat_map.json"), {
    readiness: { status: "director_ready", blockers: [] },
    shot_plan: [{ id: "hook", kind: "motion_clip", start_s: 0.1 }],
  });
  await fs.writeJson(path.join(artifactDir, "audio_manifest.json"), {
    voice_status: "materialized",
    word_timestamp_count: 116,
  });
  await fs.writeJson(path.join(artifactDir, "audio_segment_loudness_report.json"), { status: "pass", failures: [] });
  await fs.writeJson(path.join(artifactDir, "benchmark_report.json"), {
    result: "pass",
    failures: [],
    scores: {
      motion_density_score: 100,
      first_3_seconds_hook_score: 96,
      source_lock_quality_score: 100,
      caption_legibility_score: 100,
      transition_energy_score: 94,
      sfx_impact_score: 96,
      rights_risk_score: 100,
      media_house_polish_score: 95,
    },
  });
  await fs.writeJson(path.join(artifactDir, "affiliate_link_manifest.json"), {});
  await fs.writeJson(path.join(artifactDir, "landing_page_manifest.json"), {
    landing_page_slug: "robo-ky-delay-guilty-gear",
  });
  await fs.writeJson(path.join(artifactDir, "pulse_media_house_score.json"), {
    verdict: "RED",
    status: "fail",
    hard_failures: ["media_house:platform_copy_too_plain"],
  });
  await fs.writeJson(path.join(artifactDir, "publish_verdict.json"), {
    verdict: "RED",
    can_auto_publish: false,
    reason_codes: [
      "platform_native:youtube_shorts:plain_platform_description",
      "platform_native:instagram_reels:plain_platform_description",
      "platform_native:facebook_reels:plain_platform_description",
      "media_house:platform_copy_too_plain",
    ],
    blockers: [
      "platform_native:youtube_shorts:plain_platform_description",
      "platform_native:instagram_reels:plain_platform_description",
      "platform_native:facebook_reels:plain_platform_description",
      "media_house:platform_copy_too_plain",
    ],
  });

  const dryRun = await repairPlatformNativePacks({
    storyPackages: [{
      story_id: "rss_42c92208a8c02a65",
      verdict: "GREEN",
      blockers: [],
      artifact_dir: artifactDir,
    }],
    generatedAt: "2026-06-28T17:45:00.000Z",
    apply: false,
  });

  assert.equal(dryRun.summary.repairable_count, 1);
  assert.match(dryRun.items[0].target_youtube_description, /timing and balance argument/i);
  assert.match(dryRun.items[0].target_youtube_description, /readable, lab-worthy and weird/i);
  assert.match(dryRun.items[0].target_instagram_caption, /timing and balance argument/i);
  assert.match(dryRun.items[0].target_facebook_page_caption, /timing and balance argument/i);
  assert.doesNotMatch(dryRun.items[0].target_youtube_description, /player-facing question|gUILTY GEAR -STRIVE-/);
  assert.doesNotMatch(dryRun.items[0].target_instagram_caption, /player-facing question|gUILTY GEAR -STRIVE-/);
  assert.doesNotMatch(dryRun.items[0].target_facebook_page_caption, /player-facing question|gUILTY GEAR -STRIVE-/);
  assert.ok(!dryRun.items[0].target_media_house_hard_failures.includes("media_house:platform_copy_too_plain"));

  const applied = await repairPlatformNativePacks({
    storyPackages: [{
      story_id: "rss_42c92208a8c02a65",
      verdict: "GREEN",
      blockers: [],
      artifact_dir: artifactDir,
    }],
    generatedAt: "2026-06-28T17:46:00.000Z",
    apply: true,
    backupRoot: path.join(tmp, "backups"),
  });
  assert.equal(applied.summary.repaired_count, 1);
  const repairedVerdict = await fs.readJson(path.join(artifactDir, "publish_verdict.json"));
  assert.ok(!repairedVerdict.reason_codes.includes("media_house:platform_copy_too_plain"));
});

test("platform-native repair turns Star Wars Monopoly family stakes into attention-led copy", async () => {
  const { storyPackages } = await legacyArtifact();
  const artifactDir = storyPackages[0].artifact_dir;
  const script =
    "Star Wars Monopoly sounds silly until the powers start deciding who ruins family night. Xbox Wire says Heroes versus Villains gives characters unique abilities, so player choice becomes the whole pitch. If Darth Vader flips momentum, kids get chaos and parents get stories. If powers barely matter, it is one bored match. Follow Pulse Gaming so you never miss a beat.";

  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "rss_e622e340996cda19",
    canonical_subject: "Monopoly Star Wars",
    canonical_game: "Monopoly Star Wars",
    canonical_angle: "Force powers decide whether family night becomes replayable chaos or one bored match",
    selected_title: "Star Wars Monopoly Turns Force Powers Into Family Drama",
    canonical_title: "Star Wars Monopoly Turns Force Powers Into Family Drama",
    title: "Star Wars Monopoly Turns Force Powers Into Family Drama",
    first_spoken_line: "Star Wars Monopoly sounds silly until the powers start deciding who ruins family night.",
    narration_script: script,
    description:
      "Star Wars Monopoly sounds silly until the powers start deciding who ruins family night. Source: Xbox Wire.",
    thumbnail_headline: "FORCE POWERS FIGHT",
    primary_source: { name: "Xbox Wire" },
  });
  await fs.writeJson(path.join(artifactDir, "render_manifest.json"), {
    final_publish_render: true,
    output: "visual_v4_render.mp4",
    rendered_duration_s: 42.028,
  });
  await fs.writeJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    publish_status: "RED",
    outputs: {
      youtube_shorts: {
        platform: "youtube_shorts",
        title: "Star Wars Monopoly Turns Force Powers Into Family Drama",
        description:
          "Monopoly Star Wars has a player-facing question now: Star Wars Monopoly sounds silly until the powers start deciding who ruins family night. Source: Xbox Wire.",
        cover_frame: { headline: "FORCE POWERS FIGHT" },
      },
      instagram_reels: {
        platform: "instagram_reels",
        caption:
          "Monopoly Star Wars has a player-facing question now: Star Wars Monopoly sounds silly until the powers start deciding who ruins family night. Source: Xbox Wire.",
        cover_frame: { headline: "FORCE POWERS FIGHT" },
      },
      facebook_reels: {
        platform: "facebook_reels",
        page_caption:
          "Monopoly Star Wars has a player-facing question now: Star Wars Monopoly sounds silly until the powers start deciding who ruins family night. Source: Xbox Wire.",
        cover_frame: { headline: "FORCE POWERS FIGHT" },
      },
    },
    platform_native_evidence: { verdict: "fail" },
  });
  await fs.writeJson(path.join(artifactDir, "script_scorecard.json"), {
    verdict: "viral_ready",
    status: "pass",
    viral_score: 91,
    blockers: [],
  });
  await fs.writeJson(path.join(artifactDir, "visual_quality_report.json"), {
    result: "pass",
    failures: [],
    scores: {
      motion_density_score: 100,
      first_3_seconds_hook_score: 92,
      source_lock_quality_score: 100,
      caption_legibility_score: 100,
      card_hierarchy_score: 90,
      transition_energy_score: 92,
      sfx_impact_score: 96,
      rights_risk_score: 100,
      media_house_polish_score: 95,
    },
  });
  await fs.writeJson(path.join(artifactDir, "director_beat_map.json"), {
    readiness: { status: "director_ready", blockers: [] },
    shot_plan: [{ id: "hook", kind: "motion_clip", start_s: 0.1 }],
  });
  await fs.writeJson(path.join(artifactDir, "audio_manifest.json"), {
    voice_status: "materialized",
    word_timestamp_count: 61,
  });
  await fs.writeJson(path.join(artifactDir, "audio_segment_loudness_report.json"), { status: "pass", failures: [] });
  await fs.writeJson(path.join(artifactDir, "benchmark_report.json"), {
    result: "pass",
    failures: [],
    scores: {
      motion_density_score: 100,
      first_3_seconds_hook_score: 92,
      source_lock_quality_score: 100,
      caption_legibility_score: 100,
      transition_energy_score: 92,
      sfx_impact_score: 96,
      rights_risk_score: 100,
      media_house_polish_score: 95,
    },
  });
  await fs.writeJson(path.join(artifactDir, "pulse_media_house_score.json"), {
    verdict: "RED",
    status: "fail",
    hard_failures: [
      "media_house:title_lacks_curiosity_gap",
      "media_house:platform_title_too_plain",
      "media_house:platform_copy_too_plain",
      "media_house:shorts_feed_competition_weak",
    ],
  });
  await fs.writeJson(path.join(artifactDir, "publish_verdict.json"), {
    verdict: "RED",
    can_auto_publish: false,
    reason_codes: [
      "media_house:title_lacks_curiosity_gap",
      "media_house:platform_title_too_plain",
      "media_house:platform_copy_too_plain",
      "media_house:shorts_feed_competition_weak",
    ],
    blockers: [
      "media_house:title_lacks_curiosity_gap",
      "media_house:platform_title_too_plain",
      "media_house:platform_copy_too_plain",
      "media_house:shorts_feed_competition_weak",
    ],
  });

  const dryRun = await repairPlatformNativePacks({
    storyPackages: [{
      story_id: "rss_e622e340996cda19",
      verdict: "GREEN",
      blockers: [],
      artifact_dir: artifactDir,
    }],
    generatedAt: "2026-07-02T12:00:00.000Z",
    apply: false,
  });

  assert.equal(dryRun.summary.repairable_count, 1);
  assert.equal(dryRun.items[0].target_youtube_title, "Star Wars Monopoly Could Ruin Game Night");
  assert.match(dryRun.items[0].target_youtube_description, /replayable chaos/i);
  assert.match(dryRun.items[0].target_instagram_caption, /replayable chaos/i);
  assert.doesNotMatch(dryRun.items[0].target_youtube_description, /player-facing question/i);
  assert.ok(!dryRun.items[0].target_media_house_hard_failures.includes("media_house:title_lacks_curiosity_gap"));
  assert.ok(!dryRun.items[0].target_media_house_hard_failures.includes("media_house:platform_title_too_plain"));
  assert.ok(!dryRun.items[0].target_media_house_hard_failures.includes("media_house:platform_copy_too_plain"));
  assert.ok(!dryRun.items[0].target_media_house_hard_failures.includes("media_house:shorts_feed_competition_weak"));
});

test("platform-native repair refreshes stale story-package RED summary from GREEN artefacts", async () => {
  const { storyPackages } = await legacyArtifact();
  const artifactDir = storyPackages[0].artifact_dir;
  await fs.writeJson(path.join(artifactDir, "publish_verdict.json"), {
    verdict: "GREEN",
    can_auto_publish: true,
    reason_codes: [],
    blockers: [],
  });
  await fs.writeJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    publish_status: "GREEN",
    platform_native_evidence: { verdict: "pass", failures: [] },
  });
  await fs.writeJson(path.join(artifactDir, "pulse_media_house_score.json"), {
    verdict: "GREEN",
    hard_failures: [],
  });

  const refreshed = await refreshStoryPackageEntriesFromArtifacts([
    {
      story_id: "story-native",
      verdict: "RED",
      blockers: ["media_house:platform_copy_too_plain"],
      artifact_dir: artifactDir,
    },
  ], {
    storyIds: ["story-native"],
  });

  assert.equal(refreshed.summary.updated_count, 1);
  assert.equal(refreshed.story_packages[0].verdict, "GREEN");
  assert.deepEqual(refreshed.story_packages[0].blockers, []);
  assert.equal(refreshed.rows[0].updated, true);
  assert.equal(refreshed.safety.no_db_mutation, true);
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
