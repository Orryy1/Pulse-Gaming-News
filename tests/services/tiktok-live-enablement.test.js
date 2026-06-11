"use strict";

const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const fs = require("fs-extra");

function loadTikTok() {
  delete require.cache[require.resolve("../../upload_tiktok")];
  return require("../../upload_tiktok");
}

function withEnv(patch, fn) {
  const keys = Object.keys(patch);
  const before = {};
  for (const key of keys) before[key] = process.env[key];
  try {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return fn();
  } finally {
    for (const key of keys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
}

test("resolveTokenPath: falls back through PULSE_TOKEN_DIR before repo-local tokens", () => {
  const dir = path.join(os.tmpdir(), "pulse-token-dir-live-test");
  const { resolveTokenPath } = loadTikTok();

  const resolved = withEnv(
    {
      TIKTOK_TOKEN_PATH: undefined,
      PULSE_TOKEN_DIR: dir,
    },
    () => resolveTokenPath(),
  );

  assert.equal(resolved, path.join(dir, "tiktok_token.json"));
});

test("TikTok readiness matrix classifies an expired refreshable token as refresh-required", () => {
  const {
    buildTikTokReadinessReport,
    renderTikTokReadinessMarkdown,
  } = require("../../lib/platforms/tiktok-live-enablement");

  const report = buildTikTokReadinessReport({
    generatedAt: "2026-06-07T10:00:00.000Z",
    env: {
      TIKTOK_CLIENT_KEY: "client-key",
      TIKTOK_CLIENT_SECRET: "secret-must-not-leak",
      TIKTOK_ENABLED: "true",
      TIKTOK_AUTO_UPLOAD_ENABLED: "true",
    },
    tokenFile: {
      exists: true,
      access_token_present: true,
      refresh_token_present: true,
      open_id_present: true,
      scope_list: ["user.info.basic", "video.publish", "video.upload"],
    },
    tokenStatus: {
      ok: false,
      reason: "expired",
      refresh_available: true,
      needs_reauth: false,
      expires_in_seconds: -120,
    },
    uploadCode: { ok: true },
  });

  assert.equal(report.classification, "TIKTOK_TOKEN_REFRESH_REQUIRED");
  assert.ok(report.blockers.some((blocker) => blocker.code === "tiktok_token_expired_refreshable"));
  assert.equal(report.safety.no_token_values_printed, true);
  assert.equal(report.scope_assumptions.video_publish_authorized, true);
  assert.equal(report.scope_assumptions.video_upload_authorized, true);

  const markdown = renderTikTokReadinessMarkdown(report);
  assert.match(markdown, /TIKTOK_TOKEN_REFRESH_REQUIRED/);
  assert.doesNotMatch(markdown, /secret-must-not-leak|access_token|refresh_token|Bearer/);
});

test("TikTok readiness matrix classifies valid creator_info without public approval as app-audit required", () => {
  const {
    buildTikTokReadinessReport,
    renderOperatorActionPlan,
  } = require("../../lib/platforms/tiktok-live-enablement");

  const report = buildTikTokReadinessReport({
    env: {
      TIKTOK_CLIENT_KEY: "client-key",
      TIKTOK_CLIENT_SECRET: "client-secret",
      TIKTOK_ENABLED: "true",
      TIKTOK_AUTO_UPLOAD_ENABLED: "true",
    },
    tokenFile: {
      exists: true,
      access_token_present: true,
      refresh_token_present: true,
      open_id_present: true,
      scope_list: ["user.info.basic", "video.publish", "video.upload"],
    },
    tokenStatus: {
      ok: true,
      reason: "ok",
      refresh_available: true,
      needs_reauth: false,
      expires_in_seconds: 3600,
    },
    creatorInfo: {
      ok: true,
      data: {
        creator_username: "pulsegaming",
        creator_nickname: "Pulse Gaming",
        privacy_level_options: ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"],
        max_video_post_duration_sec: 300,
        comment_disabled: false,
        duet_disabled: false,
        stitch_disabled: true,
      },
    },
    uploadCode: { ok: true },
  });

  assert.equal(report.classification, "TIKTOK_APP_AUDIT_REQUIRED");
  assert.equal(report.creator_info.public_to_everyone_available, true);
  assert.equal(report.creator_info.private_only_available, true);
  assert.equal(report.public_posting.allowed_now, false);
  assert.equal(report.public_posting.blocker, "direct_post_approval_not_declared");
  assert.ok(report.blockers.some((blocker) => blocker.code === "tiktok_app_audit_required"));

  const operatorPlan = renderOperatorActionPlan(report);
  assert.match(operatorPlan, /## Current Proof/);
  assert.match(operatorPlan, /Current app status: public_direct_post_audit_not_declared/);
  assert.match(operatorPlan, /Current error code: direct_post_approval_not_declared/);
  assert.match(operatorPlan, /user\.info\.basic, video\.publish, video\.upload/);
  assert.match(operatorPlan, /Screenshot or record/);
  assert.match(operatorPlan, /Exact next external step/);
});

test("TikTok readiness matrix marks public ready only with valid token, creator_info and declared direct-post approval", () => {
  const {
    buildTikTokReadinessReport,
  } = require("../../lib/platforms/tiktok-live-enablement");

  const report = buildTikTokReadinessReport({
    env: {
      TIKTOK_CLIENT_KEY: "client-key",
      TIKTOK_CLIENT_SECRET: "client-secret",
      TIKTOK_ENABLED: "true",
      TIKTOK_AUTO_UPLOAD_ENABLED: "true",
      TIKTOK_DIRECT_POST_APPROVED: "true",
    },
    tokenFile: {
      exists: true,
      access_token_present: true,
      refresh_token_present: true,
      open_id_present: true,
      scope_list: ["user.info.basic", "video.publish", "video.upload"],
    },
    tokenStatus: { ok: true, reason: "ok", refresh_available: true, expires_in_seconds: 3600 },
    creatorInfo: {
      ok: true,
      data: {
        creator_username: "pulsegaming",
        privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
        max_video_post_duration_sec: 300,
      },
    },
    uploadCode: { ok: true },
  });

  assert.equal(report.classification, "TIKTOK_READY_PUBLIC");
  assert.equal(report.public_posting.allowed_now, true);
  assert.deepEqual(report.blockers, []);
});

test("TikTok package gate builds a FILE_UPLOAD direct-post pack from creator_info only", () => {
  const {
    buildTikTokPublishPack,
    buildTikTokPlatformPreflight,
    buildTikTokDurationVariantReport,
  } = require("../../lib/platforms/tiktok-live-enablement");

  const readiness = {
    classification: "TIKTOK_READY_PUBLIC",
    creator_info: {
      available: true,
      privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
      max_video_post_duration_sec: 300,
      comment_disabled: false,
      duet_disabled: true,
      stitch_disabled: false,
    },
    public_posting: { allowed_now: true },
  };
  const action = {
    story_id: "story-1",
    platform: "tiktok",
    action: "would_publish",
    title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
    video_path: "output/story-1/platform_variants/tiktok_creator_rewards/story-1.mp4",
    captions_path: "output/story-1/platform_variants/tiktok_creator_rewards/captions.srt",
    video_duration_s: 64.4,
    creator_rewards_eligible: true,
    disclosure_requirements: {
      affiliate: true,
      ai_generated: true,
      commercial: false,
    },
    no_network_upload: true,
    blockers: [],
  };

  const pack = buildTikTokPublishPack({
    generatedAt: "2026-06-07T10:05:00.000Z",
    readiness,
    action,
    videoSizeBytes: 11_000_000,
    desiredPrivacyLevel: "PUBLIC_TO_EVERYONE",
  });

  assert.equal(pack.ready_for_direct_post, true);
  assert.equal(pack.post_info.privacy_level, "PUBLIC_TO_EVERYONE");
  assert.equal(pack.post_info.disable_duet, true);
  assert.equal(pack.source_info.source, "FILE_UPLOAD");
  assert.equal(pack.source_info.video_size, 11_000_000);
  assert.equal(pack.source_info.total_chunk_count, 1);
  assert.equal(pack.disclosures.affiliate_disclosure_required, true);
  assert.equal(pack.disclosures.ai_disclosure_required, true);
  assert.equal(pack.duration.within_creator_info_max, true);
  assert.match(pack.caption, /#gaming/i);
  assert.ok(pack.hashtags.length > 0);

  const preflight = buildTikTokPlatformPreflight({ readiness, publishPack: pack });
  assert.equal(preflight.publishable_now_count, 1);
  assert.equal(preflight.no_disabled_platform_action_counted_as_publishable, true);

  const duration = buildTikTokDurationVariantReport({ actions: [action], readiness });
  assert.equal(duration.tiktok_actions[0].creator_rewards_window.status, "ready_61_90s");
});

test("TikTok package gate refuses to count deferred or creator_info-missing actions as publishable", () => {
  const {
    buildTikTokPublishPack,
    buildTikTokPlatformPreflight,
  } = require("../../lib/platforms/tiktok-live-enablement");

  const pack = buildTikTokPublishPack({
    readiness: {
      classification: "TIKTOK_TOKEN_REFRESH_REQUIRED",
      creator_info: { available: false, privacy_level_options: [] },
      public_posting: { allowed_now: false },
    },
    action: {
      story_id: "story-2",
      platform: "tiktok",
      action: "would_queue_when_enabled",
      title: "Deferred TikTok Story",
      video_path: "output/story-2.mp4",
      video_duration_s: 65,
      blockers: [],
      no_network_upload: true,
    },
    videoSizeBytes: 6_000_000,
  });

  assert.equal(pack.ready_for_direct_post, false);
  assert.ok(pack.blockers.includes("creator_info_required_for_privacy_selection"));
  assert.ok(pack.blockers.includes("tiktok_platform_not_ready_public"));
  assert.equal(pack.post_info.privacy_level, null);

  const preflight = buildTikTokPlatformPreflight({ readiness: pack.readiness_snapshot, publishPack: pack });
  assert.equal(preflight.publishable_now_count, 0);
  assert.equal(preflight.queued_when_enabled_count, 1);
  assert.equal(preflight.no_disabled_platform_action_counted_as_publishable, true);
});

test("TikTok package gate emits one blocked native pack per candidate without strict dry-run actions", () => {
  const {
    buildTikTokCandidateActions,
    buildTikTokPublishPackSet,
    buildTikTokPlatformPreflight,
  } = require("../../lib/platforms/tiktok-live-enablement");

  const readiness = {
    classification: "TIKTOK_APP_AUDIT_REQUIRED",
    creator_info: {
      available: true,
      privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
      max_video_post_duration_sec: 3600,
      comment_disabled: false,
      duet_disabled: false,
      stitch_disabled: false,
    },
    public_posting: { allowed_now: false },
    blockers: [{ code: "tiktok_app_audit_required" }],
  };
  const candidates = [
    {
      id: "candidate-1",
      title: "Subnautica 2 Is Keeping Its Peaceful Rule",
      status: "publish_ready",
      duration_seconds: 65.2,
      source: { exported_path: "output/candidate-1/visual_v4_render.mp4" },
      preflight_qa: { status: "pass", blockers: [] },
    },
    {
      id: "candidate-2",
      title: "Forza Horizon 6 Just Got More Expensive",
      status: "publish_ready",
      duration_seconds: 43.4,
      source: { exported_path: "output/candidate-2/visual_v4_render.mp4" },
      preflight_qa: { status: "pass", blockers: [] },
    },
  ];

  const actions = buildTikTokCandidateActions({
    dryRunPlan: { actions: [] },
    nextCandidatesReport: { candidates },
    readiness,
  });

  assert.equal(actions.length, 2);
  assert.ok(actions.every((action) => action.platform === "tiktok"));
  assert.ok(actions.every((action) => action.action === "candidate_package"));
  assert.ok(actions.every((action) => action.blockers.includes("strict_dry_run_tiktok_action_missing")));

  const pack = buildTikTokPublishPackSet({
    readiness,
    actions,
    videoSizesByStoryId: new Map([
      ["candidate-1", 7_000_000],
      ["candidate-2", 8_000_000],
    ]),
  });

  assert.equal(pack.ready_for_direct_post, false);
  assert.equal(pack.candidate_pack_count, 2);
  assert.equal(pack.candidate_packs[0].story_id, "candidate-1");
  assert.equal(pack.candidate_packs[0].source_info.source, "FILE_UPLOAD");
  assert.equal(pack.candidate_packs[0].privacy.chosen_from_creator_info, true);
  assert.equal(pack.candidate_pack_summary.creator_rewards_suitable_61_90_count, 1);
  assert.ok(pack.candidate_packs[0].blockers.includes("tiktok_platform_not_ready_public"));
  assert.ok(pack.candidate_packs[0].blockers.includes("strict_dry_run_tiktok_action_missing"));

  const preflight = buildTikTokPlatformPreflight({ readiness, publishPack: pack });
  assert.equal(preflight.publishable_now_count, 0);
  assert.equal(preflight.queued_when_enabled_count, 0);
  assert.equal(preflight.blocked_count, 2);
  assert.deepEqual(preflight.platform_enablement_gaps, ["tiktok_app_audit_required"]);
  assert.ok(preflight.candidate_package_gaps.includes("strict_dry_run_tiktok_action_missing"));
  assert.equal(preflight.no_disabled_platform_action_counted_as_publishable, true);
});

test("TikTok live enablement markdown summarises the queued pack over the first blocked candidate", () => {
  const {
    renderTikTokLiveEnablementMarkdown,
  } = require("../../lib/platforms/tiktok-live-enablement");

  const markdown = renderTikTokLiveEnablementMarkdown({
    readinessReport: {
      classification: "TIKTOK_APP_AUDIT_REQUIRED",
      blockers: [{ code: "tiktok_app_audit_required", message: "Audit missing." }],
    },
    publishPack: {
      candidate_pack_count: 2,
      candidate_packs: [
        {
          story_id: "blocked-first",
          action: "candidate_package",
          ready_for_direct_post: false,
          video_path: "output/blocked.mp4",
          post_info: { privacy_level: "PUBLIC_TO_EVERYONE" },
          source_info: { source: "FILE_UPLOAD" },
          duration: { seconds: 42 },
          blockers: ["strict_dry_run_tiktok_action_missing"],
        },
        {
          story_id: "queued-ready",
          action: "would_queue_when_enabled",
          ready_for_direct_post: false,
          video_path: "output/queued.mp4",
          post_info: { privacy_level: "PUBLIC_TO_EVERYONE" },
          source_info: { source: "FILE_UPLOAD" },
          duration: { seconds: 68.8 },
          blockers: ["tiktok_platform_not_ready_public"],
        },
      ],
    },
    platformPreflight: {
      publishable_now_count: 0,
      queued_when_enabled_count: 1,
      platform_enablement_gaps: ["tiktok_app_audit_required"],
      candidate_package_gaps: ["tiktok_platform_not_ready_public"],
    },
    durationVariantReport: { tiktok_actions: [] },
  });

  assert.match(markdown, /- Story: queued-ready/);
  assert.match(markdown, /- Action: would_queue_when_enabled/);
  assert.doesNotMatch(markdown, /- Story: blocked-first/);
});

test("TikTok upload contract validates creator_info privacy, duration and chunked FILE_UPLOAD shape", () => {
  const {
    buildDirectPostInitRequest,
    planTikTokFileUploadChunks,
  } = loadTikTok();

  const chunkPlan = planTikTokFileUploadChunks(130 * 1024 * 1024);
  assert.equal(chunkPlan.source_info.source, "FILE_UPLOAD");
  assert.equal(chunkPlan.source_info.video_size, 130 * 1024 * 1024);
  assert.ok(chunkPlan.source_info.total_chunk_count >= 2);
  assert.equal(chunkPlan.chunks[0].content_range, `bytes 0-${chunkPlan.chunks[0].end}/${130 * 1024 * 1024}`);

  const request = buildDirectPostInitRequest({
    caption: "Forza Horizon 6 Exposes Xbox's Steam Bet #gaming",
    privacyLevel: "PUBLIC_TO_EVERYONE",
    videoSize: 130 * 1024 * 1024,
    videoDurationS: 64.4,
    creatorInfo: {
      privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
      max_video_post_duration_sec: 300,
      comment_disabled: false,
      duet_disabled: true,
      stitch_disabled: false,
    },
  });

  assert.equal(request.url, "https://open.tiktokapis.com/v2/post/publish/video/init/");
  assert.equal(request.body.post_info.privacy_level, "PUBLIC_TO_EVERYONE");
  assert.equal(request.body.post_info.disable_duet, true);
  assert.equal(request.body.source_info.total_chunk_count, chunkPlan.source_info.total_chunk_count);
  assert.equal(request.safety.privacy_level_from_creator_info, true);

  assert.throws(
    () => buildDirectPostInitRequest({
      caption: "bad",
      privacyLevel: "PUBLIC_TO_EVERYONE",
      videoSize: 6_000_000,
      videoDurationS: 400,
      creatorInfo: {
        privacy_level_options: ["SELF_ONLY"],
        max_video_post_duration_sec: 300,
      },
    }),
    /privacy_level_option_mismatch/,
  );
});

test("TikTok publish status fetch treats non-ok TikTok error bodies as failed", async () => {
  const axios = require("axios");
  const originalPost = axios.post;
  axios.post = async () => ({
    status: 200,
    data: {
      data: {},
      error: {
        code: "invalid_publish_id",
        message: "bad id",
      },
    },
  });

  try {
    const { fetchPublishStatus } = loadTikTok();
    const status = await fetchPublishStatus("publish-123", {
      accessToken: "test-token",
    });
    assert.equal(status.ok, false);
    assert.equal(status.raw_error_code, "invalid_publish_id");
  } finally {
    axios.post = originalPost;
  }
});

test("TikTok live enablement report artefact writer emits the requested JSON and Markdown files", async () => {
  const {
    writeTikTokLiveEnablementArtifacts,
  } = require("../../lib/platforms/tiktok-live-enablement");

  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-tiktok-live-artifacts-"));
  const artefacts = await writeTikTokLiveEnablementArtifacts({
    outputDir: outDir,
    readinessReport: {
      classification: "TIKTOK_APP_AUDIT_REQUIRED",
      blockers: [{ code: "tiktok_app_audit_required", external: true }],
    },
    publishPack: { ready_for_direct_post: false },
    platformPreflight: { publishable_now_count: 0 },
    durationVariantReport: { tiktok_actions: [] },
    testsRunSummary: { commands: [] },
  });

  for (const name of [
    "tiktok_readiness_report.json",
    "tiktok_readiness_report.md",
    "tiktok_blockers.json",
    "tiktok_operator_action_plan.md",
    "tiktok_publish_pack.json",
    "tiktok_platform_preflight.json",
    "tiktok_duration_variant_report.json",
    "tiktok_live_enablement_report.md",
    "tests_run_summary.json",
  ]) {
    assert.equal(await fs.pathExists(path.join(outDir, name)), true, name);
  }

  assert.equal(path.basename(artefacts.readinessJsonPath), "tiktok_readiness_report.json");
});

test("TikTok enablement status separates repo blockers from external operator blockers", () => {
  const {
    buildTikTokEnablementStatus,
  } = require("../../lib/platforms/tiktok-live-enablement");

  const status = buildTikTokEnablementStatus({
    readinessReport: {
      generated_at: "2026-06-11T09:00:00.000Z",
      classification: "TIKTOK_APP_AUDIT_REQUIRED",
      token: {
        status: "ok",
        refresh_available: true,
        needs_reauth: false,
      },
      creator_info: {
        available: true,
        public_to_everyone_available: true,
        private_only_available: true,
        privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
        max_video_post_duration_sec: 300,
      },
      public_posting: {
        allowed_now: false,
        direct_post_approval_declared: false,
        blocker: "direct_post_approval_not_declared",
      },
      private_test: {
        self_only_available: true,
        allowed_by_this_report: false,
      },
      blockers: [
        {
          code: "tiktok_app_audit_required",
          message: "Public Direct Post approval is not declared.",
          external: true,
        },
      ],
    },
    platformPreflight: {
      operational_state: "blocked_external",
      publishable_now_count: 0,
      queued_when_enabled_count: 2,
      blocked_count: 0,
      candidate_package_gaps: [],
      platform_enablement_gaps: ["tiktok_app_audit_required"],
    },
    publishPack: {
      candidate_pack_summary: {
        total: 2,
        ready_for_direct_post_count: 0,
        queued_when_enabled_count: 2,
        blocked_count: 0,
        creator_rewards_suitable_61_90_count: 1,
      },
    },
    durationVariantReport: {
      tiktok_actions: [
        {
          story_id: "ready-61",
          creator_rewards_window: { status: "ready_61_90s" },
        },
        {
          story_id: "short-43",
          creator_rewards_window: { status: "below_61s" },
        },
      ],
    },
  });

  assert.equal(status.platform, "tiktok");
  assert.equal(status.classification, "TIKTOK_APP_AUDIT_REQUIRED");
  assert.equal(status.live_publish_allowed, false);
  assert.equal(status.counted_as_live_enabled_platform, false);
  assert.equal(status.public_posting_state, "blocked_external_public_direct_post");
  assert.deepEqual(status.repo_side_blockers, []);
  assert.deepEqual(status.external_operator_blockers.map((blocker) => blocker.code), [
    "tiktok_app_audit_required",
  ]);
  assert.equal(status.duration_variant_summary.ready_61_90s_count, 1);
  assert.equal(status.duration_variant_summary.below_61s_count, 1);
});

test("TikTok artefact writer emits enablement, creator-info, direct-post and operator-blocker JSON", async () => {
  const {
    writeTikTokLiveEnablementArtifacts,
  } = require("../../lib/platforms/tiktok-live-enablement");

  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-tiktok-enable-status-"));
  const artefacts = await writeTikTokLiveEnablementArtifacts({
    outputDir: outDir,
    readinessReport: {
      classification: "TIKTOK_TOKEN_REFRESH_REQUIRED",
      creator_info: { available: false, privacy_level_options: [] },
      public_posting: { allowed_now: false, blocker: "creator_info_or_scope_not_ready" },
      blockers: [
        {
          code: "tiktok_token_expired_refreshable",
          message: "Token refresh is available.",
          local: true,
        },
      ],
    },
    publishPack: {
      candidate_pack_summary: {
        total: 1,
        ready_for_direct_post_count: 0,
        queued_when_enabled_count: 0,
        blocked_count: 1,
        creator_rewards_suitable_61_90_count: 0,
      },
    },
    platformPreflight: {
      operational_state: "needs_credentials",
      publishable_now_count: 0,
      queued_when_enabled_count: 0,
      blocked_count: 1,
      platform_enablement_gaps: ["tiktok_token_expired_refreshable"],
      candidate_package_gaps: ["creator_info_required_for_privacy_selection"],
    },
    durationVariantReport: { tiktok_actions: [] },
    testsRunSummary: { commands: [] },
  });

  for (const name of [
    "tiktok_enablement_report.json",
    "tiktok_creator_info_status.json",
    "tiktok_direct_post_readiness.json",
    "tiktok_operator_blockers.json",
  ]) {
    assert.equal(await fs.pathExists(path.join(outDir, name)), true, name);
  }

  const enablement = await fs.readJson(path.join(outDir, "tiktok_enablement_report.json"));
  assert.equal(enablement.live_publish_allowed, false);
  assert.equal(enablement.counted_as_live_enabled_platform, false);
  assert.deepEqual(enablement.repo_side_blockers.map((blocker) => blocker.code), [
    "tiktok_token_expired_refreshable",
    "creator_info_required_for_privacy_selection",
  ]);

  const directPost = await fs.readJson(path.join(outDir, "tiktok_direct_post_readiness.json"));
  assert.equal(directPost.public.allowed_now, false);
  assert.equal(directPost.live_execution_gate, "platform_enablement_required");

  const operatorBlockers = await fs.readJson(path.join(outDir, "tiktok_operator_blockers.json"));
  assert.deepEqual(operatorBlockers.external_operator_blockers, []);
  assert.equal(path.basename(artefacts.enablementReportPath), "tiktok_enablement_report.json");
});
