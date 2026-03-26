const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs-extra');
const dotenv = require('dotenv');

dotenv.config({ override: true });

const BANNED_STARTS = ['so', 'today', 'hey', 'welcome', 'in this'];
const BANNED_LOOP_PHRASES = ['let me know in the comments'];

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

  const systemPrompt = await fs.readFile('system_prompt.txt', 'utf-8');

  const client = new Anthropic.default({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const enriched = [];

  for (const story of stories) {
    console.log(`[processor] Scripting: ${story.title}`);

    const userMessage = `Story title: ${story.title}\nFlair: ${story.flair}\nSubreddit: r/${story.subreddit}\nScore: ${story.score}\nTop comment: ${story.top_comment}`;

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
