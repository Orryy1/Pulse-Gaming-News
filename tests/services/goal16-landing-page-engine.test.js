"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  REQUIRED_LANDING_COMPONENTS,
  buildGoal16LandingPageEngine,
  writeGoal16LandingPageEngine,
} = require("../../lib/goal16-landing-page-engine");

async function makeStoryPackage(root, storyId, overrides = {}) {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  const title = overrides.title || "Forza Horizon 6 May Be Close";
  const subject = overrides.subject || "Forza Horizon 6";
  const route = `/p/${storyId}`;
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: title,
    canonical_title: title,
    canonical_subject: subject,
    description: `${subject} has a source-backed update from Xbox Wire.`,
    narration_script: `${subject} has a source-backed update from Xbox Wire. The next proof is what Microsoft shows publicly.`,
    primary_source: { name: "Xbox Wire", url: "https://news.xbox.com/example" },
    primary_source_url: "https://news.xbox.com/example",
    secondary_sources: [{ name: "Steam News", url: "https://store.steampowered.com/news/example" }],
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: storyId,
    output: "visual_v4_render.mp4",
    final_publish_render: false,
  });
  await fs.outputFile(path.join(artifactDir, "visual_v4_render.mp4"), "local proof mp4 placeholder");
  await fs.outputJson(path.join(artifactDir, "affiliate_link_manifest.json"), overrides.affiliate || safeAffiliate(storyId, route));
  await fs.outputJson(path.join(artifactDir, "landing_page_manifest.json"), overrides.landing || safeLanding(storyId, route));
  return { story_id: storyId, artifact_dir: artifactDir, title };
}

function safeAffiliate(storyId, route) {
  const disclosure = "Affiliate links may earn us a commission.";
  return {
    story_id: storyId,
    vertical: "gaming",
    primary_link: {
      id: "racing-wheel",
      label: "Racing wheel",
      url: "https://www.amazon.co.uk/s?k=racing+wheel&tag=pulsegaming-21",
      tracking_url: `/go/${storyId}/racing-wheel?platform=story_page&cta=racing-wheel`,
      merchant: "Amazon UK",
      product_category: "racing wheel",
    },
    fallback_links: [
      {
        id: "controller",
        label: "Xbox controller",
        url: "https://www.amazon.co.uk/s?k=xbox+controller&tag=pulsegaming-21",
        tracking_url: `/go/${storyId}/controller?platform=story_page&cta=controller`,
      },
    ],
    source_links: [{ label: "Xbox Wire", url: "https://news.xbox.com/example" }],
    disclosure_required: true,
    disclosure_copy: { short: disclosure, landing: disclosure },
    landing_page_route: route,
    landing_page_slug: storyId,
    tracking_utm: { campaign: storyId },
    revenue_attribution: {
      story_id: storyId,
      platform_clicks: { youtube: 0, x: 0 },
      landing_page_visits: 0,
      conversions: 0,
      revenue: { amount: 0, currency: "GBP", source: "waiting_for_affiliate_network_reporting" },
    },
  };
}

function safeLanding(storyId, route) {
  const disclosure = "Affiliate links may earn us a commission.";
  return {
    schema_version: 1,
    story_id: storyId,
    landing_page_slug: storyId,
    landing_page_route: route,
    newsletter_capture: true,
    link_pack: {
      primary_link: null,
      fallback_links: [],
      source_links: [{ label: "Xbox Wire", url: "https://news.xbox.com/example" }],
    },
    disclosure_block: {
      required: true,
      copy: { short: disclosure, landing: disclosure },
      source_first: true,
    },
    attribution_manifest: {
      story_id: storyId,
      verdict: "pass",
      platforms: {
        youtube: {
          tracking_key: `${storyId}:youtube:story_page`,
          landing_page_url: `${route}?utm_source=youtube&utm_medium=social&utm_campaign=${storyId}`,
          disclosure_required: true,
          disclosure_copy: disclosure,
        },
        x: {
          tracking_key: `${storyId}:x:story_page`,
          landing_page_url: `${route}?utm_source=x&utm_medium=social&utm_campaign=${storyId}`,
          disclosure_required: true,
          disclosure_copy: disclosure,
        },
      },
    },
  };
}

function blockedAffiliateReport(storyId) {
  return {
    stories: [
      {
        story_id: storyId,
        status: "blocked",
        blockers: ["upstream:goal14_social_derivatives_blocked"],
      },
    ],
  };
}

function readyAffiliateReport(storyId) {
  return {
    stories: [{ story_id: storyId, status: "ready", blockers: [] }],
  };
}

test("Goal 16 prepares landing pages but blocks full readiness when Goal 15 is blocked", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal16-upstream-blocked-"));
  const story = await makeStoryPackage(root, "story-landing");
  const related = await makeStoryPackage(root, "story-related", {
    title: "Xbox Shows Another Racing Update",
    subject: "Xbox racing games",
  });

  const report = await buildGoal16LandingPageEngine({
    storyPackages: [story, related],
    upstreamAffiliateReport: blockedAffiliateReport("story-landing"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T02:36:43.754Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.direct_landing_verdict, "PASS");
  assert.equal(report.summary.story_count, 2);
  assert.equal(report.summary.direct_landing_pass_story_count, 2);
  assert.equal(report.summary.landing_ready_story_count, 0);
  assert.ok(report.stories[0].blockers.includes("upstream:goal15_affiliate_intelligence_blocked"));
  for (const component of REQUIRED_LANDING_COMPONENTS) {
    assert.equal(report.stories[0].component_status[component], "pass", component);
  }
  assert.equal(report.stories[0].landing_page_manifest.newsletter_capture.enabled, true);
  assert.ok(report.stories[0].landing_page_manifest.source_list.length >= 2);
  assert.ok(report.stories[0].landing_page_manifest.summary);
  assert.equal(report.stories[0].landing_page_manifest.embed.status, "local_proof_asset_available");
  assert.ok(report.stories[0].landing_page_manifest.related_stories.length >= 1);
  assert.ok(report.link_pack.stories[0].primary_link);
  assert.equal(report.disclosure_block.verdict, "pass");
  assert.equal(report.revenue_tracking.mode, "LOCAL_PROOF");
  assert.equal(report.revenue_tracking.stories[0].revenue.amount, 0);
  assert.equal(report.safety.no_publish_triggered, true);
  assert.equal(report.safety.no_db_mutation, true);
});

test("Goal 16 hard-fails landing pages that cannot prove source, summary, embed or disclosure", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal16-hard-fail-"));
  const artifactDir = path.join(root, "story-risk");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "story-risk",
    selected_title: "",
    canonical_subject: "",
  });
  await fs.outputJson(path.join(artifactDir, "affiliate_link_manifest.json"), {
    story_id: "story-risk",
    primary_link: {
      id: "unsafe",
      label: "Unsafe product",
      url: "https://www.amazon.co.uk/s?k=unsafe&tag=pulsegaming-21",
      tracking_url: "/go/story-risk/unsafe?platform=story_page",
    },
    fallback_links: [],
    disclosure_required: true,
    disclosure_copy: { short: "", landing: "" },
  });
  await fs.outputJson(path.join(artifactDir, "landing_page_manifest.json"), {
    story_id: "story-risk",
    landing_page_route: "/p/story-risk",
    newsletter_capture: false,
    link_pack: { source_links: [] },
    disclosure_block: { required: true, copy: { short: "", landing: "" }, source_first: true },
  });

  const report = await buildGoal16LandingPageEngine({
    storyPackages: [{ story_id: "story-risk", artifact_dir: artifactDir }],
    upstreamAffiliateReport: readyAffiliateReport("story-risk"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T02:36:43.754Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.direct_landing_verdict, "BLOCKED");
  for (const blocker of [
    "landing:source_list_missing",
    "landing:summary_missing",
    "landing:embed_missing",
    "landing:affiliate_disclosure_missing",
  ]) {
    assert.ok(report.blocker_counts[blocker] >= 1, blocker);
  }
  assert.equal(report.disclosure_block.verdict, "fail");
});

test("Goal 16 writes required landing-page artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal16-write-"));
  const story = await makeStoryPackage(root, "story-write");
  const outputDir = path.join(root, "out");
  const report = await buildGoal16LandingPageEngine({
    storyPackages: [story],
    upstreamAffiliateReport: blockedAffiliateReport("story-write"),
    workspaceRoot: root,
    outputDir,
    generatedAt: "2026-05-26T02:36:43.754Z",
  });

  const written = await writeGoal16LandingPageEngine(report, { outputDir });

  assert.equal(await fs.pathExists(written.readinessJson), true);
  assert.equal(await fs.pathExists(written.readinessMarkdown), true);
  assert.equal(await fs.pathExists(written.landingPageManifest), true);
  assert.equal(await fs.pathExists(written.linkPack), true);
  assert.equal(await fs.pathExists(written.disclosureBlock), true);
  assert.equal(await fs.pathExists(written.revenueTracking), true);
});
