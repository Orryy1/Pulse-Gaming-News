"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const GOAL_ID = "18_finance_and_crypto_firewall";

const REQUIRED_FIREWALL_CHECKS = [
  "buy_sell_hold_calls",
  "guaranteed_returns",
  "pump_claims",
  "leverage_promotion",
  "exchange_referral_pushes",
  "token_shilling",
  "certainty_price_predictions",
  "misleading_profit_thumbnails",
  "undisclosed_incentives",
  "personalised_investment_advice",
  "unsafe_affiliate_routing",
];

const FINANCE_TOPIC_RE =
  /\b(?:finance|financial|stocks|shares|shareholder|investor|investment fund|investment trust|trading platform|pension|isa|mortgage|earnings|market cap|asset manager|stock market|stock price|stock ticker|stock moved|stock rose|stock fell|stock plunged|stock rallied)\b/i;
const CRYPTO_TOPIC_RE =
  /\b(?:crypto|bitcoin|ethereum|blockchain|web3|wallet|token|coin|exchange listing|token listing|stablecoin|defi|nft)\b/i;
const BUY_SELL_HOLD_RE =
  /\b(?:buy now|sell now|hold now|buy this|sell this|hold this|buy the (?:token|coin|stock|share)|sell the (?:token|coin|stock|share)|hold the (?:token|coin|stock|share)|you should (?:buy|sell|hold|invest))\b/i;
const GUARANTEE_RE = /\b(?:guaranteed returns?|guaranteed profit|guaranteed gains?|risk[-\s]?free returns?)\b/i;
const PUMP_RE = /\b(?:this will pump|will pump|pump after|will moon|moonshot|will explode|huge upside)\b/i;
const LEVERAGE_RE = /\b(?:leverage(?:d)?|margin trading|100x|50x|20x)\b/i;
const EXCHANGE_REFERRAL_RE = /\b(?:exchange referral|referral bonus|referral link|sign up bonus|use my code|trading referral)\b|\/ref\b|[?&]ref=/i;
const TOKEN_SHILL_RE = /\b(?:buy this token|game token|token gem|sponsored token|ape into|token shill|shilling)\b/i;
const CERTAINTY_PRICE_RE =
  /\b(?:will hit|will reach|will be worth|price will|is going to hit|is going to reach|guaranteed price|prediction says .* will)\b/i;
const PROFIT_THUMBNAIL_RE = /\b(?:100x|50x|20x|profit|guaranteed|pump|moon|rich|will explode)\b/i;
const INCENTIVE_RE = /\b(?:sponsored|referral|bonus|commission|affiliate|paid promotion|ad)\b/i;
const PERSONALISED_ADVICE_RE =
  /\b(?:financial advice for you|investment advice for you|you should (?:buy|sell|hold|invest)|I would (?:buy|sell|hold|invest)|my advice is|your portfolio should)\b/i;
const EXCHANGE_LINK_RE = /\b(?:exchange|trading|wallet|crypto|token|bitcoin|ethereum)\b|\/ref\b|[?&]ref=/i;

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
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

function objectText(value) {
  return cleanText(collectStrings(value).join(" "));
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

function normaliseStatus(value) {
  return cleanText(value).toLowerCase();
}

function platformOutputs(platformManifest = {}) {
  return platformManifest.outputs || platformManifest.platform_outputs || {};
}

function gateFrom({ platformPolicyReport = {}, platformManifest = {} } = {}) {
  return platformPolicyReport.finance_crypto_firewall || platformManifest.governance_gates?.finance_crypto_firewall || {};
}

function gateFailures(gate = {}) {
  return unique(asArray(gate.failures || gate.reason_codes || gate.publish_blockers));
}

function gateFailed(gate = {}) {
  const status = normaliseStatus(gate.verdict || gate.result || gate.status || gate.overall_verdict);
  return gateFailures(gate).length > 0 || ["fail", "failed", "red", "blocked", "blocked_for_review"].includes(status);
}

function affiliateLinks(affiliate = {}, landing = {}) {
  return [
    affiliate.primary_link || affiliate.primaryLink,
    ...asArray(affiliate.fallback_links || affiliate.fallbackLinks),
    landing.link_pack?.primary_link,
    ...asArray(landing.link_pack?.fallback_links),
  ].filter(Boolean);
}

function disclosurePresent(affiliate = {}, landing = {}) {
  return Boolean(
    objectText(affiliate.disclosure_copy).length ||
      objectText(landing.disclosure_block?.copy || landing.disclosure_copy).length ||
      affiliate.disclosure_present === true,
  );
}

function complianceApproved({ canonical = {}, affiliate = {}, gate = {} } = {}) {
  return Boolean(
    canonical.compliance_approved === true ||
      canonical.finance_crypto_compliance_approved === true ||
      canonical.operator_finance_crypto_approved === true ||
      affiliate.compliance_approved === true ||
      affiliate.compliance?.approval_reference ||
      gate.approval_present === true,
  );
}

function classifyVertical({ canonical = {}, affiliate = {}, gate = {}, text = "" } = {}) {
  const explicit = cleanText(
    gate.vertical ||
      affiliate.vertical ||
      canonical.vertical ||
      canonical.channel ||
      canonical.channel_id ||
      canonical.commercial_intelligence?.vertical,
  ).toLowerCase();
  if (explicit.includes("crypto") || CRYPTO_TOPIC_RE.test(text)) return "crypto";
  if (["finance", "financial", "stacked"].includes(explicit) || FINANCE_TOPIC_RE.test(text)) return "finance";
  return "non_financial";
}

function buildCheck(condition, blocker, claim, evidence = {}) {
  return {
    status: condition ? "fail" : "pass",
    blockers: condition ? [blocker] : [],
    blocked_claims: condition
      ? [{
          category: blocker,
          claim,
          evidence,
        }]
      : [],
    evidence,
  };
}

function safeFormatFor(text, vertical) {
  if (vertical === "non_financial") return "non_financial_story";
  if (/\b(?:regulator|regulatory|FCA|SEC|rules?|law|compliance|advert|advertising)\b/i.test(text)) return "regulatory_update";
  if (/\b(?:risk|warning|education|educational|explainer|what it means)\b/i.test(text)) return "risk_education";
  if (/\b(?:market context|shares moved|stock moved|earnings|reported|source-backed|source backed)\b/i.test(text)) return "market_context";
  if (/\b(?:explainer|source-backed|source backed|summary)\b/i.test(text)) return "source_backed_explainer";
  return "news_summary";
}

function approvedWordingFor({ storyId, canonical = {}, vertical, safeFormat, directBlockers = [] } = {}) {
  const title = cleanText(canonical.selected_title || canonical.short_title || canonical.canonical_title || canonical.title);
  const description = cleanText(canonical.description || canonical.public_summary || canonical.narration_script);
  if (directBlockers.length) {
    return {
      story_id: storyId,
      status: "blocked_until_claims_removed",
      safe_format: safeFormat,
      approved_wording: {
        title: title.replace(/\b(?:100x|guaranteed|will pump|will moon|buy now|sell now|hold now)\b/gi, "").replace(/\s+/g, " ").trim() || null,
        disclaimer: vertical === "non_financial" ? null : "This is not financial advice.",
        repair_note: "Rewrite as a source-backed, non-advisory explainer before any publish review.",
      },
    };
  }
  return {
    story_id: storyId,
    status: vertical === "non_financial" ? "not_finance_or_crypto" : "approved_safe_format",
    safe_format: safeFormat,
    approved_wording: {
      title: title || null,
      description: description || null,
      disclaimer: vertical === "non_financial" ? null : "This is not financial advice.",
      forbidden_cta: "Do not add buy, sell, hold, leverage or exchange-referral calls.",
    },
  };
}

function buildComplianceActions({ storyId, vertical, directBlockers = [], upstream = [], safeFormat } = {}) {
  const actions = [];
  if (directBlockers.length) {
    actions.push({
      action: "remove_blocked_finance_crypto_claims",
      priority: "P0",
      reason: "Unsafe finance or crypto claims are present.",
    });
  }
  if (directBlockers.includes("finance_crypto:unsafe_affiliate_routing")) {
    actions.push({
      action: "remove_or_approve_finance_crypto_affiliate_routes",
      priority: "P0",
      reason: "Finance or crypto affiliate routing requires documented approval and disclosure.",
    });
  }
  if (directBlockers.includes("finance_crypto:undisclosed_incentive")) {
    actions.push({
      action: "add_or_remove_incentive_disclosure",
      priority: "P0",
      reason: "Incentives must be disclosed before any public copy is considered.",
    });
  }
  if (vertical !== "non_financial" && !directBlockers.length) {
    actions.push({
      action: "keep_non_advisory_finance_wording",
      priority: "P1",
      reason: `Allowed safe format: ${safeFormat}.`,
    });
  }
  if (upstream.length) {
    actions.push({
      action: "resolve_upstream_goal17_blockers",
      priority: "P0",
      reason: "Goal 18 cannot claim full readiness while Goal 17 is blocked.",
    });
  }
  return actions;
}

function buildPolicyIndex(upstreamPolicyReport = {}) {
  const index = new Map();
  for (const row of asArray(upstreamPolicyReport.stories || upstreamPolicyReport.rows)) {
    const storyId = cleanText(row.story_id || row.id);
    if (storyId) index.set(storyId, row);
  }
  return index;
}

function upstreamSkippedInfo(storyId, policyIndex = new Map()) {
  const row = policyIndex.get(cleanText(storyId));
  if (normaliseStatus(row?.status || row?.verdict) !== "skipped") return null;
  return {
    status: cleanText(row.skipped_status || row.status) || "skipped",
    reason: cleanText(row.skipped_reason || row.reason) || "upstream_policy_skipped",
  };
}

function upstreamBlockers(storyId, policyIndex = new Map()) {
  const row = policyIndex.get(cleanText(storyId));
  if (!row) return ["upstream:goal17_platform_policy_engine_missing"];
  const status = normaliseStatus(row.status || row.verdict);
  if (["ready", "pass", "passed", "green"].includes(status)) return [];
  return unique(["upstream:goal17_platform_policy_engine_blocked", ...asArray(row.blockers)]);
}

async function inspectStoryPackage(storyPackage = {}, context = {}) {
  const storyId = storyIdFromPackage(storyPackage);
  const artifactDir = resolveWorkspacePath(context.workspaceRoot, storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir);
  const skipped = upstreamSkippedInfo(storyId, context.policyIndex);
  if (skipped) {
    return {
      story_id: storyId,
      title: cleanText(storyPackage.title),
      artifact_dir: artifactDir,
      status: "skipped",
      direct_finance_crypto_status: "skipped",
      upstream_status: "skipped",
      skipped_status: skipped.status,
      skipped_reason: skipped.reason,
      blockers: [],
      upstream_blockers: [],
      direct_finance_crypto_blockers: [],
      firewall_checks: {},
      blocked_claims: [],
      approved_wording: {
        story_id: storyId,
        status: "skipped",
        safe_format: "skipped",
        approved_wording: {},
      },
      compliance_required_actions: [],
      finance_crypto_risk: {
        story_id: storyId,
        status: "skipped",
        vertical: "skipped",
        topic: false,
        safe_format: "skipped",
        approved: false,
        blocker_count: 0,
        direct_blockers: [],
        existing_gate: { verdict: null, failures: [] },
      },
      source_material: {
        canonical_manifest_present: false,
        platform_publish_manifest_present: false,
        affiliate_manifest_present: false,
        landing_manifest_present: false,
        affiliate_link_count: 0,
      },
      safety: {
        local_proof_only: true,
        no_publish_triggered: true,
        no_external_posting: true,
        no_db_mutation: true,
        no_oauth_or_token_change: true,
        no_secret_values_exposed: true,
      },
    };
  }
  const canonical = await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {});
  const platformManifest = await readJsonIfPresent(path.join(artifactDir, "platform_publish_manifest.json"), {});
  const platformPolicyReport = await readJsonIfPresent(path.join(artifactDir, "platform_policy_report.json"), {});
  const affiliate = await readJsonIfPresent(path.join(artifactDir, "affiliate_link_manifest.json"), {});
  const landing = await readJsonIfPresent(path.join(artifactDir, "landing_page_manifest.json"), {});
  const outputs = platformOutputs(platformManifest);
  const gate = gateFrom({ platformPolicyReport, platformManifest });
  const text = objectText([
    canonical.selected_title,
    canonical.short_title,
    canonical.canonical_title,
    canonical.thumbnail_text,
    canonical.thumbnail_headline,
    canonical.description,
    canonical.narration_script,
    canonical.full_script,
    canonical.pinned_comment,
    outputs,
    affiliate,
    landing,
  ]);
  const vertical = classifyVertical({ canonical, affiliate, gate, text });
  const topic = vertical !== "non_financial";
  const approved = complianceApproved({ canonical, affiliate, gate });
  const links = affiliateLinks(affiliate, landing);
  const linkText = objectText(links);
  const hasExchangeReferral = topic && (EXCHANGE_REFERRAL_RE.test(text) || EXCHANGE_REFERRAL_RE.test(linkText));
  const hasIncentive = topic && INCENTIVE_RE.test(text);
  const incentiveDisclosed = disclosurePresent(affiliate, landing);
  const thumbnailText = objectText([canonical.thumbnail_text, canonical.thumbnail_headline, outputs.youtube_shorts?.cover_frame, outputs.instagram_reels?.cover_frame]);
  const unsafeAffiliate = topic && links.length > 0 && (!approved || EXCHANGE_LINK_RE.test(linkText) || !incentiveDisclosed);

  const checks = {
    buy_sell_hold_calls: buildCheck(topic && BUY_SELL_HOLD_RE.test(text), "finance_crypto:buy_sell_hold_call", "Buy, sell or hold recommendation"),
    guaranteed_returns: buildCheck(topic && GUARANTEE_RE.test(text), "finance_crypto:guaranteed_return_claim", "Guaranteed return or profit claim"),
    pump_claims: buildCheck(topic && PUMP_RE.test(text), "finance_crypto:pump_claim", "Pump, moon or explosive upside claim"),
    leverage_promotion: buildCheck(topic && LEVERAGE_RE.test(text), "finance_crypto:leverage_promotion", "Leverage or high-multiple trading promotion"),
    exchange_referral_pushes: buildCheck(hasExchangeReferral && !approved, "finance_crypto:exchange_referral_without_approval", "Exchange referral push without approval"),
    token_shilling: buildCheck(vertical === "crypto" && TOKEN_SHILL_RE.test(text), "finance_crypto:token_shilling", "Token shilling or token promotion"),
    certainty_price_predictions: buildCheck(topic && CERTAINTY_PRICE_RE.test(text), "finance_crypto:certainty_price_prediction", "Certainty-based price prediction"),
    misleading_profit_thumbnails: buildCheck(topic && PROFIT_THUMBNAIL_RE.test(thumbnailText), "finance_crypto:misleading_profit_thumbnail", "Misleading profit thumbnail"),
    undisclosed_incentives: buildCheck(hasIncentive && !incentiveDisclosed, "finance_crypto:undisclosed_incentive", "Undisclosed incentive or paid relationship"),
    personalised_investment_advice: buildCheck(topic && PERSONALISED_ADVICE_RE.test(text), "finance_crypto:personalised_investment_advice", "Personalised investment advice"),
    unsafe_affiliate_routing: buildCheck(unsafeAffiliate, "finance_crypto:unsafe_affiliate_routing", "Unsafe finance or crypto affiliate routing", {
      link_count: links.length,
      approved,
      incentive_disclosed: incentiveDisclosed,
    }),
  };

  const directBlockers = unique(Object.values(checks).flatMap((check) => check.blockers));
  if (topic && gateFailed(gate) && !directBlockers.length) directBlockers.push("finance_crypto:existing_policy_gate_failed");
  const upstream = upstreamBlockers(storyId, context.policyIndex);
  const blockers = unique([...upstream, ...directBlockers]);
  const safeFormat = safeFormatFor(text, vertical);
  const blockedClaims = Object.values(checks).flatMap((check) => check.blocked_claims);
  const riskStatus = directBlockers.length ? "blocked" : topic ? "allowed_safe_format" : "clear";
  const approvedWording = approvedWordingFor({ storyId, canonical, vertical, safeFormat, directBlockers });
  const complianceActions = buildComplianceActions({ storyId, vertical, directBlockers, upstream, safeFormat });

  return {
    story_id: storyId,
    title: cleanText(canonical.selected_title || canonical.short_title || canonical.canonical_title || storyPackage.title),
    artifact_dir: artifactDir,
    status: blockers.length ? "blocked" : "ready",
    direct_finance_crypto_status: directBlockers.length ? "blocked" : "pass",
    upstream_status: upstream.length ? "blocked" : "ready",
    blockers,
    upstream_blockers: upstream,
    direct_finance_crypto_blockers: directBlockers,
    firewall_checks: checks,
    blocked_claims: blockedClaims,
    approved_wording: approvedWording,
    compliance_required_actions: complianceActions,
    finance_crypto_risk: {
      story_id: storyId,
      status: riskStatus,
      vertical,
      topic,
      safe_format: safeFormat,
      approved,
      blocker_count: directBlockers.length,
      direct_blockers: directBlockers,
      existing_gate: {
        verdict: gate.verdict || gate.result || gate.status || null,
        failures: gateFailures(gate),
      },
    },
    source_material: {
      canonical_manifest_present: Object.keys(canonical).length > 0,
      platform_publish_manifest_present: Object.keys(platformManifest).length > 0,
      affiliate_manifest_present: Object.keys(affiliate).length > 0,
      landing_manifest_present: Object.keys(landing).length > 0,
      affiliate_link_count: links.length,
    },
    safety: {
      local_proof_only: true,
      no_publish_triggered: true,
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

function directRiskCounts(stories = []) {
  const counts = {};
  for (const story of asArray(stories)) {
    for (const blocker of asArray(story.direct_finance_crypto_blockers)) counts[blocker] = (counts[blocker] || 0) + 1;
  }
  return counts;
}

function buildFinanceCryptoRiskReport(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    verdict: report.direct_finance_crypto_verdict || "UNKNOWN",
    required_checks: REQUIRED_FIREWALL_CHECKS,
    stories: asArray(report.stories).filter((story) => story.status !== "skipped").map((story) => ({
      ...story.finance_crypto_risk,
      firewall_checks: story.firewall_checks,
    })),
    safety: {
      local_proof_only: true,
      no_publish_triggered: true,
      no_external_posting: true,
    },
  };
}

function buildApprovedWording(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    stories: asArray(report.stories).filter((story) => story.status !== "skipped").map((story) => story.approved_wording),
    safety: {
      no_public_copy_mutation: true,
      no_external_posting: true,
    },
  };
}

function buildBlockedClaims(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    stories: asArray(report.stories).filter((story) => story.status !== "skipped").map((story) => ({
      story_id: story.story_id,
      status: story.direct_finance_crypto_status,
      blocked_claims: story.blocked_claims,
    })),
    safety: {
      local_proof_only: true,
      no_public_copy_mutation: true,
    },
  };
}

function buildComplianceRequiredActions(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    stories: asArray(report.stories).filter((story) => story.status !== "skipped").map((story) => ({
      story_id: story.story_id,
      status: story.status,
      direct_finance_crypto_status: story.direct_finance_crypto_status,
      actions: story.compliance_required_actions,
    })),
    safety: {
      no_publish_action: true,
      no_external_posting: true,
      no_production_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_values_exposed: true,
    },
  };
}

async function buildGoal18FinanceCryptoFirewall({
  storyPackages = [],
  upstreamPolicyReport = {},
  workspaceRoot = process.cwd(),
  outputDir,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!outputDir) throw new Error("buildGoal18FinanceCryptoFirewall requires outputDir");
  await fs.ensureDir(path.resolve(outputDir));
  const policyIndex = buildPolicyIndex(upstreamPolicyReport);
  const stories = [];
  for (const storyPackage of asArray(storyPackages)) {
    stories.push(await inspectStoryPackage(storyPackage, { workspaceRoot, policyIndex }));
  }
  const activeStories = stories.filter((story) => story.status !== "skipped");
  const skippedStories = stories.filter((story) => story.status === "skipped");
  const readyStories = activeStories.filter((story) => story.status === "ready");
  const blockedStories = activeStories.filter((story) => story.status === "blocked");
  const directPassStories = activeStories.filter((story) => story.direct_finance_crypto_status === "pass");
  const directBlockedStories = activeStories.filter((story) => story.direct_finance_crypto_status !== "pass");
  const verdict = !activeStories.length
    ? "FAIL"
    : blockedStories.length && readyStories.length
      ? "PARTIAL"
      : blockedStories.length
        ? "BLOCKED"
        : "PASS";
  const directFinanceCryptoVerdict = !activeStories.length
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
    mode: "LOCAL_PROOF",
    verdict,
    direct_finance_crypto_verdict: directFinanceCryptoVerdict,
    summary: {
      story_count: stories.length,
      active_story_count: activeStories.length,
      skipped_story_count: skippedStories.length,
      finance_crypto_ready_story_count: readyStories.length,
      blocked_story_count: blockedStories.length,
      direct_finance_crypto_pass_story_count: directPassStories.length,
      direct_finance_crypto_blocked_story_count: directBlockedStories.length,
      finance_crypto_topic_story_count: activeStories.filter((story) => story.finance_crypto_risk.topic).length,
      safe_finance_format_story_count: activeStories.filter((story) => story.finance_crypto_risk.status === "allowed_safe_format").length,
      unsafe_finance_crypto_story_count: activeStories.filter((story) => story.finance_crypto_risk.status === "blocked").length,
      publish_now_count: 0,
    },
    required_firewall_checks: REQUIRED_FIREWALL_CHECKS,
    blocker_counts: blockerCounts(activeStories),
    direct_risk_counts: directRiskCounts(activeStories),
    upstream_blockers: {
      goal17_platform_policy_engine:
        "Goal 18 can inspect finance and crypto wording locally, but readiness requires Goal 17 and upstream gates to be ready first.",
      note:
        "This gate emits local proof only. It does not publish, post externally, mutate production rows, inspect secrets or change OAuth/token state.",
    },
    stories,
    safety: {
      local_proof_only: true,
      no_publish_triggered: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_values_exposed: true,
      no_gate_weakened: true,
    },
  };
  report.finance_crypto_risk_report = buildFinanceCryptoRiskReport(report);
  report.approved_wording = buildApprovedWording(report);
  report.blocked_claims = buildBlockedClaims(report);
  report.compliance_required_actions = buildComplianceRequiredActions(report);
  return report;
}

function renderGoal18FinanceCryptoFirewallMarkdown(report = {}) {
  const lines = [];
  lines.push("# Goal 18 Finance and Crypto Firewall");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Verdict: ${report.verdict || "UNKNOWN"}`);
  lines.push(`Direct finance/crypto verdict: ${report.direct_finance_crypto_verdict || "UNKNOWN"}`);
  lines.push(`Stories checked: ${report.summary?.story_count || 0}`);
  lines.push(`Full firewall-ready stories: ${report.summary?.finance_crypto_ready_story_count || 0}`);
  lines.push(`Direct firewall-pass stories: ${report.summary?.direct_finance_crypto_pass_story_count || 0}`);
  lines.push(`Direct firewall-blocked stories: ${report.summary?.direct_finance_crypto_blocked_story_count || 0}`);
  lines.push(`Finance/crypto topic stories: ${report.summary?.finance_crypto_topic_story_count || 0}`);
  lines.push(`Allowed safe-format stories: ${report.summary?.safe_finance_format_story_count || 0}`);
  lines.push(`Unsafe finance/crypto stories: ${report.summary?.unsafe_finance_crypto_story_count || 0}`);
  lines.push(`Publish-now actions: ${report.summary?.publish_now_count || 0}`);
  lines.push("");
  lines.push("## Blockers");
  const blockers = Object.keys(report.blocker_counts || {}).sort();
  if (!blockers.length) lines.push("- none");
  for (const blocker of blockers) lines.push(`- ${blocker}: ${report.blocker_counts[blocker]}`);
  lines.push("");
  lines.push("## Direct Finance/Crypto Hard Fails");
  const direct = Object.keys(report.direct_risk_counts || {}).sort();
  if (!direct.length) lines.push("- none");
  for (const blocker of direct) lines.push(`- ${blocker}: ${report.direct_risk_counts[blocker]}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("LOCAL_PROOF only. This run did not publish, post externally, mutate the database, touch OAuth or token files, inspect secrets or weaken gates.");
  return `${lines.join("\n")}\n`;
}

async function writeGoal18FinanceCryptoFirewall(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoal18FinanceCryptoFirewall requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const readinessJson = path.join(outDir, "goal18_readiness_report.json");
  const readinessMarkdown = path.join(outDir, "goal18_readiness_report.md");
  const financeCryptoRiskReport = path.join(outDir, "finance_crypto_risk_report.json");
  const approvedWording = path.join(outDir, "approved_wording.json");
  const blockedClaims = path.join(outDir, "blocked_claims.json");
  const complianceRequiredActions = path.join(outDir, "compliance_required_actions.json");
  await fs.writeJson(readinessJson, report, { spaces: 2 });
  await fs.writeFile(readinessMarkdown, renderGoal18FinanceCryptoFirewallMarkdown(report), "utf8");
  await fs.writeJson(financeCryptoRiskReport, report.finance_crypto_risk_report || buildFinanceCryptoRiskReport(report), { spaces: 2 });
  await fs.writeJson(approvedWording, report.approved_wording || buildApprovedWording(report), { spaces: 2 });
  await fs.writeJson(blockedClaims, report.blocked_claims || buildBlockedClaims(report), { spaces: 2 });
  await fs.writeJson(complianceRequiredActions, report.compliance_required_actions || buildComplianceRequiredActions(report), { spaces: 2 });
  return {
    readinessJson,
    readinessMarkdown,
    financeCryptoRiskReport,
    approvedWording,
    blockedClaims,
    complianceRequiredActions,
  };
}

module.exports = {
  GOAL_ID,
  REQUIRED_FIREWALL_CHECKS,
  buildApprovedWording,
  buildBlockedClaims,
  buildComplianceRequiredActions,
  buildFinanceCryptoRiskReport,
  buildGoal18FinanceCryptoFirewall,
  inspectStoryPackage,
  renderGoal18FinanceCryptoFirewallMarkdown,
  writeGoal18FinanceCryptoFirewall,
};
