const fs = require("fs-extra");
const dotenv = require("dotenv");
const db = require("./lib/db");

dotenv.config({ override: true });

// Genre/platform detection for deep-linked affiliate products
const PLATFORM_PRODUCTS = {
  ps5: { search: "PS5 DualSense Controller", asin: "" },
  ps6: { search: "PlayStation Accessories", asin: "" },
  playstation: { search: "PS5 DualSense Charging Station", asin: "" },
  xbox: { search: "Xbox Elite Controller Series 2", asin: "" },
  nintendo: { search: "Nintendo Switch Pro Controller", asin: "" },
  switch: { search: "Nintendo Switch OLED", asin: "" },
  "steam deck": { search: "Steam Deck Accessories", asin: "" },
  pc: { search: "Gaming Mouse Logitech", asin: "" },
};

const GENRE_PRODUCTS = {
  fps: { search: "Gaming Headset 7.1 Surround", asin: "" },
  shooter: { search: "Gaming Headset 7.1 Surround", asin: "" },
  "call of duty": { search: "Gaming Headset 7.1 Surround", asin: "" },
  battlefield: { search: "Gaming Headset 7.1 Surround", asin: "" },
  racing: { search: "Racing Wheel PS5 Xbox", asin: "" },
  forza: { search: "Racing Wheel PS5 Xbox", asin: "" },
  "gran turismo": { search: "Racing Wheel PS5 Xbox", asin: "" },
  rpg: { search: "Gaming Chair Ergonomic", asin: "" },
  "elden ring": { search: "Gaming Chair Ergonomic", asin: "" },
  vr: { search: "Meta Quest 3", asin: "" },
  psvr: { search: "PlayStation VR2", asin: "" },
};

// Existing game keywords still used for title matching
const GAME_KEYWORDS = [
  "playstation",
  "ps5",
  "ps6",
  "xbox",
  "nintendo",
  "switch",
  "steam",
  "deck",
  "gta",
  "elder scrolls",
  "call of duty",
  "cod",
  "halo",
  "zelda",
  "mario",
  "elden ring",
  "starfield",
  "cyberpunk",
  "diablo",
  "final fantasy",
  "resident evil",
  "god of war",
  "horizon",
  "spider-man",
  "forza",
  "battlefield",
  "assassin",
  "witcher",
  "mass effect",
  "fallout",
  "doom",
  "minecraft",
  "fortnite",
  "overwatch",
  "valorant",
];

function extractProduct(title) {
  const lower = title.toLowerCase();

  // Priority 1: Platform-specific accessory (highest CTR)
  for (const [keyword, product] of Object.entries(PLATFORM_PRODUCTS)) {
    if (lower.includes(keyword)) return product.search;
  }

  // Priority 2: Genre-specific accessory
  for (const [keyword, product] of Object.entries(GENRE_PRODUCTS)) {
    if (lower.includes(keyword)) return product.search;
  }

  // Priority 3: Game title search
  for (const keyword of GAME_KEYWORDS) {
    if (lower.includes(keyword)) {
      return keyword
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    }
  }

  return "gaming headset";
}

async function processAffiliates() {
  console.log("[affiliates] Loading stories from canonical store...");

  const stories = await db.getStories();
  if (!stories.length) {
    console.log("[affiliates] No stories in canonical store.");
    return;
  }
  const tag = process.env.AMAZON_AFFILIATE_TAG || "placeholder";

  for (const story of stories) {
    const product = extractProduct(story.title);
    const affiliateUrl = `https://www.amazon.co.uk/s?k=${encodeURIComponent(product)}&tag=${tag}`;

    story.affiliate_url = affiliateUrl;

    story.pinned_comment = `Check it out here: ${affiliateUrl} | Source: r/${story.subreddit} | Verified gaming leaks daily at 8AM and 6PM`;

    console.log(`[affiliates] ${story.id}: product="${product}"`);
  }

  await db.saveStories(stories);
  console.log(`[affiliates] Updated ${stories.length} stories`);
}

module.exports = processAffiliates;

if (require.main === module) {
  processAffiliates().catch((err) => {
    console.log(`[affiliates] ERROR: ${err.message}`);
    process.exit(1);
  });
}
