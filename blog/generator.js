/*
  Blog Post Generator
  Expands Short scripts into 500-800 word SEO blog articles via Claude Haiku.
  Saves individual HTML files into blog/dist/.
*/

const fs = require('fs-extra');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ override: true });

const DIST_DIR = path.join(__dirname, 'dist');

/**
 * Generate a blog post from a story object.
 * @param {object} story — standard story object from daily_news.json
 * @returns {{ html: string, slug: string, title: string, description: string, publishedAt: string }}
 */
async function generateBlogPost(story) {
  const Anthropic = require('@anthropic-ai/sdk');
  const brand = require('../brand');
  const channelName = brand.CHANNEL_NAME || 'Pulse Gaming';
  const affiliateTag = process.env.AMAZON_AFFILIATE_TAG || 'placeholder';

  const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });

  const script = story.full_script || story.body || story.hook || story.title;
  const classification = story.classification || story.flair || '';

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1500,
    messages: [
      {
        role: 'user',
        content:
          `You are a gaming journalist writing for ${channelName}, a gaming news site. ` +
          `Expand this short-form video script into a 500-800 word SEO blog article.\n\n` +
          `Story title: ${story.title}\n` +
          `Classification: ${classification}\n` +
          `Script:\n${script}\n\n` +
          `Source: ${story.subreddit ? 'r/' + story.subreddit : 'RSS'}\n` +
          `URL: ${story.url || ''}\n\n` +
          `Requirements:\n` +
          `- British English spelling, no serial comma\n` +
          `- 500-800 words of article text\n` +
          `- Include a meta description under 160 characters for SEO\n` +
          `- Provide 5 SEO keywords as a comma-separated list\n` +
          `- Write in a professional but accessible tone\n` +
          `- Reference sources where possible\n` +
          `- Structure with 2-3 subheadings\n` +
          `- Do not use markdown formatting. Output raw HTML using <p>, <h2>, <strong> tags\n` +
          `- NEVER use em dashes in any output\n\n` +
          `Output ONLY valid JSON with no preamble and no markdown backticks:\n` +
          `{ "article_html": "<p>...</p>", "meta_description": "...", "seo_keywords": "keyword1, keyword2, ..." }`,
      },
    ],
  });

  const raw = (response.content[0]?.text || '').trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // Attempt to extract JSON from the response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error('Failed to parse blog post JSON from Claude: ' + raw.substring(0, 200));
    }
  }

  const slug = generateSlug(story.title);
  const publishedAt = story.published_at || story.timestamp || new Date().toISOString();

  return {
    html: parsed.article_html || '',
    slug,
    title: story.title,
    description: parsed.meta_description || story.title,
    seoKeywords: parsed.seo_keywords || '',
    publishedAt,
    story,
  };
}

/**
 * Generate a blog post and save it to blog/dist/.
 * @param {object} story
 * @returns {object} — the blog post data
 */
async function generateAndSaveBlogPost(story) {
  const { postTemplate } = require('./templates');

  const postData = await generateBlogPost(story);
  const fullHtml = postTemplate(postData);

  await fs.ensureDir(DIST_DIR);
  const filePath = path.join(DIST_DIR, `${postData.slug}.html`);
  await fs.writeFile(filePath, fullHtml, 'utf-8');

  console.log(`[blog] Generated: ${postData.slug}.html`);
  return postData;
}

/**
 * Convert a title string to a URL-friendly slug.
 */
function generateSlug(title) {
  return String(title || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}

module.exports = {
  generateBlogPost,
  generateAndSaveBlogPost,
  generateSlug,
};

// CLI
if (require.main === module) {
  (async () => {
    const storyId = process.argv[2];
    if (!storyId) {
      console.log('Usage: node blog/generator.js <story-id>');
      console.log('       Generates a blog post for the given story ID');
      process.exit(0);
    }

    const stories = await fs.readJson(path.join(__dirname, '..', 'daily_news.json'));
    const story = stories.find(s => s.id === storyId);
    if (!story) {
      console.log(`[blog] Story not found: ${storyId}`);
      process.exit(1);
    }

    await generateAndSaveBlogPost(story);
  })().catch(err => {
    console.error(`[blog] ERROR: ${err.message}`);
    process.exit(1);
  });
}
