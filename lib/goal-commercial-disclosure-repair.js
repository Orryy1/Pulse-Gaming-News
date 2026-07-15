"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const { evaluateIncidentGuard } = require("./incident-guard");
const { materialiseGovernedCommercialEvidence } = require("./goal-proof-package");
const { commercialIntegrationValue } = require("./goal10-gold-standard-forensics-engine");

const PLATFORM_KEYS = ["youtube", "tiktok", "instagram", "facebook", "x", "threads", "pinterest"];

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function safeTimestamp(value = new Date().toISOString()) {
  return String(value).replace(/[:.]/g, "-");
}

async function readJsonIfPresent(filePath, fallback = {}) {
  try {
    if (await fs.pathExists(filePath)) return await fs.readJson(filePath);
  } catch {}
  return fallback;
}

async function backupIfPresent(filePath, backupDir) {
  if (!(await fs.pathExists(filePath))) return null;
  await fs.ensureDir(backupDir);
  const backupPath = path.join(backupDir, path.basename(filePath));
  await fs.copy(filePath, backupPath, { overwrite: true });
  return backupPath;
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function usableAttachedOffer(value) {
  if (typeof value === "string") return /^https?:\/\//i.test(cleanText(value));
  if (!isRecord(value)) return false;
  const rejectionReasons = asArray(value.rejection_reasons || value.blockers)
    .map(cleanText)
    .filter(Boolean);
  const status = cleanText(value.approval_status || value.status || value.verdict).toLowerCase();
  if (rejectionReasons.length || /^(?:reject|rejected|blocked|defer|deferred|fail|failed)$/.test(status)) {
    return false;
  }
  return /^https?:\/\//i.test(cleanText(
    value.url || value.affiliate_url || value.product_url || value.merchant_url || value.href,
  ));
}

function hasAttachedOffer(affiliate = {}, story = {}) {
  return Boolean(
    usableAttachedOffer(affiliate.primary_link) ||
      asArray(affiliate.fallback_links).some(usableAttachedOffer) ||
      asArray(affiliate.offers).some(usableAttachedOffer) ||
      /^https?:\/\//i.test(cleanText(story.affiliate_url)),
  );
}

function disclosureCopy(hasAffiliate) {
  if (hasAffiliate) {
    return {
      short: "Affiliate links may earn us a commission.",
      landing:
        "Affiliate links may earn us a commission. We only attach them when they fit the story.",
      video: "Affiliate links are disclosed on the story page where relevant.",
    };
  }
  return {
    short: "No affiliate link is attached to this story.",
    landing:
      "No affiliate link is attached to this story. Deal details are editorial and source-led.",
      video: "No affiliate link is attached to this story.",
  };
}

function buildCommercialDisclosure({ storyId = "", hasAffiliate = false, generatedAt = "" } = {}) {
  const copy = disclosureCopy(hasAffiliate);
  return {
    schema_version: 1,
    story_id: storyId,
    verdict: "pass",
    required: true,
    affiliate_disclosure_required: hasAffiliate,
    commercial_disclosure_required: true,
    paid_promotion_required: false,
    no_affiliate_link: !hasAffiliate,
    commercial_context: hasAffiliate ? "affiliate_deal_coverage" : "editorial_price_or_deal_coverage",
    disclosure_text: copy.short,
    disclosure_copy: copy,
    repaired_at: generatedAt,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function platformDisclosure(disclosure) {
  return PLATFORM_KEYS.reduce((out, platform) => {
    out[platform] = {
      platform,
      commercial_disclosure_required: true,
      affiliate_disclosure_required: disclosure.affiliate_disclosure_required === true,
      paid_promotion_required: false,
      caption_copy: disclosure.disclosure_text,
    };
    return out;
  }, {});
}

function commercialStory({ storyId, canonical = {} } = {}) {
  return {
    ...canonical,
    id: storyId,
    story_id: storyId,
    title:
      canonical.selected_title ||
      canonical.short_title ||
      canonical.canonical_title ||
      canonical.title ||
      canonical.canonical_subject ||
      storyId,
    primary_source_url:
      canonical.primary_source_url ||
      canonical.primary_source?.url ||
      canonical.official_source?.url ||
      canonical.source_url ||
      canonical.article_url ||
      canonical.url,
  };
}

function existingOfferTrackingUrl(affiliate = {}, primaryLink = {}, platform) {
  const platformRow = affiliate.landing_page_attribution?.platforms?.[platform];
  const trackedRow = asArray(affiliate.landing_page_attribution?.link_tracking)
    .find((row) => cleanText(row?.platform) === platform);
  return cleanText(
    primaryLink.platform_tracking_urls?.[platform] ||
      affiliate.affiliate_tracking_map?.platforms?.[platform] ||
      platformRow?.offer_tracking_url ||
      trackedRow?.offer_tracking_url,
  );
}

function offerTrackingRoute({ storyId, offerId, platform, ctaVariant, videoId } = {}) {
  if (!cleanText(storyId) || !cleanText(offerId)) return null;
  const query = new URLSearchParams({
    platform: cleanText(platform || "story_page"),
    cta: cleanText(ctaVariant || "offer"),
  });
  if (cleanText(videoId)) query.set("video_id", cleanText(videoId));
  return `/go/${encodeURIComponent(storyId)}/${encodeURIComponent(offerId)}?${query.toString()}`;
}

function prepareAttachedOfferEvidence({ affiliate = {}, story = {}, disclosure } = {}) {
  if (!hasAttachedOffer(affiliate, story)) return affiliate;

  const primaryLink = isRecord(affiliate.primary_link) ? affiliate.primary_link : null;
  const storyId = cleanText(story.id || story.story_id || affiliate.story_id);
  const videoId = story.youtube_post_id || story.youtube_id || affiliate.video_id || null;
  const disclosureCopy = {
    ...(affiliate.disclosure_copy || {}),
    ...disclosure.disclosure_copy,
  };
  const prepared = {
    ...affiliate,
    disclosure_required: true,
    disclosure_copy: disclosureCopy,
    platform_disclosure: PLATFORM_KEYS.reduce((out, platform) => {
      out[platform] = {
        ...(affiliate.platform_disclosure?.[platform] || {}),
        affiliate_disclosure_required: true,
        commercial_relationship_toggle_required: false,
        caption_copy: disclosureCopy.short,
      };
      return out;
    }, {}),
  };

  if (!primaryLink) return prepared;

  const offerId = cleanText(primaryLink.id);
  const ctaVariant = cleanText(
    primaryLink.tracking?.cta_variant || primaryLink.product_category || "offer",
  );
  const platformTrackingUrls = PLATFORM_KEYS.reduce((out, platform) => {
    out[platform] = existingOfferTrackingUrl(affiliate, primaryLink, platform) ||
      offerTrackingRoute({ storyId, offerId, platform, ctaVariant, videoId });
    return out;
  }, {});
  const storyPageTrackingUrl = cleanText(
    primaryLink.tracking_url || affiliate.affiliate_tracking_map?.story_page,
  ) || offerTrackingRoute({
    storyId,
    offerId,
    platform: "story_page",
    ctaVariant,
    videoId,
  });
  const repairedPrimaryLink = {
    ...primaryLink,
    tracking_url: storyPageTrackingUrl,
    platform_tracking_urls: platformTrackingUrls,
  };

  return {
    ...prepared,
    primary_link: repairedPrimaryLink,
    affiliate_tracking_map: {
      ...(affiliate.affiliate_tracking_map || {}),
      story_id: storyId,
      video_id: videoId,
      primary_offer_id: offerId || null,
      story_page: storyPageTrackingUrl,
      platforms: platformTrackingUrls,
      fallback_offer_ids: asArray(affiliate.fallback_links)
        .map((link) => cleanText(link?.id))
        .filter(Boolean),
    },
  };
}

function governedCommercialEvidence({ storyId, canonical = {}, affiliate = {}, landing = {} } = {}) {
  const story = commercialStory({ storyId, canonical });
  const attachedOffer = hasAttachedOffer(affiliate, story);
  const disclosure = buildCommercialDisclosure({
    storyId,
    hasAffiliate: attachedOffer,
  });
  const preparedAffiliate = prepareAttachedOfferEvidence({ affiliate, story, disclosure });
  const manifest = materialiseGovernedCommercialEvidence({
    story,
    canonical,
    affiliateManifest: preparedAffiliate,
    landingPage: landing,
  });
  return {
    story,
    manifest,
    attached_offer: hasAttachedOffer(manifest, story),
  };
}

function repairedLandingManifest({ current = {}, affiliate = {}, disclosure, generatedAt } = {}) {
  return {
    ...current,
    story_id: current.story_id || affiliate.story_id,
    landing_page_slug: affiliate.landing_page_slug || current.landing_page_slug || current.slug || null,
    landing_page_route: affiliate.landing_page_route || current.landing_page_route || current.route || null,
    link_pack: {
      ...(current.link_pack || {}),
      primary_link: affiliate.primary_link || null,
      fallback_links: asArray(affiliate.fallback_links),
      source_links: asArray(affiliate.source_links),
      affiliate_tracking_map: affiliate.affiliate_tracking_map || null,
    },
    disclosure_block: {
      ...(current.disclosure_block || {}),
      required: affiliate.disclosure_required === true,
      type: affiliate.disclosure_required === true ? "affiliate" : "commercial_editorial",
      copy: affiliate.disclosure_copy || null,
      short: cleanText(affiliate.disclosure_copy?.short || disclosure.disclosure_text),
      source_first: true,
    },
    tracking_utm: affiliate.tracking_utm || null,
    attribution_manifest: affiliate.landing_page_attribution || null,
    revenue_tracking: affiliate.revenue_attribution || null,
    commercial_disclosure: disclosure,
    commercial_disclosure_repaired_at: generatedAt,
    safety: {
      ...(current.safety || {}),
      story_page_before_offer: true,
      no_direct_social_posting: true,
    },
  };
}

function incidentReport({
  storyId,
  canonical,
  renderManifest,
  publishVerdict,
  platformManifest,
  policy,
  affiliate,
  landing,
} = {}) {
  return evaluateIncidentGuard({
    story_id: storyId,
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

async function inspectArtifact(storyPackage = {}, { generatedAt = new Date().toISOString() } = {}) {
  const artifactDir = storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir || "";
  const storyId = storyPackage.story_id || storyPackage.id || "unknown";
  const blockers = [];
  if (!artifactDir) blockers.push("missing_artifact_dir");
  if (artifactDir && !(await fs.pathExists(artifactDir))) blockers.push("artifact_dir_missing");

  const canonical = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"))
    : {};
  const renderManifest = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "render_manifest.json"))
    : {};
  const publishVerdict = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "publish_verdict.json"))
    : {};
  const platformManifest = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "platform_publish_manifest.json"))
    : {};
  const policy = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "platform_policy_report.json"))
    : {};
  const affiliate = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "affiliate_link_manifest.json"))
    : {};
  const landing = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "landing_page_manifest.json"))
    : {};

  if (!Object.keys(canonical).length) blockers.push("canonical_manifest_missing");
  if (!Object.keys(platformManifest).length) blockers.push("platform_manifest_missing");

  const before = blockers.length
    ? { disaster_upload_blockers: [] }
    : incidentReport({
        storyId,
        canonical,
        renderManifest,
        publishVerdict,
        platformManifest,
        policy,
        affiliate,
        landing,
      });
  const incidentNeedsRepair = asArray(before.disaster_upload_blockers).includes(
    "incident:commercial_deal_disclosure_missing",
  ) || asArray(before.disaster_upload_blockers).includes("incident:affiliate_disclosure_missing");
  const evidenceComplete = Boolean(commercialIntegrationValue(affiliate));
  const repairReasons = [
    ...(incidentNeedsRepair ? ["commercial_disclosure_missing"] : []),
    ...(!evidenceComplete ? ["commercial_evidence_incomplete"] : []),
  ];
  const needsRepair = repairReasons.length > 0;
  const commercialEvidence = governedCommercialEvidence({
    storyId,
    canonical,
    affiliate,
    landing,
  });
  const affiliatePresent = commercialEvidence.attached_offer;
  const targetDisclosure = buildCommercialDisclosure({
    storyId,
    hasAffiliate: affiliatePresent,
    generatedAt,
  });
  return {
    story_id: storyId,
    artifact_dir: artifactDir || null,
    status: blockers.length ? "blocked" : needsRepair ? "repairable" : "already_disclosed",
    blockers,
    repair_reasons: repairReasons,
    current_incident_blockers: asArray(before.disaster_upload_blockers),
    target_disclosure: targetDisclosure,
    affiliate_link_present: affiliatePresent,
    generated_at: generatedAt,
  };
}

async function applyRepair(item = {}, { generatedAt = new Date().toISOString(), backupRoot = "" } = {}) {
  const artifactDir = item.artifact_dir;
  const backupDir = backupRoot
    ? path.join(path.resolve(backupRoot), item.story_id)
    : path.join(artifactDir, ".commercial-disclosure-backup", safeTimestamp(generatedAt));
  const canonicalPath = path.join(artifactDir, "canonical_story_manifest.json");
  const affiliatePath = path.join(artifactDir, "affiliate_link_manifest.json");
  const landingPath = path.join(artifactDir, "landing_page_manifest.json");
  const policyPath = path.join(artifactDir, "platform_policy_report.json");
  const platformPath = path.join(artifactDir, "platform_publish_manifest.json");
  const canonical = await readJsonIfPresent(canonicalPath);
  const affiliate = await readJsonIfPresent(affiliatePath);
  const landing = await readJsonIfPresent(landingPath);
  const policy = await readJsonIfPresent(policyPath);
  const platform = await readJsonIfPresent(platformPath);
  const commercialEvidence = governedCommercialEvidence({
    storyId: item.story_id,
    canonical,
    affiliate,
    landing,
  });
  const governedAffiliate = commercialEvidence.manifest;
  const disclosure = buildCommercialDisclosure({
    storyId: item.story_id,
    hasAffiliate: commercialEvidence.attached_offer,
    generatedAt,
  });
  const perPlatformDisclosure = platformDisclosure(disclosure);
  const repairedAffiliate = {
    ...governedAffiliate,
    story_id: governedAffiliate.story_id || item.story_id,
    commercial_disclosure_required: true,
    no_affiliate_link: !commercialEvidence.attached_offer,
    disclosure_required: governedAffiliate.disclosure_required === true,
    disclosure_text: disclosure.disclosure_text,
    commercial_disclosure: disclosure,
    commercial_disclosure_repaired_at: generatedAt,
  };
  const repairedLanding = repairedLandingManifest({
    current: landing,
    affiliate: repairedAffiliate,
    disclosure,
    generatedAt,
  });
  const backupFiles = {
    affiliate_link_manifest: await backupIfPresent(affiliatePath, backupDir),
    landing_page_manifest: await backupIfPresent(landingPath, backupDir),
    platform_policy_report: await backupIfPresent(policyPath, backupDir),
    platform_publish_manifest: await backupIfPresent(platformPath, backupDir),
  };

  await fs.writeJson(affiliatePath, repairedAffiliate, { spaces: 2 });

  await fs.writeJson(policyPath, {
    ...policy,
    story_id: policy.story_id || item.story_id,
    disclosure_requirements: {
      ...(policy.disclosure_requirements || {}),
      commercial: true,
      affiliate: disclosure.affiliate_disclosure_required === true,
      paid_promotion: false,
      disclosure_text: disclosure.disclosure_text,
    },
    disclosures: {
      ...(policy.disclosures || {}),
      commercial: true,
      affiliate: disclosure.affiliate_disclosure_required === true,
      paid_promotion: false,
    },
    platform_disclosure: {
      ...(policy.platform_disclosure || {}),
      ...perPlatformDisclosure,
    },
    disclosure_text: disclosure.disclosure_text,
    commercial_disclosure: disclosure,
    commercial_disclosure_repaired_at: generatedAt,
  }, { spaces: 2 });

  await fs.writeJson(landingPath, repairedLanding, { spaces: 2 });

  await fs.writeJson(platformPath, {
    ...platform,
    commercial_disclosure: disclosure,
    landing_page_attribution: repairedAffiliate.landing_page_attribution,
    platform_disclosure: {
      ...(platform.platform_disclosure || {}),
      ...perPlatformDisclosure,
    },
    commercial_disclosure_repaired_at: generatedAt,
    no_publish_triggered: true,
  }, { spaces: 2 });

  return {
    story_id: item.story_id,
    artifact_dir: artifactDir,
    backup_dir: backupDir,
    backup_files: backupFiles,
    repaired_files: [affiliatePath, landingPath, policyPath, platformPath],
  };
}

async function repairGoalCommercialDisclosure({
  storyPackages = [],
  generatedAt = new Date().toISOString(),
  apply = false,
  backupRoot = "",
} = {}) {
  const inspected = [];
  for (const storyPackage of asArray(storyPackages)) {
    inspected.push(await inspectArtifact(storyPackage, { generatedAt }));
  }
  const repairable = inspected.filter((item) => item.status === "repairable");
  const repairs = [];
  if (apply) {
    for (const item of repairable) {
      repairs.push(await applyRepair(item, { generatedAt, backupRoot }));
    }
  }
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: apply ? "APPLY_COMMERCIAL_DISCLOSURE_REPAIR" : "DRY_RUN_COMMERCIAL_DISCLOSURE_REPAIR",
    summary: {
      story_count: inspected.length,
      repairable_count: repairable.length,
      repaired_count: repairs.length,
      already_disclosed_count: inspected.filter((item) => item.status === "already_disclosed").length,
      blocked_count: inspected.filter((item) => item.status === "blocked").length,
    },
    items: inspected.map((item) => ({
      story_id: item.story_id,
      artifact_dir: item.artifact_dir,
      status: item.status,
      blockers: item.blockers,
      repair_reasons: item.repair_reasons,
      current_incident_blockers: item.current_incident_blockers,
      affiliate_link_present: item.affiliate_link_present,
      target_disclosure_text: item.target_disclosure.disclosure_text,
    })),
    repairs,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      local_artifact_files_only: true,
    },
  };
}

function renderGoalCommercialDisclosureRepairMarkdown(report = {}) {
  const lines = [];
  lines.push("# Goal Commercial Disclosure Repair");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Mode: ${report.mode || ""}`);
  lines.push(`Stories: ${report.summary?.story_count || 0}`);
  lines.push(`Repairable: ${report.summary?.repairable_count || 0}`);
  lines.push(`Repaired: ${report.summary?.repaired_count || 0}`);
  lines.push(`Already disclosed: ${report.summary?.already_disclosed_count || 0}`);
  lines.push(`Blocked: ${report.summary?.blocked_count || 0}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("- No publish API calls are made.");
  lines.push("- No database rows are mutated.");
  lines.push("- No OAuth or token settings are changed.");
  lines.push("- Only local story package artefacts are edited when apply mode is used.");
  lines.push("");
  lines.push("## Repair Queue");
  const items = asArray(report.items).filter((item) => item.status === "repairable");
  if (!items.length) lines.push("- none");
  for (const item of items.slice(0, 20)) {
    lines.push(`- ${item.story_id}: ${item.target_disclosure_text}`);
  }
  return `${lines.join("\n")}\n`;
}

async function writeGoalCommercialDisclosureRepairReport(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoalCommercialDisclosureRepairReport requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "commercial_disclosure_repair_report.json");
  const markdownPath = path.join(outDir, "commercial_disclosure_repair_report.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(markdownPath, renderGoalCommercialDisclosureRepairMarkdown(report), "utf8");
  return { outputDir: outDir, jsonPath, markdownPath };
}

module.exports = {
  repairGoalCommercialDisclosure,
  renderGoalCommercialDisclosureRepairMarkdown,
  writeGoalCommercialDisclosureRepairReport,
};
