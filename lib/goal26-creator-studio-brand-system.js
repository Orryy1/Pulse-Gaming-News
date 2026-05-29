"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const GOAL_ID = "26_creator_studio_brand_system";

const REQUIRED_BRAND_CONTROLS = [
  "logo_usage",
  "motion_identity",
  "typography",
  "colour_system",
  "source_card_style",
  "lower_thirds",
  "thumbnail_style",
  "caption_rules",
  "cta_rules",
  "recurring_segment_names",
  "banned_phrases",
  "editorial_tone",
  "platform_specific_voice",
];

const OWNABLE_FORMATS = [
  "The Game Behind the Headline",
  "Steam Spike Check",
  "Delisting Watch",
  "Worth Your Wishlist?",
  "Platform War Pulse",
  "Patch Notes That Matter",
  "Trailer Truth Check",
  "The 60-Second Gaming Brief",
];

const REQUIRED_PLATFORM_VOICES = [
  "youtube_shorts",
  "tiktok",
  "instagram_reels",
  "x",
];

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normaliseStatus(value) {
  return cleanText(value).toLowerCase();
}

function passLike(value) {
  return ["pass", "passed", "ready", "green", "ok", "clear"].includes(normaliseStatus(value));
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function failuresFrom(...values) {
  const failures = [];
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    failures.push(
      ...asArray(value.failures),
      ...asArray(value.blockers),
      ...asArray(value.publish_blockers),
      ...asArray(value.direct_sponsor_blockers),
      ...asArray(value.upstream_blockers),
      ...asArray(value.reason_codes),
      ...asArray(value.errors),
    );
  }
  return unique(failures);
}

function storyIdFromPackage(storyPackage = {}) {
  return cleanText(storyPackage.story_id || storyPackage.id || storyPackage.storyId);
}

function objectPresent(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0);
}

function valuePresent(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return cleanText(value).length > 0;
}

function buildGoal25Index(upstreamSponsorReport = {}) {
  const index = new Map();
  for (const row of asArray(upstreamSponsorReport.stories || upstreamSponsorReport.rows)) {
    const storyId = cleanText(row.story_id || row.id);
    if (storyId) index.set(storyId, row);
  }
  return index;
}

function upstreamBlockers(storyId, sponsorIndex = new Map()) {
  const row = sponsorIndex.get(cleanText(storyId));
  if (!row) return ["upstream:goal25_sponsor_readiness_pack_missing"];
  const blockers = failuresFrom(row);
  const status = normaliseStatus(row.status || row.verdict || row.final_verdict);
  if (status === "skipped" || row.skipped_by_upstream === true || normaliseStatus(row.upstream_status) === "skipped") return [];
  if (passLike(status) && blockers.length === 0) return [];
  return unique(["upstream:goal25_sponsor_readiness_pack_blocked", ...blockers]);
}

function upstreamSkippedInfo(storyId, sponsorIndex = new Map()) {
  const row = sponsorIndex.get(cleanText(storyId));
  if (!row) return null;
  const status = normaliseStatus(row.status || row.verdict || row.final_verdict);
  if (status !== "skipped" && row.skipped_by_upstream !== true && normaliseStatus(row.upstream_status) !== "skipped") return null;
  return {
    status: "skipped",
    reason: cleanText(row.skipped_reason || row.reason || "upstream skipped before Goal 26"),
  };
}

function defaultBrandSnapshot(channelConfig = {}) {
  const colours = channelConfig.colours || {};
  return {
    logo_usage: {
      primary_lockup: `${channelConfig.name || "PULSE GAMING"} wordmark may appear as a small watermark, end card or source-lock accent only.`,
      clear_space: "Keep one logo-height clear space around the mark.",
      misuse: ["do not stretch", "do not recolour outside approved palette", "do not lead with a logo before the story hook"],
    },
    motion_identity: {
      intro_sting: "cold-open first, logo never delays the story",
      transitions: ["source lock flash", "stat card snap", "proof card wipe", "amber line wipe"],
      lower_third_motion: "fast in, hold long enough to read on mobile, clean out",
    },
    typography: {
      headline: "heavy condensed sans",
      body: "clean geometric sans",
      captions: "high-contrast sentence case",
      minimum_mobile_size: "large enough to read on a phone without pausing",
    },
    colour_system: {
      primary: colours.PRIMARY || "#FF6B1A",
      background: colours.SECONDARY || "#0D0D0F",
      text: colours.TEXT || "#F0F0F0",
      alert: colours.ALERT || "#FF2D2D",
      confirmed: colours.CONFIRMED || "#22C55E",
      muted: colours.MUTED || "#6B7280",
    },
    source_card_style: {
      position: "first proof beat when the story depends on a named source",
      fields: ["source name", "claim status", "timestamp when available"],
      rule: "source card must match the canonical story manifest",
    },
    lower_thirds: {
      max_words: 8,
      source_locked: true,
      mobile_readable: true,
      placement: "lower safe area above captions",
    },
    thumbnail_style: {
      words: "three to five",
      subject_first: true,
      no_generic_templates: true,
      rule: "thumbnail, title and first spoken line must point at the same subject",
    },
    caption_rules: {
      max_line_chars: 34,
      no_tiny_text: true,
      no_internal_qa_language: true,
      british_english: true,
    },
    cta_rules: {
      allowed: [channelConfig.cta || "Follow Pulse Gaming so you never miss a beat"],
      banned: ["smash that like", "let me know in the comments", "subscribe for more news"],
      rule: "CTA must be identity-based, not generic begging.",
    },
    recurring_segment_names: OWNABLE_FORMATS,
    banned_phrases: [
      "This changes everything",
      "Nobody saw this coming",
      "Nobody is talking about this",
      "The safe takeaway is",
      "The signal is",
      "smash that like",
      "let me know in the comments",
    ],
    editorial_tone: {
      voice: "sharp gaming reporter",
      facts_first: true,
      british_english: true,
      no_serial_comma: true,
      public_copy_only: true,
    },
    platform_specific_voice: {
      youtube_shorts: "clear sourced headline with one proof beat and a compact CTA",
      tiktok: "faster hook, same sourcing, no rumour framed as fact",
      instagram_reels: "clean caption-led framing and strong cover text",
      facebook_reels: "plain sourced context with less slang",
      x: "threaded proof, no hype and no unsupported claims",
      threads: "conversation-safe summary with correction room",
      pinterest: "searchable title and static proof card language",
    },
  };
}

function missingBrandControls(snapshot = {}) {
  const missing = REQUIRED_BRAND_CONTROLS
    .filter((control) => !valuePresent(snapshot[control]))
    .map((control) => `brand:${control}_missing`);
  const names = asArray(snapshot.recurring_segment_names);
  const missingFormats = OWNABLE_FORMATS.filter((format) => !names.includes(format));
  if (missingFormats.length) missing.push("brand:recurring_format_registry_incomplete");
  const voices = snapshot.platform_specific_voice || {};
  const missingVoices = REQUIRED_PLATFORM_VOICES.filter((platform) => !valuePresent(voices[platform]));
  if (missingVoices.length) missing.push("brand:platform_specific_voice_incomplete");
  return unique(missing);
}

function buildControls(snapshot = {}) {
  const controls = {};
  for (const control of REQUIRED_BRAND_CONTROLS) {
    controls[control] = {
      status: valuePresent(snapshot[control]) ? "defined" : "missing",
      value: snapshot[control] || null,
    };
  }
  return controls;
}

function formatSlug(name) {
  return cleanText(name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function buildRecurringFormatRegistry(snapshot = {}) {
  const names = asArray(snapshot.recurring_segment_names);
  return {
    schema_version: 1,
    goal: GOAL_ID,
    mode: "LOCAL_PROOF",
    required_formats: OWNABLE_FORMATS,
    status: OWNABLE_FORMATS.every((format) => names.includes(format)) ? "complete" : "incomplete",
    formats: OWNABLE_FORMATS.map((format) => ({
      id: formatSlug(format),
      name: format,
      status: names.includes(format) ? "defined" : "missing",
      public_use: "series format name",
      safe_usage_rule: "Use only when the story genuinely matches the format promise.",
    })),
    safety: {
      no_external_posting: true,
    },
  };
}

function buildBrandSystemManifest(snapshot = {}, directBlockers = [], generatedAt = null) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    status: directBlockers.length ? "blocked" : "defined",
    publish_allowed_by_goal26: false,
    controls: buildControls(snapshot),
    logo_usage: snapshot.logo_usage || null,
    motion_identity: snapshot.motion_identity || null,
    typography: snapshot.typography || null,
    colour_system: snapshot.colour_system || null,
    source_card_style: snapshot.source_card_style || null,
    lower_thirds: snapshot.lower_thirds || null,
    thumbnail_style: snapshot.thumbnail_style || null,
    caption_rules: snapshot.caption_rules || null,
    cta_rules: snapshot.cta_rules || null,
    recurring_segment_names: asArray(snapshot.recurring_segment_names),
    banned_phrases: asArray(snapshot.banned_phrases),
    editorial_tone: snapshot.editorial_tone || null,
    platform_specific_voice: snapshot.platform_specific_voice || null,
    blockers: directBlockers,
    safety: {
      local_proof_only: true,
      no_render_mutation: true,
      no_external_posting: true,
    },
  };
}

function renderVisualStyleGuide(snapshot = {}) {
  const lines = [];
  const colours = snapshot.colour_system || {};
  lines.push("# Pulse Gaming Visual Style Guide");
  lines.push("");
  lines.push("## Logo Usage");
  lines.push(cleanText(snapshot.logo_usage?.primary_lockup || "Logo usage is not defined."));
  lines.push("");
  lines.push("## Colour System");
  for (const [name, value] of Object.entries(colours)) lines.push(`- ${name}: ${value}`);
  lines.push("");
  lines.push("## Typography");
  for (const [name, value] of Object.entries(snapshot.typography || {})) lines.push(`- ${name}: ${value}`);
  lines.push("");
  lines.push("## Motion Identity");
  lines.push(`Intro: ${cleanText(snapshot.motion_identity?.intro_sting || "not defined")}`);
  for (const transition of asArray(snapshot.motion_identity?.transitions)) lines.push(`- ${transition}`);
  lines.push("");
  lines.push("## Source Cards And Lower Thirds");
  lines.push(`Source card rule: ${cleanText(snapshot.source_card_style?.rule || snapshot.source_card_style?.position || "not defined")}`);
  lines.push(`Lower thirds: ${cleanText(snapshot.lower_thirds?.placement || "not defined")}`);
  lines.push("");
  lines.push("## Thumbnail Style");
  lines.push(cleanText(snapshot.thumbnail_style?.rule || "Thumbnail style is not defined."));
  return `${lines.join("\n")}\n`;
}

function renderEditorialStyleGuide(snapshot = {}) {
  const lines = [];
  lines.push("# Pulse Gaming Editorial Style Guide");
  lines.push("");
  lines.push("## Editorial Tone");
  lines.push(cleanText(snapshot.editorial_tone?.voice || "Editorial tone is not defined."));
  lines.push("");
  lines.push("## Caption Rules");
  for (const [name, value] of Object.entries(snapshot.caption_rules || {})) lines.push(`- ${name}: ${value}`);
  lines.push("");
  lines.push("## CTA Rules");
  for (const cta of asArray(snapshot.cta_rules?.allowed)) lines.push(`- Allowed: ${cta}`);
  for (const cta of asArray(snapshot.cta_rules?.banned)) lines.push(`- Banned: ${cta}`);
  lines.push("");
  lines.push("## Banned Phrases");
  for (const phrase of asArray(snapshot.banned_phrases)) lines.push(`- ${phrase}`);
  lines.push("");
  lines.push("## Platform-Specific Voice");
  for (const [platform, rule] of Object.entries(snapshot.platform_specific_voice || {})) {
    lines.push(`- ${platform}: ${rule}`);
  }
  return `${lines.join("\n")}\n`;
}

function finaliseStory(storyPackage = {}, upstream = [], directBlockers = []) {
  const blockers = unique([...upstream, ...directBlockers]);
  return {
    story_id: storyIdFromPackage(storyPackage),
    artifact_dir: cleanText(storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir),
    title: cleanText(storyPackage.title || storyPackage.selected_title),
    status: blockers.length ? "blocked" : "ready",
    upstream_status: upstream.length ? "blocked" : "ready",
    direct_brand_status: directBlockers.length ? "blocked" : "pass",
    blockers,
    upstream_blockers: upstream,
    direct_brand_blockers: directBlockers,
    safety: {
      local_proof_only: true,
      no_render_mutation: true,
      no_external_posting: true,
    },
  };
}

function finaliseSkippedStory(storyPackage = {}, skipped = {}) {
  return {
    story_id: storyIdFromPackage(storyPackage),
    artifact_dir: cleanText(storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir),
    title: cleanText(storyPackage.title || storyPackage.selected_title),
    status: "skipped",
    skipped_reason: skipped.reason || "upstream skipped before Goal 26",
    upstream_status: "skipped",
    direct_brand_status: "skipped",
    blockers: [],
    upstream_blockers: [],
    direct_brand_blockers: [],
    safety: {
      local_proof_only: true,
      no_render_mutation: true,
      no_external_posting: true,
    },
  };
}

function blockerCounts(stories = []) {
  const counts = {};
  for (const story of asArray(stories)) {
    for (const blocker of asArray(story.blockers)) counts[blocker] = (counts[blocker] || 0) + 1;
  }
  return counts;
}

function directRiskCounts(stories = []) {
  const counts = {};
  for (const story of asArray(stories)) {
    for (const blocker of asArray(story.direct_brand_blockers)) counts[blocker] = (counts[blocker] || 0) + 1;
  }
  return counts;
}

async function buildGoal26CreatorStudioBrandSystem({
  storyPackages = [],
  upstreamSponsorReport = {},
  brandSnapshot = null,
  channelConfig = {},
  workspaceRoot = process.cwd(),
  outputDir,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!outputDir) throw new Error("buildGoal26CreatorStudioBrandSystem requires outputDir");
  await fs.ensureDir(path.resolve(outputDir));
  const snapshot = objectPresent(brandSnapshot) ? brandSnapshot : defaultBrandSnapshot(channelConfig);
  const directBlockers = missingBrandControls(snapshot);
  const sponsorIndex = buildGoal25Index(upstreamSponsorReport);
  const stories = asArray(storyPackages).map((storyPackage) => {
    const storyId = storyIdFromPackage(storyPackage);
    const skipped = upstreamSkippedInfo(storyId, sponsorIndex);
    if (skipped) return finaliseSkippedStory(storyPackage, skipped);
    return finaliseStory(storyPackage, upstreamBlockers(storyId, sponsorIndex), directBlockers);
  });
  const readyStories = stories.filter((story) => story.status === "ready");
  const blockedStories = stories.filter((story) => story.status === "blocked");
  const skippedStories = stories.filter((story) => story.status === "skipped");
  const directPassStories = stories.filter((story) => story.direct_brand_status === "pass");
  const directBlockedStories = stories.filter((story) => story.direct_brand_status === "blocked");
  const upstreamBlockedStories = stories.filter((story) => story.upstream_status === "blocked");
  const activeStories = stories.filter((story) => story.status !== "skipped");
  const directBrandVerdict = !stories.length
    ? "FAIL"
    : directBlockedStories.length && directPassStories.length
      ? "PARTIAL"
      : directBlockedStories.length
        ? "BLOCKED"
        : "PASS";
  const verdict = !stories.length
    ? "FAIL"
    : blockedStories.length && readyStories.length
      ? "PARTIAL"
      : blockedStories.length
        ? "BLOCKED"
        : activeStories.length || skippedStories.length
          ? "PASS"
          : "PASS";
  const brandSystemManifest = buildBrandSystemManifest(snapshot, directBlockers, generatedAt);
  const recurringFormatRegistry = buildRecurringFormatRegistry(snapshot);
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    verdict,
    direct_brand_verdict: directBrandVerdict,
    summary: {
      story_count: stories.length,
      brand_ready_story_count: readyStories.length,
      skipped_story_count: skippedStories.length,
      blocked_story_count: blockedStories.length,
      direct_brand_pass_story_count: directPassStories.length,
      direct_brand_blocked_story_count: directBlockedStories.length,
      upstream_blocked_story_count: upstreamBlockedStories.length,
      required_control_count: REQUIRED_BRAND_CONTROLS.length,
      missing_control_count: directBlockers.length,
      publish_now_count: 0,
    },
    required_brand_controls: REQUIRED_BRAND_CONTROLS,
    ownable_formats: OWNABLE_FORMATS,
    blocker_counts: blockerCounts(stories),
    direct_risk_counts: directRiskCounts(stories),
    upstream_blockers: {
      goal25_sponsor_readiness_pack:
        "Goal 26 can compile brand-system artefacts, but release readiness still requires Goal 25 and earlier campaign gates to pass first.",
      note:
        "This gate emits LOCAL_PROOF files only. It does not mutate rendered assets, post externally, mutate production rows or change OAuth/token state.",
    },
    stories,
    brand_system_manifest: brandSystemManifest,
    recurring_format_registry: recurringFormatRegistry,
    visual_style_guide_markdown: renderVisualStyleGuide(snapshot),
    editorial_style_guide_markdown: renderEditorialStyleGuide(snapshot),
    safety: {
      local_proof_only: true,
      dry_run_publish_only: true,
      no_render_mutation: true,
      no_external_posting: true,
      no_platform_mutation: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_gate_weakened: true,
    },
  };
}

function renderGoal26CreatorStudioBrandSystemMarkdown(report = {}) {
  const lines = [];
  lines.push("# Goal 26 - Creator Studio Brand System");
  lines.push("");
  lines.push(`Verdict: ${report.verdict || "UNKNOWN"}`);
  lines.push(`Direct brand verdict: ${report.direct_brand_verdict || "UNKNOWN"}`);
  lines.push(`Mode: ${report.mode || "LOCAL_PROOF"}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(`- Stories checked: ${report.summary?.story_count ?? 0}`);
  lines.push(`- Ready stories: ${report.summary?.brand_ready_story_count ?? 0}`);
  lines.push(`- Skipped stories: ${report.summary?.skipped_story_count ?? 0}`);
  lines.push(`- Blocked stories: ${report.summary?.blocked_story_count ?? 0}`);
  lines.push(`- Upstream-blocked stories: ${report.summary?.upstream_blocked_story_count ?? 0}`);
  lines.push(`- Direct brand pass stories: ${report.summary?.direct_brand_pass_story_count ?? 0}`);
  lines.push(`- Direct brand blocked stories: ${report.summary?.direct_brand_blocked_story_count ?? 0}`);
  lines.push(`- Required controls: ${report.summary?.required_control_count ?? 0}`);
  lines.push(`- Missing controls: ${report.summary?.missing_control_count ?? 0}`);
  lines.push(`- Publish-now actions: ${report.summary?.publish_now_count ?? 0}`);
  lines.push("");
  lines.push("## Direct Blockers");
  const directBlockers = Object.keys(report.direct_risk_counts || {});
  if (directBlockers.length) {
    for (const blocker of directBlockers) lines.push(`- ${blocker}: ${report.direct_risk_counts[blocker]}`);
  } else {
    lines.push("- None.");
  }
  lines.push("");
  lines.push("## Ownable Formats");
  for (const format of asArray(report.ownable_formats)) lines.push(`- ${format}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("- LOCAL_PROOF only.");
  lines.push("- No render mutation, external posting, production DB mutation or OAuth/token mutation occurred.");
  return `${lines.join("\n")}\n`;
}

async function writeGoal26CreatorStudioBrandSystem(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoal26CreatorStudioBrandSystem requires outputDir");
  await fs.ensureDir(outputDir);
  const paths = {
    readinessJson: path.join(outputDir, "goal26_readiness_report.json"),
    readinessMarkdown: path.join(outputDir, "goal26_readiness_report.md"),
    brandSystemManifest: path.join(outputDir, "brand_system_manifest.json"),
    visualStyleGuide: path.join(outputDir, "visual_style_guide.md"),
    editorialStyleGuide: path.join(outputDir, "editorial_style_guide.md"),
    recurringFormatRegistry: path.join(outputDir, "recurring_format_registry.json"),
  };
  await fs.writeJson(paths.readinessJson, report, { spaces: 2 });
  await fs.outputFile(paths.readinessMarkdown, renderGoal26CreatorStudioBrandSystemMarkdown(report));
  await fs.writeJson(paths.brandSystemManifest, report.brand_system_manifest || {}, { spaces: 2 });
  await fs.outputFile(paths.visualStyleGuide, report.visual_style_guide_markdown || "");
  await fs.outputFile(paths.editorialStyleGuide, report.editorial_style_guide_markdown || "");
  await fs.writeJson(paths.recurringFormatRegistry, report.recurring_format_registry || {}, { spaces: 2 });
  return paths;
}

module.exports = {
  GOAL_ID,
  OWNABLE_FORMATS,
  REQUIRED_BRAND_CONTROLS,
  REQUIRED_PLATFORM_VOICES,
  buildGoal26CreatorStudioBrandSystem,
  defaultBrandSnapshot,
  renderGoal26CreatorStudioBrandSystemMarkdown,
  writeGoal26CreatorStudioBrandSystem,
};
