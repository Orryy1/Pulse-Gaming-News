"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const packageJson = require("../../package.json");

const {
  repairGoalCommercialDisclosure,
} = require("../../lib/goal-commercial-disclosure-repair");
const {
  parseArgs: parseGoalCommercialDisclosureRepairArgs,
} = require("../../tools/goal-commercial-disclosure-repair");
const { evaluateIncidentGuard } = require("../../lib/incident-guard");

async function writeDealPackage(tmp, overrides = {}) {
  const storyId = overrides.story_id || "gamesir-deal";
  const artifactDir = path.join(tmp, `${storyId}-package`);
  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    canonical_subject: "GameSir G7 Pro",
    selected_title: "GameSir G7 Pro Deal Has One Catch",
    thumbnail_headline: "GAMESIR G7 DEAL",
    first_spoken_line: "GameSir G7 Pro just became a better controller deal for PC players.",
    narration_script:
      "GameSir G7 Pro just became a better controller deal for PC players. IGN says the controller is on sale for Memorial Day, but the catch is whether it fits your setup.",
    description: "The GameSir G7 Pro is on sale for Memorial Day. Source: IGN.",
    primary_source: "IGN",
    discovery_source: "IGN",
    ...(overrides.canonical || {}),
  });
  await fs.writeJson(path.join(artifactDir, "affiliate_link_manifest.json"), {
    story_id: storyId,
    vertical: "gaming",
    disclosure_required: false,
    primary_link: null,
    fallback_links: [],
    ...(overrides.affiliate || {}),
  });
  await fs.writeJson(path.join(artifactDir, "landing_page_manifest.json"), {
    story_id: storyId,
    landing_page_route: "/p/gamesir-g7-pro-deal",
    ...(overrides.landing || {}),
  });
  await fs.writeJson(path.join(artifactDir, "platform_policy_report.json"), {
    story_id: storyId,
    ...(overrides.policy || {}),
  });
  await fs.writeJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    story_id: storyId,
    publish_status: "GREEN",
    platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
    outputs: {
      youtube_shorts: { title: "GameSir G7 Pro Deal Has One Catch" },
    },
    ...(overrides.platform || {}),
  });
  await fs.writeJson(path.join(artifactDir, "render_manifest.json"), {
    final_publish_render: true,
    render_lane: "visual_v4_production",
    render_quality_class: "premium",
    visual_count: 8,
  });
  await fs.writeJson(path.join(artifactDir, "publish_verdict.json"), {
    verdict: "GREEN",
  });
  return {
    story_id: storyId,
    artifact_dir: artifactDir,
  };
}

async function incidentReportForPackage(storyPackage) {
  const artifactDir = storyPackage.artifact_dir;
  const canonical = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  const renderManifest = await fs.readJson(path.join(artifactDir, "render_manifest.json"));
  const publishVerdict = await fs.readJson(path.join(artifactDir, "publish_verdict.json"));
  const platformManifest = await fs.readJson(path.join(artifactDir, "platform_publish_manifest.json"));
  const policy = await fs.readJson(path.join(artifactDir, "platform_policy_report.json"));
  const affiliate = await fs.readJson(path.join(artifactDir, "affiliate_link_manifest.json"));
  const landing = await fs.readJson(path.join(artifactDir, "landing_page_manifest.json"));
  return evaluateIncidentGuard({
    story_id: storyPackage.story_id,
    canonical_story_manifest: canonical,
    render_manifest: renderManifest,
    publish_verdict: publishVerdict,
    platform_publish_manifest: platformManifest,
    platform_policy_report: policy,
    affiliate_link_manifest: affiliate,
    landing_page_manifest: landing,
    file_evidence: {
      mp4_ready: true,
      captions_ready: true,
      narration_ready: true,
      word_timestamps_ready: true,
      materialised_motion_ready: true,
      distinct_motion_families_ready: true,
      rights_ledger_ready: true,
    },
  });
}

test("commercial disclosure repair writes matching disclosure evidence with backups only", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-commercial-disclosure-"));
  const storyPackage = await writeDealPackage(tmp);

  const before = await incidentReportForPackage(storyPackage);
  assert.ok(before.disaster_upload_blockers.includes("incident:commercial_deal_disclosure_missing"));

  const dryRun = await repairGoalCommercialDisclosure({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-22T23:55:00.000Z",
    apply: false,
  });

  assert.equal(dryRun.summary.repairable_count, 1);
  assert.equal(dryRun.summary.repaired_count, 0);
  assert.equal(dryRun.items[0].status, "repairable");

  const applied = await repairGoalCommercialDisclosure({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-22T23:56:00.000Z",
    apply: true,
    backupRoot: path.join(tmp, "backups"),
  });

  assert.equal(applied.summary.repaired_count, 1);
  assert.equal(applied.safety.no_publish_triggered, true);
  assert.equal(applied.safety.no_network_uploads, true);
  assert.equal(applied.safety.no_db_mutation, true);
  assert.equal(applied.safety.local_artifact_files_only, true);

  const affiliate = await fs.readJson(path.join(storyPackage.artifact_dir, "affiliate_link_manifest.json"));
  const policy = await fs.readJson(path.join(storyPackage.artifact_dir, "platform_policy_report.json"));
  const landing = await fs.readJson(path.join(storyPackage.artifact_dir, "landing_page_manifest.json"));
  const platform = await fs.readJson(path.join(storyPackage.artifact_dir, "platform_publish_manifest.json"));

  assert.equal(affiliate.commercial_disclosure_required, true);
  assert.equal(affiliate.no_affiliate_link, true);
  assert.match(affiliate.disclosure_copy.short, /No affiliate link is attached/);
  assert.equal(policy.disclosure_requirements.commercial, true);
  assert.match(policy.disclosure_text, /No affiliate link is attached/);
  assert.equal(landing.disclosure_block.required, true);
  assert.equal(platform.commercial_disclosure.verdict, "pass");
  assert.equal(await fs.pathExists(path.join(tmp, "backups", "gamesir-deal", "affiliate_link_manifest.json")), true);

  const after = await incidentReportForPackage(storyPackage);
  assert.doesNotMatch(after.disaster_upload_blockers.join(","), /commercial_deal_disclosure_missing/);
});

test("commercial disclosure repair preserves approved affiliate links and marks affiliate disclosure", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-commercial-affiliate-"));
  const storyPackage = await writeDealPackage(tmp, {
    story_id: "xbox-controller-deal",
    canonical: {
      canonical_subject: "Xbox Controller",
      selected_title: "Xbox Controller Deal Has One Catch",
      thumbnail_headline: "XBOX CONTROLLER DEAL",
      first_spoken_line: "Xbox Controller buyers just got a cheaper option to check.",
      narration_script:
        "Xbox Controller buyers just got a cheaper option to check. IGN says the controller deal is on sale this week, but the catch is whether it fits your setup.",
      description: "The Xbox Controller deal is on sale this week. Source: IGN.",
    },
    affiliate: {
      disclosure_required: false,
      primary_link: {
        id: "xbox-controller",
        url: "https://www.amazon.co.uk/s?k=xbox+controller&tag=pulsegaming-21",
        label: "Xbox controller",
      },
    },
  });

  await repairGoalCommercialDisclosure({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-22T23:58:00.000Z",
    apply: true,
    backupRoot: path.join(tmp, "backups"),
  });

  const affiliate = await fs.readJson(path.join(storyPackage.artifact_dir, "affiliate_link_manifest.json"));
  const policy = await fs.readJson(path.join(storyPackage.artifact_dir, "platform_policy_report.json"));

  assert.equal(affiliate.no_affiliate_link, false);
  assert.equal(affiliate.disclosure_required, true);
  assert.equal(affiliate.primary_link.id, "xbox-controller");
  assert.match(affiliate.disclosure_copy.short, /Affiliate links may earn us a commission/);
  assert.equal(policy.disclosure_requirements.affiliate, true);
});

test("commercial disclosure repair treats unrejected affiliate candidates as disclosure-required", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-commercial-candidates-"));
  const storyPackage = await writeDealPackage(tmp, {
    story_id: "destiny-affiliate-candidate",
    canonical: {
      canonical_subject: "Destiny 2",
      selected_title: "Destiny 2 Is Getting Its Final Update",
      thumbnail_headline: "DESTINY 2 FINAL UPDATE",
      first_spoken_line: "Destiny 2 is getting its final update.",
      narration_script:
        "Destiny 2 is getting its final update. Bungie says the next content drop changes how long the game keeps moving.",
      description: "Destiny 2 is getting its final update. Source: Bungie.",
      primary_source: "Bungie",
      discovery_source: "Bungie",
    },
    affiliate: {
      disclosure_required: false,
      candidate_links: [
        {
          id: "game-pass-card",
          url: "https://www.amazon.co.uk/s?k=game+pass&tag=pulsegaming-21",
          rejection_reasons: [],
        },
      ],
    },
  });

  const dryRun = await repairGoalCommercialDisclosure({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-23T00:08:00.000Z",
    apply: false,
  });

  assert.equal(dryRun.summary.repairable_count, 1);

  await repairGoalCommercialDisclosure({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-23T00:09:00.000Z",
    apply: true,
    backupRoot: path.join(tmp, "backups"),
  });

  const affiliate = await fs.readJson(path.join(storyPackage.artifact_dir, "affiliate_link_manifest.json"));

  assert.equal(affiliate.no_affiliate_link, false);
  assert.equal(affiliate.disclosure_required, true);
  assert.match(affiliate.disclosure_copy.short, /Affiliate links may earn us a commission/);
});

test("commercial disclosure repair CLI is wired into package scripts", () => {
  const args = parseGoalCommercialDisclosureRepairArgs([
    "--story-packages",
    "output/goal-contract/story-packages.json",
    "--out-dir",
    "output/goal-contract",
    "--apply",
  ]);

  assert.equal(args.apply, true);
  assert.equal(args.storyPackagesPath, "output/goal-contract/story-packages.json");
  assert.equal(packageJson.scripts["ops:goal-commercial-disclosure-repair"], "node tools/goal-commercial-disclosure-repair.js");
});
