"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  buildCommercialLearningDigest,
  loadCommercialManifests,
  readCommercialClickLog,
} = require("./intelligence/commercial-learning-loop");

const DEFAULT_COMMERCIAL_MANIFEST_DIRS = [path.join(process.cwd(), "output", "commercial")];
const DEFAULT_REVENUE_OUTPUT_DIR = path.join(process.cwd(), "output", "revenue");
const DEFAULT_CLICK_LOG_PATH = path.join(process.cwd(), "data", "commercial_clicks.jsonl");

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function slugify(value, fallback = "story") {
  const slug = cleanText(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96)
    .replace(/-+$/g, "");
  return slug || fallback;
}

function safeFilename(value, fallback = "story") {
  return slugify(value, fallback).replace(/[^a-z0-9_-]/g, "");
}

function score(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function storyIndex(stories = []) {
  const out = new Map();
  for (const story of asArray(stories)) {
    if (story?.id) out.set(String(story.id), story);
  }
  return out;
}

function retentionSignalForStory(retentionIntelligenceByStory, storyId) {
  if (!retentionIntelligenceByStory || !storyId) return {};
  if (retentionIntelligenceByStory instanceof Map) {
    return retentionIntelligenceByStory.get(storyId) || {};
  }
  if (Array.isArray(retentionIntelligenceByStory)) {
    return (
      retentionIntelligenceByStory.find(
        (item) => String(item?.story_id || item?.storyId || "") === storyId,
      ) || {}
    );
  }
  if (typeof retentionIntelligenceByStory === "object") {
    if (String(retentionIntelligenceByStory.story_id || "") === storyId) {
      return retentionIntelligenceByStory;
    }
    if (retentionIntelligenceByStory.by_story?.[storyId]) {
      return retentionIntelligenceByStory.by_story[storyId];
    }
    if (retentionIntelligenceByStory[storyId]) return retentionIntelligenceByStory[storyId];
  }
  return {};
}

function learningStory(learningDigest = {}, storyId) {
  return asArray(learningDigest.top_stories).find((item) => item.story_id === storyId) || null;
}

function learningAdjustment(learningDigest = {}, storyId) {
  return asArray(learningDigest.next_render_adjustments).find((item) => item.story_id === storyId) || null;
}

function hasTrackedOffer(link) {
  return Boolean(link?.id && link?.url && link?.tracking_url);
}

function isComplianceSensitive(manifest = {}) {
  return manifest.vertical === "finance" || manifest.vertical === "crypto";
}

function buildAudienceStrategy(manifest = {}) {
  return {
    core_audience: "male_25_44_uk_us_mobile",
    content_posture: "fast gaming intelligence for adults",
    mobile_first: true,
    commercial_fit: manifest.vertical === "gaming" ? "gaming_hardware_and_setup" : manifest.vertical || "unknown",
    preferred_paths: [
      "story page before offer",
      "source links before shopping links",
      "newsletter capture for repeat visits",
      "sponsor route only after retention proof",
    ],
  };
}

function buildPathGate(manifest = {}) {
  const blockers = [];
  const warnings = [];
  const primary = manifest.primary_link || null;

  if (isComplianceSensitive(manifest)) {
    blockers.push("finance_or_crypto_compliance_review_required");
  }
  if (!hasTrackedOffer(primary)) {
    blockers.push("no_tracked_affiliate_offer");
  }
  if (hasTrackedOffer(primary) && !manifest.disclosure_required) {
    blockers.push("missing_affiliate_disclosure");
  }
  if (hasTrackedOffer(primary) && !manifest.landing_page_route) {
    blockers.push("missing_story_landing_page");
  }
  if (hasTrackedOffer(primary) && !manifest.landing_page_attribution) {
    blockers.push("missing_landing_page_attribution");
  }
  if (manifest.landing_page_attribution?.verdict === "fail") {
    blockers.push(
      ...asArray(manifest.landing_page_attribution.rejection_reasons).map(
        (reason) => `landing_page_attribution:${reason}`,
      ),
    );
  }
  for (const reason of asArray(manifest.rejection_reasons)) {
    if (/compliance|crypto|financial/i.test(reason)) blockers.push(reason);
    else warnings.push(reason);
  }

  let verdict = "pass";
  if (isComplianceSensitive(manifest)) verdict = "blocked_for_compliance";
  else if (blockers.length > 0) verdict = "review";

  return {
    verdict,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
  };
}

function stage(stageName, label, route, action, gate = "pass") {
  return {
    stage: stageName,
    label,
    route: route || null,
    action,
    gate,
  };
}

function buildPrimaryPath({ manifest, gate }) {
  const stages = [
    stage(
      "short",
      "Editorial Short",
      null,
      "Use the Short to sell the story, not the product.",
    ),
    stage(
      "story_page",
      "Story page",
      manifest.landing_page_route,
      "Put source links, disclosure and useful context in one clean place.",
      manifest.landing_page_route ? "pass" : "review",
    ),
  ];

  if (hasTrackedOffer(manifest.primary_link) && gate.verdict === "pass") {
    stages.push(
      stage(
        "tracked_offer",
        "Tracked offer",
        manifest.primary_link.tracking_url,
        "Use the story-matched offer after the source context.",
      ),
    );
  }

  stages.push(
    stage(
      "newsletter_capture",
      "Newsletter",
      manifest.landing_page_route,
      "Invite viewers who want gaming stories behind the headline.",
    ),
  );

  if (hasTrackedOffer(manifest.primary_link) && gate.verdict === "pass") {
    stages.push(
      stage(
        "evergreen_guide",
        "Evergreen guide",
        `/guides/${slugify(manifest.product_category || manifest.commercial_intent_type || manifest.story_id)}`,
        "Turn repeated demand into a useful buying or setup guide.",
      ),
    );
  }

  stages.push(
    stage(
      "sponsor_readiness",
      "Sponsor readiness",
      null,
      "Keep this as a future route until retention and audience metrics justify outreach.",
      "future",
    ),
  );

  let pathType = "editorial_short_to_story_page_to_newsletter";
  if (gate.verdict === "blocked_for_compliance") {
    pathType = "editorial_short_to_source_notes_only";
  } else if (hasTrackedOffer(manifest.primary_link) && gate.verdict === "pass") {
    pathType = "editorial_short_to_story_page_to_tracked_offer";
  }

  return {
    path_type: pathType,
    stages,
  };
}

function buildOfferStack(manifest = {}) {
  return {
    primary_offer: hasTrackedOffer(manifest.primary_link) ? manifest.primary_link : null,
    fallback_offers: asArray(manifest.fallback_links).filter(hasTrackedOffer),
    rejected_candidates: asArray(manifest.candidate_links)
      .filter((link) => asArray(link.rejection_reasons).length > 0)
      .map((link) => ({
        id: link.id,
        label: link.label,
        product_category: link.product_category || link.category || null,
        rejection_reasons: asArray(link.rejection_reasons),
      })),
  };
}

function pathScore({ manifest, gate, learning }) {
  if (gate.verdict === "blocked_for_compliance") return 0;
  const commercial = Math.max(
    score(manifest.commercial_opportunity_score),
    score(manifest.revenue_score),
    score(manifest.primary_link?.affiliate_score),
  );
  const disclosure = manifest.disclosure_required ? 8 : 0;
  const landing = manifest.landing_page_route ? 8 : -10;
  const lift =
    learning?.commercial_angle_lift === "positive"
      ? 10
      : learning?.commercial_angle_lift === "early_signal"
        ? 4
        : learning?.commercial_angle_lift === "weak"
          ? -10
          : 0;
  const gatePenalty = gate.verdict === "review" ? 22 : 0;
  return Math.max(0, Math.min(100, Math.round(commercial * 0.78 + disclosure + landing + lift - gatePenalty)));
}

function numericOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildRetentionCommercialPolicy(retentionIntelligence = {}) {
  const reasons = [];
  const channelStatus = retentionIntelligence.channel_pressure?.status || null;
  const hookScore = numericOrNull(retentionIntelligence.hook?.score);
  const visualPacingScore = numericOrNull(retentionIntelligence.visual_pacing?.score);

  if (channelStatus === "retention_baseline_under_target") {
    reasons.push("channel_retention_under_target");
  }
  if (retentionIntelligence.verdict === "needs_render_adjustment") {
    reasons.push("retention_intelligence_needs_render_adjustment");
  }
  if (hookScore !== null && hookScore < 75) reasons.push("hook_score_below_75");
  if (visualPacingScore !== null && visualPacingScore < 75) {
    reasons.push("visual_pacing_score_below_75");
  }

  const retentionFirst = reasons.length > 0;
  return {
    status: retentionFirst ? "retention_first" : "normal",
    short_commercial_posture: retentionFirst ? "editorial_only" : "source_first_soft_cta",
    story_page_offer_position: retentionFirst ? "below_sources" : "after_sources",
    revenue_score_penalty: retentionFirst ? 8 : 0,
    reasons: [...new Set(reasons)],
    evidence: {
      channel_status: channelStatus,
      hook_score: hookScore,
      visual_pacing_score: visualPacingScore,
      stayed_to_watch: retentionIntelligence.channel_pressure?.baseline?.stayed_to_watch ?? null,
      swiped_away: retentionIntelligence.channel_pressure?.baseline?.swiped_away ?? null,
      avg_watch_seconds_estimate:
        retentionIntelligence.channel_pressure?.baseline?.avg_watch_seconds_estimate ?? null,
    },
  };
}

function platformCtas(manifest = {}, gate = {}) {
  if (gate.verdict === "blocked_for_compliance") {
    if (manifest.vertical === "crypto") {
      return {
        youtube: "Sources and risk notes are on the story page. No buy/sell recommendation.",
        tiktok: "Sources and risk notes are on the story page. No buy/sell recommendation.",
        instagram: "Sources and risk notes are on the story page. No buy/sell recommendation.",
        facebook: "Sources and risk notes are on the story page. No buy/sell recommendation.",
        x: "Sources and risk notes are on the story page. No buy/sell recommendation.",
      };
    }
    return {
      youtube: "Sources and further reading are linked. This is not financial advice.",
      tiktok: "Sources and further reading are linked. This is not financial advice.",
      instagram: "Sources and further reading are linked. This is not financial advice.",
      facebook: "Sources and further reading are linked. This is not financial advice.",
      x: "Sources and further reading are linked. This is not financial advice.",
    };
  }

  if (gate.verdict !== "pass") {
    return {
      youtube: "The story page has sources and context.",
      tiktok: "The story page has sources and context.",
      instagram: "The story page has sources and context.",
      facebook: "The story page has sources and context.",
      x: "Sources and context are on the story page.",
    };
  }

  return {
    youtube: "Sources, editions and setup checks are on the story page.",
    tiktok: "Sources and related setup links are on the story page.",
    instagram: "Sources and related setup links are on the story page.",
    facebook: "Story page has the sources and useful setup checks.",
    x: "Sources and setup checks are on the story page.",
  };
}

function buildLearningSignal({ learningDigest, manifest, storyId }) {
  const storyLearning = learningStory(learningDigest, storyId);
  const adjustment = learningAdjustment(learningDigest, storyId);
  const rawPromptAdjustment =
    adjustment?.prompt_adjustment ||
    (hasTrackedOffer(manifest.primary_link)
      ? `Keep the ${manifest.primary_link.product_category || "setup"} angle on the story page, but keep the Short editorial.`
      : "Keep the CTA source-first until the story has a natural commercial angle.");
  const promptAdjustment =
    hasTrackedOffer(manifest.primary_link) && !/\bsetup\b/i.test(rawPromptAdjustment)
      ? `${rawPromptAdjustment} Frame it as a setup check, not a sales pitch.`
      : rawPromptAdjustment;
  return {
    commercial_angle_lift: storyLearning?.commercial_angle_lift || "unknown",
    affiliate_click_rate: storyLearning?.affiliate_click_rate ?? null,
    clicks: storyLearning?.clicks || 0,
    top_offer: storyLearning?.top_offer || null,
    source: storyLearning ? "commercial_learning_loop" : "not_enough_click_data",
    prompt_adjustment: promptAdjustment,
  };
}

function buildNextRenderAdjustments({ manifest, gate, learningSignal, retentionPolicy }) {
  if (retentionPolicy?.status === "retention_first") {
    return [
      {
        type: "retention_first_commercial_posture",
        priority: "high",
        prompt_adjustment:
          "Keep the Short editorial and source-led. Keep the commercial path on the story page below sources until retention improves.",
        landing_page_cta: "Show sources first, then the best related setup link.",
      },
    ];
  }
  if (gate.verdict === "blocked_for_compliance") {
    return [
      {
        type: "compliance_first_cta",
        priority: "high",
        prompt_adjustment: "Use sources and risk notes only. Do not add product or trading CTAs.",
      },
    ];
  }
  if (gate.verdict !== "pass") {
    return [
      {
        type: "source_first_story_page",
        priority: "normal",
        prompt_adjustment: "Keep the story page source-first and avoid offer links until the angle is natural.",
      },
    ];
  }
  return [
    {
      type: "story_matched_offer",
      priority: learningSignal.commercial_angle_lift === "positive" ? "high" : "normal",
      prompt_adjustment: learningSignal.prompt_adjustment,
      landing_page_cta:
        learningSignal.commercial_angle_lift === "positive"
          ? "Put the best related setup link above secondary offers."
          : "Lead with sources, then show the best related setup link.",
    },
  ];
}

function buildRevenuePathManifest({
  story = {},
  commercialManifest = {},
  learningDigest = {},
  retentionIntelligence = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const storyId = String(story.id || commercialManifest.story_id || slugify(story.title || "story"));
  const gate = buildPathGate(commercialManifest);
  const primaryPath = buildPrimaryPath({ manifest: commercialManifest, gate });
  const learningSignal = buildLearningSignal({ learningDigest, manifest: commercialManifest, storyId });
  const retentionPolicy = buildRetentionCommercialPolicy(retentionIntelligence);
  const rawRevenueScore = pathScore({ manifest: commercialManifest, gate, learning: learningSignal });
  const revenueScore = Math.max(0, rawRevenueScore - retentionPolicy.revenue_score_penalty);
  const offerStack = buildOfferStack(commercialManifest);

  return {
    schema_version: 2,
    engine: "revenue_path_engine_v2",
    generated_at: generatedAt,
    story_id: storyId,
    title: cleanText(story.title || commercialManifest.short_title || commercialManifest.story_entities?.[0] || storyId),
    vertical: commercialManifest.vertical || "unknown",
    commercial_intent_type: commercialManifest.commercial_intent_type || "unknown",
    audience_strategy: buildAudienceStrategy(commercialManifest),
    primary_path: primaryPath,
    secondary_paths: [
      {
        path_type: "editorial_short_to_newsletter",
        route: commercialManifest.landing_page_route || null,
        use_when: "Offer fit is weak or compliance review is needed.",
      },
      {
        path_type: "evergreen_buying_guide",
        route: hasTrackedOffer(commercialManifest.primary_link)
          ? `/guides/${slugify(commercialManifest.product_category || commercialManifest.commercial_intent_type)}`
          : null,
        use_when: "The same product class keeps appearing across stories.",
      },
    ],
    offer_stack: offerStack,
    disclosure: {
      required: Boolean(commercialManifest.disclosure_required),
      copy: commercialManifest.disclosure_copy || null,
      platform: commercialManifest.platform_disclosure || {},
    },
    platform_ctas: platformCtas(commercialManifest, gate),
    landing_page: {
      route: commercialManifest.landing_page_route || null,
      slug: commercialManifest.landing_page_slug || null,
      source_links: asArray(commercialManifest.source_links),
      newsletter: {
        enabled: true,
        copy: "Follow the gaming stories behind the headline.",
      },
    },
    tracking: {
      utm: commercialManifest.tracking_utm || null,
      primary_offer_tracking_url: offerStack.primary_offer?.tracking_url || null,
      landing_page_attribution: commercialManifest.landing_page_attribution || null,
      platforms: commercialManifest.landing_page_attribution?.platforms || {},
    },
    learning_signal: learningSignal,
    retention_commercial_policy: retentionPolicy,
    next_render_adjustments: buildNextRenderAdjustments({
      manifest: commercialManifest,
      gate,
      learningSignal,
      retentionPolicy,
    }),
    path_gate: gate,
    revenue_path_score: revenueScore,
    revenue_projection: null,
    safety: {
      no_fantasy_revenue_projection: true,
      no_random_affiliate_links: true,
      story_decides_offer: true,
      disclosure_required_before_offer: true,
      no_live_account_changes: true,
      no_social_posting_triggered: true,
    },
  };
}

async function writeRevenuePathManifest(
  manifest,
  { outputDir = DEFAULT_REVENUE_OUTPUT_DIR } = {},
) {
  await fs.ensureDir(outputDir);
  const outPath = path.join(
    outputDir,
    `${safeFilename(manifest.story_id || manifest.title)}_revenue_path_manifest.json`,
  );
  await fs.writeJson(outPath, manifest, { spaces: 2 });
  return { path: outPath, manifest };
}

async function loadRevenuePathManifests(dirs = [DEFAULT_REVENUE_OUTPUT_DIR]) {
  const manifests = [];
  for (const dir of asArray(dirs)) {
    let files = [];
    try {
      files = (await fs.readdir(dir)).filter((file) =>
        /_revenue_path_manifest\.json$/i.test(file),
      );
    } catch (err) {
      if (err && err.code === "ENOENT") continue;
      throw err;
    }
    for (const file of files) {
      try {
        manifests.push(await fs.readJson(path.join(dir, file)));
      } catch {
        // Skip corrupt operator artefacts and keep the API available.
      }
    }
  }
  return manifests;
}

function buildRevenuePathDigest({
  generatedAt = new Date().toISOString(),
  revenueManifests = [],
  commercialManifests = [],
  learningDigest = {},
  stories = [],
} = {}) {
  const byStory = storyIndex(stories);
  const paths = asArray(revenueManifests).length
    ? asArray(revenueManifests)
    : asArray(commercialManifests).map((commercialManifest) =>
        buildRevenuePathManifest({
          story: byStory.get(String(commercialManifest.story_id)) || {},
          commercialManifest,
          learningDigest,
          generatedAt,
        }),
      );
  const pass = paths.filter((item) => item.path_gate?.verdict === "pass").length;
  const review = paths.filter((item) => item.path_gate?.verdict === "review").length;
  const blocked = paths.filter((item) => item.path_gate?.verdict === "blocked_for_compliance").length;
  const scored = paths.filter((item) => Number.isFinite(Number(item.revenue_path_score)));
  const averageScore = scored.length
    ? Math.round(scored.reduce((sum, item) => sum + Number(item.revenue_path_score || 0), 0) / scored.length)
    : 0;

  return {
    schema_version: 2,
    generated_at: generatedAt,
    status: paths.length ? "revenue_paths_ready" : "waiting_for_commercial_manifests",
    totals: {
      paths: paths.length,
      pass,
      review,
      blocked_for_compliance: blocked,
      average_revenue_path_score: averageScore,
    },
    top_paths: [...paths]
      .sort((a, b) => Number(b.revenue_path_score || 0) - Number(a.revenue_path_score || 0))
      .slice(0, 20)
      .map((item) => ({
        story_id: item.story_id,
        title: item.title,
        verdict: item.path_gate?.verdict || "unknown",
        revenue_path_score: item.revenue_path_score || 0,
        route: item.landing_page?.route || null,
        primary_path_type: item.primary_path?.path_type || "unknown",
        commercial_intent_type: item.commercial_intent_type,
        learning_lift: item.learning_signal?.commercial_angle_lift || "unknown",
        primary_offer: item.offer_stack?.primary_offer
          ? {
              label: item.offer_stack.primary_offer.label,
              product_category: item.offer_stack.primary_offer.product_category,
              tracking_url: item.offer_stack.primary_offer.tracking_url,
            }
          : null,
        blockers: item.path_gate?.blockers || [],
      })),
    recommendations: buildDigestRecommendations(paths),
    safety: {
      no_story_rows_mutated: true,
      no_social_posting_triggered: true,
      no_fantasy_revenue_projection: true,
      no_live_account_changes: true,
      recommendations_only: true,
    },
  };
}

function buildDigestRecommendations(paths = []) {
  if (!paths.length) {
    return [
      {
        type: "build_commercial_manifests",
        priority: "high",
        text: "Run the affiliate/commercial pass before scoring revenue paths.",
      },
    ];
  }
  const out = [];
  const passCount = paths.filter((item) => item.path_gate?.verdict === "pass").length;
  const reviewCount = paths.filter((item) => item.path_gate?.verdict === "review").length;
  const blockedCount = paths.filter((item) => item.path_gate?.verdict === "blocked_for_compliance").length;
  if (passCount > 0) {
    out.push({
      type: "publish_story_page_ctas",
      priority: "high",
      text: "Use source-first story page CTAs for passed paths. Keep the Short editorial.",
    });
  }
  if (reviewCount > 0) {
    out.push({
      type: "fix_review_paths",
      priority: "normal",
      text: "Review paths need a natural offer, a landing page or a cleaner disclosure before offers move up the page.",
    });
  }
  if (blockedCount > 0) {
    out.push({
      type: "compliance_hold",
      priority: "high",
      text: "Finance and crypto paths stay source-only until a compliance review clears them.",
    });
  }
  return out;
}

function renderRevenuePathDigestMarkdown(digest = {}) {
  const lines = [];
  lines.push("# Revenue Path Engine v2");
  lines.push("");
  lines.push(`Generated: ${digest.generated_at || ""}`);
  lines.push(`Status: ${digest.status || "unknown"}`);
  lines.push(`Paths: ${digest.totals?.paths || 0}`);
  lines.push(`Passed: ${digest.totals?.pass || 0}`);
  lines.push(`Review: ${digest.totals?.review || 0}`);
  lines.push(`Compliance blocked: ${digest.totals?.blocked_for_compliance || 0}`);
  lines.push(`Average score: ${digest.totals?.average_revenue_path_score || 0}`);
  lines.push("");
  lines.push("## Top paths");
  if (!asArray(digest.top_paths).length) {
    lines.push("- No revenue paths built yet.");
  } else {
    for (const item of asArray(digest.top_paths).slice(0, 10)) {
      lines.push(
        `- ${item.title}: ${item.verdict}, score ${item.revenue_path_score}, route ${item.route || "none"}`,
      );
    }
  }
  lines.push("");
  lines.push("## Recommendations");
  for (const rec of asArray(digest.recommendations)) {
    lines.push(`- [${rec.priority || "normal"}] ${rec.text}`);
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("- No fantasy revenue projection.");
  lines.push("- No story rows were mutated.");
  lines.push("- No social posting was triggered.");
  return `${lines.join("\n")}\n`;
}

async function runRevenuePathEngine({
  generatedAt = new Date().toISOString(),
  commercialManifestDirs = DEFAULT_COMMERCIAL_MANIFEST_DIRS,
  clickLogPath = DEFAULT_CLICK_LOG_PATH,
  outputDir = DEFAULT_REVENUE_OUTPUT_DIR,
  stories = [],
  learningDigest = null,
  retentionIntelligenceByStory = {},
} = {}) {
  const commercialManifests = await loadCommercialManifests(commercialManifestDirs);
  const clickLog = learningDigest ? { entries: [] } : await readCommercialClickLog(clickLogPath);
  const resolvedLearning =
    learningDigest ||
    buildCommercialLearningDigest({
      generatedAt,
      clicks: clickLog.entries,
      manifests: commercialManifests,
      stories,
    });
  const byStory = storyIndex(stories);
  const revenueManifests = commercialManifests.map((commercialManifest) =>
    buildRevenuePathManifest({
      story: byStory.get(String(commercialManifest.story_id)) || {},
      commercialManifest,
      learningDigest: resolvedLearning,
      retentionIntelligence: retentionSignalForStory(
        retentionIntelligenceByStory,
        String(commercialManifest.story_id),
      ),
      generatedAt,
    }),
  );

  await fs.ensureDir(outputDir);
  const writes = [];
  for (const manifest of revenueManifests) {
    writes.push(await writeRevenuePathManifest(manifest, { outputDir }));
  }
  const digest = buildRevenuePathDigest({
    generatedAt,
    revenueManifests,
    stories,
    learningDigest: resolvedLearning,
  });
  const jsonPath = path.join(outputDir, "revenue-paths.json");
  const mdPath = path.join(outputDir, "revenue-paths.md");
  await fs.writeJson(jsonPath, digest, { spaces: 2 });
  await fs.writeFile(mdPath, renderRevenuePathDigestMarkdown(digest), "utf8");

  return {
    digest,
    manifests: revenueManifests,
    writes,
    artefacts: { jsonPath, mdPath },
    safety: digest.safety,
  };
}

module.exports = {
  DEFAULT_CLICK_LOG_PATH,
  DEFAULT_COMMERCIAL_MANIFEST_DIRS,
  DEFAULT_REVENUE_OUTPUT_DIR,
  buildRevenuePathDigest,
  buildRevenuePathManifest,
  loadRevenuePathManifests,
  renderRevenuePathDigestMarkdown,
  runRevenuePathEngine,
  writeRevenuePathManifest,
};
