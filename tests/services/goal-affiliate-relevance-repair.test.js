"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const packageJson = require("../../package.json");

const {
  repairGoalAffiliateRelevance,
} = require("../../lib/goal-affiliate-relevance-repair");
const {
  parseArgs,
} = require("../../tools/goal-affiliate-relevance-repair");

async function makeMismatchedPackage(root, storyId = "mario-rpg-deal") {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  const racingLink = {
    id: "racing-wheel-racing-wheel-ps5-xbox-pc",
    label: "Racing wheel",
    query: "racing wheel PS5 Xbox PC",
    url: "https://www.amazon.co.uk/s?k=racing%20wheel%20PS5%20Xbox%20PC&tag=pulsegaming-21",
    tracking_url: `/go/${storyId}/racing-wheel-racing-wheel-ps5-xbox-pc?platform=story_page&cta=racing%20wheel`,
    merchant: "Amazon UK",
    product_category: "racing wheel",
    category: "racing wheel",
    story_relevance: 92,
  };
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: "Super Mario RPG Drops To $15",
    canonical_title: "Super Mario RPG - $15 at GameStop",
    canonical_subject: "Super Mario RPG",
    canonical_game: "Super Mario RPG",
    canonical_angle: "racing_game_setup",
    narration_script:
      "Super Mario RPG just dropped to $15 at GameStop. GameStop lists Super Mario RPG at $15, 70% off its listed price.",
    confirmed_claims: ["GameStop lists Super Mario RPG at $15, 70% off its listed price."],
    primary_source: "GameStop",
    commercial_intelligence: {
      story_id: storyId,
      commercial_intent_type: "racing_game_setup",
      primary_link: racingLink,
    },
  });
  await fs.outputJson(path.join(artifactDir, "affiliate_link_manifest.json"), {
    story_id: storyId,
    vertical: "gaming",
    commercial_intent_type: "racing_game_setup",
    primary_affiliate_angle: "Racing wheels and Xbox/PC setup checks",
    primary_link: racingLink,
    fallback_links: [],
    disclosure_required: true,
    disclosure_copy: { short: "Affiliate links may earn us a commission." },
    affiliate_tracking_map: {
      story_id: storyId,
      primary_offer_id: racingLink.id,
      story_page: racingLink.tracking_url,
      platforms: { youtube: `${racingLink.tracking_url}&platform=youtube` },
    },
    landing_page_attribution: { verdict: "pass", platforms: {} },
    revenue_attribution: { story_id: storyId },
    relevance_score: 92,
  });
  await fs.outputJson(path.join(artifactDir, "landing_page_manifest.json"), {
    story_id: storyId,
    landing_page_route: `/p/${storyId}`,
    link_pack: { primary_link: racingLink, fallback_links: [] },
    disclosure_block: {
      required: true,
      copy: { short: "Affiliate links may earn us a commission." },
      source_first: true,
    },
  });
  return { story_id: storyId, artifact_dir: artifactDir };
}

async function makeIncidentalForzaPackage(root, storyId = "subnautica-leak") {
  const storyPackage = await makeMismatchedPackage(root, storyId);
  const artifactDir = storyPackage.artifact_dir;
  const affiliate = await fs.readJson(path.join(artifactDir, "affiliate_link_manifest.json"));
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: "Subnautica 2 Reportedly Leaked Early",
    canonical_title: "After Forza Horizon 6, Now Subnautica 2 Has Reportedly Leaked 48 Hours Ahead of Launch",
    canonical_subject: "Subnautica 2",
    canonical_game: "Subnautica 2",
    canonical_angle: "racing_game_setup",
    narration_script:
      "Subnautica 2 reportedly leaked before launch. Rough leaked material can shape expectations before the official build gets a fair look.",
    confirmed_claims: ["Subnautica 2 reportedly appeared online before launch."],
    primary_source: "Respawnfirst",
    commercial_intelligence: affiliate,
  });
  return storyPackage;
}

async function makeControllerAccessoryPackage(root, storyId = "xbox-controller-leak") {
  const storyPackage = await makeMismatchedPackage(root, storyId);
  const artifactDir = storyPackage.artifact_dir;
  const affiliate = await fs.readJson(path.join(artifactDir, "affiliate_link_manifest.json"));
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: "Xbox Controller Deal Has One Catch",
    canonical_title: "FH6 limited-edition Xbox controller and headset have just leaked",
    canonical_subject: "Xbox Controller",
    canonical_game: "Xbox Controller",
    canonical_angle: "racing_game_setup",
    narration_script:
      "Xbox controller deals are getting aggressive, but the catch is the retailer. Xbox lists official Forza Horizon 6 limited-edition Xbox Wireless Controller and Xbox Wireless Headset accessories.",
    confirmed_claims: [
      "Xbox lists official Forza Horizon 6 limited-edition Xbox Wireless Controller and Xbox Wireless Headset accessories.",
    ],
    primary_source: "Xbox",
    commercial_intelligence: affiliate,
  });
  return storyPackage;
}

test("affiliate relevance repair plans stale racing offers without mutating files in proof mode", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-affiliate-relevance-plan-"));
  const storyPackage = await makeMismatchedPackage(root);
  const before = await fs.readJson(path.join(storyPackage.artifact_dir, "affiliate_link_manifest.json"));

  const report = await repairGoalAffiliateRelevance({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-27T05:20:00.000Z",
    apply: false,
  });

  assert.equal(report.summary.eligible_repair_count, 1);
  assert.equal(report.summary.would_repair_count, 1);
  assert.equal(report.safety.no_publish_triggered, true);
  assert.equal(report.repairs[0].before.primary_link.label, "Racing wheel");
  assert.match(report.repairs[0].after.primary_link.label, /Mario|Nintendo|eShop/i);
  assert.notEqual(report.repairs[0].after.primary_link.product_category, "racing wheel");

  const after = await fs.readJson(path.join(storyPackage.artifact_dir, "affiliate_link_manifest.json"));
  assert.deepEqual(after, before);
});

test("affiliate relevance repair applies local manifest and landing-page fixes with backups", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-affiliate-relevance-apply-"));
  const storyPackage = await makeMismatchedPackage(root);
  const backupRoot = path.join(root, "backups");

  const report = await repairGoalAffiliateRelevance({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-27T05:21:00.000Z",
    apply: true,
    backupRoot,
  });

  assert.equal(report.summary.repaired_count, 1);
  assert.equal(await fs.pathExists(report.repairs[0].backups.affiliate), true);
  assert.equal(await fs.pathExists(report.repairs[0].backups.canonical), true);
  assert.equal(await fs.pathExists(report.repairs[0].backups.landing), true);

  const affiliate = await fs.readJson(path.join(storyPackage.artifact_dir, "affiliate_link_manifest.json"));
  const canonical = await fs.readJson(path.join(storyPackage.artifact_dir, "canonical_story_manifest.json"));
  const landing = await fs.readJson(path.join(storyPackage.artifact_dir, "landing_page_manifest.json"));

  assert.equal(affiliate.commercial_intent_type, "nintendo_franchise_game_deal");
  assert.notEqual(affiliate.primary_link.product_category, "racing wheel");
  assert.equal(canonical.commercial_intelligence.primary_link.id, affiliate.primary_link.id);
  assert.equal(landing.link_pack.primary_link.id, affiliate.primary_link.id);
  assert.equal(landing.disclosure_block.required, true);
});

test("affiliate relevance repair catches stale racing offers from incidental source-title wording", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-affiliate-relevance-incidental-"));
  const storyPackage = await makeIncidentalForzaPackage(root);

  const report = await repairGoalAffiliateRelevance({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-29T01:45:00.000Z",
    apply: true,
    backupRoot: path.join(root, "backups"),
  });

  assert.equal(report.summary.repaired_count, 1);
  assert.equal(report.repairs[0].mismatch_reason, "racing_offer_on_non_racing_story");
  const affiliate = await fs.readJson(path.join(storyPackage.artifact_dir, "affiliate_link_manifest.json"));
  const canonical = await fs.readJson(path.join(storyPackage.artifact_dir, "canonical_story_manifest.json"));
  const landing = await fs.readJson(path.join(storyPackage.artifact_dir, "landing_page_manifest.json"));
  assert.equal(affiliate.commercial_intent_type, "no_safe_commercial_intent");
  assert.equal(affiliate.primary_link, null);
  assert.equal(canonical.commercial_intelligence.primary_link, null);
  assert.equal(landing.landing_page_route, "/p/subnautica-2-reportedly-leaked-early");
});

test("affiliate relevance repair replaces racing-wheel drift on controller stories with accessory offers", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-affiliate-relevance-controller-"));
  const storyPackage = await makeControllerAccessoryPackage(root);

  const report = await repairGoalAffiliateRelevance({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-29T01:46:00.000Z",
    apply: true,
    backupRoot: path.join(root, "backups"),
  });

  assert.equal(report.summary.repaired_count, 1);
  const affiliate = await fs.readJson(path.join(storyPackage.artifact_dir, "affiliate_link_manifest.json"));
  const landing = await fs.readJson(path.join(storyPackage.artifact_dir, "landing_page_manifest.json"));
  assert.equal(affiliate.commercial_intent_type, "controller_accessory_context");
  assert.match(affiliate.primary_link?.label || "", /controller/i);
  assert.notEqual(affiliate.primary_link?.product_category, "racing wheel");
  assert.equal(landing.link_pack.primary_link.id, affiliate.primary_link.id);
});

test("affiliate relevance repair fixes stale landing routes after affiliate manifests are already clean", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-affiliate-relevance-route-"));
  const storyPackage = await makeIncidentalForzaPackage(root, "subnautica-route-clean");
  await repairGoalAffiliateRelevance({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-29T01:47:00.000Z",
    apply: true,
    backupRoot: path.join(root, "backups-first"),
  });
  const landingPath = path.join(storyPackage.artifact_dir, "landing_page_manifest.json");
  const landing = await fs.readJson(landingPath);
  landing.landing_page_route = "/p/old-forza-route";
  landing.landing_page_slug = "old-forza-route";
  await fs.writeJson(landingPath, landing, { spaces: 2 });

  const report = await repairGoalAffiliateRelevance({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-29T01:48:00.000Z",
    apply: true,
    backupRoot: path.join(root, "backups-second"),
  });

  assert.equal(report.summary.repaired_count, 1);
  assert.equal(report.repairs[0].mismatch_reason, "stale_landing_route");
  const repairedLanding = await fs.readJson(landingPath);
  assert.equal(repairedLanding.landing_page_route, "/p/subnautica-2-reportedly-leaked-early");
});

test("affiliate relevance repair CLI args and package script are registered", () => {
  const args = parseArgs([
    "--story-packages",
    "output/goal-contract/production_cutover_story_packages.json",
    "--out-dir",
    "output/goal-contract",
    "--apply",
  ]);

  assert.equal(args.apply, true);
  assert.equal(args.storyPackagesPath, "output/goal-contract/production_cutover_story_packages.json");
  assert.equal(packageJson.scripts["ops:goal-affiliate-relevance-repair"], "node tools/goal-affiliate-relevance-repair.js");
});
