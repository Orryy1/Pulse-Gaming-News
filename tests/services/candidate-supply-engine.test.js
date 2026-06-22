"use strict";

const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const fs = require("fs-extra");

const {
  buildCandidateSupplyReport,
  buildOfficialSourceWatchlist,
  candidateSupplyMonitorNeedsFreshIntake,
  candidateSupplyMonitorNeedsRepair,
  buildMotionCapacityIndex,
  fingerprintTitle,
  formatCandidateSupplyMonitorDiscord,
  formatCandidateSupplyMarkdown,
  shouldNotifyCandidateSupplyMonitor,
} = require("../../lib/ops/candidate-supply");
const {
  buildFreshCandidateReport,
  parseArgs,
} = require("../../tools/candidate-supply-engine");
const nextCandidates = require("../../tools/next-publish-candidates");
const db = require("../../lib/db");

function candidate(id, overrides = {}) {
  return {
    id,
    title: `Nintendo Confirms Switch 2 Story ${id}`,
    status: "publish_ready",
    score: 90,
    reasons: ["preflight_qa_pass", "scheduler_bridge_candidate"],
    source: {
      source_type: "rss",
      exported_path: `output/goal-proof/batch/${id}/visual_v4_render.mp4`,
    },
    source_manifest: {
      primary_source: {
        name: "IGN",
        url: `https://www.ign.com/articles/${id}`,
        published_at: "2026-06-11T09:00:00.000Z",
      },
      source_age_policy_hours: 168,
    },
    preflight_qa: {
      status: "pass",
      blockers: [],
      checks: {
        media_house: {
          result: "pass",
          evidence: {
            verdict: "GREEN",
            shorts_feed_competition_report: { status: "standout", score: 88 },
            shorts_attention_report: { status: "pass" },
          },
        },
      },
    },
    ...overrides,
  };
}

test("buildOfficialSourceWatchlist combines official, media, event and discovery sources", () => {
  const watchlist = buildOfficialSourceWatchlist({
    rssFeeds: [{ name: "IGN", url: "https://feeds.feedburner.com/ign/all" }],
    subreddits: ["GamingLeaksAndRumours"],
  });

  assert.equal(watchlist.channel_id, "pulse-gaming");
  assert.ok(watchlist.sources.some((source) => source.name === "PlayStation Blog" && source.tier === "official_platform"));
  assert.ok(watchlist.sources.some((source) => source.name === "IGN" && source.tier === "major_media"));
  assert.ok(watchlist.sources.some((source) => source.name === "GamingLeaksAndRumours" && source.tier === "discovery_only"));
  assert.ok(watchlist.events.some((event) => event.name === "Nintendo Direct"));
});

test("fingerprintTitle dedupes outlet variants of the same story", () => {
  assert.equal(
    fingerprintTitle("Nintendo confirms a Switch 2 gameplay trailer"),
    fingerprintTitle("Nintendo confirmed Switch 2 gameplay trailer"),
  );
});

test("candidate supply CLI accepts repeatable motion-capacity reports", () => {
  const args = parseArgs([
    "node",
    "tools/candidate-supply-engine.js",
    "--source-family-acquisition-report",
    "output/source-family.json",
    "--motion-pack-report=output/motion-packs.json",
    "--source-deficit-report",
    "output/source-deficit.json",
  ]);

  assert.equal(args.motionCapacityReports.length, 3);
  assert.ok(args.motionCapacityReports[0].endsWith("output\\source-family.json"));
  assert.ok(args.motionCapacityReports[1].endsWith("output\\motion-packs.json"));
  assert.ok(args.motionCapacityReports[2].endsWith("output\\source-deficit.json"));
});

test("fresh candidate report enables media-house preflight for supply monitor truth", async (t) => {
  const original = {
    getStories: db.getStories,
    readBridgeCandidateManifest: nextCandidates.readBridgeCandidateManifest,
    readOptionalJson: nextCandidates.readOptionalJson,
    selectCandidateSourceStories: nextCandidates.selectCandidateSourceStories,
    buildNextPublishCandidatesReport: nextCandidates.buildNextPublishCandidatesReport,
    attachPreflightQa: nextCandidates.attachPreflightQa,
  };
  t.after(() => {
    Object.assign(db, { getStories: original.getStories });
    Object.assign(nextCandidates, {
      readBridgeCandidateManifest: original.readBridgeCandidateManifest,
      readOptionalJson: original.readOptionalJson,
      selectCandidateSourceStories: original.selectCandidateSourceStories,
      buildNextPublishCandidatesReport: original.buildNextPublishCandidatesReport,
      attachPreflightQa: original.attachPreflightQa,
    });
  });

  let attachedOptions = null;
  db.getStories = async () => [candidate("weak_pack")];
  nextCandidates.readBridgeCandidateManifest = async () => ({ candidates: [], candidate_count: 0 });
  nextCandidates.readOptionalJson = async () => ({});
  nextCandidates.selectCandidateSourceStories = ({ liveStories, bridgeManifest }) => ({
    stories: liveStories,
    bridge_manifest: bridgeManifest,
  });
  nextCandidates.buildNextPublishCandidatesReport = (stories) => ({
    candidates: stories.map((story) => ({ id: story.id, status: "publish_ready" })),
  });
  nextCandidates.attachPreflightQa = async (report, stories, options) => {
    attachedOptions = options;
    report.preflight_qa = { enabled: true, mode: "read_only" };
  };

  await buildFreshCandidateReport({ limit: 5 });

  assert.equal(attachedOptions.mediaHouseQaEnabled, true);
});

test("buildCandidateSupplyReport scores supply, dedupes stories and enforces green-ready targets", () => {
  const now = new Date("2026-06-11T10:00:00.000Z");
  const stories = [
    {
      id: "rss_1",
      title: "Nintendo confirms Switch 2 gameplay trailer",
      source_type: "rss",
      subreddit: "IGN",
      url: "https://www.ign.com/articles/switch-2-gameplay",
      timestamp: "2026-06-11T09:00:00.000Z",
    },
    {
      id: "rss_2",
      title: "Nintendo confirmed a Switch 2 gameplay trailer",
      source_type: "rss",
      subreddit: "GameSpot",
      url: "https://www.gamespot.com/articles/switch-2-gameplay",
      timestamp: "2026-06-11T09:10:00.000Z",
    },
    ...Array.from({ length: 8 }, (_, index) => ({
      id: `rss_extra_${index + 1}`,
      title: `Official Publisher Story ${index + 1}`,
      source_type: "rss",
      subreddit: "Official",
      url: `https://example.com/official-story-${index + 1}`,
      timestamp: "2026-06-11T08:00:00.000Z",
    })),
  ];
  const candidateReport = {
    generated_at: now.toISOString(),
    totals: { stories_seen: 12, returned: 10, pending_audio: 0 },
    candidates: Array.from({ length: 10 }, (_, index) => candidate(`story-${index + 1}`)),
  };

  const report = buildCandidateSupplyReport({
    stories,
    candidateReport,
    channelConfig: {
      rssFeeds: [{ name: "IGN", url: "https://feeds.feedburner.com/ign/all" }],
      subreddits: ["GamingLeaksAndRumours"],
    },
    now,
  });

  assert.equal(report.verdict, "green");
  assert.equal(report.targets.green_ready_candidates, 10);
  assert.equal(report.summary.green_ready_candidates, 10);
  assert.equal(report.summary.source_safe_candidates, 10);
  assert.equal(report.summary.v4_ready_candidates, 10);
  assert.equal(report.dedupe.duplicate_group_count, 1);
  assert.ok(report.priority_scorecards[0].visual_availability_score > 0);
  assert.match(formatCandidateSupplyMarkdown(report), /Candidate Supply Engine/);
});

test("buildCandidateSupplyReport uses bridge source-age evidence for near-expiry runway warnings", () => {
  const now = new Date("2026-06-16T22:00:00.000Z");
  const candidateReport = {
    generated_at: now.toISOString(),
    totals: { stories_seen: 1, returned: 1, pending_audio: 0 },
    candidates: [
      candidate("fresh_xbox_alien_isolation_2_20260610", {
        title: "Alien Isolation 2 Has One Horror Risk",
        source_manifest: {
          primary_source: {
            name: "Xbox Wire",
            url: "https://news.xbox.com/en-us/2026/06/10/alien-isolation-2-poised-to-deliver-another-bold-chapter/",
            published_at: "2026-06-10T00:00:00.000Z",
          },
          source_age_policy_hours: 168,
        },
        preflight_qa: {
          status: "pass",
          blockers: [],
          checks: {
            source_age: {
              result: "pass",
              evidence: {
                source_published_at: "2026-06-10T00:00:00.000Z",
                policy_hours: 168,
              },
            },
            media_house: {
              result: "pass",
              evidence: {
                verdict: "GREEN",
                shorts_feed_competition_report: { status: "standout", score: 86 },
                shorts_attention_report: { status: "pass" },
              },
            },
          },
        },
      }),
      candidate("fresh_xbox_fable_living_population_20260610", {
        title: "Fable Has A 1,000 NPC Risk",
        status: "review",
        preflight_qa: {
          status: "blocked",
          blockers: ["visual_entity_match:direct_motion_subject_mismatch"],
          checks: {
            source_age: {
              result: "pass",
              evidence: {
                source_published_at: "2026-06-10T00:00:00.000Z",
                policy_hours: 168,
              },
            },
          },
        },
      }),
    ],
  };

  const report = buildCandidateSupplyReport({
    stories: [],
    candidateReport,
    channelConfig: {},
    now,
    targets: {
      greenReadyCandidates: 1,
      sourceSafeCandidates: 1,
      v4ReadyCandidates: 1,
      freshSourceBackedStories: 0,
    },
  });

  assert.equal(report.summary.green_ready_candidates, 1);
  assert.equal(report.summary.ready_candidates_expiring_within_24h, 1);
  assert.equal(report.summary.non_ready_candidates_expiring_within_24h, 1);
  assert.equal(report.summary.durable_green_ready_candidates, 0);
  assert.equal(report.priority_scorecards[0].age_hours, 166);
  assert.equal(report.priority_scorecards[0].source_age_policy_hours, 168);
  assert.equal(report.priority_scorecards[0].source_age_expires_in_hours, 2);
  assert.ok(report.warnings.includes("ready_candidates_expiring_within_24h:1"));
  assert.ok(report.warnings.includes("non_ready_candidates_expiring_within_24h:1"));
  assert.ok(report.warnings.includes("durable_green_ready_candidates_below_target:0/1"));
  assert.equal(report.next_action, "refresh_fresh_source_intake_and_promote_new_green_candidates_before_expiring_backlog");
  assert.match(formatCandidateSupplyMarkdown(report), /Durable GREEN-ready candidates: 0\/1/);
});

test("buildCandidateSupplyReport surfaces scheduler-quarantined stale backlog", () => {
  const now = new Date("2026-06-20T09:00:00.000Z");
  const candidateReport = {
    generated_at: now.toISOString(),
    totals: { stories_seen: 2, returned: 2, pending_audio: 0 },
    candidates: [
      candidate("ready-one", {
        source_manifest: {
          primary_source: {
            name: "IGN",
            url: "https://www.ign.com/articles/ready-one",
            published_at: "2026-06-20T08:00:00.000Z",
          },
          source_age_policy_hours: 168,
        },
      }),
      candidate("stale-held", {
        title: "Old Showcase Story Still Needs Review",
        status: "review",
        reasons: ["preflight_qa_blocked", "scheduler_quarantine_stale_source"],
        scheduler_quarantine: {
          status: "held",
          reason: "source_age_exceeds_policy",
          lane: "stale_source_backlog",
          safe_next_action: "replace_with_fresh_source_or_operator_approve_evergreen",
        },
        preflight_qa: {
          status: "blocked",
          blockers: ["source_age:source_age_exceeds_policy"],
          checks: {
            source_age: {
              result: "fail",
              failures: ["source_age_exceeds_policy"],
              evidence: {
                source_published_at: "2026-06-10T00:00:00.000Z",
                policy_hours: 168,
              },
            },
          },
        },
      }),
    ],
  };

  const report = buildCandidateSupplyReport({
    stories: [],
    candidateReport,
    channelConfig: {},
    now,
    targets: {
      greenReadyCandidates: 2,
      sourceSafeCandidates: 1,
      v4ReadyCandidates: 1,
      freshSourceBackedStories: 0,
    },
  });

  assert.equal(report.summary.scheduler_quarantined_candidates, 1);
  assert.deepEqual(report.summary.scheduler_quarantine_reasons, {
    source_age_exceeds_policy: 1,
  });
  assert.ok(report.warnings.includes("scheduler_quarantined_stale_backlog:1"));
  assert.match(formatCandidateSupplyMarkdown(report), /Scheduler-quarantined stale backlog: 1/);
  assert.match(formatCandidateSupplyMonitorDiscord(report), /Quarantined stale backlog: 1/);
});

test("candidate supply monitor treats covered windows without reserve as actionable AMBER", () => {
  const now = new Date("2026-06-16T22:00:00.000Z");
  const candidateReport = {
    generated_at: now.toISOString(),
    totals: { stories_seen: 5, returned: 5, pending_audio: 0 },
    candidates: Array.from({ length: 5 }, (_, index) => candidate(`ready-${index + 1}`)),
  };

  const report = buildCandidateSupplyReport({
    stories: [],
    candidateReport,
    channelConfig: {},
    now,
  });

  assert.equal(report.verdict, "amber");
  assert.equal(report.candidate_buffer.publish_window_runway.covered_publish_windows_24h, 5);
  assert.equal(report.candidate_buffer.publish_window_runway.reserve_candidates, 0);
  assert.equal(candidateSupplyMonitorNeedsRepair(report), true);
  assert.equal(candidateSupplyMonitorNeedsFreshIntake(report), true);
  assert.equal(shouldNotifyCandidateSupplyMonitor(report, { post_discord_on_red: true }), true);
  assert.match(formatCandidateSupplyMonitorDiscord(report), /Runway: 5\/5 windows \| reserve 0\/5/);
  assert.match(formatCandidateSupplyMonitorDiscord(report), /Warnings:/);
});

test("candidate supply monitor separates fresh YouTube runway from platform catch-up candidates", () => {
  const now = new Date("2026-06-20T09:00:00.000Z");
  const candidateReport = {
    generated_at: now.toISOString(),
    totals: { stories_seen: 5, returned: 5, pending_audio: 0 },
    candidates: Array.from({ length: 5 }, (_, index) => candidate(`catchup-${index + 1}`, {
      source: {
        source_type: "rss",
        exported_path: `output/goal-proof/batch/catchup-${index + 1}/visual_v4_render.mp4`,
        already_published_platforms: ["youtube_shorts"],
        missing_enabled_platforms: ["instagram_reels", "facebook_reels"],
      },
    })),
  };

  const report = buildCandidateSupplyReport({
    stories: [],
    candidateReport,
    channelConfig: {},
    now,
    targets: {
      greenReadyCandidates: 5,
      sourceSafeCandidates: 5,
      v4ReadyCandidates: 3,
      freshSourceBackedStories: 0,
    },
  });

  assert.equal(report.summary.green_ready_candidates, 5);
  assert.equal(report.summary.fresh_youtube_upload_candidates, 0);
  assert.equal(report.summary.catch_up_only_green_candidates, 5);
  assert.equal(report.youtube_upload_runway.covered_publish_windows_24h, 0);
  assert.equal(report.youtube_upload_runway.uncovered_publish_windows_24h, 5);
  assert.equal(report.verdict, "red");
  assert.ok(report.blockers.includes("fresh_youtube_upload_candidate_buffer_empty"));
  assert.ok(report.warnings.includes("fresh_youtube_upload_candidates_below_window_target:0/5"));
  assert.equal(candidateSupplyMonitorNeedsRepair(report), true);
  assert.equal(candidateSupplyMonitorNeedsFreshIntake(report), true);
  assert.match(formatCandidateSupplyMarkdown(report), /Fresh YouTube-ready candidates: 0\/5/);
  assert.match(formatCandidateSupplyMonitorDiscord(report), /Fresh YouTube-ready: 0\/5/);
});

test("candidate supply report treats current transcript backlog as refill pressure", () => {
  const now = new Date("2026-06-16T22:00:00.000Z");
  const candidateReport = {
    generated_at: now.toISOString(),
    totals: { stories_seen: 5, returned: 5, pending_audio: 0 },
    candidates: Array.from({ length: 5 }, (_, index) => candidate(`ready-${index + 1}`)),
  };
  const transcriptAudienceReport = {
    generated_at: now.toISOString(),
    summary: { total: 2, pass: 0, rewrite_required: 2 },
    stories: [
      {
        story_id: "ready-1",
        title: "Nintendo Confirms Switch 2 Story ready-1",
        verdict: "rewrite_required",
        blockers: ["mass_audience:abstract_payoff"],
        viral_score: 52,
      },
      {
        story_id: "historical-old",
        title: "Historical Old Story",
        verdict: "rewrite_required",
        blockers: ["mass_audience:unclear_referents"],
        viral_score: 48,
      },
    ],
  };

  const report = buildCandidateSupplyReport({
    stories: [],
    candidateReport,
    transcriptAudienceReport,
    channelConfig: {},
    now,
  });

  assert.equal(report.summary.green_ready_candidates, 4);
  assert.equal(report.summary.raw_preflight_green_ready_candidates, 5);
  assert.equal(report.summary.transcript_audience_rewrite_required, 2);
  assert.equal(report.summary.transcript_backlog_current_candidates, 1);
  assert.equal(report.summary.transcript_backlog_ready_candidates, 1);
  assert.equal(report.summary.transcript_clean_green_ready_candidates, 4);
  assert.equal(report.summary.green_ready_candidates, report.summary.transcript_clean_green_ready_candidates);
  assert.equal(report.priority_scorecards.find((item) => item.story_id === "ready-1").clean_green, false);
  assert.equal(report.priority_scorecards.find((item) => item.story_id === "ready-2").clean_green, true);
  assert.ok(report.warnings.includes("transcript_backlog_current_candidates:1"));
  assert.ok(report.warnings.includes("transcript_clean_green_ready_candidates_below_target:4/10"));
  assert.equal(report.transcript_backlog.current_candidates[0].story_id, "ready-1");
  assert.equal(candidateSupplyMonitorNeedsRepair(report), true);
  assert.equal(candidateSupplyMonitorNeedsFreshIntake(report), true);
  assert.equal(report.next_action, "repair_transcript_backlog_and_refill_green_candidate_buffer");
  assert.match(formatCandidateSupplyMarkdown(report), /Transcript Backlog/);
  assert.match(formatCandidateSupplyMonitorDiscord(report), /Clean GREEN: 4\/10 \(raw preflight 5; transcript-held 1; attention-held 0\)/);
  assert.doesNotMatch(formatCandidateSupplyMonitorDiscord(report), /^GREEN-ready: 5\/10/m);
});

test("candidate supply ignores stale transcript backlog when the current artifact passes audience audit", async (t) => {
  const now = new Date("2026-06-21T23:00:00.000Z");
  const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-current-candidate-"));
  t.after(async () => {
    await fs.remove(artifactDir);
  });

  const script =
    "Super Yooka-Laylee Kart is going after one of racing's most dangerous comparisons. " +
    "IGN says ex-Rare developers are aiming to revive the spirit of Diddy Kong Racing. " +
    "That is bigger than a cute mascot pitch. Diddy Kong Racing worked because it felt like an adventure first and a racer second. " +
    "The catch is handling. Players have to decide whether to wishlist this as a real kart rival, or wait until the handling proves nostalgia is not doing all the work. " +
    "That is the pressure on Playtonic now. Tracks, items and character charm have to feel like discovery, not cosplay. " +
    "If the handling has bite, this becomes a serious nostalgia upset. If it feels floaty, the comparison eats it alive. " +
    "Follow Pulse Gaming so you never miss a beat.";
  const videoPath = path.join(artifactDir, "visual_v4_render.mp4");
  await fs.outputFile(videoPath, "fake mp4 bytes");
  await fs.writeJson(
    path.join(artifactDir, "canonical_story_manifest.json"),
    {
      story_id: "ready-current",
      canonical_subject: "Super Yooka-Laylee Kart",
      title: "Yooka-Laylee Kart Has A Diddy Kong Risk",
      selected_title: "Yooka-Laylee Kart Has A Diddy Kong Risk",
      primary_source: "IGN",
      source_type: "rss",
      narration_script: script,
      tts_script: script,
    },
    { spaces: 2 },
  );
  await fs.writeJson(
    path.join(artifactDir, "narration_manifest.json"),
    {
      status: "ready",
      final_transcript: script,
    },
    { spaces: 2 },
  );
  await fs.writeJson(
    path.join(artifactDir, "script_scorecard.json"),
    {
      verdict: "viral_ready",
      viral_score: 90,
      blockers: [],
    },
    { spaces: 2 },
  );

  const candidateReport = {
    generated_at: now.toISOString(),
    totals: { stories_seen: 1, returned: 1, pending_audio: 0 },
    candidates: [
      candidate("ready-current", {
        title: "Yooka-Laylee Kart Has A Diddy Kong Risk",
        source: {
          source_type: "rss",
          exported_path: videoPath,
        },
        source_manifest: {
          primary_source: {
            name: "IGN",
            url: "https://www.ign.com/articles/super-yooka-laylee-kart-preview",
            published_at: "2026-06-21T19:00:00.000Z",
          },
          source_age_policy_hours: 168,
        },
      }),
    ],
  };
  const transcriptAudienceReport = {
    generated_at: now.toISOString(),
    summary: { total: 1, pass: 0, rewrite_required: 1 },
    stories: [
      {
        story_id: "ready-current",
        title: "Old Yooka Draft",
        verdict: "rewrite_required",
        blockers: ["missing_story_specific_payoff"],
        viral_score: 48,
      },
    ],
  };

  const report = buildCandidateSupplyReport({
    stories: [],
    candidateReport,
    transcriptAudienceReport,
    channelConfig: {},
    now,
    targets: {
      greenReadyCandidates: 1,
      sourceSafeCandidates: 1,
      v4ReadyCandidates: 1,
      freshSourceBackedStories: 0,
      publishWindows24h: 1,
    },
  });

  assert.equal(report.summary.raw_preflight_green_ready_candidates, 1);
  assert.equal(report.summary.transcript_backlog_current_candidates, 0);
  assert.equal(report.summary.transcript_backlog_ready_candidates, 0);
  assert.equal(report.summary.transcript_audience_rewrite_required, 0);
  assert.equal(report.summary.transcript_clean_green_ready_candidates, 1);
  assert.equal(report.summary.green_ready_candidates, 1);
  assert.equal(report.summary.fresh_youtube_upload_candidates, 1);
  assert.equal(report.transcript_backlog.summary.current_candidate_artifact_audit_count, 1);
  assert.equal(report.transcript_backlog.summary.current_candidate_artifact_pass_count, 1);
  assert.equal(report.transcript_backlog.summary.stale_transcript_rewrite_suppressed_count, 1);
  assert.equal(report.transcript_backlog.current_candidates.length, 0);
  const scorecard = report.priority_scorecards.find((item) => item.story_id === "ready-current");
  assert.equal(scorecard.clean_green, true);
  assert.deepEqual(scorecard.transcript_audience.blockers, []);
  assert.doesNotMatch(formatCandidateSupplyMonitorDiscord(report), /transcript-held 1/);
});

test("candidate supply report exposes Shorts attention readiness and metadata blockers", () => {
  const now = new Date("2026-06-20T09:00:00.000Z");
  const candidateReport = {
    generated_at: now.toISOString(),
    totals: { stories_seen: 4, returned: 4, pending_audio: 0 },
    candidates: [
      candidate("attention-standout", {
        title: "Gears E-Day Has A 130GB Problem",
        preflight_qa: {
          status: "pass",
          blockers: [],
          checks: {
            media_house: {
              result: "pass",
              evidence: {
                verdict: "GREEN",
                shorts_feed_competition_report: { status: "standout", score: 88 },
                shorts_attention_report: { status: "pass" },
              },
            },
          },
        },
      }),
      candidate("attention-pass", {
        title: "Steam Next Fest Turns Demos Into A Trust Fight",
        preflight_qa: {
          status: "pass",
          blockers: [],
          checks: {
            media_house: {
              result: "pass",
              evidence: {
                verdict: "GREEN",
                shorts_feed_competition_report: { status: "pass", score: 76 },
                shorts_attention_report: { status: "pass" },
              },
            },
          },
        },
      }),
      candidate("weak-platform-copy", {
        title: "Alien Isolation 2 Has One Horror Risk",
        status: "review",
        reasons: ["preflight_qa_blocked"],
        preflight_qa: {
          status: "blocked",
          blockers: ["media_house:platform_copy_too_plain", "media_house:shorts_feed_competition_weak"],
          checks: {
            media_house: {
              result: "fail",
              evidence: {
                verdict: "RED",
                hard_failures: [
                  "media_house:platform_copy_too_plain",
                  "media_house:shorts_feed_competition_weak",
                ],
                shorts_feed_competition_report: {
                  status: "blocked",
                  blockers: ["feed_description_lacks_specific_payoff"],
                },
              },
            },
          },
        },
      }),
      candidate("weak-cover", {
        title: "Stranger Than Heaven Has RGG Combat Risk",
        status: "review",
        reasons: ["preflight_qa_blocked"],
        preflight_qa: {
          status: "blocked",
          blockers: [
            "media_house:first_frame_or_thumbnail_not_attention_led",
            "media_house:shorts_feed_competition_weak",
          ],
          checks: {
            media_house: {
              result: "fail",
              evidence: {
                verdict: "RED",
                hard_failures: [
                  "media_house:first_frame_or_thumbnail_not_attention_led",
                  "media_house:shorts_feed_competition_weak",
                ],
                shorts_attention_report: {
                  status: "blocked",
                  blockers: ["first_frame_or_thumbnail_not_attention_led"],
                },
              },
            },
          },
        },
      }),
    ],
  };

  const report = buildCandidateSupplyReport({
    stories: [],
    candidateReport,
    channelConfig: {},
    now,
    targets: {
      greenReadyCandidates: 4,
      sourceSafeCandidates: 2,
      v4ReadyCandidates: 2,
      freshSourceBackedStories: 0,
      publishWindows24h: 2,
    },
  });

  assert.equal(report.summary.shorts_attention_ready_candidates, 2);
  assert.equal(report.summary.shorts_feed_standout_candidates, 1);
  assert.equal(report.summary.metadata_attention_blocked_candidates, 2);
  assert.equal(report.summary.platform_copy_blocked_candidates, 1);
  assert.equal(report.summary.thumbnail_attention_blocked_candidates, 1);
  assert.equal(report.summary.shorts_feed_competition_blocked_candidates, 2);
  assert.ok(report.warnings.includes("shorts_attention_ready_candidates_below_target:2/4"));
  assert.equal(report.shorts_attention.blocked_examples[0].story_id, "weak-platform-copy");
  assert.deepEqual(report.priority_scorecards.find((item) => item.story_id === "attention-standout").shorts_attention, {
    status: "pass",
    feed_status: "standout",
    feed_score: 88,
    blockers: [],
  });
  assert.match(formatCandidateSupplyMarkdown(report), /Shorts attention-ready candidates: 2\/4/);
  assert.match(formatCandidateSupplyMarkdown(report), /Metadata attention blockers: 2/);
  assert.match(formatCandidateSupplyMonitorDiscord(report), /Shorts attention: ready 2\/4 \| standout 1 \| blocked 2/);
  assert.equal(candidateSupplyMonitorNeedsRepair(report), true);
});

test("candidate supply clean GREEN requires Shorts feed standout packaging", () => {
  const now = new Date("2026-06-20T09:00:00.000Z");
  const candidateReport = {
    generated_at: now.toISOString(),
    totals: { stories_seen: 2, returned: 2, pending_audio: 0 },
    candidates: [
      candidate("standout-package", {
        title: "Gears E-Day Has A 130GB Problem",
        source_manifest: {
          primary_source: {
            name: "IGN",
            url: "https://www.ign.com/articles/standout-package",
            published_at: "2026-06-20T08:00:00.000Z",
          },
          source_age_policy_hours: 168,
        },
        preflight_qa: {
          status: "pass",
          blockers: [],
          checks: {
            media_house: {
              result: "pass",
              evidence: {
                verdict: "GREEN",
                shorts_feed_competition_report: { status: "standout", score: 88 },
                shorts_attention_report: { status: "pass" },
              },
            },
          },
        },
      }),
      candidate("ordinary-package", {
        title: "Steam Next Fest Turns Demos Into A Trust Fight",
        source_manifest: {
          primary_source: {
            name: "IGN",
            url: "https://www.ign.com/articles/ordinary-package",
            published_at: "2026-06-20T08:00:00.000Z",
          },
          source_age_policy_hours: 168,
        },
        preflight_qa: {
          status: "pass",
          blockers: [],
          checks: {
            media_house: {
              result: "pass",
              evidence: {
                verdict: "GREEN",
                shorts_feed_competition_report: { status: "pass", score: 76 },
                shorts_attention_report: { status: "pass" },
              },
            },
          },
        },
      }),
    ],
  };

  const report = buildCandidateSupplyReport({
    stories: [],
    candidateReport,
    channelConfig: {},
    now,
    targets: {
      greenReadyCandidates: 2,
      sourceSafeCandidates: 1,
      v4ReadyCandidates: 1,
      freshSourceBackedStories: 0,
      publishWindows24h: 2,
    },
  });

  assert.equal(report.summary.raw_preflight_green_ready_candidates, 2);
  assert.equal(report.summary.transcript_clean_green_ready_candidates, 2);
  assert.equal(report.summary.shorts_attention_ready_candidates, 2);
  assert.equal(report.summary.shorts_feed_standout_candidates, 1);
  assert.equal(report.summary.green_ready_candidates, 1);
  assert.equal(report.summary.fresh_youtube_upload_candidates, 1);
  assert.equal(report.summary.durable_green_ready_candidates, 1);
  assert.equal(report.priority_scorecards.find((item) => item.story_id === "standout-package").clean_green, true);
  assert.equal(report.priority_scorecards.find((item) => item.story_id === "ordinary-package").clean_green, false);
  assert.ok(report.warnings.includes("green_ready_candidates_below_target:1/2"));
  assert.ok(report.warnings.includes("fresh_youtube_upload_candidates_below_window_target:1/2"));
  assert.match(formatCandidateSupplyMarkdown(report), /Clean GREEN-ready candidates: 1\/2/);
  assert.match(formatCandidateSupplyMonitorDiscord(report), /Clean GREEN: 1\/2 \(raw preflight 2; transcript-held 0; attention-held 1\)/);
});

test("candidate supply infers Shorts feed standout from legacy media-house score evidence", () => {
  const now = new Date("2026-06-20T09:00:00.000Z");
  const report = buildCandidateSupplyReport({
    stories: [],
    candidateReport: {
      generated_at: now.toISOString(),
      totals: { stories_seen: 1, returned: 1, pending_audio: 0 },
      candidates: [
        candidate("legacy-score-standout", {
          title: "Gears E-Day Has A 130GB Problem",
          source_manifest: {
            primary_source: {
              name: "PC Gamer",
              url: "https://www.pcgamer.com/gears-eday-pc-specs",
              published_at: "2026-06-20T08:00:00.000Z",
            },
            source_age_policy_hours: 168,
          },
          preflight_qa: {
            status: "pass",
            blockers: [],
            checks: {
              media_house: {
                result: "pass",
                failures: [],
                warnings: [],
                evidence: {
                  verdict: "GREEN",
                  overall_media_house_score: 93,
                  title_strength_score: 100,
                  first_frame_score: 100,
                  first_3_seconds_score: 100,
                  competitor_parity_score: 97,
                  competitor_surpass_score: 93,
                  hard_failures: [],
                },
              },
            },
          },
        }),
      ],
    },
    channelConfig: {},
    now,
    targets: {
      greenReadyCandidates: 1,
      sourceSafeCandidates: 1,
      v4ReadyCandidates: 1,
      freshSourceBackedStories: 0,
      publishWindows24h: 1,
    },
  });

  assert.equal(report.summary.shorts_feed_standout_candidates, 1);
  assert.equal(report.summary.green_ready_candidates, 1);
  assert.equal(report.summary.fresh_youtube_upload_candidates, 1);
  assert.deepEqual(report.priority_scorecards[0].shorts_attention, {
    status: "pass",
    feed_status: "standout",
    feed_score: 93,
    blockers: [],
  });
});

test("candidate supply monitor does not trigger fresh intake when runway has reserve", () => {
  const now = new Date("2026-06-16T22:00:00.000Z");
  const candidateReport = {
    generated_at: now.toISOString(),
    totals: { stories_seen: 10, returned: 10, pending_audio: 0 },
    candidates: Array.from({ length: 10 }, (_, index) => candidate(`ready-${index + 1}`)),
  };

  const report = buildCandidateSupplyReport({
    stories: Array.from({ length: 10 }, (_, index) => ({
      id: `rss-${index + 1}`,
      title: `Official Publisher Story ${index + 1}`,
      source_type: "rss",
      subreddit: "IGN",
      url: `https://www.ign.com/articles/official-publisher-story-${index + 1}`,
      timestamp: "2026-06-16T18:00:00.000Z",
    })),
    candidateReport,
    channelConfig: {},
    now,
  });

  assert.equal(report.verdict, "green");
  assert.equal(report.candidate_buffer.publish_window_runway.status, "covered_with_reserve");
  assert.equal(candidateSupplyMonitorNeedsRepair(report), false);
  assert.equal(candidateSupplyMonitorNeedsFreshIntake(report), false);
});

test("buildCandidateSupplyReport surfaces motion-capacity repair lanes for fresh blocked stories", () => {
  const now = new Date("2026-06-19T02:00:00.000Z");
  const stories = [
    {
      id: "motion-close",
      title: "EA Sports FC 26 Adds A Game Pass Trial",
      source_type: "rss",
      subreddit: "Xbox Wire",
      url: "https://news.xbox.com/en-us/2026/06/18/ea-sports-fc-26-game-pass/",
      timestamp: "2026-06-18T12:00:00.000Z",
    },
    {
      id: "operator-needed",
      title: "Granblue Fantasy Relink Demo Gets A Test",
      source_type: "rss",
      subreddit: "PlayStation Blog",
      url: "https://blog.playstation.com/2026/06/18/granblue-fantasy-relink-demo/",
      timestamp: "2026-06-18T12:30:00.000Z",
    },
    {
      id: "ready-one",
      title: "Nintendo Confirms Switch 2 Story ready-one",
      source_type: "rss",
      subreddit: "IGN",
      url: "https://www.ign.com/articles/ready-one",
      timestamp: "2026-06-18T13:00:00.000Z",
    },
  ];
  const candidateReport = {
    generated_at: now.toISOString(),
    totals: { stories_seen: 2, returned: 2, pending_audio: 0 },
    candidates: [
      candidate("motion-close", {
        title: "EA Sports FC 26 Adds A Game Pass Trial",
        status: "review",
        reasons: ["preflight_qa_blocked"],
        source: { source_type: "rss", exported_path: "" },
        preflight_qa: {
          status: "blocked",
          blockers: ["footage:v4_motion_blocked"],
        },
      }),
      candidate("operator-needed", {
        title: "Granblue Fantasy Relink Demo Gets A Test",
        status: "review",
        reasons: ["preflight_qa_blocked"],
        source: { source_type: "rss", exported_path: "" },
        preflight_qa: {
          status: "blocked",
          blockers: ["footage:v4_motion_blocked"],
        },
      }),
      candidate("ready-one", {
        score: 0,
        source_manifest: {
          primary_source: {
            name: "IGN",
            url: "https://www.ign.com/articles/ready-one",
            published_at: "2026-06-18T13:00:00.000Z",
          },
          source_age_policy_hours: 168,
        },
        preflight_qa: {
          status: "pass",
          blockers: [],
          checks: {
            source_age: {
              result: "pass",
              evidence: {
                source_published_at: "2026-06-18T13:00:00.000Z",
                policy_hours: 168,
              },
            },
            media_house: {
              result: "pass",
              evidence: {
                verdict: "GREEN",
                shorts_feed_competition_report: { status: "standout", score: 86 },
                shorts_attention_report: { status: "pass" },
              },
            },
          },
        },
      }),
    ],
  };
  const motionCapacityReports = [
    {
      rows: [
        {
          story_id: "motion-close",
          readiness_status: "v4_motion_blocked",
          blockers: ["distinct_motion_families_minimum_not_met"],
          current_motion_clips: 8,
          current_motion_families: 3,
          required_motion_clips: 5,
          required_motion_families: 4,
          missing_motion_clips: 0,
          missing_motion_families: 1,
          acquisition_counts: {
            direct_media_ready: 2,
            licence_or_operator_required: 0,
          },
          source_family_candidates: [{ source_family: "ea_official_trial_trailer" }],
        },
        {
          story_id: "operator-needed",
          readiness_status: "v4_motion_blocked",
          blockers: ["actual_motion_clip_minimum_not_met", "distinct_motion_families_minimum_not_met"],
          current_motion_clips: 4,
          current_motion_families: 3,
          required_motion_clips: 5,
          required_motion_families: 4,
          missing_motion_clips: 1,
          missing_motion_families: 1,
          governed_visual_plan: { operator_approval_required: true },
          acquisition_counts: {
            direct_media_ready: 0,
            licence_or_operator_required: 1,
          },
        },
      ],
    },
  ];

  const report = buildCandidateSupplyReport({
    stories,
    candidateReport,
    motionCapacityReports,
    channelConfig: {},
    now,
    targets: {
      greenReadyCandidates: 5,
      sourceSafeCandidates: 2,
      v4ReadyCandidates: 2,
      freshSourceBackedStories: 3,
    },
  });

  const index = buildMotionCapacityIndex(motionCapacityReports);
  assert.equal(index.get("motion-close").repair_priority, "high");
  assert.equal(index.get("operator-needed").operator_required, true);
  assert.equal(report.summary.motion_capacity_repairable_candidates, 1);
  assert.equal(report.summary.motion_capacity_operator_required_candidates, 1);
  assert.equal(report.summary.motion_capacity_near_ready_candidates, 1);
  const repairableScorecard = report.priority_scorecards.find((item) => item.story_id === "motion-close");
  assert.equal(repairableScorecard.motion_capacity.repair_priority, "high");
  assert.ok(report.warnings.includes("motion_repairable_candidates_available:1"));
  assert.equal(report.next_action, "promote_motion_repairable_candidates_with_official_direct_media");
  assert.match(formatCandidateSupplyMarkdown(report), /Motion Capacity/);
  assert.match(formatCandidateSupplyMonitorDiscord(report), /Motion repairable: 1/);
});

test("motion-capacity merge keeps latest blocking validation evidence authoritative", () => {
  const index = buildMotionCapacityIndex([
    {
      rows: [
        {
          story_id: "planet-crafter",
          readiness_status: "v4_motion_blocked",
          current_motion_clips: 3,
          current_motion_families: 1,
          required_motion_clips: 5,
          required_motion_families: 4,
          missing_motion_clips: 2,
          missing_motion_families: 3,
          acquisition_counts: {
            direct_media_ready: 1,
            licence_or_operator_required: 0,
          },
        },
      ],
    },
    {
      rows: [
        {
          story_id: "planet-crafter",
          readiness_status: "v4_motion_blocked",
          blockers: ["actual_motion_clip_minimum_not_met", "distinct_motion_families_minimum_not_met"],
          current_motion_clips: 0,
          current_motion_families: 0,
          required_motion_clips: 5,
          required_motion_families: 4,
          missing_motion_clips: 5,
          missing_motion_families: 4,
          acquisition_counts: {
            direct_media_ready: 1,
            licence_or_operator_required: 0,
          },
          required_acquisitions: [
            {
              direct_media_url: "https://example.invalid/planet-crafter.m3u8",
              segment_validation_status: "validation_failed",
            },
          ],
        },
      ],
    },
  ]);

  const capacity = index.get("planet-crafter");
  assert.equal(capacity.current_motion_clips, 0);
  assert.equal(capacity.current_motion_families, 0);
  assert.equal(capacity.missing_motion_clips, 5);
  assert.equal(capacity.missing_motion_families, 4);
  assert.equal(capacity.motion_ready, false);
  assert.equal(capacity.near_ready, false);
  assert.equal(capacity.repairable, false);
  assert.equal(capacity.direct_media_ready, 1);
  assert.equal(capacity.actionable_direct_media_ready, 0);
});
