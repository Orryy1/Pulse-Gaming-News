"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  createYoutubePublicObjectVerifier,
} = require("../../lib/services/youtube-public-object-verifier");

const CANDIDATE = {
  platform: "youtube",
  external_id: "yt-video-1",
};

test("default verification budget allows normal YouTube processing propagation", async () => {
  let calls = 0;
  const sleeps = [];
  const verifier = createYoutubePublicObjectVerifier({
    youtubeClient: {
      videos: {
        async list() {
          calls += 1;
          return {
            data: {
              items: [
                {
                  id: "yt-default-budget",
                  status: {
                    privacyStatus: "public",
                    uploadStatus:
                      calls < 10 ? "uploaded" : "processed",
                  },
                },
              ],
            },
          };
        },
      },
    },
    sleep: async (milliseconds) => sleeps.push(milliseconds),
    now: () => new Date("2026-07-27T12:00:00.000Z"),
  });

  const result = await verifier({
    platform: "youtube",
    externalId: "yt-default-budget",
  });

  assert.equal(result.confirmed, true);
  assert.equal(result.attempts, 10);
  assert.equal(result.evidence.max_attempts, 10);
  assert.equal(calls, 10);
  assert.deepEqual(sleeps, Array(9).fill(5000));
});

test("verifier polls until the exact YouTube object is public and processed", async () => {
  const calls = [];
  const sleeps = [];
  const timestamps = [
    new Date("2026-07-27T12:00:00.000Z"),
    new Date("2026-07-27T12:00:00.250Z"),
  ];
  let attempt = 0;
  const verifier = createYoutubePublicObjectVerifier({
    youtubeClient: {
      videos: {
        async list(input) {
          calls.push(input);
          attempt += 1;
          return {
            data: {
              items: [
                {
                  id: CANDIDATE.external_id,
                  status: {
                    privacyStatus: "public",
                    uploadStatus:
                      attempt === 1 ? "uploaded" : "processed",
                  },
                },
              ],
            },
          };
        },
      },
    },
    maxAttempts: 3,
    pollIntervalMs: 250,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
    now: () => timestamps.shift(),
  });

  const result = await verifier(CANDIDATE);

  assert.equal(result.confirmed, true);
  assert.equal(result.externalId, CANDIDATE.external_id);
  assert.equal(
    result.externalUrl,
    "https://www.youtube.com/watch?v=yt-video-1",
  );
  assert.equal(result.reason, "youtube_public_processed");
  assert.equal(result.attempts, 2);
  assert.equal(result.verifiedAt, "2026-07-27T12:00:00.250Z");
  assert.deepEqual(result.evidence, {
    platform: "youtube",
    platform_object_confirmed: true,
    public: true,
    privacy_status: "public",
    upload_status: "processed",
    checked_at: "2026-07-27T12:00:00.250Z",
    first_checked_at: "2026-07-27T12:00:00.000Z",
    reason: "youtube_public_processed",
    attempts: 2,
    max_attempts: 3,
  });
  assert.deepEqual(sleeps, [250]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    part: ["status"],
    id: [CANDIDATE.external_id],
    maxResults: 1,
  });
});

test("verifier accepts the governed dispatch camelCase object identity", async () => {
  const verifier = createYoutubePublicObjectVerifier({
    youtubeClient: {
      videos: {
        async list() {
          return {
            data: {
              items: [
                {
                  id: "yt-canonical-1",
                  status: {
                    privacyStatus: "public",
                    uploadStatus: "processed",
                  },
                },
              ],
            },
          };
        },
      },
    },
    maxAttempts: 1,
    sleep: async () => {},
    now: () => new Date("2026-07-27T12:00:00.000Z"),
  });

  const result = await verifier({
    platform: "youtube",
    externalId: "yt-canonical-1",
    externalUrl: "https://www.youtube.com/watch?v=yt-canonical-1",
  });

  assert.equal(result.confirmed, true);
  assert.equal(result.externalId, "yt-canonical-1");
});

test("private objects exhaust bounded checks and remain unconfirmed", async () => {
  let calls = 0;
  const sleeps = [];
  const timestamps = [
    new Date("2026-07-27T12:00:00.000Z"),
    new Date("2026-07-27T12:00:00.500Z"),
  ];
  const verifier = createYoutubePublicObjectVerifier({
    youtubeClient: {
      videos: {
        async list() {
          calls += 1;
          return {
            data: {
              items: [
                {
                  id: "yt-private-1",
                  status: {
                    privacyStatus: "private",
                    uploadStatus: "processed",
                  },
                },
              ],
            },
          };
        },
      },
    },
    maxAttempts: 2,
    pollIntervalMs: 500,
    sleep: async (milliseconds) => sleeps.push(milliseconds),
    now: () => timestamps.shift(),
  });

  const result = await verifier({
    platform: "youtube",
    externalId: "yt-private-1",
  });

  assert.equal(result.confirmed, false);
  assert.equal(result.reason, "youtube_privacy_not_public");
  assert.equal(result.attempts, 2);
  assert.equal(result.exhausted, true);
  assert.equal(result.verifiedAt, "2026-07-27T12:00:00.500Z");
  assert.equal(result.evidence.platform_object_confirmed, true);
  assert.equal(result.evidence.public, false);
  assert.equal(result.evidence.privacy_status, "private");
  assert.equal(result.evidence.upload_status, "processed");
  assert.equal(result.evidence.reason, "youtube_privacy_not_public");
  assert.equal(result.evidence.exhausted, true);
  assert.deepEqual(sleeps, [500]);
  assert.equal(calls, 2);
});

test("an absent object fails closed with explicit not-found evidence", async () => {
  const timestamps = [
    new Date("2026-07-27T12:00:00.000Z"),
    new Date("2026-07-27T12:00:01.000Z"),
  ];
  const verifier = createYoutubePublicObjectVerifier({
    youtubeClient: {
      videos: {
        async list() {
          return { data: { items: [] } };
        },
      },
    },
    maxAttempts: 2,
    pollIntervalMs: 1000,
    sleep: async () => {},
    now: () => timestamps.shift(),
  });

  const result = await verifier({
    platform: "youtube",
    externalId: "yt-missing-1",
  });

  assert.equal(result.confirmed, false);
  assert.equal(result.externalUrl, null);
  assert.equal(result.reason, "youtube_object_not_found");
  assert.equal(result.exhausted, true);
  assert.equal(result.evidence.platform_object_confirmed, false);
  assert.equal(result.evidence.public, false);
  assert.equal(result.evidence.privacy_status, null);
  assert.equal(result.evidence.upload_status, null);
  assert.equal(result.evidence.checked_at, "2026-07-27T12:00:01.000Z");
  assert.equal(
    result.evidence.first_checked_at,
    "2026-07-27T12:00:00.000Z",
  );
});

test("a public but unprocessed upload is not confirmed", async () => {
  const verifier = createYoutubePublicObjectVerifier({
    youtubeClient: {
      videos: {
        async list() {
          return {
            data: {
              items: [
                {
                  id: "yt-processing-1",
                  status: {
                    privacyStatus: "public",
                    uploadStatus: "uploaded",
                  },
                },
              ],
            },
          };
        },
      },
    },
    maxAttempts: 1,
    sleep: async () => {},
    now: () => new Date("2026-07-27T12:00:00.000Z"),
  });

  const result = await verifier({
    platform: "youtube",
    externalId: "yt-processing-1",
  });

  assert.equal(result.confirmed, false);
  assert.equal(result.reason, "youtube_upload_not_processed");
  assert.equal(result.exhausted, true);
  assert.equal(result.evidence.platform_object_confirmed, true);
  assert.equal(result.evidence.public, false);
  assert.equal(result.evidence.privacy_status, "public");
  assert.equal(result.evidence.upload_status, "uploaded");
});

test("API check errors exhaust bounded retries and return fail-closed evidence", async () => {
  let calls = 0;
  const sleeps = [];
  const timestamps = [
    new Date("2026-07-27T12:00:00.000Z"),
    new Date("2026-07-27T12:00:00.100Z"),
  ];
  const verifier = createYoutubePublicObjectVerifier({
    youtubeClient: {
      videos: {
        async list() {
          calls += 1;
          throw Object.assign(new Error("credential rejected"), {
            code: 403,
          });
        },
      },
    },
    maxAttempts: 2,
    pollIntervalMs: 100,
    sleep: async (milliseconds) => sleeps.push(milliseconds),
    now: () => timestamps.shift(),
  });

  const result = await verifier({
    platform: "youtube",
    externalId: "yt-api-error-1",
  });

  assert.equal(result.confirmed, false);
  assert.equal(result.externalUrl, null);
  assert.equal(result.reason, "youtube_api_check_error");
  assert.equal(result.attempts, 2);
  assert.equal(result.exhausted, true);
  assert.equal(result.verifiedAt, "2026-07-27T12:00:00.100Z");
  assert.equal(result.evidence.platform_object_confirmed, false);
  assert.equal(result.evidence.public, false);
  assert.equal(result.evidence.reason, "youtube_api_check_error");
  assert.equal(result.evidence.api_error_code, "403");
  assert.equal("api_error_message" in result.evidence, false);
  assert.deepEqual(sleeps, [100]);
  assert.equal(calls, 2);
});

test("factory fails closed before client creation for absent or invalid API keys", () => {
  assert.throws(
    () => createYoutubePublicObjectVerifier({ apiKey: " " }),
    /youtube_api_key_required/,
  );
  assert.throws(
    () =>
      createYoutubePublicObjectVerifier({
        apiKey: "not-a-google-api-key",
      }),
    /youtube_api_key_invalid/,
  );
});

test("a malformed API response is not misreported as proof that the object is absent", async () => {
  const verifier = createYoutubePublicObjectVerifier({
    youtubeClient: {
      videos: {
        async list() {
          return { data: {} };
        },
      },
    },
    maxAttempts: 1,
    sleep: async () => {},
    now: () => new Date("2026-07-27T12:00:00.000Z"),
  });

  const result = await verifier({
    platform: "youtube",
    externalId: "yt-invalid-response-1",
  });

  assert.equal(result.confirmed, false);
  assert.equal(result.reason, "youtube_api_response_invalid");
  assert.equal(result.exhausted, true);
  assert.equal(result.evidence.platform_object_confirmed, false);
  assert.equal(result.evidence.reason, "youtube_api_response_invalid");
});

test("polling configuration is strictly bounded", () => {
  const youtubeClient = {
    videos: {
      async list() {
        return { data: { items: [] } };
      },
    },
  };
  assert.throws(
    () =>
      createYoutubePublicObjectVerifier({
        youtubeClient,
        maxAttempts: 0,
      }),
    /youtube_verifier_max_attempts_invalid/,
  );
  assert.throws(
    () =>
      createYoutubePublicObjectVerifier({
        youtubeClient,
        maxAttempts: 11,
      }),
    /youtube_verifier_max_attempts_invalid/,
  );
  assert.throws(
    () =>
      createYoutubePublicObjectVerifier({
        youtubeClient,
        pollIntervalMs: 60_001,
      }),
    /youtube_verifier_poll_interval_invalid/,
  );
});

test("public-object verifier can perform one abortable GET for a durable convergence invocation", async () => {
  const calls = [];
  const controller = new AbortController();
  const verifier = createYoutubePublicObjectVerifier({
    youtubeClient: {
      videos: {
        async list(...args) {
          calls.push(args);
          return {
            data: {
              items: [
                {
                  id: "yt-public-bounded",
                  status: {
                    privacyStatus: "public",
                    uploadStatus: "uploaded",
                  },
                },
              ],
            },
          };
        },
      },
    },
    sleep: async () => {},
    maxAttempts: 4,
    pollIntervalMs: 0,
    now: () => new Date("2026-07-29T19:00:00.000Z"),
  });

  const result = await verifier(
    {
      platform: "youtube",
      externalId: "yt-public-bounded",
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
      part: ["status"],
      id: ["yt-public-bounded"],
      maxResults: 1,
    },
    { signal: controller.signal },
  ]);
});

test("public-object verifier performs no GET when its invocation is already aborted", async () => {
  let calls = 0;
  const controller = new AbortController();
  controller.abort(new Error("bounded_attempt_expired"));
  const verifier = createYoutubePublicObjectVerifier({
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
        externalId: "yt-public-aborted",
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

test("public-object invocation cannot increase the factory polling budget", async () => {
  let calls = 0;
  const verifier = createYoutubePublicObjectVerifier({
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
    now: () => new Date("2026-07-29T19:00:00.000Z"),
  });

  const result = await verifier(
    {
      platform: "youtube",
      externalId: "yt-public-bounded",
    },
    { maxAttempts: 9 },
  );

  assert.equal(calls, 2);
  assert.equal(result.attempts, 2);
  assert.equal(result.evidence.max_attempts, 2);
  assert.equal(result.exhausted, true);
});
