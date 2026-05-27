"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  buildAffiliateLinkManifest,
} = require("./commercial-intelligence-engine");

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function storyText(canonical = {}, storyPackage = {}) {
  return cleanText([
    canonical.selected_title,
    canonical.short_title,
    canonical.canonical_title,
    canonical.title,
    canonical.canonical_subject,
    canonical.canonical_game,
    canonical.description,
    canonical.narration_script,
    storyPackage.title,
    ...asArray(canonical.confirmed_claims),
  ].filter(Boolean).join(" ")).toLowerCase();
}

function offerText(link = {}, affiliate = {}) {
  return cleanText([
    link.label,
    link.query,
    link.product_category,
    link.category,
    affiliate.commercial_intent_type,
    affiliate.primary_affiliate_angle,
  ].filter(Boolean).join(" ")).toLowerCase();
}

function isRacingOffer(text = "") {
  return /\b(?:racing wheel|racing seat|racing monitor|racing_game_setup)\b/.test(text);
}

function isRacingStory(text = "") {
  return /\b(?:forza|gran turismo|racing|f1\s*\d*|sim racing|wheel)\b/.test(text);
}

function primaryOfferMismatch({ canonical = {}, storyPackage = {}, affiliate = {} } = {}) {
  const primary = affiliate.primary_link || {};
  const offer = offerText(primary, affiliate);
  if (isRacingOffer(offer) && !isRacingStory(storyText(canonical, storyPackage))) {
    return "racing_offer_on_non_racing_story";
  }
  return "";
}

function extractAffiliateTag(affiliate = {}) {
  const urls = [
    affiliate.primary_link?.url,
    affiliate.primary_link?.tracking_url,
    ...asArray(affiliate.fallback_links).flatMap((link) => [link.url, link.tracking_url]),
  ];
  for (const value of urls) {
    try {
      const parsed = new URL(value, "https://pulse.local");
      const tag = cleanText(parsed.searchParams.get("tag"));
      if (tag) return tag;
    } catch {}
  }
  return process.env.AMAZON_AFFILIATE_TAG || "placeholder";
}

function canonicalStoryForAffiliate(canonical = {}, storyPackage = {}) {
  return {
    id: cleanText(canonical.story_id || storyPackage.story_id || storyPackage.id),
    story_id: cleanText(canonical.story_id || storyPackage.story_id || storyPackage.id),
    title: cleanText(canonical.selected_title || canonical.short_title || canonical.canonical_title || storyPackage.title),
    selected_title: canonical.selected_title,
    short_title: canonical.short_title,
    canonical_title: canonical.canonical_title,
    canonical_subject: canonical.canonical_subject,
    canonical_game: canonical.canonical_game,
    narration_script: canonical.narration_script || canonical.full_script || canonical.tts_script,
    description: canonical.description,
    confirmed_claims: asArray(canonical.confirmed_claims),
    primary_source_url: canonical.primary_source_url || canonical.primary_source?.url || canonical.official_source?.url,
    url: canonical.primary_source_url || canonical.url,
    youtube_post_id: canonical.youtube_post_id || storyPackage.youtube_post_id,
  };
}

async function readJsonIfPresent(filePath, fallback = null) {
  try {
    if (await fs.pathExists(filePath)) return await fs.readJson(filePath);
  } catch {}
  return fallback;
}

async function backupFile(filePath, backupDir) {
  if (!(await fs.pathExists(filePath))) return null;
  await fs.ensureDir(backupDir);
  const backupPath = path.join(backupDir, path.basename(filePath));
  await fs.copy(filePath, backupPath, { overwrite: true });
  return backupPath;
}

function repairedLandingManifest(current = {}, repairedAffiliate = {}, generatedAt) {
  return {
    ...current,
    link_pack: {
      ...(current.link_pack || {}),
      primary_link: repairedAffiliate.primary_link || null,
      fallback_links: repairedAffiliate.fallback_links || [],
      source_links: repairedAffiliate.source_links || current.link_pack?.source_links || [],
      affiliate_tracking_map: repairedAffiliate.affiliate_tracking_map || null,
    },
    disclosure_block: {
      ...(current.disclosure_block || {}),
      required: repairedAffiliate.disclosure_required === true,
      copy: repairedAffiliate.disclosure_copy || current.disclosure_block?.copy || null,
      source_first: true,
    },
    tracking_utm: repairedAffiliate.tracking_utm || current.tracking_utm || null,
    attribution_manifest: repairedAffiliate.landing_page_attribution || current.attribution_manifest || null,
    revenue_tracking: repairedAffiliate.revenue_attribution || current.revenue_tracking || null,
    affiliate_relevance_repaired_at: generatedAt,
  };
}

async function inspectAffiliateRelevanceRepair(storyPackage = {}, { generatedAt = new Date().toISOString() } = {}) {
  const artifactDir = path.resolve(storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir || "");
  const storyId = cleanText(storyPackage.story_id || storyPackage.id);
  const canonicalPath = path.join(artifactDir, "canonical_story_manifest.json");
  const affiliatePath = path.join(artifactDir, "affiliate_link_manifest.json");
  const landingPath = path.join(artifactDir, "landing_page_manifest.json");
  const canonical = await readJsonIfPresent(canonicalPath, {});
  const affiliate = await readJsonIfPresent(affiliatePath, {});
  const landing = await readJsonIfPresent(landingPath, {});
  const mismatch = primaryOfferMismatch({ canonical, storyPackage, affiliate });
  if (!storyId || !artifactDir || !mismatch) {
    return {
      story_id: storyId,
      artifact_dir: artifactDir || null,
      status: mismatch ? "blocked" : "not_required",
      mismatch_reason: mismatch || null,
    };
  }
  const repairedAffiliate = buildAffiliateLinkManifest({
    story: canonicalStoryForAffiliate(canonical, storyPackage),
    tag: extractAffiliateTag(affiliate),
    generatedAt,
  });
  return {
    story_id: storyId,
    artifact_dir: artifactDir,
    status: "eligible_for_affiliate_relevance_repair",
    mismatch_reason: mismatch,
    before: {
      commercial_intent_type: affiliate.commercial_intent_type || null,
      primary_link: affiliate.primary_link || null,
    },
    after: {
      commercial_intent_type: repairedAffiliate.commercial_intent_type || null,
      primary_link: repairedAffiliate.primary_link || null,
    },
    files: {
      canonical_path: canonicalPath,
      affiliate_path: affiliatePath,
      landing_path: landingPath,
    },
    repaired_affiliate: repairedAffiliate,
    repaired_canonical: {
      ...canonical,
      commercial_intelligence: repairedAffiliate,
      affiliate_link_manifest: repairedAffiliate,
      affiliate_relevance_repaired_at: generatedAt,
    },
    repaired_landing: repairedLandingManifest(landing || {}, repairedAffiliate, generatedAt),
  };
}

async function repairGoalAffiliateRelevance({
  storyPackages = [],
  generatedAt = new Date().toISOString(),
  apply = false,
  backupRoot = "",
} = {}) {
  const inspected = [];
  const repaired = [];
  const skipped = [];
  for (const storyPackage of asArray(storyPackages)) {
    const row = await inspectAffiliateRelevanceRepair(storyPackage, { generatedAt });
    inspected.push(row);
    if (row.status !== "eligible_for_affiliate_relevance_repair") {
      skipped.push(row);
      continue;
    }
    if (apply) {
      const backupDir = path.resolve(
        backupRoot || path.join(row.artifact_dir, "backups"),
        `affiliate-relevance-${generatedAt.replace(/[:.]/g, "-")}`,
        row.story_id,
      );
      const backups = {
        canonical: await backupFile(row.files.canonical_path, backupDir),
        affiliate: await backupFile(row.files.affiliate_path, backupDir),
        landing: await backupFile(row.files.landing_path, backupDir),
      };
      await fs.writeJson(row.files.affiliate_path, row.repaired_affiliate, { spaces: 2 });
      await fs.writeJson(row.files.canonical_path, row.repaired_canonical, { spaces: 2 });
      await fs.writeJson(row.files.landing_path, row.repaired_landing, { spaces: 2 });
      repaired.push({
        ...row,
        status: "repaired",
        backups,
        repaired_affiliate: undefined,
        repaired_canonical: undefined,
        repaired_landing: undefined,
      });
    } else {
      repaired.push({
        ...row,
        status: "would_repair",
        repaired_affiliate: undefined,
        repaired_canonical: undefined,
        repaired_landing: undefined,
      });
    }
  }
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: apply ? "LOCAL_APPLY_WITH_BACKUPS" : "LOCAL_PROOF",
    summary: {
      story_count: inspected.length,
      eligible_repair_count: inspected.filter((row) => row.status === "eligible_for_affiliate_relevance_repair").length,
      repaired_count: repaired.filter((row) => row.status === "repaired").length,
      would_repair_count: repaired.filter((row) => row.status === "would_repair").length,
      skipped_count: skipped.length,
    },
    repairs: repaired,
    skipped,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_gate_weakened: true,
      applied_local_files_only: apply === true,
    },
  };
}

function renderGoalAffiliateRelevanceRepairMarkdown(report = {}) {
  const lines = [
    "# Affiliate Relevance Repair",
    "",
    `Generated: ${report.generated_at || ""}`,
    `Mode: ${report.mode || "LOCAL_PROOF"}`,
    `Eligible: ${report.summary?.eligible_repair_count || 0}`,
    `Repaired: ${report.summary?.repaired_count || 0}`,
    `Would repair: ${report.summary?.would_repair_count || 0}`,
    "",
    "Safety: local artefact repair only. No publishing, DB mutation, OAuth or token change.",
  ];
  for (const repair of asArray(report.repairs).slice(0, 40)) {
    lines.push(
      `- ${repair.story_id}: ${repair.before?.primary_link?.label || "missing"} -> ${repair.after?.primary_link?.label || "no offer"} (${repair.mismatch_reason})`,
    );
  }
  return `${lines.join("\n")}\n`;
}

async function writeGoalAffiliateRelevanceRepairReport(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoalAffiliateRelevanceRepairReport requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "affiliate_relevance_repair_report.json");
  const markdownPath = path.join(outDir, "affiliate_relevance_repair_report.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(markdownPath, renderGoalAffiliateRelevanceRepairMarkdown(report), "utf8");
  return { outputDir: outDir, jsonPath, markdownPath };
}

module.exports = {
  inspectAffiliateRelevanceRepair,
  repairGoalAffiliateRelevance,
  renderGoalAffiliateRelevanceRepairMarkdown,
  writeGoalAffiliateRelevanceRepairReport,
  primaryOfferMismatch,
};
