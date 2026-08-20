"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  buildSystemTraceYouTubeAuthorities,
} = require("../../lib/services/system-trace-youtube-authority");

function fixture() {
  const episodes = Array.from({ length: 7 }, (_, index) => ({
    story_id: `story-${index + 1}`,
    project_dir: `videos/story-${index + 1}`,
    publish_at_utc: new Date(Date.UTC(2026, 7, 15 + index, 19)).toISOString(),
    title: `Title ${index + 1}`,
    description: `Description ${index + 1}`,
    tags: ["System Trace", `episode ${index + 1}`],
  }));
  const manifest = {
    schema_version: 1,
    schema: "pulse_system_trace_youtube_buffer_v1",
    channel: { id: "channel-1", title: "Pulse Gaming" },
    platform: "youtube_shorts",
    timezone: "UTC",
    cadence: "one_per_day",
    initial_privacy_status: "private",
    notify_subscribers_on_upload: false,
    synthetic_media_disclosure: true,
    episodes,
  };
  const rightsLedger = {
    schema_version: 1,
    schema: "pulse_system_trace_buffer_rights_ledger_v1",
    scope: { episode_count: 7, platform: "youtube_shorts", finished_editorial_video_only: true },
    visuals: { verdict: "GREEN", third_party_visual_assets_embedded: false },
    narration: { verdict: "GREEN", synthetic_media: true, disclosure_setting: "YES" },
    music: { verdict: "GREEN", commercial_use_allowed: true, planned_episode_placements: 7, reuse_limit_pass: true },
    sound_effects: { verdict: "GREEN" },
    fonts: { verdict: "GREEN" },
    placement_verdict: "GREEN",
    blockers: [],
    public_release_scope: "exact rendered seven-episode System Trace buffer only",
  };
  const proofs = Object.fromEntries(episodes.map((episode) => {
    const requestPlan = {
      story_id: episode.story_id,
      mode: "LOCAL_MOCK_DRY_RUN",
      verdict: "REQUEST_SHAPE_PASS",
      request_shape_verdict: "PASS",
      can_publish: false,
      publish_authority: "NOT_EVALUATED",
      source_of_truth: "closed_governed_package",
      video_insert: {
        operation: "youtube.videos.insert",
        part: ["snippet", "status", "paidProductPlacementDetails"],
        params: { notifySubscribers: false },
        requestBody: { snippet: { title: episode.title }, status: { privacyStatus: "private", containsSyntheticMedia: true } },
        media_sha256: "c".repeat(64),
      },
      thumbnail_set: null,
      caption_insert: {
        operation: "youtube.captions.insert",
        part: ["snippet"],
        requestBody: { snippet: { language: "en-GB" } },
        media_sha256: "d".repeat(64),
      },
    };
    return [episode.story_id, {
      schema_version: 1,
      verdict: "NOT_EVALUATED",
      request_shape_verdict: "PASS",
      publish_allowed: false,
      publish_authority: "NOT_EVALUATED",
      story_id: episode.story_id,
      blockers: [],
      request_plan: requestPlan,
      mock_dry_run: { verdict: "REQUEST_SHAPE_PASS", request_shape_verdict: "PASS", publish_authority: "NOT_EVALUATED" },
    }];
  }));
  return { manifest, rightsLedger, proofs };
}

test("materialises seven exact private-first and native-schedule authorities", () => {
  const input = fixture();
  const receiptRoot = path.resolve("D:/pulse-evidence/system-trace-test/receipts");
  const result = buildSystemTraceYouTubeAuthorities({
    ...input,
    manifestSha256: "a".repeat(64),
    rightsLedgerSha256: "b".repeat(64),
    receiptRoot,
    generatedAt: "2026-08-14T18:00:00.000Z",
  });
  assert.equal(result.verdict, "GREEN");
  assert.equal(result.authorities.length, 7);
  assert.equal(result.authorities[0].private_upload.verdict, "GREEN");
  assert.equal(result.authorities[0].private_upload.dispatch.mode, "PRIVATE_FIRST");
  assert.equal(result.authorities[0].private_upload.dispatch.single_use, true);
  assert.equal(result.authorities[0].release.public_schedule_allowed, true);
  assert.equal(result.authorities[0].release.auto_publish_general_allowed, false);
  assert.equal(result.authorities[0].release.publish_at_utc, "2026-08-15T19:00:00.000Z");
  assert.match(result.authorities[0].private_upload.request_plan_fingerprint_sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.operator_decision.operator_id, "MORR");
});

test("fails closed when any series rights gate is not GREEN", () => {
  const input = fixture();
  input.rightsLedger.music.verdict = "AMBER";
  assert.throws(
    () => buildSystemTraceYouTubeAuthorities({
      ...input,
      manifestSha256: "a".repeat(64),
      rightsLedgerSha256: "b".repeat(64),
      receiptRoot: path.resolve("D:/pulse-evidence/system-trace-test/receipts"),
      generatedAt: "2026-08-14T18:00:00.000Z",
    }),
    /system_trace_youtube_authority_blocked/,
  );
});

test("supports a separately sealed seven-day schedule only when every expected slot matches", () => {
  const input = fixture();
  const expectedPublishAtUtc = input.manifest.episodes.map((episode, index) => {
    const value = new Date(Date.UTC(2026, 7, 22 + index, 17)).toISOString();
    episode.publish_at_utc = value;
    return value;
  });

  const result = buildSystemTraceYouTubeAuthorities({
    ...input,
    expectedPublishAtUtc,
    manifestSha256: "a".repeat(64),
    rightsLedgerSha256: "b".repeat(64),
    receiptRoot: path.resolve("D:/pulse-evidence/system-trace-display-test/receipts"),
    generatedAt: "2026-08-20T07:00:00.000Z",
  });

  assert.deepEqual(
    result.authorities.map((authority) => authority.release.publish_at_utc),
    expectedPublishAtUtc,
  );

  input.manifest.episodes[3].publish_at_utc = "2026-08-25T17:01:00.000Z";
  assert.throws(
    () => buildSystemTraceYouTubeAuthorities({
      ...input,
      expectedPublishAtUtc,
      manifestSha256: "a".repeat(64),
      rightsLedgerSha256: "b".repeat(64),
      receiptRoot: path.resolve("D:/pulse-evidence/system-trace-display-test/receipts"),
      generatedAt: "2026-08-20T07:00:00.000Z",
    }),
    /system_trace_youtube_authority_blocked/,
  );
});
