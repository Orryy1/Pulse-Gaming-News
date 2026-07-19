"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");

const {
  buildAffiliateLinkManifest,
  writeAffiliateLinkManifest,
} = require("../commercial-intelligence-engine");
const {
  runCommercialLearningLoop,
} = require("./commercial-learning-loop");
const {
  runRevenuePathEngine,
} = require("../revenue-path-engine");
const {
  PRIMARY_COST_EVIDENCE_BY_TYPE,
  PRIMARY_EVIDENCE_BY_STAGE,
} = require("../weekly-commercial-scorecard");

const PLATFORM_EVIDENCE_SOURCES = Object.freeze({
  youtube: Object.freeze({
    receivable: "YouTube Studio revenue export or Google AdSense earnings statement",
    cash: "Google AdSense or YouTube payout statement plus the matching bank or payment settlement",
  }),
  instagram_reel: Object.freeze({
    receivable: "Meta Business Suite earnings export covering Instagram Reels",
    cash: "Meta payout statement plus the matching bank or payment settlement",
  }),
  facebook_reel: Object.freeze({
    receivable: "Meta Business Suite earnings export covering Facebook Reels",
    cash: "Meta payout statement plus the matching bank or payment settlement",
  }),
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function utcDate(value) {
  const match = clean(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateText(date) {
  return date.toISOString().slice(0, 10);
}

function publishedWeekCohort(publishedAt) {
  const date = utcDate(publishedAt);
  if (!date) return "unassigned";
  const day = date.getUTCDay() || 7;
  const start = new Date(date);
  start.setUTCDate(date.getUTCDate() - day + 1);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return `${dateText(start)}/${dateText(end)}`;
}

function workOrderId(...parts) {
  return parts
    .map((part) => clean(part).replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, ""))
    .filter(Boolean)
    .join(":");
}

function platformEvidenceSource(platform, kind) {
  return PLATFORM_EVIDENCE_SOURCES[platform]?.[kind] ||
    (kind === "cash"
      ? "Primary platform payout statement plus the matching bank or payment settlement"
      : "Primary platform earnings statement exported by the platform");
}

function revenueWorkOrder({
  storyId,
  platform,
  cohortId,
  externalId,
  stage,
} = {}) {
  const acceptedEvidenceTypes = PRIMARY_EVIDENCE_BY_STAGE[stage] || [];
  const cashReceived = stage === "cash_received";
  return {
    id: workOrderId("revenue", storyId, platform, cohortId, stage),
    status: "operator_evidence_required",
    scope: {
      story_id: storyId,
      platform,
      cohort_id: cohortId,
      external_id: externalId || null,
    },
    accounting_target: {
      entry_kind: "revenue",
      stage,
      revenue_type: "variable",
    },
    required_primary_evidence: {
      accepted_evidence_types: acceptedEvidenceTypes,
      source: platformEvidenceSource(platform, cashReceived ? "cash" : "receivable"),
    },
    operator_action: cashReceived
      ? `Materialise the primary payout and settlement evidence for ${platform} in cohort ${cohortId}. Add one cash_received revenue ledger entry scoped to story ${storyId}, platform ${platform} and cohort ${cohortId} only when the evidence supports that allocation; leave the amount unavailable otherwise and never count a shared settlement twice.`
      : `Export and materialise the primary ${platform} earnings statement for cohort ${cohortId}. Add one platform_receivable revenue ledger entry scoped to story ${storyId}, platform ${platform} and cohort ${cohortId}; leave the amount unavailable unless the primary statement supports that attribution.`,
    non_fabrication_rule:
      "Do not infer an amount from views, RPM assumptions, projections or secondary analytics.",
  };
}

function costWorkOrder({
  storyId,
  cohortId,
  costType,
} = {}) {
  const directProduction = costType === "direct_production";
  return {
    id: workOrderId("cost", storyId, cohortId, costType),
    status: "operator_evidence_required",
    scope: {
      story_id: storyId,
      platform: null,
      cohort_id: cohortId,
      external_id: null,
    },
    accounting_target: {
      entry_kind: "cost",
      cost_type: costType,
    },
    required_primary_evidence: {
      accepted_evidence_types: PRIMARY_COST_EVIDENCE_BY_TYPE[costType] || [],
      source: directProduction
        ? "Provider invoice or usage statement for attributable TTS, rendering, media, storage and hosting costs"
        : "Operator time log with a documented replacement-cost basis or a contractor quote",
    },
    operator_action: directProduction
      ? `Materialise provider billing or usage evidence and its allocation basis for story ${storyId} in cohort ${cohortId}. Add one direct_production cost ledger entry only when both the source document and allocation support it. Do not enter a value from a price list or estimate.`
      : `Materialise the operator time log and replacement-cost basis for story ${storyId} in cohort ${cohortId}. Add one labour_replacement cost ledger entry only when the evidence supports it. Do not enter a value from an undocumented estimate.`,
    non_fabrication_rule:
      "Keep the cost unavailable until materialised primary evidence supports the amount and allocation.",
  };
}

function buildStoryEvidenceWorkOrders(storyId, rowsByPlatform = new Map()) {
  const workOrders = [];
  const cohorts = new Set();
  for (const [platform, row] of [...rowsByPlatform.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const cohortId = publishedWeekCohort(row.published_at);
    cohorts.add(cohortId);
    for (const stage of ["platform_receivable", "cash_received"]) {
      workOrders.push(revenueWorkOrder({
        storyId,
        platform,
        cohortId,
        externalId: clean(row.external_id),
        stage,
      }));
    }
  }
  for (const cohortId of [...cohorts].sort()) {
    for (const costType of ["direct_production", "labour_replacement"]) {
      workOrders.push(costWorkOrder({
        storyId,
        cohortId,
        costType,
      }));
    }
  }
  return workOrders;
}

function publishedRows(platformPosts = []) {
  return asArray(platformPosts).filter(
    (row) =>
      clean(row?.story_id) &&
      clean(row?.platform) &&
      clean(row?.status).toLowerCase() === "published" &&
      clean(row?.external_id),
  );
}

function groupPublishedRows(platformPosts = []) {
  const grouped = new Map();
  for (const row of publishedRows(platformPosts)) {
    const storyId = clean(row.story_id);
    const platform = clean(row.platform).toLowerCase();
    const current = grouped.get(storyId) || new Map();
    const previous = current.get(platform);
    if (!previous || clean(row.published_at) >= clean(previous.published_at)) {
      current.set(platform, row);
    }
    grouped.set(storyId, current);
  }
  return grouped;
}

function enrichStory(story = {}, rowsByPlatform = new Map()) {
  const enriched = { ...story };
  const youtube = rowsByPlatform.get("youtube");
  const instagram = rowsByPlatform.get("instagram_reel");
  const facebook = rowsByPlatform.get("facebook_reel");

  if (youtube) {
    enriched.youtube_post_id = clean(youtube.external_id);
    enriched.youtube_url = clean(youtube.external_url) || null;
    enriched.youtube_views = Number(youtube.views) || 0;
    enriched.youtube_likes = Number(youtube.likes) || 0;
    enriched.youtube_comments = Number(youtube.comments) || 0;
  }
  if (instagram) {
    enriched.instagram_media_id = clean(instagram.external_id);
    enriched.instagram_views = Number(instagram.views) || 0;
    enriched.instagram_likes = Number(instagram.likes) || 0;
    enriched.instagram_comments = Number(instagram.comments) || 0;
  }
  if (facebook) {
    enriched.facebook_post_id = clean(facebook.external_id);
    enriched.facebook_views = Number(facebook.views) || 0;
    enriched.facebook_likes = Number(facebook.likes) || 0;
    enriched.facebook_comments = Number(facebook.comments) || 0;
  }
  return enriched;
}

function platformEvidence(rowsByPlatform = new Map()) {
  return Object.fromEntries(
    [...rowsByPlatform.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([platform, row]) => [
        platform,
        {
          external_id: clean(row.external_id),
          external_url: clean(row.external_url) || null,
          published_at: clean(row.published_at) || null,
          stats_fetched_at: clean(row.stats_fetched_at) || null,
          metrics: {
            views: Number(row.views) || 0,
            likes: Number(row.likes) || 0,
            comments: Number(row.comments) || 0,
            shares: Number(row.shares) || 0,
          },
        },
      ]),
  );
}

function renderMarkdown(report = {}) {
  const lines = [
    "# Published Commercial Reconciliation",
    "",
    `Generated: ${report.generated_at || "unknown"}`,
    `Verdict: ${report.verdict || "unknown"}`,
    `Published stories: ${report.totals?.published_stories || 0}`,
    `Commercially traced: ${report.totals?.traced_stories || 0}`,
    `Realised revenue: GBP ${Number(report.financial_actuals?.realised_revenue_gbp || 0).toFixed(2)}`,
    "",
    "## Diagnosis",
    `- ${report.diagnosis?.root_cause || "No diagnosis recorded."}`,
    "",
    "## Story traces",
  ];
  for (const story of asArray(report.stories)) {
    lines.push(
      `- ${story.title || story.story_id}: ${story.trace_status}; platforms ${story.published_platforms.join(", ") || "none"}`,
    );
    for (const blocker of asArray(story.external_evidence_blockers)) {
      lines.push(`  - External evidence: ${blocker}`);
    }
  }
  lines.push(
    "",
    "## Evidence action queue",
    `- Status: ${report.evidence_action_queue?.status || "not_generated"}`,
    `- Open work orders: ${report.evidence_action_queue?.open_work_order_count || 0}`,
  );
  for (const workOrder of asArray(report.evidence_action_queue?.work_orders)) {
    const target = workOrder.accounting_target?.stage ||
      workOrder.accounting_target?.cost_type ||
      "unknown";
    lines.push(
      `- ${workOrder.scope?.story_id || "unassigned"} / ${workOrder.scope?.platform || "all platforms"} / ${workOrder.scope?.cohort_id || "unassigned"} / ${target}`,
      `  - Required source: ${workOrder.required_primary_evidence?.source || "not specified"}`,
      `  - Operator action: ${workOrder.operator_action || "not specified"}`,
    );
  }
  lines.push(
    "",
    "## Safety",
    "- Read-only publication evidence.",
    "- No production database rows were mutated.",
    "- No external requests or social posts were made.",
    "- Revenue remains zero until primary evidence is supplied.",
  );
  return `${lines.join("\n")}\n`;
}

async function reconcilePublishedCommercialEvidence({
  generatedAt = new Date().toISOString(),
  outputDir,
  affiliateTag = process.env.AMAZON_AFFILIATE_TAG || "placeholder",
  stories = [],
  platformPosts = [],
  clickLogPath = null,
} = {}) {
  if (!outputDir) throw new Error("outputDir is required");

  const resolvedOutputDir = path.resolve(outputDir);
  const commercialDir = path.join(resolvedOutputDir, "commercial");
  const revenueDir = path.join(resolvedOutputDir, "revenue");
  const learningDir = path.join(resolvedOutputDir, "learning");
  const resolvedClickLogPath =
    clickLogPath || path.join(resolvedOutputDir, "commercial_clicks.jsonl");
  const storyIndex = new Map(
    asArray(stories)
      .filter((story) => clean(story?.id || story?.story_id))
      .map((story) => [clean(story.id || story.story_id), story]),
  );
  const groupedRows = groupPublishedRows(platformPosts);
  const tracedStories = [];
  const missingStories = [];

  await fs.ensureDir(resolvedOutputDir);

  for (const [storyId, rowsByPlatform] of [...groupedRows.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const sourceStory = storyIndex.get(storyId);
    if (!sourceStory) {
      missingStories.push({
        story_id: storyId,
        title: storyId,
        trace_status: "blocked_story_record_missing",
        published_platforms: [...rowsByPlatform.keys()].sort(),
        platform_evidence: platformEvidence(rowsByPlatform),
        external_evidence_blockers: ["canonical_story_record_missing"],
      });
      continue;
    }
    const story = enrichStory(sourceStory, rowsByPlatform);
    const manifest = buildAffiliateLinkManifest({
      story,
      tag: affiliateTag,
      generatedAt,
    });
    const written = await writeAffiliateLinkManifest(manifest, {
      outputDir: commercialDir,
    });
    tracedStories.push({
      story,
      rowsByPlatform,
      commercialManifest: manifest,
      commercialPath: written.path,
    });
  }

  const learning = await runCommercialLearningLoop({
    generatedAt,
    clickLogPath: resolvedClickLogPath,
    manifestDirs: [commercialDir],
    outputDir: learningDir,
    stories: tracedStories.map((item) => item.story),
  });
  const revenue = await runRevenuePathEngine({
    generatedAt,
    commercialManifestDirs: [commercialDir],
    clickLogPath: resolvedClickLogPath,
    outputDir: revenueDir,
    stories: tracedStories.map((item) => item.story),
    learningDigest: learning.digest,
  });
  const revenueByStory = new Map(
    revenue.manifests.map((manifest) => [clean(manifest.story_id), manifest]),
  );
  const revenuePathByStory = new Map(
    revenue.writes.map((write) => [clean(write.manifest?.story_id), write.path]),
  );
  const learningByStory = new Map(
    asArray(learning.digest.top_stories).map((item) => [clean(item.story_id), item]),
  );
  const evidenceWorkOrders = [];

  const storyTraces = tracedStories.map((item) => {
    const storyId = clean(item.story.id || item.story.story_id);
    const revenueManifest = revenueByStory.get(storyId);
    const learningStory = learningByStory.get(storyId);
    const evidence = platformEvidence(item.rowsByPlatform);
    const analyticsCollected = Object.values(evidence).some(
      (row) => Boolean(row.stats_fetched_at),
    );
    const clicks = Number(learningStory?.clicks) || 0;
    const blockers = [];
    const storyWorkOrders = buildStoryEvidenceWorkOrders(storyId, item.rowsByPlatform);
    evidenceWorkOrders.push(...storyWorkOrders);
    if (!analyticsCollected) blockers.push("platform_analytics_not_collected");
    if (clicks === 0) blockers.push("commercial_clicks_not_recorded");
    blockers.push("primary_revenue_evidence_missing");
    blockers.push("fully_loaded_cost_evidence_missing");

    return {
      story_id: storyId,
      title: clean(item.story.title) || storyId,
      trace_status: "traced",
      published_platforms: Object.keys(evidence),
      platform_evidence: evidence,
      commercial: {
        manifest_path: item.commercialPath,
        manifest_sha256: sha256File(item.commercialPath),
        intent: item.commercialManifest.commercial_intent_type,
        primary_offer_id: item.commercialManifest.primary_link?.id || null,
      },
      commercial_learning: {
        status: clicks > 0 ? "signal_available" : "waiting_for_click_data",
        clicks,
        affiliate_click_rate: learningStory?.affiliate_click_rate ?? null,
      },
      revenue: {
        manifest_path: revenuePathByStory.get(storyId),
        manifest_sha256: sha256File(revenuePathByStory.get(storyId)),
        path_gate: revenueManifest?.path_gate?.verdict || "unknown",
        actual_gbp: 0,
        projection_gbp: null,
        evidence_status: "waiting_for_primary_revenue_evidence",
      },
      missing_evidence_work_order_ids: storyWorkOrders.map((workOrder) => workOrder.id),
      external_evidence_blockers: blockers,
    };
  });

  const storiesReport = [...storyTraces, ...missingStories];
  const evidenceActionQueue = {
    schema_version: 1,
    report_type: "commercial_evidence_action_queue",
    generated_at: generatedAt,
    status: evidenceWorkOrders.length
      ? "operator_evidence_required"
      : "no_published_story_work_orders",
    open_work_order_count: evidenceWorkOrders.length,
    revenue_work_order_count: evidenceWorkOrders.filter(
      (workOrder) => workOrder.accounting_target.entry_kind === "revenue",
    ).length,
    cost_work_order_count: evidenceWorkOrders.filter(
      (workOrder) => workOrder.accounting_target.entry_kind === "cost",
    ).length,
    amount_policy:
      "Amounts remain zero or unavailable until materialised primary evidence supports recognition and allocation.",
    work_orders: evidenceWorkOrders,
  };
  const report = {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF_READ_ONLY",
    verdict: missingStories.length ? "AMBER" : "GREEN",
    totals: {
      published_stories: groupedRows.size,
      traced_stories: storyTraces.length,
      blocked_stories: missingStories.length,
      commercial_manifests: storyTraces.length,
      revenue_path_manifests: storyTraces.length,
    },
    diagnosis: {
      root_cause:
        "Commercial learning consumed existing affiliate manifests and revenue paths consumed those manifests, but neither operator path discovered newly published platform_posts rows.",
      daily_news_snapshot_is_authoritative_for_publications: false,
      publication_source_of_truth: "read_only_platform_posts_snapshot",
      durable_fix:
        "Reconcile every published external ID with its canonical story before running commercial learning and revenue-path generation.",
    },
    financial_actuals: {
      currency: "GBP",
      realised_revenue_gbp: 0,
      realised_revenue_status: "zero_pending_primary_evidence",
      booked_revenue_gbp: 0,
      cash_received_gbp: 0,
      platform_receivables_gbp: 0,
      recurring_mrr_gbp: 0,
      variable_revenue_gbp: 0,
      direct_production_cost_gbp: null,
      labour_replacement_cost_gbp: null,
      contribution_margin_gbp: null,
      profit_gbp: null,
    },
    evidence_action_queue: evidenceActionQueue,
    stories: storiesReport,
    safety: {
      production_db_mutated: false,
      external_requests_made: false,
      social_posts_created: false,
      credentials_changed: false,
      revenue_fabricated: false,
    },
  };
  const jsonPath = path.join(resolvedOutputDir, "published_commercial_reconciliation.json");
  const markdownPath = path.join(resolvedOutputDir, "published_commercial_reconciliation.md");
  const evidenceActionQueuePath = path.join(
    resolvedOutputDir,
    "commercial_evidence_action_queue.json",
  );
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(markdownPath, renderMarkdown(report), "utf8");
  await fs.writeJson(evidenceActionQueuePath, evidenceActionQueue, { spaces: 2 });

  return {
    report,
    learning,
    revenue,
    artefacts: {
      json_path: jsonPath,
      markdown_path: markdownPath,
      evidence_action_queue_path: evidenceActionQueuePath,
      commercial_dir: commercialDir,
      revenue_dir: revenueDir,
      learning_dir: learningDir,
    },
  };
}

module.exports = {
  enrichStory,
  groupPublishedRows,
  publishedRows,
  reconcilePublishedCommercialEvidence,
  renderMarkdown,
};
