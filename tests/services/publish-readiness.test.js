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
  assert.equal(pr.PILLAR_NAMES.length, 22);
  assert.ok(pr.PILLAR_NAMES.includes("publish_cadence"));
  assert.ok(pr.PILLAR_NAMES.includes("strict_dry_run_control"));
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
  assert.equal(Object.keys(report.pillars).length, 22);
  assert.ok(typeof report.next_action === "string");
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
