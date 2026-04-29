"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const verifier = require("../../lib/intelligence/instagram-pending-verifier");

// publisher.js stamps stories that timed out the in-process IG processing
// wait with the message format from upload_instagram.js
// buildInstagramPendingProcessingTimeoutError, e.g.
//   "instagram_reel pending_processing_timeout: container_id=18012345678901234 ..."
// This file pins the verifier that picks those up, asks Graph for the
// container's status, and either publishes (FINISHED) or marks terminal
// (404/ERROR/EXPIRED). Default-OFF — runVerifyPass returns enabled=false
// when INSTAGRAM_PENDING_VERIFIER_ENABLED is unset.

const SAMPLE_ERR =
  "instagram_reel pending_processing_timeout: " +
  "container_id=18012345678901234 creation_id=18012345678901234 " +
  "attempts=60 poll_ms=10000 status_code=IN_PROGRESS verify_later=true";

// ── parser ────────────────────────────────────────────────────────

test("parseContainerIdFromError extracts container id from real publisher error", () => {
  const id = verifier.parseContainerIdFromError(SAMPLE_ERR);
  assert.equal(id, "18012345678901234");
});

test("parseContainerIdFromError returns null for unrelated errors", () => {
  assert.equal(verifier.parseContainerIdFromError(null), null);
  assert.equal(verifier.parseContainerIdFromError(""), null);
  assert.equal(verifier.parseContainerIdFromError("oauth expired"), null);
  assert.equal(
    verifier.parseContainerIdFromError("Instagram binary upload failed"),
    null,
  );
});

test("parseContainerIdFromError requires the pending_processing_timeout marker", () => {
  // The container id substring alone is not enough — we only act on
  // errors explicitly tagged as pending. A "container_id=...failed" error
  // from a different code path must not accidentally match.
  const otherErr =
    "Instagram processing failed: container_id=18099999999999 status=ERROR";
  assert.equal(verifier.parseContainerIdFromError(otherErr), null);
});

// ── candidate selection ───────────────────────────────────────────

function pendingStory(overrides = {}) {
  return {
    id: "story-pending",
    instagram_error: SAMPLE_ERR,
    instagram_media_id: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

test("isPendingCandidate accepts a fresh pending row", () => {
  assert.equal(verifier.isPendingCandidate(pendingStory()), true);
});

test("isPendingCandidate rejects a row that already has instagram_media_id", () => {
  assert.equal(
    verifier.isPendingCandidate(
      pendingStory({ instagram_media_id: "9876543210" }),
    ),
    false,
  );
});

test("isPendingCandidate rejects a row whose error is not a pending timeout", () => {
  assert.equal(
    verifier.isPendingCandidate(
      pendingStory({ instagram_error: "Instagram binary upload failed" }),
    ),
    false,
  );
});

test("isPendingCandidate rejects rows older than the max-pending age window", () => {
  const tooOld = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  assert.equal(
    verifier.isPendingCandidate(pendingStory({ created_at: tooOld })),
    false,
  );
});

test("findPendingInstagramStories filters a mixed batch", () => {
  const stories = [
    pendingStory({ id: "ok-1" }),
    pendingStory({ id: "already-published", instagram_media_id: "1" }),
    pendingStory({
      id: "not-pending",
      instagram_error: "binary upload failed",
    }),
    pendingStory({ id: "ok-2" }),
    null,
    undefined,
  ];
  const got = verifier.findPendingInstagramStories(stories);
  assert.deepEqual(got.map((s) => s.id).sort(), ["ok-1", "ok-2"]);
});

// ── Graph status check ────────────────────────────────────────────

function mockHttp({ getResponse, getError, postResponse, postError } = {}) {
  const calls = { get: [], post: [] };
  return {
    calls,
    async get(url, options) {
      calls.get.push({ url, options });
      if (getError) throw getError;
      return getResponse;
    },
    async post(url, body) {
      calls.post.push({ url, body });
      if (postError) throw postError;
      return postResponse;
    },
  };
}

test("checkContainerStatus maps status_code=FINISHED through", async () => {
  const http = mockHttp({
    getResponse: { status: 200, data: { status_code: "FINISHED" } },
  });
  const r = await verifier.checkContainerStatus({
    containerId: "111",
    accessToken: "tok",
    http,
  });
  assert.equal(r.state, "FINISHED");
  assert.equal(r.containerId, "111");
  assert.match(http.calls.get[0].url, /\/v21\.0\/111$/);
  assert.equal(http.calls.get[0].options.params.access_token, "tok");
});

test("checkContainerStatus maps 404 to EXPIRED", async () => {
  const httpErr = new Error("not found");
  httpErr.response = { status: 404, data: { error: { code: 100 } } };
  const http = mockHttp({ getError: httpErr });
  const r = await verifier.checkContainerStatus({
    containerId: "222",
    accessToken: "tok",
    http,
  });
  assert.equal(r.state, "EXPIRED");
  assert.equal(r.http_status, 404);
});

test("checkContainerStatus maps 5xx to UNKNOWN (transient, retry next pass)", async () => {
  const httpErr = new Error("graph down");
  httpErr.response = { status: 503, data: {} };
  const http = mockHttp({ getError: httpErr });
  const r = await verifier.checkContainerStatus({
    containerId: "333",
    accessToken: "tok",
    http,
  });
  assert.equal(r.state, "UNKNOWN");
});

// ── verifyOne end-to-end ──────────────────────────────────────────

function memoryDb() {
  const rows = new Map();
  return {
    rows,
    async upsertStory(story) {
      rows.set(story.id, { ...story });
    },
    async getStories() {
      return Array.from(rows.values());
    },
  };
}

function fakeRepos() {
  const calls = { ensurePending: [], markPublished: [], markFailed: [] };
  return {
    calls,
    platformPosts: {
      ensurePending(storyId, platform, opts) {
        calls.ensurePending.push({ storyId, platform, opts });
        return { id: 42 };
      },
      markPublished(id, payload) {
        calls.markPublished.push({ id, payload });
      },
      markFailed(id, reason) {
        calls.markFailed.push({ id, reason });
      },
    },
  };
}

test("verifyOne: FINISHED → publishes, stamps media_id, clears error, marks platform_posts published", async () => {
  const story = pendingStory({ id: "fin-1" });
  const db = memoryDb();
  await db.upsertStory(story);
  const repos = fakeRepos();
  const http = mockHttp({
    getResponse: { status: 200, data: { status_code: "FINISHED" } },
    postResponse: { status: 200, data: { id: "media_xyz" } },
  });

  const result = await verifier.verifyOne({
    story,
    accountId: "acct1",
    accessToken: "tok",
    repos,
    db,
    http,
  });

  assert.equal(result.state, "finished");
  assert.equal(result.mediaId, "media_xyz");
  const persisted = db.rows.get("fin-1");
  assert.equal(persisted.instagram_media_id, "media_xyz");
  assert.equal(persisted.instagram_error, null);
  assert.ok(persisted.instagram_pending_verified_at);
  assert.equal(repos.calls.ensurePending.length, 1);
  assert.equal(repos.calls.ensurePending[0].platform, "instagram_reel");
  assert.equal(repos.calls.markPublished.length, 1);
  assert.equal(repos.calls.markPublished[0].payload.externalId, "media_xyz");
});

test("verifyOne: still IN_PROGRESS → no DB write, returns still_pending", async () => {
  const story = pendingStory({ id: "ip-1" });
  const db = memoryDb();
  await db.upsertStory(story);
  const before = JSON.stringify(db.rows.get("ip-1"));
  const repos = fakeRepos();
  const http = mockHttp({
    getResponse: { status: 200, data: { status_code: "IN_PROGRESS" } },
  });

  const result = await verifier.verifyOne({
    story,
    accountId: "acct1",
    accessToken: "tok",
    repos,
    db,
    http,
  });

  assert.equal(result.state, "still_pending");
  assert.equal(JSON.stringify(db.rows.get("ip-1")), before);
  assert.deepEqual(repos.calls.markPublished, []);
  assert.deepEqual(repos.calls.markFailed, []);
});

test("verifyOne: 404 EXPIRED → terminal, error rewritten, platform_posts marked failed", async () => {
  const story = pendingStory({ id: "exp-1" });
  const db = memoryDb();
  await db.upsertStory(story);
  const repos = fakeRepos();
  const httpErr = new Error("expired");
  httpErr.response = { status: 404, data: { error: { code: 100 } } };
  const http = mockHttp({ getError: httpErr });

  const result = await verifier.verifyOne({
    story,
    accountId: "acct1",
    accessToken: "tok",
    repos,
    db,
    http,
  });

  assert.equal(result.state, "error_terminal");
  const persisted = db.rows.get("exp-1");
  assert.match(persisted.instagram_error, /pending_verifier_terminal/);
  assert.ok(!persisted.instagram_media_id);
  assert.equal(repos.calls.markFailed.length, 1);
});

test("verifyOne: FINISHED but media_publish 5xx → transient_error, story untouched for retry", async () => {
  const story = pendingStory({ id: "pub-fail-1" });
  const db = memoryDb();
  await db.upsertStory(story);
  const repos = fakeRepos();
  const postErr = new Error("graph 503");
  postErr.response = { status: 503, data: {} };
  const http = mockHttp({
    getResponse: { status: 200, data: { status_code: "FINISHED" } },
    postError: postErr,
  });

  const result = await verifier.verifyOne({
    story,
    accountId: "acct1",
    accessToken: "tok",
    repos,
    db,
    http,
  });

  assert.equal(result.state, "transient_error");
  // Story instagram_error should NOT be cleared — next pass retries.
  const persisted = db.rows.get("pub-fail-1");
  assert.match(persisted.instagram_error || "", /pending_processing_timeout/);
  assert.ok(!persisted.instagram_media_id);
  assert.deepEqual(repos.calls.markPublished, []);
});

// ── runVerifyPass: env gating + summary ──────────────────────────

test("runVerifyPass: env unset → enabled=false, no Graph traffic", async () => {
  const db = memoryDb();
  await db.upsertStory(pendingStory({ id: "p-1" }));
  const http = mockHttp({});
  const summary = await verifier.runVerifyPass({
    db,
    repos: fakeRepos(),
    http,
    uploadInstagram: { seedTokenFromEnv: async () => {} },
    env: {
      /* INSTAGRAM_PENDING_VERIFIER_ENABLED unset */
    },
    log: () => {},
  });
  assert.equal(summary.enabled, false);
  assert.equal(summary.checked, 0);
  assert.equal(http.calls.get.length, 0);
});

test("runVerifyPass: env true + finished container → publishes and tallies finished=1", async () => {
  const db = memoryDb();
  await db.upsertStory(pendingStory({ id: "rvp-fin" }));
  const repos = fakeRepos();
  const http = mockHttp({
    getResponse: { status: 200, data: { status_code: "FINISHED" } },
    postResponse: { status: 200, data: { id: "ig_media_42" } },
  });
  const summary = await verifier.runVerifyPass({
    db,
    repos,
    http,
    uploadInstagram: { seedTokenFromEnv: async () => {} },
    env: {
      INSTAGRAM_PENDING_VERIFIER_ENABLED: "true",
      INSTAGRAM_ACCESS_TOKEN: "tok",
      INSTAGRAM_BUSINESS_ACCOUNT_ID: "acct",
    },
    log: () => {},
  });
  assert.equal(summary.enabled, true);
  assert.equal(summary.checked, 1);
  assert.equal(summary.finished, 1);
  assert.equal(summary.still_pending, 0);
  assert.equal(summary.expired_or_error, 0);
  assert.equal(db.rows.get("rvp-fin").instagram_media_id, "ig_media_42");
});

test("runVerifyPass: missing INSTAGRAM_ACCESS_TOKEN → returns error, no candidates checked", async () => {
  const db = memoryDb();
  await db.upsertStory(pendingStory({ id: "no-tok" }));
  const summary = await verifier.runVerifyPass({
    db,
    repos: fakeRepos(),
    http: mockHttp({}),
    uploadInstagram: { seedTokenFromEnv: async () => {} },
    env: { INSTAGRAM_PENDING_VERIFIER_ENABLED: "true" },
    log: () => {},
  });
  assert.equal(summary.enabled, true);
  assert.equal(summary.checked, 0);
  assert.ok(summary.errors.some((e) => /INSTAGRAM_ACCESS_TOKEN/.test(e)));
});

test("runVerifyPass: env true + zero candidates → enabled=true, checked=0, no Graph traffic", async () => {
  const db = memoryDb();
  // No stories in pending state.
  const http = mockHttp({});
  const summary = await verifier.runVerifyPass({
    db,
    repos: fakeRepos(),
    http,
    uploadInstagram: { seedTokenFromEnv: async () => {} },
    env: {
      INSTAGRAM_PENDING_VERIFIER_ENABLED: "true",
      INSTAGRAM_ACCESS_TOKEN: "tok",
      INSTAGRAM_BUSINESS_ACCOUNT_ID: "acct",
    },
    log: () => {},
  });
  assert.equal(summary.enabled, true);
  assert.equal(summary.checked, 0);
  assert.equal(http.calls.get.length, 0);
});

test("runVerifyPass: env true + mixed batch → tally per state", async () => {
  const db = memoryDb();
  await db.upsertStory(pendingStory({ id: "fin" }));
  await db.upsertStory(pendingStory({ id: "still" }));
  await db.upsertStory(pendingStory({ id: "expired" }));

  // Sequence the GET responses so the three candidates land in
  // different state buckets. The candidates are processed in
  // findPendingInstagramStories order, which is stories array order.
  const responses = [
    { status: 200, data: { status_code: "FINISHED" } },
    { status: 200, data: { status_code: "IN_PROGRESS" } },
    { __throw: { response: { status: 404, data: {} } } },
  ];
  let cursor = 0;
  const http = {
    calls: { get: [], post: [] },
    async get(url, options) {
      this.calls.get.push({ url, options });
      const r = responses[cursor++];
      if (r && r.__throw) {
        const err = new Error("404");
        err.response = r.__throw.response;
        throw err;
      }
      return r;
    },
    async post(url, body) {
      this.calls.post.push({ url, body });
      return { status: 200, data: { id: "media_pub" } };
    },
  };

  const summary = await verifier.runVerifyPass({
    db,
    repos: fakeRepos(),
    http,
    uploadInstagram: { seedTokenFromEnv: async () => {} },
    env: {
      INSTAGRAM_PENDING_VERIFIER_ENABLED: "true",
      INSTAGRAM_ACCESS_TOKEN: "tok",
      INSTAGRAM_BUSINESS_ACCOUNT_ID: "acct",
    },
    log: () => {},
  });
  assert.equal(summary.checked, 3);
  assert.equal(summary.finished, 1);
  assert.equal(summary.still_pending, 1);
  assert.equal(summary.expired_or_error, 1);
});
