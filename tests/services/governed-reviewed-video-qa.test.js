"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  REVIEWED_25_SECOND_VIDEO_FAILURE,
  reconcileGovernedReviewedVideoQa,
  resolveGovernedReviewedContentQaAuthority,
} = require("../../lib/services/governed-reviewed-content-qa");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function createFixture(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-governed-reviewed-video-qa-"),
  );
  const mediaPath = path.join(directory, "reviewed-final.mp4");
  const mediaBytes = Buffer.alloc(220 * 1024, 0x5a);
  fs.writeFileSync(mediaPath, mediaBytes);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const storyId = "official_governed_reviewed_short";
  const fullScript =
    "Final Fantasy XIV just revealed a tank that fights with two giant shields. Bastion arrives in Evercold and only works in Evolved Mode. The expansion makes its story less linear, auto-scales content and adds a Final Fantasy VII raid. The MMO hits Switch 2 on August fourth.";
  const scriptSha256 = sha256(Buffer.from(fullScript));
  const mediaSha256 = sha256(mediaBytes);
  const rendererManifestSha256 = "4".repeat(64);
  const scheduledFor = "2026-07-27T09:00:00.000Z";
  const scheduledEventId = 90;
  const dispatchIdempotencyKey =
    `youtube:${storyId}:${scheduledFor}`;
  const requestFingerprint = "a".repeat(64);
  const publicationEvidence = {
    source_evidence_sha256: "1".repeat(64),
    qa_report_sha256: "2".repeat(64),
    rights_ledger_sha256: "3".repeat(64),
    renderer_manifest_sha256: rendererManifestSha256,
    publication_metadata_sha256: "6".repeat(64),
    renderer: {
      id: "studio-v21",
      role: "standard",
      version: "2.1.0",
    },
  };
  const story = {
    id: storyId,
    channel_id: "pulse-gaming",
    approved: true,
    auto_approved: false,
    full_script: fullScript,
    exported_path: mediaPath,
    render_review_status: "approved",
    operator_review_status: "script_approved",
    script_sha256: scriptSha256,
    script_approved_sha256: scriptSha256,
    editorial_lane_id: "what_changes_for_players",
    duration_band_id: "what_changes_short_25_32",
    hook_type: "direct",
    preflight_evidence: {
      schema_version: "pulse-publication-review-evidence-v1",
      story_id: storyId,
      channel_id: "pulse-gaming",
      ...publicationEvidence,
      media_sha256: mediaSha256,
      script_sha256: scriptSha256,
      artifact_evidence: {
        final_mp4_exists: true,
        narration_audio_exists: true,
        word_timestamps_exist: true,
        motion_materialised: true,
        hashes_verified: true,
      },
      renderer_manifest: {
        schema_version: "pulse-render-manifest-v1",
        story_id: storyId,
        channel_id: "pulse-gaming",
        renderer: publicationEvidence.renderer,
        output: {
          sha256: mediaSha256,
          duration_seconds: 25,
          platform_video_qa_result: "pass",
        },
      },
    },
    final_publication_review: {
      schema_version: "pulse-final-publication-review-v1",
      story_id: storyId,
      channel_id: "pulse-gaming",
      review_manifest_sha256: "b".repeat(64),
      script_sha256: scriptSha256,
      media_sha256: mediaSha256,
      qa_report: {
        sha256: publicationEvidence.qa_report_sha256,
        verdict: "PASS",
      },
      renderer_manifest: {
        canonical_sha256: rendererManifestSha256,
        verdict: "PASS",
        publishable_under_human_review: true,
      },
      final_mp4: {
        path: mediaPath,
        sha256: mediaSha256,
      },
      reviewed_by: "user:MORR",
      reviewed_at: "2026-07-27T08:45:00.000Z",
    },
  };
  const scheduledDispatch = {
    scheduledFor,
    idempotencyKey: dispatchIdempotencyKey,
    requestFingerprint,
    publicationEvidence,
    event: { id: scheduledEventId },
  };
  const exactDispatchBinding = {
    storyId,
    platform: "youtube",
    scheduledFor,
    scheduledEventId,
    dispatchIdempotencyKey,
    requestFingerprint,
  };
  return {
    exactDispatchBinding,
    mediaSha256,
    scheduledDispatch,
    story,
  };
}

async function resolveFixtureAuthority(fixture) {
  return resolveGovernedReviewedContentQaAuthority({
    story: fixture.story,
    scheduledDispatch: fixture.scheduledDispatch,
    exactDispatchBinding: fixture.exactDispatchBinding,
    resolveMediaPath: async (value) => value,
  });
}

test("exact hash-bound authority resolves only the reviewed 25-second legacy floor failure", async (t) => {
  const fixture = createFixture(t);
  const authority = await resolveFixtureAuthority(fixture);

  assert.equal(Object.isFrozen(authority), true);
  assert.equal(Object.isFrozen(authority.videoRuntime), true);
  assert.deepEqual(authority.videoRuntime, {
    durationSeconds: 25,
    durationBandId: "what_changes_short_25_32",
    minSeconds: 25,
    maxSeconds: 32,
  });

  const result = reconcileGovernedReviewedVideoQa(
    {
      result: "fail",
      failures: [REVIEWED_25_SECOND_VIDEO_FAILURE],
      warnings: [],
    },
    authority,
  );
  assert.deepEqual(result, {
    result: "warn",
    failures: [],
    warnings: [
      `governed_review_resolved:${REVIEWED_25_SECOND_VIDEO_FAILURE}`,
    ],
    resolved: [REVIEWED_25_SECOND_VIDEO_FAILURE],
  });
});

test("a forged or cloned authority cannot resolve video QA", async (t) => {
  const fixture = createFixture(t);
  const authority = await resolveFixtureAuthority(fixture);
  for (const candidate of [
    {
      videoRuntime: {
        durationSeconds: 25,
        durationBandId: "what_changes_short_25_32",
        minSeconds: 25,
        maxSeconds: 32,
      },
    },
    { ...authority },
  ]) {
    const result = reconcileGovernedReviewedVideoQa(
      {
        result: "fail",
        failures: [REVIEWED_25_SECOND_VIDEO_FAILURE],
        warnings: [],
      },
      candidate,
    );
    assert.equal(result.result, "fail");
    assert.deepEqual(result.failures, [REVIEWED_25_SECOND_VIDEO_FAILURE]);
    assert.deepEqual(result.resolved, []);
  }
});

test("story, hash and reviewed-duration mismatches cannot mint authority", async (t) => {
  const scenarios = [
    {
      expected: "governed_review_renderer_story_mismatch",
      mutate(story) {
        story.preflight_evidence.renderer_manifest.story_id =
          "another_story";
      },
    },
    {
      expected: "governed_review_current_media_hash_mismatch",
      mutate(story) {
        story.preflight_evidence.media_sha256 = "f".repeat(64);
      },
    },
    {
      expected: "governed_review_renderer_duration_outside_contract",
      mutate(story) {
        story.preflight_evidence.renderer_manifest.output.duration_seconds =
          24;
      },
    },
  ];
  for (const scenario of scenarios) {
    const fixture = createFixture(t);
    scenario.mutate(fixture.story);
    await assert.rejects(
      resolveFixtureAuthority(fixture),
      (error) =>
        Array.isArray(error.codes) &&
        error.codes.includes(scenario.expected),
      scenario.expected,
    );
  }
});

test("different duration and every unrelated video failure remain hard failures", async (t) => {
  const fixture = createFixture(t);
  const authority = await resolveFixtureAuthority(fixture);

  const differentDuration = reconcileGovernedReviewedVideoQa(
    {
      result: "fail",
      failures: ["duration_too_short (24.99s)"],
      warnings: [],
    },
    authority,
  );
  assert.equal(differentDuration.result, "fail");
  assert.deepEqual(differentDuration.failures, [
    "duration_too_short (24.99s)",
  ]);

  const multipleFailures = reconcileGovernedReviewedVideoQa(
    {
      result: "fail",
      failures: [
        REVIEWED_25_SECOND_VIDEO_FAILURE,
        "black_segment_too_long (4.20s @ 0.00s)",
      ],
      warnings: ["opening_black (0.80s)"],
    },
    authority,
  );
  assert.equal(multipleFailures.result, "fail");
  assert.deepEqual(multipleFailures.failures, [
    "black_segment_too_long (4.20s @ 0.00s)",
  ]);
  assert.deepEqual(multipleFailures.warnings, [
    "opening_black (0.80s)",
    `governed_review_resolved:${REVIEWED_25_SECOND_VIDEO_FAILURE}`,
  ]);
});

test("malformed failures fail closed and skip semantics are preserved", async (t) => {
  const fixture = createFixture(t);
  const authority = await resolveFixtureAuthority(fixture);

  for (const failures of [undefined, null, [], "duration_unknown"]) {
    const result = reconcileGovernedReviewedVideoQa(
      { result: "fail", failures, warnings: [] },
      authority,
    );
    assert.equal(result.result, "fail");
    assert.deepEqual(result.failures, ["video_qa_unclassified_failure"]);
    assert.deepEqual(result.resolved, []);
  }

  const skipped = reconcileGovernedReviewedVideoQa(
    {
      result: "skip",
      reason: "ffmpeg_missing",
    },
    authority,
  );
  assert.equal(skipped.result, "skip");
  assert.equal(skipped.reason, "ffmpeg_missing");
  assert.deepEqual(skipped.resolved, []);
});
