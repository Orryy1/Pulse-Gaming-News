const fs = require('fs-extra');
const dotenv = require('dotenv');
const sendDiscord = require('./notify');

dotenv.config({ override: true });

/*
  Autonomous Publisher — Staggered Multi-Platform Posting

  Research-backed optimal posting times (GMT):
  - YouTube Shorts: 19:00 GMT (2 PM ET / 11 AM PT) — catches US afternoon + UK evening
  - TikTok:         20:00 GMT (3 PM ET / 12 PM PT) — 1hr stagger after YT
  - Instagram Reels: 21:00 GMT (4 PM ET / 1 PM PT) — catches US afternoon break + UK gaming prime

  This module handles:
  1. Auto-approval of high-confidence stories
  2. Full produce pipeline (affiliates → audio → images → assembly)
  3. Staggered multi-platform upload
  4. Discord notifications at each stage
*/

// --- Auto-approval logic ---
function shouldAutoApprove(story) {
  const flair = (story.flair || '').toLowerCase();

  // Auto-approve everything — fully autonomous pipeline, no manual gate
  return true;
}

// --- Run auto-approval pass ---
async function autoApprove() {
  if (!await fs.pathExists('daily_news.json')) return 0;

  const stories = await fs.readJson('daily_news.json');
  let approved = 0;

  for (const story of stories) {
    if (story.approved) continue;

    if (shouldAutoApprove(story)) {
      story.approved = true;
      story.auto_approved = true;
      story.approved_at = new Date().toISOString();
      approved++;
      console.log(`[publisher] Auto-approved: ${story.title} (score:${story.breaking_score}, flair:${story.flair})`);
    }
  }

  if (approved > 0) {
    await fs.writeJson('daily_news.json', stories, { spaces: 2 });
    console.log(`[publisher] Auto-approved ${approved} stories`);
  }

  return approved;
}

// --- Full produce pipeline ---
async function produce() {
  console.log('[publisher] Running produce pipeline...');

  const affiliates = require('./affiliates');
  const audio = require('./audio');
  const images = require('./images');
  const assemble = require('./assemble');

  await affiliates();
  await audio();
  await images();
  await assemble();

  console.log('[publisher] Produce pipeline complete');
}

// --- Staggered multi-platform upload ---
async function publishToAllPlatforms() {
  console.log('[publisher] === Multi-Platform Publish ===');

  const results = { youtube: [], tiktok: [], instagram: [] };

  // YouTube Shorts (first priority)
  try {
    const { uploadAll: ytUpload } = require('./upload_youtube');
    results.youtube = await ytUpload();
    console.log(`[publisher] YouTube: ${results.youtube.length} uploaded`);
  } catch (err) {
    console.log(`[publisher] YouTube upload skipped: ${err.message}`);
  }

  // Wait 60 minutes before TikTok (staggered posting for algorithm)
  if (process.env.STAGGER_UPLOADS !== 'false') {
    console.log('[publisher] Waiting 60 min before TikTok upload...');
    await new Promise(r => setTimeout(r, 60 * 60 * 1000));
  }

  // TikTok
  try {
    const { uploadAll: ttUpload } = require('./upload_tiktok');
    results.tiktok = await ttUpload();
    console.log(`[publisher] TikTok: ${results.tiktok.length} uploaded`);
  } catch (err) {
    console.log(`[publisher] TikTok upload skipped: ${err.message}`);
  }

  // Wait another 60 minutes before Instagram
  if (process.env.STAGGER_UPLOADS !== 'false') {
    console.log('[publisher] Waiting 60 min before Instagram upload...');
    await new Promise(r => setTimeout(r, 60 * 60 * 1000));
  }

  // Instagram Reels
  try {
    const { uploadAll: igUpload } = require('./upload_instagram');
    results.instagram = await igUpload();
    console.log(`[publisher] Instagram: ${results.instagram.length} uploaded`);
  } catch (err) {
    console.log(`[publisher] Instagram upload skipped: ${err.message}`);
  }

  return results;
}

// --- Full autonomous cycle: hunt → approve → produce → publish ---
async function fullAutonomousCycle() {
  const startTime = Date.now();
  console.log('[publisher] ========================================');
  console.log('[publisher] FULL AUTONOMOUS CYCLE STARTED');
  console.log(`[publisher] ${new Date().toISOString()}`);
  console.log('[publisher] ========================================');

  try {
    // Step 1: Hunt for news
    console.log('[publisher] Step 1/4: Hunting for news...');
    const hunt = require('./hunter');
    const process_stories = require('./processor');

    const existingStories = await fs.pathExists('daily_news.json')
      ? await fs.readJson('daily_news.json')
      : [];
    const existingIds = new Set(existingStories.map(s => s.id));

    const posts = await hunt();
    const newPosts = posts.filter(p => !existingIds.has(p.id));

    if (newPosts.length > 0) {
      await fs.writeJson('pending_news.json', {
        timestamp: new Date().toISOString(),
        stories: newPosts,
      }, { spaces: 2 });

      await process_stories();

      // Merge new with existing
      const processed = await fs.readJson('daily_news.json');
      if (existingStories.length > 0) {
        const merged = [...processed, ...existingStories];
        await fs.writeJson('daily_news.json', merged, { spaces: 2 });
      }

      await sendDiscord(`**🔎 Pulse Gaming Hunt Complete**\n${newPosts.length} new stories found`);
    } else {
      console.log('[publisher] No new stories found');
    }

    // Step 2: Auto-approve
    console.log('[publisher] Step 2/4: Auto-approving high-confidence stories...');
    const approvedCount = await autoApprove();

    if (approvedCount > 0) {
      await sendDiscord(`**✅ Auto-Approved** ${approvedCount} stories`);
    }

    // Notify about stories needing manual review
    const allStories = await fs.readJson('daily_news.json').catch(() => []);
    const pendingReview = allStories.filter(s => !s.approved);
    if (pendingReview.length > 0) {
      const dashUrl = process.env.RAILWAY_PUBLIC_URL || 'http://localhost:3001';
      const storyList = pendingReview.slice(0, 8).map(s =>
        `• [${s.flair}] (${s.breaking_score || 0}) ${s.title}`
      ).join('\n');
      await sendDiscord(
        `**⚠️ ${pendingReview.length} stories need your review**\n` +
        `${storyList}\n\n` +
        `👉 Review & approve: ${dashUrl}`
      );
    }

    // Step 3: Produce (audio, images, video)
    console.log('[publisher] Step 3/4: Producing assets...');
    await produce();

    // Step 4: Publish to all platforms
    if (process.env.AUTO_PUBLISH === 'true') {
      console.log('[publisher] Step 4/4: Publishing to all platforms...');
      const results = await publishToAllPlatforms();

      const totalUploaded = results.youtube.length + results.tiktok.length + results.instagram.length;
      await sendDiscord(
        `**Pulse Gaming Auto-Publish Complete**\n` +
        `YouTube: ${results.youtube.length} | TikTok: ${results.tiktok.length} | Instagram: ${results.instagram.length}\n` +
        `Total: ${totalUploaded} uploads across all platforms`
      );
    } else {
      console.log('[publisher] Step 4/4: AUTO_PUBLISH not enabled, skipping uploads');
      await sendDiscord('**Pulse Gaming Produce Complete** — Videos ready. Set AUTO_PUBLISH=true to enable uploads.');
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`[publisher] Autonomous cycle complete in ${elapsed}s`);

  } catch (err) {
    console.log(`[publisher] CYCLE ERROR: ${err.message}`);
    await sendDiscord(`**Pulse Gaming ERROR**\nAutonomous cycle failed: ${err.message}`);
  }
}

// --- Publish-only cycle (for the evening optimal posting window) ---
async function publishOnlyCycle() {
  console.log('[publisher] === PUBLISH-ONLY CYCLE ===');

  try {
    // Auto-approve any remaining stories
    await autoApprove();

    // Produce any unapproved assets
    await produce();

    // Publish
    if (process.env.AUTO_PUBLISH === 'true') {
      const results = await publishToAllPlatforms();
      const total = results.youtube.length + results.tiktok.length + results.instagram.length;
      await sendDiscord(`**Evening Publish Complete** — ${total} videos posted across platforms`);
    }
  } catch (err) {
    console.log(`[publisher] Publish cycle error: ${err.message}`);
    await sendDiscord(`**Publish Cycle ERROR**: ${err.message}`);
  }
}

module.exports = {
  autoApprove,
  produce,
  publishToAllPlatforms,
  fullAutonomousCycle,
  publishOnlyCycle,
  shouldAutoApprove,
};

if (require.main === module) {
  const mode = process.argv[2] || 'full';

  if (mode === 'full') {
    fullAutonomousCycle().catch(console.error);
  } else if (mode === 'publish') {
    publishOnlyCycle().catch(console.error);
  } else if (mode === 'approve') {
    autoApprove().catch(console.error);
  } else {
    console.log('Usage: node publisher.js [full|publish|approve]');
  }
}
