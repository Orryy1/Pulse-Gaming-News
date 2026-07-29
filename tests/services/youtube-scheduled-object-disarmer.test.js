"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  createYoutubeScheduledObjectDisarmer,
  mutableYoutubeStatusWithoutPublishAt,
} = require("../../lib/services/youtube-scheduled-object-disarmer");

const EXTERNAL_ID = "youtube-scheduled-object-1";
const SCHEDULED_FOR = "2026-07-28T19:00:00.000Z";
const STARTED_AT = "2026-07-28T18:30:00.000Z";

function scheduledStatus(overrides = {}) {
  return {
    privacyStatus: "private",
    publishAt: SCHEDULED_FOR,
    uploadStatus: "processed",
    license: "youtube",
    embeddable: false,
    publicStatsViewable: false,
    selfDeclaredMadeForKids: false,
    containsSyntheticMedia: true,
    ...overrides,
  };
}

function unscheduledStatus(overrides = {}) {
  const status = scheduledStatus(overrides);
  delete status.publishAt;
  return status;
}

function listResponse(status, id = EXTERNAL_ID) {
  return {
    data: {
      items: [{ id, status }],
    },
  };
}

function candidate() {
  return {
    platform: "youtube",
    externalId: EXTERNAL_ID,
    scheduledFor: SCHEDULED_FOR,
  };
}

test("disarm preserves every accepted mutable status field, deliberately omits only publishAt and proves private unscheduled state", async () => {
  const lists = [
    listResponse(scheduledStatus()),
    listResponse(unscheduledStatus()),
  ];
  const updates = [];
  let boundaryChecks = 0;
  let updateMarkers = 0;
  const youtubeClient = {
    videos: {
      async list() {
        return lists.shift();
      },
      async update(input) {
        updates.push(input);
        return {
          data: {
            id: EXTERNAL_ID,
            status: input.requestBody.status,
          },
        };
      },
    },
  };
  const disarm = createYoutubeScheduledObjectDisarmer({
    youtubeClient,
    now: () => new Date(STARTED_AT),
  });

  const result = await disarm({
    ...candidate(),
    async assertUpdateBoundary() {
      boundaryChecks += 1;
    },
    markUpdateAttemptStarted() {
      updateMarkers += 1;
    },
  });

  assert.equal(result.confirmed, true);
  assert.equal(result.alreadyDisarmed, false);
  assert.equal(result.externalId, EXTERNAL_ID);
  assert.equal(result.evidence.privacy_status, "private");
  assert.equal(result.evidence.publish_at, null);
  assert.equal(result.evidence.schedule_disarm_confirmed, true);
  assert.equal(boundaryChecks, 1);
  assert.equal(updateMarkers, 1);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].part, ["status"]);
  assert.deepEqual(updates[0].requestBody, {
    id: EXTERNAL_ID,
    status: {
      privacyStatus: "private",
      license: "youtube",
      embeddable: false,
      publicStatsViewable: false,
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: true,
    },
  });
  assert.equal(
    Object.hasOwn(updates[0].requestBody.status, "publishAt"),
    false,
  );
});

test("emergency containment forces every unsafe exact-object state private and unscheduled with read-back proof", async (t) => {
  for (const scenario of [
    {
      name: "unauthorised expected publishAt",
      status: scheduledStatus(),
      reason: "youtube_private_object_unexpected_publish_at",
      publishAt: SCHEDULED_FOR,
      publishAtPresent: true,
      publishAtInvalid: false,
    },
    {
      name: "early public object",
      status: (() => {
        const value = scheduledStatus({
          privacyStatus: "public",
        });
        delete value.publishAt;
        return value;
      })(),
      reason: "youtube_private_object_published_early",
      publishAt: null,
      publishAtPresent: false,
      publishAtInvalid: false,
    },
    {
      name: "different publishAt",
      status: scheduledStatus({
        publishAt: "2026-07-29T09:00:00.000Z",
      }),
      reason: "youtube_private_object_unexpected_publish_at",
      publishAt: "2026-07-29T09:00:00.000Z",
      publishAtPresent: true,
      publishAtInvalid: false,
    },
    {
      name: "malformed publishAt",
      status: scheduledStatus({
        publishAt: "not-a-date",
      }),
      reason: "youtube_private_object_publish_at_invalid",
      publishAt: null,
      publishAtPresent: true,
      publishAtInvalid: true,
    },
  ]) {
    await t.test(scenario.name, async () => {
      const containedStatus = scheduledStatus();
      delete containedStatus.publishAt;
      const lists = [
        listResponse(scenario.status),
        listResponse(containedStatus),
      ];
      const updates = [];
      const disarm = createYoutubeScheduledObjectDisarmer({
        youtubeClient: {
          videos: {
            async list() {
              return lists.shift();
            },
            async update(input) {
              updates.push(input);
              return { data: { id: EXTERNAL_ID } };
            },
          },
        },
        now: () => new Date(STARTED_AT),
      });

      const result = await disarm({
        ...candidate(),
        emergencyContainment: true,
        containmentReason: scenario.reason,
        assertUpdateBoundary() {},
        markUpdateAttemptStarted() {},
      });

      assert.equal(result.confirmed, true);
      assert.equal(result.emergencyContainment, true);
      assert.equal(result.compensationRequired, true);
      assert.equal(result.compensationAttempted, true);
      assert.equal(result.compensationConfirmed, true);
      assert.equal(
        result.evidence.emergency_containment,
        true,
      );
      assert.equal(
        result.evidence.containment_reason,
        scenario.reason,
      );
      assert.equal(
        result.evidence.before.publish_at_present,
        scenario.publishAtPresent,
      );
      assert.equal(
        result.evidence.before.publish_at_invalid,
        scenario.publishAtInvalid,
      );
      assert.equal(
        result.evidence.before.publish_at,
        scenario.publishAt,
      );
      assert.equal(
        result.evidence.publish_at_present,
        false,
      );
      assert.equal(updates.length, 1);
      assert.equal(
        Object.hasOwn(
          updates[0].requestBody.status,
          "publishAt",
        ),
        false,
      );
    });
  }
});

test("mutable status projection excludes read-only fields and publishAt without losing explicit false values", () => {
  assert.deepEqual(
    mutableYoutubeStatusWithoutPublishAt({
      privacyStatus: "private",
      publishAt: SCHEDULED_FOR,
      uploadStatus: "processed",
      failureReason: "ignored",
      madeForKids: true,
      license: "creativeCommon",
      embeddable: false,
      publicStatsViewable: false,
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: false,
    }),
    {
      privacyStatus: "private",
      license: "creativeCommon",
      embeddable: false,
      publicStatsViewable: false,
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: false,
    },
  );
});

test("exact-object or publishAt mismatch refuses update and reports remote contact", async () => {
  for (const response of [
    listResponse(scheduledStatus(), "different-youtube-object"),
    listResponse(
      scheduledStatus({
        publishAt: "2026-07-28T20:00:00.000Z",
      }),
    ),
  ]) {
    let updates = 0;
    const disarm = createYoutubeScheduledObjectDisarmer({
      youtubeClient: {
        videos: {
          async list() {
            return response;
          },
          async update() {
            updates += 1;
          },
        },
      },
      now: () => new Date(STARTED_AT),
    });

    await assert.rejects(
      disarm({
        ...candidate(),
        assertUpdateBoundary() {},
        markUpdateAttemptStarted() {},
      }),
      (error) => {
        assert.equal(error.platformContacted, true);
        assert.equal(error.updateAttemptStarted, false);
        assert.equal(error.externalId, EXTERNAL_ID);
        assert.match(
          error.code,
          /youtube_schedule_disarm_(object_identity|publish_at)_mismatch/,
        );
        return true;
      },
    );
    assert.equal(updates, 0);
  }
});

test("an already-private unscheduled exact object is idempotent and never updates", async () => {
  let updates = 0;
  let boundaryChecks = 0;
  const disarm = createYoutubeScheduledObjectDisarmer({
    youtubeClient: {
      videos: {
        async list() {
          return listResponse(
            unscheduledStatus(),
          );
        },
        async update() {
          updates += 1;
        },
      },
    },
    now: () => new Date(STARTED_AT),
  });

  const result = await disarm({
    ...candidate(),
    assertUpdateBoundary() {
      boundaryChecks += 1;
    },
    markUpdateAttemptStarted() {},
  });

  assert.equal(result.confirmed, true);
  assert.equal(result.alreadyDisarmed, true);
  assert.equal(updates, 0);
  assert.equal(boundaryChecks, 0);
});

test("an update timeout is reconciliation-only and carries exact mutation-boundary evidence", async () => {
  const timeout = new Error("socket timeout");
  timeout.code = "ETIMEDOUT";
  const disarm = createYoutubeScheduledObjectDisarmer({
    youtubeClient: {
      videos: {
        async list() {
          return listResponse(scheduledStatus());
        },
        async update() {
          throw timeout;
        },
      },
    },
    now: () => new Date(STARTED_AT),
  });

  await assert.rejects(
    disarm({
      ...candidate(),
      assertUpdateBoundary() {},
      markUpdateAttemptStarted() {},
    }),
    (error) => {
      assert.equal(
        error.code,
        "youtube_schedule_disarm_update_uncertain",
      );
      assert.equal(error.platformContacted, true);
      assert.equal(error.updateAttemptStarted, true);
      assert.equal(error.externalId, EXTERNAL_ID);
      assert.equal(error.reconciliationRequired, true);
      return true;
    },
  );
});

test("post-update verification timeout and stale verification both require reconciliation", async () => {
  for (const scenario of ["timeout", "drift"]) {
    let listCalls = 0;
    let clockCalls = 0;
    const disarm = createYoutubeScheduledObjectDisarmer({
      youtubeClient: {
        videos: {
          async list() {
            listCalls += 1;
            if (listCalls === 1) {
              return listResponse(scheduledStatus());
            }
            if (scenario === "timeout") {
              const error = new Error("verification timeout");
              error.code = "ETIMEDOUT";
              throw error;
            }
            return listResponse(
              unscheduledStatus(),
            );
          },
          async update() {
            return { data: { id: EXTERNAL_ID } };
          },
        },
      },
      now() {
        clockCalls += 1;
        return new Date(
          clockCalls === 1
            ? STARTED_AT
            : "2026-07-28T18:36:00.000Z",
        );
      },
      maxVerificationAgeMs: 5 * 60 * 1000,
    });

    await assert.rejects(
      disarm({
        ...candidate(),
        assertUpdateBoundary() {},
        markUpdateAttemptStarted() {},
      }),
      (error) => {
        assert.equal(error.platformContacted, true);
        assert.equal(error.updateAttemptStarted, true);
        assert.equal(error.reconciliationRequired, true);
        assert.equal(
          error.code,
          scenario === "timeout"
            ? "youtube_schedule_disarm_verification_uncertain"
            : "youtube_schedule_disarm_verification_time_drifted",
        );
        return true;
      },
    );
  }
});
