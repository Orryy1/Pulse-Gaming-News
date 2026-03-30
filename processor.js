const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const fs = require('fs-extra');
const dotenv = require('dotenv');

dotenv.config({ override: true });

const BANNED_STARTS = ['so', 'today', 'hey', 'welcome', 'in this'];
const BANNED_LOOP_PHRASES = ['let me know in the comments'];

// --- Fetch source material for fact-checking ---
// Tries: Reddit JSON (post body + linked article) → linked article page
async function fetchSourceMaterial(story) {
  const parts = [];

  // 1. Fetch Reddit post body and any linked article URL
  if (story.url && story.url.includes('reddit.com')) {
    try {
      const jsonUrl = story.url.replace(/\/$/, '') + '.json';
      const response = await axios.get(jsonUrl, {
        timeout: 8000,
        headers: { 'User-Agent': 'pulse-gaming-bot/1.0' },
      });
      const listing = response.data;
      if (Array.isArray(listing) && listing[0]?.data?.children?.[0]?.data) {
        const post = listing[0].data.children[0].data;
        // Get the self-text (post body)
        if (post.selftext) {
          parts.push(`REDDIT POST BODY:\n${post.selftext.substring(0, 1500)}`);
        }
        // Get linked article URL (if it's a link post, not self post)
        if (post.url && !post.url.includes('reddit.com')) {
          const articleText = await fetchPageText(post.url);
          if (articleText) {
            parts.push(`LINKED ARTICLE (${post.url}):\n${articleText}`);
          }
        }
        // Top comments for additional context
        if (listing[1]?.data?.children) {
          const topComments = listing[1].data.children
            .filter(c => c.data?.body)
            .slice(0, 3)
            .map(c => c.data.body.substring(0, 300))
            .join('\n---\n');
          if (topComments) {
            parts.push(`TOP REDDIT COMMENTS:\n${topComments}`);
          }
        }
      }
    } catch (err) {
      console.log(`[processor] Reddit JSON fetch failed: ${err.message}`);
    }
  }

  // 2. If story has a separate article URL, fetch that too
  if (story.article_url && !story.article_url.includes('reddit.com')) {
    const articleText = await fetchPageText(story.article_url);
    if (articleText) {
      parts.push(`SOURCE ARTICLE (${story.article_url}):\n${articleText}`);
    }
  }

  return parts.length > 0 ? parts.join('\n\n') : null;
}

// --- Fetch and extract text from a web page ---
async function fetchPageText(url) {
  if (!url) return null;
  try {
    const response = await axios.get(url, {
      timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PulseGaming/1.0)' },
      maxRedirects: 3,
    });
    const html = response.data;
    if (typeof html !== 'string') return null;
    let text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#\d+;/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length > 2000) text = text.substring(0, 2000) + '...';
    return text.length > 50 ? text : null;
  } catch (err) {
    return null;
  }
}

// --- Search DuckDuckGo for current facts about a topic ---
async function searchCurrentFacts(query) {
  try {
    const searchQuery = encodeURIComponent(query + ' 2026');
    const response = await axios.get(
      `https://api.duckduckgo.com/?q=${searchQuery}&format=json&no_html=1&skip_disambig=1`,
      { timeout: 5000 }
    );
    const data = response.data;
    const facts = [];
    if (data.Abstract) facts.push(data.Abstract);
    if (data.RelatedTopics) {
      for (const topic of data.RelatedTopics.slice(0, 5)) {
        if (topic.Text) facts.push(topic.Text);
      }
    }
    return facts.length > 0 ? facts.join('\n').substring(0, 1500) : null;
  } catch (err) {
    return null;
  }
}

// --- Build today's date string ---
function getTodayString() {
  const d = new Date();
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function validate(script) {
  const errors = [];
  if (script.word_count < 120 || script.word_count > 150) {
    errors.push(`Word count ${script.word_count} outside 120-150 range`);
  }
  const hookLower = (script.hook || '').toLowerCase().trim();
  for (const banned of BANNED_STARTS) {
    if (hookLower.startsWith(banned)) {
      errors.push(`Hook starts with banned word: "${banned}"`);
    }
  }
  const loopLower = (script.loop || '').toLowerCase();
  for (const phrase of BANNED_LOOP_PHRASES) {
    if (loopLower.includes(phrase)) {
      errors.push(`Loop contains banned phrase: "${phrase}"`);
    }
  }
  return errors;
}

function getContentPillar(flair) {
  const f = flair.toLowerCase();
  if (f.includes('verified')) return 'Confirmed Drop';
  if (f.includes('highly likely')) return 'Source Breakdown';
  if (f.includes('rumour')) return 'Rumour Watch';
  return 'Confirmed Drop';
}

async function process_stories() {
  console.log('[processor] Loading pending_news.json...');

  if (!await fs.pathExists('pending_news.json')) {
    console.log('[processor] ERROR: pending_news.json not found. Run hunter first.');
    return [];
  }

  const data = await fs.readJson('pending_news.json');
  const stories = data.stories || [];
  console.log(`[processor] Processing ${stories.length} stories...`);

  const baseSystemPrompt = await fs.readFile('system_prompt.txt', 'utf-8');
  const today = getTodayString();

  const client = new Anthropic.default({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const enriched = [];

  for (const story of stories) {
    console.log(`[processor] Scripting: ${story.title}`);

    // --- Fact-checking: fetch source material + search for current info ---
    let sourceMaterial = null;
    let searchFacts = null;

    try {
      const [sources, facts] = await Promise.all([
        fetchSourceMaterial(story),
        searchCurrentFacts(story.title),
      ]);
      sourceMaterial = sources;
      searchFacts = facts;
    } catch (err) {
      console.log(`[processor] Fact-check fetch error: ${err.message}`);
    }

    if (sourceMaterial) {
      console.log(`[processor] Fetched source material (${sourceMaterial.length} chars) for verification`);
    }
    if (searchFacts) {
      console.log(`[processor] Found search context (${searchFacts.length} chars)`);
    }

    // Build fact-check context
    const factContext = [];
    if (sourceMaterial) {
      factContext.push(sourceMaterial);
    }
    if (searchFacts) {
      factContext.push(`ADDITIONAL SEARCH CONTEXT:\n${searchFacts}`);
    }

    // Enhanced system prompt with date + fact-checking
    const systemPrompt = baseSystemPrompt + `\n\nCRITICAL — DATE AND FACT-CHECKING RULES:
Today's date is ${today}. You MUST follow these rules:
1. NEVER reference dates in the past as if they are in the future. If a game was supposed to release in 2025 but it is now 2026, say it was delayed or has since been updated — do not say "coming in 2025".
2. Cross-reference the Reddit title against the SOURCE ARTICLE TEXT provided below. If the article contradicts the Reddit title, trust the article.
3. If a claim cannot be verified from the provided sources, use hedging language: "reportedly", "according to sources", "if accurate".
4. NEVER invent specific dates, prices, or statistics that are not in the source material.
5. If the story references an old event or outdated information, update it to reflect the current situation as of ${today}.
6. For game release dates: check if the date has already passed. If so, note the game has either released or been delayed — do not present a past date as upcoming.`;

    const userMessage = [
      `Story title: ${story.title}`,
      `Flair: ${story.flair}`,
      `Subreddit: r/${story.subreddit}`,
      `Score: ${story.score}`,
      `Top comment: ${story.top_comment}`,
      `Story URL: ${story.url || story.article_url || 'N/A'}`,
      `Date found: ${story.timestamp || today}`,
      factContext.length > 0 ? `\n--- VERIFICATION DATA ---\n${factContext.join('\n\n')}` : '',
    ].filter(Boolean).join('\n');

    let script = null;
    let attempts = 0;

    while (attempts < 2) {
      attempts++;
      try {
        const extra = attempts > 1 ? '\n\nIMPORTANT: Your previous script failed validation. Ensure word_count is between 120 and 150. Do not start the hook with So, Today, Hey, Welcome or In this. Do not include "let me know in the comments" in the loop.' : '';

        const response = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1000,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage + extra }],
        });

        let text = response.content[0].text.trim();
        // Strip markdown code fences if present
        if (text.startsWith('```')) {
          text = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
        }
        script = JSON.parse(text);

        const errors = validate(script);
        if (errors.length > 0) {
          console.log(`[processor] Validation failed (attempt ${attempts}): ${errors.join(', ')}`);
          if (attempts >= 2) {
            console.log('[processor] Using script despite validation issues');
          } else {
            script = null;
            continue;
          }
        } else {
          console.log(`[processor] Script validated (${script.word_count} words)`);
        }
        break;
      } catch (err) {
        console.log(`[processor] ERROR on attempt ${attempts}: ${err.message}`);
        if (attempts >= 2) {
          script = {
            hook: story.title,
            body: 'Script generation failed. Manual edit required.',
            loop: 'More tomorrow.',
            full_script: story.title,
            word_count: 0,
            suggested_thumbnail_text: story.title.substring(0, 40),
          };
        }
      }
    }

    const gameTitle = story.title.replace(/[^a-zA-Z0-9\s]/g, '').trim();
    const affiliateTag = process.env.AMAZON_AFFILIATE_TAG || 'placeholder';
    const affiliateUrl = `https://www.amazon.co.uk/s?k=${encodeURIComponent(gameTitle)}&tag=${affiliateTag}`;
    const pinnedComment = `Check it out here: ${affiliateUrl} | Source: r/${story.subreddit} | Verified gaming leaks daily at 8AM and 6PM`;

    const enrichedStory = {
      ...story,
      ...script,
      content_pillar: getContentPillar(story.flair),
      affiliate_url: affiliateUrl,
      pinned_comment: pinnedComment,
      approved: false,
    };

    enriched.push(enrichedStory);
  }

  await fs.writeJson('daily_news.json', enriched, { spaces: 2 });
  console.log(`[processor] Saved ${enriched.length} enriched stories to daily_news.json`);

  return enriched;
}

module.exports = process_stories;

if (require.main === module) {
  process_stories().catch(err => {
    console.log(`[processor] ERROR: ${err.message}`);
    process.exit(1);
  });
}
