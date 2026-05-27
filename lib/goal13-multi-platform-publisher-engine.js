"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const GOAL_ID = "13_multi_platform_publisher_engine";

const REQUIRED_PLATFORMS = [
  "youtube_shorts",
  "tiktok",
  "instagram_reels",
  "facebook_reels",
  "x",
  "threads",
  "pinterest",
];

const PLATFORM_ATTRIBUTION_KEYS = {
  youtube_shorts: "youtube",
  tiktok: "tiktok",
  instagram_reels: "instagram",
  facebook_reels: "facebook",
  x: "x",
  threads: "threads",
  pinterest: "pinterest",
};

const PLATFORM_REQUIREMENTS = {
  youtube_shorts: [
    "title",
    "description",
    "cover_frame",
    "captions",
    "profile_or_landing_page_cta",
  ],
  tiktok: [
    "conversational_hook",
    "caption",
    "hashtags",
    "disclosure_flag",
    "commercial_content_setting_recommendation",
  ],
  instagram_reels: [
    "cover_frame",
    "caption",
    "carousel_companion",
    "story_poll_idea",
    "bio_link_cta",
  ],
  facebook_reels: [
    "explanatory_framing",
    "page_caption",
    "link_routing_strategy",
  ],
  x: [
    "hot_take_post",
    "source_safe_post",
    "thread_posts",
    "poll_candidate",
    "landing_page_link",
  ],
  threads: [
    "discussion_post",
    "duplicate_x_wording_allowed",
    "tone",
    "landing_page_link",
  ],
  pinterest: [
    "pin_title",
    "pin_description",
    "evergreen_only",
    "disclosure",
    "landing_page_link",
  ],
};

const LANDING_LINK_REQUIRED_PLATFORMS = new Set(["x", "threads", "pinterest"]);

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
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

function storyIdFromPackage(storyPackage = {}) {
  return cleanText(storyPackage.story_id || storyPackage.id || storyPackage.storyId);
}

function valueAtPath(object = {}, dottedPath = "") {
  return cleanText(dottedPath)
    .split(".")
    .filter(Boolean)
    .reduce((current, key) => (current && typeof current === "object" ? current[key] : undefined), object);
}

function hasMeaningfulValue(value) {
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return cleanText(value).length > 0;
}

function normaliseCopy(value = "") {
  return cleanText(value)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\/p\/[a-z0-9_-]+(?:\?\S+)?/gi, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collectStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, out);
  }
  return out;
}

function platformCopyForDuplicate(platform, output = {}) {
  if (platform === "youtube_shorts") return [output.title, output.description].map(cleanText).filter(Boolean).join(" ");
  if (platform === "tiktok") return [output.conversational_hook, output.caption].map(cleanText).filter(Boolean).join(" ");
  if (platform === "instagram_reels") return cleanText(output.caption || output.cover_frame?.headline);
  if (platform === "facebook_reels") return cleanText(output.page_caption || output.explanatory_framing);
  if (platform === "x") {
    return [output.hot_take_post, output.source_safe_post, ...asArray(output.thread_posts)]
      .map(cleanText)
      .filter(Boolean)
      .join(" ");
  }
  if (platform === "threads") return cleanText(output.discussion_post);
  if (platform === "pinterest") return [output.pin_title, output.pin_description].map(cleanText).filter(Boolean).join(" ");
  return collectStrings(output).join(" ");
}

function buildExperimentIndex(upstreamExperimentReport = {}) {
  const index = new Map();
  for (const row of asArray(upstreamExperimentReport.stories || upstreamExperimentReport.rows)) {
    const storyId = cleanText(row.story_id || row.id);
    if (storyId) index.set(storyId, row);
  }
  return index;
}

function upstreamBlockers(storyId, experimentIndex = new Map()) {
  const row = experimentIndex.get(cleanText(storyId));
  if (!row) return ["upstream:goal12_experimentation_engine_missing"];
  const status = cleanText(row.status || row.verdict).toLowerCase();
  if (["ready", "pass", "passed", "green"].includes(status)) return [];
  return unique([
    "upstream:goal12_experimentation_engine_blocked",
    ...asArray(row.blockers),
  ]);
}

function platformOutputs(platformManifest = {}) {
  return platformManifest.outputs || platformManifest.platform_outputs || {};
}

function genericTitleDetected({ canonical = {}, platformManifest = {}, storyPackage = {} } = {}) {
  const outputs = platformOutputs(platformManifest);
  const publicTitles = [
    canonical.selected_title,
    canonical.short_title,
    canonical.canonical_title,
    canonical.title,
    storyPackage.title,
    outputs.youtube_shorts?.title,
    outputs.pinterest?.pin_title,
  ].map(cleanText).filter(Boolean);
  const candidates = publicTitles.length ? publicTitles : [canonical.canonical_subject].map(cleanText).filter(Boolean);
  if (!candidates.length) return true;
  return candidates.some((title) => {
    const lower = title.toLowerCase();
    return (
      lower.length < 8 ||
      /^(?:this\s+)?(?:gaming\s+)?story(?:\s+update)?$/i.test(title) ||
      /\b(?:this gaming story|source locked update|untitled|placeholder|generic title|story headline)\b/i.test(title)
    );
  });
}

function affiliateDisclosureRequired({ affiliateManifest = {}, landingPage = {}, platformManifest = {} } = {}) {
  if (affiliateManifest.disclosure_required === true) return true;
  if (affiliateManifest.primary_link || affiliateManifest.primaryLink) return true;
  if (landingPage.disclosure_block?.required === true) return true;
  const outputsText = JSON.stringify(platformOutputs(platformManifest) || {});
  return /affiliate|commercial_content_disclosure_required|commission/i.test(outputsText);
}

function platformDisclosureSatisfied(platform, output = {}, landingPage = {}) {
  const attributionKey = PLATFORM_ATTRIBUTION_KEYS[platform];
  const attribution = landingPage.attribution_manifest?.platforms?.[attributionKey] || {};
  if (cleanText(attribution.disclosure_copy) || attribution.disclosure_required === true) return true;
  if (platform === "tiktok") {
    return /disclosure|required/i.test(cleanText(output.disclosure_flag)) ||
      /required/i.test(cleanText(output.commercial_content_setting_recommendation));
  }
  if (platform === "pinterest") return cleanText(output.disclosure).length > 0 || output.affiliate_disclosure_required === true;
  const disclosureStatus = output.disclosure_status || output.disclosureStatus || {};
  return Boolean(disclosureStatus.required === true && cleanText(disclosureStatus.caption || disclosureStatus.copy));
}

function landingPageRoute(landingPage = {}) {
  return cleanText(landingPage.landing_page_route || landingPage.route || landingPage.landing_page_url);
}

function outputLandingLink(platform, output = {}) {
  if (platform === "x") return cleanText(output.landing_page_link);
  if (platform === "threads") return cleanText(output.landing_page_link);
  if (platform === "pinterest") return cleanText(output.landing_page_link);
  if (platform === "instagram_reels") return cleanText(output.bio_link_cta);
  if (platform === "youtube_shorts") return cleanText(output.profile_or_landing_page_cta || output.description);
  if (platform === "facebook_reels") return cleanText(output.link_routing_strategy || output.page_caption);
  return "";
}

function landingRouteSatisfied(platform, output = {}, landingPage = {}) {
  const route = landingPageRoute(landingPage);
  if (!route) return false;
  if (!LANDING_LINK_REQUIRED_PLATFORMS.has(platform)) return true;
  return /\/p\//i.test(outputLandingLink(platform, output));
}

function trackingSatisfied(platform, landingPage = {}) {
  const attributionKey = PLATFORM_ATTRIBUTION_KEYS[platform];
  const attribution = landingPage.attribution_manifest?.platforms?.[attributionKey] || {};
  const trackingKey = cleanText(attribution.tracking_key || attribution.trackingKey);
  const url = cleanText(attribution.landing_page_url || attribution.url);
  return Boolean(trackingKey && /utm_source=/i.test(url));
}

function affiliateLinkRelated(affiliateManifest = {}) {
  const verdict = cleanText(
    affiliateManifest.relevance_verdict ||
      affiliateManifest.relevance_status ||
      affiliateManifest.relevance ||
      affiliateManifest.primary_link?.relevance_verdict,
  ).toLowerCase();
  if (["unrelated", "fail", "failed", "blocked", "mismatch"].includes(verdict)) return false;
  const score = Number(affiliateManifest.relevance_score ?? affiliateManifest.primary_link?.relevance_score);
  if (Number.isFinite(score) && score < 0.5) return false;
  return true;
}

function policyPasses(platformPolicyReport = {}) {
  const status = cleanText(
    platformPolicyReport.status ||
      platformPolicyReport.verdict ||
      platformPolicyReport.result ||
      platformPolicyReport.overall_verdict,
  ).toLowerCase();
  if (["fail", "failed", "red", "blocked", "high_risk"].includes(status)) return false;
  const highRisk = asArray(platformPolicyReport.risks || platformPolicyReport.findings).some((risk) => {
    const severity = cleanText(risk.severity || risk.risk || risk.level).toLowerCase();
    return ["high", "critical", "red", "blocked"].includes(severity);
  });
  return !highRisk;
}

function blindDuplicatePairs(outputs = {}, evidence = {}) {
  const pairs = [];
  for (const pair of asArray(evidence.blind_duplicate_pairs || evidence.duplicate_pairs)) {
    if (Array.isArray(pair) && pair.length >= 2) pairs.push([cleanText(pair[0]), cleanText(pair[1])]);
    else if (pair && typeof pair === "object") pairs.push([cleanText(pair.left || pair.a), cleanText(pair.right || pair.b)]);
  }
  const fingerprints = new Map();
  for (const platform of REQUIRED_PLATFORMS) {
    const text = normaliseCopy(JSON.stringify(outputs[platform] || {}));
    if (text.length < 18) continue;
    const previous = fingerprints.get(text);
    if (previous && !(platform === "threads" && outputs.threads?.duplicate_x_wording_allowed === true)) {
      pairs.push([previous, platform]);
    } else {
      fingerprints.set(text, platform);
    }
  }
  const xText = normaliseCopy(outputs.x?.source_safe_post || outputs.x?.hot_take_post);
  const threadsText = normaliseCopy(outputs.threads?.discussion_post);
  if (xText && threadsText && xText === threadsText && outputs.threads?.duplicate_x_wording_allowed !== true) {
    pairs.push(["x", "threads"]);
  }
  return pairs.filter(([left, right]) => left && right);
}

function hashtagCount(output = {}) {
  return collectStrings(output).join(" ").match(/#[\p{L}\p{N}_]+/gu)?.length || 0;
}

function pushRisk(risks, storyId, platform, category, detail) {
  risks.push({
    story_id: storyId,
    platform: platform || null,
    category,
    severity: "hard_fail",
    detail: detail || category,
  });
}

async function inspectStoryPackage(storyPackage = {}, context = {}) {
  const storyId = storyIdFromPackage(storyPackage);
  const artifactDir = resolveWorkspacePath(context.workspaceRoot, storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir);
  const canonical = await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {});
  const platformManifest = await readJsonIfPresent(path.join(artifactDir, "platform_publish_manifest.json"), {});
  const affiliateManifest = await readJsonIfPresent(path.join(artifactDir, "affiliate_link_manifest.json"), {});
  const landingPage = await readJsonIfPresent(path.join(artifactDir, "landing_page_manifest.json"), {});
  const platformPolicyReport = await readJsonIfPresent(path.join(artifactDir, "platform_policy_report.json"), {});
  const outputs = platformOutputs(platformManifest);
  const upstream = upstreamBlockers(storyId, context.experimentIndex);
  const directBlockers = [];
  const risks = [];

  function addBlocker(blocker) {
    if (!directBlockers.includes(blocker)) directBlockers.push(blocker);
  }

  const platformRows = REQUIRED_PLATFORMS.map((platform) => {
    const output = outputs[platform] || null;
    const missingFields = [];
    if (!output) {
      addBlocker("platform:missing_output");
      pushRisk(risks, storyId, platform, "platform:missing_output", "Required platform-native package is missing.");
    } else {
      for (const field of PLATFORM_REQUIREMENTS[platform] || []) {
        if (!hasMeaningfulValue(valueAtPath(output, field))) missingFields.push(field);
      }
      if (missingFields.length) {
        addBlocker("platform:missing_native_field");
        pushRisk(
          risks,
          storyId,
          platform,
          "platform:missing_native_field",
          `Missing native fields: ${missingFields.join(", ")}`,
        );
      }
    }
    return {
      platform,
      present: Boolean(output),
      required_fields: PLATFORM_REQUIREMENTS[platform] || [],
      missing_fields: missingFields,
    };
  });

  const duplicatePairs = blindDuplicatePairs(outputs, platformManifest.platform_native_evidence || {});
  if (duplicatePairs.length || cleanText(platformManifest.platform_native_evidence?.verdict).toLowerCase() === "fail") {
    addBlocker("platform:blind_duplicate");
    addBlocker("platform:anti_spam_risk");
    pushRisk(risks, storyId, null, "platform:blind_duplicate", "Platform copy is duplicated or native evidence failed.");
    pushRisk(risks, storyId, null, "platform:anti_spam_risk", "Duplicate platform copy creates anti-spam risk.");
  }

  const disclosureRequired = affiliateDisclosureRequired({ affiliateManifest, landingPage, platformManifest });
  if (disclosureRequired) {
    for (const platform of REQUIRED_PLATFORMS) {
      const output = outputs[platform] || {};
      if (!platformDisclosureSatisfied(platform, output, landingPage)) {
        addBlocker("platform:missing_disclosure");
        pushRisk(risks, storyId, platform, "platform:missing_disclosure", "Affiliate or commercial disclosure is required but missing.");
      }
    }
  }

  if (genericTitleDetected({ canonical, platformManifest, storyPackage })) {
    addBlocker("platform:generic_title");
    pushRisk(risks, storyId, null, "platform:generic_title", "Public title or subject is generic or placeholder-like.");
  }

  if (!affiliateLinkRelated(affiliateManifest)) {
    addBlocker("platform:unrelated_affiliate_link");
    pushRisk(risks, storyId, null, "platform:unrelated_affiliate_link", "Affiliate link relevance evidence is failing.");
  }

  if (!policyPasses(platformPolicyReport)) {
    addBlocker("platform:policy_risk");
    pushRisk(risks, storyId, null, "platform:policy_risk", "Platform policy report is failing or high risk.");
  }

  for (const platform of REQUIRED_PLATFORMS) {
    if (!trackingSatisfied(platform, landingPage)) {
      addBlocker("platform:missing_tracking");
      pushRisk(risks, storyId, platform, "platform:missing_tracking", "Landing-page attribution tracking is missing.");
    }
    if (!landingRouteSatisfied(platform, outputs[platform] || {}, landingPage)) {
      addBlocker("platform:missing_landing_page");
      pushRisk(risks, storyId, platform, "platform:missing_landing_page", "Required landing-page route is missing.");
    }
    if (hashtagCount(outputs[platform] || {}) > 8) {
      addBlocker("platform:anti_spam_risk");
      pushRisk(risks, storyId, platform, "platform:anti_spam_risk", "Hashtag volume is above the anti-spam threshold.");
    }
  }

  const blockers = unique([...upstream, ...directBlockers]);
  const directPass = directBlockers.length === 0;
  const status = blockers.length ? "blocked" : "ready";
  return {
    story_id: storyId,
    title: cleanText(canonical.selected_title || canonical.canonical_title || canonical.title || storyPackage.title),
    artifact_dir: artifactDir,
    status,
    direct_platform_status: directPass ? "pass" : "blocked",
    upstream_status: upstream.length ? "blocked" : "ready",
    blockers,
    upstream_blockers: upstream,
    direct_platform_blockers: directBlockers,
    risks,
    platform_rows: platformRows,
    platform_outputs: Object.fromEntries(REQUIRED_PLATFORMS.map((platform) => [platform, outputs[platform] || null])),
    platform_native_evidence: platformManifest.platform_native_evidence || null,
    duplicate_pairs: duplicatePairs,
    disclosure_required: disclosureRequired,
    landing_page_route: landingPageRoute(landingPage),
    safety: {
      no_publish_triggered: true,
      no_platform_uploads: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_values_exposed: true,
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

function actionStatus(story = {}) {
  if (asArray(story.upstream_blockers).length) return "blocked_by_upstream";
  if (asArray(story.direct_platform_blockers).length) return "blocked_by_platform_gate";
  return "dry_run_ready_for_operator_review";
}

function buildPlatformPublishManifest(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "DRY_RUN_PUBLISH",
    operating_mode: "DRY_RUN_PUBLISH",
    required_platforms: REQUIRED_PLATFORMS,
    summary: report.summary || {},
    stories: asArray(report.stories).map((story) => ({
      story_id: story.story_id,
      artifact_dir: story.artifact_dir,
      status: story.status,
      direct_platform_status: story.direct_platform_status,
      upstream_status: story.upstream_status,
      blockers: story.blockers,
      platform_outputs: story.platform_outputs,
      platform_plan: REQUIRED_PLATFORMS.map((platform) => ({
        platform,
        status: actionStatus(story),
        mode: "DRY_RUN_PUBLISH",
        no_publish_triggered: true,
        no_external_posting: true,
      })),
    })),
    safety: {
      dry_run_publish_only: true,
      no_publish_triggered: true,
      no_platform_uploads: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function buildPlatformVariantScorecard(report = {}) {
  const platformSummary = Object.fromEntries(REQUIRED_PLATFORMS.map((platform) => {
    const rows = asArray(report.stories).map((story) => story.platform_rows.find((row) => row.platform === platform));
    return [platform, {
      platform,
      story_count: rows.length,
      present_count: rows.filter((row) => row?.present).length,
      missing_output_count: rows.filter((row) => !row?.present).length,
      missing_native_field_count: rows.filter((row) => asArray(row?.missing_fields).length > 0).length,
      direct_pass_count: asArray(report.stories).filter((story) =>
        story.direct_platform_status === "pass" && story.platform_outputs[platform],
      ).length,
    }];
  }));
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "DRY_RUN_PUBLISH",
    required_platforms: REQUIRED_PLATFORMS,
    direct_platform_verdict: report.direct_platform_verdict || "UNKNOWN",
    platforms: platformSummary,
    stories: asArray(report.stories).map((story) => ({
      story_id: story.story_id,
      status: story.direct_platform_status,
      duplicate_pairs: story.duplicate_pairs,
      platform_rows: story.platform_rows,
      blockers: story.direct_platform_blockers,
    })),
  };
}

function buildScheduledPosts(report = {}) {
  const posts = asArray(report.stories).flatMap((story) =>
    REQUIRED_PLATFORMS.map((platform) => ({
      story_id: story.story_id,
      platform,
      status: actionStatus(story),
      scheduled_for: null,
      action: "dry_run_only_no_external_post",
      blockers: story.blockers,
      no_publish_triggered: true,
      no_external_posting: true,
    })),
  );
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "DRY_RUN_PUBLISH",
    publish_now_count: 0,
    planned_post_count: posts.length,
    blocked_post_count: posts.filter((post) => post.status !== "dry_run_ready_for_operator_review").length,
    ready_for_operator_review_count: posts.filter((post) => post.status === "dry_run_ready_for_operator_review").length,
    posts,
    safety: {
      no_publish_triggered: true,
      no_platform_uploads: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function buildPlatformRiskReport(report = {}) {
  const risks = asArray(report.stories).flatMap((story) => asArray(story.risks));
  const categoryCounts = {};
  for (const risk of risks) categoryCounts[risk.category] = (categoryCounts[risk.category] || 0) + 1;
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    verdict: risks.length ? "fail" : "pass",
    hard_fail_categories: [
      "platform:blind_duplicate",
      "platform:missing_disclosure",
      "platform:generic_title",
      "platform:unrelated_affiliate_link",
      "platform:policy_risk",
      "platform:anti_spam_risk",
      "platform:missing_tracking",
      "platform:missing_landing_page",
    ],
    category_counts: categoryCounts,
    risks,
  };
}

function buildAnalyticsIngestPlan(report = {}) {
  const metrics = {
    youtube_shorts: ["views", "impressions", "average_view_duration_seconds", "retention_curve", "subscribers_gained", "likes", "comments", "shares"],
    tiktok: ["views", "average_watch_time", "watched_full_video_rate", "likes", "comments", "shares", "profile_visits"],
    instagram_reels: ["plays", "reach", "watch_time", "likes", "comments", "shares", "saves", "follows"],
    facebook_reels: ["plays", "reach", "average_watch_time", "likes", "comments", "shares"],
    x: ["impressions", "video_views", "engagements", "link_clicks", "reposts", "likes", "replies"],
    threads: ["views", "likes", "replies", "reposts", "link_clicks"],
    pinterest: ["impressions", "saves", "outbound_clicks", "pin_clicks", "engagements"],
  };
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "READ_ONLY_AFTER_DRY_RUN",
    status: "blocked_until_publish_and_upstream_ready",
    reason:
      "Analytics ingestion requires public post identifiers from human-approved publishing. This goal only prepares the read-only metric plan.",
    platforms: Object.fromEntries(REQUIRED_PLATFORMS.map((platform) => [
      platform,
      {
        platform,
        required_metrics: metrics[platform],
        public_post_id_required: true,
        ingestion_method: "read_only_platform_analytics_after_operator_publish",
      },
    ])),
    safety: {
      no_analytics_api_calls: true,
      no_token_read_or_write: true,
      no_db_mutation: true,
    },
  };
}

async function buildGoal13MultiPlatformPublisherEngine({
  storyPackages = [],
  upstreamExperimentReport = {},
  workspaceRoot = process.cwd(),
  outputDir,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!outputDir) throw new Error("buildGoal13MultiPlatformPublisherEngine requires outputDir");
  await fs.ensureDir(path.resolve(outputDir));
  const experimentIndex = buildExperimentIndex(upstreamExperimentReport);
  const stories = [];
  for (const storyPackage of asArray(storyPackages)) {
    stories.push(await inspectStoryPackage(storyPackage, { workspaceRoot, experimentIndex }));
  }
  const readyStories = stories.filter((story) => story.status === "ready");
  const blockedStories = stories.filter((story) => story.status === "blocked");
  const directPassStories = stories.filter((story) => story.direct_platform_status === "pass");
  const directBlockedStories = stories.filter((story) => story.direct_platform_status !== "pass");
  const allOutputsPresentStories = stories.filter((story) =>
    REQUIRED_PLATFORMS.every((platform) => Boolean(story.platform_outputs[platform])),
  );
  const verdict = !stories.length
    ? "FAIL"
    : blockedStories.length && readyStories.length
      ? "PARTIAL"
      : blockedStories.length
        ? "BLOCKED"
        : "PASS";
  const directPlatformVerdict = !stories.length
    ? "FAIL"
    : directBlockedStories.length && directPassStories.length
      ? "PARTIAL"
      : directBlockedStories.length
        ? "BLOCKED"
        : "PASS";
  const report = {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    mode: "DRY_RUN_PUBLISH",
    verdict,
    direct_platform_verdict: directPlatformVerdict,
    summary: {
      story_count: stories.length,
      platform_ready_story_count: readyStories.length,
      blocked_story_count: blockedStories.length,
      platform_package_plan_story_count: allOutputsPresentStories.length,
      direct_platform_pass_story_count: directPassStories.length,
      direct_platform_blocked_story_count: directBlockedStories.length,
      required_platform_count: REQUIRED_PLATFORMS.length,
      planned_dry_run_post_count: stories.length * REQUIRED_PLATFORMS.length,
      publish_now_count: 0,
    },
    required_platforms: REQUIRED_PLATFORMS,
    blocker_counts: blockerCounts(stories),
    upstream_blockers: {
      goal12_experimentation_engine:
        "Goal 13 can prepare platform-native dry-run packages, but scheduler or publish readiness requires Goal 12 to be ready first.",
      note:
        "This gate does not publish, upload, post externally, mutate production rows, inspect secrets or change OAuth/token state.",
    },
    stories,
    safety: {
      dry_run_publish_only: true,
      no_publish_triggered: true,
      no_platform_uploads: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_values_exposed: true,
      no_gate_weakened: true,
    },
  };
  report.platform_publish_manifest = buildPlatformPublishManifest(report);
  report.platform_variant_scorecard = buildPlatformVariantScorecard(report);
  report.scheduled_posts = buildScheduledPosts(report);
  report.platform_risk_report = buildPlatformRiskReport(report);
  report.analytics_ingest_plan = buildAnalyticsIngestPlan(report);
  return report;
}

function renderGoal13MultiPlatformPublisherEngineMarkdown(report = {}) {
  const lines = [];
  lines.push("# Goal 13 Multi-Platform Publisher Engine");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Verdict: ${report.verdict || "UNKNOWN"}`);
  lines.push(`Direct platform verdict: ${report.direct_platform_verdict || "UNKNOWN"}`);
  lines.push(`Stories checked: ${report.summary?.story_count || 0}`);
  lines.push(`Full platform-ready stories: ${report.summary?.platform_ready_story_count || 0}`);
  lines.push(`Direct platform-pass stories: ${report.summary?.direct_platform_pass_story_count || 0}`);
  lines.push(`Dry-run package plan stories: ${report.summary?.platform_package_plan_story_count || 0}`);
  lines.push(`Planned dry-run posts: ${report.summary?.planned_dry_run_post_count || 0}`);
  lines.push(`Publish-now actions: ${report.summary?.publish_now_count || 0}`);
  lines.push("");
  lines.push("## Blockers");
  const blockers = Object.keys(report.blocker_counts || {}).sort();
  if (!blockers.length) lines.push("- none");
  for (const blocker of blockers) lines.push(`- ${blocker}: ${report.blocker_counts[blocker]}`);
  lines.push("");
  lines.push("## Platforms");
  for (const platform of REQUIRED_PLATFORMS) lines.push(`- ${platform}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("DRY_RUN_PUBLISH only. This run did not publish, upload, post externally, mutate the database, touch OAuth or token files, inspect secrets or weaken gates.");
  return `${lines.join("\n")}\n`;
}

async function writeGoal13MultiPlatformPublisherEngine(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoal13MultiPlatformPublisherEngine requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const readinessJson = path.join(outDir, "goal13_readiness_report.json");
  const readinessMarkdown = path.join(outDir, "goal13_readiness_report.md");
  const platformPublishManifest = path.join(outDir, "platform_publish_manifest.json");
  const platformVariantScorecard = path.join(outDir, "platform_variant_scorecard.json");
  const scheduledPosts = path.join(outDir, "scheduled_posts.json");
  const platformRiskReport = path.join(outDir, "platform_risk_report.json");
  const analyticsIngestPlan = path.join(outDir, "analytics_ingest_plan.json");
  await fs.writeJson(readinessJson, report, { spaces: 2 });
  await fs.writeFile(readinessMarkdown, renderGoal13MultiPlatformPublisherEngineMarkdown(report), "utf8");
  await fs.writeJson(platformPublishManifest, report.platform_publish_manifest || buildPlatformPublishManifest(report), { spaces: 2 });
  await fs.writeJson(platformVariantScorecard, report.platform_variant_scorecard || buildPlatformVariantScorecard(report), { spaces: 2 });
  await fs.writeJson(scheduledPosts, report.scheduled_posts || buildScheduledPosts(report), { spaces: 2 });
  await fs.writeJson(platformRiskReport, report.platform_risk_report || buildPlatformRiskReport(report), { spaces: 2 });
  await fs.writeJson(analyticsIngestPlan, report.analytics_ingest_plan || buildAnalyticsIngestPlan(report), { spaces: 2 });
  return {
    readinessJson,
    readinessMarkdown,
    platformPublishManifest,
    platformVariantScorecard,
    scheduledPosts,
    platformRiskReport,
    analyticsIngestPlan,
  };
}

module.exports = {
  GOAL_ID,
  REQUIRED_PLATFORMS,
  PLATFORM_REQUIREMENTS,
  buildAnalyticsIngestPlan,
  buildGoal13MultiPlatformPublisherEngine,
  buildPlatformPublishManifest,
  buildPlatformRiskReport,
  buildPlatformVariantScorecard,
  buildScheduledPosts,
  inspectStoryPackage,
  renderGoal13MultiPlatformPublisherEngineMarkdown,
  writeGoal13MultiPlatformPublisherEngine,
};
