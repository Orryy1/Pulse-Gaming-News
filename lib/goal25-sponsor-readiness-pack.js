"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const GOAL_ID = "25_sponsor_readiness_pack";

const REQUIRED_SPONSOR_METRICS = [
  "subscribers",
  "shorts_views_90d",
  "average_views",
  "average_view_duration_seconds",
  "average_view_percentage",
  "comments_per_view",
  "platform_reach",
  "vertical_breakdown",
  "audience_summary",
];

const SPONSORSHIP_FORMATS = [
  "sponsor-safe Short integration",
  "story page placement",
  "newsletter mention",
  "source-safe product comparison",
];

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normaliseStatus(value) {
  return cleanText(value).toLowerCase();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function passLike(value) {
  return ["pass", "passed", "ready", "green", "ok", "clear"].includes(normaliseStatus(value));
}

function failuresFrom(...values) {
  const failures = [];
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    failures.push(
      ...asArray(value.failures),
      ...asArray(value.blockers),
      ...asArray(value.publish_blockers),
      ...asArray(value.direct_corrections_blockers),
      ...asArray(value.upstream_blockers),
      ...asArray(value.reason_codes),
      ...asArray(value.errors),
    );
  }
  return unique(failures);
}

function storyIdFromPackage(storyPackage = {}) {
  return cleanText(storyPackage.story_id || storyPackage.id || storyPackage.storyId);
}

function resolveWorkspacePath(workspaceRoot, value) {
  const text = cleanText(value);
  if (!text) return "";
  if (path.isAbsolute(text)) return path.resolve(text);
  return path.resolve(workspaceRoot || process.cwd(), text);
}

async function readJsonIfPresent(filePath, fallback = {}) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  try {
    return await fs.readJson(filePath);
  } catch {
    return fallback;
  }
}

function objectPresent(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0);
}

function numericPresent(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function metricMissing(snapshot = {}, key) {
  if (key === "platform_reach" || key === "vertical_breakdown" || key === "audience_summary") {
    return !objectPresent(snapshot[key]);
  }
  return !numericPresent(snapshot[key]);
}

function buildGoal24Index(upstreamCorrectionsReport = {}) {
  const index = new Map();
  for (const row of asArray(upstreamCorrectionsReport.stories || upstreamCorrectionsReport.rows)) {
    const storyId = cleanText(row.story_id || row.id);
    if (storyId) index.set(storyId, row);
  }
  return index;
}

function upstreamBlockers(storyId, correctionsIndex = new Map()) {
  const row = correctionsIndex.get(cleanText(storyId));
  if (!row) return ["upstream:goal24_corrections_retractions_takedowns_missing"];
  const blockers = failuresFrom(row);
  const status = normaliseStatus(row.status || row.verdict || row.final_verdict);
  if (passLike(status) && blockers.length === 0) return [];
  return unique(["upstream:goal24_corrections_retractions_takedowns_blocked", ...blockers]);
}

async function loadStoryPackage(storyPackage = {}, { workspaceRoot } = {}) {
  const storyId = storyIdFromPackage(storyPackage);
  const artifactDir = resolveWorkspacePath(workspaceRoot, storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir);
  const canonical = await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {});
  const platformPolicy = await readJsonIfPresent(path.join(artifactDir, "platform_policy_report.json"), {});
  const financeCrypto = await readJsonIfPresent(path.join(artifactDir, "finance_crypto_risk_report.json"), {});
  const publishVerdict = await readJsonIfPresent(path.join(artifactDir, "publish_verdict.json"), {});
  return {
    story_id: storyId,
    artifact_dir: artifactDir,
    title: cleanText(canonical.selected_title || canonical.canonical_title || storyPackage.title),
    canonical_subject: cleanText(canonical.canonical_subject || canonical.subject || storyPackage.canonical_subject),
    vertical: cleanText(canonical.content_pillar || canonical.vertical || storyPackage.vertical || "gaming_news")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, ""),
    platform_policy_verdict: normaliseStatus(platformPolicy.verdict || platformPolicy.status || platformPolicy.platform_policy_gate?.verdict),
    platform_policy_blockers: failuresFrom(platformPolicy),
    finance_crypto_verdict: normaliseStatus(financeCrypto.verdict || financeCrypto.status || financeCrypto.finance_crypto_firewall?.verdict),
    finance_crypto_blockers: failuresFrom(financeCrypto),
    publish_verdict: cleanText(publishVerdict.verdict || publishVerdict.publish_status || publishVerdict.status),
    source_material: {
      canonical_story_manifest_present: objectPresent(canonical),
      platform_policy_report_present: objectPresent(platformPolicy),
      finance_crypto_risk_report_present: objectPresent(financeCrypto),
      publish_verdict_present: objectPresent(publishVerdict),
    },
  };
}

function brandSafetyBlockers(story = {}) {
  const blockers = [];
  if (story.platform_policy_verdict && !passLike(story.platform_policy_verdict)) {
    blockers.push("brand_safety:platform_policy_not_clear");
  }
  if (story.platform_policy_blockers.length) blockers.push(...story.platform_policy_blockers);
  if (story.finance_crypto_verdict && !passLike(story.finance_crypto_verdict)) {
    blockers.push("brand_safety:finance_crypto_not_clear");
  }
  if (story.finance_crypto_blockers.length) blockers.push(...story.finance_crypto_blockers);
  if (story.publish_verdict && normaliseStatus(story.publish_verdict) !== "green") {
    blockers.push("brand_safety:publish_verdict_not_green");
  }
  return unique(blockers);
}

function storyMetric(performanceSnapshot = {}, storyId) {
  return performanceSnapshot.story_metrics?.[storyId] || performanceSnapshot.videos?.find?.((video) => video.story_id === storyId || video.id === storyId) || {};
}

function buildBestPerformingVideos(stories = [], performanceSnapshot = {}) {
  return stories
    .map((story) => {
      const metrics = storyMetric(performanceSnapshot, story.story_id);
      return {
        story_id: story.story_id,
        title: story.title,
        views: Number.isFinite(Number(metrics.views)) ? Number(metrics.views) : null,
        average_view_duration_seconds: Number.isFinite(Number(metrics.average_view_duration_seconds))
          ? Number(metrics.average_view_duration_seconds)
          : null,
        platform: cleanText(metrics.platform || "unknown"),
      };
    })
    .filter((row) => row.views !== null)
    .sort((a, b) => b.views - a.views)
    .slice(0, 10);
}

function buildSponsorSafeExamples(stories = [], performanceSnapshot = {}) {
  return stories
    .filter((story) => story.direct_sponsor_blockers.length === 0)
    .map((story) => {
      const metrics = storyMetric(performanceSnapshot, story.story_id);
      return {
        story_id: story.story_id,
        title: story.title,
        vertical: story.vertical,
        views: Number.isFinite(Number(metrics.views)) ? Number(metrics.views) : null,
        brand_safety_status: "clear",
      };
    })
    .slice(0, 8);
}

function pricingRecommendations(snapshot = {}, missingMetrics = []) {
  if (missingMetrics.length) {
    return {
      status: "blocked_missing_metrics",
      currency: cleanText(snapshot.pricing_basis?.currency || "GBP"),
      ranges: [],
      note: "Do not quote sponsor pricing until the required audience and retention metrics are verified.",
    };
  }
  const averageViews = Number(snapshot.average_views);
  const floorCpm = Number(snapshot.pricing_basis?.floor_cpm || 8);
  const ceilingCpm = Number(snapshot.pricing_basis?.ceiling_cpm || 18);
  const floor = Math.max(50, Math.round((averageViews / 1000) * floorCpm));
  const ceiling = Math.max(floor, Math.round((averageViews / 1000) * ceilingCpm));
  return {
    status: "draft_operator_review",
    currency: cleanText(snapshot.pricing_basis?.currency || "GBP"),
    basis: {
      average_views: averageViews,
      floor_cpm: floorCpm,
      ceiling_cpm: ceilingCpm,
      no_revenue_projection: true,
    },
    ranges: [
      {
        format: "sponsor-safe Short integration",
        floor,
        ceiling,
        status: "draft_not_quoted",
      },
      {
        format: "story page placement",
        floor: Math.round(floor * 0.35),
        ceiling: Math.round(ceiling * 0.45),
        status: "draft_not_quoted",
      },
    ],
    note: "Draft pricing is for operator review only. No sponsor outreach was sent.",
  };
}

function buildBrandSafetyReport(report = {}) {
  const unsafeStories = asArray(report.stories).filter((story) => story.direct_sponsor_blockers.length > 0);
  const upstreamBlockedStories = asArray(report.stories).filter((story) => story.upstream_status === "blocked");
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    verdict: unsafeStories.length ? "BLOCKED" : "PASS",
    upstream_blocked_story_count: upstreamBlockedStories.length,
    unsafe_story_count: unsafeStories.length,
    checks: {
      source_safe: unsafeStories.length === 0,
      advertiser_safe_language: unsafeStories.length === 0,
      affiliate_disclosure_plan_required: true,
      finance_crypto_requires_separate_review: true,
      no_paid_endorsement_without_disclosure: true,
    },
    blockers: unique(unsafeStories.flatMap((story) => story.direct_sponsor_blockers)),
    sponsor_safe_story_ids: asArray(report.sponsor_media_kit?.sponsor_safe_examples).map((item) => item.story_id),
    safety: {
      no_sponsor_outreach_sent: true,
      no_public_claims_changed: true,
    },
  };
}

function buildSponsorPitchPack(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    outreach_sent: false,
    status: report.sponsor_media_kit?.ready_for_outreach ? "draft_ready_for_operator_review" : "blocked",
    sections: {
      opening: "Pulse Gaming is a short-form gaming news channel built around sourced stories and sponsor-safe formats.",
      audience: report.sponsor_media_kit?.audience_summary || {},
      proof_points: report.sponsor_media_kit?.best_performing_videos || [],
      sponsor_formats: SPONSORSHIP_FORMATS,
      disclosure: report.sponsor_media_kit?.disclosure_plan || {},
    },
  };
}

function buildSponsorMediaKit({ stories = [], performanceSnapshot = {}, missingMetrics = [], readyForOutreach = false } = {}) {
  const bestPerformingVideos = buildBestPerformingVideos(stories, performanceSnapshot);
  const sponsorSafeExamples = buildSponsorSafeExamples(stories, performanceSnapshot);
  return {
    schema_version: 1,
    goal: GOAL_ID,
    mode: "LOCAL_PROOF",
    ready_for_outreach: readyForOutreach,
    headline: "Pulse Gaming - sourced gaming news Shorts",
    audience_summary: performanceSnapshot.audience_summary || null,
    public_metrics: {
      subscribers: performanceSnapshot.subscribers ?? null,
      shorts_views_90d: performanceSnapshot.shorts_views_90d ?? null,
      comments_per_view: performanceSnapshot.comments_per_view ?? null,
    },
    average_views: performanceSnapshot.average_views ?? null,
    retention_stats: {
      average_view_duration_seconds: performanceSnapshot.average_view_duration_seconds ?? null,
      average_view_percentage: performanceSnapshot.average_view_percentage ?? null,
    },
    platform_reach: performanceSnapshot.platform_reach || {},
    vertical_breakdown: performanceSnapshot.vertical_breakdown || {},
    best_performing_videos: bestPerformingVideos,
    sponsor_safe_examples: sponsorSafeExamples,
    missing_metrics: missingMetrics,
    pricing_recommendations: pricingRecommendations(performanceSnapshot, missingMetrics),
    disclosure_plan: {
      required_labels: ["#ad", "Paid partnership", "Affiliate disclosure where links are present"],
      placement: ["spoken or caption disclosure", "description first lines", "landing page sponsor box"],
      operator_review_required: true,
    },
    sponsorship_formats: SPONSORSHIP_FORMATS,
    unsuitable_until_later: [
      "guaranteed view promises",
      "undisclosed paid endorsements",
      "sponsors that conflict with verified-news credibility",
    ],
    safety: {
      no_sponsor_outreach_sent: true,
      no_public_pricing_quoted: true,
    },
  };
}

function finaliseStory(story = {}, upstream = [], directBlockers = []) {
  const blockers = unique([...upstream, ...directBlockers]);
  return {
    ...story,
    status: blockers.length ? "blocked" : "ready",
    upstream_status: upstream.length ? "blocked" : "ready",
    direct_sponsor_status: directBlockers.length ? "blocked" : "pass",
    blockers,
    upstream_blockers: upstream,
    direct_sponsor_blockers: directBlockers,
    sponsor_safe: directBlockers.length === 0,
    safety: {
      no_sponsor_outreach_sent: true,
      no_external_posting: true,
      no_platform_mutation: true,
    },
  };
}

function blockerCounts(stories = []) {
  const counts = {};
  for (const story of asArray(stories)) {
    for (const blocker of asArray(story.blockers)) counts[blocker] = (counts[blocker] || 0) + 1;
  }
  return counts;
}

function directRiskCounts(stories = []) {
  const counts = {};
  for (const story of asArray(stories)) {
    for (const blocker of asArray(story.direct_sponsor_blockers)) counts[blocker] = (counts[blocker] || 0) + 1;
  }
  return counts;
}

async function buildGoal25SponsorReadinessPack({
  storyPackages = [],
  upstreamCorrectionsReport = {},
  performanceSnapshot = {},
  workspaceRoot = process.cwd(),
  outputDir,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!outputDir) throw new Error("buildGoal25SponsorReadinessPack requires outputDir");
  await fs.ensureDir(path.resolve(outputDir));
  const correctionsIndex = buildGoal24Index(upstreamCorrectionsReport);
  const loadedStories = [];
  for (const storyPackage of asArray(storyPackages)) {
    loadedStories.push(await loadStoryPackage(storyPackage, { workspaceRoot }));
  }
  const missingMetrics = REQUIRED_SPONSOR_METRICS.filter((key) => metricMissing(performanceSnapshot, key));
  const metricBlockers = missingMetrics.length ? ["sponsor:required_metrics_missing"] : [];
  const stories = loadedStories.map((story) => {
    const upstream = upstreamBlockers(story.story_id, correctionsIndex);
    const directBlockers = unique([...brandSafetyBlockers(story), ...metricBlockers]);
    return finaliseStory(story, upstream, directBlockers);
  });

  const readyStories = stories.filter((story) => story.status === "ready");
  const blockedStories = stories.filter((story) => story.status === "blocked");
  const directPassStories = stories.filter((story) => story.direct_sponsor_status === "pass");
  const directBlockedStories = stories.filter((story) => story.direct_sponsor_status === "blocked");
  const upstreamBlockedStories = stories.filter((story) => story.upstream_status === "blocked");
  const directSponsorVerdict = !stories.length
    ? "FAIL"
    : directBlockedStories.length && directPassStories.length
      ? "PARTIAL"
      : directBlockedStories.length
        ? "BLOCKED"
        : "PASS";
  const verdict = !stories.length
    ? "FAIL"
    : blockedStories.length && readyStories.length
      ? "PARTIAL"
      : blockedStories.length
        ? "BLOCKED"
        : "PASS";

  const sponsorMediaKit = buildSponsorMediaKit({
    stories,
    performanceSnapshot,
    missingMetrics,
    readyForOutreach: verdict === "PASS" && directSponsorVerdict === "PASS",
  });
  const report = {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    verdict,
    direct_sponsor_verdict: directSponsorVerdict,
    summary: {
      story_count: stories.length,
      sponsor_ready_story_count: readyStories.length,
      blocked_story_count: blockedStories.length,
      direct_sponsor_pass_story_count: directPassStories.length,
      direct_sponsor_blocked_story_count: directBlockedStories.length,
      upstream_blocked_story_count: upstreamBlockedStories.length,
      sponsor_safe_example_count: sponsorMediaKit.sponsor_safe_examples.length,
      missing_metric_count: missingMetrics.length,
      publish_now_count: 0,
    },
    required_sponsor_metrics: REQUIRED_SPONSOR_METRICS,
    missing_metrics: missingMetrics,
    blocker_counts: blockerCounts(stories),
    direct_risk_counts: directRiskCounts(stories),
    upstream_blockers: {
      goal24_corrections_retractions_takedowns:
        "Goal 25 can compile sponsor-readiness drafts, but sponsor outreach requires Goal 24 and earlier campaign gates to pass first.",
      note:
        "This gate emits LOCAL_PROOF files only. It does not contact sponsors, quote public pricing, post externally, mutate production rows or change OAuth/token state.",
    },
    stories,
    sponsor_media_kit: sponsorMediaKit,
    safety: {
      local_proof_only: true,
      dry_run_publish_only: true,
      no_sponsor_outreach_sent: true,
      no_external_posting: true,
      no_platform_mutation: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_public_pricing_quoted: true,
      no_gate_weakened: true,
    },
  };
  report.brand_safety_report = buildBrandSafetyReport(report);
  report.sponsor_pitch_pack = buildSponsorPitchPack(report);
  return report;
}

function renderSponsorPitchPackMarkdown(report = {}) {
  const kit = report.sponsor_media_kit || {};
  const pitch = report.sponsor_pitch_pack || {};
  const lines = [];
  lines.push("# Pulse Gaming Sponsor Pitch Pack");
  lines.push("");
  lines.push(`Status: ${pitch.status || "blocked"}`);
  lines.push("Outreach sent: false");
  lines.push("");
  lines.push("## Channel");
  lines.push("Pulse Gaming covers sourced gaming news in short-form formats, with public corrections and disclosure rules built into the workflow.");
  lines.push("");
  lines.push("## Audience");
  lines.push(`Core audience: ${kit.audience_summary?.core || "not verified"}`);
  lines.push(`Subscribers: ${kit.public_metrics?.subscribers ?? "not verified"}`);
  lines.push(`90-day Shorts views: ${kit.public_metrics?.shorts_views_90d ?? "not verified"}`);
  lines.push(`Average views: ${kit.average_views ?? "not verified"}`);
  lines.push("");
  lines.push("## Sponsor-Safe Examples");
  if (asArray(kit.sponsor_safe_examples).length) {
    for (const example of kit.sponsor_safe_examples) {
      lines.push(`- ${example.title} (${example.vertical})`);
    }
  } else {
    lines.push("- No sponsor-safe examples are ready for outreach yet.");
  }
  lines.push("");
  lines.push("## Formats");
  for (const format of SPONSORSHIP_FORMATS) lines.push(`- ${format}`);
  lines.push("");
  lines.push("## Pricing");
  if (kit.pricing_recommendations?.ranges?.length) {
    for (const item of kit.pricing_recommendations.ranges) {
      lines.push(`- ${item.format}: ${kit.pricing_recommendations.currency}${item.floor}-${item.ceiling}, draft only`);
    }
  } else {
    lines.push("- Pricing is blocked until sponsor metrics are verified.");
  }
  lines.push("");
  lines.push("## Disclosure");
  for (const label of asArray(kit.disclosure_plan?.required_labels)) lines.push(`- ${label}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("- No sponsor outreach was sent.");
  lines.push("- No public pricing was quoted.");
  lines.push("- Operator review is required before any sponsor conversation.");
  return `${lines.join("\n")}\n`;
}

function renderGoal25SponsorReadinessMarkdown(report = {}) {
  const lines = [];
  lines.push("# Goal 25 - Sponsor Readiness Pack");
  lines.push("");
  lines.push(`Verdict: ${report.verdict || "UNKNOWN"}`);
  lines.push(`Direct sponsor verdict: ${report.direct_sponsor_verdict || "UNKNOWN"}`);
  lines.push(`Mode: ${report.mode || "LOCAL_PROOF"}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(`- Stories checked: ${report.summary?.story_count ?? 0}`);
  lines.push(`- Ready stories: ${report.summary?.sponsor_ready_story_count ?? 0}`);
  lines.push(`- Blocked stories: ${report.summary?.blocked_story_count ?? 0}`);
  lines.push(`- Upstream-blocked stories: ${report.summary?.upstream_blocked_story_count ?? 0}`);
  lines.push(`- Direct sponsor pass stories: ${report.summary?.direct_sponsor_pass_story_count ?? 0}`);
  lines.push(`- Direct sponsor blocked stories: ${report.summary?.direct_sponsor_blocked_story_count ?? 0}`);
  lines.push(`- Sponsor-safe examples: ${report.summary?.sponsor_safe_example_count ?? 0}`);
  lines.push(`- Missing metrics: ${report.summary?.missing_metric_count ?? 0}`);
  lines.push(`- Publish-now actions: ${report.summary?.publish_now_count ?? 0}`);
  lines.push("");
  lines.push("## Direct Blockers");
  const directBlockers = Object.keys(report.direct_risk_counts || {});
  if (directBlockers.length) {
    for (const blocker of directBlockers) lines.push(`- ${blocker}: ${report.direct_risk_counts[blocker]}`);
  } else {
    lines.push("- None.");
  }
  lines.push("");
  lines.push("## Missing Metrics");
  if (asArray(report.missing_metrics).length) {
    for (const metric of report.missing_metrics) lines.push(`- ${metric}`);
  } else {
    lines.push("- None.");
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("- LOCAL_PROOF only.");
  lines.push("- No sponsor outreach, public pricing, platform mutation, production DB mutation or external posting occurred.");
  return `${lines.join("\n")}\n`;
}

async function writeGoal25SponsorReadinessPack(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoal25SponsorReadinessPack requires outputDir");
  await fs.ensureDir(outputDir);
  const paths = {
    readinessJson: path.join(outputDir, "goal25_readiness_report.json"),
    readinessMarkdown: path.join(outputDir, "goal25_readiness_report.md"),
    sponsorMediaKit: path.join(outputDir, "sponsor_media_kit.json"),
    sponsorPitchPack: path.join(outputDir, "sponsor_pitch_pack.md"),
    brandSafetyReport: path.join(outputDir, "brand_safety_report.json"),
  };
  await fs.writeJson(paths.readinessJson, report, { spaces: 2 });
  await fs.outputFile(paths.readinessMarkdown, renderGoal25SponsorReadinessMarkdown(report));
  await fs.writeJson(paths.sponsorMediaKit, report.sponsor_media_kit || {}, { spaces: 2 });
  await fs.outputFile(paths.sponsorPitchPack, renderSponsorPitchPackMarkdown(report));
  await fs.writeJson(paths.brandSafetyReport, report.brand_safety_report || {}, { spaces: 2 });
  return paths;
}

module.exports = {
  GOAL_ID,
  REQUIRED_SPONSOR_METRICS,
  SPONSORSHIP_FORMATS,
  buildGoal25SponsorReadinessPack,
  renderGoal25SponsorReadinessMarkdown,
  renderSponsorPitchPackMarkdown,
  writeGoal25SponsorReadinessPack,
};
