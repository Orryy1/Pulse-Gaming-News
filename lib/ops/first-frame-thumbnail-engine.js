"use strict";

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "for",
  "from",
  "gets",
  "got",
  "has",
  "in",
  "into",
  "is",
  "it",
  "just",
  "more",
  "of",
  "on",
  "or",
  "the",
  "this",
  "to",
  "turns",
  "with",
]);

const CONNECTOR_ENDINGS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "for",
  "from",
  "has",
  "in",
  "into",
  "is",
  "of",
  "on",
  "or",
  "the",
  "to",
  "turns",
  "with",
]);

const REQUIRED_ENABLED_PLATFORMS = [
  "youtube_shorts",
  "instagram_reels",
  "facebook_reels",
];

const PLATFORM_MANIFEST_KEYS = {
  youtube_shorts: ["youtube_shorts", "youtube"],
  instagram_reels: ["instagram_reels", "instagram"],
  facebook_reels: ["facebook_reels", "facebook"],
};

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normaliseToken(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value, { includeStopwords = false } = {}) {
  const raw = normaliseToken(value)
    .split(/\s+/)
    .map((token) => (token.length > 4 && token.endsWith("s") && !token.endsWith("ss") ? token.slice(0, -1) : token))
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  return includeStopwords ? raw : raw.filter((token) => !STOPWORDS.has(token));
}

function unique(values) {
  return [...new Set(asArray(values).filter(Boolean))];
}

function wrapLineCount(text, maxChars = 15) {
  const words = clean(text).split(/\s+/).filter(Boolean);
  let lines = 0;
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && next.length > maxChars) {
      lines += 1;
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines += 1;
  return lines;
}

function duplicateMeaningfulTokens(value) {
  const counts = new Map();
  for (const token of tokens(value)) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([token]) => token);
}

function analyseCoverText(value) {
  const text = clean(value);
  const allTokens = tokens(text, { includeStopwords: true });
  const meaningful = tokens(text);
  const blockers = [];
  const warnings = [];
  const repeated = duplicateMeaningfulTokens(text);
  const lastToken = allTokens[allTokens.length - 1] || "";
  const maxWordLength = allTokens.reduce((max, token) => Math.max(max, token.length), 0);
  const lineCount = wrapLineCount(text);

  if (!text) blockers.push("cover_text_missing");
  if (repeated.length) blockers.push("cover_text_repeated_token");
  if (/[,:;\-|]$/.test(text) || /\.{2,}$/.test(text) || CONNECTOR_ENDINGS.has(lastToken)) {
    blockers.push("cover_text_dangling_or_truncated");
  }
  if (text.length > 72 || lineCount > 4) blockers.push("cover_text_not_mobile_readable");
  else if (text.length > 48 || lineCount > 3 || maxWordLength > 16 || meaningful.length > 8) {
    warnings.push("cover_text_mobile_readability_risk");
  }

  const score = Math.max(
    0,
    Math.min(
      100,
      100 -
        blockers.length * 28 -
        warnings.length * 12 -
        Math.max(0, text.length - 42) * 0.6 -
        Math.max(0, lineCount - 2) * 8,
    ),
  );

  return {
    text,
    verdict: blockers.length ? "fail" : warnings.length ? "warn" : "pass",
    score: Math.round(score),
    token_count: allTokens.length,
    max_word_length: maxWordLength,
    estimated_line_count: lineCount,
    repeated_tokens: repeated,
    blockers,
    warnings,
  };
}

function actionId(action) {
  return `${clean(action.story_id || action.storyId)}:${clean(action.platform)}`;
}

function storyId(story) {
  return clean(story?.id || story?.story_id || story?.storyId);
}

function titleForStory(story = {}, canonical = {}) {
  return clean(
    canonical.selected_title ||
      canonical.short_title ||
      story.title ||
      story.suggested_title,
  );
}

function platformOutputFor(platformManifest = {}, platform) {
  const keys = PLATFORM_MANIFEST_KEYS[platform] || [platform];
  for (const key of keys) {
    const output = platformManifest?.outputs?.[key] || platformManifest?.platforms?.[key] || platformManifest?.[key];
    if (output && typeof output === "object") return output;
  }
  return null;
}

function platformCoverHeadline(platformManifest = {}, platforms = REQUIRED_ENABLED_PLATFORMS) {
  for (const platform of platforms) {
    const output = platformOutputFor(platformManifest, platform);
    const headline = clean(
      output?.cover_frame?.headline ||
        output?.cover?.headline ||
        output?.cover_headline ||
        output?.thumbnail_headline,
    );
    if (headline) return headline;
  }
  return "";
}

function coverTextForStory(story = {}, canonical = {}, platformManifest = {}) {
  return clean(
    platformCoverHeadline(platformManifest) ||
      canonical.thumbnail_headline ||
      canonical.thumbnail_text ||
      story.thumbnail_headline ||
      story.suggested_thumbnail_text ||
      titleForStory(story, canonical),
  );
}

function subjectForStory(story = {}, canonical = {}) {
  return clean(
    canonical.canonical_subject ||
      canonical.canonical_game ||
      story.canonical_subject ||
      story.game ||
      story.title,
  );
}

function tokenOverlap(left, right) {
  const l = new Set(tokens(left));
  const r = new Set(tokens(right));
  return [...l].filter((token) => r.has(token));
}

function titleSourceParity({ story = {}, canonical = {}, actions = [], platformManifest = {} } = {}) {
  const subject = subjectForStory(story, canonical);
  const title = titleForStory(story, canonical);
  const publicTitle = clean(story.title || story.suggested_title || title);
  const cover = coverTextForStory(story, canonical, platformManifest);
  const actionTitles = actions.map((action) => clean(action.title)).join(" ");
  const primarySource = clean(
    canonical.primary_source ||
      canonical.official_source ||
      canonical.discovery_source ||
      story.source?.source_type ||
      story.subreddit,
  );
  const blockers = [];
  const warnings = [];
  const subjectTitleOverlap = tokenOverlap(subject, title);
  const subjectPublicTitleOverlap = tokenOverlap(subject, publicTitle);
  const subjectCoverOverlap = tokenOverlap(subject, cover);
  const actionOverlap = actionTitles ? tokenOverlap(subject, actionTitles) : [];

  if (!subjectTitleOverlap.length || !subjectCoverOverlap.length) {
    blockers.push("title_source_parity_failed");
  }
  if (publicTitle && !subjectPublicTitleOverlap.length) {
    blockers.push("title_source_parity_failed");
  }
  if (actionTitles && !actionOverlap.length) blockers.push("title_source_parity_failed");
  if (!primarySource) warnings.push("primary_source_label_missing");
  if (actions.length && !actionOverlap.length) warnings.push("platform_title_subject_overlap_missing");

  return {
    verdict: blockers.length ? "fail" : warnings.length ? "warn" : "pass",
    subject,
    title,
    public_title: publicTitle,
    cover_text: cover,
    primary_source: primarySource || null,
    overlaps: {
      subject_title: subjectTitleOverlap,
      subject_public_title: subjectPublicTitleOverlap,
      subject_cover: subjectCoverOverlap,
      subject_platform_titles: actionOverlap,
    },
    blockers: unique(blockers),
    warnings,
  };
}

function sourceVideoForStory(story = {}) {
  return clean(
    story?.source?.exported_path ||
      story?.source?.video_path ||
      story?.exported_path ||
      story?.video_path,
  );
}

function buildPlatformCoverMatrix({
  story = {},
  actions = [],
  platformManifest = {},
  requiredPlatforms = REQUIRED_ENABLED_PLATFORMS,
} = {}) {
  const id = storyId(story);
  const rows = requiredPlatforms.map((platform) => {
    const row = actions.find((action) => clean(action.platform) === platform) || null;
    const output = platformOutputFor(platformManifest, platform);
    const platformSpecificHeadline = clean(
      output?.cover_frame?.headline ||
        output?.cover?.headline ||
        output?.cover_headline ||
        output?.thumbnail_headline,
    );
    const packageHeadline = platformSpecificHeadline || platformCoverHeadline(platformManifest);
    const cover = clean(
      row?.cover_frame_source ||
        row?.cover_path ||
        row?.thumbnail_path ||
        output?.cover_frame?.source ||
        output?.cover?.source ||
        sourceVideoForStory(story),
    );
    const video = clean(row?.video_path || row?.exported_path || output?.variant_video_path || sourceVideoForStory(story));
    const ready = Boolean((row && cover) || (output && cover && packageHeadline));
    return {
      platform,
      action_id: row ? actionId(row) : `${id}:${platform}`,
      present: Boolean(row),
      package_present: Boolean(output),
      cover_headline: packageHeadline || null,
      cover_frame_source: cover || null,
      video_path: video || null,
      ready,
      blocker: ready
        ? null
        : row && !cover
          ? `platform_cover_source_missing:${platform}`
          : !output && !row
            ? `platform_cover_source_missing:${platform}`
            : output && !packageHeadline
              ? `platform_cover_headline_missing:${platform}`
              : `platform_cover_source_missing:${platform}`,
    };
  });
  const blockers = rows.filter((row) => !row.ready).map((row) => row.blocker);
  return {
    required_enabled_platforms: requiredPlatforms,
    ready_enabled_platforms: rows.filter((row) => row.ready).length,
    missing_enabled_platforms: rows.filter((row) => !row.ready).map((row) => row.platform),
    rows,
    verdict: blockers.length ? "fail" : "pass",
    blockers,
  };
}

function scoreFirstFrameThumbnailStory({
  story = {},
  canonicalManifest = {},
  platformManifest = {},
  actions = [],
  requiredPlatforms = REQUIRED_ENABLED_PLATFORMS,
} = {}) {
  const id = storyId(story) || clean(canonicalManifest.story_id);
  const coverText = coverTextForStory(story, canonicalManifest, platformManifest);
  const cover = analyseCoverText(coverText);
  const parity = titleSourceParity({ story, canonical: canonicalManifest, actions, platformManifest });
  const platformMatrix = buildPlatformCoverMatrix({
    story: { ...story, id },
    actions,
    platformManifest,
    requiredPlatforms,
  });

  const blockers = unique([
    ...cover.blockers,
    ...parity.blockers,
    ...platformMatrix.blockers,
  ]);
  const warnings = unique([
    ...cover.warnings,
    ...parity.warnings,
  ]);
  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        cover.score * 0.45 +
          (parity.verdict === "pass" ? 30 : parity.verdict === "warn" ? 20 : 0) +
          (platformMatrix.verdict === "pass" ? 25 : 8),
      ),
    ),
  );

  return {
    story_id: id,
    title: titleForStory(story, canonicalManifest),
    canonical_subject: subjectForStory(story, canonicalManifest),
    verdict: blockers.length ? "red" : warnings.length ? "amber" : "green",
    score,
    mobile_readability: cover,
    title_source_parity: parity,
    platform_cover_matrix: platformMatrix,
    blockers,
    warnings,
    next_action: blockers.length
      ? "repair_first_frame_cover_and_platform_covers_before_publish"
      : warnings.length
        ? "review_first_frame_cover_before_next_publish_window"
        : "cover_ready_for_guarded_scheduler",
  };
}

function buildRepairBacklog(rows) {
  return rows
    .filter((row) => row.verdict !== "green")
    .map((row) => ({
      story_id: row.story_id,
      blocker_type: "first_frame_thumbnail_quality",
      severity: row.verdict === "red" ? "high" : "medium",
      blockers: row.blockers,
      warnings: row.warnings,
      recommended_command: `npm run ops:first-frame-thumbnail -- --story-id ${row.story_id}`,
      expected_output:
        "Mobile-readable platform cover matrix with title/source parity and no repeated or dangling first-frame text.",
      db_mutation_required: false,
      external_posting_risk: false,
      operator_approval_required: row.verdict === "amber",
      post_repair_validation_command: "npm run ops:first-frame-thumbnail -- --json",
    }));
}

function buildFirstFrameThumbnailReport({
  generatedAt = new Date().toISOString(),
  candidates = [],
  canonicalManifests = {},
  platformManifests = {},
  actions = [],
  requiredPlatforms = REQUIRED_ENABLED_PLATFORMS,
} = {}) {
  const candidateRows = asArray(candidates);
  const actionsByStory = new Map();
  for (const action of asArray(actions)) {
    const id = clean(action.story_id || action.storyId);
    if (!id) continue;
    if (!actionsByStory.has(id)) actionsByStory.set(id, []);
    actionsByStory.get(id).push(action);
  }

  const rows = candidateRows.map((story) => {
    const id = storyId(story);
    return scoreFirstFrameThumbnailStory({
      story,
      canonicalManifest: canonicalManifests[id] || {},
      platformManifest: platformManifests[id] || {},
      actions: actionsByStory.get(id) || [],
      requiredPlatforms,
    });
  });
  const green = rows.filter((row) => row.verdict === "green").length;
  const amber = rows.filter((row) => row.verdict === "amber").length;
  const red = rows.filter((row) => row.verdict === "red").length;
  const verdict = red ? "red" : amber ? "amber" : "green";
  const repairBacklog = buildRepairBacklog(rows);

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "read_only_first_frame_thumbnail_engine",
    verdict,
    summary: {
      story_count: rows.length,
      green_story_count: green,
      amber_story_count: amber,
      red_story_count: red,
      required_enabled_platforms: requiredPlatforms,
      repair_backlog_count: repairBacklog.length,
    },
    rows,
    platform_cover_matrix: rows.map((row) => ({
      story_id: row.story_id,
      title: row.title,
      verdict: row.platform_cover_matrix.verdict,
      ready_enabled_platforms: row.platform_cover_matrix.ready_enabled_platforms,
      missing_enabled_platforms: row.platform_cover_matrix.missing_enabled_platforms,
      rows: row.platform_cover_matrix.rows,
    })),
    repair_backlog: repairBacklog,
    safety: {
      read_only: true,
      no_upload_or_posting_action: true,
      no_db_mutation: true,
      no_oauth_or_token_mutation: true,
      disabled_platforms_counted_live: false,
    },
    next_action:
      verdict === "green"
        ? "enforce_first_frame_gate_in_scheduler_readiness"
        : "repair_first_frame_thumbnail_backlog_before_expanding_publish_volume",
  };
}

function formatFirstFrameThumbnailMarkdown(report = {}) {
  const lines = [];
  lines.push("# First Frame / Thumbnail Engine");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || "unknown"}`);
  lines.push(`Verdict: ${String(report.verdict || "unknown").toUpperCase()}`);
  lines.push(`Stories: ${report.summary?.story_count || 0}`);
  lines.push(`Green: ${report.summary?.green_story_count || 0}`);
  lines.push(`Amber: ${report.summary?.amber_story_count || 0}`);
  lines.push(`Red: ${report.summary?.red_story_count || 0}`);
  lines.push("");
  lines.push("## Story Scores");
  for (const row of asArray(report.rows)) {
    lines.push(`- ${row.story_id}: ${String(row.verdict).toUpperCase()} ${row.score}/100 - ${row.title}`);
    if (row.blockers?.length) lines.push(`  blockers: ${row.blockers.join(", ")}`);
    if (row.warnings?.length) lines.push(`  warnings: ${row.warnings.join(", ")}`);
  }
  if (!asArray(report.rows).length) lines.push("- none");
  lines.push("");
  lines.push("## Repair Backlog");
  for (const item of asArray(report.repair_backlog)) {
    lines.push(`- ${item.story_id}: ${item.blockers.join(", ") || item.warnings.join(", ")}`);
    lines.push(`  command: \`${item.recommended_command}\``);
  }
  if (!asArray(report.repair_backlog).length) lines.push("- none");
  lines.push("");
  lines.push("Safety: read-only; no posting, DB mutation, OAuth/token mutation or disabled-platform enablement.");
  return `${lines.join("\n")}\n`;
}

module.exports = {
  REQUIRED_ENABLED_PLATFORMS,
  analyseCoverText,
  buildFirstFrameThumbnailReport,
  buildPlatformCoverMatrix,
  formatFirstFrameThumbnailMarkdown,
  scoreFirstFrameThumbnailStory,
  titleSourceParity,
};
