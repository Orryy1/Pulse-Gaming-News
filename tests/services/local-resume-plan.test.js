const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildLocalResumePlan,
  formatLocalResumePlanMarkdown,
  summarizeProofCandidates,
} = require("../../lib/ops/local-resume-plan");

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
