"use strict";

const path = require("node:path");

const { evaluatePulseGamingTopicality } = require("../topicality-gate");

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function lower(value) {
  return cleanText(value).toLowerCase();
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function storyId(row = {}) {
  return cleanText(row.story_id || row.id);
}

function commandSafeStoryId(id = "") {
  return /^[a-z0-9_.:-]+$/i.test(cleanText(id));
}

function rowTimestampMs(row = {}) {
  const candidates = [
    row.source_published_at,
    row.published_at,
    row.created_at,
    row.timestamp,
    row.scored_at,
  ];
  for (const candidate of candidates) {
    const value = cleanText(candidate);
    if (!value) continue;
    const ms = new Date(value.replace(" ", "T")).getTime();
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

function sourceAgeHours(row = {}, now = new Date()) {
  const timestamp = rowTimestampMs(row);
  if (!timestamp) return null;
  return Math.max(0, (now.getTime() - timestamp) / 36e5);
}

function urlLooksSourceBacked(value = "") {
  const url = cleanText(value);
  if (!/^https?:\/\//i.test(url)) return false;
  if (/reddit\.com|redd\.it|v\.redd\.it/i.test(url)) return false;
  if (/\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(url)) return false;
  return true;
}

function isSourceBacked(row = {}) {
  if (lower(row.source_type) === "rss") {
    return Boolean(cleanText(row.url || row.article_url || row.source_url));
  }
  return (
    urlLooksSourceBacked(row.article_url) ||
    urlLooksSourceBacked(row.source_url) ||
    urlLooksSourceBacked(row.url)
  );
}

function hasPublishedPlatformPost(row = {}) {
  return Boolean(
    Number(row.published_platform_post_count || 0) > 0 ||
      row.youtube_post_id ||
      row.youtube_url ||
      row.instagram_media_id ||
      row.facebook_post_id ||
      row.tiktok_post_id ||
      row.twitter_post_id ||
      row.published_at,
  );
}

function topicalityRepairVerdict(row = {}) {
  return evaluatePulseGamingTopicality(
    {
      title: row.title,
      body: [
        row.body,
        row.description,
        row.summary,
        row.full_script,
        row.decision_reason,
      ]
        .filter(Boolean)
        .join(" "),
      subreddit: row.subreddit,
      flair: row.flair,
      content_pillar: row.content_pillar,
    },
    { channelId: row.channel_id || "pulse-gaming" },
  );
}

function hasStrongGamingRepairSignal(_row = {}, topicality = {}) {
  const weakStandaloneSignals = new Set([
    "sequel",
    "remake",
    "remaster",
    "update",
    "patch",
    "developer",
    "developers",
    "publisher",
    "publishers",
    "trailer",
    "price cut",
  ]);
  return asArray(topicality.matchedGamingSignals).some((signal) => !weakStandaloneSignals.has(lower(signal)));
}

function blockerText(row = {}) {
  const inputs = parseJson(row.inputs, {});
  const hardStops = parseJson(row.hard_stops, row.hard_stops || []);
  return cleanText([
    row.decision_reason,
    row.script_review_reason,
    row.publish_error,
    row.script_generation_status,
    JSON.stringify(inputs || {}),
    JSON.stringify(hardStops || []),
  ].filter(Boolean).join(" "));
}

function hardStopCount(row = {}) {
  const hardStops = parseJson(row.hard_stops, []);
  return asArray(hardStops).length;
}

function hasScriptQualityBlocker(row = {}) {
  const text = blockerText(row);
  return (
    /script_quality_score\s+\d+\s+below/i.test(text) ||
    /script_review/i.test(text) ||
    /script_generation/i.test(text) ||
    /actual spoken word count/i.test(text) ||
    /spoken word count/i.test(text) ||
    /\bword[_ -]?count\b/i.test(text) ||
    /\bduration[_ -]?(?:too[_ -]?)?long\b/i.test(text) ||
    /\bruntime\b/i.test(text) ||
    /hook starts/i.test(text) ||
    /banned word/i.test(text) ||
    /repeated phrase/i.test(text) ||
    /vague_filler/i.test(text) ||
    /internal_qa_language/i.test(text) ||
    /placeholder_title/i.test(text)
  );
}

function isCommerceDealsRoundup(row = {}) {
  const text = lower([row.title, row.description, row.summary, row.body].filter(Boolean).join(" "));
  return (
    /\b(?:best deals today|today'?s top deals|deal roundup|gift cards?|prime day|black friday|cyber monday)\b/i.test(text) ||
    /\b(?:going for as low as|as low as \$|from \$\d+|save on|discounted?|bundle deal|deal during)\b/i.test(text) ||
    /\bwoot\b/i.test(text) ||
    /\bairpods\b/i.test(text) ||
    (/\bdeals?\b/i.test(text) && /\b(?:lego|switch 2 cameras?|switch 2|console|bundle|accessor(?:y|ies)|headset|controller)\b/i.test(text))
  );
}

function hasDirectMotionRunway(row = {}) {
  const buckets = [
    row.direct_media_candidates,
    row.media_candidates,
    row.trusted_footage_references,
    row.footage_references,
    parseJson(row.direct_media_candidates_json, []),
    parseJson(row.media_candidates_json, []),
    parseJson(row.trusted_footage_references_json, []),
    parseJson(row.footage_references_json, []),
  ];
  const inputs = parseJson(row.inputs, {});
  buckets.push(
    inputs.direct_media_candidates,
    inputs.media_candidates,
    inputs.trusted_footage_references,
    inputs.footage_references,
  );

  return buckets.flatMap((bucket) => asArray(bucket)).some((candidate) => {
    const url = cleanText(
      candidate?.direct_media_url ||
        candidate?.approved_direct_media_url ||
        candidate?.media_url ||
        candidate?.video_url ||
        candidate?.url,
    );
    if (!url) return false;
    const sourceType = cleanText(candidate?.source_type || candidate?.type || candidate?.source_kind);
    return /\b(?:official|direct|video|media|trailer|gameplay|storefront|steam|youtube)\b/i.test(
      `${sourceType} ${url}`,
    );
  });
}

function isMotionPoorRetailOrServiceRow(row = {}) {
  if (hasDirectMotionRunway(row)) return false;
  const text = lower([
    row.title,
    row.description,
    row.summary,
    row.body,
    row.source_title,
    row.article_title,
    row.url,
    row.article_url,
    row.source_url,
  ].filter(Boolean).join(" "));
  return (
    /\b(?:console\s+prices?|price\s+(?:rise|rises|increase|increases|update|hike|hikes)|hardware\s+prices?|2tb model discontinued)\b/i.test(text) ||
    /\b(?:physical\s+release|physical\s+edition|digital[-\s]?only|not\s+at\s+launch|not\s+months\s+later|disc\s+release)\b/i.test(text) ||
    /\b(?:lowest\s+price|price\s+ever|price\s+tag\s+quiz|save\s+even\s+more|simple\s+trick\s+to\s+save|discount|sale|bundle)\b/i.test(text) ||
    /\b(?:store\s+listings?|playstation\s+listings?|pricey\s+ports?|pricing\s+questions?|price\s+trust)\b/i.test(text) ||
    /\b(?:free\s+play\s+days|subscription|game\s+pass|playstation\s+plus|ps\s+plus|switch\s+online|weekend\s+trap)\b/i.test(text)
  );
}

function candidateSourceUrl(candidate = {}) {
  return cleanText(
    candidate.source_manifest?.primary_source?.url ||
      candidate.source?.url ||
      candidate.source_url ||
      candidate.article_url ||
      candidate.url,
  );
}

function candidateArtifactDir(candidate = {}) {
  const value = cleanText(
    candidate.artifact_dir ||
      candidate.scheduler_bridge_artifact_dir ||
      candidate.source?.artifact_dir ||
      candidate.source?.artifact_path ||
      candidate.source?.exported_path ||
      candidate.exported_path ||
      candidate.video_path,
  );
  if (!value) return "";
  if (/\.(?:mp4|mov|m4v|webm|json|srt|vtt)$/i.test(value)) return path.dirname(value);
  return value;
}

function commandArg(value = "") {
  return `"${String(value || "").replace(/"/g, '\\"')}"`;
}

function transcriptAudienceRepairRows(transcriptAudienceReport = {}, candidateReport = {}) {
  const candidatesById = new Map(
    asArray(candidateReport.candidates).map((candidate) => [cleanText(candidate.id), candidate]),
  );
  return asArray(transcriptAudienceReport?.stories)
    .filter((story) => cleanText(story.verdict) && cleanText(story.verdict) !== "pass")
    .map((story) => {
      const id = cleanText(story.story_id || story.id);
      const candidate = candidatesById.get(id);
      return {
        story_id: id,
        title: cleanText(story.title || candidate?.title),
        total: Number(candidate?.score || story.viral_score || 0),
        decision: "review",
        source_url: candidateSourceUrl(candidate),
        artifact_dir: candidateArtifactDir(candidate),
        blocker_reason: asArray(story.blockers).join("; ") || "transcript_audience_rewrite_required",
        current_candidate: Boolean(candidate),
      };
    })
    .filter((row) => row.story_id && row.current_candidate && commandSafeStoryId(row.story_id));
}

function repairWorkOrderForTranscriptRow(row = {}) {
  const id = row.story_id;
  const artifactDir = cleanText(row.artifact_dir);
  if (artifactDir) {
    const auditCommand = `npm run ops:transcript-audience-audit -- --artifact-dir ${commandArg(artifactDir)} --json`;
    return {
      story_id: id,
      title: cleanText(row.title),
      score: Number(row.total || 0),
      source_url: cleanText(row.source_url),
      artifact_dir: artifactDir,
      required_artefact_path: path.join(artifactDir, "canonical_story_manifest.json"),
      source_age_hours: row.source_age_hours ?? null,
      blocker_type: "transcript_audience_rewrite_required",
      blocker_reason: cleanText(row.blocker_reason).slice(0, 500),
      repair_lane: "bridge_transcript_artifact_rewrite_required",
      recommended_command: auditCommand,
      post_repair_validation_command: auditCommand,
      expected_output: [
        "bridge artifact transcript rewrite work order",
        "mass-audience transcript audit pass after regeneration",
        "transcript coherence pass after regeneration",
        "fresh audio, timestamps and render regenerated before scheduler promotion",
      ],
      auto_repairable: false,
      operator_approval_required: false,
      db_mutation_required: false,
      automation_gap_required: true,
    };
  }
  const command =
    `npm run ops:reprocess-script-failures -- --story-id ${id} --force-story --source-bound-only --dry-run --json`;
  return {
    story_id: id,
    title: cleanText(row.title),
    score: Number(row.total || 0),
    source_url: cleanText(row.source_url),
    source_age_hours: row.source_age_hours ?? null,
    blocker_type: "transcript_audience_rewrite_required",
    blocker_reason: cleanText(row.blocker_reason).slice(0, 500),
    repair_lane: "source_bound_script_rewrite",
    recommended_command: command,
    post_repair_validation_command: command,
    expected_output: [
      "viewer-facing source-bound rewrite",
      "mass-audience transcript audit pass",
      "transcript coherence pass",
      "no DB mutation in dry-run mode",
    ],
    auto_repairable: true,
    operator_approval_required: false,
    db_mutation_required: false,
  };
}

function selectionHoldReason(row = {}, {
  now = new Date(),
  maxAgeHours = 7 * 24,
  minScore = 65,
} = {}) {
  const id = storyId(row);
  if (!id) return "missing_story_id";
  if (!commandSafeStoryId(id)) return "unsafe_story_id_for_repair_command";
  if (lower(row.decision) !== "review") return "decision_not_review";
  if (Number(row.total || 0) < minScore) return `score_below_threshold:${Number(row.total || 0)}`;
  if (hardStopCount(row) > 0) return "hard_stop_present";
  if (!isSourceBacked(row)) return "not_source_backed";
  if (isCommerceDealsRoundup(row)) return "commerce_deals_roundup_not_editorial_story";
  if (isMotionPoorRetailOrServiceRow(row)) return "motion_runway_unfit_for_automatic_refill";
  const topicality = topicalityRepairVerdict(row);
  if (topicality.decision === "reject") return `topicality_reject:${topicality.reason}`;
  if (topicality.decision === "review") return `topicality_review:${topicality.reason}`;
  if (!hasStrongGamingRepairSignal(row, topicality)) return "topicality_reject:weak_generic_gaming_signal";
  if (hasPublishedPlatformPost(row)) return "already_has_platform_post";
  const age = sourceAgeHours(row, now);
  if (age === null) return "unknown_source_age";
  if (age > maxAgeHours) return `source_age_expired:${Math.round(age)}h`;
  if (!hasScriptQualityBlocker(row)) return "not_script_quality_blocker";
  return "";
}

function selectFreshReviewScriptRepairRows(rows = [], {
  now = new Date(),
  maxAgeHours = 7 * 24,
  minScore = 65,
  limit = 10,
} = {}) {
  const generatedAt = now instanceof Date ? now : new Date(now);
  const max = Math.max(0, Number(limit) || 0);
  return asArray(rows)
    .map((row) => {
      const age = sourceAgeHours(row, generatedAt);
      return {
        ...row,
        story_id: storyId(row),
        source_age_hours: age === null ? null : Math.round(age * 10) / 10,
        script_blocker_reason: blockerText(row),
      };
    })
    .filter((row) => selectionHoldReason(row, { now: generatedAt, maxAgeHours, minScore }) === "")
    .sort((a, b) => {
      const scoreDiff = Number(b.total || 0) - Number(a.total || 0);
      if (scoreDiff) return scoreDiff;
      return (rowTimestampMs(b) || 0) - (rowTimestampMs(a) || 0);
    })
    .slice(0, max || undefined);
}

function buildFreshReviewScriptRepairPlan({
  rows = [],
  transcriptAudienceReport = null,
  candidateReport = {},
  now = new Date(),
  maxAgeHours = 7 * 24,
  minScore = 65,
  limit = 10,
} = {}) {
  const generatedAt = now instanceof Date ? now : new Date(now);
  const selected = selectFreshReviewScriptRepairRows(rows, {
    now: generatedAt,
    maxAgeHours,
    minScore,
    limit,
  });
  const selectedIds = new Set(selected.map((row) => row.story_id));
  const held = asArray(rows)
    .map((row) => ({
      story_id: storyId(row),
      title: cleanText(row.title),
      total: Number(row.total || 0),
      decision: cleanText(row.decision),
      hold_reason: selectedIds.has(storyId(row))
        ? ""
        : selectionHoldReason(row, { now: generatedAt, maxAgeHours, minScore }),
    }))
    .filter((row) => row.story_id && row.hold_reason);

  const dbWorkOrders = selected.map((row) => {
    const id = row.story_id;
    const command =
      `npm run ops:reprocess-script-failures -- --story-id ${id} --force-story --source-bound-only --dry-run --json`;
    return {
      story_id: id,
      title: cleanText(row.title),
      score: Number(row.total || 0),
      source_url: cleanText(row.article_url || row.source_url || row.url),
      source_age_hours: row.source_age_hours,
      blocker_type: "fresh_review_script_quality_blocker",
      blocker_reason: cleanText(row.decision_reason || row.script_blocker_reason).slice(0, 500),
      repair_lane: "source_bound_script_rewrite",
      recommended_command: command,
      post_repair_validation_command: command,
      expected_output: [
        "source-bound viewer-facing script",
        "transcript coherence pass",
        "no DB mutation in dry-run mode",
      ],
      auto_repairable: true,
      operator_approval_required: false,
      db_mutation_required: false,
    };
  });
  const transcriptRows = transcriptAudienceRepairRows(transcriptAudienceReport, candidateReport);
  const transcriptWorkOrders = transcriptRows.map(repairWorkOrderForTranscriptRow);
  const seenWorkOrders = new Set();
  const workOrders = [...transcriptWorkOrders, ...dbWorkOrders].filter((item) => {
    const key = `${item.story_id}:${item.blocker_type}`;
    if (seenWorkOrders.has(key)) return false;
    seenWorkOrders.add(key);
    return true;
  });

  return {
    schema_version: 1,
    mode: "FRESH_REVIEW_SCRIPT_REPAIR_PLAN",
    generated_at: generatedAt.toISOString(),
    policy: {
      max_source_age_hours: maxAgeHours,
      min_score: minScore,
      source_backed_only: true,
      decision_required: "review",
      db_mutation: false,
      posting: false,
      oauth: false,
      token_mutation: false,
    },
    summary: {
      rows_seen: asArray(rows).length,
      selected_count: workOrders.length,
      db_selected_count: dbWorkOrders.length,
      transcript_backlog_selected_count: transcriptWorkOrders.length,
      held_count: held.length,
    },
    source_bound_rewrite_work_orders: workOrders,
    held_rows: held,
  };
}

function fetchFreshReviewScriptRepairRows({
  db = null,
  now = new Date(),
  maxAgeHours = 7 * 24,
  limit = 80,
} = {}) {
  const liveDb = db || require("../db").getDb();
  const cutoff = new Date((now instanceof Date ? now : new Date(now)).getTime() - maxAgeHours * 36e5).toISOString();
  return liveDb
    .prepare(`
      WITH latest AS (
        SELECT story_id, MAX(scored_at) AS latest_scored_at
        FROM story_scores
        GROUP BY story_id
      )
      SELECT
        s.*,
        sc.total,
        sc.decision,
        sc.decision_reason,
        sc.inputs,
        sc.hard_stops,
        sc.scored_at,
        (
          SELECT COUNT(*)
          FROM platform_posts pp
          WHERE pp.story_id = s.id
            AND (
              pp.status = 'published'
              OR pp.external_id IS NOT NULL
            )
        ) AS published_platform_post_count
      FROM story_scores sc
      JOIN latest
        ON latest.story_id = sc.story_id
       AND latest.latest_scored_at = sc.scored_at
      JOIN stories s ON s.id = sc.story_id
      WHERE sc.decision = 'review'
        AND datetime(COALESCE(s.created_at, s.timestamp, sc.scored_at)) >= datetime(?)
      ORDER BY sc.total DESC, sc.scored_at DESC
      LIMIT ?
    `)
    .all(cutoff, Math.max(1, Number(limit) || 80));
}

function formatFreshReviewScriptRepairMarkdown(plan = {}) {
  const lines = [
    "# Fresh Review Script Repair",
    "",
    `Generated: ${plan.generated_at || ""}`,
    `Selected: ${plan.summary?.selected_count || 0}`,
    `Held: ${plan.summary?.held_count || 0}`,
    "",
    "No posting, OAuth/token changes or DB mutation are authorised by this plan.",
    "",
    "## Selected",
  ];
  for (const item of asArray(plan.source_bound_rewrite_work_orders)) {
    lines.push(`- ${item.story_id}: ${item.title} (${item.score})`);
  }
  if (!asArray(plan.source_bound_rewrite_work_orders).length) lines.push("- none");
  lines.push("");
  lines.push("## Held");
  for (const item of asArray(plan.held_rows).slice(0, 20)) {
    lines.push(`- ${item.story_id}: ${item.hold_reason}`);
  }
  if (!asArray(plan.held_rows).length) lines.push("- none");
  return `${lines.join("\n")}\n`;
}

module.exports = {
  buildFreshReviewScriptRepairPlan,
  fetchFreshReviewScriptRepairRows,
  formatFreshReviewScriptRepairMarkdown,
  hasScriptQualityBlocker,
  selectFreshReviewScriptRepairRows,
  selectionHoldReason,
};
