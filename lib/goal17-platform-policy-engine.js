"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const GOAL_ID = "17_platform_policy_engine";

const REQUIRED_POLICY_CHECKS = [
  "youtube_reused_content_risk",
  "youtube_paid_promotion_disclosure",
  "youtube_altered_synthetic_disclosure",
  "youtube_shorts_link_limitations",
  "tiktok_commercial_disclosure",
  "tiktok_ai_disclosure",
  "meta_branded_content",
  "x_automation_spam",
  "affiliate_disclosure",
  "finance_crypto_risk",
  "misinformation_risk",
  "spam_repetitive_content",
];

const FINANCE_CRYPTO_RE =
  /\b(?:finance|financial|crypto|bitcoin|ethereum|token|exchange|wallet|leverage|forex|stock|stocks|shares|trading|investment|investing|yield)\b/i;
const FINANCE_TOPIC_RE =
  /\b(?:finance|financial|forex|stocks|shares|shareholder|investor|investment|investing|trading platform|market cap|earnings|yield|stock market|stock price|stock ticker)\b/i;
const CRYPTO_TOPIC_RE =
  /\b(?:crypto|bitcoin|ethereum|blockchain|web3|wallet|token listing|exchange listing|stablecoin|defi|nft|leverage)\b/i;
const FINANCE_PROMO_RE =
  /\b(?:buy now|buy the token|sell now|hold|pump|guaranteed return|guaranteed returns|risk-free|risk free|leverage|100x|profit|moonshot|financial advice)\b/i;
const SPAM_RE = /\b(?:sub4sub|follow for follow|get rich quick|free money|guaranteed return|guaranteed returns|miracle cure)\b/i;
const DIRECT_EXTERNAL_LINK_RE = /https?:\/\/|www\.|amazon\.[a-z.]+|\/go\//i;
const REUSED_ASSET_RE = /\b(?:reupload|ripped|pirated|stream rip|rights_risk_high|high_risk|unlicensed|scraped)\b/i;

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

function normaliseStatus(value) {
  return cleanText(value).toLowerCase();
}

function hasText(value) {
  return cleanText(value).length > 0;
}

function hasDisclosureCopy(value) {
  return hasText(objectText(value));
}

function platformOutputs(platformManifest = {}) {
  return platformManifest.outputs || platformManifest.platform_outputs || {};
}

function gateFrom({ platformPolicyReport = {}, platformManifest = {} } = {}, gateName) {
  return platformPolicyReport[gateName] || platformManifest.governance_gates?.[gateName] || {};
}

function gateFailures(gate = {}) {
  return unique(asArray(gate.failures || gate.reason_codes || gate.publish_blockers));
}

function gateWarnings(gate = {}) {
  return unique(asArray(gate.warnings));
}

function gateFailed(gate = {}) {
  const status = normaliseStatus(gate.verdict || gate.result || gate.status || gate.overall_verdict);
  return gateFailures(gate).length > 0 || ["fail", "failed", "red", "blocked", "high_risk"].includes(status);
}

function containsFailure(gate = {}, pattern) {
  return gateFailures(gate).some((failure) => pattern.test(failure));
}

function statusFromFailures(failures = [], warnings = []) {
  if (asArray(failures).length) return "fail";
  if (asArray(warnings).length) return "warn";
  return "pass";
}

function buildCheck({ status, blockers = [], warnings = [], evidence = {}, requirement = null } = {}) {
  return {
    status: status || statusFromFailures(blockers, warnings),
    blockers: unique(blockers),
    warnings: unique(warnings),
    requirement,
    evidence,
  };
}

function disclosureStatus(output = {}) {
  return output.disclosure_status || output.disclosureStatus || {};
}

function outputDisclosurePresent(output = {}) {
  const status = disclosureStatus(output);
  return Boolean(
    hasDisclosureCopy(status.caption || status.copy || status.text) ||
      output.disclosure_applied === true ||
      output.disclosure_flag_applied === true ||
      output.affiliate_disclosure_present === true ||
      hasDisclosureCopy(output.disclosure || output.disclosure_copy || output.caption_disclosure),
  );
}

function outputDisclosureRequired(output = {}) {
  const status = disclosureStatus(output);
  return Boolean(
    status.required === true ||
      output.disclosure_required === true ||
      output.affiliate_disclosure_required === true ||
      output.commercial_disclosure_required === true ||
      output.branded_content_required === true ||
      /affiliate|commission|commercial_content_disclosure_required|commercial disclosure|brand promotion|branded content/i.test(objectText(output)),
  );
}

function landingAttributionDisclosure(landing = {}, platform) {
  const row = landing.attribution_manifest?.platforms?.[platform] || {};
  return {
    required: row.disclosure_required === true,
    copy: cleanText(row.disclosure_copy || row.disclosure || row.caption),
  };
}

function affiliateLinks(affiliate = {}) {
  return [affiliate.primary_link || affiliate.primaryLink, ...asArray(affiliate.fallback_links || affiliate.fallbackLinks)]
    .filter(Boolean);
}

function hasAffiliateLink(affiliate = {}, landing = {}) {
  if (affiliateLinks(affiliate).length) return true;
  const landingLinks = [
    landing.link_pack?.primary_link,
    ...asArray(landing.link_pack?.fallback_links),
  ].filter(Boolean);
  return landingLinks.length > 0;
}

function affiliateDisclosureRequired({ affiliate = {}, landing = {}, outputs = {} } = {}) {
  return Boolean(
    affiliate.disclosure_required === true ||
      landing.disclosure_block?.required === true ||
      hasAffiliateLink(affiliate, landing) ||
      outputDisclosureRequired(outputs.youtube_shorts || {}) ||
      outputDisclosureRequired(outputs.tiktok || {}) ||
      outputDisclosureRequired(outputs.instagram_reels || {}) ||
      outputDisclosureRequired(outputs.facebook_reels || {}) ||
      outputDisclosureRequired(outputs.pinterest || {}),
  );
}

function affiliateDisclosurePresent({ affiliate = {}, landing = {}, outputs = {} } = {}) {
  if (hasDisclosureCopy(affiliate.disclosure_copy)) return true;
  if (hasDisclosureCopy(landing.disclosure_block?.copy || landing.disclosure_copy)) return true;
  const attribution = landing.attribution_manifest?.platforms || {};
  if (Object.values(attribution).some((row) => hasDisclosureCopy(row.disclosure_copy || row.disclosure))) return true;
  return [
    outputs.youtube_shorts,
    outputs.tiktok,
    outputs.instagram_reels,
    outputs.facebook_reels,
    outputs.threads,
    outputs.pinterest,
  ].some((output) => outputDisclosurePresent(output || {}));
}

function paidPromotionRequired({ canonical = {}, platformManifest = {}, platformPolicyReport = {}, youtube = {} } = {}) {
  return Boolean(
    canonical.paid_promotion_required === true ||
      canonical.sponsorship_required === true ||
      platformManifest.paid_promotion_required === true ||
      platformPolicyReport.disclosure_requirements?.paid_promotion === true ||
      youtube.paid_promotion === true ||
      youtube.paid_promotion_required === true ||
      youtube.sponsorship_required === true ||
      youtube.commercial_relationship_required === true,
  );
}

function paidPromotionPresent({ canonical = {}, youtube = {} } = {}) {
  const status = disclosureStatus(youtube);
  return Boolean(
    canonical.youtube_paid_promotion_disclosed === true ||
      youtube.paid_promotion_toggle === true ||
      youtube.paid_promotion_disclosed === true ||
      status.type === "paid_promotion" ||
      hasDisclosureCopy(youtube.paid_promotion_disclosure || status.paid_promotion_caption),
  );
}

function syntheticDisclosureRequired({ canonical = {}, platformManifest = {}, platformPolicyReport = {}, youtube = {}, tiktok = {}, aiGate = {} } = {}) {
  return Boolean(
    canonical.synthetic_media_required === true ||
      canonical.altered_synthetic_disclosure_required === true ||
      platformManifest.synthetic_media_required === true ||
      platformManifest.ai_disclosure_required === true ||
      platformPolicyReport.disclosure_requirements?.ai === true ||
      platformPolicyReport.disclosure_requirements?.synthetic === true ||
      aiGate.disclosure_required === true ||
      youtube.synthetic_media_required === true ||
      youtube.altered_synthetic_disclosure_required === true ||
      tiktok.ai_generated_content_required === true,
  );
}

function youtubeSyntheticPresent({ canonical = {}, youtube = {}, aiGate = {} } = {}) {
  return Boolean(
    canonical.youtube_synthetic_media_disclosed === true ||
      youtube.synthetic_media_disclosed === true ||
      youtube.altered_content_disclosure === true ||
      youtube.altered_synthetic_disclosure_present === true ||
      youtube.ai_disclosure_applied === true ||
      hasDisclosureCopy(youtube.synthetic_media_label || youtube.altered_content_label) ||
      (aiGate.disclosure_present === true && youtube.ai_disclosure_not_applicable !== true),
  );
}

function tiktokAiPresent({ tiktok = {}, aiGate = {} } = {}) {
  return Boolean(
    tiktok.ai_generated_content_label === true ||
      tiktok.ai_generated_content_disclosure === true ||
      tiktok.ai_disclosure_applied === true ||
      hasDisclosureCopy(tiktok.ai_generated_content_label || tiktok.ai_content_label || tiktok.synthetic_media_label) ||
      (aiGate.disclosure_present === true && tiktok.ai_disclosure_not_applicable !== true),
  );
}

function tiktokCommercialRequired({ affiliateRequired = false, tiktok = {} } = {}) {
  return Boolean(
    affiliateRequired ||
      tiktok.commercial_disclosure_required === true ||
      tiktok.branded_content_required === true ||
      /commercial|affiliate|commission|brand promotion/i.test(objectText(tiktok)),
  );
}

function tiktokCommercialPresent(tiktok = {}) {
  return Boolean(
    /disclosure|required|enabled|commercial/i.test(cleanText(tiktok.disclosure_flag)) ||
      /required|enabled|commercial/i.test(cleanText(tiktok.commercial_content_setting_recommendation)) ||
      outputDisclosurePresent(tiktok),
  );
}

function metaBrandedRequired({ instagram = {}, facebook = {}, platformManifest = {}, paidRequired = false } = {}) {
  return Boolean(
    paidRequired ||
      platformManifest.meta_branded_content_required === true ||
      instagram.branded_content_required === true ||
      facebook.branded_content_required === true ||
      disclosureStatus(instagram).type === "branded_content" ||
      disclosureStatus(facebook).type === "branded_content",
  );
}

function metaBrandedPresent({ instagram = {}, facebook = {} } = {}) {
  return Boolean(
    instagram.branded_content_tagged === true ||
      instagram.branded_content_disclosure === true ||
      facebook.branded_content_tagged === true ||
      facebook.branded_content_disclosure === true ||
      outputDisclosurePresent(instagram) ||
      outputDisclosurePresent(facebook),
  );
}

function directShortsLinkRisk(youtube = {}) {
  const text = objectText({
    description: youtube.description,
    profile_or_landing_page_cta: youtube.profile_or_landing_page_cta,
    link_strategy: youtube.link_strategy,
    product_link_eligibility: youtube.product_link_eligibility,
  });
  if (/profile_link_or_related_video|profile or landing|bio|story sources/i.test(text) && !/https?:\/\//i.test(text)) return false;
  if (youtube.product_link_eligibility === "used" || youtube.product_link_used === true) return true;
  return DIRECT_EXTERNAL_LINK_RE.test(text);
}

function repeatedThreadText(x = {}, threads = {}, evidence = {}) {
  const pairs = asArray(evidence.blind_duplicate_pairs || evidence.duplicate_pairs);
  if (pairs.length) return true;
  const posts = asArray(x.thread_posts).map((item) => cleanText(item).toLowerCase()).filter(Boolean);
  if (posts.length && new Set(posts).size < posts.length) return true;
  const xText = cleanText(x.source_safe_post || x.hot_take_post).toLowerCase();
  const threadsText = cleanText(threads.discussion_post).toLowerCase();
  return Boolean(xText && threadsText && xText === threadsText && threads.duplicate_x_wording_allowed !== true);
}

function hashtagCount(outputs = {}) {
  return objectText(outputs).match(/#[A-Za-z0-9_]+/g)?.length || 0;
}

function financeVertical({ canonical = {}, affiliate = {}, financeGate = {} } = {}) {
  const explicit = cleanText(
    financeGate.vertical ||
      affiliate.vertical ||
      canonical.vertical ||
      canonical.channel ||
      canonical.channel_id ||
      canonical.commercial_intelligence?.vertical,
  ).toLowerCase();
  const text = objectText([canonical.selected_title, canonical.description, canonical.narration_script, canonical.full_script]);
  if (explicit.includes("crypto") || CRYPTO_TOPIC_RE.test(text)) return "crypto";
  if (["finance", "financial", "stacked"].includes(explicit) || FINANCE_TOPIC_RE.test(text)) return "finance";
  return "non_financial";
}

function sourceText({ canonical = {}, outputs = {}, affiliate = {}, landing = {} } = {}) {
  return objectText([
    canonical.selected_title,
    canonical.canonical_title,
    canonical.description,
    canonical.narration_script,
    canonical.full_script,
    outputs,
    affiliate,
    landing,
  ]);
}

function buildDisclosureRequirements({
  affiliateRequired,
  affiliatePresent,
  paidRequired,
  paidPresent,
  syntheticRequired,
  youtubeSynthetic,
  tiktokCommercialRequiredValue,
  tiktokCommercialPresentValue,
  tiktokAi,
  metaRequired,
  metaPresent,
  financeReviewRequired,
  xManualReviewRequired,
  shortsLinkHandled = true,
} = {}) {
  return {
    youtube: {
      paid_promotion: {
        required: paidRequired,
        present: !paidRequired || paidPresent,
        action: paidRequired && !paidPresent ? "set_youtube_paid_promotion_disclosure_before_upload" : "no_action",
      },
      altered_synthetic: {
        required: syntheticRequired,
        present: !syntheticRequired || youtubeSynthetic,
        action: syntheticRequired && !youtubeSynthetic ? "set_youtube_altered_or_synthetic_content_disclosure_before_upload" : "no_action",
      },
      shorts_link_limitations: {
        required: true,
        present: shortsLinkHandled,
        action: shortsLinkHandled
          ? "route_shorts_links_to_profile_or_story_page_only"
          : "remove_direct_links_from_youtube_shorts_copy_before_upload",
      },
    },
    tiktok: {
      commercial: {
        required: tiktokCommercialRequiredValue,
        present: !tiktokCommercialRequiredValue || tiktokCommercialPresentValue,
        action: tiktokCommercialRequiredValue && !tiktokCommercialPresentValue ? "enable_tiktok_commercial_content_disclosure_before_upload" : "no_action",
      },
      ai: {
        required: syntheticRequired,
        present: !syntheticRequired || tiktokAi,
        action: syntheticRequired && !tiktokAi ? "set_tiktok_ai_generated_content_label_before_upload" : "no_action",
      },
    },
    meta: {
      branded_content: {
        required: metaRequired,
        present: !metaRequired || metaPresent,
        action: metaRequired && !metaPresent ? "apply_meta_branded_content_disclosure_before_upload" : "no_action",
      },
    },
    x: {
      automation_spam_review: {
        required: xManualReviewRequired,
        present: !xManualReviewRequired,
        action: xManualReviewRequired ? "disable_automation_and_manual_review_x_pack" : "no_action",
      },
    },
    affiliate: {
      required: affiliateRequired,
      present: !affiliateRequired || affiliatePresent,
      action: affiliateRequired && !affiliatePresent ? "add_upfront_affiliate_disclosure_to_caption_landing_page_and_link_pack" : "no_action",
    },
    finance_crypto: {
      review_required: financeReviewRequired,
      present: !financeReviewRequired,
      action: financeReviewRequired ? "route_to_finance_crypto_firewall_before_publish" : "no_action",
    },
  };
}

function buildLandingIndex(upstreamLandingReport = {}) {
  const index = new Map();
  for (const row of asArray(upstreamLandingReport.stories || upstreamLandingReport.rows)) {
    const storyId = cleanText(row.story_id || row.id);
    if (storyId) index.set(storyId, row);
  }
  return index;
}

function upstreamSkippedInfo(storyId, landingIndex = new Map()) {
  const row = landingIndex.get(cleanText(storyId));
  if (normaliseStatus(row?.status || row?.verdict) !== "skipped") return null;
  return {
    status: cleanText(row.skipped_status || row.status) || "skipped",
    reason: cleanText(row.skipped_reason || row.reason) || "upstream_landing_skipped",
  };
}

function upstreamBlockers(storyId, landingIndex = new Map()) {
  const row = landingIndex.get(cleanText(storyId));
  if (!row) return ["upstream:goal16_landing_page_engine_missing"];
  const status = normaliseStatus(row.status || row.verdict);
  if (["ready", "pass", "passed", "green"].includes(status)) return [];
  return unique(["upstream:goal16_landing_page_engine_blocked", ...asArray(row.blockers)]);
}

function checkFromBlocker(condition, blocker, evidence = {}, warnings = []) {
  return buildCheck({
    blockers: condition ? [blocker] : [],
    warnings,
    evidence,
  });
}

async function inspectStoryPackage(storyPackage = {}, context = {}) {
  const storyId = storyIdFromPackage(storyPackage);
  const artifactDir = resolveWorkspacePath(context.workspaceRoot, storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir);
  const skipped = upstreamSkippedInfo(storyId, context.landingIndex);
  if (skipped) {
    return {
      story_id: storyId,
      title: cleanText(storyPackage.title),
      artifact_dir: artifactDir,
      status: "skipped",
      direct_policy_status: "skipped",
      upstream_status: "skipped",
      skipped_status: skipped.status,
      skipped_reason: skipped.reason,
      blockers: [],
      upstream_blockers: [],
      direct_policy_blockers: [],
      policy_checks: {},
      disclosure_requirements: {},
      platform_policy_source: {
        platform_publish_manifest_present: false,
        platform_policy_report_present: false,
        affiliate_manifest_present: false,
        landing_manifest_present: false,
        rights_ledger_present: false,
        policy_gate_verdict: null,
        reused_content_gate_verdict: null,
        anti_spam_gate_verdict: null,
        finance_crypto_gate_verdict: null,
      },
      evidence: {
        affiliate_required: false,
        affiliate_present: false,
        paid_promotion_required: false,
        paid_promotion_present: false,
        synthetic_disclosure_required: false,
        youtube_synthetic_present: false,
        tiktok_commercial_required: false,
        tiktok_commercial_present: false,
        tiktok_ai_present: false,
        meta_branded_required: false,
        meta_branded_present: false,
        finance_crypto_vertical: "skipped",
        x_automation_risk: false,
        spam_repetitive_risk: false,
        misinformation_risk: false,
      },
      safety: {
        local_proof_only: true,
        no_publish_triggered: true,
        no_platform_uploads: true,
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
  const rightsLedger = await readJsonIfPresent(path.join(artifactDir, "rights_ledger.json"), {});
  const outputs = platformOutputs(platformManifest);
  const youtube = outputs.youtube_shorts || outputs.youtube || {};
  const tiktok = outputs.tiktok || {};
  const instagram = outputs.instagram_reels || outputs.instagram || {};
  const facebook = outputs.facebook_reels || outputs.facebook || {};
  const x = outputs.x || {};
  const threads = outputs.threads || {};
  const evidence = platformManifest.platform_native_evidence || {};
  const policyGate = gateFrom({ platformPolicyReport, platformManifest }, "platform_policy_gate");
  const affiliateGate = gateFrom({ platformPolicyReport, platformManifest }, "affiliate_disclosure_gate");
  const aiGate = gateFrom({ platformPolicyReport, platformManifest }, "ai_disclosure_gate");
  const reusedGate = gateFrom({ platformPolicyReport, platformManifest }, "reused_content_risk_gate");
  const antiSpamGate = gateFrom({ platformPolicyReport, platformManifest }, "anti_spam_uniqueness_gate");
  const financeGate = gateFrom({ platformPolicyReport, platformManifest }, "finance_crypto_firewall");
  const allText = sourceText({ canonical, outputs, affiliate, landing });

  const affiliateRequired = affiliateDisclosureRequired({ affiliate, landing, outputs });
  const affiliatePresent = affiliateDisclosurePresent({ affiliate, landing, outputs });
  const paidRequired = paidPromotionRequired({ canonical, platformManifest, platformPolicyReport, youtube });
  const paidPresent = paidPromotionPresent({ canonical, youtube });
  const syntheticRequired = syntheticDisclosureRequired({ canonical, platformManifest, platformPolicyReport, youtube, tiktok, aiGate });
  const youtubeSynthetic = youtubeSyntheticPresent({ canonical, youtube, aiGate });
  const tiktokCommercialRequiredValue = tiktokCommercialRequired({ affiliateRequired, tiktok });
  const tiktokCommercialPresentValue = tiktokCommercialPresent(tiktok);
  const tiktokAi = tiktokAiPresent({ tiktok, aiGate });
  const metaRequired = metaBrandedRequired({ instagram, facebook, platformManifest, paidRequired });
  const metaPresent = metaBrandedPresent({ instagram, facebook });
  const vertical = financeVertical({ canonical, affiliate, financeGate });
  const financeReviewRequired = Boolean(
    gateFailed(financeGate) ||
      vertical !== "non_financial" && (FINANCE_PROMO_RE.test(allText) || affiliateLinks(affiliate).length > 0 || hasAffiliateLink(affiliate, landing)),
  );
  const reusedAssetRisk = asArray(rightsLedger.assets).some((asset) =>
    REUSED_ASSET_RE.test(objectText(asset)),
  );
  const reusedFailure = gateFailed(reusedGate) || containsFailure(platformPolicyReport, /reused_content/i) || reusedAssetRisk;
  const shortsLinkRisk = directShortsLinkRisk(youtube);
  const xAutomationRisk = Boolean(
    x.auto_reply_enabled === true ||
      x.automated_replies_enabled === true ||
      x.auto_dm_enabled === true ||
      x.auto_engagement_enabled === true ||
      /auto.?reply|auto.?dm|sub4sub|follow for follow/i.test(objectText(x)),
  );
  const repeatedRisk = Boolean(
    gateFailed(antiSpamGate) ||
      normaliseStatus(evidence.verdict) === "fail" ||
      repeatedThreadText(x, threads, evidence) ||
      hashtagCount(outputs) > 24 ||
      SPAM_RE.test(allText),
  );
  const misinformationRisk = Boolean(
    asArray(canonical.prohibited_claims || canonical.claim_inventory?.prohibited).length ||
      asArray(canonical.unconfirmed_claims || canonical.claim_inventory?.unconfirmed).length ||
      /guaranteed returns?|this will pump|risk-free/i.test(allText),
  );

  const policyChecks = {
    youtube_reused_content_risk: checkFromBlocker(reusedFailure, "policy:youtube_reused_content_risk", {
      gate: reusedGate,
      rights_asset_risk: reusedAssetRisk,
    }, gateWarnings(reusedGate)),
    youtube_paid_promotion_disclosure: checkFromBlocker(
      (paidRequired && !paidPresent) || containsFailure(policyGate, /youtube_paid_promotion/i),
      "policy:youtube_paid_promotion_disclosure_missing",
      { required: paidRequired, present: paidPresent, gate: policyGate },
      gateWarnings(policyGate).filter((warning) => /paid_promotion/i.test(warning)),
    ),
    youtube_altered_synthetic_disclosure: checkFromBlocker(
      syntheticRequired && !youtubeSynthetic,
      "policy:youtube_altered_synthetic_disclosure_missing",
      { required: syntheticRequired, present: youtubeSynthetic, gate: aiGate },
      gateWarnings(aiGate),
    ),
    youtube_shorts_link_limitations: checkFromBlocker(shortsLinkRisk, "policy:youtube_shorts_link_limitation_unhandled", {
      link_strategy: youtube.link_strategy || null,
      product_link_eligibility: youtube.product_link_eligibility || null,
    }),
    tiktok_commercial_disclosure: checkFromBlocker(
      tiktokCommercialRequiredValue && !tiktokCommercialPresentValue,
      "policy:tiktok_commercial_disclosure_missing",
      { required: tiktokCommercialRequiredValue, present: tiktokCommercialPresentValue },
    ),
    tiktok_ai_disclosure: checkFromBlocker(
      syntheticRequired && !tiktokAi,
      "policy:tiktok_ai_disclosure_missing",
      { required: syntheticRequired, present: tiktokAi, gate: aiGate },
      gateWarnings(aiGate),
    ),
    meta_branded_content: checkFromBlocker(metaRequired && !metaPresent, "policy:meta_branded_content_disclosure_missing", {
      required: metaRequired,
      present: metaPresent,
    }),
    x_automation_spam: checkFromBlocker(xAutomationRisk, "policy:x_automation_spam_risk", {
      auto_reply_enabled: x.auto_reply_enabled === true || x.automated_replies_enabled === true,
    }),
    affiliate_disclosure: checkFromBlocker(
      (affiliateRequired && !affiliatePresent) || gateFailed(affiliateGate),
      "policy:affiliate_disclosure_missing",
      { required: affiliateRequired, present: affiliatePresent, gate: affiliateGate },
      gateWarnings(affiliateGate),
    ),
    finance_crypto_risk: checkFromBlocker(financeReviewRequired, "policy:finance_crypto_review_required", {
      vertical,
      gate: financeGate,
      promotional_language_detected: FINANCE_PROMO_RE.test(allText),
    }, gateWarnings(financeGate)),
    misinformation_risk: checkFromBlocker(misinformationRisk, "policy:misinformation_risk", {
      unconfirmed_claim_count: asArray(canonical.unconfirmed_claims || canonical.claim_inventory?.unconfirmed).length,
      prohibited_claim_count: asArray(canonical.prohibited_claims || canonical.claim_inventory?.prohibited).length,
    }),
    spam_repetitive_content: checkFromBlocker(repeatedRisk, "policy:spam_repetitive_content", {
      gate: antiSpamGate,
      platform_native_evidence_verdict: evidence.verdict || null,
      blind_duplicate_pairs: asArray(evidence.blind_duplicate_pairs || evidence.duplicate_pairs),
    }, gateWarnings(antiSpamGate)),
  };

  const directBlockers = unique(Object.values(policyChecks).flatMap((check) => check.blockers));
  const upstream = upstreamBlockers(storyId, context.landingIndex);
  const blockers = unique([...upstream, ...directBlockers]);
  const disclosureRequirements = buildDisclosureRequirements({
    affiliateRequired,
    affiliatePresent,
    paidRequired,
    paidPresent,
    syntheticRequired,
    youtubeSynthetic,
    tiktokCommercialRequiredValue,
    tiktokCommercialPresentValue,
    tiktokAi,
    metaRequired,
    metaPresent,
    financeReviewRequired,
    xManualReviewRequired: xAutomationRisk,
    shortsLinkHandled: !shortsLinkRisk,
  });

  return {
    story_id: storyId,
    title: cleanText(canonical.selected_title || canonical.short_title || canonical.canonical_title || storyPackage.title),
    artifact_dir: artifactDir,
    status: blockers.length ? "blocked" : "ready",
    direct_policy_status: directBlockers.length ? "blocked" : "pass",
    upstream_status: upstream.length ? "blocked" : "ready",
    blockers,
    upstream_blockers: upstream,
    direct_policy_blockers: directBlockers,
    policy_checks: policyChecks,
    disclosure_requirements: disclosureRequirements,
    platform_policy_source: {
      platform_publish_manifest_present: Object.keys(platformManifest).length > 0,
      platform_policy_report_present: Object.keys(platformPolicyReport).length > 0,
      affiliate_manifest_present: Object.keys(affiliate).length > 0,
      landing_manifest_present: Object.keys(landing).length > 0,
      rights_ledger_present: Object.keys(rightsLedger).length > 0,
      policy_gate_verdict: policyGate.verdict || policyGate.result || null,
      reused_content_gate_verdict: reusedGate.verdict || reusedGate.result || null,
      anti_spam_gate_verdict: antiSpamGate.verdict || antiSpamGate.result || null,
      finance_crypto_gate_verdict: financeGate.verdict || financeGate.result || null,
    },
    evidence: {
      affiliate_required: affiliateRequired,
      affiliate_present: affiliatePresent,
      paid_promotion_required: paidRequired,
      paid_promotion_present: paidPresent,
      synthetic_disclosure_required: syntheticRequired,
      youtube_synthetic_present: youtubeSynthetic,
      tiktok_commercial_required: tiktokCommercialRequiredValue,
      tiktok_commercial_present: tiktokCommercialPresentValue,
      tiktok_ai_present: tiktokAi,
      meta_branded_required: metaRequired,
      meta_branded_present: metaPresent,
      finance_crypto_vertical: vertical,
      x_automation_risk: xAutomationRisk,
      spam_repetitive_risk: repeatedRisk,
      misinformation_risk: misinformationRisk,
    },
    safety: {
      local_proof_only: true,
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

function directRiskCounts(stories = []) {
  const counts = {};
  for (const story of asArray(stories)) {
    for (const blocker of asArray(story.direct_policy_blockers)) counts[blocker] = (counts[blocker] || 0) + 1;
  }
  return counts;
}

function buildPlatformPolicyReportArtifact(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    direct_policy_verdict: report.direct_policy_verdict || "UNKNOWN",
    required_checks: REQUIRED_POLICY_CHECKS,
    stories: asArray(report.stories).filter((story) => story.status !== "skipped").map((story) => ({
      story_id: story.story_id,
      status: story.direct_policy_status,
      blockers: story.direct_policy_blockers,
      checks: story.policy_checks,
      source: story.platform_policy_source,
    })),
    safety: {
      local_proof_only: true,
      no_publish_triggered: true,
      no_platform_uploads: true,
      no_external_posting: true,
    },
  };
}

function buildDisclosureRequirementsArtifact(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    stories: asArray(report.stories).filter((story) => story.status !== "skipped").map((story) => ({
      story_id: story.story_id,
      status: story.direct_policy_status,
      requirements: story.disclosure_requirements,
    })),
    safety: {
      no_platform_disclosure_toggle_mutation: true,
      no_external_posting: true,
      no_oauth_or_token_change: true,
    },
  };
}

function buildPublishBlockersArtifact(report = {}) {
  const stories = asArray(report.stories).filter((story) => story.status !== "skipped").map((story) => ({
    story_id: story.story_id,
    publish_allowed: false,
    status: story.status,
    direct_policy_status: story.direct_policy_status,
    upstream_status: story.upstream_status,
    blockers: story.blockers,
    direct_policy_blockers: story.direct_policy_blockers,
    upstream_blockers: story.upstream_blockers,
    next_required_action: story.blockers.length
      ? "resolve_listed_blockers_before_any_publish_action"
      : "operator_review_still_required_before_publish",
  }));
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    publish_allowed: false,
    publish_now_count: 0,
    blocked_story_count: stories.filter((story) => story.blockers.length).length,
    stories,
    safety: {
      no_publish_action: true,
      no_platform_uploads: true,
      no_external_posting: true,
      no_production_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_values_exposed: true,
    },
  };
}

async function buildGoal17PlatformPolicyEngine({
  storyPackages = [],
  upstreamLandingReport = {},
  workspaceRoot = process.cwd(),
  outputDir,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!outputDir) throw new Error("buildGoal17PlatformPolicyEngine requires outputDir");
  await fs.ensureDir(path.resolve(outputDir));
  const landingIndex = buildLandingIndex(upstreamLandingReport);
  const stories = [];
  for (const storyPackage of asArray(storyPackages)) {
    stories.push(await inspectStoryPackage(storyPackage, { workspaceRoot, landingIndex }));
  }
  const activeStories = stories.filter((story) => story.status !== "skipped");
  const skippedStories = stories.filter((story) => story.status === "skipped");
  const readyStories = activeStories.filter((story) => story.status === "ready");
  const blockedStories = activeStories.filter((story) => story.status === "blocked");
  const directPassStories = activeStories.filter((story) => story.direct_policy_status === "pass");
  const directBlockedStories = activeStories.filter((story) => story.direct_policy_status !== "pass");
  const verdict = !activeStories.length
    ? "FAIL"
    : blockedStories.length && readyStories.length
      ? "PARTIAL"
      : blockedStories.length
        ? "BLOCKED"
        : "PASS";
  const directPolicyVerdict = !activeStories.length
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
    direct_policy_verdict: directPolicyVerdict,
    summary: {
      story_count: stories.length,
      active_story_count: activeStories.length,
      skipped_story_count: skippedStories.length,
      policy_ready_story_count: readyStories.length,
      blocked_story_count: blockedStories.length,
      direct_policy_pass_story_count: directPassStories.length,
      direct_policy_blocked_story_count: directBlockedStories.length,
      youtube_reused_content_checked_story_count: activeStories.filter((story) => story.policy_checks.youtube_reused_content_risk).length,
      affiliate_disclosure_required_story_count: activeStories.filter((story) => story.evidence.affiliate_required).length,
      finance_crypto_review_required_story_count: activeStories.filter((story) => story.evidence.finance_crypto_vertical !== "non_financial").length,
      publish_now_count: 0,
    },
    required_policy_checks: REQUIRED_POLICY_CHECKS,
    blocker_counts: blockerCounts(activeStories),
    direct_risk_counts: directRiskCounts(activeStories),
    upstream_blockers: {
      goal16_landing_page_engine:
        "Goal 17 can inspect platform policy, disclosure and publish blockers, but readiness requires Goal 16 and its upstream gates to be ready first.",
      note:
        "This gate emits local proof only. It does not publish, upload, post externally, mutate production rows, inspect secrets or change OAuth/token state.",
    },
    stories,
    safety: {
      local_proof_only: true,
      no_publish_triggered: true,
      no_platform_uploads: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_values_exposed: true,
      no_gate_weakened: true,
    },
  };
  report.platform_policy_report = buildPlatformPolicyReportArtifact(report);
  report.disclosure_requirements = buildDisclosureRequirementsArtifact(report);
  report.publish_blockers = buildPublishBlockersArtifact(report);
  return report;
}

function renderGoal17PlatformPolicyEngineMarkdown(report = {}) {
  const lines = [];
  lines.push("# Goal 17 Platform Policy Engine");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Verdict: ${report.verdict || "UNKNOWN"}`);
  lines.push(`Direct policy verdict: ${report.direct_policy_verdict || "UNKNOWN"}`);
  lines.push(`Stories checked: ${report.summary?.story_count || 0}`);
  lines.push(`Full policy-ready stories: ${report.summary?.policy_ready_story_count || 0}`);
  lines.push(`Direct policy-pass stories: ${report.summary?.direct_policy_pass_story_count || 0}`);
  lines.push(`Direct policy-blocked stories: ${report.summary?.direct_policy_blocked_story_count || 0}`);
  lines.push(`Affiliate disclosure required stories: ${report.summary?.affiliate_disclosure_required_story_count || 0}`);
  lines.push(`Finance/crypto review required stories: ${report.summary?.finance_crypto_review_required_story_count || 0}`);
  lines.push(`Publish-now actions: ${report.summary?.publish_now_count || 0}`);
  lines.push("");
  lines.push("## Blockers");
  const blockers = Object.keys(report.blocker_counts || {}).sort();
  if (!blockers.length) lines.push("- none");
  for (const blocker of blockers) lines.push(`- ${blocker}: ${report.blocker_counts[blocker]}`);
  lines.push("");
  lines.push("## Direct Policy Hard Fails");
  const direct = Object.keys(report.direct_risk_counts || {}).sort();
  if (!direct.length) lines.push("- none");
  for (const blocker of direct) lines.push(`- ${blocker}: ${report.direct_risk_counts[blocker]}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("LOCAL_PROOF only. This run did not publish, upload, post externally, mutate the database, touch OAuth or token files, inspect secrets or weaken gates.");
  return `${lines.join("\n")}\n`;
}

async function writeGoal17PlatformPolicyEngine(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoal17PlatformPolicyEngine requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const readinessJson = path.join(outDir, "goal17_readiness_report.json");
  const readinessMarkdown = path.join(outDir, "goal17_readiness_report.md");
  const platformPolicyReport = path.join(outDir, "platform_policy_report.json");
  const disclosureRequirements = path.join(outDir, "disclosure_requirements.json");
  const publishBlockers = path.join(outDir, "publish_blockers.json");
  await fs.writeJson(readinessJson, report, { spaces: 2 });
  await fs.writeFile(readinessMarkdown, renderGoal17PlatformPolicyEngineMarkdown(report), "utf8");
  await fs.writeJson(platformPolicyReport, report.platform_policy_report || buildPlatformPolicyReportArtifact(report), { spaces: 2 });
  await fs.writeJson(disclosureRequirements, report.disclosure_requirements || buildDisclosureRequirementsArtifact(report), { spaces: 2 });
  await fs.writeJson(publishBlockers, report.publish_blockers || buildPublishBlockersArtifact(report), { spaces: 2 });
  return {
    readinessJson,
    readinessMarkdown,
    platformPolicyReport,
    disclosureRequirements,
    publishBlockers,
  };
}

module.exports = {
  GOAL_ID,
  REQUIRED_POLICY_CHECKS,
  buildDisclosureRequirements: buildDisclosureRequirementsArtifact,
  buildGoal17PlatformPolicyEngine,
  buildPlatformPolicyReport: buildPlatformPolicyReportArtifact,
  buildPublishBlockers: buildPublishBlockersArtifact,
  inspectStoryPackage,
  renderGoal17PlatformPolicyEngineMarkdown,
  writeGoal17PlatformPolicyEngine,
};
