/*
  Static Blog Builder
  Reads daily_news.json, generates blog posts for all published stories,
  builds index pages (paginated), sitemap.xml and rss.xml.
  Outputs everything to blog/dist/.

  CLI: node blog/build.js
*/

const fs = require('fs-extra');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ override: true });

const DIST_DIR = path.join(__dirname, 'dist');
const DAILY_NEWS_PATH = path.join(__dirname, '..', 'daily_news.json');
const POSTS_PER_PAGE = 20;

async function build() {
  const { generateBlogPost, generateSlug } = require('./generator');
  const { postTemplate, indexTemplate, sitemapTemplate, rssTemplate } = require('./templates');
  const brand = require('../brand');
  const { getChannel } = require('../channels');

  const channel = getChannel();
  const channelName = channel.name || brand.CHANNEL_NAME || 'Pulse Gaming';
  const baseUrl = process.env.RAILWAY_PUBLIC_URL || 'http://localhost:3001';

  await fs.ensureDir(DIST_DIR);

  // Copy branding assets for OG image / static references
  const brandingDir = path.join(__dirname, '..', 'branding');
  const brandingDist = path.join(DIST_DIR, 'branding');
  if (await fs.pathExists(brandingDir)) {
    await fs.copy(brandingDir, brandingDist, { overwrite: true });
    console.log('[blog-build] Copied branding assets to dist/branding/');
  }

  // Load published stories from database (preferred) or JSON fallback
  let stories;
  try {
    const db = require('../lib/db');
    stories = await db.getStories();
    console.log(`[blog-build] Loaded ${stories.length} stories from database`);
  } catch (err) {
    if (!await fs.pathExists(DAILY_NEWS_PATH)) {
      console.log('[blog-build] No stories found, nothing to build');
      return;
    }
    stories = await fs.readJson(DAILY_NEWS_PATH);
    console.log(`[blog-build] Loaded ${stories.length} stories from daily_news.json`);
  }

  const published = stories.filter(s => s.youtube_post_id);

  if (published.length === 0) {
    console.log('[blog-build] No published stories found — nothing to build');
    return;
  }

  // Sort newest first
  published.sort((a, b) => {
    const ta = new Date(a.published_at || a.timestamp || 0).getTime();
    const tb = new Date(b.published_at || b.timestamp || 0).getTime();
    return tb - ta;
  });

  console.log(`[blog-build] Building blog for ${published.length} published stories...`);

  // Generate individual post pages
  const allPostData = [];

  for (const story of published) {
    try {
      // Check if post already exists on disk (skip regeneration for speed)
      const slug = generateSlug(story.title);
      const existingPath = path.join(DIST_DIR, `${slug}.html`);

      if (await fs.pathExists(existingPath)) {
        // Re-use existing post, but read the article HTML for RSS content:encoded
        let articleHtml = '';
        try {
          const raw = await fs.readFile(existingPath, 'utf-8');
          const match = raw.match(/<article[^>]*>([\s\S]*?)<\/article>/);
          if (match) articleHtml = match[1].trim();
        } catch (e) { /* non-critical */ }

        allPostData.push({
          slug,
          title: story.title,
          description: story.suggested_thumbnail_text || story.title,
          html: articleHtml,
          publishedAt: story.published_at || story.timestamp || new Date().toISOString(),
          storyImageSlug: story.story_image_path ? slug : null,
          story,
        });
        continue;
      }

      const postData = await generateBlogPost(story);
      const fullHtml = postTemplate(postData);
      await fs.writeFile(path.join(DIST_DIR, `${postData.slug}.html`), fullHtml, 'utf-8');
      allPostData.push(postData);
      console.log(`[blog-build] Generated: ${postData.slug}.html`);

      // Small delay to avoid rate-limiting Claude API
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.log(`[blog-build] Skipped story ${story.id}: ${err.message}`);
      // Still include in index with basic data
      allPostData.push({
        slug: generateSlug(story.title),
        title: story.title,
        description: story.suggested_thumbnail_text || story.title,
        publishedAt: story.published_at || story.timestamp || new Date().toISOString(),
        story,
      });
    }
  }

  // Generate paginated index pages
  const totalPages = Math.ceil(allPostData.length / POSTS_PER_PAGE);

  for (let page = 1; page <= totalPages; page++) {
    const start = (page - 1) * POSTS_PER_PAGE;
    const pagePosts = allPostData.slice(start, start + POSTS_PER_PAGE);
    const html = indexTemplate(pagePosts, page, totalPages);

    const filename = page === 1 ? 'index.html' : `page-${page}.html`;
    await fs.writeFile(path.join(DIST_DIR, filename), html, 'utf-8');
    console.log(`[blog-build] Index: ${filename}`);
  }

  // Generate sitemap.xml
  const sitemapHtml = sitemapTemplate(allPostData, baseUrl);
  await fs.writeFile(path.join(DIST_DIR, 'sitemap.xml'), sitemapHtml, 'utf-8');
  console.log('[blog-build] Generated: sitemap.xml');

  // Generate RSS feed
  const rssHtml = rssTemplate(allPostData, baseUrl, channelName);
  await fs.writeFile(path.join(DIST_DIR, 'rss.xml'), rssHtml, 'utf-8');
  console.log('[blog-build] Generated: rss.xml');

  console.log(`[blog-build] Build complete: ${allPostData.length} posts, ${totalPages} index pages`);
}

module.exports = { build };

// CLI
if (require.main === module) {
  build().catch(err => {
    console.error(`[blog-build] FATAL: ${err.message}`);
    process.exit(1);
  });
}
