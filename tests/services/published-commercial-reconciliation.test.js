"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  reconcilePublishedCommercialEvidence,
} = require("../../lib/intelligence/published-commercial-reconciliation");

test("published commercial reconciliation traces a newly published story without inventing revenue", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-published-commercial-"));
  const outputDir = path.join(root, "proof");
  const storyId = "rss_a6f055abed9a1488";

  const result = await reconcilePublishedCommercialEvidence({
    generatedAt: "2026-07-18T18:59:29.153Z",
    outputDir,
    affiliateTag: "pulsegaming-21",
    stories: [
      {
        id: storyId,
        title: "Arknights: Endfield Exposes The PS5 Pro Upgrade Players Can Actually Test",
        full_script:
          "Arknights Endfield gives PS5 Pro players a graphics upgrade they can compare directly.",
        url: "https://www.gematsu.com/example",
      },
    ],
    platformPosts: [
      published(storyId, "youtube", "S572jH28pz4", "https://youtube.com/shorts/S572jH28pz4"),
      published(storyId, "instagram_reel", "18101986682271604"),
      published(storyId, "facebook_reel", "2879704252400118", "/reel/2879704252400118/"),
      {
        story_id: storyId,
        platform: "tiktok",
        status: "failed",
        external_id: null,
      },
    ],
  });

  assert.equal(result.report.verdict, "GREEN");
  assert.equal(result.report.totals.published_stories, 1);
  assert.equal(result.report.totals.traced_stories, 1);
  assert.equal(result.report.financial_actuals.realised_revenue_gbp, 0);
  assert.equal(
    result.report.financial_actuals.realised_revenue_status,
    "zero_pending_primary_evidence",
  );
  assert.equal(result.report.safety.production_db_mutated, false);
  assert.equal(result.report.safety.external_requests_made, false);
  assert.equal(result.report.safety.social_posts_created, false);

  const trace = result.report.stories[0];
  assert.equal(trace.story_id, storyId);
  assert.deepEqual(trace.published_platforms, [
    "facebook_reel",
    "instagram_reel",
    "youtube",
  ]);
  assert.equal(trace.platform_evidence.youtube.external_id, "S572jH28pz4");
  assert.equal(trace.platform_evidence.instagram_reel.external_id, "18101986682271604");
  assert.equal(trace.platform_evidence.facebook_reel.external_id, "2879704252400118");
  assert.equal(trace.commercial_learning.clicks, 0);
  assert.equal(trace.revenue.actual_gbp, 0);
  assert.equal(trace.revenue.projection_gbp, null);
  assert.ok(trace.external_evidence_blockers.includes("platform_analytics_not_collected"));
  assert.ok(trace.external_evidence_blockers.includes("commercial_clicks_not_recorded"));
  assert.ok(trace.external_evidence_blockers.includes("primary_revenue_evidence_missing"));
  assert.ok(trace.external_evidence_blockers.includes("fully_loaded_cost_evidence_missing"));

  const commercial = await fs.readJson(trace.commercial.manifest_path);
  const revenue = await fs.readJson(trace.revenue.manifest_path);
  const learning = await fs.readJson(result.learning.artefacts.jsonPath);
  assert.equal(commercial.story_id, storyId);
  assert.equal(commercial.affiliate_tracking_map.video_id, "S572jH28pz4");
  assert.equal(commercial.revenue_attribution.revenue.amount, 0);
  assert.equal(revenue.story_id, storyId);
  assert.equal(revenue.revenue_projection, null);
  assert.equal(learning.tracked_stories.length, 1);
  assert.equal(learning.tracked_stories[0].story_id, storyId);
  assert.equal(learning.tracked_stories[0].learning_status, "waiting_for_click_data");
  assert.equal(learning.tracked_stories[0].external_ids.youtube, "S572jH28pz4");
  assert.equal(learning.tracked_stories[0].external_ids.instagram_reel, "18101986682271604");
  assert.equal(learning.tracked_stories[0].external_ids.facebook_reel, "2879704252400118");
  assert.equal(await fs.pathExists(result.artefacts.json_path), true);
  assert.equal(await fs.pathExists(result.artefacts.markdown_path), true);
});

function published(storyId, platform, externalId, externalUrl = null) {
  return {
    story_id: storyId,
    platform,
    status: "published",
    external_id: externalId,
    external_url: externalUrl,
    views: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    published_at: "2026-07-18 18:23:09",
    stats_fetched_at: null,
  };
}
