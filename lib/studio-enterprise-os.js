"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  buildSponsorMediaKitDraft,
} = require("./intelligence/monetisation-readiness");

const ENTERPRISE_OS_VERSION = "studio_enterprise_os_v1";

const DEFAULT_REFERENCE_PACKS = [
  "Gaming News Core",
  "Official Publisher Motion",
  "Social-First News",
  "Explainer / Data Graphics",
  "Pacing / Retention / Impact",
  "Premium Visual Texture",
];

const BRAND_SEGMENTS = [
  "The 60-Second Patch",
  "The Game Behind the Headline",
  "The Delisting Watch",
  "Worth Your Wishlist?",
  "Platform War Pulse",
  "Steam Spike Check",
];

const BANNED_PUBLIC_PHRASES = [
  "This gaming story",
  "source backed update",
  "not a blank check",
  "invent extra details",
  "wait-and-see column",
  "like and subscribe",
];

const ENTERPRISE_LAYER_DEFINITIONS = [
  {
    id: "canonical_story_manifest",
    label: "Canonical Story Manifest",
    owner_module: "lib/public-output-manifest.js",
    operator_output: "output/governance/publish_manifest.json",
    gate_backed: true,
  },
  {
    id: "autonomy_control_tower",
    label: "Autonomy Control Tower",
    owner_module: "lib/studio-enterprise-os.js",
    operator_output: "output/enterprise-os/studio_enterprise_os.json",
    gate_backed: true,
  },
  {
    id: "rights_ledger",
    label: "Rights Ledger",
    owner_module: "lib/studio-governance-engine.js",
    operator_output: "output/governance/risk_report.json",
    gate_backed: true,
  },
  {
    id: "platform_policy_engine",
    label: "Platform Policy Engine",
    owner_module: "lib/studio-governance-engine.js",
    operator_output: "output/governance/risk_report.json",
    gate_backed: true,
  },
  {
    id: "anti_spam_uniqueness_engine",
    label: "Anti-Spam and Uniqueness Engine",
    owner_module: "lib/studio-governance-engine.js",
    operator_output: "output/governance/rejection_reasons.json",
    gate_backed: true,
  },
  {
    id: "corrections_takedown_workflow",
    label: "Corrections and Takedown Workflow",
    owner_module: "lib/studio-governance-engine.js",
    operator_output: "output/governance/correction_plan.json",
    gate_backed: true,
  },
  {
    id: "observability_dashboard",
    label: "Observability Dashboard",
    owner_module: "lib/studio-enterprise-os.js",
    operator_output: "output/enterprise-os/studio_enterprise_os.md",
    gate_backed: false,
  },
  {
    id: "versioned_prompt_model_registry",
    label: "Versioned Prompt and Model Registry",
    owner_module: "lib/studio-enterprise-os.js",
    operator_output: "output/enterprise-os/enterprise_layer_registry.json",
    gate_backed: true,
  },
  {
    id: "experimentation_engine",
    label: "Experimentation Engine",
    owner_module: "lib/studio-enterprise-os.js",
    operator_output: "output/enterprise-os/experiment_plan.json",
    gate_backed: false,
  },
  {
    id: "audience_persona_engine",
    label: "Audience Persona Engine",
    owner_module: "lib/studio-enterprise-os.js",
    operator_output: "output/enterprise-os/studio_enterprise_os.json",
    gate_backed: false,
  },
  {
    id: "comment_intelligence",
    label: "Comment Intelligence",
    owner_module: "lib/comments/comment-copilot.js",
    operator_output: "output/comments/comment-digest.json",
    gate_backed: false,
  },
  {
    id: "landing_page_link_hub",
    label: "Landing Page and Link Hub System",
    owner_module: "lib/commercial-intelligence-engine.js",
    operator_output: "output/enterprise-os/landing_page_link_hub.json",
    gate_backed: true,
  },
  {
    id: "revenue_attribution_engine",
    label: "Revenue Attribution Engine",
    owner_module: "lib/revenue-path-engine.js",
    operator_output: "output/enterprise-os/revenue_attribution.json",
    gate_backed: true,
  },
  {
    id: "sponsor_readiness_pack",
    label: "Sponsor Readiness Pack",
    owner_module: "lib/intelligence/monetisation-readiness.js",
    operator_output: "output/enterprise-os/sponsor_readiness_pack.json",
    gate_backed: false,
  },
  {
    id: "multi_platform_format_engine",
    label: "Multi-Platform Format Engine",
    owner_module: "lib/studio-enterprise-os.js",
    operator_output: "output/enterprise-os/multi_platform_format_plan.json",
    gate_backed: true,
  },
  {
    id: "finance_crypto_compliance_firewall",
    label: "Finance and Crypto Compliance Firewall",
    owner_module: "lib/studio-governance-engine.js",
    operator_output: "output/governance/risk_report.json",
    gate_backed: true,
  },
  {
    id: "brand_system_ip_moat",
    label: "Brand System and IP Moat",
    owner_module: "lib/studio-enterprise-os.js",
    operator_output: "output/enterprise-os/studio_enterprise_os.json",
    gate_backed: true,
  },
  {
    id: "story_selection_intelligence",
    label: "Story Selection Intelligence",
    owner_module: "lib/studio-enterprise-os.js",
    operator_output: "output/enterprise-os/story_selection_rankings.json",
    gate_backed: true,
  },
  {
    id: "competitor_gap_engine",
    label: "Competitor Gap Engine",
    owner_module: "lib/studio-enterprise-os.js",
    operator_output: "output/enterprise-os/studio_enterprise_os.json",
    gate_backed: false,
  },
  {
    id: "cost_infrastructure_control",
    label: "Cost and Infrastructure Control",
    owner_module: "lib/studio-enterprise-os.js",
    operator_output: "output/enterprise-os/studio_enterprise_os.json",
    gate_backed: true,
  },
  {
    id: "security_secret_management",
    label: "Security and Secret Management",
    owner_module: "lib/studio-enterprise-os.js",
    operator_output: "output/enterprise-os/security_disaster_recovery_plan.json",
    gate_backed: true,
  },
  {
    id: "disaster_recovery",
    label: "Disaster Recovery",
    owner_module: "lib/studio-enterprise-os.js",
    operator_output: "output/enterprise-os/security_disaster_recovery_plan.json",
    gate_backed: true,
  },
];

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normaliseText(value) {
  return cleanText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function number(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, number(value, min)));
}

function round(value, digits = 2) {
  const n = number(value, 0);
  return Number(n.toFixed(digits));
}

function pct(part, total) {
  const p = number(part);
  const t = number(total);
  return t > 0 ? round((p / t) * 100, 1) : 0;
}

function summaryOf(value = {}) {
  if (value && typeof value === "object" && value.summary) return value.summary;
  return value || {};
}

function extractEntity(story = {}) {
  const text = `${story.title || ""} ${story.full_script || ""}`;
  const known = [
    "Forza Horizon 6",
    "Forza",
    "Mixtape",
    "Steam Deck",
    "Xbox",
    "PlayStation",
    "Nintendo",
    "GTA 6",
    "Grand Theft Auto",
    "Subnautica 2",
    "Vampire Survivors",
  ];
  for (const entity of known) {
    if (new RegExp(`\\b${entity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) {
      return entity;
    }
  }
  const titleWords = cleanText(story.title)
    .split(/\s+/)
    .filter((word) => /^[A-Z0-9]/.test(word))
    .slice(0, 4);
  return titleWords.join(" ") || cleanText(story.id || "story");
}

function visualCount(story = {}) {
  return (
    asArray(story.downloaded_images).length +
    asArray(story.game_images).length +
    asArray(story.video_clips).length +
    asArray(story.motion_clips).length +
    asArray(story.local_motion_clips).length
  );
}

function isGenericTitle(title) {
  return /^(?:this gaming story|gaming news update|new gaming update|gaming story)$/i.test(
    cleanText(title),
  );
}

const FINANCE_CRYPTO_TOPIC_RE =
  /\b(?:crypto|bitcoin|ethereum|blockchain|web3|wallet|stocks?|shares?|shareholder|investors?|investment (?:firm|fund|trust|advice|platform)|trading (?:signal|platform|account)|pension|isa|mortgage|finance|financial advice|financial promotion|exchange listing|token listing)\b/i;
const FINANCE_CRYPTO_PROMO_RE =
  /\b(?:buy now|sell now|hold now|pump|moon|guaranteed returns?|guaranteed profit|risk[-\s]?free|leverage(?:d)?|price prediction|trading signal|exchange referral|referral bonus|100x|will explode|huge upside)\b/i;

function financeCryptoRiskForStory(story = {}) {
  const text = `${story.title || ""} ${story.full_script || ""} ${story.description || ""} ${story.pinned_comment || ""}`;
  const vertical = cleanText(story.vertical || story.channel || story.channel_id).toLowerCase();
  const isFinanceChannel = ["finance", "crypto", "stacked"].includes(vertical);
  const topic = isFinanceChannel || FINANCE_CRYPTO_TOPIC_RE.test(text);
  const promotional = FINANCE_CRYPTO_PROMO_RE.test(text);
  const approved =
    story.compliance_approved === true ||
    story.finance_crypto_compliance_approved === true ||
    story.operator_finance_crypto_approved === true;
  return {
    topic,
    promotional,
    approved,
    blocked: topic && promotional && !approved,
  };
}

function hasFinanceCryptoRisk(stories = []) {
  return asArray(stories).some((story) => financeCryptoRiskForStory(story).blocked);
}

function buildRetentionStatus(retentionBaseline = {}) {
  const targets = retentionBaseline.targets || {};
  const stayed = number(retentionBaseline.stayed_to_watch, null);
  const avgWatch = number(retentionBaseline.avg_watch_seconds_estimate, null);
  const stayedTarget = number(targets.stayed_to_watch_short_term, 45);
  const avgTarget = number(targets.avg_watch_seconds_short_term, 15);
  const blockers = [];
  if (stayed !== null && stayed > 0 && stayed < stayedTarget) blockers.push("retention_below_target");
  if (avgWatch !== null && avgWatch > 0 && avgWatch < avgTarget) blockers.push("average_watch_time_below_target");
  return {
    status: blockers.length ? "under_target" : "on_track",
    blockers,
    evidence: {
      stayed_to_watch: stayed,
      stayed_to_watch_target: stayedTarget,
      swiped_away: retentionBaseline.swiped_away ?? null,
      avg_watch_seconds_estimate: avgWatch,
      avg_watch_seconds_target: avgTarget,
      subscriber_conversion_estimate: retentionBaseline.subscriber_conversion_estimate ?? null,
      mobile_viewer_share: retentionBaseline.mobile_viewer_share ?? null,
    },
  };
}

function buildMotionStatus({ v4SourceDeficit = {}, v4MotionPacks = {} } = {}) {
  const deficit = summaryOf(v4SourceDeficit);
  const packs = summaryOf(v4MotionPacks);
  const blocked = number(packs.blocked || deficit.blocked_stories);
  const licenceRequired = number(deficit.licence_or_operator_required);
  const missing = number(deficit.direct_media_missing);
  const ready = number(packs.ready || deficit.v4_ready_stories || deficit.direct_media_ready);
  const clips = number(packs.clips);
  const blockers = [];
  if (blocked > 0 || licenceRequired > 0 || missing > 0) blockers.push("motion_supply_not_ready");
  if (ready > 0 && clips > 0 && clips / Math.max(1, ready) < 5) blockers.push("motion_clip_depth_low");
  return {
    status: blockers.length ? "not_ready" : "ready",
    blockers,
    evidence: {
      ready_stories: ready,
      blocked_stories: blocked,
      clips,
      licence_or_operator_required: licenceRequired,
      direct_media_missing: missing,
    },
  };
}

function buildSecuritySecretManagement(securitySnapshot = {}) {
  const blockers = [];
  const warnings = [];
  const hardcoded = asArray(securitySnapshot.hardcoded_secret_findings);
  if (securitySnapshot.api_token_present === false) blockers.push("api_token_missing");
  if (hardcoded.length > 0) blockers.push("hardcoded_secret_findings");
  if (number(securitySnapshot.token_rotation_days) > 90) warnings.push("token_rotation_over_90_days");
  if (securitySnapshot.audit_log_enabled === false) warnings.push("audit_log_disabled");
  if (!securitySnapshot.env_separation) warnings.push("environment_separation_unknown");
  const status = blockers.length ? "blocked" : warnings.length ? "review" : "pass";
  return {
    status,
    blockers,
    warnings,
    checks: {
      api_token_present: securitySnapshot.api_token_present ?? null,
      hardcoded_secret_findings: hardcoded.length,
      environment_separation: securitySnapshot.env_separation || "unknown",
      token_rotation_days: securitySnapshot.token_rotation_days ?? null,
      audit_log_enabled: securitySnapshot.audit_log_enabled === true,
      least_privilege_required: true,
      tokens_not_emitted: true,
    },
  };
}

function buildDisasterRecovery(securitySnapshot = {}) {
  return {
    emergency_kill_switch: {
      available: securitySnapshot.emergency_kill_switch === true,
      action: "Stop scheduler, clear pending publish queue and leave render queues intact.",
    },
    rollback_renderer: {
      available: securitySnapshot.rollback_renderer_available === true,
      action: "Return to last known good renderer version before any further publish attempts.",
    },
    workflows: [
      "remove_from_publish_queue",
      "unlist_recommendation",
      "mass_description_update",
      "affiliate_link_disable",
      "source_retraction_mode",
      "rights_takedown_response_log",
    ],
    correction_queue: {
      enabled: true,
      recommendations_only: true,
    },
  };
}

function buildObservabilityDashboard({
  retentionStatus,
  motionStatus,
  revenuePathDigest = {},
  commercialLearningDigest = {},
  commentsDigest = {},
  renderHealthSummary = {},
  securitySecretManagement = {},
  costInfrastructureControl = {},
  goldStandardCoverage = {},
} = {}) {
  const revenueTotals = revenuePathDigest.totals || {};
  const commercialTotals = commercialLearningDigest.totals || {};
  return {
    status: "ready",
    cards: [
      { id: "autonomy_mode", label: "Autonomy mode", value: null, source: "control_tower" },
      { id: "retention", label: "Stayed to watch", value: retentionStatus.evidence.stayed_to_watch, unit: "%" },
      { id: "avg_watch", label: "Average watch", value: retentionStatus.evidence.avg_watch_seconds_estimate, unit: "s" },
      { id: "motion_ready", label: "V4 ready stories", value: motionStatus.evidence.ready_stories },
      { id: "motion_blocked", label: "V4 blocked stories", value: motionStatus.evidence.blocked_stories },
      { id: "revenue_paths", label: "Revenue paths", value: revenueTotals.paths || 0 },
      { id: "commercial_clicks", label: "Commercial clicks", value: commercialTotals.clicks || 0 },
      { id: "comment_review", label: "Comments needing review", value: commentsDigest.decisionCounts?.needs_review || 0 },
      { id: "render_thin_rate", label: "Thin render rate", value: renderHealthSummary.percentages?.thin ?? null, unit: "%" },
      { id: "security", label: "Security", value: securitySecretManagement.status },
      { id: "cost_per_video", label: "Cost per video", value: costInfrastructureControl.cost_per_published_video_gbp, unit: "GBP" },
      { id: "gold_standards", label: "Gold-standard coverage", value: goldStandardCoverage.score, unit: "/100" },
    ],
    tables: [
      "blocked_videos_and_reasons",
      "rights_risk",
      "source_confidence",
      "policy_risk",
      "affiliate_risk",
      "retention_by_video",
      "revenue_per_story",
    ],
  };
}

function buildExperimentationEngine() {
  return {
    status: "active",
    variants: [
      {
        id: "A",
        test: "consequence_first_hook",
        hook_rule: "Open with named subject plus consequence.",
      },
      {
        id: "B",
        test: "shock_or_stat_first_hook",
        hook_rule: "Open with the strongest number, source or proof beat.",
      },
      {
        id: "C",
        test: "named_game_first_hook",
        hook_rule: "Open with the game or company name in the first line.",
      },
      {
        id: "D",
        test: "question_first_hook",
        hook_rule: "Open with a tight question only when the answer arrives fast.",
      },
    ],
    metrics: [
      "stayed_to_watch",
      "average_view_duration",
      "swipe_away",
      "subscriber_conversion",
      "comment_rate",
      "affiliate_click_through",
      "platform_specific_performance",
    ],
    guardrails: [
      "Do not test generic titles.",
      "Keep source, title, thumbnail and first spoken line aligned.",
      "One variable per experiment.",
    ],
  };
}

function buildAudiencePersonaEngine(retentionBaseline = {}) {
  return {
    core_persona: "adult_gaming_intelligence_uk_us_mobile",
    evidence: {
      audience_core: retentionBaseline.audience_core || "male_25_44_uk_us_mobile",
      mobile_viewer_share: retentionBaseline.mobile_viewer_share ?? null,
      male_viewer_share: retentionBaseline.male_viewer_share ?? null,
      age_25_34_share: retentionBaseline.age_25_34_share ?? null,
      age_35_44_share: retentionBaseline.age_35_44_share ?? null,
      uk_viewer_share: retentionBaseline.uk_viewer_share ?? null,
      us_viewer_share: retentionBaseline.us_viewer_share ?? null,
    },
    tone: "fast gaming intelligence for adults who follow platforms, hardware, deals and industry moves",
    avoid: ["child-facing hype cadence", "generic meme framing", "weak subscribe begging"],
    commercial_routes: [
      "controllers",
      "headsets",
      "monitors",
      "keyboards",
      "console accessories",
      "Game Pass and subscription explainers",
      "PC gaming storage",
      "creator tools once tech expands",
    ],
  };
}

function buildCommentIntelligence(commentsDigest = {}) {
  const counts = commentsDigest.categoryCounts || {};
  const actionQueue = [];
  for (const category of ["correction", "useful_criticism", "topic_suggestion"]) {
    const count = number(counts[category]);
    if (count > 0) {
      actionQueue.push({
        category,
        count,
        action:
          category === "correction"
            ? "review_claim_and_prepare_correction_if_needed"
            : category === "useful_criticism"
              ? "feed_audio_caption_visual_feedback_to_next_render"
              : "feed_topic_request_to_story_selection",
      });
    }
  }
  return {
    status: commentsDigest.newCommentCount ? "active" : "waiting_for_comments",
    new_comment_count: commentsDigest.newCommentCount || 0,
    category_counts: counts,
    decision_counts: commentsDigest.decisionCounts || {},
    action_queue: actionQueue,
    useful_viewer_signals: asArray(commentsDigest.usefulViewerSignals).slice(0, 20),
    safety: {
      draft_only: true,
      no_auto_replies_sent: true,
      no_moderation_actions_sent: true,
    },
  };
}

function buildLandingPageLinkHub(revenuePathDigest = {}) {
  const routes = asArray(revenuePathDigest.top_paths)
    .filter((pathRow) => pathRow.route)
    .map((pathRow) => ({
      story_id: pathRow.story_id,
      title: pathRow.title,
      route: pathRow.route,
      required_blocks: [
        "source links",
        "affiliate disclosure",
        "canonical story summary",
        "related offers",
        "newsletter capture",
        "UTM tracking",
        "expired link handling",
      ],
      geo_routing: ["UK", "US"],
      cookie_notice_required_if_tracking_cookies_used: true,
    }));
  return {
    status: routes.length ? "routes_ready" : "waiting_for_revenue_paths",
    routes,
    default_requirements: {
      source_links_first: true,
      affiliate_disclosure_required: true,
      newsletter_capture: true,
      no_hard_sell_in_short: true,
      cookie_and_tracking_review_required: true,
    },
  };
}

function buildRevenueAttribution({ revenuePathDigest = {}, commercialLearningDigest = {}, costSnapshot = {} } = {}) {
  const revenueTotals = revenuePathDigest.totals || {};
  const commercialTotals = commercialLearningDigest.totals || {};
  const revenue = number(costSnapshot.revenue_gbp);
  const views = number(costSnapshot.views);
  const perStory = asArray(revenuePathDigest.top_paths).map((pathRow) => ({
    story_id: pathRow.story_id,
    title: pathRow.title,
    views: null,
    affiliate_clicks:
      asArray(commercialLearningDigest.top_stories).find((item) => item.story_id === pathRow.story_id)?.clicks || 0,
    affiliate_revenue_gbp: null,
    sponsor_revenue_gbp: null,
    revenue_per_1000_views_gbp: null,
    route: pathRow.route || null,
  }));
  const missingSignals = [];
  if (revenue <= 0) missingSignals.push("affiliate_revenue");
  if (!commercialTotals.clicks) missingSignals.push("affiliate_clicks");
  if (!views) missingSignals.push("views");
  return {
    status: perStory.length ? "tracking_ready" : "waiting_for_paths",
    totals: {
      revenue_path_count: revenueTotals.paths || 0,
      commercial_clicks: commercialTotals.clicks || 0,
      revenue_gbp: revenue,
      views,
      revenue_per_1000_views_gbp: views > 0 ? round((revenue / views) * 1000, 2) : null,
    },
    per_story: perStory,
    missing_signals: missingSignals,
    no_fantasy_revenue_projection: true,
  };
}

function buildSponsorReadinessPack({ retentionBaseline = {}, costSnapshot = {} } = {}) {
  const snapshot = {
    subscribers: costSnapshot.subscribers,
    shorts_views_90d: costSnapshot.shorts_views_90d || costSnapshot.views,
    average_view_duration_seconds: retentionBaseline.avg_watch_seconds_estimate,
    average_view_percentage: retentionBaseline.average_view_percentage,
    comments_per_view: costSnapshot.comments_per_view,
  };
  const draft = buildSponsorMediaKitDraft(snapshot);
  return {
    ...draft,
    brand_safety_report: {
      source_safe: true,
      affiliate_disclosure_required: true,
      finance_crypto_requires_separate_review: true,
    },
    pricing_bands: [],
    available_packages: [
      "sponsor-safe Short integration",
      "story page placement",
      "newsletter mention",
      "source-safe product comparison",
    ],
    outreach_status: draft.ready_for_outreach ? "operator_review" : "not_yet",
  };
}

function platformPackText(pack = {}) {
  return cleanText(
    pack.caption ||
      pack.post_text ||
      pack.text ||
      pack.title ||
      pack.cta ||
      pack.pacing ||
      "",
  );
}

function concreteDurationSignature(pack = {}) {
  const duration = pack.duration_seconds;
  if (Number.isFinite(Number(duration))) return String(Number(duration));
  return "";
}

function detectPlatformMirroring(platformPacks = {}) {
  const entries = Object.entries(platformPacks || {}).map(([platform, pack]) => ({
    platform,
    copy: normaliseText(platformPackText(pack)),
    duration: concreteDurationSignature(pack),
  }));
  const copyCounts = new Map();
  const durationCounts = new Map();
  for (const entry of entries) {
    if (entry.copy) copyCounts.set(entry.copy, (copyCounts.get(entry.copy) || 0) + 1);
    if (entry.duration) durationCounts.set(entry.duration, (durationCounts.get(entry.duration) || 0) + 1);
  }
  const failures = [];
  if ([...copyCounts.values()].some((count) => count >= 2)) {
    failures.push("platform_mirroring:blind_duplicate_copy");
  }
  if ([...durationCounts.values()].some((count) => count >= 2)) {
    failures.push("platform_mirroring:duplicate_duration");
  }
  return {
    schema_version: 1,
    verdict: failures.length ? "fail" : "pass",
    failures,
    warnings: [],
    metrics: {
      platforms_checked: entries.length,
      duplicate_copy_groups: [...copyCounts.values()].filter((count) => count >= 2).length,
      duplicate_duration_groups: [...durationCounts.values()].filter((count) => count >= 2).length,
    },
  };
}

function buildMultiPlatformFormatEngine() {
  const outputs = {
    youtube_shorts: {
        duration_seconds: { min: 35, max: 60 },
        pacing: "source-safe, title-aligned, strong identity CTA",
        cta: "Follow for the gaming stories behind the headline.",
    },
    tiktok: {
        duration_seconds: { min: 61, max: 90 },
        pacing: "slightly more conversational with extra context when rewards eligibility matters",
        cta: "Sources and context are on the story page.",
    },
    instagram_reels: {
        duration_seconds: { min: 25, max: 45 },
        pacing: "punchier visual edit with less source-heavy text",
    },
    facebook_reels: {
        duration_seconds: { min: 35, max: 60 },
        pacing: "clearer explanatory framing and slightly slower text beats",
    },
    x: {
        duration_seconds: { min: 25, max: 60 },
        pacing: "headline-first, source-heavy and link-friendly",
    },
    snapchat_spotlight: {
        duration_seconds: { min: 20, max: 45 },
        pacing: "visually simple, fast and low text density",
    },
  };
  return {
    status: "ready",
    outputs,
    platform_mirroring_detection: detectPlatformMirroring(outputs),
    rule: "Same story, different cut. Do not blindly repost the same edit everywhere.",
  };
}

function buildBrandSystemIpMoat() {
  return {
    status: "defined",
    recurring_segments: BRAND_SEGMENTS,
    banned_phrases: BANNED_PUBLIC_PHRASES,
    style_rules: [
      "One clear subject in the first frame.",
      "Three to five words of first-frame text.",
      "No tiny mobile text.",
      "Source cards must agree with the canonical story manifest.",
      "Use Pulse amber as accent, not a full one-note palette.",
      "CTA must be identity-based rather than generic subscription begging.",
    ],
    motion_identity: {
      intro_sting: "short cold-open impact, no slow logo-first intro",
      lower_thirds: "source-locked, compact and mobile-readable",
      source_cards: "proof beat within the first three seconds when possible",
    },
  };
}

function buildStoryScore(story = {}) {
  const title = cleanText(story.title);
  const text = normaliseText(`${title} ${story.full_script || ""}`);
  const namedEntity = extractEntity(story);
  const scoreParts = {
    audience_fit: /\b(?:xbox|playstation|nintendo|steam|pc|game pass|forza|gta|switch|hardware|controller|headset)\b/.test(text)
      ? 20
      : 8,
    named_entity_strength: namedEntity && !isGenericTitle(title) ? 18 : 0,
    visual_asset_availability: clamp(visualCount(story) * 5, 0, 20),
    controversy_tension: /\b(?:risk|problem|trap|skyrocket|price|increase|ban|delist|caught|mistake|awkward|official)\b/.test(text)
      ? 12
      : 4,
    source_confidence: /rumou?r|leak/i.test(story.flair || title) ? 5 : 12,
    freshness: number(story.breaking_score || story.score) >= 70 ? 10 : 4,
    affiliate_potential: /\b(?:controller|headset|monitor|storage|game pass|wheel|price|edition|deal|steam deck)\b/.test(text)
      ? 8
      : 2,
  };
  const penalties = {
    legal_risk: hasFinanceCryptoRisk([story]) ? 18 : 0,
    boring_context_penalty: isGenericTitle(title) ? 35 : 0,
  };
  const score = Object.values(scoreParts).reduce((sum, item) => sum + item, 0) -
    Object.values(penalties).reduce((sum, item) => sum + item, 0);
  return {
    story_id: story.id || title,
    title,
    canonical_subject: namedEntity,
    story_score: clamp(score),
    score_parts: scoreParts,
    penalties,
    decision: score >= 70 ? "produce" : score >= 50 ? "review" : "skip",
  };
}

function buildStorySelectionIntelligence(stories = []) {
  const ranked = asArray(stories)
    .map(buildStoryScore)
    .sort((a, b) => b.story_score - a.story_score);
  return {
    status: ranked.length ? "ready" : "waiting_for_stories",
    scoring_formula:
      "audience fit + named entity + visual assets + tension + source confidence + affiliate potential + freshness - risk - boring context",
    ranked_stories: ranked,
  };
}

function buildCompetitorGapEngine({ stories = [], goldStandardLibrary = {} } = {}) {
  const packs = asArray(goldStandardLibrary.reference_packs).map((pack) => pack.pack).filter(Boolean);
  return {
    status: stories.length ? "ready" : "waiting_for_stories",
    benchmark_packs_used: packs.length ? packs : DEFAULT_REFERENCE_PACKS,
    story_angles: asArray(stories).slice(0, 10).map((story) => {
      const subject = extractEntity(story);
      return {
        story_id: story.id || cleanText(story.title),
        subject,
        what_big_sites_likely_cover: [
          "headline fact",
          "trailer or official quote",
          "basic platform detail",
        ],
        pulse_gap_angle:
          `Explain what ${subject} changes for players, buying decisions and platform strategy in one mobile-first Short.`,
        proof_needed: ["primary source", "official page or store page", "safe motion source"],
      };
    }),
  };
}

function buildCostInfrastructureControl(costSnapshot = {}) {
  const api = number(costSnapshot.api_cost_gbp);
  const render = number(costSnapshot.render_cost_gbp);
  const storage = number(costSnapshot.storage_cost_gbp);
  const bandwidth = number(costSnapshot.bandwidth_cost_gbp);
  const failed = number(costSnapshot.failed_render_cost_gbp);
  const total = api + render + storage + bandwidth + failed;
  const published = number(costSnapshot.published_videos);
  const views = number(costSnapshot.views);
  const revenue = number(costSnapshot.revenue_gbp);
  const blockers = [];
  if (number(costSnapshot.failed_renders) >= 3) blockers.push("failed_render_cost_needs_attention");
  if (published > 0 && total / published > 5) blockers.push("cost_per_video_above_target");
  return {
    status: blockers.length ? "review" : "pass",
    total_cost_gbp: round(total, 2),
    cost_per_published_video_gbp: published > 0 ? round(total / published, 2) : null,
    cost_per_1000_views_gbp: views > 0 ? round((total / views) * 1000, 2) : null,
    profit_gbp: round(revenue - total, 2),
    blockers,
    tracked_costs: {
      api_cost_gbp: api,
      render_cost_gbp: render,
      storage_cost_gbp: storage,
      bandwidth_cost_gbp: bandwidth,
      failed_render_cost_gbp: failed,
    },
  };
}

function buildGoldStandardCoverage(goldStandardLibrary = {}) {
  const referenceCount = number(goldStandardLibrary.references?.length || goldStandardLibrary.summary?.total_references);
  const ruleCount = asArray(goldStandardLibrary.codex_rules).length;
  const packs = new Set(asArray(goldStandardLibrary.reference_packs).map((pack) => pack.pack).filter(Boolean));
  const score = clamp((referenceCount / 50) * 45 + (ruleCount / 12) * 25 + (packs.size / DEFAULT_REFERENCE_PACKS.length) * 30);
  const missingPacks = DEFAULT_REFERENCE_PACKS.filter((pack) => !packs.has(pack));
  return {
    score: Math.round(score),
    reference_count: referenceCount,
    rule_count: ruleCount,
    missing_packs: missingPacks,
  };
}

function buildFinanceCryptoFirewall(stories = []) {
  const analysed = asArray(stories).map((story) => ({
    story,
    risk: financeCryptoRiskForStory(story),
  }));
  const risky = analysed.filter(({ risk }) => risk.blocked).map(({ story }) => story);
  const review = analysed
    .filter(({ risk }) => risk.topic && !risk.blocked)
    .map(({ story }) => story);
  return {
    status: risky.length ? "blocked_for_review" : review.length ? "review" : "clear",
    risky_story_ids: risky.map((story) => story.id || cleanText(story.title)),
    review_story_ids: review.map((story) => story.id || cleanText(story.title)),
    blocked_language: [
      "buy/sell/hold calls",
      "price predictions presented as certainty",
      "exchange referral pushes",
      "leverage promotion",
      "guaranteed return claims",
      "undisclosed affiliate incentives",
    ],
  };
}

function buildAutonomyControlTower({
  retentionStatus,
  motionStatus,
  securitySecretManagement,
  financeCryptoComplianceFirewall,
  governanceSummary = {},
  revenuePathDigest = {},
} = {}) {
  const blockers = [
    ...retentionStatus.blockers,
    ...motionStatus.blockers,
  ];
  if (securitySecretManagement.status === "blocked") blockers.push("security_secret_blocker");
  if (securitySecretManagement.status === "review") blockers.push("security_secret_review_required");
  if (financeCryptoComplianceFirewall.status === "blocked_for_review") {
    blockers.push("finance_crypto_review_required");
  } else if (financeCryptoComplianceFirewall.status === "review") {
    blockers.push("finance_crypto_topic_review");
  }
  if (governanceSummary.publish_status && governanceSummary.publish_status !== "GREEN") {
    blockers.push("studio_governance_not_green");
  }
  const totals = revenuePathDigest.totals || {};
  if (number(totals.blocked_for_compliance) > 0) blockers.push("revenue_compliance_blocks_present");
  const uniqueBlockers = [...new Set(blockers)];
  const hard = uniqueBlockers.some((item) =>
    ["security_secret_blocker", "finance_crypto_review_required", "studio_governance_not_green"].includes(item),
  );
  return {
    mode: hard ? "RED" : uniqueBlockers.length ? "AMBER" : "GREEN",
    publish_status: hard ? "RED" : uniqueBlockers.length ? "AMBER" : "GREEN",
    blockers: uniqueBlockers,
    can_auto_publish: uniqueBlockers.length === 0,
    reason_codes: uniqueBlockers,
  };
}

function buildNextActions(pack) {
  const actions = [];
  if (pack.autonomy_control_tower.blockers.includes("retention_below_target")) {
    actions.push({
      priority: "P0",
      action: "Run first-three-seconds experiment pack until stayed-to-watch clears 45%.",
      owner: "retention_intelligence",
    });
  }
  if (pack.autonomy_control_tower.blockers.includes("motion_supply_not_ready")) {
    actions.push({
      priority: "P0",
      action: "Acquire or operator-supply more licensed/direct media source families for V4.",
      owner: "footage_empire",
    });
  }
  if (pack.security_secret_management.status !== "pass") {
    actions.push({
      priority: "P0",
      action: "Close security warnings before full autonomy.",
      owner: "studio_governance",
    });
  }
  if (!actions.length) {
    actions.push({
      priority: "P1",
      action: "Start controlled platform-format experiments and sponsor-readiness data capture.",
      owner: "enterprise_os",
    });
  }
  return actions;
}

function layerStatusFor(definition, pack = {}) {
  if (definition.id === "autonomy_control_tower") return pack.autonomy_control_tower?.mode || "unknown";
  if (definition.id === "finance_crypto_compliance_firewall") {
    return pack.finance_crypto_compliance_firewall?.status || "unknown";
  }
  if (definition.id === "security_secret_management") {
    const status = pack.security_secret_management?.status || "unknown";
    if (status === "blocked") return "RED";
    if (status === "review") return "AMBER";
    return status === "pass" ? "GREEN" : status;
  }
  if (definition.id === "cost_infrastructure_control") {
    const status = pack.cost_infrastructure_control?.status || "unknown";
    return status === "review" ? "AMBER" : status === "pass" ? "GREEN" : status;
  }
  if (definition.id === "gold_standard_forensics") {
    return pack.gold_standard_forensics?.status || "unknown";
  }
  return "implemented";
}

function buildVersionedPromptModelRegistry() {
  return {
    status: "active",
    registry_version: "prompt_model_registry_v1",
    required_fields: [
      "script_model",
      "script_prompt_version",
      "director_brain_version",
      "visual_renderer",
      "sfx_engine",
      "policy_ruleset",
      "git_commit",
    ],
    publish_pack_requirement: "Every published video must carry the prompt, model, renderer and ruleset versions that produced it.",
  };
}

function buildEnterpriseLayerRegistry(pack = {}) {
  const layers = ENTERPRISE_LAYER_DEFINITIONS.map((definition) => ({
    ...definition,
    implementation_status: "implemented",
    operational_status: layerStatusFor(definition, pack),
    evidence: {
      present_in_pack: Boolean(pack[definition.id]) ||
        [
          "canonical_story_manifest",
          "rights_ledger",
          "platform_policy_engine",
          "anti_spam_uniqueness_engine",
          "corrections_takedown_workflow",
          "versioned_prompt_model_registry",
        ].includes(definition.id),
      gate_backed: definition.gate_backed,
      recommendations_only:
        pack.safety?.recommendations_only !== false && pack.safety?.no_social_posting_triggered !== false,
    },
  }));
  const redLayers = layers.filter((layer) => layer.operational_status === "RED");
  return {
    schema_version: 1,
    total_requested_layers: layers.length,
    summary: {
      total_layers: layers.length,
      implemented_layers: layers.filter((layer) => layer.implementation_status === "implemented").length,
      gate_backed_layers: layers.filter((layer) => layer.gate_backed).length,
      amber_layers: layers.filter((layer) => layer.operational_status === "AMBER").length,
      red_layers: redLayers.length,
    },
    layers,
    rule: "No layer is treated as complete unless it has an owner module and an operator output.",
  };
}

function buildStudioEnterpriseOSPack({
  generatedAt = new Date().toISOString(),
  stories = [],
  retentionBaseline = {},
  revenuePathDigest = {},
  commercialLearningDigest = {},
  commentsDigest = {},
  renderHealthSummary = {},
  v4SourceDeficit = {},
  v4MotionPacks = {},
  goldStandardLibrary = {},
  costSnapshot = {},
  securitySnapshot = {},
  governanceSummary = {},
} = {}) {
  const retentionStatus = buildRetentionStatus(retentionBaseline);
  const motionStatus = buildMotionStatus({ v4SourceDeficit, v4MotionPacks });
  const securitySecretManagement = buildSecuritySecretManagement(securitySnapshot);
  const disasterRecovery = buildDisasterRecovery(securitySnapshot);
  const financeCryptoComplianceFirewall = buildFinanceCryptoFirewall(stories);
  const costInfrastructureControl = buildCostInfrastructureControl(costSnapshot);
  const goldStandardCoverage = buildGoldStandardCoverage(goldStandardLibrary);
  const autonomyControlTower = buildAutonomyControlTower({
    retentionStatus,
    motionStatus,
    securitySecretManagement,
    financeCryptoComplianceFirewall,
    governanceSummary,
    revenuePathDigest,
  });
  const pack = {
    schema_version: 1,
    engine: ENTERPRISE_OS_VERSION,
    generated_at: generatedAt,
    autonomy_control_tower: autonomyControlTower,
    observability_dashboard: null,
    canonical_story_manifest: {
      status: "enforced_by_governance_engine",
      output: "output/governance/publish_manifest.json",
    },
    rights_ledger: {
      status: "enforced_by_governance_engine",
      output: "output/governance/risk_report.json",
    },
    platform_policy_engine: {
      status: "enforced_by_governance_engine",
      output: "output/governance/risk_report.json",
    },
    anti_spam_uniqueness_engine: {
      status: "enforced_by_governance_engine",
      output: "output/governance/rejection_reasons.json",
    },
    corrections_takedown_workflow: disasterRecovery.correction_queue,
    versioned_prompt_model_registry: buildVersionedPromptModelRegistry(),
    experimentation_engine: buildExperimentationEngine(),
    audience_persona_engine: buildAudiencePersonaEngine(retentionBaseline),
    comment_intelligence: buildCommentIntelligence(commentsDigest),
    landing_page_link_hub: buildLandingPageLinkHub(revenuePathDigest),
    revenue_attribution: buildRevenueAttribution({
      revenuePathDigest,
      commercialLearningDigest,
      costSnapshot,
    }),
    sponsor_readiness_pack: buildSponsorReadinessPack({ retentionBaseline, costSnapshot }),
    multi_platform_format_engine: buildMultiPlatformFormatEngine(),
    finance_crypto_compliance_firewall: financeCryptoComplianceFirewall,
    brand_system_ip_moat: buildBrandSystemIpMoat(),
    story_selection_intelligence: buildStorySelectionIntelligence(stories),
    competitor_gap_engine: buildCompetitorGapEngine({ stories, goldStandardLibrary }),
    cost_infrastructure_control: costInfrastructureControl,
    security_secret_management: securitySecretManagement,
    disaster_recovery: disasterRecovery,
    gold_standard_forensics: {
      status: goldStandardCoverage.missing_packs.length ? "incomplete" : "covered",
      coverage: goldStandardCoverage,
      packs: DEFAULT_REFERENCE_PACKS,
    },
    policy_and_compliance: {
      governance_engine_required: true,
      affiliate_disclosure_required: true,
      ai_disclosure_checked_by_governance: true,
      rights_ledger_checked_by_governance: true,
      finance_crypto_firewall_required: true,
    },
    safety: {
      no_social_posting_triggered: true,
      no_db_rows_mutated: true,
      no_tokens_or_oauth_changed: true,
      recommendations_only: true,
    },
  };
  pack.enterprise_layer_registry = buildEnterpriseLayerRegistry(pack);
  pack.observability_dashboard = buildObservabilityDashboard({
    retentionStatus,
    motionStatus,
    revenuePathDigest,
    commercialLearningDigest,
    commentsDigest,
    renderHealthSummary,
    securitySecretManagement,
    costInfrastructureControl,
    goldStandardCoverage,
  });
  pack.observability_dashboard.cards = pack.observability_dashboard.cards.map((card) =>
    card.id === "autonomy_mode" ? { ...card, value: pack.autonomy_control_tower.mode } : card,
  );
  pack.next_actions = buildNextActions(pack);
  return pack;
}

function renderStudioEnterpriseOSMarkdown(pack = {}) {
  const lines = [];
  lines.push("# Studio Enterprise OS v1");
  lines.push("");
  lines.push(`Generated: ${pack.generated_at || ""}`);
  lines.push(`Autonomy mode: ${pack.autonomy_control_tower?.mode || "unknown"}`);
  lines.push(`Blockers: ${asArray(pack.autonomy_control_tower?.blockers).join(", ") || "none"}`);
  lines.push("");
  lines.push("## Dashboard");
  for (const card of asArray(pack.observability_dashboard?.cards)) {
    const value = card.value ?? "n/a";
    lines.push(`- ${card.label}: ${value}${value === "n/a" ? "" : card.unit || ""}`);
  }
  lines.push("");
  lines.push("## Next actions");
  for (const action of asArray(pack.next_actions)) {
    lines.push(`- [${action.priority}] ${action.action}`);
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("- No social posting was triggered.");
  lines.push("- No DB rows were mutated.");
  lines.push("- No tokens or OAuth settings were changed.");
  return `${lines.join("\n")}\n`;
}

async function writeJson(filePath, value) {
  await fs.writeJson(filePath, value, { spaces: 2 });
  return filePath;
}

async function writeStudioEnterpriseOSArtifacts(pack, { outputDir = path.join(process.cwd(), "output", "enterprise-os") } = {}) {
  await fs.ensureDir(outputDir);
  const jsonPath = await writeJson(path.join(outputDir, "studio_enterprise_os.json"), pack);
  const markdownPath = path.join(outputDir, "studio_enterprise_os.md");
  await fs.writeFile(markdownPath, renderStudioEnterpriseOSMarkdown(pack), "utf8");
  await writeJson(path.join(outputDir, "experiment_plan.json"), pack.experimentation_engine);
  await writeJson(path.join(outputDir, "sponsor_readiness_pack.json"), pack.sponsor_readiness_pack);
  await writeJson(path.join(outputDir, "multi_platform_format_plan.json"), pack.multi_platform_format_engine);
  await writeJson(path.join(outputDir, "security_disaster_recovery_plan.json"), {
    security_secret_management: pack.security_secret_management,
    disaster_recovery: pack.disaster_recovery,
  });
  await writeJson(path.join(outputDir, "story_selection_rankings.json"), pack.story_selection_intelligence);
  await writeJson(path.join(outputDir, "revenue_attribution.json"), pack.revenue_attribution);
  await writeJson(path.join(outputDir, "landing_page_link_hub.json"), pack.landing_page_link_hub);
  await writeJson(path.join(outputDir, "enterprise_layer_registry.json"), pack.enterprise_layer_registry);
  await writeJson(path.join(outputDir, "story_scorecard.json"), pack.story_selection_intelligence);
  await writeJson(path.join(outputDir, "experiment_manifest.json"), pack.experimentation_engine);
  await writeJson(path.join(outputDir, "analytics_ingest_plan.json"), {
    schema_version: 1,
    source: "studio_enterprise_os",
    required_metrics: [
      "views",
      "average_view_duration",
      "first_3_second_drop_off",
      "stayed_to_watch",
      "swipe_away",
      "follows_or_subscribers_gained",
      "affiliate_clicks",
      "landing_page_visits",
      "revenue",
    ],
    rule_update_outputs: [
      "title_pattern_recommendations",
      "script_rewrite_rules",
      "visual_pacing_rules",
      "platform_variant_changes",
    ],
    dry_run_only: true,
  });
  await writeJson(path.join(outputDir, "observability_report.json"), pack.observability_dashboard);
  await writeJson(path.join(outputDir, "security_report.json"), pack.security_secret_management);
  await writeJson(path.join(outputDir, "secrets_scan_report.json"), {
    schema_version: 1,
    status: pack.security_secret_management?.status || "unknown",
    hardcoded_secret_findings:
      pack.security_secret_management?.checks?.hardcoded_secret_findings || [],
    no_tokens_written: true,
  });
  await writeJson(path.join(outputDir, "sponsor_media_kit.json"), pack.sponsor_readiness_pack);
  await writeJson(path.join(outputDir, "brand_system_manifest.json"), pack.brand_system_ip_moat);
  await writeJson(path.join(outputDir, "prompt_model_registry.json"), pack.versioned_prompt_model_registry);
  await writeJson(path.join(outputDir, "video_lineage_manifest.json"), {
    schema_version: 1,
    generated_at: pack.generated_at,
    registry: pack.versioned_prompt_model_registry,
    audit_required_for_publish: true,
  });
  await writeJson(path.join(outputDir, "landing_page_manifest.json"), pack.landing_page_link_hub);
  await writeJson(path.join(outputDir, "youtube_publish_pack.json"), pack.multi_platform_format_engine.outputs.youtube_shorts);
  await writeJson(path.join(outputDir, "tiktok_publish_pack.json"), pack.multi_platform_format_engine.outputs.tiktok);
  await writeJson(path.join(outputDir, "instagram_publish_pack.json"), pack.multi_platform_format_engine.outputs.instagram_reels);
  await writeJson(path.join(outputDir, "facebook_publish_pack.json"), pack.multi_platform_format_engine.outputs.facebook_reels);
  await writeJson(path.join(outputDir, "x_publish_pack.json"), pack.multi_platform_format_engine.outputs.x);
  await writeJson(path.join(outputDir, "threads_publish_pack.json"), {
    tone: "discussion-led, softer than X, source-safe",
    duplicate_x_wording_allowed: false,
    disclosure_required: true,
  });
  await writeJson(path.join(outputDir, "pinterest_publish_pack.json"), {
    evergreen_only: true,
    affiliate_disclosure_required: true,
    landing_page_required: true,
  });
  await writeJson(path.join(outputDir, "thread_manifest.json"), {
    platform: "x",
    posts: [
      "hot_take",
      "source_safe_post",
      "concise_news_post",
      "poll_candidate",
      "landing_page_post",
    ],
    spam_guard: "no automated risky replies without review",
  });
  await writeJson(path.join(outputDir, "carousel_manifest.json"), {
    platform: "instagram",
    cards: ["cover", "source", "impact", "related_links"],
    max_text_density: "mobile_readable",
  });
  await writeJson(path.join(outputDir, "image_card_manifest.json"), {
    platforms: ["x", "instagram", "facebook"],
    requirements: ["large_subject", "3_to_7_word_headline", "source_lock"],
  });
  return {
    outputDir,
    jsonPath,
    markdownPath,
  };
}

module.exports = {
  ENTERPRISE_OS_VERSION,
  buildStudioEnterpriseOSPack,
  renderStudioEnterpriseOSMarkdown,
  writeStudioEnterpriseOSArtifacts,
  buildEnterpriseLayerRegistry,
  buildStorySelectionIntelligence,
  buildSecuritySecretManagement,
  buildCostInfrastructureControl,
  detectPlatformMirroring,
};
