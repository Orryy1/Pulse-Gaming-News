const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs-extra");
const { google } = require("googleapis");
const dotenv = require("dotenv");
const db = require("./lib/db");

dotenv.config({ override: true });

const { getChannel } = require("./channels");

/**
 * A/B Title Testing for YouTube Shorts
 *
 * Generates title variants via Claude, then swaps to the next variant
 * if views-per-hour is below average 2 hours after publish.
 */

// --- Generate 2 additional title variants from the original ---
async function generateTitleVariants(story) {
  const channel = getChannel();
  const originalTitle =
    story.suggested_title || story.suggested_thumbnail_text || story.title;

  const client = new Anthropic.default({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: `You are a YouTube Shorts title optimiser for ${channel.name}, a ${channel.niche} news channel. Generate exactly 2 alternative title variants for A/B testing. Each must:
- Use a curiosity gap or knowledge gap hook
- Stay under 80 characters
- Be meaningfully different from the original (different angle, framing or hook style)
- Never use clickbait words that trigger demonetisation
- British English throughout

Reply with ONLY a JSON array of 2 strings. No explanation.`,
      messages: [
        {
          role: "user",
          content: `Original title: "${originalTitle}"\n\nStory context: ${story.title}\nClassification: ${story.classification || story.flair || "News"}`,
        },
      ],
    });

    let text = response.content[0].text.trim();
    if (text.startsWith("```")) {
      text = text.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }

    const variants = JSON.parse(text);
    if (!Array.isArray(variants) || variants.length < 2) {
      console.log("[ab_titles] Invalid variant response - expected array of 2");
      return;
    }

    // Truncate variants to 80 chars
    const cleanVariants = variants.slice(0, 2).map((v) => {
      const trimmed = String(v).trim();
      return trimmed.length > 80 ? trimmed.substring(0, 77) + "..." : trimmed;
    });

    story.title_variants = [originalTitle, ...cleanVariants];
    story.active_title_index = 0;

    console.log(`[ab_titles] Generated variants for "${originalTitle}":`);
    cleanVariants.forEach((v, i) => console.log(`  [${i + 1}] ${v}`));
  } catch (err) {
    console.log(`[ab_titles] Variant generation failed: ${err.message}`);
    // Non-blocking - story continues with original title
  }
}

// --- Get the currently active title variant (or fall back to original) ---
function getBestTitle(story) {
  if (
    !story.title_variants ||
    !Array.isArray(story.title_variants) ||
    story.title_variants.length === 0
  ) {
    return (
      story.suggested_title || story.suggested_thumbnail_text || story.title
    );
  }

  const index = story.active_title_index || 0;
  return story.title_variants[index] || story.title_variants[0];
}

// --- Check views and swap title if underperforming ---
async function checkAndSwapTitle(story) {
  if (!story.youtube_post_id) {
    console.log(
      `[ab_titles] No YouTube post ID for story ${story.id} - skipping`,
    );
    return;
  }

  if (!story.title_variants || story.title_variants.length <= 1) {
    console.log(`[ab_titles] No variants for story ${story.id} - skipping`);
    story.title_swap_checked = true;
    return;
  }

  const currentIndex = story.active_title_index || 0;
  if (currentIndex >= story.title_variants.length - 1) {
    console.log(`[ab_titles] All variants exhausted for story ${story.id}`);
    story.title_swap_checked = true;
    return;
  }

  // Get current view count and likes via YouTube Data API
  let viewCount = 0;
  let likeCount = 0;
  try {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey || apiKey === "placeholder") {
      console.log(
        "[ab_titles] YouTube API key not configured - skipping check",
      );
      story.title_swap_checked = true;
      return;
    }

    const ytRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${encodeURIComponent(story.youtube_post_id)}&key=${encodeURIComponent(apiKey)}`,
    );
    if (ytRes.ok) {
      const ytData = await ytRes.json();
      const item = ytData.items?.[0];
      viewCount = item ? parseInt(item.statistics.viewCount, 10) || 0 : 0;
      likeCount = item ? parseInt(item.statistics.likeCount, 10) || 0 : 0;
    }
  } catch (err) {
    console.log(
      `[ab_titles] Failed to fetch views for ${story.youtube_post_id}: ${err.message}`,
    );
    story.title_swap_checked = true;
    return;
  }

  // Calculate engagement rate (likes/views) as proxy for AVD/retention
  const engagementRate = viewCount > 0 ? likeCount / viewCount : 0;

  console.log(
    `[ab_titles] Story ${story.id}: ${viewCount} views, ${likeCount} likes (${(engagementRate * 100).toFixed(1)}% engagement)`,
  );

  // Load all stories to compute average engagement rate
  const stories = await db.getStories();
  const publishedStories = stories.filter(
    (s) =>
      s.youtube_post_id && s.id !== story.id && s.youtube_views !== undefined,
  );

  let avgEngagement = 0.05; // 5% default baseline
  if (publishedStories.length > 0) {
    const totalEng = publishedStories.reduce((sum, s) => {
      const views = s.youtube_views || 0;
      const likes = s.youtube_likes || 0;
      return sum + (views > 0 ? likes / views : 0);
    }, 0);
    avgEngagement = totalEng / publishedStories.length;
  }

  console.log(
    `[ab_titles] Engagement: ${(engagementRate * 100).toFixed(1)}% vs avg ${(avgEngagement * 100).toFixed(1)}%`,
  );

  if (engagementRate < avgEngagement) {
    // Underperforming engagement - swap to next variant
    const nextIndex = currentIndex + 1;
    const newTitle = story.title_variants[nextIndex];

    console.log(
      `[ab_titles] Underperforming - swapping to variant ${nextIndex}: "${newTitle}"`,
    );

    try {
      const { getAuthClient } = require("./upload_youtube");
      const auth = await getAuthClient();
      const youtube = google.youtube({ version: "v3", auth });

      await youtube.videos.update({
        part: ["snippet"],
        requestBody: {
          id: story.youtube_post_id,
          snippet: {
            title: newTitle,
            categoryId: getChannel().youtubeCategory || "20",
          },
        },
      });

      story.active_title_index = nextIndex;
      story.title_swapped_at = new Date().toISOString();
      console.log(
        `[ab_titles] Title swapped successfully for ${story.youtube_post_id}`,
      );
    } catch (err) {
      console.log(`[ab_titles] Title swap failed: ${err.message}`);
    }
  } else {
    console.log(`[ab_titles] Title performing well - keeping current variant`);
  }

  story.title_swap_checked = true;
  story.title_swap_views = viewCount;
  story.title_swap_likes = likeCount;
  story.title_swap_engagement = Math.round(engagementRate * 10000) / 10000;
}

// --- Scan for stories needing title swap checks ---
async function checkPendingTitleSwaps() {
  console.log("[ab_titles] Checking for pending title swaps...");

  const stories = await db.getStories();
  if (!stories.length) {
    console.log("[ab_titles] No stories found");
    return;
  }
  const pending = stories.filter(
    (s) =>
      s.title_variants &&
      s.title_variants.length > 1 &&
      s.youtube_post_id &&
      !s.title_swap_checked &&
      s.title_check_at &&
      Date.now() >= s.title_check_at,
  );

  if (pending.length === 0) {
    console.log("[ab_titles] No pending title swaps");
    return;
  }

  console.log(`[ab_titles] ${pending.length} stories ready for title check`);

  for (const story of pending) {
    try {
      await checkAndSwapTitle(story);
    } catch (err) {
      console.log(
        `[ab_titles] Error checking story ${story.id}: ${err.message}`,
      );
      story.title_swap_checked = true;
    }
  }

  await db.saveStories(stories);
  console.log("[ab_titles] Title swap check complete");
}

module.exports = {
  generateTitleVariants,
  getBestTitle,
  checkAndSwapTitle,
  checkPendingTitleSwaps,
};
