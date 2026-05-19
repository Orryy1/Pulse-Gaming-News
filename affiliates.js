const dotenv = require("dotenv");
const path = require("node:path");
const db = require("./lib/db");
const { applyProduceSelection } = require("./lib/produce-selection");
const {
  buildPinnedComment,
} = require("./lib/affiliate-targeting");
const {
  buildAffiliateLinkManifest,
  writeAffiliateLinkManifest,
  writeCommercialLandingPage,
} = require("./lib/commercial-intelligence-engine");
const {
  buildRevenuePathManifest,
  writeRevenuePathManifest,
} = require("./lib/revenue-path-engine");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  dotenv.config({ override: true });
}

async function processAffiliates() {
  console.log("[affiliates] Loading stories from canonical store...");

  const stories = await db.getStories();
  if (!stories.length) {
    console.log("[affiliates] No stories in canonical store.");
    return;
  }
  const tag = process.env.AMAZON_AFFILIATE_TAG || "placeholder";
  const selectedStories = applyProduceSelection(stories, {
    stage: "affiliates",
    log: console.log,
  });

  for (const story of selectedStories) {
    const { audit, affiliateLinks, commercialManifest, revenuePathManifest } = applyAffiliateAuditToStory(story, tag);
    const manifestWrite = await writeAffiliateLinkManifest(commercialManifest, {
      outputDir: path.join(__dirname, "output", "commercial"),
    });
    const revenuePathWrite = await writeRevenuePathManifest(revenuePathManifest, {
      outputDir: path.join(__dirname, "output", "revenue"),
    });
    const landingWrite = await writeCommercialLandingPage(commercialManifest, {
      outputDir: path.join(__dirname, "blog", "dist", "p"),
    });
    story.affiliate_link_manifest_path = manifestWrite.path;
    story.revenue_path_manifest_path = revenuePathWrite.path;
    story.commercial_landing_page_path = landingWrite.path;

    console.log(
      `[affiliates] ${story.id}: verdict=${audit.verdict} links=${affiliateLinks
        .map((link) => link.label)
        .join(", ") || "none"}`,
    );
  }

  await db.saveStories(stories);
  console.log(`[affiliates] Updated ${selectedStories.length} stories`);
}

function applyAffiliateAuditToStory(story, tag) {
  const commercialManifest = buildAffiliateLinkManifest({ story, tag });
  const revenuePathManifest = buildRevenuePathManifest({ story, commercialManifest });
  const affiliateLinks = [
    commercialManifest.primary_link,
    ...(commercialManifest.fallback_links || []),
  ].filter(Boolean);
  const primaryLink = affiliateLinks[0];
  const rejections = commercialManifest.rejection_reasons.map((reason) => ({
    label: "story",
    url: null,
    reason,
  }));
  for (const candidate of commercialManifest.candidate_links || []) {
    for (const reason of candidate.rejection_reasons || []) {
      rejections.push({
        label: candidate.label,
        url: candidate.url || null,
        reason,
      });
    }
  }
  const audit = {
    story_id: story?.id || null,
    title: story?.title || "",
    verdict: affiliateLinks.length > 0 && rejections.length === 0 ? "pass" : "review",
    disclosure_required: commercialManifest.disclosure_required,
    disclosure_text: commercialManifest.disclosure_required
      ? commercialManifest.disclosure_copy.short
      : null,
    links: affiliateLinks,
    rejections,
    generated_reference_links: commercialManifest.candidate_links || [],
    commercial_intent_type: commercialManifest.commercial_intent_type,
  };

  story.affiliate_links = affiliateLinks;
  story.affiliate_url = primaryLink ? primaryLink.url : null;
  story.affiliate_primary_label = primaryLink ? primaryLink.label : null;
  story.affiliate_audit = {
    verdict: audit.verdict,
    rejected: audit.rejections.map((item) => item.reason),
    disclosure_required: audit.disclosure_required,
  };
  story.affiliate_link_manifest = commercialManifest;
  story.commercial_intelligence = {
    vertical: commercialManifest.vertical,
    commercial_intent_type: commercialManifest.commercial_intent_type,
    primary_affiliate_angle: commercialManifest.primary_affiliate_angle,
    revenue_score: commercialManifest.revenue_score,
    compliance_risk_score: commercialManifest.compliance_risk_score,
    disclosure_required: commercialManifest.disclosure_required,
  };
  story.commercial_landing_page_route = commercialManifest.landing_page_route;
  story.commercial_opportunity_score = commercialManifest.commercial_opportunity_score;
  story.revenue_path_manifest = revenuePathManifest;
  story.revenue_path_engine = {
    version: "v2",
    verdict: revenuePathManifest.path_gate.verdict,
    score: revenuePathManifest.revenue_path_score,
    primary_path_type: revenuePathManifest.primary_path.path_type,
  };
  story.pinned_comment = buildPinnedComment(story, affiliateLinks);

  return { audit, affiliateLinks, commercialManifest, revenuePathManifest };
}

module.exports = processAffiliates;
module.exports.applyAffiliateAuditToStory = applyAffiliateAuditToStory;

if (require.main === module) {
  processAffiliates().catch((err) => {
    console.log(`[affiliates] ERROR: ${err.message}`);
    process.exit(1);
  });
}
