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
      instagram_reels: { duration_seconds: { min: 25, max: 45 } },
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
