"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  PLATFORM_VISUAL_SPECS,
  buildPremiumVisualCampaignSpec,
  buildPremiumVisualSvg,
  buildStoryMotionComposition,
  materializePremiumVisualCampaign,
  validatePremiumVisualCampaign,
} = require("../../lib/ops/premium-visual-campaign-engine");

function fixture(overrides = {}) {
  return {
    story_id: "eso-paid-catch",
    canonical_subject: "The Elder Scrolls Online",
    title: "The Elder Scrolls Online's Thieves Guild Has A Paid Catch",
    headline: "ELDER SCROLLS: FREE OR PAID?",
    source_label: "Xbox Wire",
    classification: "update",
    story_prompt: "FREE TRACK OR PAID UPGRADE?",
    ...overrides,
  };
}

test("premium visual campaign defines platform-native covers and social derivatives", () => {
  const campaign = buildPremiumVisualCampaignSpec(fixture());

  assert.deepEqual(Object.keys(campaign.outputs), Object.keys(PLATFORM_VISUAL_SPECS));
  assert.equal(campaign.identity.id, "update");
  assert.deepEqual(
    {
      version: campaign.creative_identity.version,
      category: campaign.creative_identity.category,
      palette_id: campaign.creative_identity.palette_id,
      primary: campaign.creative_identity.primary,
      secondary: campaign.creative_identity.secondary,
      segment_name: campaign.creative_identity.segment_name,
      code: campaign.creative_identity.code,
    },
    {
      version: "pulse_visual_identity_v5",
      category: "update",
      palette_id: "green_gold",
      primary: "#45e06f",
      secondary: "#f7c948",
      segment_name: "Patch Notes That Matter",
      code: "PG/UPD",
    },
  );
  for (const output of Object.values(campaign.outputs)) {
    assert.deepEqual(output.creative_identity, campaign.creative_identity);
  }
  assert.equal(campaign.brand_lockup, "PULSE GAMING");
  assert.equal(campaign.outputs.instagram_story.width, 1080);
  assert.equal(campaign.outputs.youtube_thumbnail.width, 1280);
  assert.equal(campaign.outputs.discord_card.height, 630);
  assert.equal(campaign.outputs.pinterest_pin.publish_state, "deferred_package_only");
});

test("premium visual campaign rejects generic, unsafe or visually repeated campaigns", () => {
  const campaign = buildPremiumVisualCampaignSpec(fixture({
    headline: "BIG GAMING NEWS UPDATE",
  }));
  const report = validatePremiumVisualCampaign(campaign, {
    heroImagePresent: false,
    recentCampaigns: [{ visual_fingerprint: campaign.visual_fingerprint }],
  });

  assert.equal(report.verdict, "red");
  assert.ok(report.blockers.includes("premium_visual_safe_hero_missing"));
  assert.ok(report.blockers.includes("premium_visual_headline_subject_mismatch"));
  assert.ok(report.blockers.includes("premium_visual_recent_fingerprint_repeated"));
});

test("premium visual campaign rejects a cover whose V5 identity drifts from the story", () => {
  const campaign = buildPremiumVisualCampaignSpec(fixture());
  campaign.outputs.youtube_thumbnail.creative_identity = {
    ...campaign.outputs.youtube_thumbnail.creative_identity,
    category: "rumour",
  };

  const report = validatePremiumVisualCampaign(campaign, { heroImagePresent: true });

  assert.equal(report.verdict, "red");
  assert.ok(report.blockers.includes("premium_visual_cover_identity_mismatch:youtube_thumbnail"));
});

test("premium visual SVG is full bleed, source restrained and free of legacy CTA furniture", () => {
  const campaign = buildPremiumVisualCampaignSpec(fixture());
  const svg = buildPremiumVisualSvg(campaign, "instagram_story", {
    heroDataUri: "data:image/jpeg;base64,ZmFrZQ==",
  });

  assert.match(svg, /data-role="full-bleed-hero"/);
  assert.match(svg, /ELDER SCROLLS:/);
  assert.match(svg, /FREE OR PAID\?/);
  assert.match(svg, /XBOX WIRE/);
  assert.match(svg, /PULSE GAMING/);
  assert.match(svg, /FREE TRACK OR PAID UPGRADE\?/);
  assert.match(svg, /data-safe-zone=/);
  assert.doesNotMatch(svg, /WATCH NOW/);
  assert.doesNotMatch(svg, /VERIFIED LEAKS/);
  assert.doesNotMatch(svg, /rx="35"/);
});

test("premium animated Story composition is seek-safe and uses restrained living motion", () => {
  const campaign = buildPremiumVisualCampaignSpec(fixture());
  const html = buildStoryMotionComposition(campaign, {
    heroAssetName: "hero.jpg",
  });

  assert.match(html, /data-composition-id="premium-story-eso-paid-catch"/);
  assert.match(html, /data-duration="6"/);
  assert.match(html, /gsap\.timeline\(\{ paused: true \}\)/);
  assert.match(html, /window\.__timelines\["premium-story-eso-paid-catch"\]/);
  assert.match(html, /scale: 1\.08/);
  assert.doesNotMatch(html, /setTimeout|Math\.random|Date\.now/);
});

test("premium campaign materializer writes PNGs, manifest, scorecard and motion project", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-premium-campaign-"));
  try {
    const heroPath = path.join(root, "hero.jpg");
    const sharp = require("sharp");
    await sharp({
      create: { width: 1600, height: 900, channels: 3, background: "#35584e" },
    }).jpeg().toFile(heroPath);

    const result = await materializePremiumVisualCampaign({
      campaignInput: fixture(),
      heroImagePath: heroPath,
      outputDir: path.join(root, "campaign"),
      recentCampaigns: [],
    });

    assert.equal(result.report.verdict, "green");
    assert.equal(await fs.pathExists(result.manifestPath), true);
    assert.equal(await fs.pathExists(result.scorecardPath), true);
    assert.equal(await fs.pathExists(result.outputs.instagram_story.static_path), true);
    assert.equal(await fs.pathExists(result.outputs.youtube_thumbnail.static_path), true);
    assert.equal(await fs.pathExists(result.motionProjectPath), true);

    const manifest = await fs.readJson(result.manifestPath);
    assert.equal(manifest.story_id, "eso-paid-catch");
    assert.equal(manifest.safety.no_publish_triggered, true);
    assert.equal(manifest.outputs.instagram_story.width, 1080);
  } finally {
    await fs.remove(root).catch(() => {});
  }
});
