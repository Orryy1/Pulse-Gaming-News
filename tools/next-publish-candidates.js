#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");
const DEFAULT_ANALYTICS_PATH = "D:\\pulse-data\\analytics_findings.md";
const DEFAULT_LIMIT = 12;

const PUBLIC_PLATFORM_FIELDS = [
  "youtube_post_id",
  "youtube_url",
  "tiktok_post_id",
  "instagram_media_id",
  "facebook_post_id",
  "twitter_post_id",
  "x_post_id",
];

const COMPANY_TERMS = [
  "Amazon",
  "Apple",
  "Arc System Works",
  "Bandai",
  "Bethesda",
  "BioWare",
  "Blizzard",
  "Capcom",
  "CD Projekt",
  "Dexerto",
  "Discord",
  "EA",
  "eBay",
  "Epic",
  "Facebook",
  "GameStop",
  "Google",
  "Konami",
  "Meta",
  "Microsoft",
  "Nintendo",
  "PlayStation",
  "Rockstar",
  "Sega",
  "Sony",
  "Square Enix",
  "Steam",
  "Take-Two",
  "Tencent",
  "Ubisoft",
  "Valve",
  "Warner",
  "Xbox",
];

const CORPORATE_DRAMA_TERMS = [
  "accused",
  "bid",
  "blocked",
  "board",
  "boss",
  "ceo",
  "collapsed",
  "court",
  "deal",
  "destroyed",
  "executive",
  "lawsuit",
  "president",
  "pricing",
  "pressure",
  "rejected",
  "shut down",
  "strong-arm",
  "takeover",
  "walked away",
];

const CONCRETE_OUTCOME_TERMS = [
  "approved",
  "cancelled",
  "confirmed",
  "delayed",
  "drops",
  "launches",
  "launched",
  "price",
  "rejected",
  "revealed",
  "shut down",
  "update",
  "walked away",
];

const SPECULATIVE_TERMS = [
  "could",
  "may",
  "maybe",
  "might",
  "possibly",
  "rumour",
  "rumor",
  "speculation",
  "would",
];

function textForStory(story = {}) {
  return [
    story.title,
    story.suggested_title,
    story.hook,
    story.full_script,
    story.tts_script,
    story.body,
    story.loop,
    story.publish_error,
  ]
    .filter(Boolean)
    .join(" ");
}

function lc(value) {
  return String(value || "").toLowerCase();
}

function includesAny(lowerText, terms) {
  return terms.some((term) => lowerText.includes(lc(term)));
}

function matchedTerms(lowerText, terms) {
  return terms.filter((term) => lowerText.includes(lc(term)));
}

function realPlatformId(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/^DUPE_/i.test(text)) return false;
  if (/^(blocked|disabled|skipped|failed|none|null|undefined)$/i.test(text)) {
    return false;
  }
  return true;
}

function existingPublicPlatformFields(story = {}) {
  return PUBLIC_PLATFORM_FIELDS.filter((field) => realPlatformId(story[field]));
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function storyDurationSeconds(story = {}) {
  return (
    numberOrNull(story.duration_seconds) ??
    numberOrNull(story.audio_duration) ??
    numberOrNull(story.video_duration_seconds) ??
    numberOrNull(story.runtime_seconds) ??
    numberOrNull(story.final_duration_seconds)
  );
}

function isLongformLane(story = {}) {
  const fields = [
    story.format,
    story.format_type,
    story.suggested_format,
    story.render_lane,
    story.content_pillar,
    story.classification,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /\b(longform|weekly|monthly|roundup|briefing|release radar|documentary|trailer breakdown)\b/.test(fields);
}

function durationVerdict(story = {}) {
  const duration = storyDurationSeconds(story);
  if (duration == null) {
    return {
      status: "review",
      score: -8,
      reason: "duration_unknown",
      duration_seconds: null,
    };
  }
  if (duration >= 61 && duration <= 75) {
    const centrePenalty = Math.abs(duration - 68) * 0.4;
    return {
      status: "publish_ready",
      score: Math.round(28 - centrePenalty),
      reason: "ideal_61_75s",
      duration_seconds: duration,
    };
  }
  if (duration >= 58 && duration < 61) {
    return {
      status: "review",
      score: 6,
      reason: "near_minimum_duration_review",
      duration_seconds: duration,
    };
  }
  if (duration > 75 && duration <= 90 && !isLongformLane(story)) {
    return {
      status: "review",
      score: 4,
      reason: "extended_short_review",
      duration_seconds: duration,
    };
  }
  if (duration > 75 && duration <= 95 && isLongformLane(story)) {
    return {
      status: "review",
      score: 2,
      reason: "longform_or_briefing_lane",
      duration_seconds: duration,
    };
  }
  if (duration > 75) {
    return {
      status: "exclude",
      score: -30,
      reason: `duration_too_long_${duration.toFixed(2)}s`,
      duration_seconds: duration,
    };
  }
  return {
    status: "exclude",
    score: -25,
    reason: `duration_too_short_${duration.toFixed(2)}s`,
    duration_seconds: duration,
  };
}

function parseFailureList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
    } catch {
      // fall through
    }
    return [trimmed];
  }
  return [];
}

function qaFailures(story = {}) {
  const failures = [
    ...parseFailureList(story.qa_failures),
    ...parseFailureList(story.video_qa_failures),
    ...parseFailureList(story.content_qa_failures),
  ];
  if (story.qa_failed === true) failures.push("qa_failed=true");
  if (String(story.publish_status || "").toLowerCase() === "failed") {
    failures.push("publish_status=failed");
  }
  if (story.script_generation_status === "review_required") {
    failures.push(`script_generation_review:${story.script_review_reason || "validation_failed"}`);
  }
  const publishError = String(story.publish_error || "");
  if (/(content_qa|video_qa|audio_duration_too_long|script validation failed|duration_too_long)/i.test(publishError)) {
    failures.push(publishError);
  }
  return [...new Set(failures.filter(Boolean))];
}

function pendingAudioReason(story = {}) {
  const status = String(story.publish_status || "").toLowerCase();
  const error = String(story.publish_error || "");
  if (status !== "pending_audio" && !/^audio_generation_pending:/i.test(error)) {
    return null;
  }
  const gpuSaturated =
    /gpu_saturated/i.test(error) ||
    parseFailureList(story.qa_warnings).some((warning) =>
      /audio_generation_pending:gpu_saturated/i.test(warning),
    );
  if (gpuSaturated) return "pending_audio:gpu_saturated";
  const reason = error.match(/^audio_generation_pending:\s*([a-z0-9_-]+)/i);
  if (reason) return `pending_audio:${reason[1].toLowerCase()}`;
  return "pending_audio";
}

function parseStoryPublishAgeMs(story = {}, now = Date.now()) {
  const raw =
    story.approved_at ||
    story.produced_at ||
    story.created_at ||
    story.timestamp ||
    story.updated_at;
  const parsed = raw ? Date.parse(raw) : NaN;
  if (!Number.isFinite(parsed)) return null;
  return now - parsed;
}

function staleBacklogMaxAgeMs(env = process.env) {
  const days = Number(env.PUBLISH_STALE_BACKLOG_MAX_DAYS);
  const safeDays = Number.isFinite(days) && days >= 1 ? days : 7;
  return safeDays * 24 * 60 * 60 * 1000;
}

function storyIsStaleUnpublishedBacklog(story = {}, env = process.env, now = Date.now()) {
  if (env.ALLOW_STALE_BACKLOG_PUBLISH === "true") return false;
  const ageMs = parseStoryPublishAgeMs(story, now);
  if (ageMs === null) return false;
  return ageMs > staleBacklogMaxAgeMs(env);
}

function properNameHits(text) {
  const hits = new Set();
  const companyLower = lc(text);
  for (const company of COMPANY_TERMS) {
    if (companyLower.includes(lc(company))) hits.add(company);
  }
  const personLike = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-zA-Z'\u2019-]+){1,2}\b/g) || [];
  for (const hit of personLike) {
    if (!/^(Pulse Gaming|Source Breakdown|Confirmed Drop|Rumour Watch)$/.test(hit)) {
      hits.add(hit);
    }
  }
  return [...hits];
}

function scoreAnalyticsFit(story = {}, analyticsText = "") {
  const storyText = textForStory(story);
  const lower = lc(storyText);
  const analyticsLower = lc(analyticsText);
  const recommendationCorporate = analyticsLower.includes("corporate drama");
  const recommendationNamed = analyticsLower.includes("named");
  const recommendationConcrete = analyticsLower.includes("concrete");
  const names = properNameHits(storyText);
  const drama = matchedTerms(lower, CORPORATE_DRAMA_TERMS);
  const outcomes = matchedTerms(lower, CONCRETE_OUTCOME_TERMS);
  const speculative = matchedTerms(lower, SPECULATIVE_TERMS);

  let score = 0;
  const reasons = [];
  const penalties = [];

  if (names.length > 0) {
    score += recommendationNamed ? 16 : 10;
    reasons.push("named_people_or_companies");
  }
  if (drama.length > 0) {
    score += recommendationCorporate ? 18 : 10;
    reasons.push("corporate_drama");
  }
  if (outcomes.length > 0) {
    score += recommendationConcrete ? 16 : 10;
    reasons.push("concrete_outcome");
  }
  if (includesAny(lower, ["price", "$", "\u00a3", "date", "launch", "bundle", "release"])) {
    score += 7;
    reasons.push("specific_detail");
  }
  if (speculative.length > 0) {
    const penalty = Math.min(18, speculative.length * 6);
    score -= penalty;
    penalties.push("speculative_language");
  }
  if (/abstract industry|industry commentary|things are changing|future of gaming/i.test(storyText)) {
    score -= 8;
    penalties.push("abstract_industry_commentary");
  }

  return {
    score,
    reasons: [...new Set(reasons)],
    penalties: [...new Set(penalties)],
    matched_names: names.slice(0, 6),
    matched_drama_terms: [...new Set(drama)].slice(0, 6),
    matched_outcome_terms: [...new Set(outcomes)].slice(0, 6),
  };
}

function platformReadiness(story = {}) {
  const reasons = [];
  let score = 0;
  if (story.exported_path) {
    score += 16;
    reasons.push("mp4_present");
  } else {
    reasons.push("mp4_missing");
    score -= 20;
  }
  if (story.audio_path || story.voice_report_path || story.final_voice_report_path) {
    score += 4;
    reasons.push("audio_evidence_present");
  }
  if (story.image_path || story.thumbnail_path || story.cover_path || story.suggested_thumbnail_text) {
    score += 4;
    reasons.push("thumbnail_or_cover_present");
  }
  if (story.pinned_comment || story.caption || story.description) {
    score += 2;
    reasons.push("caption_or_description_present");
  }
  return { score, reasons };
}

function tiktokInboxReadiness(story = {}) {
  const duration = storyDurationSeconds(story);
  const reasons = [];
  let score = 0;
  if (duration != null && duration >= 60) {
    score += 8;
    reasons.push("duration_60_plus");
  } else {
    score -= 8;
    reasons.push("duration_under_60_or_unknown");
  }
  if (story.exported_path) {
    score += 4;
    reasons.push("mp4_present");
  }
  if (story.tiktok_inbox_ready === true || story.tiktok_dispatch_ready === true) {
    score += 8;
    reasons.push("explicit_tiktok_dispatch_ready");
  }
  if (story.do_not_reuse_for_tiktok_dispatch === true) {
    score -= 20;
    reasons.push("voice_or_render_marked_do_not_reuse");
  }
  return { score, reasons };
}

function approvalScore(story = {}) {
  if (story.auto_approved === true || story.auto_approved === 1) {
    return { score: 24, reason: "auto_approved" };
  }
  if (story.approved === true || story.approved === 1) {
    return { score: 16, reason: "approved" };
  }
  return { score: -40, reason: "not_approved" };
}

function exclusionReason(story = {}, options = {}) {
  const publicFields = existingPublicPlatformFields(story);
  if (publicFields.length > 0) {
    return `already_has_public_platform_id:${publicFields.join(",")}`;
  }
  const failures = qaFailures(story);
  if (failures.length > 0) return `qa_failure:${failures[0]}`;
  const approval = approvalScore(story);
  if (approval.score < 0) return approval.reason;
  const pendingAudio = pendingAudioReason(story);
  if (pendingAudio) return pendingAudio;
  if (!story.exported_path) return "missing_mp4";
  if (
    storyIsStaleUnpublishedBacklog(
      story,
      options.env || process.env,
      options.nowMs || Date.now(),
    )
  ) {
    return "stale_unpublished_backlog";
  }
  const duration = durationVerdict(story);
  if (duration.status === "exclude") return duration.reason;
  return null;
}

function scoreCandidate(story = {}, options = {}) {
  const analytics = scoreAnalyticsFit(story, options.analyticsText || "");
  const duration = durationVerdict(story);
  const approval = approvalScore(story);
  const platform = platformReadiness(story);
  const tiktok = tiktokInboxReadiness(story);
  const baseScore = Number(story.breaking_score || story.score || 0) * 0.12;
  const score = Math.round(
    approval.score +
      duration.score +
      analytics.score +
      platform.score +
      tiktok.score +
      baseScore,
  );
  const status = duration.status === "publish_ready" ? "publish_ready" : "review";
  const reasons = [
    approval.reason,
    duration.reason,
    ...analytics.reasons,
    ...platform.reasons,
    ...tiktok.reasons,
  ].filter(Boolean);
  const penalties = [...analytics.penalties];

  return {
    id: story.id,
    title: String(story.title || "").slice(0, 180),
    score,
    status,
    duration_seconds: duration.duration_seconds,
    approval: approval.reason,
    analytics_fit: analytics,
    platform_readiness: platform,
    tiktok_inbox_readiness: tiktok,
    reasons: [...new Set(reasons)],
    penalties: [...new Set(penalties)],
    source: {
      breaking_score: Number(story.breaking_score || 0),
      score: Number(story.score || 0),
      source_type: story.source_type || null,
      content_pillar: story.content_pillar || null,
      exported_path: story.exported_path || null,
    },
  };
}

function summariseQaResult(result = {}) {
  if (!result || typeof result !== "object") {
    return {
      result: "unknown",
      failures: ["qa_result_missing"],
      warnings: [],
    };
  }
  return {
    result: result.result || result.status || "unknown",
    failures: Array.isArray(result.failures) ? result.failures : [],
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
    reason: result.reason || null,
  };
}

function combinePreflightQa({ content, video, platform } = {}) {
  const checks = {
    content: summariseQaResult(content),
    video: summariseQaResult(video),
    platform: summariseQaResult(platform),
  };
  const blockers = [];
  const warnings = [];

  for (const [name, check] of Object.entries(checks)) {
    if (check.result === "fail") {
      blockers.push(
        `${name}:${check.failures[0] || check.reason || "failed"}`,
      );
    } else if (check.result === "warn") {
      warnings.push(`${name}:${check.warnings[0] || "warning"}`);
    } else if (check.result === "skip") {
      warnings.push(`${name}:skipped:${check.reason || "unknown"}`);
    }
  }

  return {
    status: blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warn" : "pass",
    blockers,
    warnings,
    checks,
  };
}

async function runPreflightQaForStory(story = {}, opts = {}) {
  const {
    runContentQa = require("../lib/services/content-qa").runContentQa,
    runVideoQa = require("../lib/services/video-qa").runVideoQa,
    runPlatformVideoQa = require("../lib/services/platform-video-qa").runPlatformVideoQa,
  } = opts;

  try {
    const content = await runContentQa(story, opts.contentQaOptions || {});
    const video = await runVideoQa(story.exported_path, opts.videoQaOptions || {});
    const platform = await runPlatformVideoQa(
      story.exported_path,
      opts.platformVideoQaOptions || {},
    );
    return combinePreflightQa({ content, video, platform });
  } catch (err) {
    return {
      status: "blocked",
      blockers: [`preflight_exception:${err.code || err.name || "unknown"}`],
      warnings: [],
      checks: {
        content: { result: "unknown", failures: [], warnings: [] },
        video: { result: "unknown", failures: [], warnings: [] },
        platform: { result: "unknown", failures: [], warnings: [] },
      },
    };
  }
}

async function attachPreflightQa(report = {}, stories = [], opts = {}) {
  const byId = new Map(
    (Array.isArray(stories) ? stories : [])
      .filter((story) => story && story.id)
      .map((story) => [story.id, story]),
  );
  const candidates = Array.isArray(report.candidates) ? report.candidates : [];
  for (const candidate of candidates) {
    const story = byId.get(candidate.id);
    if (!story) {
      candidate.preflight_qa = {
        status: "blocked",
        blockers: ["story_missing"],
        warnings: [],
      };
      candidate.status = "review";
      continue;
    }
    const preflight = await runPreflightQaForStory(story, opts);
    candidate.preflight_qa = preflight;
    if (preflight.status === "blocked") {
      candidate.status = "review";
      candidate.penalties = [...new Set([...(candidate.penalties || []), "preflight_qa_blocked"])];
      candidate.reasons = [...new Set([...(candidate.reasons || []), "preflight_qa_blocked"])];
    } else {
      candidate.reasons = [...new Set([...(candidate.reasons || []), `preflight_qa_${preflight.status}`])];
    }
  }
  report.preflight_qa = {
    enabled: true,
    mode: "read_only",
    candidates_checked: candidates.length,
    blocked: candidates.filter((candidate) => candidate.preflight_qa?.status === "blocked").length,
    warning: candidates.filter((candidate) => candidate.preflight_qa?.status === "warn").length,
    pass: candidates.filter((candidate) => candidate.preflight_qa?.status === "pass").length,
  };
  return report;
}

function buildNextPublishCandidatesReport(stories, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const limit = Number.isFinite(Number(options.limit))
    ? Math.max(1, Number(options.limit))
    : DEFAULT_LIMIT;
  const rows = Array.isArray(stories) ? stories : [];
  const candidates = [];
  const excluded = [];
  let pendingAudioCount = 0;

  for (const story of rows) {
    if (!story || typeof story !== "object") continue;
    const reason = exclusionReason(story, options);
    if (reason) {
      if (reason.startsWith("pending_audio")) pendingAudioCount += 1;
      excluded.push({
        id: story.id || "unknown",
        title: String(story.title || "").slice(0, 180),
        reason,
      });
      continue;
    }
    candidates.push(scoreCandidate(story, options));
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });

  return {
    generated_at: generatedAt,
    safety: {
      mode: "read_only",
      db_mutation: false,
      posting: false,
      oauth: false,
      token_printing: false,
    },
    analytics_source: options.analyticsPath || DEFAULT_ANALYTICS_PATH,
    analytics_summary: summariseAnalytics(options.analyticsText || ""),
    totals: {
      stories_seen: rows.length,
      candidates: candidates.length,
      excluded: excluded.length,
      returned: Math.min(limit, candidates.length),
      pending_audio: pendingAudioCount,
    },
    candidates: candidates.slice(0, limit),
    excluded: excluded.slice(0, Math.max(limit, 20)),
  };
}

function summariseAnalytics(text = "") {
  const lines = String(text || "").split(/\r?\n/);
  let latestRecommendation = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    const inline = line.match(/^#{0,6}\s*Tomorrow:\s*(.+)$/i);
    if (inline) {
      latestRecommendation = inline[1].trim();
      break;
    }
    if (/^#{0,6}\s*Tomorrow's recommendation\s*$/i.test(line)) {
      latestRecommendation =
        lines.slice(i + 1).map((next) => next.trim()).find((next) => next && !next.startsWith("#")) || null;
      break;
    }
  }
  return {
    available: String(text || "").trim().length > 0,
    latest_recommendation: latestRecommendation
      ? latestRecommendation.replace(/^#+\s*/, "").trim()
      : null,
    scoring_bias: [
      "named_people_or_companies",
      "corporate_drama",
      "concrete_outcome",
      "specific_detail",
      "penalise_speculation",
    ],
  };
}

function formatNextPublishCandidatesMarkdown(report = {}) {
  const lines = [];
  lines.push("# Next Publish Candidates");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || "unknown"}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("- read-only");
  lines.push("- no posting");
  lines.push("- no OAuth");
  lines.push("- no token printing");
  lines.push("- no DB mutation");
  lines.push("");
  const totals = report.totals || {};
  lines.push("## Totals");
  lines.push(`- stories seen: ${Number(totals.stories_seen || 0)}`);
  lines.push(`- candidates: ${Number(totals.candidates || 0)}`);
  lines.push(`- excluded: ${Number(totals.excluded || 0)}`);
  if (Number(totals.pending_audio || 0) > 0) {
    lines.push(`- pending audio: ${Number(totals.pending_audio || 0)}`);
  }
  lines.push("");
  lines.push("## Analytics Bias");
  const summary = report.analytics_summary || {};
  lines.push(`- available: ${summary.available ? "yes" : "no"}`);
  if (summary.latest_recommendation) {
    lines.push(`- latest: ${summary.latest_recommendation}`);
  }
  lines.push("");
  lines.push("## Ranked Candidates");
  const candidates = Array.isArray(report.candidates) ? report.candidates : [];
  if (!candidates.length) {
    lines.push("- none");
  } else {
    for (const [index, candidate] of candidates.entries()) {
      const duration =
        candidate.duration_seconds == null
          ? "unknown"
          : `${Number(candidate.duration_seconds).toFixed(2)}s`;
      const reasons = (candidate.reasons || []).slice(0, 6).join(", ");
      const penalties = (candidate.penalties || []).join(", ") || "none";
      const preflight = candidate.preflight_qa
        ? ` | preflight=${candidate.preflight_qa.status}`
        : "";
      lines.push(
        `${index + 1}. ${candidate.id} - ${candidate.score} - ${candidate.status} - ${duration}${preflight}`,
      );
      lines.push(`   ${candidate.title || ""}`);
      lines.push(`   reasons: ${reasons || "none"}`);
      lines.push(`   penalties: ${penalties}`);
      if (candidate.preflight_qa?.blockers?.length) {
        lines.push(`   preflight blockers: ${candidate.preflight_qa.blockers.join(", ")}`);
      }
      if (candidate.preflight_qa?.warnings?.length) {
        lines.push(`   preflight warnings: ${candidate.preflight_qa.warnings.join(", ")}`);
      }
    }
  }
  lines.push("");
  lines.push("## Excluded Sample");
  const excluded = Array.isArray(report.excluded) ? report.excluded : [];
  if (!excluded.length) {
    lines.push("- none");
  } else {
    for (const row of excluded.slice(0, 12)) {
      lines.push(`- ${row.id}: ${row.reason} - ${row.title || ""}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const args = {
    json: false,
    help: false,
    limit: DEFAULT_LIMIT,
    analyticsPath: DEFAULT_ANALYTICS_PATH,
    preflightQa: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--preflight-qa" || arg === "--qa") args.preflightQa = true;
    else if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--limit") args.limit = Number(argv[++i] || DEFAULT_LIMIT);
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.split("=")[1] || DEFAULT_LIMIT);
    else if (arg === "--analytics") args.analyticsPath = argv[++i] || args.analyticsPath;
    else if (arg.startsWith("--analytics=")) args.analyticsPath = arg.slice("--analytics=".length);
  }
  return args;
}

async function readAnalytics(pathname) {
  try {
    if (await fs.pathExists(pathname)) return fs.readFile(pathname, "utf8");
  } catch {
    // report as unavailable below
  }
  return "";
}

async function loadStories() {
  const db = require("../lib/db");
  return db.getStories();
}

async function runCli(argv = process.argv) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(
      "Usage: node tools/next-publish-candidates.js [--json] [--limit N] [--analytics PATH] [--preflight-qa]\n",
    );
    return { exitCode: 0 };
  }

  const [stories, analyticsText] = await Promise.all([
    loadStories(),
    readAnalytics(args.analyticsPath),
  ]);
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    analyticsPath: args.analyticsPath,
    limit: args.limit,
  });
  if (args.preflightQa) {
    await attachPreflightQa(report, stories);
  }
  const markdown = formatNextPublishCandidatesMarkdown(report);
  await fs.ensureDir(OUT);
  const jsonPath = path.join(OUT, "next_publish_candidates.json");
  const mdPath = path.join(OUT, "next_publish_candidates.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, markdown, "utf8");

  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(markdown);
  process.stderr.write(`[next-publish-candidates] json=${path.relative(ROOT, jsonPath)}\n`);
  process.stderr.write(`[next-publish-candidates] md=${path.relative(ROOT, mdPath)}\n`);
  return { exitCode: 0, report };
}

if (require.main === module) {
  require("dotenv").config({ override: true });
  runCli().catch((err) => {
    process.stderr.write(`[next-publish-candidates] ${err.stack || err.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildNextPublishCandidatesReport,
  formatNextPublishCandidatesMarkdown,
  scoreCandidate,
  scoreAnalyticsFit,
  attachPreflightQa,
  combinePreflightQa,
  durationVerdict,
  existingPublicPlatformFields,
  runPreflightQaForStory,
  summariseQaResult,
  runCli,
};
