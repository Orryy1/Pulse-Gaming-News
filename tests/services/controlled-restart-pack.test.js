"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

const {
  buildControlledRestartPack,
  writeControlledRestartPack,
} = require("../../lib/ops/controlled-restart-pack");

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-restart-pack-"));
  try {
    return await fn(dir);
  } finally {
    await fs.remove(dir);
  }
}

async function writeStory(root, id, title, overrides = {}) {
  const dir = path.join(root, "output", "goal-proof", "batch", id);
  await fs.ensureDir(dir);
  await fs.writeFile(path.join(dir, "visual_v4_render.mp4"), "mp4");
  await fs.writeFile(path.join(dir, "captions.srt"), "1\n00:00:00,000 --> 00:00:01,000\nCaption\n");
  await fs.writeJson(path.join(dir, "canonical_story_manifest.json"), {
    story_id: id,
    canonical_subject: overrides.subject || title.split(" ").slice(0, 3).join(" "),
    canonical_game: overrides.game || overrides.subject || title.split(" ").slice(0, 3).join(" "),
    selected_title: title,
    thumbnail_headline: overrides.thumbnail || title.toUpperCase(),
    first_spoken_line: overrides.firstSpokenLine || `${title} starts fast.`,
    narration_script: overrides.script ||
      `Xbox just turned a licence into a gameplay test. ${overrides.source || "Official Source"} reports ${title}. The catch is why the next cut matters: viewers need combat, camera and scale before hype turns into trust. One clean source lock is useful, but the first 3 seconds have to give people a reason to stay. Follow Pulse Gaming so you never miss a beat.`,
    description: overrides.description || `${title}. Source: ${overrides.source || "Official Source"}.`,
    primary_source: overrides.source || "Official Source",
    secondary_sources: overrides.secondary_sources || [],
    official_source: overrides.source || "Official Source",
  });
  await fs.writeJson(path.join(dir, "source_manifest.json"), {
    primary_source: { name: overrides.source || "Official Source", url: "https://example.test/story" },
    sources: [{ name: overrides.source || "Official Source", url: "https://example.test/story" }],
  });
  await fs.writeJson(path.join(dir, "render_manifest.json"), {
    renderer: "visual_v4_production",
    final_publish_render: true,
    output_path: path.join(dir, "visual_v4_render.mp4"),
    rendered_duration_s: overrides.duration || 43.2,
    clips: 8,
    render_invocation_mode: "final_production_render",
  });
  await fs.writeJson(path.join(dir, "narration_manifest.json"), {
    status: "ready",
    provider: "local_tts",
    audio_path: `output/audio/${id}.mp3`,
    word_timestamps_path: `output/audio/${id}_timestamps.json`,
    word_timestamp_source: "local_whisper_word_alignment",
    word_timestamp_count: 120,
  });
  await fs.writeJson(path.join(dir, "caption_manifest.json"), {
    status: "ready",
    caption_srt_path: path.join(dir, "captions.srt"),
    timing_source: "word_timestamps",
    blockers: [],
    checks: { caption_file_present: true, captions_well_formed: true },
  });
  await fs.writeJson(path.join(dir, "rights_ledger.json"), {
    verdict: "pass",
    assets: [{ asset_id: `${id}-asset`, approval_status: "approved_for_transformative_editorial_use" }],
  });
  await fs.writeJson(path.join(dir, "materialised_motion_clips.json"), {
    status: "ready",
    clips: Array.from({ length: overrides.clips || 8 }, (_, index) => ({
      id: `${id}-clip-${index}`,
      materialized: true,
      counts_towards_motion_readiness: true,
      motion_family: `family-${index}`,
      path: path.join(root, "output", "video_cache", `${id}-${index}.mp4`),
    })),
  });
  await fs.writeJson(path.join(dir, "visual_quality_report.json"), {
    result: "pass",
    scores: { motion_density_score: 95, first_3_seconds_hook_score: 88 },
    visual_evidence_profile: {
      direct_video_motion_asset_count: 4,
      generated_only_motion_deck: false,
    },
  });
  await fs.writeJson(path.join(dir, "coherence_report.json"), { verdict: "pass", failures: [], warnings: [] });
  await fs.writeJson(path.join(dir, "publish_verdict.json"), { verdict: "GREEN", reason_codes: [], warnings: [] });
  await fs.writeJson(path.join(dir, "platform_policy_report.json"), {
    disclosure_requirements: { ai: { required: false, decision: "not_required" } },
  });
  const disclosure = { required: false, type: "none", caption: "No commercial link attached." };
  await fs.writeJson(path.join(dir, "youtube_publish_pack.json"), {
    title,
    description: `${title}. Source: ${overrides.source || "Official Source"}.`,
    cover_frame: { headline: overrides.thumbnail || title.toUpperCase(), subject: overrides.subject || title },
    disclosure_status: disclosure,
  });
  await fs.writeJson(path.join(dir, "instagram_publish_pack.json"), {
    caption: `${title}. Source: ${overrides.source || "Official Source"}.`,
    cover_frame: { headline: overrides.thumbnail || title.toUpperCase(), subject: overrides.subject || title },
    disclosure_status: disclosure,
  });
  await fs.writeJson(path.join(dir, "facebook_publish_pack.json"), {
    page_caption: `${title}. Source: ${overrides.source || "Official Source"}.`,
    disclosure_status: disclosure,
  });
  return dir;
}

function action(storyId, platform, enabled = true) {
  return {
    story_id: storyId,
    platform,
    action: enabled ? "would_publish" : "would_queue_when_enabled",
    platform_enabled: enabled,
    requires_human_review_before_live_publish: enabled,
    live_execution_gate: enabled ? "operator_human_review_required" : "platform_enablement_required",
    blockers: [],
    warnings: [],
  };
}

test("controlled restart pack selects three clean enabled-platform candidates and defers disabled platforms", async () => {
  await withTempDir(async (root) => {
    const ids = ["story-a", "story-b", "story-c", "story-d"];
    const titleFor = (id) => `Strong ${id} Restart Title`;
    for (const id of ids) await writeStory(root, id, titleFor(id));

    const report = await buildControlledRestartPack({
      root,
      generatedAt: "2026-06-01T12:00:00.000Z",
      repoStatus: {
        branch: "codex/release",
        latest_commit: "abc1234 Restart pack",
        clean: true,
        upstream: "origin/codex/release",
        ahead: 0,
        behind: 0,
      },
      localHealth: {
        runtime: { auto_publish: false, safe_observation_mode: true },
        deployment: { primary: false, mode: "local" },
      },
      publicHealth: {
        runtime: { auto_publish: false, safe_observation_mode: true },
        deployment: { primary: false, mode: "local" },
      },
      candidateReport: {
        generated_at: "2026-06-01T11:55:00.000Z",
        candidates: ids.map((id, index) => ({
          id,
          title: titleFor(id),
          status: "publish_ready",
          score: 100 - index,
          duration_seconds: 43 + index,
          source: {
            exported_path: path.join(root, "output", "goal-proof", "batch", id, "visual_v4_render.mp4"),
          },
          preflight_qa: {
            status: "pass",
            blockers: [],
            warnings: [],
            checks: {
              timestamp_alignment: {
                result: "pass",
                evidence: { source: "local_whisper_word_alignment" },
              },
            },
          },
        })),
      },
      strictDryRunPlan: {
        overall_verdict: "AMBER",
        summary: { platform_enabled_dry_run_action_count: 12, platform_deferred_action_count: 16 },
        actions: ids.flatMap((id) => [
          action(id, "youtube_shorts", true),
          action(id, "instagram_reels", true),
          action(id, "facebook_reels", true),
          action(id, "tiktok", false),
          action(id, "x", false),
          action(id, "threads", false),
          action(id, "pinterest", false),
        ]),
      },
      platformStatusMatrix: {
        overall_verdict: "AMBER",
        platforms: [
          { platform: "youtube_shorts", state: "ready_now" },
          { platform: "instagram_reels", state: "ready_now" },
          { platform: "facebook_reels", state: "ready_now" },
          { platform: "tiktok", state: "deferred_until_platform_enabled" },
          { platform: "x", state: "deferred_until_platform_enabled" },
          { platform: "threads", state: "deferred_until_platform_enabled" },
          { platform: "pinterest", state: "deferred_until_platform_enabled" },
        ],
      },
      publishReadinessReport: {
        overall_verdict: "red",
        blockers: ["public server is not reporting primary=true"],
      },
      renderHealthReport: {
        bridge: { candidate_count: 13, quality: { premium: 13 }, thin_count: 0 },
      },
      schedulerTaskHygiene: {
        risk_task_names: ["Orryy-PulseGaming"],
        tasks: [{ task_name: "Orryy-PulseGaming", execute: "python.exe", arguments: "run_daily.py pulse_gaming" }],
      },
    });

    assert.equal(report.verdict, "AMBER");
    assert.equal(report.safe_to_publish_boolean, false);
    assert.deepEqual(report.selected_restart_candidates.map((candidate) => candidate.story_id), [
      "story-a",
      "story-b",
      "story-c",
    ]);
    assert.equal(report.guarded_dispatch_plan.live_dispatch_allowed, false);
    assert.equal(report.guarded_dispatch_plan.actions.length, 9);
    assert.equal(report.platform_deferred_actions.actions.length, 12);
    assert.ok(report.operator_approval_checklist.markdown.includes("[ ] Approve story-a"));

    const artefacts = await writeControlledRestartPack(report, {
      outputDir: path.join(root, "output", "controlled-restart"),
    });
    for (const required of [
      "controlled_restart_pack.md",
      "controlled_restart_pack.json",
      "selected_restart_candidates.json",
      "operator_approval_checklist.md",
      "guarded_dispatch_plan.json",
      "platform_deferred_actions.json",
      "live_gate_change_plan.md",
      "post_restart_verification_checklist.md",
      "scheduled_task_cleanup_plan.md",
    ]) {
      assert.equal(await fs.pathExists(artefacts[required]), true, required);
    }
  });
});

test("controlled restart pack rejects duplicate-title and timing-uncertain candidates before selection", async () => {
  await withTempDir(async (root) => {
    const ids = ["clean-a", "dupe-risk", "timing-risk", "clean-b"];
    const titleFor = (id) => `Restart ${id} Clean Title`;
    for (const id of ids) await writeStory(root, id, titleFor(id));

    const makeCandidate = (id, index) => ({
      id,
      title: titleFor(id),
      status: "publish_ready",
      score: 100 - index,
      duration_seconds: 44,
      source: {
        exported_path: path.join(root, "output", "goal-proof", "batch", id, "visual_v4_render.mp4"),
      },
      preflight_qa: {
        status: "pass",
        blockers: [],
        warnings: [],
        checks: {
          timestamp_alignment: {
            result: "pass",
            evidence: { source: "local_whisper_word_alignment" },
          },
        },
      },
    });
    const candidates = ids.map(makeCandidate);
    await fs.writeJson(
      path.join(root, "output", "goal-proof", "batch", "timing-risk", "narration_manifest.json"),
      {
        status: "ready",
        provider: "local_tts",
        audio_path: "output/audio/timing-risk.mp3",
        word_timestamps_path: "output/audio/timing-risk_timestamps.json",
        word_timestamp_source: "",
        word_timestamp_count: 0,
      },
    );

    const plan = {
      overall_verdict: "AMBER",
      actions: ids.flatMap((id) => [
        { ...action(id, "youtube_shorts", true), duplicate_title_risk: id === "dupe-risk" },
        action(id, "instagram_reels", true),
        action(id, "facebook_reels", true),
        action(id, "tiktok", false),
      ]),
    };

    const report = await buildControlledRestartPack({
      root,
      generatedAt: "2026-06-01T12:00:00.000Z",
      candidateLimit: 2,
      candidateReport: { candidates },
      strictDryRunPlan: plan,
      platformStatusMatrix: {},
    });

    assert.equal(report.verdict, "AMBER");
    assert.deepEqual(report.selected_restart_candidates.map((candidate) => candidate.story_id), [
      "clean-a",
      "clean-b",
    ]);
    const rejected = Object.fromEntries(
      report.rejected_restart_candidates.map((candidate) => [candidate.story_id, candidate.blockers]),
    );
    assert.ok(rejected["dupe-risk"].includes("duplicate_title_risk"));
    assert.ok(rejected["timing-risk"].includes("asr_or_caption_timing_not_proven"));
  });
});

test("controlled restart pack rejects internally framed narration before restart approval", async () => {
  await withTempDir(async (root) => {
    const ids = ["clean-a", "internal-copy", "clean-b"];
    for (const id of ids) {
      await writeStory(root, id, `Restart ${id} Clean Title`, {
        script: id === "internal-copy"
          ? "This is a price story. The clean angle is the discount and whether it fits the audience watching this short. Right now the news is the offer itself, not a hard sell."
          : `Xbox just turned a licence into a gameplay test. Official Source reports Restart ${id} Clean Title. The catch is why the next cut matters: viewers need combat, camera and scale before hype turns into trust. One clean source lock is useful, but the first 3 seconds have to give people a reason to stay. Follow Pulse Gaming so you never miss a beat.`,
      });
    }

    const candidates = ids.map((id, index) => ({
      id,
      title: `Restart ${id} Clean Title`,
      status: "publish_ready",
      score: 120 - index,
      duration_seconds: 43,
      source: {
        exported_path: path.join(root, "output", "goal-proof", "batch", id, "visual_v4_render.mp4"),
      },
      preflight_qa: {
        status: "pass",
        blockers: [],
        warnings: [],
        checks: {
          timestamp_alignment: {
            result: "pass",
            evidence: { source: "local_whisper_word_alignment" },
          },
        },
      },
    }));

    const report = await buildControlledRestartPack({
      root,
      generatedAt: "2026-06-01T12:00:00.000Z",
      candidateLimit: 2,
      candidateReport: { candidates },
      strictDryRunPlan: {
        actions: ids.flatMap((id) => [
          action(id, "youtube_shorts", true),
          action(id, "instagram_reels", true),
          action(id, "facebook_reels", true),
        ]),
      },
    });

    assert.deepEqual(report.selected_restart_candidates.map((candidate) => candidate.story_id), [
      "clean-a",
      "clean-b",
    ]);
    const rejected = report.rejected_restart_candidates.find((candidate) => candidate.story_id === "internal-copy");
    assert.ok(rejected.blockers.includes("internal_audience_or_editorial_scaffold_language"));
  });
});

test("controlled restart pack rejects roman-numeral titles without pronunciation evidence", async () => {
  await withTempDir(async (root) => {
    const ids = ["safe-title", "roman-title", "safe-title-two"];
    await writeStory(root, "safe-title", "Restart Safe Title Works");
    await writeStory(root, "roman-title", "Hades II Breaks Console Silence", {
      subject: "Hades II",
      script: "Hades II lands on console with a clear date and a player-facing reason to care.",
    });
    await writeStory(root, "safe-title-two", "Restart Second Safe Title");

    const candidates = ids.map((id, index) => ({
      id,
      title: id === "roman-title" ? "Hades II Breaks Console Silence" : `Restart ${id} Clean Title`,
      status: "publish_ready",
      score: 130 - index,
      duration_seconds: 43,
      source: {
        exported_path: path.join(root, "output", "goal-proof", "batch", id, "visual_v4_render.mp4"),
      },
      preflight_qa: {
        status: "pass",
        blockers: [],
        warnings: [],
        checks: {
          timestamp_alignment: {
            result: "pass",
            evidence: { source: "local_whisper_word_alignment" },
          },
        },
      },
    }));

    const report = await buildControlledRestartPack({
      root,
      generatedAt: "2026-06-01T12:00:00.000Z",
      candidateLimit: 2,
      candidateReport: { candidates },
      strictDryRunPlan: {
        actions: ids.flatMap((id) => [
          action(id, "youtube_shorts", true),
          action(id, "instagram_reels", true),
          action(id, "facebook_reels", true),
        ]),
      },
    });

    assert.deepEqual(report.selected_restart_candidates.map((candidate) => candidate.story_id), [
      "safe-title",
      "safe-title-two",
    ]);
    const rejected = report.rejected_restart_candidates.find((candidate) => candidate.story_id === "roman-title");
    assert.ok(rejected.blockers.includes("tts_pronunciation_evidence_missing_for_roman_numeral_title"));
  });
});
