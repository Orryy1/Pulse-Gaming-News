"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  createYoutubeScheduledObjectArmer,
} = require("../../lib/services/youtube-scheduled-object-armer");

const SCHEDULED_FOR = "2026-07-28T19:00:00.000Z";

test("schedule armer updates the exact private-unscheduled object once and verifies publishAt read-back", async () => {
  const updates = [];
  let reads = 0;
  let boundaryChecks = 0;
  let updateMarkers = 0;
  const armer = createYoutubeScheduledObjectArmer({
    youtubeClient: {
      videos: {
        async list() {
          reads += 1;
          return {
            data: {
              items: [
                {
                  id: "yt-arm-1",
                  status: {
                    privacyStatus: "private",
                    uploadStatus: "processed",
                    embeddable: true,
                    selfDeclaredMadeForKids: false,
                    containsSyntheticMedia: true,
                    ...(reads > 1
                      ? { publishAt: SCHEDULED_FOR }
                      : {}),
                  },
                },
              ],
            },
          };
        },
        async update(input) {
          updates.push(input);
          return { data: { id: "yt-arm-1" } };
        },
      },
    },
    now: () => new Date("2026-07-28T18:45:00.000Z"),
  });

  const result = await armer({
    platform: "youtube",
    externalId: "yt-arm-1",
    scheduledFor: SCHEDULED_FOR,
    async assertUpdateBoundary() {
      boundaryChecks += 1;
    },
    markUpdateAttemptStarted() {
      updateMarkers += 1;
    },
  });

  assert.equal(result.confirmed, true);
  assert.equal(result.externalId, "yt-arm-1");
  assert.equal(result.scheduledFor, SCHEDULED_FOR);
  assert.equal(result.updateAttemptStarted, true);
  assert.equal(boundaryChecks, 1);
  assert.equal(updateMarkers, 1);
  assert.equal(reads, 2);
  assert.deepEqual(updates, [
    {
      part: ["status"],
      requestBody: {
        id: "yt-arm-1",
        status: {
          privacyStatus: "private",
          embeddable: true,
          selfDeclaredMadeForKids: false,
          containsSyntheticMedia: true,
          publishAt: SCHEDULED_FOR,
        },
      },
    },
  ]);
  assert.equal(result.evidence.schedule_arm_confirmed, true);
  assert.equal(result.evidence.release_armed, true);
  assert.equal(result.evidence.publish_at, SCHEDULED_FOR);
});

test("schedule armer refuses an already-armed object before its update boundary", async () => {
  let updates = 0;
  let boundaryChecks = 0;
  const armer = createYoutubeScheduledObjectArmer({
    youtubeClient: {
      videos: {
        async list() {
          return {
            data: {
              items: [
                {
                  id: "yt-already-armed",
                  status: {
                    privacyStatus: "private",
                    publishAt: SCHEDULED_FOR,
                  },
                },
              ],
            },
          };
        },
        async update() {
          updates += 1;
        },
      },
    },
    now: () => new Date("2026-07-28T18:45:00.000Z"),
  });

  await assert.rejects(
    armer({
      platform: "youtube",
      externalId: "yt-already-armed",
      scheduledFor: SCHEDULED_FOR,
      assertUpdateBoundary() {
        boundaryChecks += 1;
      },
      markUpdateAttemptStarted() {},
    }),
    (error) => {
      assert.equal(
        error.code,
        "youtube_schedule_arm_requires_private_unscheduled_object",
      );
      assert.equal(error.platformContacted, true);
      assert.equal(error.updateAttemptStarted, false);
      assert.equal(error.expectedScheduledObject, true);
      assert.equal(error.compensationRequired, true);
      assert.equal(error.remoteContainmentRequired, true);
      assert.equal(
        error.compensationReason,
        "youtube_private_object_unexpected_publish_at",
      );
      assert.equal(
        error.observedRemoteState.publish_at,
        SCHEDULED_FOR,
      );
      return true;
    },
  );
  assert.equal(boundaryChecks, 0);
  assert.equal(updates, 0);
});

test("schedule armer exposes exact containment metadata for unsafe remote state without mutating it", async (t) => {
  for (const scenario of [
    {
      name: "early public",
      status: { privacyStatus: "public" },
      reason: "youtube_private_object_published_early",
    },
    {
      name: "different publishAt",
      status: {
        privacyStatus: "private",
        publishAt: "2026-07-29T09:00:00.000Z",
      },
      reason: "youtube_private_object_unexpected_publish_at",
    },
    {
      name: "malformed publishAt",
      status: {
        privacyStatus: "private",
        publishAt: "not-a-date",
      },
      reason: "youtube_private_object_publish_at_invalid",
    },
  ]) {
    await t.test(scenario.name, async () => {
      let updates = 0;
      const armer = createYoutubeScheduledObjectArmer({
        youtubeClient: {
          videos: {
            async list() {
              return {
                data: {
                  items: [
                    {
                      id: "yt-unsafe-arm-state",
                      status: scenario.status,
                    },
                  ],
                },
              };
            },
            async update() {
              updates += 1;
            },
          },
        },
        now: () =>
          new Date("2026-07-28T18:45:00.000Z"),
      });

      await assert.rejects(
        armer({
          platform: "youtube",
          externalId: "yt-unsafe-arm-state",
          scheduledFor: SCHEDULED_FOR,
          assertUpdateBoundary() {},
          markUpdateAttemptStarted() {},
        }),
        (error) => {
          assert.equal(error.compensationRequired, true);
          assert.equal(
            error.remoteContainmentRequired,
            true,
          );
          assert.equal(error.compensationReason, scenario.reason);
          assert.equal(error.expectedScheduledObject, false);
          assert.equal(
            error.observedRemoteState.external_id,
            "yt-unsafe-arm-state",
          );
          return true;
        },
      );
      assert.equal(updates, 0);
    });
  }
});

test("schedule armer durably awaits the update-attempt marker before videos.update", async () => {
  const order = [];
  let reads = 0;
  const armer = createYoutubeScheduledObjectArmer({
    youtubeClient: {
      videos: {
        async list() {
          reads += 1;
          return {
            data: {
              items: [
                {
                  id: "yt-durable-marker",
                  status: {
                    privacyStatus: "private",
                    uploadStatus: "processed",
                    ...(reads > 1
                      ? { publishAt: SCHEDULED_FOR }
                      : {}),
                  },
                },
              ],
            },
          };
        },
        async update() {
          order.push("update");
          return { data: { id: "yt-durable-marker" } };
        },
      },
    },
    now: () => new Date("2026-07-28T18:45:00.000Z"),
  });

  await armer({
    platform: "youtube",
    externalId: "yt-durable-marker",
    scheduledFor: SCHEDULED_FOR,
    async assertUpdateBoundary() {},
    async markUpdateAttemptStarted() {
      await Promise.resolve();
      order.push("marker");
    },
  });

  assert.deepEqual(order, ["marker", "update"]);
});
