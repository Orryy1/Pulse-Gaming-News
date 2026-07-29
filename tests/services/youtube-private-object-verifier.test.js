"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  createYoutubePrivateObjectVerifier,
} = require("../../lib/services/youtube-private-object-verifier");

test("private-object verifier proves the exact processed object has no publishAt", async () => {
  const calls = [];
  const verifier = createYoutubePrivateObjectVerifier({
    youtubeClient: {
      videos: {
        async list(input) {
          calls.push(input);
          return {
            data: {
              items: [
                {
                  id: "yt-private-1",
                  status: {
                    privacyStatus: "private",
                    uploadStatus: "processed",
                  },
                  processingDetails: {
                    processingStatus: "succeeded",
                  },
                },
              ],
            },
          };
        },
      },
    },
    now: () => new Date("2026-07-28T18:00:00.000Z"),
    sleep: async () => {},
    maxAttempts: 1,
    pollIntervalMs: 0,
  });

  const result = await verifier({
    platform: "youtube",
    externalId: "yt-private-1",
  });

  assert.equal(result.confirmed, true);
  assert.equal(
    result.reason,
    "youtube_private_unscheduled_processed",
  );
  assert.equal(result.externalId, "yt-private-1");
  assert.equal(result.evidence.privacy_status, "private");
  assert.equal(result.evidence.publish_at, null);
  assert.equal(result.evidence.upload_status, "processed");
  assert.equal(result.evidence.processing_status, "succeeded");
  assert.equal(result.evidence.scheduled_release_confirmed, false);
  assert.deepEqual(calls, [
    {
      part: ["status", "processingDetails"],
      id: ["yt-private-1"],
      maxResults: 1,
    },
  ]);
});

test("private-object verifier rejects every release-timing field before API contact", async () => {
  let calls = 0;
  const verifier = createYoutubePrivateObjectVerifier({
    youtubeClient: {
      videos: {
        async list() {
          calls += 1;
          return { data: { items: [] } };
        },
      },
    },
    sleep: async () => {},
    maxAttempts: 1,
  });

  for (const forbidden of [
    { scheduledFor: "2026-07-28T19:00:00.000Z" },
    { scheduled_for: "2026-07-28T19:00:00.000Z" },
    { publishAt: "2026-07-28T19:00:00.000Z" },
    { publish_at: "2026-07-28T19:00:00.000Z" },
  ]) {
    await assert.rejects(
      verifier({
        platform: "youtube",
        externalId: "yt-private-1",
        ...forbidden,
      }),
      /youtube_private_verifier_release_authority_forbidden/,
    );
  }
  assert.equal(calls, 0);
});

test("private-object verifier treats present or malformed publishAt as an incident", async () => {
  for (const [publishAt, expectedReason] of [
    [
      "2026-07-28T19:00:00.000Z",
      "youtube_private_object_unexpected_publish_at",
    ],
    ["", "youtube_private_object_publish_at_invalid"],
    ["not-a-date", "youtube_private_object_publish_at_invalid"],
  ]) {
    const verifier = createYoutubePrivateObjectVerifier({
      youtubeClient: {
        videos: {
          async list() {
            return {
              data: {
                items: [
                  {
                    id: "yt-private-armed",
                    status: {
                      privacyStatus: "private",
                      uploadStatus: "processed",
                      publishAt,
                    },
                    processingDetails: {
                      processingStatus: "succeeded",
                    },
                  },
                ],
              },
            };
          },
        },
      },
      now: () => new Date("2026-07-28T18:00:00.000Z"),
      sleep: async () => {},
      maxAttempts: 1,
    });

    const result = await verifier({
      platform: "youtube",
      externalId: "yt-private-armed",
    });

    assert.equal(result.confirmed, false);
    assert.equal(result.reason, expectedReason);
    assert.equal(result.incident_required, true);
    assert.equal(result.evidence.publish_at_present, true);
    assert.equal(result.evidence.release_armed, true);
  }
});

test("private-object verifier treats an unlisted anchored object as an immediate containment incident", async () => {
  const verifier = createYoutubePrivateObjectVerifier({
    youtubeClient: {
      videos: {
        async list() {
          return {
            data: {
              items: [
                {
                  id: "yt-unlisted",
                  status: {
                    privacyStatus: "unlisted",
                    uploadStatus: "processed",
                  },
                  processingDetails: {
                    processingStatus: "succeeded",
                  },
                },
              ],
            },
          };
        },
      },
    },
    now: () => new Date("2026-07-28T18:00:00.000Z"),
    sleep: async () => {},
    maxAttempts: 3,
    pollIntervalMs: 0,
  });

  const result = await verifier({
    platform: "youtube",
    externalId: "yt-unlisted",
  });

  assert.equal(result.confirmed, false);
  assert.equal(
    result.reason,
    "youtube_private_object_privacy_not_private",
  );
  assert.equal(result.incident_required, true);
  assert.equal(result.attempts, 1);
  assert.equal(result.evidence.privacy_status, "unlisted");
});

test("private-object verifier rejects conflicting exact-object identities", async () => {
  let calls = 0;
  const verifier = createYoutubePrivateObjectVerifier({
    youtubeClient: {
      videos: {
        async list() {
          calls += 1;
          return { data: { items: [] } };
        },
      },
    },
    sleep: async () => {},
    maxAttempts: 1,
  });

  await assert.rejects(
    verifier({
      platform: "youtube",
      externalId: "yt-private-1",
      external_id: "yt-private-2",
    }),
    /youtube_external_id_conflict/,
  );
  assert.equal(calls, 0);
});

test("private-object verifier can perform one abortable GET for a durable convergence invocation", async () => {
  const calls = [];
  const controller = new AbortController();
  const verifier = createYoutubePrivateObjectVerifier({
    youtubeClient: {
      videos: {
        async list(...args) {
          calls.push(args);
          return { data: { items: [] } };
        },
      },
    },
    sleep: async () => {},
    maxAttempts: 4,
    pollIntervalMs: 0,
    now: () => new Date("2026-07-29T18:00:00.000Z"),
  });

  const result = await verifier(
    {
      platform: "youtube",
      externalId: "yt-private-bounded",
    },
    {
      maxAttempts: 1,
      signal: controller.signal,
    },
  );

  assert.equal(result.confirmed, false);
  assert.equal(result.attempts, 1);
  assert.equal(result.exhausted, true);
  assert.equal(result.evidence.max_attempts, 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [
    {
      part: ["status", "processingDetails"],
      id: ["yt-private-bounded"],
      maxResults: 1,
    },
    { signal: controller.signal },
  ]);
});

test("private-object verifier performs no GET when its invocation is already aborted", async () => {
  let calls = 0;
  const controller = new AbortController();
  controller.abort(new Error("bounded_attempt_expired"));
  const verifier = createYoutubePrivateObjectVerifier({
    youtubeClient: {
      videos: {
        async list() {
          calls += 1;
          return { data: { items: [] } };
        },
      },
    },
    maxAttempts: 3,
  });

  await assert.rejects(
    verifier(
      {
        platform: "youtube",
        externalId: "yt-private-aborted",
      },
      {
        maxAttempts: 1,
        signal: controller.signal,
      },
    ),
    /bounded_attempt_expired/,
  );
  assert.equal(calls, 0);
});

test("private-object invocation cannot increase the factory polling budget", async () => {
  let calls = 0;
  const verifier = createYoutubePrivateObjectVerifier({
    youtubeClient: {
      videos: {
        async list() {
          calls += 1;
          return { data: { items: [] } };
        },
      },
    },
    sleep: async () => {},
    maxAttempts: 2,
    pollIntervalMs: 0,
    now: () => new Date("2026-07-29T18:00:00.000Z"),
  });

  const result = await verifier(
    {
      platform: "youtube",
      externalId: "yt-private-bounded",
    },
    { maxAttempts: 9 },
  );

  assert.equal(calls, 2);
  assert.equal(result.attempts, 2);
  assert.equal(result.evidence.max_attempts, 2);
  assert.equal(result.exhausted, true);
});
