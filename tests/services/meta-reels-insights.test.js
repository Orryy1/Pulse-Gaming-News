const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildMetaMetricSnapshotRow,
  buildMetaReelsInsightsPlan,
  buildMetaInsightsRequest,
  collectMetaReelsInsightSnapshots,
  extractMetricValue,
  renderMetaReelsInsightsPlanMarkdown,
} = require("../../lib/intelligence/meta-reels-insights");

test("extractMetricValue reads latest Graph insight values and object totals", () => {
  const insights = {
    data: [
      { name: "plays", values: [{ value: 10 }, { value: 42 }] },
      { name: "post_activity_by_action_type", values: [{ value: { share: 2, comment: 3 } }] },
    ],
  };

  assert.equal(extractMetricValue(insights, ["plays"]), 42);
  assert.equal(extractMetricValue(insights, ["post_activity_by_action_type"]), 5);
  assert.equal(extractMetricValue(insights, ["missing"]), null);
});

test("buildMetaMetricSnapshotRow maps Instagram Reels plays into platform snapshots", () => {
  const row = buildMetaMetricSnapshotRow({
    post: {
      story_id: "story-ig",
      platform: "instagram_reel",
      external_id: "ig_123",
      channel_id: "pulse-gaming",
    },
    insights: {
      data: [
        { name: "plays", values: [{ value: 924 }] },
        { name: "reach", values: [{ value: 786 }] },
        { name: "likes", values: [{ value: 21 }] },
        { name: "comments", values: [{ value: 2 }] },
        { name: "shares", values: [{ value: 1 }] },
      ],
    },
    generatedAt: "2026-06-22T14:00:00.000Z",
  });

  assert.equal(row.platform, "instagram");
  assert.equal(row.story_id, "story-ig");
  assert.equal(row.external_id, "ig_123");
  assert.equal(row.views, 924);
  assert.equal(row.likes, 21);
  assert.equal(row.comments, 2);
  assert.equal(row.shares, 1);
  assert.equal(row.raw_json.source, "meta_graph_reels_insights");
  assert.equal(row.raw_json.reach, 786);
});

test("buildMetaMetricSnapshotRow maps Facebook Reels views and reactions", () => {
  const row = buildMetaMetricSnapshotRow({
    post: {
      story_id: "story-fb",
      platform: "facebook_reel",
      external_id: "fb_123",
    },
    insights: {
      data: [
        { name: "post_video_views", values: [{ value: 7 }] },
        { name: "post_reactions_like_total", values: [{ value: 1 }] },
        { name: "post_comments", values: [{ value: 0 }] },
        { name: "post_shares", values: [{ value: 0 }] },
      ],
    },
  });

  assert.equal(row.platform, "facebook");
  assert.equal(row.views, 7);
  assert.equal(row.likes, 1);
  assert.equal(row.comments, 0);
  assert.equal(row.shares, 0);
});

test("buildMetaReelsInsightsPlan targets only published Instagram and Facebook Reels", () => {
  const plan = buildMetaReelsInsightsPlan({
    platformPosts: [
      { story_id: "yt", platform: "youtube", status: "published", external_id: "yt" },
      { story_id: "ig", platform: "instagram_reel", status: "published", external_id: "ig_1" },
      { story_id: "fb", platform: "facebook_reel", status: "published", external_id: "fb_1" },
      { story_id: "failed", platform: "facebook_reel", status: "failed", external_id: "fb_2" },
      { story_id: "missing", platform: "instagram_reel", status: "published", external_id: "" },
    ],
    generatedAt: "2026-06-22T14:00:00.000Z",
  });

  assert.equal(plan.verdict, "ready");
  assert.equal(plan.targets.length, 2);
  assert.deepEqual(
    plan.targets.map((target) => target.platform),
    ["instagram_reels", "facebook_reels"],
  );
  assert.equal(plan.safety.no_network_calls, true);
  assert.equal(plan.safety.no_db_mutation, true);
  assert.match(renderMetaReelsInsightsPlanMarkdown(plan), /ig_1/);
  assert.match(renderMetaReelsInsightsPlanMarkdown(plan), /fb_1/);
});

test("buildMetaInsightsRequest uses the platform-specific Meta insight edge", () => {
  const ig = buildMetaInsightsRequest({
    target: { platform: "instagram_reels", external_id: "ig_1" },
    graphVersion: "v23.0",
  });
  const fb = buildMetaInsightsRequest({
    target: { platform: "facebook_reels", external_id: "fb_1" },
    graphVersion: "v23.0",
  });

  assert.equal(ig.url, "https://graph.facebook.com/v23.0/ig_1/insights");
  assert.equal(fb.url, "https://graph.facebook.com/v23.0/fb_1/video_insights");
});

test("buildMetaInsightsRequest encodes external ids", () => {
  const request = buildMetaInsightsRequest({
    target: { platform: "facebook_reels", external_id: "video/one" },
    graphVersion: "v23.0",
  });

  assert.equal(request.url, "https://graph.facebook.com/v23.0/video%2Fone/video_insights");
});

test("collectMetaReelsInsightSnapshots fetches insights without persisting in dry-run mode", async () => {
  const fetched = [];
  const persisted = [];

  const result = await collectMetaReelsInsightSnapshots({
    targets: [
      {
        story_id: "ig",
        platform: "instagram_reels",
        external_id: "ig_1",
        channel_id: "pulse-gaming",
      },
    ],
    generatedAt: "2026-06-22T14:00:00.000Z",
    apply: false,
    fetchInsights: async (target) => {
      fetched.push(target.external_id);
      return { data: [{ name: "plays", values: [{ value: 123 }] }] };
    },
    persistSnapshot: (row) => persisted.push(row),
  });

  assert.deepEqual(fetched, ["ig_1"]);
  assert.equal(persisted.length, 0);
  assert.equal(result.verdict, "ready");
  assert.equal(result.counts.fetched, 1);
  assert.equal(result.counts.persisted, 0);
  assert.equal(result.snapshots[0].views, 123);
  assert.equal(result.safety.no_db_mutation, true);
  assert.equal(result.safety.network_called, true);
});

test("collectMetaReelsInsightSnapshots can append snapshots only when apply is true", async () => {
  const persisted = [];

  const result = await collectMetaReelsInsightSnapshots({
    targets: [
      {
        story_id: "fb",
        platform: "facebook_reels",
        external_id: "fb_1",
        channel_id: "pulse-gaming",
      },
    ],
    apply: true,
    fetchInsights: async () => ({
      data: [{ name: "post_video_views", values: [{ value: 7 }] }],
    }),
    persistSnapshot: (row) => {
      persisted.push(row);
      return 42;
    },
  });

  assert.equal(result.verdict, "ready");
  assert.equal(result.counts.persisted, 1);
  assert.equal(result.snapshots[0].platform, "facebook");
  assert.equal(result.snapshots[0].views, 7);
  assert.equal(result.snapshots[0].persisted_id, 42);
  assert.equal(result.safety.no_db_mutation, false);
});

test("collectMetaReelsInsightSnapshots preserves per-target errors and continues", async () => {
  const result = await collectMetaReelsInsightSnapshots({
    targets: [
      { story_id: "ig", platform: "instagram_reels", external_id: "ig_1" },
      { story_id: "fb", platform: "facebook_reels", external_id: "fb_1" },
    ],
    fetchInsights: async (target) => {
      if (target.platform === "instagram_reels") throw new Error("Graph says no");
      return { data: [{ name: "post_video_views", values: [{ value: 3 }] }] };
    },
  });

  assert.equal(result.verdict, "partial");
  assert.equal(result.counts.fetched, 1);
  assert.equal(result.counts.failed, 1);
  assert.match(result.errors[0].message, /Graph says no/);
  assert.equal(result.snapshots[0].story_id, "fb");
});
