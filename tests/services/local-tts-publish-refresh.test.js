"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

const {
  applyLocalTtsPublishRefresh,
  buildLocalTtsPublishRefreshPlan,
  clearStoryForLocalRerender,
  inspectTimestampPayload,
  realPlatformIds,
  renderLocalTtsPublishRefreshMarkdown,
  timestampRepairFromPayload,
} = require("../../lib/ops/local-tts-publish-refresh");
const {
  backupLocalTtsPublishRefreshDb,
  buildLocalTtsPublishRefreshDbBackupPath,
} = require("../../tools/local-tts-publish-refresh");

function alignmentFor(text, duration) {
  const chars = [...text];
  const spoken = chars.filter((ch) => !/\s/.test(ch)).length || 1;
  const perChar = duration / spoken;
  let cursor = 0;
  const starts = [];
  const ends = [];
  for (const ch of chars) {
    const start = cursor;
    if (!/\s/.test(ch)) cursor = Math.min(duration, cursor + perChar);
    starts.push(Number(start.toFixed(3)));
    ends.push(Number(cursor.toFixed(3)));
  }
  return {
    characters: chars,
    character_start_times_seconds: starts,
    character_end_times_seconds: ends,
  };
}

function approvedLocalTimestampPayload(text, duration = 65.6) {
  return {
    ...alignmentFor(text, duration),
    meta: {
      provider: "local",
      source: "provided-local-tts-audio",
      transcript: text,
      approvedLocalVoice: true,
      acceptedLocalVoice: {
        id: "pulse-sleepy-liam-20260502",
        fileName: "pulse_liam_sleepy.wav",
        referencePresent: true,
        referenceHash: "a".repeat(40),
      },
      acoustic: {
        medianPitchHz: 118,
        integratedLufs: -16,
        truePeakDb: -2.1,
      },
      voiceMastering: {
        ok: true,
        code: "voice_mastered",
        targetLufs: -16,
      },
    },
  };
}

test("local TTS publish refresh plan requires selected approved stories and preserves platform IDs", () => {
  const stories = [
    {
      id: "story_ok",
      title: "A clean story",
      approved: true,
      audio_path: "output/audio/story_ok.mp3",
      image_path: "output/images/story_ok.png",
      exported_path: "output/final/story_ok.mp4",
    },
    {
      id: "story_live",
      title: "Already public",
      approved: true,
      youtube_post_id: "yt123",
      audio_path: "output/audio/story_live.mp3",
      image_path: "output/images/story_live.png",
      exported_path: "output/final/story_live.mp4",
    },
  ];

  const plan = buildLocalTtsPublishRefreshPlan({
    stories,
    storyIds: ["story_ok", "story_live", "missing_story"],
  });

  assert.equal(plan.counts.refreshable, 1);
  assert.equal(plan.counts.blocked, 2);
  assert.equal(plan.items.find((item) => item.story_id === "story_ok").action, "refresh_audio_and_rerender");
  assert.deepEqual(
    plan.items.find((item) => item.story_id === "story_live").blockers,
    ["already_has_platform_ids"],
  );
  assert.deepEqual(
    plan.items.find((item) => item.story_id === "missing_story").blockers,
    ["story_not_found"],
  );
  assert.equal(plan.safety.clears_platform_ids, false);
});

test("local TTS publish refresh consumes approved proof audio without regenerating TTS", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-proof-refresh-"));
  const previousMediaRoot = process.env.MEDIA_ROOT;
  process.env.MEDIA_ROOT = root;
  t.after(async () => {
    if (previousMediaRoot === undefined) delete process.env.MEDIA_ROOT;
    else process.env.MEDIA_ROOT = previousMediaRoot;
    await fs.remove(root);
  });

  const story = {
    id: "story_proof",
    title: "Valorant Vanguard Trust Problem",
    approved: true,
    image_path: "output/images/story_proof.png",
    audio_path: "output/audio/story_proof.mp3",
    exported_path: "output/final/story_proof.mp4",
    youtube_post_id: "DUPE_existing",
    qa_failed: true,
    tts_script:
      "Valorant's anti-cheat fight just got nastier. Follow Pulse Gaming so you never miss a beat.",
  };
  const proofAudio = "test/output/local-script-extension/audio/story_proof_liam_extended.mp3";
  const proofTimestamps = proofAudio.replace(/\.mp3$/, "_timestamps.json");
  const proofText =
    "Valorant's anti-cheat fight just got nastier. Follow Pulse Gaming so you never miss a beat.";
  await fs.outputFile(path.join(root, proofAudio), "approved proof audio");
  await fs.outputJson(
    path.join(root, proofTimestamps),
    approvedLocalTimestampPayload(proofText),
    { spaces: 2 },
  );

  const proofReports = [
    {
      source: "local_script_extension",
      report: {
        applied: [
          {
            story_id: "story_proof",
            output_audio_path: proofAudio,
            duration_seconds: 65.6,
            duration_verdict: "pass",
            failure_code: null,
            local_voice_metadata: "stamped",
            local_voice_reference: {
              id: "pulse-sleepy-liam-20260502",
              referencePresent: true,
            },
          },
        ],
      },
    },
  ];
  const plan = buildLocalTtsPublishRefreshPlan({
    stories: [story],
    storyIds: ["story_proof"],
    localTtsProofReports: proofReports,
    dryRun: false,
  });

  assert.equal(plan.counts.refreshable, 1);
  assert.equal(plan.items[0].proof_audio_path, proofAudio);
  assert.ok(plan.items[0].needs.includes("copy_approved_local_liam_proof_audio"));
  assert.ok(!plan.items[0].needs.includes("regenerate_local_liam_audio"));

  let generateCalled = false;
  let persisted = null;
  const report = await applyLocalTtsPublishRefresh({
    plan,
    storiesById: { story_proof: story },
    generateTtsForStory: async () => {
      generateCalled = true;
      throw new Error("should not regenerate when an approved proof exists");
    },
    getAudioDuration: async () => 65.6,
    persistStory: async (nextStory) => {
      persisted = nextStory;
    },
    backupRoot: path.join(root, "backups"),
  });

  assert.equal(generateCalled, false);
  assert.equal(report.counts.applied, 1);
  assert.equal(report.applied[0].proof_source, "local_script_extension");
  assert.equal(await fs.readFile(path.join(root, "output/audio/story_proof.mp3"), "utf8"), "approved proof audio");
  assert.equal(await fs.pathExists(path.join(root, "output/audio/story_proof_timestamps.json")), true);
  assert.equal(persisted.audio_path, "output/audio/story_proof.mp3");
  assert.equal(persisted.exported_path, null);
  assert.equal(persisted.qa_failed, false);
  assert.equal(persisted.youtube_post_id, "DUPE_existing");
});

test("local TTS publish refresh DB backup is repair-specific before apply", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-proof-refresh-db-"));
  t.after(() => fs.remove(root));

  const dbPath = path.join(root, "pulse.db");
  const expected = buildLocalTtsPublishRefreshDbBackupPath(
    dbPath,
    "2026-05-31T01:00:00.000Z",
  );
  assert.match(expected, /backups[/\\]pulse-pre-local-tts-publish-refresh-2026-05-31T01-00-00-000Z\.db$/);

  let calledBackupPath = null;
  const backup = await backupLocalTtsPublishRefreshDb({
    db: {
      DB_PATH: dbPath,
      getDb: () => ({
        backup: async (backupPath) => {
          calledBackupPath = backupPath;
          await fs.outputFile(backupPath, "sqlite backup");
        },
      }),
    },
    generatedAt: "2026-05-31T01:00:00.000Z",
  });

  assert.equal(backup, expected);
  assert.equal(calledBackupPath, expected);
  assert.equal(await fs.readFile(expected, "utf8"), "sqlite backup");
});

test("local TTS publish refresh can be explicitly allowed for published local media repair", () => {
  const plan = buildLocalTtsPublishRefreshPlan({
    allowPublishedRepair: true,
    stories: [
      {
        id: "story_live",
        approved: true,
        youtube_post_id: "yt123",
        audio_path: "output/audio/story_live.mp3",
        image_path: "output/images/story_live.png",
      },
    ],
    storyIds: ["story_live"],
  });

  assert.equal(plan.counts.refreshable, 1);
  assert.equal(plan.items[0].action, "refresh_audio_and_rerender");
});

test("local TTS publish refresh clears only render state, not platform IDs", () => {
  const story = {
    id: "story_ok",
    approved: true,
    audio_path: "output/audio/story_ok.mp3",
    exported_path: "output/final/story_ok.mp4",
    teaser_path: "output/final/story_ok_teaser.mp4",
    youtube_post_id: "yt123",
    qa_failed: true,
    publish_status: "failed",
    publish_error: "qa_blocked: approved_voice:caption_timing_repaired:max_gap_too_large",
  };

  const next = clearStoryForLocalRerender(story, {
    audioPath: story.audio_path,
    audioDuration: 64.32,
    reason: "local_tts_caption_timing_refresh",
  });

  assert.equal(next.youtube_post_id, "yt123");
  assert.equal(next.exported_path, null);
  assert.equal(next.teaser_path, null);
  assert.equal(next.qa_failed, false);
  assert.equal(next.publish_status, null);
  assert.equal(next.audio_duration, 64.32);
  assert.equal(next.local_tts_publish_refresh.reason, "local_tts_caption_timing_refresh");
});

test("timestamp payload inspection distinguishes repaired stale timing from clean alignment", () => {
  const repaired = {
    ...alignmentFor("Clean enough words", 5),
    meta: {
      timestampRepair: {
        repaired: true,
        reason: "max_gap_too_large",
      },
    },
  };
  assert.deepEqual(timestampRepairFromPayload(repaired), {
    repaired: true,
    reason: "max_gap_too_large",
    strategy: null,
    inspection: null,
    originalInspection: null,
  });

  const clean = inspectTimestampPayload(alignmentFor("Clean enough words", 5), 5);
  assert.equal(clean.inspection.usable, true);
  assert.equal(clean.repair, null);
});

test("platform id detection ignores duplicate sentinels", () => {
  const ids = realPlatformIds({
    youtube_post_id: "DUPE_abc",
    instagram_media_id: "1784",
    tiktok_post_id: "",
  });
  assert.deepEqual(ids, [{ key: "instagram_media_id", value: "1784" }]);
});

test("local TTS publish refresh markdown is operator-readable", () => {
  const report = buildLocalTtsPublishRefreshPlan({
    stories: [
      {
        id: "story_ok",
        approved: true,
        audio_path: "output/audio/story_ok.mp3",
        image_path: "output/images/story_ok.png",
      },
    ],
    storyIds: ["story_ok"],
  });
  const md = renderLocalTtsPublishRefreshMarkdown(report);
  assert.match(md, /Local TTS Publish Refresh/);
  assert.match(md, /story_ok/);
  assert.match(md, /No OAuth, tokens, Railway env vars or social posts/);
});
