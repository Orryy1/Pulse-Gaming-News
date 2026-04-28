#!/usr/bin/env node
"use strict";

/**
 * tools/diagnostics/fb-page-content-probe.js — read-only Graph API probe.
 *
 * Asks Meta what's ACTUALLY on the Pulse Gaming Page from Meta's
 * point of view, separately from what the Page UI shows. The
 * Reels-tab-empty + publish-summary-says-verified divergence
 * (2026-04-28) needs Graph-side ground truth: are the videos
 * arriving and being held in some non-visible state, or is the
 * API silently dropping them?
 *
 * Reads FACEBOOK_PAGE_TOKEN from env. Never prints the token.
 *
 * Usage:
 *   FACEBOOK_PAGE_ID=... FACEBOOK_PAGE_TOKEN=... \
 *     node tools/diagnostics/fb-page-content-probe.js
 *
 * Or via Railway's variable injection:
 *   railway run -- node tools/diagnostics/fb-page-content-probe.js
 */

const axios = require("axios");

function redact(value) {
  if (!value) return "(none)";
  const s = String(value);
  if (s.length < 12) return "(set)";
  return `${s.slice(0, 4)}...${s.slice(-4)} (${s.length} chars)`;
}

async function fetchAll(url, params, max = 4) {
  let next = url;
  let nextParams = params;
  let pages = 0;
  const out = [];
  while (next && pages < max) {
    const resp = await axios.get(next, {
      params: nextParams,
      timeout: 20_000,
    });
    const items = resp.data?.data || [];
    out.push(...items);
    next = resp.data?.paging?.next || null;
    nextParams = null;
    pages++;
  }
  return out;
}

async function main() {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const token = process.env.FACEBOOK_PAGE_TOKEN;
  if (!pageId) {
    throw new Error("FACEBOOK_PAGE_ID not set");
  }
  if (!token) {
    throw new Error("FACEBOOK_PAGE_TOKEN not set");
  }
  console.log(`[fb-probe] page_id=${pageId} token=${redact(token)}`);

  // 1) Page meta — sanity check the token is for the right Page and
  //    the Page is not in a restricted state.
  console.log("\n[fb-probe] === Page meta ===");
  try {
    const meta = await axios.get(`https://graph.facebook.com/v21.0/${pageId}`, {
      params: {
        fields:
          "id,name,category,fan_count,followers_count,is_published,is_verified,can_post,description",
        access_token: token,
      },
      timeout: 15_000,
    });
    console.log(JSON.stringify(meta.data, null, 2));
  } catch (err) {
    console.log(
      `[fb-probe] page meta failed: ${err.response?.status} ${JSON.stringify(err.response?.data?.error || err.message)}`,
    );
  }

  // 2) /videos — every uploaded video on the Page (Reels land here too).
  //    This is the single most important field for our diagnosis: if
  //    the API uploads are succeeding from /video_reels but the Page
  //    Reels tab is empty, the videos may be sitting here in some
  //    non-published state.
  console.log("\n[fb-probe] === /videos (all uploaded videos) ===");
  try {
    const videos = await fetchAll(
      `https://graph.facebook.com/v21.0/${pageId}/videos`,
      {
        fields:
          "id,title,description,permalink_url,published,created_time,updated_time,status,is_reference_only,content_category,length,custom_labels",
        access_token: token,
        limit: 50,
      },
      4,
    );
    console.log(`Total videos found: ${videos.length}`);
    for (const v of videos.slice(0, 25)) {
      const status = v.status?.video_status || "?";
      const phase = v.status?.publishing_phase?.status || "?";
      const len = v.length ? `${Math.round(v.length)}s` : "?";
      console.log(
        `- ${v.id} created=${v.created_time} status=${status}/${phase} published=${v.published} length=${len}`,
      );
      console.log(`    title: ${(v.title || "").slice(0, 80)}`);
      console.log(`    permalink: ${v.permalink_url || "(none)"}`);
    }
  } catch (err) {
    console.log(
      `[fb-probe] /videos failed: ${err.response?.status} ${JSON.stringify(err.response?.data?.error || err.message)}`,
    );
  }

  // 3) /video_reels — Reels-specific surface. May show pending /
  //    rejected Reels that don't appear under /videos.
  console.log("\n[fb-probe] === /video_reels ===");
  try {
    const reels = await fetchAll(
      `https://graph.facebook.com/v21.0/${pageId}/video_reels`,
      {
        fields:
          "id,title,description,permalink_url,published,created_time,status",
        access_token: token,
        limit: 50,
      },
      4,
    );
    console.log(`Total Reels found: ${reels.length}`);
    for (const v of reels.slice(0, 25)) {
      const status = v.status?.video_status || "?";
      const phase = v.status?.publishing_phase?.status || "?";
      console.log(
        `- ${v.id} created=${v.created_time} status=${status}/${phase} published=${v.published}`,
      );
      console.log(`    title: ${(v.title || "").slice(0, 80)}`);
      console.log(`    permalink: ${v.permalink_url || "(none)"}`);
    }
  } catch (err) {
    console.log(
      `[fb-probe] /video_reels failed: ${err.response?.status} ${JSON.stringify(err.response?.data?.error || err.message)}`,
    );
  }

  // 4) /posts — feed posts. If the Reels uploads are silently being
  //    converted to feed-video posts, they'd appear here.
  console.log("\n[fb-probe] === /posts (recent feed posts) ===");
  try {
    const posts = await fetchAll(
      `https://graph.facebook.com/v21.0/${pageId}/posts`,
      {
        fields:
          "id,message,permalink_url,created_time,is_published,attachments{type,subattachments{type,media,target}}",
        access_token: token,
        limit: 25,
      },
      2,
    );
    console.log(`Total feed posts found: ${posts.length}`);
    for (const p of posts.slice(0, 15)) {
      console.log(
        `- ${p.id} created=${p.created_time} is_published=${p.is_published}`,
      );
      console.log(`    msg: ${(p.message || "").slice(0, 80)}`);
      console.log(`    permalink: ${p.permalink_url || "(none)"}`);
      const att = p.attachments?.data?.[0];
      if (att) {
        console.log(`    attachment_type: ${att.type}`);
      }
    }
  } catch (err) {
    console.log(
      `[fb-probe] /posts failed: ${err.response?.status} ${JSON.stringify(err.response?.data?.error || err.message)}`,
    );
  }

  // 5) Token debug — confirm the token has the scopes we expect for
  //    Reels publishing.
  console.log("\n[fb-probe] === Token scope inspection ===");
  try {
    const debug = await axios.get(
      "https://graph.facebook.com/v21.0/debug_token",
      {
        params: {
          input_token: token,
          access_token: token,
        },
        timeout: 15_000,
      },
    );
    const data = debug.data?.data || {};
    console.log(`type: ${data.type || "?"}`);
    console.log(`app_id: ${data.app_id || "?"}`);
    console.log(
      `expires_at: ${data.expires_at ? new Date(data.expires_at * 1000).toISOString() : "never"}`,
    );
    console.log(`is_valid: ${data.is_valid}`);
    console.log(`scopes: ${(data.scopes || []).join(", ") || "(none)"}`);
    console.log(
      `granular_scopes: ${JSON.stringify(data.granular_scopes || []).slice(0, 400)}`,
    );
  } catch (err) {
    console.log(
      `[fb-probe] debug_token failed: ${err.response?.status} ${JSON.stringify(err.response?.data?.error || err.message)}`,
    );
  }
}

if (require.main === module) {
  main()
    .then(() => {
      console.log("\n[fb-probe] done");
    })
    .catch((err) => {
      console.error("[fb-probe] FAILED:", err.message);
      process.exit(1);
    });
}

module.exports = { main };
