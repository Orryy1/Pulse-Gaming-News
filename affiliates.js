const fs = require('fs-extra');
const dotenv = require('dotenv');

dotenv.config({ override: true });

const GAME_KEYWORDS = [
  'playstation', 'ps5', 'ps6', 'xbox', 'nintendo', 'switch', 'steam', 'deck',
  'gta', 'elder scrolls', 'call of duty', 'cod', 'halo', 'zelda', 'mario',
  'elden ring', 'starfield', 'cyberpunk', 'diablo', 'final fantasy',
  'resident evil', 'god of war', 'horizon', 'spider-man', 'forza',
  'battlefield', 'assassin', 'witcher', 'mass effect', 'fallout',
  'doom', 'minecraft', 'fortnite', 'overwatch', 'valorant',
];

function extractProduct(title) {
  const lower = title.toLowerCase();
  for (const keyword of GAME_KEYWORDS) {
    if (lower.includes(keyword)) {
      return keyword.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }
  }
  return 'gaming headset';
}

async function processAffiliates() {
  console.log('[affiliates] Loading daily_news.json...');

  if (!await fs.pathExists('daily_news.json')) {
    console.log('[affiliates] ERROR: daily_news.json not found.');
    return;
  }

  const stories = await fs.readJson('daily_news.json');
  const tag = process.env.AMAZON_AFFILIATE_TAG || 'placeholder';

  for (const story of stories) {
    const product = extractProduct(story.title);
    const affiliateUrl = `https://www.amazon.co.uk/s?k=${encodeURIComponent(product)}&tag=${tag}`;

    story.affiliate_url = affiliateUrl;

    story.pinned_comment = `Check it out here: ${affiliateUrl} | Source: r/${story.subreddit} | Verified gaming leaks daily at 8AM and 6PM`;

    console.log(`[affiliates] ${story.id}: product="${product}"`);
  }

  await fs.writeJson('daily_news.json', stories, { spaces: 2 });
  console.log(`[affiliates] Updated ${stories.length} stories`);
}

module.exports = processAffiliates;

if (require.main === module) {
  processAffiliates().catch(err => {
    console.log(`[affiliates] ERROR: ${err.message}`);
    process.exit(1);
  });
}
