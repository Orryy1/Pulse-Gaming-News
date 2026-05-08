const dotenv = require("dotenv");
const db = require("./lib/db");
const { applyProduceSelection } = require("./lib/produce-selection");
const {
  buildPinnedComment,
} = require("./lib/affiliate-targeting");
const { auditAffiliateTargeting } = require("./lib/intelligence/monetisation-readiness");

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
    const { audit, affiliateLinks } = applyAffiliateAuditToStory(story, tag);

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
  const audit = auditAffiliateTargeting({ story, tag });
  const affiliateLinks =
    audit.verdict === "pass"
      ? audit.links.filter((link) => link.story_specific)
      : [];
  const primaryLink = affiliateLinks[0];

  story.affiliate_links = affiliateLinks;
  story.affiliate_url = primaryLink ? primaryLink.url : null;
  story.affiliate_primary_label = primaryLink ? primaryLink.label : null;
  story.affiliate_audit = {
    verdict: audit.verdict,
    rejected: audit.rejections.map((item) => item.reason),
    disclosure_required: audit.disclosure_required,
  };
  story.pinned_comment = buildPinnedComment(story, affiliateLinks);

  return { audit, affiliateLinks };
}

module.exports = processAffiliates;
module.exports.applyAffiliateAuditToStory = applyAffiliateAuditToStory;

if (require.main === module) {
  processAffiliates().catch((err) => {
    console.log(`[affiliates] ERROR: ${err.message}`);
    process.exit(1);
  });
}
