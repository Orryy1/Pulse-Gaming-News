"use strict";

/**
 * lib/intelligence/instagram-pending-verifier.js
 *
 * Catches Instagram Reels that timed out the in-process processing wait
 * but were accepted by Meta and finished processing later. publisher.js
 * stamps these stories with:
 *   story.instagram_error  = "instagram_reel pending_processing_timeout: container_id=<id> creation_id=<id> ..."
 *   result.platform_outcomes.instagram = "accepted_processing"
 *
 * Without follow-up, those stories sit in `accepted_processing` forever
 * and never get an instagram_media_id stamped on the row, even when the
 * container is sitting on Meta's side fully processed.
 *
 * This module periodically:
 *   1. finds stories whose `instagram_error` carries
 *      `pending_processing_timeout` AND no `instagram_media_id`
 *   2. parses the container id out of the error message
 *   3. asks Graph for the container's current status_code
 *   4. when FINISHED → POST /media_publish, write instagram_media_id,
 *      clear the error
 *   5. when ERROR / 404 / container_expired → clear the error so the
 *      story is no longer treated as pending; mark the platform_posts
 *      row failed
 *   6. when IN_PROGRESS → leave the row alone for the next pass
 *
 * The whole module is gated behind INSTAGRAM_PENDING_VERIFIER_ENABLED in
 * the scheduler/handler. When the env flag is unset, runVerifyPass()
 * returns `{ enabled: false, ...zeros }` without touching the DB or the
 * Graph API. This is the safety release valve — production behaviour is
 * unchanged until an operator opts in.
 *
 * Pure side-effect surface:
 *   - reads stories via db.getStories()
 *   - writes stories via db.upsertStory()
 *   - reads/writes platform_posts via repos (when available)
 *   - one Graph GET per pending container, one Graph POST per finisher
 *
 * Never throws on individual-container failures — surfaces the error
 * onto the per-story summary so the next pass retries.
 */

const axios = require("axios");

const PENDING_ERROR_RE = /\bpending_processing_timeout\b/;
const CONTAINER_ID_RE = /\bcontainer_id=([0-9]+)\b/;

// Maximum age (since story.created_at) we'll keep retrying a pending
// container. Meta typically expires media containers after ~24h. Beyond
// 48h the GET is just guaranteed-404 noise.
const MAX_PENDING_AGE_MS = 48 * 60 * 60 * 1000;

/**
 * Parse `container_id=<digits>` out of an instagram_error message.
 * Returns the container id string, or null if absent / malformed.
 *
 * Exported for unit testing.
 */
function parseContainerIdFromError(errMessage) {
  if (!errMessage || typeof errMessage !== "string") return null;
  if (!PENDING_ERROR_RE.test(errMessage)) return null;
  const m = CONTAINER_ID_RE.exec(errMessage);
  return m ? m[1] : null;
}

/**
 * Decide whether a story is a verifier candidate.
 *
 *   - instagram_error contains pending_processing_timeout
 *   - container id is parseable
 *   - story has no instagram_media_id yet
 *   - created_at, if present, is within MAX_PENDING_AGE_MS
 *
 * Exported for testing.
 */
function isPendingCandidate(story, now = Date.now()) {
  if (!story) return false;
  if (story.instagram_media_id) return false;
  const containerId = parseContainerIdFromError(story.instagram_error);
  if (!containerId) return false;
  if (story.created_at) {
    const ts = Date.parse(story.created_at);
    if (!Number.isNaN(ts) && now - ts > MAX_PENDING_AGE_MS) return false;
  }
  return true;
}

function findPendingInstagramStories(stories, now = Date.now()) {
  return (stories || []).filter((s) => isPendingCandidate(s, now));
}

/**
 * Hit the Graph status endpoint for one container and return a
 * normalised verdict:
 *   { state: "FINISHED" | "IN_PROGRESS" | "ERROR" | "EXPIRED" | "UNKNOWN",
 *     containerId, raw, http_status }
 *
 * "EXPIRED" covers the 404 case — Meta drops containers after ~24h
 * and any GET against them returns 404 OAuthException.
 */
async function checkContainerStatus({
  containerId,
  accessToken,
  http = axios,
}) {
  try {
    const res = await http.get(
      `https://graph.facebook.com/v21.0/${containerId}`,
      {
        params: {
          fields: "status_code,status",
          access_token: accessToken,
        },
        // Defensive — verifier should never block the runner if the
        // Graph API hangs. 15s is generous for a single field read.
        timeout: 15000,
      },
    );
    const status = (res && res.data && res.data.status_code) || "UNKNOWN";
    const known = new Set(["FINISHED", "IN_PROGRESS", "ERROR", "EXPIRED"]);
    return {
      state: known.has(status) ? status : "UNKNOWN",
      containerId,
      raw: res.data || null,
      http_status: res.status || null,
    };
  } catch (err) {
    const code = err.response && err.response.status;
    // Container expired / removed by Meta — treat as terminal so we
    // stop retrying the same dead id every pass.
    if (code === 404 || code === 400) {
      return {
        state: "EXPIRED",
        containerId,
        raw: (err.response && err.response.data) || null,
        http_status: code,
      };
    }
    // 5xx / network — transient, keep state UNKNOWN so we retry next pass.
    return {
      state: "UNKNOWN",
      containerId,
      raw: (err.response && err.response.data) || null,
      http_status: code || null,
      error: err.message,
    };
  }
}

/**
 * Publish a finished container.
 */
async function publishContainer({
  accountId,
  containerId,
  accessToken,
  http = axios,
}) {
  const res = await http.post(
    `https://graph.facebook.com/v21.0/${accountId}/media_publish`,
    {
      creation_id: containerId,
      access_token: accessToken,
    },
  );
  const mediaId = res && res.data && res.data.id;
  if (!mediaId) {
    const err = new Error(
      "instagram_pending_verifier: media_publish returned no id",
    );
    err.raw = res && res.data;
    throw err;
  }
  return mediaId;
}

/**
 * Verify one candidate story end-to-end.
 *
 * Returns a per-story summary:
 *   {
 *     storyId,
 *     containerId,
 *     state: "finished" | "still_pending" | "expired" | "error_terminal" | "transient_error" | "no_container",
 *     mediaId?: string,
 *     error?: string,
 *   }
 */
async function verifyOne({
  story,
  accountId,
  accessToken,
  repos,
  db,
  http = axios,
  log = () => {},
}) {
  const containerId = parseContainerIdFromError(story.instagram_error);
  if (!containerId) {
    return { storyId: story.id, state: "no_container" };
  }

  const status = await checkContainerStatus({
    containerId,
    accessToken,
    http,
  });

  // FINISHED: publish the container and stamp the story.
  if (status.state === "FINISHED") {
    try {
      const mediaId = await publishContainer({
        accountId,
        containerId,
        accessToken,
        http,
      });
      story.instagram_media_id = mediaId;
      story.instagram_error = null;
      story.instagram_pending_verified_at = new Date().toISOString();
      await db.upsertStory(story);

      // Best-effort platform_posts upgrade: pending → published.
      try {
        if (repos && repos.platformPosts) {
          const row = repos.platformPosts.ensurePending(
            story.id,
            "instagram_reel",
            { channelId: story.channel_id || null },
          );
          repos.platformPosts.markPublished(row.id, {
            externalId: mediaId,
            externalUrl: null,
          });
        }
      } catch (repoErr) {
        log(
          `[ig-pending-verifier] platform_posts mark_published failed for ${story.id}: ${repoErr.message}`,
        );
      }

      log(
        `[ig-pending-verifier] FINISHED → published container=${containerId} story=${story.id} media_id=${mediaId}`,
      );
      return { storyId: story.id, containerId, state: "finished", mediaId };
    } catch (publishErr) {
      // Publish failed — leave the row pending so the next pass retries.
      log(
        `[ig-pending-verifier] FINISHED but publish failed for ${story.id}: ${publishErr.message}`,
      );
      return {
        storyId: story.id,
        containerId,
        state: "transient_error",
        error: publishErr.message,
      };
    }
  }

  // EXPIRED / 404 / 400 — terminal, stop retrying.
  if (status.state === "EXPIRED" || status.state === "ERROR") {
    story.instagram_error = `instagram_reel pending_verifier_terminal: container_id=${containerId} state=${status.state} http_status=${status.http_status || "?"}`;
    story.instagram_pending_verified_at = new Date().toISOString();
    await db.upsertStory(story);

    try {
      if (repos && repos.platformPosts) {
        const row = repos.platformPosts.ensurePending(
          story.id,
          "instagram_reel",
          { channelId: story.channel_id || null },
        );
        repos.platformPosts.markFailed(row.id, story.instagram_error);
      }
    } catch (repoErr) {
      log(
        `[ig-pending-verifier] platform_posts mark_failed failed for ${story.id}: ${repoErr.message}`,
      );
    }

    log(
      `[ig-pending-verifier] terminal state=${status.state} container=${containerId} story=${story.id}`,
    );
    return { storyId: story.id, containerId, state: "error_terminal" };
  }

  // IN_PROGRESS / UNKNOWN — leave the row alone, retry next pass.
  return {
    storyId: story.id,
    containerId,
    state: status.state === "IN_PROGRESS" ? "still_pending" : "transient_error",
    error: status.error || null,
  };
}

/**
 * Run one verifier pass over every pending-IG story in the DB.
 *
 * Gated behind INSTAGRAM_PENDING_VERIFIER_ENABLED unless `forceEnabled`
 * is passed. Default-off so production behaviour is unchanged when this
 * module ships.
 *
 * Returns:
 *   {
 *     enabled: boolean,
 *     checked: number,
 *     finished: number,
 *     still_pending: number,
 *     expired_or_error: number,
 *     transient: number,
 *     no_container: number,
 *     errors: string[],   // module-level (not per-story) errors only
 *     items: Array<{storyId, containerId, state, ...}>
 *   }
 */
async function runVerifyPass({
  forceEnabled = false,
  log = console.log,
  db = require("../db"),
  repos = null,
  uploadInstagram = require("../../upload_instagram"),
  http = axios,
  env = process.env,
} = {}) {
  const summary = {
    enabled: false,
    checked: 0,
    finished: 0,
    still_pending: 0,
    expired_or_error: 0,
    transient: 0,
    no_container: 0,
    errors: [],
    items: [],
  };

  const enabledByEnv = String(env.INSTAGRAM_PENDING_VERIFIER_ENABLED || "")
    .toLowerCase()
    .trim();
  const enabled =
    forceEnabled || enabledByEnv === "true" || enabledByEnv === "1";
  if (!enabled) {
    return summary;
  }
  summary.enabled = true;

  let stories;
  try {
    stories = await db.getStories();
  } catch (err) {
    summary.errors.push(`getStories failed: ${err.message}`);
    return summary;
  }

  const candidates = findPendingInstagramStories(stories);
  if (candidates.length === 0) {
    return summary;
  }

  let accessToken;
  let accountId;
  try {
    if (typeof uploadInstagram.seedTokenFromEnv === "function") {
      await uploadInstagram.seedTokenFromEnv();
    }
    if (!env.INSTAGRAM_ACCESS_TOKEN) {
      summary.errors.push("INSTAGRAM_ACCESS_TOKEN not set");
      return summary;
    }
    accessToken = env.INSTAGRAM_ACCESS_TOKEN;
    accountId = env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
    if (!accountId) {
      summary.errors.push("INSTAGRAM_BUSINESS_ACCOUNT_ID not set");
      return summary;
    }
  } catch (err) {
    summary.errors.push(`auth_setup_failed: ${err.message}`);
    return summary;
  }

  // Lazy-load repos only when there's actual work — keeps cold-path
  // cheap when the candidate list is empty.
  let activeRepos = repos;
  if (!activeRepos) {
    try {
      activeRepos = require("../repositories").getRepos();
    } catch {
      activeRepos = null;
    }
  }

  for (const story of candidates) {
    summary.checked++;
    let result;
    try {
      result = await verifyOne({
        story,
        accountId,
        accessToken,
        repos: activeRepos,
        db,
        http,
        log,
      });
    } catch (err) {
      result = {
        storyId: story.id,
        state: "transient_error",
        error: err.message,
      };
    }
    summary.items.push(result);
    switch (result.state) {
      case "finished":
        summary.finished++;
        break;
      case "still_pending":
        summary.still_pending++;
        break;
      case "expired":
      case "error_terminal":
        summary.expired_or_error++;
        break;
      case "no_container":
        summary.no_container++;
        break;
      default:
        summary.transient++;
    }
  }

  return summary;
}

module.exports = {
  parseContainerIdFromError,
  isPendingCandidate,
  findPendingInstagramStories,
  checkContainerStatus,
  publishContainer,
  verifyOne,
  runVerifyPass,
  PENDING_ERROR_RE,
  CONTAINER_ID_RE,
  MAX_PENDING_AGE_MS,
};
