"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("fs-extra");

const {
  buildFreshTikTokDispatchPack,
  renderFreshTikTokDispatchMarkdown,
} = require("../../lib/platforms/tiktok-fresh-dispatch-pack");
const {
  buildTikTokDispatchManifest,
} = require("../../lib/platforms/tiktok-dispatch");
const {
  buildVoiceNarration,
} = require("../../tools/tiktok-fresh-dispatch-pack");

function approvedLiamNarration(overrides = {}) {
  return {
    provider: "local",
    source: "local-production-voxcpm",
    audioPath: "D:/pulse-data/media/test/output/local-script-extension/audio/fresh_liam_extended.mp3",
    approvedLocalVoice: true,
    acceptedLocalVoice: {
      id: "pulse-sleepy-liam-20260502",
      fileName: "pulse_liam_sleepy.wav",
      referencePresent: true,
      referenceHash: "4bb87b65b64213fd8447ef1146eda42035b89f51",
    },
    acoustic: {
      medianPitchHz: 132,
      integratedLufs: -14.2,
    },
    voiceMastering: {
      ok: true,
      code: "voice_mastered",
      targetLufs: -14,
    },
    transcript:
      "This is a current Pulse Gaming dispatch proof. Follow Pulse Gaming so you never miss a beat.",
    ...overrides,
  };
}

test("fresh TikTok dispatch pack is ready only for local dry-run inbox review", () => {
  const result = buildFreshTikTokDispatchPack({
    story: {
      id: "fresh-story",
      title: "Confirmed Xbox update just landed",
      flair: "Verified",
      breaking_score: 82,
    },
    mp4Path: "D:/pulse-data/media/test/output/fresh-story.mp4",
    coverPath: "D:/pulse-data/media/test/output/fresh-story-cover.jpg",
    durationSeconds: 66.4,
    voiceNarration: approvedLiamNarration(),
    mediaInfo: {
      exists: true,
      absolute_path: "D:/pulse-data/media/test/output/fresh-story.mp4",
      is_current_render: true,
      age_hours: 0.25,
      mtime_iso: "2026-05-06T20:00:00.000Z",
    },
    tiktokTokenStatus: {
      ok: true,
      reason: "ok",
      refresh_available: true,
      needs_reauth: false,
      expires_in_seconds: 36000,
    },
    now: new Date("2026-05-06T20:10:00.000Z"),
    requireExistingAudio: false,
  });

  assert.equal(result.dispatchPack.status, "ready_for_operator_review");
  assert.equal(result.dispatchPack.eligibility.creatorRewardsLengthEligible, true);
  assert.equal(result.dispatchPack.voiceGate.verdict, "pass");
  assert.equal(result.inboxPlan.status, "dry_run_ready");
  assert.equal(result.inboxPlan.will_upload_to_tiktok, false);
  assert.equal(result.inboxPlan.public_auto_publish, false);
  assert.equal(result.dispatchPack.schedulerReadyJson.auto_publish, false);
  assert.equal(result.safety.live_upload_executed, false);
  assert.equal(result.safety.oauth_triggered, false);
  assert.equal(result.safety.token_mutated, false);
});

test("fresh TikTok dispatch pack blocks stale or unverified MP4s", () => {
  const result = buildFreshTikTokDispatchPack({
    story: { id: "stale-story", title: "Ancient render should not go to TikTok" },
    mp4Path: "D:/pulse-data/media/output/final/ancient.mp4",
    coverPath: "D:/pulse-data/media/output/thumbnails/ancient.jpg",
    durationSeconds: 70,
    voiceNarration: approvedLiamNarration(),
    mediaInfo: {
      exists: true,
      is_current_render: false,
      reason: "stale_mp4_age_exceeds_limit",
      age_hours: 240,
      mtime_iso: "2026-04-26T20:00:00.000Z",
    },
    tiktokTokenStatus: { ok: true, reason: "ok" },
    requireExistingAudio: false,
  });

  assert.equal(result.dispatchPack.status, "stale_render_review_required");
  assert.equal(result.dispatchPack.officialInboxJson.ready_for_upload, false);
  assert.equal(result.inboxPlan.status, "not_ready");
  assert.ok(result.inboxPlan.blockers.includes("stale_mp4_age_exceeds_limit"));
});

test("fresh TikTok dispatch pack refuses missing approved local Liam evidence", () => {
  const result = buildFreshTikTokDispatchPack({
    story: { id: "no-voice", title: "Missing voice proof" },
    mp4Path: "D:/pulse-data/media/test/output/no-voice.mp4",
    coverPath: "D:/pulse-data/media/test/output/no-voice-cover.jpg",
    durationSeconds: 64,
    mediaInfo: {
      exists: true,
      is_current_render: true,
      age_hours: 0.1,
      mtime_iso: "2026-05-06T20:00:00.000Z",
    },
    tiktokTokenStatus: { ok: true, reason: "ok" },
  });

  assert.equal(result.dispatchPack.status, "voice_review_required");
  assert.ok(result.dispatchPack.voiceGate.blockers.includes("approved_voice_evidence_missing"));
  assert.equal(result.dispatchPack.officialInboxJson.ready_for_upload, false);
});

test("fresh TikTok CLI voice narration falls back to local timestamp sidecar evidence", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fresh-tiktok-voice-"));
  const finalDir = path.join(dir, "output", "final");
  const audioDir = path.join(dir, "output", "audio");
  await fs.ensureDir(finalDir);
  await fs.ensureDir(audioDir);
  const mp4 = path.join(finalDir, "rss_fresh_voice.mp4");
  const audio = path.join(audioDir, "rss_fresh_voice.mp3");
  await fs.writeFile(mp4, "fake mp4");
  await fs.writeFile(audio, "fake audio");
  await fs.writeJson(path.join(audioDir, "rss_fresh_voice_timestamps.json"), {
    characters: ["F", "o", "l", "l", "o", "w"],
    meta: {
      provider: "local",
      source: "local-production-voxcpm",
      transcript:
        "This is a clean local TikTok proof. Follow Pulse Gaming so you never miss a beat.",
      approvedLocalVoice: true,
      acceptedLocalVoice: {
        id: "pulse-sleepy-liam-20260502",
        fileName: "pulse_liam_sleepy.wav",
        referencePresent: true,
        referenceHash: "4bb87b65b64213fd8447ef1146eda42035b89f51",
      },
      acoustic: {
        medianPitchHz: 124,
        integratedLufs: -16.2,
        truePeakDb: -2.1,
      },
      voiceMastering: {
        ok: true,
        code: "voice_mastered",
        targetLufs: -16,
      },
      wpm: 162,
    },
  });

  const narration = await buildVoiceNarration({}, {
    mp4Path: mp4,
    storyId: "rss_fresh_voice",
  });

  assert.equal(narration.provider, "local");
  assert.equal(narration.source, "local-production-voxcpm");
  assert.equal(path.normalize(narration.audioPath), path.normalize(audio));
  assert.equal(narration.approvedLocalVoice, true);
  assert.equal(narration.acoustic.truePeakDb, -2.1);
  assert.match(narration.transcript, /Follow Pulse Gaming/);
});

test("fresh TikTok dispatch pack honours explicit voice do-not-reuse audits", () => {
  const result = buildFreshTikTokDispatchPack({
    story: { id: "voice-risk", title: "Voice risk should not reach TikTok inbox" },
    mp4Path: "D:/pulse-data/media/test/output/voice-risk.mp4",
    coverPath: "D:/pulse-data/media/test/output/voice-risk-cover.jpg",
    durationSeconds: 64,
    voiceAudit: {
      verdict: "review",
      blockers: [],
      warnings: ["caption_timing_repaired:max_gap_too_large"],
      do_not_reuse_for_tiktok_dispatch: true,
    },
    mediaInfo: {
      exists: true,
      is_current_render: true,
      age_hours: 0.1,
      mtime_iso: "2026-05-06T20:00:00.000Z",
    },
    tiktokTokenStatus: { ok: true, reason: "ok" },
  });

  assert.equal(result.dispatchPack.status, "voice_review_required");
  assert.equal(result.dispatchPack.voiceGate.do_not_reuse_for_tiktok_dispatch, true);
  assert.equal(result.dispatchPack.officialInboxJson.ready_for_upload, false);
  assert.equal(result.inboxPlan.status, "not_ready");
});

test("fresh TikTok dispatch pack blocks Studio V2 proofs with promotion blockers", () => {
  const result = buildFreshTikTokDispatchPack({
    story: { id: "blocked-v2", title: "Blocked Studio V2 proof should not reach TikTok" },
    mp4Path: "D:/pulse-data/media/test/output/blocked-v2.mp4",
    coverPath: "D:/pulse-data/media/test/output/blocked-v2-cover.jpg",
    durationSeconds: 66.4,
    voiceNarration: approvedLiamNarration(),
    mediaInfo: { exists: true, is_current_render: true, age_hours: 0.25 },
    tiktokTokenStatus: { ok: true, reason: "ok" },
    studioV2PromotionPacket: {
      verdict: "RED_BLOCKED",
      blockers: [
        "forensic_warnings_remaining",
        "visual_repeat_pairs_remaining",
        "weak_rendered_frames_remaining",
      ],
      morning_approval_needed: false,
    },
    requireExistingAudio: false,
  });

  assert.equal(result.dispatchPack.status, "creative_review_required");
  assert.equal(result.dispatchPack.officialInboxJson.ready_for_upload, false);
  assert.equal(result.inboxPlan.status, "not_ready");
  assert.ok(result.inboxPlan.blockers.includes("studio_v2_promotion_red_blocked"));
  assert.ok(result.creativeReview.blockers.includes("weak_rendered_frames_remaining"));
});

test("fresh TikTok dispatch markdown states manual-only safety", () => {
  const result = buildFreshTikTokDispatchPack({
    story: { id: "fresh-story", title: "Confirmed Xbox update just landed" },
    mp4Path: "D:/pulse-data/media/test/output/fresh-story.mp4",
    coverPath: "D:/pulse-data/media/test/output/fresh-story-cover.jpg",
    durationSeconds: 66.4,
    voiceNarration: approvedLiamNarration(),
    mediaInfo: { exists: true, is_current_render: true, age_hours: 0.25 },
    tiktokTokenStatus: { ok: true, reason: "ok" },
    requireExistingAudio: false,
  });

  const markdown = renderFreshTikTokDispatchMarkdown(result);
  assert.match(markdown, /Fresh TikTok Dispatch Pack/);
  assert.match(markdown, /Status: ready_for_operator_review/);
  assert.match(markdown, /Will upload to TikTok: false/);
  assert.match(markdown, /Operator visual review required/);
  assert.match(markdown, /No public post is created/);
});

test("TikTok dispatch manifest surfaces fresh produced MP4s before stale missing-video stories", () => {
  const manifest = buildTikTokDispatchManifest(
    [
      {
        id: "stale-missing-video",
        title: "Old Reddit story with no render",
        approved: true,
        flair: "Verified",
        breaking_score: 95,
        score: 2400,
        exported_path: "D:/pulse-data/media/output/final/stale-missing-video.mp4",
        image_path: "D:/pulse-data/media/output/images/stale-missing-video.png",
      },
      {
        id: "rss_6d8aaac7eccad2ff",
        title: "Fresh produced RSS story",
        approved: true,
        flair: "News",
        breaking_score: 62,
        score: 50,
        exported_path: "D:/pulse-data/media/output/final/rss_6d8aaac7eccad2ff.mp4",
        image_path: "D:/pulse-data/media/output/images/rss_6d8aaac7eccad2ff.png",
      },
    ],
    {
      durationByStoryId: {
        "stale-missing-video": null,
        rss_6d8aaac7eccad2ff: 66.2,
      },
      assetExistenceByStoryId: {
        "stale-missing-video": { mp4Exists: false, coverExists: true },
        rss_6d8aaac7eccad2ff: { mp4Exists: true, coverExists: true },
      },
      renderFreshnessByStoryId: {
        "stale-missing-video": {
          stale: true,
          ageHours: 240,
          lastModifiedIso: "2026-05-01T00:00:00.000Z",
        },
        rss_6d8aaac7eccad2ff: {
          stale: false,
          ageHours: 0.5,
          lastModifiedIso: "2026-05-14T22:00:00.000Z",
        },
      },
      tiktokTokenStatus: {
        ok: false,
        reason: "expired",
        refresh_available: true,
        needs_reauth: false,
      },
      now: new Date("2026-05-14T22:30:00.000Z"),
    },
  );

  assert.equal(manifest.topPack.storyId, "rss_6d8aaac7eccad2ff");
  assert.equal(manifest.topPack.status, "tiktok_auth_action_required");
  assert.equal(manifest.topPack.eligibility.dispatchLengthReady, true);
  assert.equal(manifest.packs[1].storyId, "stale-missing-video");
  assert.equal(manifest.packs[1].status, "missing_video");
  assert.equal(manifest.topReadyPack, null);
});

test("TikTok dispatch manifest honours explicit story filter", () => {
  const manifest = buildTikTokDispatchManifest(
    [
      {
        id: "rss_6d8aaac7eccad2ff",
        title: "Fresh produced RSS story",
        approved: true,
        exported_path: "D:/pulse-data/media/output/final/rss_6d8aaac7eccad2ff.mp4",
        image_path: "D:/pulse-data/media/output/images/rss_6d8aaac7eccad2ff.png",
      },
      {
        id: "rss_a23224b1ea49574e",
        title: "Second fresh produced RSS story",
        approved: true,
        exported_path: "D:/pulse-data/media/output/final/rss_a23224b1ea49574e.mp4",
        image_path: "D:/pulse-data/media/output/images/rss_a23224b1ea49574e.png",
      },
    ],
    {
      storyId: "rss_a23224b1ea49574e",
      durationByStoryId: {
        rss_6d8aaac7eccad2ff: 66,
        rss_a23224b1ea49574e: 68,
      },
      assetExistenceByStoryId: {
        rss_6d8aaac7eccad2ff: { mp4Exists: true, coverExists: true },
        rss_a23224b1ea49574e: { mp4Exists: true, coverExists: true },
      },
      tiktokTokenStatus: { ok: true, reason: "ok" },
      now: new Date("2026-05-14T22:30:00.000Z"),
    },
  );

  assert.deepEqual(manifest.storyFilter, ["rss_a23224b1ea49574e"]);
  assert.equal(manifest.count, 1);
  assert.equal(manifest.topPack.storyId, "rss_a23224b1ea49574e");
  assert.equal(manifest.topReadyPack.storyId, "rss_a23224b1ea49574e");
});
