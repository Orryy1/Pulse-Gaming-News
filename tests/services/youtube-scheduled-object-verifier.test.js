"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  createYoutubeScheduledObjectVerifier,
} = require("../../lib/services/youtube-scheduled-object-verifier");

const SCHEDULED_FOR = "2026-07-28T19:00:00.000Z";

test("scheduled verifier proves the exact private processed object and publishAt binding", async () => {
  const calls = [];
  let attempt = 0;
  const verifier = createYoutubeScheduledObjectVerifier({
    youtubeClient: {
      videos: {
        async list(input) {
          calls.push(input);
          attempt += 1;
          return {
            data: {
              items: [
                {
                  id: "yt-scheduled-1",
                  status: {
                    privacyStatus: "private",
                    uploadStatus:
                      attempt === 1 ? "uploaded" : "processed",
                    publishAt: SCHEDULED_FOR,
                  },
                  processingDetails: {
                    processingStatus:
                      attempt === 1 ? "processing" : "succeeded",
                  },
                },
              ],
            },
          };
        },
      },
    },
    now: () => new Date("2026-07-28T18:46:00.000Z"),
    sleep: async () => {},
    maxAttempts: 2,
    pollIntervalMs: 0,
  });

  const result = await verifier({
    platform: "youtube",
    externalId: "yt-scheduled-1",
    scheduledFor: SCHEDULED_FOR,
  });

  assert.equal(result.confirmed, true);
  assert.equal(result.reason, "youtube_private_schedule_processed");
  assert.equal(result.externalId, "yt-scheduled-1");
  assert.equal(result.scheduledFor, SCHEDULED_FOR);
  assert.equal(result.evidence.privacy_status, "private");
  assert.equal(result.evidence.publish_at, SCHEDULED_FOR);
  assert.equal(result.evidence.upload_status, "processed");
  assert.equal(result.evidence.processing_status, "succeeded");
  assert.equal(result.evidence.scheduled_release_confirmed, true);
  assert.deepEqual(calls[0], {
    part: ["status", "processingDetails"],
    id: ["yt-scheduled-1"],
    maxResults: 1,
  });
});

test("scheduled verifier fails closed when YouTube returns a different publishAt", async () => {
  const verifier = createYoutubeScheduledObjectVerifier({
    youtubeClient: {
      videos: {
        async list() {
          return {
            data: {
              items: [
                {
                  id: "yt-scheduled-drift",
                  status: {
                    privacyStatus: "private",
                    uploadStatus: "processed",
                    publishAt: "2026-07-29T09:00:00.000Z",
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
    now: () => new Date("2026-07-28T18:46:00.000Z"),
    sleep: async () => {},
    maxAttempts: 1,
  });

  const result = await verifier({
    platform: "youtube",
    externalId: "yt-scheduled-drift",
    scheduledFor: SCHEDULED_FOR,
  });

  assert.equal(result.confirmed, false);
  assert.equal(result.reason, "youtube_publish_at_mismatch");
  assert.equal(result.evidence.scheduled_release_confirmed, false);
  assert.equal(result.incident_required, true);
  assert.equal(result.attempts, 1);
});

test("scheduled verifier treats early public visibility as an incident, never success", async () => {
  const verifier = createYoutubeScheduledObjectVerifier({
    youtubeClient: {
      videos: {
        async list() {
          return {
            data: {
              items: [
                {
                  id: "yt-early-public",
                  status: {
                    privacyStatus: "public",
                    uploadStatus: "processed",
                    publishAt: SCHEDULED_FOR,
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
    now: () => new Date("2026-07-28T18:46:00.000Z"),
    sleep: async () => {},
    maxAttempts: 1,
  });

  const result = await verifier({
    platform: "youtube",
    externalId: "yt-early-public",
    scheduledFor: SCHEDULED_FOR,
  });

  assert.equal(result.confirmed, false);
  assert.equal(
    result.reason,
    "youtube_scheduled_object_published_early",
  );
  assert.equal(result.incident_required, true);
});

test("scheduled verifier rejects zone-less and non-guarded release identities before API contact", async () => {
  let calls = 0;
  const verifier = createYoutubeScheduledObjectVerifier({
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
      externalId: "yt-invalid-zone",
      scheduledFor: "2026-07-28T19:00:00",
    }),
    /youtube_scheduled_publish_timezone_required/,
  );
  await assert.rejects(
    verifier({
      platform: "youtube",
      externalId: "yt-invalid-hour",
      scheduledFor: "2026-07-28T20:00:00.000Z",
    }),
    /youtube_scheduled_publish_window_not_guarded/,
  );
  assert.equal(calls, 0);
});
