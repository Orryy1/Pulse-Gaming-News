"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pr = require("../../lib/ops/publish-readiness");
const TOOL_PATH = path.resolve(__dirname, "..", "..", "tools", "publish-readiness.js");

// 2026-04-30 mission: ops:publish-readiness must give one
// GREEN/AMBER/RED verdict per pillar combination, never mutate
// production, and never silently mark unknown data as green.
//
// These tests pin the verdict ladder, the unknown handling,
// and the markdown formatter shape. The full async pillars are
// integration-tested separately — here we focus on the pure
// orchestration logic that isn't easily exercised end-to-end
// without a running DB + Railway.

// ── dominantVerdict ──────────────────────────────────────────────

test("dominantVerdict: red wins over everything", () => {
  assert.equal(pr.dominantVerdict(["green", "amber", "red"]), "red");
  assert.equal(pr.dominantVerdict(["green", "red", "unknown"]), "red");
});

test("dominantVerdict: amber wins over green when no red", () => {
  assert.equal(pr.dominantVerdict(["green", "amber"]), "amber");
});

test("dominantVerdict: review and warn count as amber", () => {
  assert.equal(pr.dominantVerdict(["green", "review"]), "amber");
  assert.equal(pr.dominantVerdict(["green", "warn"]), "amber");
});

test("dominantVerdict: fail and blocked count as red", () => {
  assert.equal(pr.dominantVerdict(["green", "fail"]), "red");
  assert.equal(pr.dominantVerdict(["green", "blocked"]), "red");
});

test("dominantVerdict: unknown alone returns unknown (never silent green)", () => {
  assert.equal(pr.dominantVerdict(["unknown"]), "unknown");
  assert.equal(pr.dominantVerdict(["unknown", "unknown"]), "unknown");
});

test("dominantVerdict: mix of unknown + green stays green (some signal IS positive)", () => {
  assert.equal(pr.dominantVerdict(["green", "unknown"]), "green");
});

test("dominantVerdict: all green stays green", () => {
  assert.equal(pr.dominantVerdict(["green", "green", "green"]), "green");
});

// ── PILLAR_NAMES contract ────────────────────────────────────────

test("PILLAR_NAMES: includes cadence plus the original readiness pillars", () => {
  assert.equal(pr.PILLAR_NAMES.length, 33);
  assert.ok(pr.PILLAR_NAMES.includes("local_restart_readiness"));
  assert.ok(pr.PILLAR_NAMES.includes("local_posting_readiness"));
  assert.ok(pr.PILLAR_NAMES.includes("publish_cadence"));
  assert.ok(pr.PILLAR_NAMES.includes("strict_dry_run_control"));
  assert.ok(pr.PILLAR_NAMES.includes("human_review_decision_sheet"));
  assert.ok(pr.PILLAR_NAMES.includes("human_review_operator_index"));
  assert.ok(pr.PILLAR_NAMES.includes("human_review_console"));
  assert.ok(pr.PILLAR_NAMES.includes("human_review_approval_gate"));
  assert.ok(pr.PILLAR_NAMES.includes("guarded_dispatch_preflight"));
  assert.ok(pr.PILLAR_NAMES.includes("guarded_dispatch_executor_preflight"));
  assert.ok(pr.PILLAR_NAMES.includes("repair_backlog"));
  assert.ok(pr.PILLAR_NAMES.includes("platform_duration_contract"));
  assert.ok(pr.PILLAR_NAMES.includes("final_voice_audit"));
});

test("PILLAR_NAMES: includes the audit-flagged external blockers", () => {
  assert.ok(pr.PILLAR_NAMES.includes("tiktok_external_block"));
  assert.ok(pr.PILLAR_NAMES.includes("facebook_reel_eligibility"));
  assert.ok(pr.PILLAR_NAMES.includes("facebook_card_fallback"));
});

test("PILLAR_NAMES: includes the security + docs drift pillars", () => {
  assert.ok(pr.PILLAR_NAMES.includes("security_blockers"));
  assert.ok(pr.PILLAR_NAMES.includes("docs_drift"));
});

test("summariseSystemDoctorReason: surfaces blocker and finding evidence", () => {
  assert.equal(
    pr.summariseSystemDoctorReason({
      blockers: ["production_health_unavailable_or_not_ok"],
      findings: ["local_branch_ahead_18"],
    }),
    "production_health_unavailable_or_not_ok",
  );
  assert.equal(
    pr.summariseSystemDoctorReason({
      blockers: [],
      findings: ["local_branch_ahead_18"],
      advisories: ["github_cli_auth_not_persistent"],
    }),
    "local_branch_ahead_18",
  );
});

test("summariseMediaVerifyReason: surfaces issue counts and top issue families", () => {
  assert.equal(
    pr.summariseMediaVerifyReason({
      issueCount: 4,
      issues: [
        { issue: "missing" },
        { issue: "missing" },
        { issue: "tiny_mp4" },
        { issue: "zero_byte" },
      ],
    }),
    "4_media_path_issues: missing x2, tiny_mp4 x1, zero_byte x1",
  );
});

test("summarisePlatformStatusReason: surfaces disabled and credential gaps", () => {
  assert.equal(
    pr.summarisePlatformStatusReason({
      summary: {
        disabled_platforms: ["tiktok", "twitter", "threads", "pinterest"],
        needs_credentials_platforms: ["tiktok"],
      },
      operational: {
        tiktok: { state: "needs_credentials", reason: "local_token_expired" },
        twitter: { state: "disabled", reason: "x_optional_disabled" },
        threads: { state: "disabled", reason: "threads_not_configured" },
        pinterest: { state: "disabled", reason: "pinterest_not_configured" },
      },
    }),
    "needs_credentials: tiktok=local_token_expired; disabled: pinterest=pinterest_not_configured, threads=threads_not_configured, twitter=x_optional_disabled",
  );
});

test("applyStrictPlatformEvidenceToStatus: TikTok doctor/preflight evidence outranks stale disabled status", () => {
  const staleStatus = {
    summary: {
      disabled_platform_count: 2,
      needs_credentials_platform_count: 0,
      disabled_platforms: ["tiktok", "twitter"],
      needs_credentials_platforms: [],
    },
    operational: {
      tiktok: { state: "disabled", reason: "operator_disabled" },
      twitter: { state: "disabled", reason: "x_optional_disabled" },
    },
    counts: {
      tiktok: { disabled: 3 },
      twitter: { disabled: 3 },
    },
  };

  const patched = pr.applyStrictPlatformEvidenceToStatus(staleStatus, {
    strictDryRunPlan: {
      platform_operational_config: {
        tiktok: {
          state: "needs_credentials",
          reason: "tiktok_local_token_refresh_or_sync_required",
          enablement_next_action:
            "refresh_or_sync_local_token_with_operator_present_before_any_inbox_upload",
        },
      },
      platform_status_matrix: {
        platforms: {
          tiktok: {
            operational_state: "needs_credentials",
            operational_reason: "tiktok_local_token_refresh_or_sync_required",
          },
        },
      },
    },
    platformDoctor: {
      platforms: {
        tiktok: {
          status: "needs_local_token_refresh_or_sync",
          recommendation:
            "refresh_or_sync_local_token_with_operator_present_before_any_inbox_upload",
        },
      },
    },
  });

  assert.equal(
    pr.summarisePlatformStatusReason(patched),
    "needs_credentials: tiktok=tiktok_local_token_refresh_or_sync_required; disabled: twitter=x_optional_disabled",
  );
  assert.deepEqual(staleStatus.summary.needs_credentials_platforms, []);
  assert.equal(staleStatus.operational.tiktok.reason, "operator_disabled");
  assert.deepEqual(patched.summary.disabled_platforms, ["twitter"]);
  assert.equal(patched.summary.disabled_platform_count, 1);
  assert.equal(patched.summary.needs_credentials_platform_count, 1);
  assert.deepEqual(patched.counts.tiktok, { needs_credentials: 3 });
  assert.equal(patched.operational.tiktok.operator_state, "disabled");
  assert.equal(patched.operational.tiktok.operator_reason, "operator_disabled");
});

test("summariseTiktokExternalBlockReason: surfaces platform doctor token and approval gaps", () => {
  assert.equal(
    pr.summariseTiktokExternalBlockReason({
      blockers: ["tiktok_local_token_refresh_or_sync_required"],
      platforms: {
        tiktok: {
          no_post_readiness: {
            direct_post: {
              blocker: "direct_post_approval_not_declared",
            },
          },
          recommendation: "refresh_or_sync_local_token_with_operator_present_before_any_inbox_upload",
        },
      },
    }),
    "tiktok_local_token_refresh_or_sync_required; direct_post_approval_not_declared; next=refresh_or_sync_local_token_with_operator_present_before_any_inbox_upload",
  );
});

test("summariseLocalRestartReadinessReason: surfaces local health and scheduler hygiene risks", () => {
  assert.equal(
    pr.summariseLocalRestartReadinessReason({
      blockers: ["localhost /api/health is not reachable"],
      warnings: ["1 Pulse-related Windows scheduled task(s) can launch visible console windows"],
      windows_scheduler_hygiene: {
        visible_console_risk_count: 1,
        risk_task_names: ["Orryy-PulseGaming"],
      },
    }),
    "localhost /api/health is not reachable; scheduler_visible_console_risks=1: Orryy-PulseGaming",
  );
});

test("pillarLocalPostingReadiness: surfaces runtime cutover blockers", () => {
  const pillar = pr.pillarLocalPostingReadiness({
    report: {
      verdict: "amber",
      status: "local_foundation_ready_cutover_blocked",
      readiness: {
        safe_observation_mode: true,
        running_primary_enabled: false,
        running_auto_publish_enabled: false,
      },
      blockers: [
        "local server is running safe observation mode, not primary posting mode",
        "running local server reports primary=false",
        "running local server reports AUTO_PUBLISH=false",
      ],
    },
  });

  assert.equal(pillar.verdict, "amber");
  assert.match(pillar.reason, /safe observation mode/);
  assert.match(pillar.reason, /primary=false/);
  assert.equal(pillar.raw.readiness.safe_observation_mode, true);
});

test("pillarLocalPostingReadiness: stale local posting artefacts keep cutover amber", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-local-posting-stale-"));
  const cutoverPath = path.join(dir, "local_cutover_plan.json");
  const primaryPath = path.join(dir, "local_primary_readiness.json");
  const ttsPath = path.join(dir, "local_tts_overnight_report.json");
  const localHealth = {
    ok: true,
    json: {
      runtime: { safe_observation_mode: false, auto_publish: true },
      deployment: { mode: "local", primary: true },
    },
  };
  try {
    fs.writeFileSync(
      cutoverPath,
      JSON.stringify({
        verdict: "green",
        env: { flags: { primary: true, use_job_queue: true, auto_publish: true } },
        health: {
          local: localHealth,
          public: { ok: true, json: { deployment: { mode: "local", primary: true } } },
        },
        cloudflared: { tunnel_info: "Active connections: 1" },
      }),
    );
    fs.writeFileSync(
      primaryPath,
      JSON.stringify({
        checks: {
          primary_enabled: true,
          use_job_queue_enabled: true,
          auto_publish_enabled: true,
        },
        health: { local: localHealth },
        duplicate_env_keys: [],
      }),
    );
    fs.writeFileSync(
      ttsPath,
      JSON.stringify({ verdict: "green", proof_batch: { voice_ready_count: 6 } }),
    );
    const old = new Date("2026-06-01T00:00:00.000Z");
    fs.utimesSync(ttsPath, old, old);

    const pillar = pr.pillarLocalPostingReadiness({
      localCutoverPlanPath: cutoverPath,
      localPrimaryReadinessPath: primaryPath,
      localTtsReportPath: ttsPath,
      now: Date.parse("2026-06-01T05:00:00.000Z"),
      maxArtifactAgeHours: 2,
    });

    assert.equal(pillar.verdict, "amber");
    assert.match(pillar.reason, /local_posting_artifacts_stale=local_tts_overnight_report/);
    assert.equal(pillar.raw.artifact_freshness.stale_count, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pillarLocalPostingReadiness: passes fresh tunnel evidence into aggregate report", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-local-posting-tunnel-"));
  const cutoverPath = path.join(dir, "local_cutover_plan.json");
  const ttsPath = path.join(dir, "local_tts_overnight_report.json");
  const tunnelPath = path.join(dir, "local_tunnel_readiness.json");
  try {
    fs.writeFileSync(
      cutoverPath,
      JSON.stringify({
        verdict: "red",
        env: { flags: { primary: true, use_job_queue: true, auto_publish: true } },
        cloudflared: { tunnel_info: "Your tunnel does not have any active connection." },
        health: {
          local: { ok: true, status: 200 },
          public: { ok: false, status: 530 },
        },
      }),
    );
    fs.writeFileSync(
      tunnelPath,
      JSON.stringify({
        verdict: "green",
        tunnel: { status: "active" },
        health: {
          local: {
            ok: true,
            status: 200,
            json: {
              runtime: { safe_observation_mode: true, auto_publish: false },
              deployment: { mode: "local", primary: false },
            },
          },
          public: {
            ok: true,
            status: 200,
            json: {
              runtime: { safe_observation_mode: true, auto_publish: false },
              deployment: { mode: "local", primary: false },
            },
          },
        },
      }),
    );
    fs.writeFileSync(
      ttsPath,
      JSON.stringify({ verdict: "green", proof_batch: { voice_ready_count: 6 } }),
    );

    const pillar = pr.pillarLocalPostingReadiness({
      localCutoverPlanPath: cutoverPath,
      localTunnelReadinessPath: tunnelPath,
      localTtsReportPath: ttsPath,
      now: Date.parse("2026-06-01T05:00:00.000Z"),
    });

    assert.equal(pillar.verdict, "amber");
    assert.equal(pillar.raw.readiness.public_health, true);
    assert.equal(pillar.raw.readiness.tunnel_connected, true);
    assert.doesNotMatch(pillar.reason, /Cloudflare tunnel is not connected/);
    assert.doesNotMatch(pillar.reason, /public_health=false/);
    assert.match(pillar.reason, /safe observation mode/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("summariseRepairBacklogReason: surfaces auto-repair lanes and dead-end blockers", () => {
  assert.equal(
    pr.summariseRepairBacklogReason({
      summary: {
        total_items: 5,
        auto_repairable_items: 4,
        operator_required_items: 1,
        dead_end_items: 1,
        lane_counts: {
          audio_regeneration: 2,
          rights_ledger_repair: 1,
          visual_v4_motion_enrichment: 1,
        },
      },
    }),
    "5_open_repair_items: 4_auto, 1_operator, 1_dead_end; top_lanes: audio_regeneration x2, rights_ledger_repair x1, visual_v4_motion_enrichment x1",
  );
});

test("pillarRenderMetadata separates active bridge renders from quarantined render debt", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-render-metadata-scope-"));
  const planPath = path.join(dir, "dry_run_publish_plan.json");
  const bridgePath = path.join(dir, "scheduler_bridge_candidates.json");
  try {
    fs.writeFileSync(
      planPath,
      JSON.stringify({
        generated_at: "2026-06-01T00:00:00.000Z",
        ready_stories: [{ story_id: "active-v4" }],
        skipped_stories: [{ story_id: "skipped-legacy", reason: "stale_temporal_rejected" }],
        blocked_stories: [],
        held_stories: [],
        safety: {
          no_publish_triggered: true,
          no_network_uploads: true,
          no_db_mutation: true,
          no_oauth_or_token_change: true,
          dry_run_only: true,
        },
      }),
    );
    fs.writeFileSync(
      bridgePath,
      JSON.stringify([
        {
          id: "active-v4",
          exported_path: "C:/renders/active-v4.mp4",
          render_lane: "visual_v4_production",
          render_quality_class: "premium",
        },
      ]),
    );

    const pillar = pr.pillarRenderMetadata({
      strictDryRunPlanPath: planPath,
      schedulerBridgeCandidatesPath: bridgePath,
      stories: [
        {
          id: "skipped-legacy",
          exported_path: "C:/renders/skipped-legacy.mp4",
          render_lane: "legacy_multi_image",
          render_quality_class: "fallback",
        },
      ],
    });

    assert.equal(pillar.verdict, "green");
    assert.equal(pillar.raw.readiness_scope, "strict_dry_run_scoped");
    assert.deepEqual(pillar.raw.active.lane_counts, { visual_v4_production: 1 });
    assert.deepEqual(pillar.raw.active.class_counts, { premium: 1 });
    assert.deepEqual(pillar.raw.quarantined.lane_counts, { legacy_multi_image: 1 });
    assert.deepEqual(pillar.raw.quarantined.class_counts, { fallback: 1 });
    assert.equal(pillar.raw.active_legacy_or_fallback_count, 0);
    assert.equal(pillar.raw.quarantined_legacy_or_fallback_count, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("buildMediaVerifyStoriesFromDryRunPlan: scopes verification to current action media", () => {
  const rows = pr.buildMediaVerifyStoriesFromDryRunPlan({
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      dry_run_only: true,
    },
    actions: [
      {
        story_id: "story1",
        platform: "youtube_shorts",
        action: "would_publish",
        video_path: "C:/renders/story1.mp4",
        captions_path: "C:/renders/story1.srt",
        cover_frame_source: "C:/renders/story1.mp4",
      },
      {
        story_id: "story1",
        platform: "x",
        action: "would_queue_when_enabled",
        video_path: "C:/renders/story1_x.mp4",
        captions_path: "C:/renders/story1_x.srt",
      },
      {
        story_id: "blocked",
        platform: "youtube_shorts",
        action: "blocked",
        video_path: "C:/renders/blocked.mp4",
      },
    ],
  });

  assert.deepEqual(
    rows.map((row) => row.id),
    ["story1:youtube_shorts", "story1:x"],
  );
  assert.equal(rows[0].exported_path, "C:/renders/story1.mp4");
  assert.equal(rows[0].captions_path, "C:/renders/story1.srt");
  assert.equal(rows[0].cover_frame_source, "C:/renders/story1.mp4");
});

test("tools/publish-readiness.js loads .env for local operator runs", () => {
  const src = fs.readFileSync(TOOL_PATH, "utf8");
  assert.match(src, /require\(["']dotenv["']\)\.config\(\{\s*override:\s*true\s*\}\)/);
});

// ── formatPublishReadinessMarkdown ───────────────────────────────

test("formatPublishReadinessMarkdown: green report uses green glyph", () => {
  const md = pr.formatPublishReadinessMarkdown({
    overall_verdict: "green",
    pillars: { foo: { verdict: "green" } },
    blockers: [],
    advisory: [],
    recently_improved: [],
    next_action: "Publish normally.",
    story_count: 5,
    generated_at: "2026-04-30T22:00:00Z",
  });
  assert.match(md, /🟢/);
  assert.match(md, /GREEN/);
  assert.match(md, /Publish normally/);
});

test("formatPublishReadinessMarkdown: red report includes blocking section", () => {
  const md = pr.formatPublishReadinessMarkdown({
    overall_verdict: "red",
    pillars: {
      security_blockers: {
        verdict: "red",
        reason: "token_log_pattern_re_introduced",
      },
    },
    blockers: ["security_blockers: token leak detected"],
    advisory: [],
    recently_improved: [],
    next_action: "Do not publish until red blockers cleared.",
    story_count: 1,
    generated_at: "2026-04-30T22:00:00Z",
  });
  assert.match(md, /🔴/);
  assert.match(md, /Blocking/);
  assert.match(md, /Do not publish/);
});

test("formatPublishReadinessMarkdown: amber report includes advisory section", () => {
  const md = pr.formatPublishReadinessMarkdown({
    overall_verdict: "amber",
    pillars: { tiktok: { verdict: "amber", reason: "externally_blocked" } },
    blockers: [],
    advisory: ["tiktok_external_block: externally_blocked"],
    recently_improved: [],
    next_action: "Publish possible. Watch advisory list.",
    story_count: 5,
    generated_at: "2026-04-30T22:00:00Z",
  });
  assert.match(md, /🟡/);
  assert.match(md, /Advisory/);
});

test("formatPublishReadinessMarkdown: unknown verdict surfaces in pillar list", () => {
  const md = pr.formatPublishReadinessMarkdown({
    overall_verdict: "amber",
    pillars: {
      queue_health: { verdict: "unknown", reason: "module_unavailable" },
    },
    blockers: [],
    advisory: ["queue_health: unknown"],
    recently_improved: [],
    next_action: "Publish possible.",
    story_count: 5,
    generated_at: "2026-04-30T22:00:00Z",
  });
  assert.match(md, /unknown/);
  assert.match(md, /⚪/);
});

// ── buildPublishReadinessReport with empty DB ────────────────────

test("formatPublishReadinessMarkdown: non-standard review verdict is printed as amber", () => {
  const md = pr.formatPublishReadinessMarkdown({
    overall_verdict: "amber",
    pillars: {
      media_verify: { verdict: "review", reason: "media_verify_review" },
    },
    blockers: [],
    advisory: ["media_verify: media_verify_review"],
    recently_improved: [],
    next_action: "Operator review required.",
    story_count: 5,
    generated_at: "2026-04-30T22:00:00Z",
  });

  assert.match(md, /media_verify: amber/);
  assert.doesNotMatch(md, /media_verify: review/);
});

test("buildPublishReadinessReport: empty store does not crash, returns at least one pillar", async () => {
  // We use a fake DB and let the real pillars run. They should
  // gracefully degrade to amber/unknown, never throw.
  const report = await pr.buildPublishReadinessReport({
    skipOperationalPillars: true,
    db: {
      async getStories() {
        return [];
      },
    },
    env: {},
  });
  assert.ok(typeof report.overall_verdict === "string");
  assert.ok(
    ["green", "amber", "red", "unknown"].includes(report.overall_verdict),
  );
  assert.equal(report.story_count, 0);
  assert.ok(typeof report.pillars === "object");
  assert.equal(Object.keys(report.pillars).length, 33);
  assert.ok(typeof report.next_action === "string");
});

test("pillarHumanReviewDecisionSheet: pending decisions stay amber with exact counts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-human-review-decision-sheet-pillar-"));
  const reportPath = path.join(dir, "human_review_decision_sheet.json");
  try {
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        generated_at: "2026-05-31T18:30:00.000Z",
        mode: "HUMAN_REVIEW_DECISION_SHEET",
        verdict: "AMBER",
        safe_to_publish_boolean: false,
        summary: {
          decision_slot_count: 13,
          pending_decision_count: 13,
          already_decided_count: 0,
          blocked_input_count: 0,
        },
        safe_publish_plan: {
          live_publish_allowed_from_this_tool: false,
          can_publish_without_operator: false,
          required_next_step: "record_operator_decisions_in_operator_decision_log",
          safety: {
            no_publish_triggered: true,
            no_network_uploads: true,
            no_db_mutation: true,
            no_oauth_or_token_change: true,
          },
        },
        safety: {
          no_publish_triggered: true,
          no_network_uploads: true,
          no_db_mutation: true,
          no_oauth_or_token_change: true,
        },
      }),
    );

    const pillar = pr.pillarHumanReviewDecisionSheet({
      reportPath,
      now: Date.parse("2026-05-31T18:35:00.000Z"),
    });

    assert.equal(pillar.verdict, "amber");
    assert.equal(pillar.reason, "13_operator_decisions_pending");
    assert.equal(pillar.raw.decision_slot_count, 13);
    assert.equal(pillar.raw.pending_decision_count, 13);
    assert.equal(pillar.raw.safety_intact, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pillarHumanReviewDecisionSheet: missing safety contract is red", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-human-review-decision-sheet-red-"));
  const reportPath = path.join(dir, "human_review_decision_sheet.json");
  try {
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        generated_at: "2026-05-31T18:30:00.000Z",
        mode: "HUMAN_REVIEW_DECISION_SHEET",
        verdict: "AMBER",
        safe_to_publish_boolean: false,
        summary: { decision_slot_count: 1, pending_decision_count: 1 },
        safe_publish_plan: {
          live_publish_allowed_from_this_tool: false,
          safety: {
            no_publish_triggered: true,
            no_network_uploads: false,
            no_db_mutation: true,
            no_oauth_or_token_change: true,
          },
        },
        safety: {
          no_publish_triggered: true,
          no_network_uploads: false,
          no_db_mutation: true,
          no_oauth_or_token_change: true,
        },
      }),
    );

    const pillar = pr.pillarHumanReviewDecisionSheet({
      reportPath,
      now: Date.parse("2026-05-31T18:35:00.000Z"),
    });

    assert.equal(pillar.verdict, "red");
    assert.equal(pillar.reason, "human_review_decision_sheet_safety_contract_missing");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pillarHumanReviewOperatorIndex: artefact-complete pending cards stay amber with counts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-human-review-index-pillar-"));
  const reportPath = path.join(dir, "human_review_operator_index.json");
  try {
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        generated_at: "2026-05-31T18:40:00.000Z",
        mode: "HUMAN_REVIEW_OPERATOR_INDEX",
        verdict: "AMBER",
        safe_to_publish_boolean: false,
        summary: {
          review_card_count: 13,
          pending_review_count: 13,
          ready_for_operator_review_count: 13,
          missing_artefact_card_count: 0,
          already_decided_count: 0,
          blocked_input_count: 0,
        },
        review_cards: [],
        safety: {
          no_publish_triggered: true,
          no_network_uploads: true,
          no_db_mutation: true,
          no_oauth_or_token_change: true,
        },
      }),
    );

    const pillar = pr.pillarHumanReviewOperatorIndex({
      reportPath,
      now: Date.parse("2026-05-31T18:45:00.000Z"),
    });

    assert.equal(pillar.verdict, "amber");
    assert.equal(pillar.reason, "13_operator_review_cards_ready");
    assert.equal(pillar.raw.review_card_count, 13);
    assert.equal(pillar.raw.ready_for_operator_review_count, 13);
    assert.equal(pillar.raw.missing_artefact_card_count, 0);
    assert.equal(pillar.raw.safety_intact, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pillarHumanReviewOperatorIndex: missing review artefacts remain amber but cannot approve", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-human-review-index-missing-"));
  const reportPath = path.join(dir, "human_review_operator_index.json");
  try {
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        generated_at: "2026-05-31T18:40:00.000Z",
        mode: "HUMAN_REVIEW_OPERATOR_INDEX",
        verdict: "AMBER",
        safe_to_publish_boolean: false,
        summary: {
          review_card_count: 2,
          pending_review_count: 2,
          ready_for_operator_review_count: 1,
          missing_artefact_card_count: 1,
          already_decided_count: 0,
          blocked_input_count: 0,
        },
        safety: {
          no_publish_triggered: true,
          no_network_uploads: true,
          no_db_mutation: true,
          no_oauth_or_token_change: true,
        },
      }),
    );

    const pillar = pr.pillarHumanReviewOperatorIndex({
      reportPath,
      now: Date.parse("2026-05-31T18:45:00.000Z"),
    });

    assert.equal(pillar.verdict, "amber");
    assert.equal(pillar.reason, "1_review_cards_missing_artefacts");
    assert.equal(pillar.raw.missing_artefact_card_count, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pillarHumanReviewConsole: actionable watch cards stay amber and point at the console", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-readiness-human-review-console-"));
  const reportPath = path.join(dir, "human_review_console.json");
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generated_at: "2026-05-31T22:00:00.000Z",
        verdict: "AMBER",
        safe_to_publish_boolean: false,
        summary: {
          card_count: 13,
          ready_card_count: 13,
          actionable_card_count: 13,
          missing_artefact_card_count: 0,
          blocked_input_count: 0,
        },
        next_step: "watch_console_cards_then_record_operator_decisions",
        safety: {
          no_publish_triggered: true,
          no_network_uploads: true,
          no_db_mutation: true,
          no_oauth_or_token_change: true,
          approval_omitted_from_console: true,
        },
      },
      null,
      2,
    ),
  );

  const pillar = pr.pillarHumanReviewConsole({
    reportPath,
    now: Date.parse("2026-05-31T22:10:00.000Z"),
  });

  assert.equal(pillar.verdict, "amber");
  assert.equal(pillar.reason, "13_human_review_console_cards_actionable");
  assert.equal(pillar.raw.actionable_card_count, 13);
  assert.equal(pillar.raw.safety_intact, true);

  const nextAction = pr.resolvePublishReadinessNextAction({
    overall: "amber",
    pillars: {
      human_review_console: pillar,
      human_review_operator_index: {
        verdict: "amber",
        raw: { ready_for_operator_review_count: 13 },
      },
      human_review_approval_gate: {
        verdict: "amber",
        raw: { review_packet_count: 13, decision_count: 0 },
      },
    },
  });
  assert.match(nextAction, /Open the human review console/);
  assert.match(nextAction, /13/);
  assert.match(nextAction, /does not publish or mutate tokens/);
});

test("pillarHumanReviewConsole: visual strip evidence is surfaced before operator decisions", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-readiness-human-review-strip-"));
  const reportPath = path.join(dir, "human_review_console.json");
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generated_at: "2026-05-31T22:00:00.000Z",
        verdict: "AMBER",
        safe_to_publish_boolean: false,
        summary: {
          card_count: 13,
          ready_card_count: 13,
          actionable_card_count: 13,
          missing_artefact_card_count: 0,
          blocked_input_count: 0,
        },
        safety: {
          no_publish_triggered: true,
          no_network_uploads: true,
          no_db_mutation: true,
          no_oauth_or_token_change: true,
          approval_omitted_from_console: true,
        },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(dir, "human_review_visual_strip_report.json"),
    JSON.stringify(
      {
        generated_at: "2026-05-31T22:05:00.000Z",
        verdict: "AMBER",
        safe_to_publish_boolean: false,
        summary: {
          card_count: 13,
          extracted_card_count: 13,
          failed_card_count: 0,
          extracted_frame_count: 52,
        },
        safety: {
          no_publish_triggered: true,
          no_network_uploads: true,
          no_db_mutation: true,
          no_oauth_or_token_change: true,
          approval_omitted_from_visual_strip: true,
        },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(dir, "human_review_visual_strip_qa_report.json"),
    JSON.stringify(
      {
        generated_at: "2026-05-31T22:06:00.000Z",
        verdict: "AMBER",
        safe_to_publish_boolean: false,
        summary: {
          card_count: 13,
          risk_card_count: 4,
          frame_warning_count: 7,
          red_card_count: 0,
          amber_card_count: 4,
        },
        visual_repair_work_order: {
          summary: {
            job_count: 4,
            ready_for_repair_count: 4,
          },
        },
        safety: {
          no_publish_triggered: true,
          no_network_uploads: true,
          no_db_mutation: true,
          no_oauth_or_token_change: true,
          approval_omitted_from_visual_strip_qa: true,
        },
      },
      null,
      2,
    ),
  );

  const pillar = pr.pillarHumanReviewConsole({
    reportPath,
    now: Date.parse("2026-05-31T22:10:00.000Z"),
  });

  assert.equal(pillar.raw.visual_strip.extracted_frame_count, 52);
  assert.equal(pillar.raw.visual_strip.safety_intact, true);
  assert.equal(pillar.raw.visual_strip_qa.risk_card_count, 4);
  assert.equal(pillar.raw.visual_strip_qa.frame_warning_count, 7);
  assert.equal(pillar.raw.visual_strip_qa.visual_repair_work_order_job_count, 4);
  assert.equal(pillar.raw.visual_strip_qa.safety_intact, true);

  const nextAction = pr.resolvePublishReadinessNextAction({
    overall: "amber",
    pillars: {
      human_review_console: pillar,
      human_review_operator_index: {
        verdict: "amber",
        raw: { ready_for_operator_review_count: 13 },
      },
      human_review_approval_gate: {
        verdict: "amber",
        raw: { review_packet_count: 13, decision_count: 0 },
      },
    },
  });

  assert.match(nextAction, /visual strip QA report/);
  assert.match(nextAction, /4 risky cards, 7 frame warnings/);
  assert.match(nextAction, /human_review_visual_repair_work_order\.md/);
  assert.match(nextAction, /human_review_visual_strip_qa_report\.html/);
  assert.match(nextAction, /human_review_visual_strip_report\.html/);
});

test("pillarHumanReviewConsole: stale visual strip evidence must be regenerated before operator review", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-readiness-human-review-stale-strip-"));
  const reportPath = path.join(dir, "human_review_console.json");
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generated_at: "2026-05-31T22:10:00.000Z",
        source_operator_index_dry_run_generated_at: "2026-05-31T22:09:00.000Z",
        source_strict_dry_run_generated_at: "2026-05-31T22:09:00.000Z",
        verdict: "AMBER",
        safe_to_publish_boolean: false,
        summary: {
          card_count: 13,
          ready_card_count: 13,
          actionable_card_count: 13,
          missing_artefact_card_count: 0,
          blocked_input_count: 0,
        },
        safety: {
          no_publish_triggered: true,
          no_network_uploads: true,
          no_db_mutation: true,
          no_oauth_or_token_change: true,
          approval_omitted_from_console: true,
        },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(dir, "human_review_visual_strip_report.json"),
    JSON.stringify(
      {
        generated_at: "2026-05-31T22:05:00.000Z",
        source_console_generated_at: "2026-05-31T22:00:00.000Z",
        source_console_dry_run_generated_at: "2026-05-31T22:00:00.000Z",
        source_strict_dry_run_generated_at: "2026-05-31T22:00:00.000Z",
        verdict: "AMBER",
        safe_to_publish_boolean: false,
        summary: {
          card_count: 13,
          extracted_card_count: 13,
          failed_card_count: 0,
          extracted_frame_count: 52,
        },
        safety: {
          no_publish_triggered: true,
          no_network_uploads: true,
          no_db_mutation: true,
          no_oauth_or_token_change: true,
          approval_omitted_from_visual_strip: true,
        },
      },
      null,
      2,
    ),
  );

  const pillar = pr.pillarHumanReviewConsole({
    reportPath,
    now: Date.parse("2026-05-31T22:12:00.000Z"),
  });

  assert.equal(pillar.verdict, "amber");
  assert.equal(pillar.reason, "human_review_visual_strip_stale_after_console");
  assert.equal(pillar.raw.visual_strip.stale, true);
  assert.equal(pillar.raw.visual_strip.stale_reason, "source_console_generated_at_older_than_console");

  const nextAction = pr.resolvePublishReadinessNextAction({
    overall: "amber",
    pillars: {
      human_review_console: pillar,
      human_review_operator_index: {
        verdict: "amber",
        raw: { ready_for_operator_review_count: 13 },
      },
      human_review_approval_gate: {
        verdict: "amber",
        raw: { review_packet_count: 13, decision_count: 0 },
      },
    },
  });

  assert.match(nextAction, /Regenerate the human review visual strip/);
  assert.doesNotMatch(nextAction, /Open the visual strip report at/);
});

test("pillarHumanReviewConsole: two-pass visual strip remains fresh when dry-run lineage matches", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-readiness-human-review-two-pass-strip-"));
  const reportPath = path.join(dir, "human_review_console.json");
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generated_at: "2026-05-31T22:10:00.000Z",
        source_operator_index_dry_run_generated_at: "2026-05-31T22:00:00.000Z",
        source_strict_dry_run_generated_at: "2026-05-31T22:00:00.000Z",
        verdict: "AMBER",
        safe_to_publish_boolean: false,
        summary: {
          card_count: 13,
          ready_card_count: 13,
          actionable_card_count: 13,
          missing_artefact_card_count: 0,
          blocked_input_count: 0,
        },
        safety: {
          no_publish_triggered: true,
          no_network_uploads: true,
          no_db_mutation: true,
          no_oauth_or_token_change: true,
          approval_omitted_from_console: true,
        },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(dir, "human_review_visual_strip_report.json"),
    JSON.stringify(
      {
        generated_at: "2026-05-31T22:05:00.000Z",
        source_console_generated_at: "2026-05-31T22:04:00.000Z",
        source_console_dry_run_generated_at: "2026-05-31T22:00:00.000Z",
        source_strict_dry_run_generated_at: "2026-05-31T22:00:00.000Z",
        verdict: "AMBER",
        safe_to_publish_boolean: false,
        summary: {
          card_count: 13,
          extracted_card_count: 13,
          failed_card_count: 0,
          extracted_frame_count: 52,
        },
        safety: {
          no_publish_triggered: true,
          no_network_uploads: true,
          no_db_mutation: true,
          no_oauth_or_token_change: true,
          approval_omitted_from_visual_strip: true,
        },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(dir, "human_review_visual_strip_qa_report.json"),
    JSON.stringify(
      {
        generated_at: "2026-05-31T22:06:00.000Z",
        source_visual_strip_generated_at: "2026-05-31T22:05:00.000Z",
        source_console_generated_at: "2026-05-31T22:04:00.000Z",
        source_console_dry_run_generated_at: "2026-05-31T22:00:00.000Z",
        source_strict_dry_run_generated_at: "2026-05-31T22:00:00.000Z",
        verdict: "GREEN",
        safe_to_publish_boolean: false,
        summary: {
          card_count: 13,
          risk_card_count: 0,
          frame_warning_count: 0,
          red_card_count: 0,
          amber_card_count: 0,
        },
        safety: {
          no_publish_triggered: true,
          no_network_uploads: true,
          no_db_mutation: true,
          no_oauth_or_token_change: true,
          approval_omitted_from_visual_strip_qa: true,
        },
      },
      null,
      2,
    ),
  );

  const pillar = pr.pillarHumanReviewConsole({
    reportPath,
    now: Date.parse("2026-05-31T22:12:00.000Z"),
  });

  assert.equal(pillar.verdict, "amber");
  assert.equal(pillar.reason, "13_human_review_console_cards_actionable");
  assert.equal(pillar.raw.visual_strip.stale, false);
  assert.equal(pillar.raw.visual_strip.stale_reason, null);
  assert.equal(pillar.raw.visual_strip_qa.stale, false);
});

test("pillarStrictDryRunControl: amber dry-run requires human review, not generic publish-possible wording", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-strict-dry-run-"));
  const planPath = path.join(dir, "dry_run_publish_plan.json");
  try {
    fs.writeFileSync(
      planPath,
      JSON.stringify({
        generated_at: "2026-05-28T05:55:00.000Z",
        overall_verdict: "AMBER",
        ready_for_unattended_publish: false,
        readiness_reasons: [
          "platform_actions_deferred_until_enabled",
          "stories_quarantined_or_operator_held",
        ],
        summary: {
          ready_story_count: 21,
          blocked_story_count: 0,
          held_story_count: 7,
          skipped_story_count: 2,
          platform_publish_now_action_count: 63,
          platform_deferred_action_count: 84,
          blocked_action_count: 0,
          warning_action_count: 0,
        },
        platform_upload_preflight_report: {
          summary: {
            disabled_platform_count: 4,
          },
        },
        safety: {
          no_publish_triggered: true,
          no_network_uploads: true,
          no_db_mutation: true,
          no_oauth_or_token_change: true,
          dry_run_only: true,
        },
      }),
    );

    const pillar = pr.pillarStrictDryRunControl({
      planPath,
      now: Date.parse("2026-05-28T06:00:00.000Z"),
    });

    assert.equal(pillar.verdict, "amber");
    assert.match(pillar.reason, /human_review_required/);
    assert.equal(pillar.raw.ready_story_count, 21);
    assert.equal(pillar.raw.disabled_platform_count, 4);

    const nextAction = pr.resolvePublishReadinessNextAction({
      overall: "amber",
      pillars: {
        publish_cadence: { verdict: "green" },
        strict_dry_run_control: pillar,
      },
    });

    assert.match(nextAction, /Do not publish unattended/);
    assert.match(nextAction, /HUMAN_REVIEW/);
    assert.doesNotMatch(nextAction, /Publish possible/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pillarHumanReviewApprovalGate: no recorded decisions stays amber and blocks guarded dispatch", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-human-review-approval-pillar-"));
  const reportPath = path.join(dir, "human_review_approval_gate_report.json");
  try {
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        generated_at: "2026-05-31T18:00:00.000Z",
        mode: "HUMAN_REVIEW_APPROVAL_GATE",
        verdict: "AMBER",
        safe_to_publish_boolean: false,
        summary: {
          review_packet_count: 13,
          decision_count: 0,
          approved_story_count: 0,
          approved_action_count: 0,
          pending_review_packet_count: 13,
          invalid_decision_count: 0,
        },
        advisory: [
          "no_recorded_operator_decisions",
          "review_packets_still_pending_operator_decision",
        ],
        safe_publish_plan: {
          guarded_dispatch_eligible: false,
          live_publish_allowed_from_this_tool: false,
          required_next_step: "record_operator_decisions_before_guarded_dispatch",
          safety: {
            no_publish_triggered: true,
            no_network_uploads: true,
            no_db_mutation: true,
            no_oauth_or_token_change: true,
          },
        },
        safety: {
          no_publish_triggered: true,
          no_network_uploads: true,
          no_db_mutation: true,
          no_oauth_or_token_change: true,
        },
      }),
    );

    const pillar = pr.pillarHumanReviewApprovalGate({
      reportPath,
      now: Date.parse("2026-05-31T18:05:00.000Z"),
    });

    assert.equal(pillar.verdict, "amber");
    assert.equal(pillar.reason, "no_recorded_operator_decisions");
    assert.equal(pillar.raw.review_packet_count, 13);
    assert.equal(pillar.raw.approved_action_count, 0);
    assert.equal(pillar.raw.guarded_dispatch_eligible, false);

    const nextAction = pr.resolvePublishReadinessNextAction({
      overall: "amber",
      pillars: {
        publish_cadence: { verdict: "green" },
        final_voice_audit: { verdict: "green" },
        strict_dry_run_control: {
          verdict: "amber",
          raw: {
            ready_story_count: 13,
            ready_for_unattended_publish: false,
          },
        },
        human_review_approval_gate: pillar,
      },
    });

    assert.match(nextAction, /Record operator decisions/);
    assert.match(nextAction, /does not publish or mutate tokens/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pillarHumanReviewApprovalGate: invalid decisions are red", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-human-review-approval-red-"));
  const reportPath = path.join(dir, "human_review_approval_gate_report.json");
  try {
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        generated_at: "2026-05-31T18:00:00.000Z",
        mode: "HUMAN_REVIEW_APPROVAL_GATE",
        verdict: "RED",
        safe_to_publish_boolean: false,
        summary: {
          review_packet_count: 1,
          decision_count: 1,
          approved_action_count: 0,
          pending_review_packet_count: 0,
          invalid_decision_count: 1,
        },
        safe_publish_plan: {
          guarded_dispatch_eligible: false,
          live_publish_allowed_from_this_tool: false,
          safety: {
            no_publish_triggered: true,
            no_network_uploads: true,
            no_db_mutation: true,
            no_oauth_or_token_change: true,
          },
        },
        safety: {
          no_publish_triggered: true,
          no_network_uploads: true,
          no_db_mutation: true,
          no_oauth_or_token_change: true,
        },
      }),
    );

    const pillar = pr.pillarHumanReviewApprovalGate({
      reportPath,
      now: Date.parse("2026-05-31T18:05:00.000Z"),
    });

    assert.equal(pillar.verdict, "red");
    assert.equal(pillar.reason, "human_review_approval_gate_invalid_decisions");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pillarGuardedDispatchPreflight: no approved actions stays amber and cannot dispatch", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-guarded-dispatch-pillar-empty-"));
  const reportPath = path.join(dir, "guarded_dispatch_preflight_report.json");
  try {
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        generated_at: "2026-05-31T18:00:00.000Z",
        mode: "GUARDED_DISPATCH_PREFLIGHT",
        verdict: "AMBER",
        safe_to_publish_boolean: false,
        summary: {
          approved_action_count: 0,
          dispatch_ready_action_count: 0,
          blocked_action_count: 0,
          safety_blocker_count: 0,
        },
        advisory: ["no_operator_approved_actions"],
        guarded_dispatch_plan: {
          ready_for_guarded_dispatch: false,
          live_publish_allowed_from_this_tool: false,
          required_next_step: "record_operator_approved_actions_before_guarded_dispatch",
          safety: {
            no_publish_triggered: true,
            no_network_uploads: true,
            no_db_mutation: true,
            no_oauth_or_token_change: true,
          },
        },
        safety: {
          no_publish_triggered: true,
          no_network_uploads: true,
          no_db_mutation: true,
          no_oauth_or_token_change: true,
        },
      }),
    );

    const pillar = pr.pillarGuardedDispatchPreflight({
      reportPath,
      now: Date.parse("2026-05-31T18:05:00.000Z"),
    });

    assert.equal(pillar.verdict, "amber");
    assert.equal(pillar.reason, "no_operator_approved_actions");
    assert.equal(pillar.raw.ready_for_guarded_dispatch, false);
    assert.equal(pillar.raw.dispatch_ready_action_count, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pillarGuardedDispatchPreflight: stale or mismatched approved actions are red", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-guarded-dispatch-pillar-red-"));
  const reportPath = path.join(dir, "guarded_dispatch_preflight_report.json");
  try {
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        generated_at: "2026-05-31T18:00:00.000Z",
        mode: "GUARDED_DISPATCH_PREFLIGHT",
        verdict: "RED",
        safe_to_publish_boolean: false,
        summary: {
          approved_action_count: 1,
          dispatch_ready_action_count: 0,
          blocked_action_count: 1,
          safety_blocker_count: 0,
        },
        guarded_dispatch_plan: {
          ready_for_guarded_dispatch: false,
          live_publish_allowed_from_this_tool: false,
          safety: {
            no_publish_triggered: true,
            no_network_uploads: true,
            no_db_mutation: true,
            no_oauth_or_token_change: true,
          },
        },
        safety: {
          no_publish_triggered: true,
          no_network_uploads: true,
          no_db_mutation: true,
          no_oauth_or_token_change: true,
        },
      }),
    );

    const pillar = pr.pillarGuardedDispatchPreflight({
      reportPath,
      now: Date.parse("2026-05-31T18:05:00.000Z"),
    });

    assert.equal(pillar.verdict, "red");
    assert.equal(pillar.reason, "guarded_dispatch_preflight_blocked");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pillarGuardedDispatchPreflight: dispatch-ready approved actions are green", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-guarded-dispatch-pillar-green-"));
  const reportPath = path.join(dir, "guarded_dispatch_preflight_report.json");
  try {
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        generated_at: "2026-05-31T18:00:00.000Z",
        mode: "GUARDED_DISPATCH_PREFLIGHT",
        verdict: "GREEN",
        safe_to_publish_boolean: false,
        summary: {
          approved_action_count: 2,
          dispatch_ready_action_count: 2,
          blocked_action_count: 0,
          safety_blocker_count: 0,
        },
        guarded_dispatch_plan: {
          ready_for_guarded_dispatch: true,
          live_publish_allowed_from_this_tool: false,
          safety: {
            no_publish_triggered: true,
            no_network_uploads: true,
            no_db_mutation: true,
            no_oauth_or_token_change: true,
          },
        },
        safety: {
          no_publish_triggered: true,
          no_network_uploads: true,
          no_db_mutation: true,
          no_oauth_or_token_change: true,
        },
      }),
    );

    const pillar = pr.pillarGuardedDispatchPreflight({
      reportPath,
      now: Date.parse("2026-05-31T18:05:00.000Z"),
    });

    assert.equal(pillar.verdict, "green");
    assert.equal(pillar.raw.dispatch_ready_action_count, 2);
    assert.equal(pillar.raw.ready_for_guarded_dispatch, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pillarGuardedDispatchExecutorPreflight: ready actions require explicit selection before handoff", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-guarded-executor-pillar-amber-"));
  const reportPath = path.join(dir, "guarded_dispatch_executor_preflight_report.json");
  try {
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        generated_at: "2026-05-31T18:00:00.000Z",
        mode: "GUARDED_DISPATCH_EXECUTOR_PREFLIGHT",
        verdict: "AMBER",
        safe_to_publish_boolean: false,
        summary: {
          dispatch_ready_action_count: 2,
          selected_action_count: 0,
          handoff_ready_action_count: 0,
          blocked_selected_action_count: 0,
        },
        advisory: ["explicit_action_ids_required"],
        executor_plan: {
          ready_for_live_executor_handoff: false,
          live_publish_allowed_from_this_tool: false,
          required_next_step: "select_explicit_dispatch_action_ids",
          safety: {
            no_publish_triggered: true,
            no_network_uploads: true,
            no_db_mutation: true,
            no_oauth_or_token_change: true,
          },
        },
        safety: {
          no_publish_triggered: true,
          no_network_uploads: true,
          no_db_mutation: true,
          no_oauth_or_token_change: true,
        },
      }),
    );

    const pillar = pr.pillarGuardedDispatchExecutorPreflight({
      reportPath,
      now: Date.parse("2026-05-31T18:05:00.000Z"),
    });

    assert.equal(pillar.verdict, "amber");
    assert.equal(pillar.reason, "explicit_action_ids_required");
    assert.equal(pillar.raw.ready_for_live_executor_handoff, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pillarGuardedDispatchExecutorPreflight: blocked selected actions are red", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-guarded-executor-pillar-red-"));
  const reportPath = path.join(dir, "guarded_dispatch_executor_preflight_report.json");
  try {
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        generated_at: "2026-05-31T18:00:00.000Z",
        mode: "GUARDED_DISPATCH_EXECUTOR_PREFLIGHT",
        verdict: "RED",
        safe_to_publish_boolean: false,
        summary: {
          dispatch_ready_action_count: 1,
          selected_action_count: 1,
          handoff_ready_action_count: 0,
          blocked_selected_action_count: 1,
        },
        executor_plan: {
          ready_for_live_executor_handoff: false,
          live_publish_allowed_from_this_tool: false,
          safety: {
            no_publish_triggered: true,
            no_network_uploads: true,
            no_db_mutation: true,
            no_oauth_or_token_change: true,
          },
        },
        safety: {
          no_publish_triggered: true,
          no_network_uploads: true,
          no_db_mutation: true,
          no_oauth_or_token_change: true,
        },
      }),
    );

    const pillar = pr.pillarGuardedDispatchExecutorPreflight({
      reportPath,
      now: Date.parse("2026-05-31T18:05:00.000Z"),
    });

    assert.equal(pillar.verdict, "red");
    assert.equal(pillar.reason, "guarded_dispatch_executor_preflight_blocked");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pillarGuardedDispatchExecutorPreflight: handoff-ready selected actions are green but not publish authority", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-guarded-executor-pillar-green-"));
  const reportPath = path.join(dir, "guarded_dispatch_executor_preflight_report.json");
  try {
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        generated_at: "2026-05-31T18:00:00.000Z",
        mode: "GUARDED_DISPATCH_EXECUTOR_PREFLIGHT",
        verdict: "GREEN",
        safe_to_publish_boolean: false,
        summary: {
          dispatch_ready_action_count: 1,
          selected_action_count: 1,
          handoff_ready_action_count: 1,
          blocked_selected_action_count: 0,
        },
        executor_plan: {
          ready_for_live_executor_handoff: true,
          live_publish_allowed_from_this_tool: false,
          safety: {
            no_publish_triggered: true,
            no_network_uploads: true,
            no_db_mutation: true,
            no_oauth_or_token_change: true,
          },
        },
        safety: {
          no_publish_triggered: true,
          no_network_uploads: true,
          no_db_mutation: true,
          no_oauth_or_token_change: true,
        },
      }),
    );

    const pillar = pr.pillarGuardedDispatchExecutorPreflight({
      reportPath,
      now: Date.parse("2026-05-31T18:05:00.000Z"),
    });

    assert.equal(pillar.verdict, "green");
    assert.equal(pillar.raw.handoff_ready_action_count, 1);
    assert.equal(pillar.raw.live_publish_allowed_from_this_tool, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolvePublishReadinessNextAction: repairable backlog takes priority over expanding cadence", () => {
  const nextAction = pr.resolvePublishReadinessNextAction({
    overall: "amber",
    pillars: {
      publish_cadence: { verdict: "green" },
      strict_dry_run_control: {
        verdict: "amber",
        raw: {
          ready_story_count: 12,
          ready_for_unattended_publish: false,
        },
      },
      repair_backlog: {
        verdict: "amber",
        raw: {
          total_items: 66,
          auto_repairable_items: 66,
        },
      },
    },
  });

  assert.match(nextAction, /auto-repair backlog/);
  assert.match(nextAction, /66 repairable/);
  assert.match(nextAction, /Do not publish unattended/);
});

test("pillarStrictDryRunControl: red when strict dry-run has active blockers", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-strict-dry-run-red-"));
  const planPath = path.join(dir, "dry_run_publish_plan.json");
  try {
    fs.writeFileSync(
      planPath,
      JSON.stringify({
        generated_at: "2026-05-28T05:55:00.000Z",
        overall_verdict: "RED",
        ready_for_unattended_publish: false,
        summary: {
          ready_story_count: 20,
          blocked_story_count: 1,
          held_story_count: 7,
          skipped_story_count: 2,
          platform_publish_now_action_count: 60,
          platform_deferred_action_count: 84,
          blocked_action_count: 1,
          warning_action_count: 0,
        },
        safety: {
          no_publish_triggered: true,
          no_network_uploads: true,
          no_db_mutation: true,
          no_oauth_or_token_change: true,
          dry_run_only: true,
        },
      }),
    );

    const pillar = pr.pillarStrictDryRunControl({
      planPath,
      now: Date.parse("2026-05-28T06:00:00.000Z"),
    });

    assert.equal(pillar.verdict, "red");
    assert.match(pillar.reason, /strict_dry_run_blocked/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pillarStrictDryRunControl: amber when only non-review platform variants are blocked", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-strict-dry-run-review-platform-only-"));
  const planPath = path.join(dir, "dry_run_publish_plan.json");
  try {
    fs.writeFileSync(
      planPath,
      JSON.stringify({
        generated_at: "2026-05-31T22:00:00.000Z",
        overall_verdict: "RED",
        ready_for_unattended_publish: false,
        summary: {
          ready_story_count: 13,
          blocked_story_count: 0,
          held_story_count: 0,
          skipped_story_count: 17,
          platform_publish_now_action_count: 29,
          platform_deferred_action_count: 39,
          human_review_required_action_count: 29,
          live_publish_allowed_action_count: 0,
          blocked_action_count: 2,
          warning_action_count: 0,
        },
        actions: [
          {
            story_id: "story-one",
            platform: "youtube_shorts",
            action: "would_publish",
            platform_enabled: true,
            blockers: [],
            live_execution_gate: "human_review_required",
          },
        ],
        blocked_actions: [
          {
            story_id: "story-one",
            platform: "tiktok",
            action: "blocked",
            blockers: ["platform_variant_stale_after_render:tiktok"],
            live_execution_gate: "blocked",
            live_publish_allowed_from_dry_run: false,
          },
          {
            story_id: "story-one",
            platform: "instagram_reels",
            action: "blocked",
            blockers: ["platform_variant_stale_after_render:instagram_reels"],
            live_execution_gate: "blocked",
            live_publish_allowed_from_dry_run: false,
          },
        ],
        safety: {
          no_publish_triggered: true,
          no_network_uploads: true,
          no_db_mutation: true,
          no_oauth_or_token_change: true,
          dry_run_only: true,
        },
      }),
    );

    const pillar = pr.pillarStrictDryRunControl({
      planPath,
      now: Date.parse("2026-05-31T22:05:00.000Z"),
    });

    assert.equal(pillar.verdict, "amber");
    assert.equal(pillar.ok, true);
    assert.equal(pillar.reason, "human_review_ready_with_platform_variant_blockers");
    assert.equal(pillar.raw.live_publish_allowed_action_count, 0);
    assert.deepEqual(pillar.raw.blocked_action_reason_groups, [
      { reason: "platform_variant_stale_after_render:instagram_reels", count: 1 },
      { reason: "platform_variant_stale_after_render:tiktok", count: 1 },
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pillarStrictDryRunControl: red when blocked actions include final render inputs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-strict-dry-run-final-render-red-"));
  const planPath = path.join(dir, "dry_run_publish_plan.json");
  try {
    fs.writeFileSync(
      planPath,
      JSON.stringify({
        generated_at: "2026-05-31T22:00:00.000Z",
        overall_verdict: "RED",
        ready_for_unattended_publish: false,
        summary: {
          ready_story_count: 12,
          blocked_story_count: 0,
          platform_publish_now_action_count: 24,
          human_review_required_action_count: 24,
          live_publish_allowed_action_count: 0,
          blocked_action_count: 1,
        },
        actions: [
          {
            story_id: "story-one",
            platform: "youtube_shorts",
            action: "would_publish",
            platform_enabled: true,
            blockers: [],
          },
        ],
        blocked_actions: [
          {
            story_id: "story-two",
            platform: "youtube_shorts",
            action: "blocked",
            blockers: ["final_render_input:missing_mp4"],
            live_execution_gate: "blocked",
            live_publish_allowed_from_dry_run: false,
          },
        ],
        safety: {
          no_publish_triggered: true,
          no_network_uploads: true,
          no_db_mutation: true,
          no_oauth_or_token_change: true,
          dry_run_only: true,
        },
      }),
    );

    const pillar = pr.pillarStrictDryRunControl({
      planPath,
      now: Date.parse("2026-05-31T22:05:00.000Z"),
    });

    assert.equal(pillar.verdict, "red");
    assert.match(pillar.reason, /strict_dry_run_blocked/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pillarRepairBacklog: amber when generated repair work remains", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-repair-backlog-"));
  const backlogPath = path.join(dir, "repair_backlog.json");
  try {
    fs.writeFileSync(
      backlogPath,
      JSON.stringify({
        generated_at: "2026-05-31T10:00:00.000Z",
        summary: {
          total_items: 3,
          auto_repairable_items: 2,
          operator_required_items: 1,
          dead_end_items: 0,
          lane_counts: {
            audio_regeneration: 2,
            rights_ledger_repair: 1,
          },
        },
        items: [
          {
            story_id: "audio-one",
            repair_lane: "audio_regeneration",
            auto_repairable: true,
          },
          {
            story_id: "audio-two",
            repair_lane: "audio_regeneration",
            auto_repairable: true,
          },
          {
            story_id: "rights-one",
            repair_lane: "rights_ledger_repair",
            operator_approval_required: true,
          },
        ],
      }),
    );

    const pillar = pr.pillarRepairBacklog({
      repairBacklogPath: backlogPath,
      now: Date.parse("2026-05-31T10:30:00.000Z"),
    });

    assert.equal(pillar.verdict, "amber");
    assert.match(pillar.reason, /3_open_repair_items/);
    assert.equal(pillar.raw.auto_repairable_items, 2);
    assert.equal(pillar.raw.operator_required_items, 1);
    assert.deepEqual(pillar.raw.top_lanes[0], {
      lane: "audio_regeneration",
      count: 2,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pillarRepairBacklog: green when render repair work is superseded by clean current evidence", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-repair-backlog-superseded-"));
  const backlogPath = path.join(dir, "repair_backlog.json");
  const planPath = path.join(dir, "dry_run_publish_plan.json");
  const productionRenderReportPath = path.join(dir, "production_render_materialization_report.json");
  try {
    fs.writeFileSync(
      backlogPath,
      JSON.stringify({
        generated_at: "2026-05-31T10:00:00.000Z",
        summary: {
          total_items: 2,
          auto_repairable_items: 2,
          operator_required_items: 0,
          dead_end_items: 0,
          lane_counts: {
            visual_v4_production_render: 2,
          },
        },
        items: [
          {
            story_id: "ready-one",
            repair_lane: "visual_v4_production_render",
            blocker_type: "run_visual_v4_production_render",
            auto_repairable: true,
          },
          {
            story_id: "ready-two",
            repair_lane: "visual_v4_production_render",
            blocker_type: "run_visual_v4_production_render",
            auto_repairable: true,
          },
        ],
      }),
    );
    fs.writeFileSync(
      productionRenderReportPath,
      JSON.stringify({
        generated_at: "2026-05-31T10:10:00.000Z",
        source_work_order_generated_at: "2026-05-31T10:00:00.000Z",
        summary: {
          candidate_count: 2,
          rendered_count: 2,
          failed_count: 0,
          skipped_existing_count: 0,
        },
        safety: {
          no_publish_triggered: true,
          no_network_uploads: true,
          no_db_mutation: true,
          no_oauth_or_token_change: true,
          no_gate_weakened: true,
        },
        jobs: [
          { story_id: "ready-one", status: "rendered" },
          { story_id: "ready-two", status: "rendered" },
        ],
      }),
    );
    fs.writeFileSync(
      planPath,
      JSON.stringify({
        generated_at: "2026-05-31T10:20:00.000Z",
        overall_verdict: "AMBER",
        ready_for_unattended_publish: false,
        summary: {
          ready_story_count: 2,
          blocked_story_count: 0,
          blocked_action_count: 0,
          held_story_count: 0,
          skipped_story_count: 0,
        },
        safety: {
          no_publish_triggered: true,
          no_network_uploads: true,
          no_db_mutation: true,
          no_oauth_or_token_change: true,
          dry_run_only: true,
        },
      }),
    );

    const pillar = pr.pillarRepairBacklog({
      repairBacklogPath: backlogPath,
      strictDryRunPlanPath: planPath,
      productionRenderReportPath,
      now: Date.parse("2026-05-31T10:30:00.000Z"),
    });

    assert.equal(pillar.verdict, "green");
    assert.equal(pillar.raw.readiness_scope, "superseded_by_clean_strict_dry_run");
    assert.equal(pillar.raw.active_publish_blocker_items, 0);
    assert.equal(pillar.raw.superseded_repair_items, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pillarRepairBacklog: green only when the generated backlog is empty", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-repair-backlog-empty-"));
  const backlogPath = path.join(dir, "repair_backlog.json");
  try {
    fs.writeFileSync(
      backlogPath,
      JSON.stringify({
        generated_at: "2026-05-31T10:00:00.000Z",
        summary: {
          total_items: 0,
          auto_repairable_items: 0,
          operator_required_items: 0,
          dead_end_items: 0,
          lane_counts: {},
        },
        items: [],
      }),
    );

    const pillar = pr.pillarRepairBacklog({
      repairBacklogPath: backlogPath,
      now: Date.parse("2026-05-31T10:30:00.000Z"),
    });

    assert.equal(pillar.verdict, "green");
    assert.equal(pillar.reason, undefined);
    assert.equal(pillar.raw.total_items, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pillarRepairBacklog: quarantined dead-end debt is amber when strict dry-run has clean active candidates", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-repair-backlog-quarantined-"));
  const backlogPath = path.join(dir, "repair_backlog.json");
  const planPath = path.join(dir, "dry_run_publish_plan.json");
  try {
    fs.writeFileSync(
      backlogPath,
      JSON.stringify({
        generated_at: "2026-05-31T10:00:00.000Z",
        summary: {
          total_items: 2,
          auto_repairable_items: 0,
          operator_required_items: 2,
          dead_end_blocker_items: 1,
          publish_blocker_resolution_items: 0,
          lane_counts: {
            reject_or_human_review_non_news_image_post: 1,
            official_direct_media_search_after_generated_only_benchmark_failure: 1,
          },
        },
        items: [
          {
            story_id: "bad-image-post",
            repair_lane: "reject_or_human_review_non_news_image_post",
            operator_approval_required: true,
            dead_end_blocker: true,
          },
          {
            story_id: "generated-only",
            repair_lane: "official_direct_media_search_after_generated_only_benchmark_failure",
            operator_approval_required: true,
          },
        ],
      }),
    );
    fs.writeFileSync(
      planPath,
      JSON.stringify({
        generated_at: "2026-05-31T10:05:00.000Z",
        overall_verdict: "AMBER",
        ready_for_unattended_publish: false,
        summary: {
          ready_story_count: 13,
          blocked_story_count: 0,
          blocked_action_count: 0,
          held_story_count: 0,
          skipped_story_count: 17,
          quarantined_incident_guard_failed_story_count: 17,
        },
        safety: {
          no_publish_triggered: true,
          no_network_uploads: true,
          no_db_mutation: true,
          no_oauth_or_token_change: true,
          dry_run_only: true,
        },
      }),
    );

    const pillar = pr.pillarRepairBacklog({
      repairBacklogPath: backlogPath,
      strictDryRunPlanPath: planPath,
      now: Date.parse("2026-05-31T10:30:00.000Z"),
    });

    assert.equal(pillar.verdict, "amber");
    assert.match(pillar.reason, /quarantined_debt/);
    assert.equal(pillar.raw.readiness_scope, "quarantined_debt");
    assert.equal(pillar.raw.active_publish_blocker_items, 0);
    assert.equal(pillar.raw.dead_end_items, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pillarRepairBacklog: dead-end debt stays red without clean strict dry-run evidence", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-repair-backlog-active-red-"));
  const backlogPath = path.join(dir, "repair_backlog.json");
  const planPath = path.join(dir, "dry_run_publish_plan.json");
  try {
    fs.writeFileSync(
      backlogPath,
      JSON.stringify({
        generated_at: "2026-05-31T10:00:00.000Z",
        summary: {
          total_items: 1,
          auto_repairable_items: 0,
          operator_required_items: 1,
          dead_end_blocker_items: 1,
          publish_blocker_resolution_items: 0,
        },
        items: [
          {
            story_id: "bad-image-post",
            repair_lane: "reject_or_human_review_non_news_image_post",
            operator_approval_required: true,
            dead_end_blocker: true,
          },
        ],
      }),
    );
    fs.writeFileSync(
      planPath,
      JSON.stringify({
        generated_at: "2026-05-31T10:05:00.000Z",
        overall_verdict: "RED",
        summary: {
          ready_story_count: 13,
          blocked_story_count: 1,
          blocked_action_count: 0,
        },
        safety: {
          no_publish_triggered: true,
          no_network_uploads: true,
          no_db_mutation: true,
          no_oauth_or_token_change: true,
          dry_run_only: true,
        },
      }),
    );

    const pillar = pr.pillarRepairBacklog({
      repairBacklogPath: backlogPath,
      strictDryRunPlanPath: planPath,
      now: Date.parse("2026-05-31T10:30:00.000Z"),
    });

    assert.equal(pillar.verdict, "red");
    assert.notEqual(pillar.raw.readiness_scope, "quarantined_debt");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pillarPlatformDurationContract: labels active and quarantined duration debt separately", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-platform-duration-readiness-"));
  const reportPath = path.join(dir, "platform_duration_contract_report.json");
  try {
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        generated_at: "2026-05-31T10:00:00.000Z",
        summary: {
          package_count: 3,
          blocked_count: 1,
          active_variant_repair_required_count: 0,
          quarantined_variant_repair_required_count: 0,
          active_tiktok_creator_rewards_variant_required_count: 0,
          quarantined_tiktok_creator_rewards_variant_required_count: 2,
        },
        blocked: [
          {
            story_id: "old-story",
            readiness_scope: "quarantined",
            blockers: ["missing_render_duration"],
          },
        ],
        tiktok_creator_rewards_variant_work_order: {
          jobs: [
            { story_id: "old-one", readiness_scope: "quarantined" },
            { story_id: "old-two", readiness_scope: "quarantined" },
          ],
        },
        safety: {
          no_publish_triggered: true,
          no_network_uploads: true,
          no_db_mutation: true,
          no_oauth_or_token_change: true,
        },
      }),
    );

    const pillar = pr.pillarPlatformDurationContract({
      reportPath,
      now: Date.parse("2026-05-31T10:30:00.000Z"),
    });

    assert.equal(pillar.verdict, "green");
    assert.match(pillar.reason, /active_duration_clean/);
    assert.match(pillar.reason, /quarantined_blocked=1/);
    assert.match(pillar.reason, /quarantined_tiktok_creator_rewards_variants=2/);
    assert.equal(pillar.raw.active_blocked_count, 0);
    assert.equal(pillar.raw.quarantined_blocked_count, 1);
    assert.equal(pillar.raw.active_tiktok_creator_rewards_variant_required_count, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pillarPlatformDurationContract: active duration blockers are red", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-platform-duration-active-red-"));
  const reportPath = path.join(dir, "platform_duration_contract_report.json");
  try {
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        generated_at: "2026-05-31T10:00:00.000Z",
        summary: {
          package_count: 1,
          blocked_count: 1,
          active_variant_repair_required_count: 0,
          active_tiktok_creator_rewards_variant_required_count: 0,
        },
        blocked: [
          {
            story_id: "active-story",
            readiness_scope: "active",
            blockers: ["missing_render_duration"],
          },
        ],
        safety: {
          no_publish_triggered: true,
          no_network_uploads: true,
          no_db_mutation: true,
          no_oauth_or_token_change: true,
        },
      }),
    );

    const pillar = pr.pillarPlatformDurationContract({
      reportPath,
      now: Date.parse("2026-05-31T10:30:00.000Z"),
    });

    assert.equal(pillar.verdict, "red");
    assert.match(pillar.reason, /active_duration_blockers=1/);
    assert.equal(pillar.raw.active_blocked_count, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pillarFinalVoiceAudit: active clean voice rows stay green while quarantined debt remains visible", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-final-voice-active-green-"));
  const auditPath = path.join(dir, "final_voice_audit.json");
  const manifestPath = path.join(dir, "local_test_video_manifest.json");
  const activeVideo = path.join(dir, "active", "visual_v4_render.mp4");
  const oldVideo = path.join(dir, "old", "visual_v4_render.mp4");
  try {
    fs.mkdirSync(path.dirname(activeVideo), { recursive: true });
    fs.mkdirSync(path.dirname(oldVideo), { recursive: true });
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        videos: [{ story_id: "active-story", video_path: activeVideo }],
      }),
    );
    fs.writeFileSync(
      auditPath,
      JSON.stringify({
        generated_at: "2026-05-31T10:00:00.000Z",
        rows: [
          {
            story_id: "active-story",
            mp4_path: activeVideo,
            verdict: "pass",
            blockers: [],
            warnings: [],
          },
          {
            story_id: "old-story",
            mp4_path: oldVideo,
            verdict: "review",
            blockers: ["approved_voice_metadata_missing"],
            warnings: [],
          },
        ],
        safety: {
          read_only: true,
          mutates_media: false,
          mutates_production_db: false,
          mutates_tokens: false,
          posts_to_platforms: false,
        },
      }),
    );

    const pillar = pr.pillarFinalVoiceAudit({
      auditPath,
      localTestManifestPath: manifestPath,
      now: Date.parse("2026-05-31T10:30:00.000Z"),
    });

    assert.equal(pillar.verdict, "green");
    assert.match(pillar.reason, /active_voice_clean/);
    assert.match(pillar.reason, /quarantined_review=1/);
    assert.equal(pillar.raw.active_pass_count, 1);
    assert.equal(pillar.raw.quarantined_review_count, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pillarFinalVoiceAudit: active voice reject is red", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-final-voice-active-red-"));
  const auditPath = path.join(dir, "final_voice_audit.json");
  const manifestPath = path.join(dir, "local_test_video_manifest.json");
  const activeVideo = path.join(dir, "active", "visual_v4_render.mp4");
  try {
    fs.mkdirSync(path.dirname(activeVideo), { recursive: true });
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        videos: [{ story_id: "active-story", video_path: activeVideo }],
      }),
    );
    fs.writeFileSync(
      auditPath,
      JSON.stringify({
        generated_at: "2026-05-31T10:00:00.000Z",
        rows: [
          {
            story_id: "active-story",
            mp4_path: activeVideo,
            verdict: "reject",
            blockers: ["local_tts_voice_reference_unverified"],
            warnings: [],
          },
        ],
        safety: {
          read_only: true,
          mutates_media: false,
          mutates_production_db: false,
          mutates_tokens: false,
          posts_to_platforms: false,
        },
      }),
    );

    const pillar = pr.pillarFinalVoiceAudit({
      auditPath,
      localTestManifestPath: manifestPath,
      now: Date.parse("2026-05-31T10:30:00.000Z"),
    });

    assert.equal(pillar.verdict, "red");
    assert.match(pillar.reason, /active_voice_reject=1/);
    assert.equal(pillar.raw.active_reject_count, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pillarPublishCadence: over-cap cadence tells operators to hold manual publishing", async () => {
  const now = Date.parse("2026-05-15T12:00:00.000Z");
  const stories = [0, 1, 2, 3].map((index) => ({
    id: `rss_${index}`,
    title: `Story ${index}`,
    youtube_post_id: `yt_${index}`,
    published_at: new Date(now - index * 60 * 60 * 1000).toISOString(),
  }));

  const pillar = pr.pillarPublishCadence({
    stories,
    now,
    env: {
      AUTO_PUBLISH: "true",
      PULSE_PRIMARY_INSTANCE: "true",
      USE_JOB_QUEUE: "true",
    },
  });

  assert.equal(pillar.verdict, "amber");
  assert.match(pillar.reason, /4_posts_in_24h_over_cap_3/);
});

test("pillarFacebookReelEligibility: graph proof makes Facebook Reels green", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-fb-reels-proof-"));
  const proofPath = path.join(dir, "facebook_reels_eligibility.json");
  try {
    fs.writeFileSync(
      proofPath,
      JSON.stringify({
        evidence: {
          page: { data: { can_post: true } },
          tokenDebug: { data: { is_valid: true } },
          videos: { count: 1 },
          reels: { count: 1 },
        },
        classification: {
          verdict: "eligible_for_normal_publish",
          reason: "visible_graph_video_or_reel_found",
        },
      }),
    );

    const pillar = pr.pillarFacebookReelEligibility({
      evidencePath: proofPath,
    });

    assert.equal(pillar.verdict, "green");
    assert.equal(pillar.raw.mode, "graph_verified");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("buildPublishReadinessReport: db throw degrades gracefully (no throw)", async () => {
  const report = await pr.buildPublishReadinessReport({
    skipOperationalPillars: true,
    db: {
      async getStories() {
        throw new Error("db down");
      },
    },
    env: {},
  });
  assert.ok(typeof report.overall_verdict === "string");
  assert.equal(report.story_count, 0);
});

test("buildPublishReadinessReport: stale recent publish amber has an operator-readable reason", async () => {
  const report = await pr.buildPublishReadinessReport({
    skipOperationalPillars: true,
    now: Date.parse("2026-06-01T12:00:00.000Z"),
    db: {
      async getStories() {
        return [
          {
            id: "stale-video",
            title: "Stale Published Story",
            youtube_post_id: "yt_stale",
            published_at: "2026-05-29T12:00:00.000Z",
          },
        ];
      },
    },
    env: {},
  });

  assert.equal(report.pillars.recent_publish.verdict, "amber");
  assert.match(
    report.pillars.recent_publish.reason,
    /latest_publish_stale_72h_exceeds_48h_threshold: stale-video/,
  );
  assert.ok(
    report.advisory.some((line) =>
      /recent_publish: latest_publish_stale_72h_exceeds_48h_threshold: stale-video/.test(line),
    ),
  );
});

test("summariseRecentFailedCandidates: surfaces operator-grade failure reasons", () => {
  const summary = pr.summariseRecentFailedCandidates(
    [
      {
        id: "old",
        title: "Old failed story",
        qa_failed: true,
        qa_failures: ["duration_too_long (80.00s)"],
        qa_failed_at: "2026-05-01T08:00:00.000Z",
        render_lane: "legacy_multi_image",
        render_quality_class: "standard",
      },
      {
        id: "fresh",
        title: "Fresh failed story with a very long title that should be clipped before it floods the readiness JSON output",
        qa_failed: true,
        qa_failures: JSON.stringify(["glued_sentence_in_tts_script"]),
        qa_failed_at: "2026-05-02T08:00:00.000Z",
        render_lane: "studio_v2",
        render_quality_class: "premium",
      },
      {
        id: "not-failed",
        title: "Published story",
        qa_failed: false,
      },
    ],
    {
      limit: 2,
      now: Date.parse("2026-05-02T09:00:00.000Z"),
      recentWindowHours: 48,
    },
  );

  assert.equal(summary.count, 2);
  assert.equal(summary.recent_count, 2);
  assert.equal(summary.shown_count, 2);
  assert.deepEqual(summary.ids, ["fresh", "old"]);
  assert.equal(summary.latest_failed_at, "2026-05-02T08:00:00.000Z");
  assert.deepEqual(
    summary.reason_groups.map((g) => g.reason).sort(),
    ["qa:duration_too_long", "qa:glued_sentence_in_tts_script"],
  );
  assert.equal(summary.examples[0].reason, "qa:glued_sentence_in_tts_script");
  assert.equal(summary.examples[1].reason, "qa:duration_too_long (80.00s)");
  assert.equal(summary.examples[0].render_lane, "studio_v2");
  assert.equal(summary.examples[0].render_quality_class, "premium");
  assert.equal(summary.examples[0].title.length <= 120, true);
});

test("summariseRecentFailedCandidates: count is total, ids are display-limited", () => {
  const summary = pr.summariseRecentFailedCandidates(
    [
      { id: "one", qa_failed: true, qa_failures: ["a"] },
      { id: "two", qa_failed: true, qa_failures: ["b"] },
      { id: "three", qa_failed: true, qa_failures: ["c"] },
    ],
    { limit: 2, now: Date.parse("2026-05-02T09:00:00.000Z") },
  );

  assert.equal(summary.count, 3);
  assert.equal(summary.shown_count, 2);
  assert.deepEqual(summary.ids, ["one", "two"]);
});

test("summariseRecentFailedCandidates: active window is separate from historical total", () => {
  const summary = pr.summariseRecentFailedCandidates(
    [
      {
        id: "fresh-1",
        qa_failed: true,
        qa_failures: ["audio_duration_too_long (126.11s, max 74.00s)"],
        qa_failed_at: "2026-05-02T08:00:00.000Z",
      },
      {
        id: "fresh-2",
        qa_failed: true,
        qa_failures: ["audio_duration_too_long (104.91s, max 74.00s)"],
        qa_failed_at: "2026-05-02T07:00:00.000Z",
      },
      {
        id: "stale",
        qa_failed: true,
        qa_failures: ["script_runtime_too_long (119.00s, max 75.00s)"],
        qa_failed_at: "2026-04-29T07:00:00.000Z",
      },
    ],
    {
      limit: 3,
      now: Date.parse("2026-05-02T09:00:00.000Z"),
      recentWindowHours: 24,
    },
  );

  assert.equal(summary.count, 3);
  assert.equal(summary.recent_count, 2);
  assert.equal(summary.reason_groups.length, 1);
  assert.deepEqual(summary.reason_groups[0], {
    reason: "qa:audio_duration_too_long",
    count: 2,
  });
});

test("summariseRecentFailedCandidates: excludes repaired public rows from active failure pressure", () => {
  const summary = pr.summariseRecentFailedCandidates(
    [
      {
        id: "repaired-public",
        qa_failed: true,
        publish_error: "script_validation_review_required_public_row_repair",
        public_row_repair: { reason: "public_script_validation_fallback" },
        updated_at: "2026-05-02T08:30:00.000Z",
      },
      {
        id: "active-failure",
        qa_failed: true,
        qa_failures: ["audio_duration_too_long (104.91s, max 74.00s)"],
        qa_failed_at: "2026-05-02T08:00:00.000Z",
      },
    ],
    {
      limit: 5,
      now: Date.parse("2026-05-02T09:00:00.000Z"),
      recentWindowHours: 24,
    },
  );

  assert.equal(summary.count, 1);
  assert.equal(summary.repaired_public_row_count, 1);
  assert.equal(summary.recent_count, 1);
  assert.deepEqual(summary.ids, ["active-failure"]);
});
