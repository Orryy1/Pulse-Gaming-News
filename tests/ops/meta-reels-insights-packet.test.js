"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyMetaInsightsError,
  createMetaInsightsFetcher,
} = require("../../tools/meta-reels-insights-packet");

function graphError({ code, message, status = 400 } = {}) {
  const error = new Error(message);
  error.response = {
    status,
    data: {
      error: {
        code,
        message,
        type: "OAuthException",
      },
    },
  };
  return error;
}

test("classifyMetaInsightsError identifies platform-specific permission blockers", () => {
  const instagram = classifyMetaInsightsError(
    graphError({ code: 10, message: "Application does not have permission for this action" }),
    { platform: "instagram_reels" },
  );
  const facebook = classifyMetaInsightsError(
    graphError({ code: 200, message: "read_insights permission missing" }),
    { platform: "facebook_reels" },
  );

  assert.equal(instagram.blocker_kind, "permission_required");
  assert.equal(instagram.retryable, false);
  assert.deepEqual(instagram.required_permissions, [
    "instagram_manage_insights",
    "pages_read_engagement",
  ]);
  assert.equal(facebook.blocker_kind, "permission_required");
  assert.deepEqual(facebook.required_permissions, [
    "read_insights",
    "pages_read_engagement",
  ]);
});

test("createMetaInsightsFetcher reads all supported Facebook video metrics without stale aliases", async () => {
  const calls = [];
  const fetchInsights = createMetaInsightsFetcher({
    graphVersion: "v25.0",
    env: { FACEBOOK_PAGE_TOKEN: "redacted-token" },
    httpClient: {
      get: async (url, options) => {
        calls.push({ url, params: options.params });
        return { data: { data: [{ name: "total_video_views", values: [{ value: 8 }] }] } };
      },
    },
  });

  const result = await fetchInsights({
    platform: "facebook_reels",
    external_id: "fb_1",
    metrics: { views: ["post_video_views"] },
  });

  assert.equal(result.data[0].name, "total_video_views");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://graph.facebook.com/v25.0/fb_1/video_insights");
  assert.equal(Object.hasOwn(calls[0].params, "metric"), false);
  assert.equal(calls[0].params.access_token, "redacted-token");
});

test("createMetaInsightsFetcher stops immediately on a permission error", async () => {
  const calls = [];
  const permissionError = graphError({
    code: 10,
    message: "Application does not have permission for this action",
  });
  const fetchInsights = createMetaInsightsFetcher({
    env: { INSTAGRAM_ACCESS_TOKEN: "redacted-token" },
    httpClient: {
      get: async (url, options) => {
        calls.push({ url, params: options.params });
        throw permissionError;
      },
    },
  });

  await assert.rejects(
    fetchInsights({
      platform: "instagram_reels",
      external_id: "ig_1",
      metrics: { views: ["views"], reach: ["reach"] },
    }),
    (error) => {
      assert.equal(error.metaDiagnostics.blocker_kind, "permission_required");
      assert.equal(error.metaDiagnostics.operator_action_required, true);
      assert.equal(error.metaDiagnostics.retryable, false);
      return true;
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].params.metric, "views,reach");
});
