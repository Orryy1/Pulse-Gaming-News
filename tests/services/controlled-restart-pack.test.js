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
      `Xbox just turned ${title} into a gameplay trust test. ${overrides.source || "Official Source"} reports direct footage with combat, camera movement and scale visible in the same cut. That matters because licence hype can win a headline, but only visible play proves the game is worth watching. The risk is practical: if the next cut hides mission flow, players still cannot judge the pitch. If the footage lands, this becomes a real release signal instead of a logo reveal. Follow Pulse Gaming so you never miss a beat.`,
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

function guardedDispatchAction(storyId, platform) {
  return {
    story_id: storyId,
    platform,
    action: "would_publish",
    platform_enabled: true,
    requires_human_review_before_live_publish: false,
    live_execution_gate: "guarded_dispatch_ready",
    autonomous_green_lit_by_dry_run: true,
    requires_guarded_dispatch_command: true,
    requires_enabled_platform_recheck: true,
    blockers: [],
    warnings: [],
  };
}

test("controlled restart pack accepts autonomous guarded-dispatch-ready enabled actions", async () => {
  await withTempDir(async (root) => {
    const id = "guarded-ready-story";
    await writeStory(root, id, "Ghost At Dawn Turns Choices Into Horror", {
      subject: "Ghost At Dawn",
      source: "Xbox Wire",
      thumbnail: "GHOST CHOICES RISK",
      script:
        "Ghost at Dawn is trying to make player choices scarier than jump scares. Xbox Wire says the game is about fear, empathy and questionable choices, which is a sharper pitch than another trailer full of loud corridor scares. The useful proof is in the campaign: whether those choices change how players read the haunting, or just decorate normal horror scenes. That is where this gets interesting, because a monster can make you jump once, but a bad decision can follow you through the whole game. If that lands, it sticks. If player decisions barely matter, the atmosphere has to carry everything by itself. Follow Pulse Gaming so you never miss a beat.",
    });

    const report = await buildControlledRestartPack({
      root,
      generatedAt: "2026-06-22T05:10:00.000Z",
      candidateLimit: 1,
      candidateReport: {
        candidates: [
          {
            id,
            title: "Ghost At Dawn Turns Choices Into Horror",
            status: "publish_ready",
            score: 86,
            duration_seconds: 51,
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
          },
        ],
      },
      strictDryRunPlan: {
        overall_verdict: "AMBER",
        actions: [
          guardedDispatchAction(id, "youtube_shorts"),
          guardedDispatchAction(id, "instagram_reels"),
          guardedDispatchAction(id, "facebook_reels"),
          action(id, "tiktok", false),
          action(id, "x", false),
          action(id, "threads", false),
          action(id, "pinterest", false),
        ],
      },
    });

    assert.deepEqual(report.selected_restart_candidates.map((candidate) => candidate.story_id), [id]);
    assert.equal(report.rejected_restart_candidates.length, 0);
    assert.equal(report.operator_can_manually_approve_now, true);
  });
});

test("controlled restart pack rejects HyperFrames candidates without passing premium-shell proof", async () => {
  await withTempDir(async (root) => {
    const id = "hyperframes-shell-missing";
    await writeStory(root, id, "HyperFrames Story Needs Shell Proof", {
      subject: "HyperFrames Story",
      source: "Xbox Wire",
      thumbnail: "SHELL PROOF NEEDED",
    });
    const artifactDir = path.join(root, "output", "goal-proof", "batch", id);
    await fs.writeJson(path.join(artifactDir, "render_manifest.json"), {
      renderer: "visual_v4_production",
      rendererSplit: "ffmpeg-backbone-story-specific-hyperframes-cards",
      final_publish_render: true,
      output_path: path.join(artifactDir, "visual_v4_render.mp4"),
      rendered_duration_s: 44,
      hyperframesCardCount: 4,
      hyperframesPremiumShellGate: {
        verdict: "fail",
        passCount: 3,
        requiredPassCount: 4,
        blockers: ["source:hyperframes_inspect_skipped"],
      },
      render_invocation_mode: "final_production_render",
    });

    const report = await buildControlledRestartPack({
      root,
      generatedAt: "2026-06-22T05:20:00.000Z",
      candidateLimit: 1,
      candidateReport: {
        candidates: [
          {
            id,
            title: "HyperFrames Story Needs Shell Proof",
            status: "publish_ready",
            score: 100,
            duration_seconds: 44,
            source: {
              exported_path: path.join(artifactDir, "visual_v4_render.mp4"),
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
          },
        ],
      },
      strictDryRunPlan: {
        overall_verdict: "AMBER",
        actions: [
          guardedDispatchAction(id, "youtube_shorts"),
          guardedDispatchAction(id, "instagram_reels"),
          guardedDispatchAction(id, "facebook_reels"),
          action(id, "tiktok", false),
        ],
      },
      platformStatusMatrix: {},
    });

    assert.deepEqual(report.selected_restart_candidates.map((candidate) => candidate.story_id), []);
    const rejected = report.rejected_restart_candidates.find((candidate) => candidate.story_id === id);
    assert.ok(rejected, "candidate should be rejected");
    assert.ok(rejected.blockers.includes("hyperframes_premium_shell_not_passed"));
  });
});

test("controlled restart pack selects three clean enabled-platform candidates and defers disabled platforms", async () => {
  await withTempDir(async (root) => {
    const ids = ["story-a", "story-b", "story-c", "story-d"];
    const titles = {
      "story-a": "Clockwork Revolution Shows Time-Bending Combat",
      "story-b": "Fable Shows Combat And Town Choices",
      "story-c": "State Of Decay 3 Shows Co-op Base Survival",
      "story-d": "Ninja Gaiden 4 Shows Boss Combat",
    };
    const titleFor = (id) => titles[id];
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

test("controlled restart pack accepts rights records and caption word-count timing evidence", async () => {
  await withTempDir(async (root) => {
    const id = "records-and-caption-ready";
    await writeStory(root, id, "Restart Records Caption Ready");
    const dir = path.join(root, "output", "goal-proof", "batch", id);
    await fs.writeJson(path.join(dir, "rights_ledger.json"), {
      verdict: "pass",
      failures: [],
      warnings: [],
      records: [
        { asset_id: "record-1", approval_status: "approved_for_transformative_editorial_use" },
        { asset_id: "record-2", approval_status: "approved_for_transformative_editorial_use" },
      ],
    });
    await fs.writeJson(path.join(dir, "narration_manifest.json"), {
      status: "ready",
      provider: "elevenlabs",
      word_timestamp_source: "elevenlabs_alignment_normalised",
      word_timestamp_count: 0,
    });
    await fs.writeJson(path.join(dir, "caption_manifest.json"), {
      status: "ready",
      timing_source: "word_timestamps",
      word_timestamp_count: 118,
      blockers: [],
    });

    const report = await buildControlledRestartPack({
      root,
      generatedAt: "2026-06-01T12:00:00.000Z",
      candidateLimit: 1,
      candidateReport: {
        candidates: [
          {
            id,
            title: "Restart Records Caption Ready",
            status: "publish_ready",
            score: 100,
            duration_seconds: 44,
            source: {
              exported_path: path.join(dir, "visual_v4_render.mp4"),
            },
            preflight_qa: {
              status: "pass",
              blockers: [],
              warnings: [],
              checks: {
                timestamp_alignment: {
                  result: "pass",
                  evidence: { source: "elevenlabs_alignment_normalised" },
                },
              },
            },
          },
        ],
      },
      strictDryRunPlan: {
        overall_verdict: "AMBER",
        actions: [
          action(id, "youtube_shorts", true),
          action(id, "instagram_reels", true),
          action(id, "facebook_reels", true),
          action(id, "tiktok", false),
        ],
      },
      platformStatusMatrix: {},
    });

    assert.equal(report.verdict, "AMBER");
    assert.deepEqual(report.selected_restart_candidates.map((candidate) => candidate.story_id), [id]);
    assert.equal(report.rejected_restart_candidates.length, 0);
  });
});

test("controlled restart pack resolves artefacts from candidate exported path when package map is absent", async () => {
  await withTempDir(async (root) => {
    const id = "overnight-ready-candidate";
    const defaultDir = await writeStory(root, id, "Overnight Ready Candidate Works");
    const customDir = path.join(root, "output", "overnight-fresh-green-buffer", "goal-proof-batch", id);
    await fs.ensureDir(path.dirname(customDir));
    await fs.move(defaultDir, customDir);
    await fs.writeJson(path.join(customDir, "render_manifest.json"), {
      renderer: "visual_v4_production",
      final_publish_render: true,
      output_path: path.join(customDir, "visual_v4_render.mp4"),
      rendered_duration_s: 44,
      clips: 8,
      render_invocation_mode: "final_production_render",
    });
    await fs.writeJson(path.join(customDir, "caption_manifest.json"), {
      status: "ready",
      caption_srt_path: path.join(customDir, "captions.srt"),
      timing_source: "word_timestamps",
      blockers: [],
      checks: { caption_file_present: true, captions_well_formed: true },
    });

    const report = await buildControlledRestartPack({
      root,
      generatedAt: "2026-06-01T12:00:00.000Z",
      candidateLimit: 1,
      candidateReport: {
        candidates: [
          {
            id,
            title: "Overnight Ready Candidate Works",
            status: "publish_ready",
            score: 100,
            duration_seconds: 44,
            source: {
              exported_path: path.join(customDir, "visual_v4_render.mp4"),
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
          },
        ],
      },
      strictDryRunPlan: {
        overall_verdict: "AMBER",
        actions: [
          action(id, "youtube_shorts", true),
          action(id, "instagram_reels", true),
          action(id, "facebook_reels", true),
          action(id, "tiktok", false),
        ],
      },
      platformStatusMatrix: {},
    });

    assert.deepEqual(report.selected_restart_candidates.map((candidate) => candidate.story_id), [id]);
    assert.equal(report.selected_restart_candidates[0].artifact_dir, customDir);
  });
});

test("controlled restart pack rejects internally framed narration before restart approval", async () => {
  await withTempDir(async (root) => {
    const ids = ["clean-a", "internal-copy", "clean-b"];
    for (const id of ids) {
      await writeStory(root, id, `Restart ${id} Clean Title`, {
        script: id === "internal-copy"
          ? "This is a price story. The clean angle is the discount and whether it fits the audience watching this short. Right now the news is the offer itself, not a hard sell."
          : `Restart ${id} has one useful test now: visible gameplay. Official Source says the latest preview shows combat, camera work and a full-scale mission instead of another logo beat. That matters because players can judge whether the pitch actually holds once the trailer stops cutting around the action. Fans will split on whether the licence is carrying the reveal or the play itself is doing the work. If the next footage keeps that clarity, this becomes a real release signal instead of a logo reveal. Follow Pulse Gaming so you never miss a beat.`,
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
