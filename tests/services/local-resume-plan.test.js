const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildLocalResumePlan,
  formatLocalResumePlanMarkdown,
  summarizeProofCandidates,
  summarizeLocalTtsProofReports,
} = require("../../lib/ops/local-resume-plan");
const {
  resolveLocalPostingReadiness,
  resolveLocalTtsProofReports,
} = require("../../tools/local-resume-plan");

function greenLocalPosting() {
  return {
    verdict: "green",
    readiness: {
      local_health: true,
      public_health: true,
      tunnel_connected: true,
      primary_enabled: true,
      queue_enabled: true,
      auto_publish_enabled: true,
      local_tts_green: true,
      local_voice_ready_count: 6,
    },
    blockers: [],
  };
}

function workingSocialOps() {
  return {
    platforms: {
      youtube: { state: "working" },
      instagram_reel: { state: "working" },
      facebook_reel: { state: "working" },
      tiktok: {
        state: "blocked_external",
        token: { ok: false, reason: "expired", refresh_available: true },
        safeRoutes: [{ id: "official_inbox_upload", status: "needs_token_refresh_or_sync" }],
      },
    },
  };
}

function greenTts() {
  return {
    verdict: "GREEN",
    proof_batch: { voice_ready_count: 6 },
  };
}

test("local resume plan keeps Railway standby and ElevenLabs temporary", () => {
  const report = buildLocalResumePlan({
    generatedAt: "2026-05-12T21:30:00.000Z",
    localPostingReadiness: {
      verdict: "amber",
      readiness: {
        local_health: true,
        public_health: false,
        tunnel_connected: false,
        primary_enabled: false,
        queue_enabled: false,
        auto_publish_enabled: false,
        duplicate_control_keys: ["AUTO_PUBLISH", "USE_JOB_QUEUE"],
        local_tts_green: true,
        local_voice_ready_count: 6,
      },
      blockers: ["pulse.orryy.com Cloudflare tunnel is not connected to this PC"],
    },
    platformDoctor: {
      platforms: {
        tiktok: {
          token: { ok: false, reason: "expired", refresh_available: true },
          official_inbox_route: "creative_review_required_before_inbox",
        },
        facebook_reel: { status: "enabled_verify_after_upload" },
        instagram_reel: { status: "enabled_monitor_next_publish" },
      },
    },
    socialOps: workingSocialOps(),
    proofCandidates: { candidates: [] },
    ttsReport: greenTts(),
  });

  assert.equal(report.verdict, "amber");
  assert.equal(report.strategy.railway_role, "standby_optional_only");
  assert.equal(report.strategy.voice_target, "local_liam");
  assert.equal(report.strategy.paid_voice_role, "elevenlabs_temporary_bridge_only");
  assert.equal(report.readiness.can_resume_local_automatic_posting, false);
  assert.deepEqual(report.readiness.duplicate_control_keys, ["AUTO_PUBLISH", "USE_JOB_QUEUE"]);
  assert.ok(report.blockers.includes("pulse.orryy.com Cloudflare tunnel is not connected to this PC"));
  assert.ok(
    report.blockers.includes("duplicate local control switches in .env: AUTO_PUBLISH, USE_JOB_QUEUE"),
  );
  assert.equal(report.platforms.tiktok.blocks_core_resume, false);
});

test("local resume plan consumes amber posting readiness deterministically", () => {
  const report = buildLocalResumePlan({
    generatedAt: "2026-05-12T22:00:00.000Z",
    localPostingReadiness: {
      verdict: "amber",
      status: "local_foundation_ready_cutover_blocked",
      readiness: {
        local_health: true,
        public_health: true,
        tunnel_connected: true,
        primary_enabled: false,
        queue_enabled: true,
        auto_publish_enabled: true,
        duplicate_control_keys: [],
        local_tts_green: true,
        local_voice_ready_count: 6,
      },
      blockers: ["local instance is still mirror mode, not primary"],
    },
    socialOps: workingSocialOps(),
    ttsReport: greenTts(),
  });

  assert.equal(report.verdict, "amber");
  assert.equal(report.readiness.local_posting_verdict, "AMBER");
  assert.equal(report.readiness.local_health, true);
  assert.equal(report.readiness.public_health, true);
  assert.equal(report.readiness.tunnel_connected, true);
  assert.ok(report.blockers.includes("local instance is still mirror mode, not primary"));
  assert.ok(!report.blockers.includes("local posting readiness is unknown, not green"));
});

test("local resume plan tool derives amber posting readiness when the readiness report is missing", async (t) => {
  const fs = require("fs-extra");
  const path = require("node:path");
  const os = require("node:os");
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-resume-readiness-"));
  t.after(() => fs.remove(outDir));

  await fs.writeJson(path.join(outDir, "local_cutover_plan.json"), {
    verdict: "red",
    env: {
      duplicate_keys: [],
      flags: {
        primary: false,
        use_job_queue: true,
        auto_publish: true,
      },
    },
    cloudflared: { tunnel_info: "Your tunnel does not have any active connection." },
    health: {
      local: { ok: true, status: 200, json: { deployment: { mode: "local", primary: false } } },
      public: { ok: true, status: 200, json: { deployment: { mode: "local", primary: false } } },
    },
  });
  await fs.writeJson(path.join(outDir, "local_tts_overnight_report.json"), greenTts());

  const readiness = await resolveLocalPostingReadiness(outDir);

  assert.equal(readiness.verdict, "amber");
  assert.equal(readiness.readiness.local_health, true);
  assert.equal(readiness.readiness.public_health, true);
  assert.equal(readiness.readiness.tunnel_connected, true);
});

test("local resume plan tool rebuilds posting readiness instead of trusting stale JSON", async (t) => {
  const fs = require("fs-extra");
  const path = require("node:path");
  const os = require("node:os");
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-resume-stale-"));
  t.after(() => fs.remove(outDir));

  await fs.writeJson(path.join(outDir, "local_posting_readiness.json"), {
    verdict: "red",
    readiness: {
      local_health: false,
      public_health: false,
      tunnel_connected: false,
      primary_enabled: false,
      queue_enabled: false,
      auto_publish_enabled: false,
    },
    blockers: ["stale report"],
  });
  await fs.writeJson(path.join(outDir, "local_cutover_plan.json"), {
    generated_at: "2026-05-13T07:45:00.000Z",
    verdict: "green",
    env: {
      duplicate_keys: [],
      flags: {
        primary: true,
        use_job_queue: true,
        auto_publish: true,
      },
    },
    cloudflared: { tunnel_info: "Active connections: 2" },
    health: {
      local: { ok: true, status: 200, json: { deployment: { mode: "local", primary: true } } },
      public: { ok: true, status: 200, json: { deployment: { mode: "local", primary: true } } },
    },
  });
  await fs.writeJson(path.join(outDir, "local_tts_overnight_report.json"), {
    generated_at: "2026-05-13T07:45:00.000Z",
    ...greenTts(),
  });

  const readiness = await resolveLocalPostingReadiness(outDir);

  assert.equal(readiness.verdict, "green");
  assert.equal(readiness.readiness.local_health, true);
  assert.equal(readiness.readiness.primary_enabled, true);
  assert.deepEqual(readiness.blockers, []);
});

test("local resume plan tool loads local Liam proof reports from output", async (t) => {
  const fs = require("fs-extra");
  const path = require("node:path");
  const os = require("node:os");
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-resume-proofs-"));
  t.after(() => fs.remove(outDir));

  await fs.writeJson(path.join(outDir, "local_media_repair_audio_apply.json"), {
    applied: [
      {
        story_id: "ready_audio",
        output_audio_path: "test/output/local-media-repair/audio/ready_audio_liam.mp3",
        duration_seconds: 68.4,
        duration_verdict: "pass",
        failure_code: null,
        local_voice_metadata: "stamped",
        local_voice_reference: { id: "pulse-sleepy-liam-20260502", referencePresent: true },
      },
    ],
  });

  const reports = await resolveLocalTtsProofReports(outDir);
  const resume = buildLocalResumePlan({
    localPostingReadiness: greenLocalPosting(),
    socialOps: workingSocialOps(),
    ttsReport: greenTts(),
    localTtsProofReports: reports,
  });

  assert.equal(resume.local_voice_proofs.approved_audio_proof_count, 1);
  assert.equal(resume.local_voice_proofs.ready_for_local_rerender[0].story_id, "ready_audio");
});

test("local resume plan can go green without TikTok direct posting", () => {
  const report = buildLocalResumePlan({
    localPostingReadiness: greenLocalPosting(),
    platformDoctor: {
      platforms: {
        tiktok: {
          token: { ok: false, reason: "expired", refresh_available: true },
          official_inbox_route: "prepared_not_executed",
        },
        facebook_reel: { status: "enabled_verify_after_upload" },
        instagram_reel: { status: "enabled_monitor_next_publish" },
      },
    },
    socialOps: workingSocialOps(),
    proofCandidates: {
      candidates: [
        {
          story_id: "story1",
          verdict: "needs_motion_or_exact_assets",
          audio: { ready: true, duration_seconds: 66 },
          visuals: { exact_subject_count: 0, validated_clip_ref_count: 0 },
        },
      ],
    },
    ttsReport: greenTts(),
  });

  assert.equal(report.verdict, "green");
  assert.equal(report.status, "ready_to_resume_local_automatic_posting");
  assert.equal(report.readiness.can_resume_local_automatic_posting, true);
  assert.equal(report.quality.production_lane_now, "legacy_standard_lane");
  assert.match(report.warnings.join("\n"), /automated TikTok remains blocked/);
});

test("local resume plan blocks stale green posting readiness when restart readiness is red", () => {
  const report = buildLocalResumePlan({
    localPostingReadiness: greenLocalPosting(),
    localRestartReadiness: {
      verdict: "red",
      blockers: ["localhost /api/health is not reachable"],
      windows_scheduler_hygiene: {
        visible_console_risk_count: 1,
        risk_task_names: ["Orryy-PulseGaming"],
      },
    },
    socialOps: workingSocialOps(),
    ttsReport: greenTts(),
  });

  assert.equal(report.verdict, "amber");
  assert.equal(report.readiness.can_resume_local_automatic_posting, false);
  assert.equal(report.readiness.local_restart_verdict, "RED");
  assert.match(report.blockers.join("\n"), /local restart readiness is red/);
  assert.match(report.blockers.join("\n"), /localhost \/api\/health is not reachable/);
  assert.match(report.warnings.join("\n"), /Orryy-PulseGaming/);
  assert.equal(
    report.morning_approval_queue.find((item) => item.decision === "local_primary_cutover")
      .recommendation,
    "wait_until_local_resume_plan_is_green",
  );
});

test("local resume plan blocks zero local voice-ready proofs", () => {
  const report = buildLocalResumePlan({
    localPostingReadiness: {
      ...greenLocalPosting(),
      readiness: {
        ...greenLocalPosting().readiness,
        local_tts_green: false,
        local_voice_ready_count: 0,
      },
    },
    socialOps: workingSocialOps(),
    ttsReport: { verdict: "RED", proof_batch: { voice_ready_count: 0 } },
  });

  assert.equal(report.verdict, "amber");
  assert.equal(report.readiness.can_resume_local_automatic_posting, false);
  assert.match(report.blockers.join("\n"), /local Liam TTS is not green/);
});

test("ready Studio V2 candidate promotes pilot quality lane without switching production", () => {
  const report = buildLocalResumePlan({
    localPostingReadiness: greenLocalPosting(),
    socialOps: workingSocialOps(),
    ttsReport: greenTts(),
    proofCandidates: {
      candidates: [
        {
          story_id: "flash_ready",
          verdict: "ready_flash_proof",
          audio: { ready: true, duration_seconds: 66 },
          proof_readiness: { final_recommendation: "render_local_proof" },
          visuals: { exact_subject_count: 6, validated_clip_ref_count: 3 },
        },
      ],
    },
  });

  assert.equal(report.quality.production_lane_now, "studio_v2_pilot_candidate");
  assert.equal(report.quality.ready_flash_proof_count, 1);
  assert.equal(report.strategy.production_quality_lane_now, "studio_v2_pilot_candidate");
});

test("proof candidate summary prioritises local voice-ready media repair", () => {
  const summary = summarizeProofCandidates({
    candidates: [
      {
        story_id: "voice_ready",
        audio: { ready: true },
        proof_readiness: { final_recommendation: "repair_media_first" },
        visuals: { exact_subject_count: 0, validated_clip_ref_count: 0 },
      },
      {
        story_id: "flash_ready",
        verdict: "ready_flash_proof",
        audio: { ready: true },
        proof_readiness: { final_recommendation: "render_local_proof" },
        visuals: { exact_subject_count: 6, validated_clip_ref_count: 3 },
      },
      {
        story_id: "voice_missing",
        audio: { ready: false },
        proof_readiness: { final_recommendation: "repair_voice_first" },
        visuals: { exact_subject_count: 6, validated_clip_ref_count: 3 },
      },
    ],
  });

  assert.equal(summary.ready_flash_proof_count, 1);
  assert.equal(summary.local_voice_ready_count, 2);
  assert.equal(summary.repair_media_first_count, 1);
  assert.equal(summary.repair_voice_first_count, 1);
  assert.equal(summary.closest_candidates[0].story_id, "flash_ready");
});

test("local resume plan turns approved local Liam proof MP3s into rerender candidates", () => {
  const report = buildLocalResumePlan({
    localPostingReadiness: greenLocalPosting(),
    socialOps: workingSocialOps(),
    ttsReport: greenTts(),
    localTtsProofReports: [
      {
        source: "local_media_repair",
        report: {
          applied: [
            {
              story_id: "ready_audio",
              output_audio_path: "test/output/local-media-repair/audio/ready_audio_liam.mp3",
              resolved_audio_path: "D:/pulse-data/media/test/output/local-media-repair/audio/ready_audio_liam.mp3",
              duration_seconds: 68.42,
              duration_verdict: "pass",
              failure_code: null,
              local_voice_metadata: "stamped",
              local_voice_reference: {
                id: "pulse-sleepy-liam-20260502",
                referencePresent: true,
              },
            },
            {
              story_id: "too_short",
              output_audio_path: "test/output/local-media-repair/audio/too_short_liam.mp3",
              duration_seconds: 54.56,
              duration_verdict: "reject_duration",
              failure_code: "duration_too_short",
              local_voice_metadata: "stamped",
              local_voice_reference: {
                id: "pulse-sleepy-liam-20260502",
                referencePresent: true,
              },
            },
          ],
          skipped: [
            {
              story_id: "server_down",
              reason: "server_down",
            },
          ],
        },
      },
    ],
  });

  assert.equal(report.local_voice_proofs.approved_audio_proof_count, 1);
  assert.equal(report.local_voice_proofs.rejected_audio_proof_count, 2);
  assert.equal(report.local_voice_proofs.ready_for_local_rerender.length, 1);
  assert.equal(report.local_voice_proofs.ready_for_local_rerender[0].story_id, "ready_audio");
  assert.equal(report.local_voice_proofs.ready_for_local_rerender[0].safe_to_publish_now, false);
  assert.equal(report.local_voice_proofs.ready_for_local_rerender[0].next_action, "rerender_video_local");
  assert.match(
    report.local_voice_proofs.ready_for_local_rerender[0].promotion_blocker,
    /clean local MP4 rerender/,
  );
  assert.deepEqual(report.local_voice_proofs.rejected_audio_proofs.map((row) => row.story_id), [
    "too_short",
    "server_down",
  ]);
  assert.match(report.next_actions.join("\n"), /Rerender locally with approved local Liam proof MP3s/);
});

test("local TTS proof summary dedupes by story and keeps the longest valid proof", () => {
  const summary = summarizeLocalTtsProofReports([
    {
      source: "local_media_repair",
      report: {
        applied: [
          {
            story_id: "story_a",
            output_audio_path: "test/output/local-media-repair/audio/story_a_liam.mp3",
            duration_seconds: 64,
            duration_verdict: "pass",
            failure_code: null,
            local_voice_metadata: "stamped",
            local_voice_reference: { id: "pulse-sleepy-liam-20260502", referencePresent: true },
          },
        ],
      },
    },
    {
      source: "local_script_extension",
      report: {
        applied: [
          {
            story_id: "story_a",
            output_audio_path: "test/output/local-script-extension/audio/story_a_liam_extended.mp3",
            duration_seconds: 70,
            duration_verdict: "pass",
            failure_code: null,
            local_voice_metadata: "stamped",
            local_voice_reference: { id: "pulse-sleepy-liam-20260502", referencePresent: true },
          },
        ],
      },
    },
  ]);

  assert.equal(summary.approved_audio_proof_count, 1);
  assert.equal(summary.ready_for_local_rerender[0].duration_seconds, 70);
  assert.match(summary.ready_for_local_rerender[0].output_audio_path, /local-script-extension/);
});

test("local resume plan markdown is plain-English and operator readable", () => {
  const report = buildLocalResumePlan({
    localPostingReadiness: greenLocalPosting(),
    socialOps: workingSocialOps(),
    ttsReport: greenTts(),
  });
  const markdown = formatLocalResumePlanMarkdown(report);

  assert.match(markdown, /Railway stays standby only/);
  assert.match(markdown, /ElevenLabs is only a temporary bridge/);
  assert.match(markdown, /Current safe production lane/);
  assert.match(markdown, /npm run ops:local-posting-readiness/);
});

test("local resume plan markdown lists approved local audio proofs without implying publish safety", () => {
  const report = buildLocalResumePlan({
    localPostingReadiness: greenLocalPosting(),
    socialOps: workingSocialOps(),
    ttsReport: greenTts(),
    localTtsProofReports: [
      {
        source: "local_media_repair",
        report: {
          applied: [
            {
              story_id: "ready_audio",
              output_audio_path: "test/output/local-media-repair/audio/ready_audio_liam.mp3",
              duration_seconds: 68.42,
              duration_verdict: "pass",
              failure_code: null,
              local_voice_metadata: "stamped",
              local_voice_reference: { id: "pulse-sleepy-liam-20260502", referencePresent: true },
            },
          ],
        },
      },
    ],
  });
  const markdown = formatLocalResumePlanMarkdown(report);

  assert.match(markdown, /Approved Local Liam Audio Proofs/);
  assert.match(markdown, /ready_audio/);
  assert.match(markdown, /safe_to_publish_now=false/);
  assert.match(markdown, /requires clean local MP4 rerender/);
});

test("local resume plan advertises read-only safety boundaries", () => {
  const report = buildLocalResumePlan({
    localPostingReadiness: greenLocalPosting(),
    socialOps: workingSocialOps(),
    ttsReport: greenTts(),
  });

  assert.match(report.safety, /read-only plan/);
  assert.match(report.safety, /does not edit \.env/);
  assert.match(report.safety, /mutate tokens/);
  assert.match(report.safety, /touch Railway/);
});
