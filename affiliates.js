const dotenv = require("dotenv");
const db = require("./lib/db");
const { applyProduceSelection } = require("./lib/produce-selection");
const {
  buildAffiliateStack,
  buildPinnedComment,
} = require("./lib/affiliate-targeting");

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
    const affiliateLinks = buildAffiliateStack(story, { tag });
    const primaryLink = affiliateLinks[0];

    story.affiliate_links = affiliateLinks;
    story.affiliate_url = primaryLink ? primaryLink.url : null;
    story.affiliate_primary_label = primaryLink ? primaryLink.label : null;

    story.pinned_comment = buildPinnedComment(story, affiliateLinks);

    console.log(
      `[affiliates] ${story.id}: links=${affiliateLinks
        .map((link) => link.label)
        .join(", ")}`,
    );
  }

  await db.saveStories(stories);
  console.log(`[affiliates] Updated ${selectedStories.length} stories`);
}

module.exports = processAffiliates;

if (require.main === module) {
  processAffiliates().catch((err) => {
    console.log(`[affiliates] ERROR: ${err.message}`);
    process.exit(1);
  });
}
