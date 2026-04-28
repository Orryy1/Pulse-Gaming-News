"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const axios = require("axios");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.join(ROOT, "test", "output");

const GRAPH_VERSION = "v21.0";

function tokenSummary(token) {
  if (!token) return { present: false, display: "(missing)" };
  const text = String(token);
  return {
    present: true,
    display: `(set, ${text.length} chars)`,
  };
}

function normaliseGraphError(err) {
  const graphError = err?.response?.data?.error;
  return {
    status: err?.response?.status || null,
    type: graphError?.type || null,
    code: graphError?.code ?? null,
    subcode: graphError?.error_subcode ?? graphError?.error_subcode ?? null,
    message: graphError?.message || err?.message || String(err),
  };
}

async function fetchAllGraph(url, params, { maxPages = 4, client = axios } = {}) {
  let next = url;
  let nextParams = params;
  let pages = 0;
  const out = [];
  while (next && pages < maxPages) {
    const resp = await client.get(next, {
      params: nextParams,
      timeout: 20_000,
    });
    out.push(...(resp.data?.data || []));
    next = resp.data?.paging?.next || null;
    nextParams = null;
    pages += 1;
  }
  return out;
}

async function fetchFacebookReelsEvidence({
  pageId = process.env.FACEBOOK_PAGE_ID,
  token = process.env.FACEBOOK_PAGE_TOKEN,
  client = axios,
} = {}) {
  if (!pageId) throw new Error("FACEBOOK_PAGE_ID not set");
  if (!token) throw new Error("FACEBOOK_PAGE_TOKEN not set");

  const base = `https://graph.facebook.com/${GRAPH_VERSION}`;
  const common = { access_token: token };
  const evidence = {
    generatedAt: new Date().toISOString(),
    pageId,
    token: tokenSummary(token),
    page: { ok: false, data: null, error: null },
    videos: { ok: false, count: 0, sample: [], error: null },
    reels: { ok: false, count: 0, sample: [], error: null },
    posts: { ok: false, count: 0, sample: [], error: null },
    tokenDebug: { ok: false, data: null, error: null },
  };

  try {
    const resp = await client.get(`${base}/${pageId}`, {
      params: {
        ...common,
        fields:
          "id,name,category,fan_count,followers_count,is_published,is_verified,can_post",
      },
      timeout: 15_000,
    });
    evidence.page = { ok: true, data: resp.data, error: null };
  } catch (err) {
    evidence.page.error = normaliseGraphError(err);
  }

  try {
    const videos = await fetchAllGraph(
      `${base}/${pageId}/videos`,
      {
        ...common,
        fields:
          "id,title,permalink_url,published,created_time,status,length,content_category",
        limit: 50,
      },
      { client, maxPages: 4 },
    );
    evidence.videos = {
      ok: true,
      count: videos.length,
      sample: videos.slice(0, 10).map(summariseVideo),
      error: null,
    };
  } catch (err) {
    evidence.videos.error = normaliseGraphError(err);
  }

  try {
    const reels = await fetchAllGraph(
      `${base}/${pageId}/video_reels`,
      {
        ...common,
        fields: "id,title,permalink_url,published,created_time,status",
        limit: 50,
      },
      { client, maxPages: 4 },
    );
    evidence.reels = {
      ok: true,
      count: reels.length,
      sample: reels.slice(0, 10).map(summariseVideo),
      error: null,
    };
  } catch (err) {
    evidence.reels.error = normaliseGraphError(err);
  }

  try {
    const posts = await fetchAllGraph(
      `${base}/${pageId}/posts`,
      {
        ...common,
        fields: "id,message,permalink_url,created_time,is_published,attachments{type}",
        limit: 25,
      },
      { client, maxPages: 2 },
    );
    evidence.posts = {
      ok: true,
      count: posts.length,
      sample: posts.slice(0, 10).map((post) => ({
        id: post.id || null,
        created_time: post.created_time || null,
        is_published: post.is_published ?? null,
        attachment_type: post.attachments?.data?.[0]?.type || null,
        permalink_url: post.permalink_url || null,
      })),
      error: null,
    };
  } catch (err) {
    evidence.posts.error = normaliseGraphError(err);
  }

  try {
    const resp = await client.get(`${base}/debug_token`, {
      params: {
        input_token: token,
        access_token: token,
      },
      timeout: 15_000,
    });
    const data = resp.data?.data || {};
    evidence.tokenDebug = {
      ok: true,
      data: {
        type: data.type || null,
        app_id: data.app_id || null,
        expires_at: data.expires_at
          ? new Date(data.expires_at * 1000).toISOString()
          : "never",
        is_valid: data.is_valid === true,
        scopes: data.scopes || [],
      },
      error: null,
    };
  } catch (err) {
    evidence.tokenDebug.error = normaliseGraphError(err);
  }

  return evidence;
}

function summariseVideo(video) {
  return {
    id: video.id || null,
    title: video.title || null,
    created_time: video.created_time || null,
    video_status: video.status?.video_status || null,
    publish_status: video.status?.publishing_phase?.status || null,
    published: video.published ?? null,
    permalink_url: video.permalink_url || null,
    length: video.length ?? null,
  };
}

function classifyFacebookReelsEligibility(evidence = {}) {
  const page = evidence.page?.data || {};
  const token = evidence.tokenDebug?.data || {};
  const scopes = new Set(token.scopes || []);
  const videos = evidence.videos || {};
  const reels = evidence.reels || {};

  const hardFails = [];
  const warnings = [];
  const green = [];

  if (evidence.page?.ok && page.is_published === true) green.push("page_published");
  else hardFails.push("page_not_published_or_unreadable");

  if (page.can_post === true) green.push("page_can_post");
  else warnings.push("page_can_post_not_confirmed");

  if (evidence.tokenDebug?.ok && token.is_valid === true) green.push("token_valid");
  else hardFails.push("token_invalid_or_unreadable");

  if (scopes.has("publish_video")) green.push("publish_video_scope_present");
  else warnings.push("publish_video_scope_missing_or_unreadable");

  if (videos.ok) green.push("videos_endpoint_readable");
  else warnings.push("videos_endpoint_unreadable");

  if (reels.ok) green.push("video_reels_endpoint_readable");
  else warnings.push("video_reels_endpoint_unreadable");

  const visibleVideoCount = Number(videos.count || 0);
  const visibleReelCount = Number(reels.count || 0);
  const visibleCount = visibleVideoCount + visibleReelCount;

  let verdict = "review";
  let recommendedAction =
    "Keep FACEBOOK_REELS_ENABLED=false and re-check later; Graph shows no visible videos or Reels.";
  let reason = "graph_zero_video_surfaces";

  if (hardFails.length > 0) {
    verdict = "blocked";
    recommendedAction =
      "Do not enable Facebook Reels; fix Page/token readability first.";
    reason = hardFails[0];
  } else if (visibleCount > 0) {
    verdict = "eligible_for_probe";
    recommendedAction =
      "Keep automatic Reels gated until a deliberate low-risk Graph API probe is approved; Graph now shows visible video/Reels evidence.";
    reason = "visible_graph_video_or_reel_found";
    green.push("visible_graph_video_or_reel_found");
  }

  return {
    verdict,
    reason,
    recommendedAction,
    counts: {
      videos: visibleVideoCount,
      reels: visibleReelCount,
      posts: Number(evidence.posts?.count || 0),
    },
    page: {
      is_published: page.is_published ?? null,
      can_post: page.can_post ?? null,
      fan_count: page.fan_count ?? null,
      followers_count: page.followers_count ?? null,
      is_verified: page.is_verified ?? null,
    },
    hardFails,
    warnings,
    green,
  };
}

function buildFacebookReelsEligibilityReport(evidence) {
  return {
    generatedAt: evidence.generatedAt || new Date().toISOString(),
    mode: "read-only-graph-inspection",
    evidence,
    classification: classifyFacebookReelsEligibility(evidence),
    safety: {
      mutatesProduction: false,
      postsToFacebook: false,
      printsToken: false,
    },
  };
}

function renderFacebookReelsEligibilityMarkdown(report) {
  const c = report.classification;
  const e = report.evidence;
  const token = e.tokenDebug?.data || {};
  const scopes = token.scopes || [];
  const lines = [
    "# Facebook Reels Eligibility Check",
    "",
    `Generated: ${report.generatedAt}`,
    `Mode: ${report.mode}`,
    `Verdict: ${c.verdict}`,
    `Reason: ${c.reason}`,
    "",
    "## Recommendation",
    "",
    `- ${c.recommendedAction}`,
    "",
    "## Graph Counts",
    "",
    `- /videos: ${c.counts.videos}`,
    `- /video_reels: ${c.counts.reels}`,
    `- /posts: ${c.counts.posts}`,
    "",
    "## Page",
    "",
    `- is_published: ${c.page.is_published}`,
    `- can_post: ${c.page.can_post}`,
    `- fan_count: ${c.page.fan_count}`,
    `- followers_count: ${c.page.followers_count}`,
    `- is_verified: ${c.page.is_verified}`,
    "",
    "## Token",
    "",
    `- present: ${e.token?.present === true}`,
    `- valid: ${token.is_valid === true}`,
    `- type: ${token.type || "unknown"}`,
    `- expires_at: ${token.expires_at || "unknown"}`,
    `- scopes: ${scopes.length ? scopes.join(", ") : "(none/read failed)"}`,
    "",
    "## Signals",
    "",
    "### Green",
    ...(c.green.length ? c.green.map((x) => `- ${x}`) : ["- none"]),
    "",
    "### Warnings",
    ...(c.warnings.length ? c.warnings.map((x) => `- ${x}`) : ["- none"]),
    "",
    "### Hard fails",
    ...(c.hardFails.length ? c.hardFails.map((x) => `- ${x}`) : ["- none"]),
    "",
    "## Safety",
    "",
    "- read-only Graph API inspection",
    "- no Facebook post",
    "- no Railway variable mutation",
    "- token value is not printed",
  ];
  return lines.join("\n") + "\n";
}

async function writeFacebookReelsEligibilityReport({ outDir = OUT_DIR, evidence } = {}) {
  await fs.ensureDir(outDir);
  const report = buildFacebookReelsEligibilityReport(evidence);
  const jsonPath = path.join(outDir, "facebook_reels_eligibility.json");
  const mdPath = path.join(outDir, "facebook_reels_eligibility.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, renderFacebookReelsEligibilityMarkdown(report), "utf8");
  return { report, jsonPath, mdPath };
}

module.exports = {
  GRAPH_VERSION,
  tokenSummary,
  fetchAllGraph,
  fetchFacebookReelsEvidence,
  classifyFacebookReelsEligibility,
  buildFacebookReelsEligibilityReport,
  renderFacebookReelsEligibilityMarkdown,
  writeFacebookReelsEligibilityReport,
};
