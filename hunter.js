const axios = require('axios');
const fs = require('fs-extra');
const dotenv = require('dotenv');

dotenv.config();

const USER_AGENT = 'pulse-gaming-hunter/1.0 (personal use)';

function similarity(a, b) {
  const wordsA = a.toLowerCase().split(/\s+/);
  const wordsB = b.toLowerCase().split(/\s+/);
  const setA = new Set(wordsA);
  const setB = new Set(wordsB);
  const intersection = [...setA].filter(w => setB.has(w));
  const union = new Set([...setA, ...setB]);
  return intersection.length / union.size;
}

async function fetchSubreddit(subreddit) {
  const url = `https://www.reddit.com/r/${subreddit}/top.json?limit=50&t=day`;
  console.log(`[hunter] Fetching: ${url}`);

  const response = await axios.get(url, {
    headers: { 'User-Agent': USER_AGENT },
    timeout: 15000,
  });

  const children = response.data?.data?.children || [];
  return children.map(c => c.data);
}

async function fetchTopComment(subreddit, postId) {
  try {
    const url = `https://www.reddit.com/r/${subreddit}/comments/${postId}.json?limit=1`;
    const response = await axios.get(url, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 10000,
    });

    const commentListing = response.data?.[1]?.data?.children || [];
    if (commentListing.length > 0 && commentListing[0].data?.body) {
      return commentListing[0].data.body.substring(0, 500);
    }
  } catch (err) {
    console.log(`[hunter] Could not fetch top comment for ${postId}: ${err.message}`);
  }
  return '';
}

async function hunt() {
  console.log('[hunter] Starting Reddit hunt (public JSON API, no auth)...');

  const subreddits = ['GamingLeaksAndRumours', 'PCMasterRace'];
  const includeRumours = process.env.INCLUDE_RUMOURS === 'true';
  const allowedFlairs = ['Verified', 'Highly Likely'];
  if (includeRumours) allowedFlairs.push('Rumour');

  console.log(`[hunter] Fetching from: ${subreddits.join(', ')}`);
  console.log(`[hunter] Allowed flairs: ${allowedFlairs.join(', ')}`);

  let allPosts = [];

  for (const sub of subreddits) {
    try {
      const posts = await fetchSubreddit(sub);
      console.log(`[hunter] r/${sub}: ${posts.length} posts fetched`);

      for (const post of posts) {
        const flair = post.link_flair_text || '';
        const matchesFlair = allowedFlairs.some(f => flair.toLowerCase().includes(f.toLowerCase()));

        if (!matchesFlair) continue;

        const topComment = await fetchTopComment(sub, post.id);

        allPosts.push({
          id: post.id,
          title: post.title,
          url: post.url,
          score: post.score,
          flair: flair,
          subreddit: sub,
          top_comment: topComment,
          timestamp: new Date(post.created_utc * 1000).toISOString(),
          num_comments: post.num_comments || 0,
        });

        // Small delay to be polite to Reddit's public API
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (err) {
      console.log(`[hunter] ERROR: Failed to fetch from r/${sub}: ${err.message}`);
    }
  }

  console.log(`[hunter] Raw qualifying posts: ${allPosts.length}`);

  // Deduplicate by title similarity
  const deduped = [];
  for (const post of allPosts) {
    const isDupe = deduped.some(existing => similarity(existing.title, post.title) > 0.6);
    if (!isDupe) deduped.push(post);
  }

  console.log(`[hunter] After deduplication: ${deduped.length}`);

  // Score and sort
  deduped.sort((a, b) => (b.score + b.num_comments) - (a.score + a.num_comments));

  // Take top 5
  const top5 = deduped.slice(0, 5);

  const output = {
    timestamp: new Date().toISOString(),
    stories: top5,
  };

  await fs.writeJson('pending_news.json', output, { spaces: 2 });
  console.log(`[hunter] Saved ${top5.length} stories to pending_news.json`);
  console.log('[hunter] Top stories:');
  top5.forEach((s, i) => console.log(`  ${i + 1}. [${s.flair}] ${s.title} (score: ${s.score})`));

  return top5;
}

module.exports = hunt;

if (require.main === module) {
  hunt().catch(err => {
    console.log(`[hunter] ERROR: ${err.message}`);
    process.exit(1);
  });
}
