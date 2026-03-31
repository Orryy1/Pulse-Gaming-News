const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const fs = require('fs-extra');
const dotenv = require('dotenv');

dotenv.config({ override: true });

const BANNED_STARTS = ['so', 'today', 'hey', 'welcome', 'in this'];
const BANNED_LOOP_PHRASES = ['let me know in the comments'];

// --- Fetch source material for fact-checking ---
async function fetchSourceMaterial(story) {
  const parts = [];

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
        if (post.selftext) {
          parts.push(`REDDIT POST BODY:\n${post.selftext.substring(0, 1500)}`);
        }
        if (post.url && !post.url.includes('reddit.com')) {
          const articleText = await fetchPageText(post.url);
          if (articleText) {
            parts.push(`LINKED ARTICLE (${post.url}):\n${articleText}`);
          }
        }
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

  if (story.article_url && !story.article_url.includes('reddit.com')) {
    const articleText = await fetchPageText(story.article_url);
    if (articleText) {
      parts.push(`SOURCE ARTICLE (${story.article_url}):\n${articleText}`);
    }
  }

  return parts.length > 0 ? parts.join('\n\n') : null;
}

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

function getTodayString() {
  const d = new Date();
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function validate(script) {
  const errors = [];
  if (script.word_count < 155 || script.word_count > 185) {
    errors.push(`Word count ${script.word_count} outside 155-185 range`);
  }
  const hookLower = (script.hook || '').toLowerCase().trim();
  for (const banned of BANNED_STARTS) {
    if (hookLower.startsWith(banned)) {
      errors.push(`Hook starts with banned word: "${banned}"`);
    }
  }
  // Validate classification exists
  if (!script.classification || !['[LEAK]', '[RUMOR]', '[CONFIRMED]', '[BREAKING]'].includes(script.classification)) {
    errors.push('Missing or invalid classification tag');
  }
  return errors;
}

// --- Quality gate: score script 1-10 via second LLM call ---
async function scoreScript(client, script, story) {
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      system: `You score YouTube Shorts scripts for a gaming news channel (1-10). Criteria:
- Hook strength (does it grab attention in 2 seconds?)
- Information density (facts per sentence, no filler)
- Source credibility (does it cite sources?)
- Pacing (punchy, no dead air, urgent tone)
- CTA presence
Reply with ONLY a JSON object: { "score": N, "reason": "one sentence" }`,
      messages: [{
        role: 'user',
        content: `Score this script:\n${script.full_script}\n\nClassification: ${script.classification}\nStory: ${story.title}`,
      }],
    });

    let text = response.content[0].text.trim();
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }
    const result = JSON.parse(text);
    return { score: result.score || 5, reason: result.reason || '' };
  } catch (err) {
    console.log(`[processor] Quality gate error: ${err.message}`);
    return { score: 7, reason: 'scoring failed — accepting by default' };
  }
}

function getContentPillar(classification) {
  const c = (classification || '').toLowerCase();
  if (c.includes('confirmed')) return 'Confirmed Drop';
  if (c.includes('leak') || c.includes('breaking')) return 'Source Breakdown';
  if (c.includes('rumor')) return 'Rumour Watch';
  return 'Confirmed Drop';
}

// --- Clean script text for TTS (strip markers) ---
function cleanForTTS(text) {
  if (!text) return '';
  return text
    .replace(/\[PAUSE\]/gi, '...')
    .replace(/\[VISUAL:[^\]]*\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
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

    // --- Fact-checking: fetch source material ---
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
      console.log(`[processor] Fetched source material (${sourceMaterial.length} chars)`);
    }

    const factContext = [];
    if (sourceMaterial) factContext.push(sourceMaterial);
    if (searchFacts) factContext.push(`ADDITIONAL SEARCH CONTEXT:\n${searchFacts}`);

    const systemPrompt = baseSystemPrompt + `\n\nCRITICAL — DATE AND FACT-CHECKING RULES:
Today's date is ${today}. You MUST follow these rules:
1. NEVER reference dates in the past as if they are in the future.
2. Cross-reference the Reddit title against the SOURCE ARTICLE TEXT provided below. If the article contradicts the Reddit title, trust the article.
3. If a claim cannot be verified from the provided sources, use hedging language.
4. NEVER invent specific dates, prices or statistics that are not in the source material.
5. If the story references an old event or outdated information, update it to reflect the current situation as of ${today}.
6. For game release dates: check if the date has already passed. If so, note the game has either released or been delayed.`;

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
    let qualityScore = null;
    let attempts = 0;

    while (attempts < 3) {
      attempts++;
      try {
        let extra = '';
        if (attempts === 2) {
          extra = '\n\nIMPORTANT: Your previous script failed validation. Ensure word_count is 160-180. Include a classification tag. Do not start the hook with So, Today, Hey, Welcome or In this.';
        } else if (attempts === 3) {
          extra = '\n\nFINAL ATTEMPT: Produce a 170-word script with a strong hook, classification tag, and CTA. This is your last chance.';
        }

        const response = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1200,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage + extra }],
        });

        let text = response.content[0].text.trim();
        if (text.startsWith('```')) {
          text = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
        }
        script = JSON.parse(text);

        const errors = validate(script);
        if (errors.length > 0) {
          console.log(`[processor] Validation failed (attempt ${attempts}): ${errors.join(', ')}`);
          if (attempts >= 3) {
            console.log('[processor] Using script despite validation issues');
          } else {
            script = null;
            continue;
          }
        } else {
          console.log(`[processor] Script validated (${script.word_count} words)`);
        }

        // Quality gate — score the script
        if (script && attempts < 3) {
          const gate = await scoreScript(client, script, story);
          qualityScore = gate.score;
          console.log(`[processor] Quality gate: ${gate.score}/10 — ${gate.reason}`);
          if (gate.score < 7) {
            console.log(`[processor] Script below quality threshold (${gate.score}/10), regenerating...`);
            script = null;
            continue;
          }
        }
        break;
      } catch (err) {
        console.log(`[processor] ERROR on attempt ${attempts}: ${err.message}`);
        if (attempts >= 3) {
          script = {
            classification: '[BREAKING]',
            hook: story.title,
            body: 'Script generation failed. Manual edit required.',
            cta: 'Follow Pulse Gaming so you never miss a drop.',
            full_script: story.title,
            word_count: 0,
            suggested_thumbnail_text: story.title.substring(0, 40),
          };
        }
      }
    }

    // Clean script for TTS (remove [PAUSE] and [VISUAL] markers)
    const ttsScript = cleanForTTS(script.full_script);

    const gameTitle = story.title.replace(/[^a-zA-Z0-9\s]/g, '').trim();
    const affiliateTag = process.env.AMAZON_AFFILIATE_TAG || 'placeholder';
    const affiliateUrl = `https://www.amazon.co.uk/s?k=${encodeURIComponent(gameTitle)}&tag=${affiliateTag}`;
    const pinnedComment = `What do you think — legit or fake? Drop your take below 👇 | Check it out: ${affiliateUrl}`;

    const enrichedStory = {
      ...story,
      ...script,
      tts_script: ttsScript,
      quality_score: qualityScore,
      content_pillar: getContentPillar(script.classification),
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
