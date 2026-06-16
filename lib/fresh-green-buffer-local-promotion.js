"use strict";

const fs = require("fs-extra");
const path = require("node:path");

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function storyId(story = {}, index = 0) {
  return cleanText(story.id || story.story_id || story.storyId || `fresh_story_${index + 1}`);
}

function sourceName(story = {}) {
  return cleanText(story.primary_source?.name || story.primary_source_name || story.source_name || story.subreddit);
}

function sourceUrl(story = {}) {
  return cleanText(story.primary_source?.url || story.primary_source_url || story.url);
}

function ageHours(sourcePublishedAt, now = new Date()) {
  const parsed = Date.parse(sourcePublishedAt || "");
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Number(((now.getTime() - parsed) / 36e5).toFixed(2)));
}

function firstSentence(value = "") {
  return cleanText(value).split(/(?<=[.!?])\s+/).filter(Boolean)[0] || "";
}

function buildPublicDescription(story = {}) {
  const existing = cleanText(story.description || story.public_description || story.upload_description);
  if (existing) return existing;
  const claim = asArray(story.confirmed_claims).map(cleanText).find(Boolean);
  const source = sourceName(story);
  const subject = cleanText(story.canonical_subject || story.canonical_game || story.title);
  if (claim) return `${claim} Source: ${source || "official source"}.`;
  const lead = firstSentence(story.narration_script || story.full_script || story.tts_script);
  if (lead && source) return `${lead} Source: ${source}.`;
  if (subject && source) return `${subject} update, sourced from ${source}.`;
  return lead || subject;
}

function buildCanonicalStoryManifest(story = {}, generatedAt = new Date().toISOString()) {
  const id = storyId(story);
  const script = cleanText(story.narration_script || story.full_script || story.tts_script);
  const selectedTitle = cleanText(story.selected_title || story.title);
  const thumbnailHeadline = cleanText(story.thumbnail_headline || story.suggested_thumbnail_text || story.title);
  const description = buildPublicDescription(story);
  const firstLine = firstSentence(script);
  return {
    schema_version: 1,
    story_id: id,
    id,
    canonical_subject: cleanText(story.canonical_subject || story.canonical_game || story.title),
    canonical_game: cleanText(story.canonical_game || story.canonical_subject || story.title),
    selected_title: selectedTitle,
    public_title: selectedTitle,
    upload_title: selectedTitle,
    short_title: cleanText(story.short_title || story.title),
    thumbnail_headline: thumbnailHeadline,
    suggested_thumbnail_text: thumbnailHeadline,
    first_spoken_line: firstLine,
    hook: firstLine,
    description,
    public_description: description,
    pinned_comment: sourceName(story) ? `Source: ${sourceName(story)}.` : "",
    narration_script: script,
    full_script: script,
    tts_script: script,
    primary_source: sourceName(story),
    primary_source_url: sourceUrl(story),
    source_published_at: cleanText(story.source_published_at || story.timestamp),
    source_confidence_score: Number(story.source_confidence_score || 0),
    claim_inventory: {
      confirmed: asArray(story.confirmed_claims),
      unconfirmed: asArray(story.unconfirmed_claims),
      prohibited: asArray(story.prohibited_claims),
    },
    confirmed_claims: asArray(story.confirmed_claims),
    unconfirmed_claims: asArray(story.unconfirmed_claims),
    generated_at: generatedAt,
    publish_status: "LOCAL_PROMOTION_ONLY",
    public_copy: {
      title: selectedTitle,
      thumbnail_headline: thumbnailHeadline,
      first_spoken_line: firstLine,
      description,
    },
    safety: {
      no_publish_triggered: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      disabled_platforms_enabled: false,
    },
  };
}

function buildSourceManifest(story = {}, now = new Date()) {
  const publishedAt = cleanText(story.source_published_at || story.timestamp);
  const hours = ageHours(publishedAt, now);
  const fresh = hours === null ? false : hours <= 168;
  return {
    schema_version: 1,
    story_id: storyId(story),
    primary_source: {
      name: sourceName(story),
      url: sourceUrl(story),
      type: cleanText(story.primary_source?.type || story.source_type || "official_or_major_source"),
      published_at: publishedAt || null,
      age_hours: hours,
    },
    source_age_policy_hours: 168,
    freshness_gate: fresh ? "pass" : "blocked",
    coherence_gate: sourceName(story) && sourceUrl(story) ? "pass" : "blocked",
    reference_only: true,
    direct_media_validated: false,
    blockers: [
      ...(fresh ? [] : ["source_age_missing_or_over_7_days"]),
      ...(sourceName(story) && sourceUrl(story) ? [] : ["primary_source_name_or_url_missing"]),
    ],
  };
}

function buildClaimInventory(story = {}) {
  return {
    schema_version: 1,
    story_id: storyId(story),
    confirmed: asArray(story.confirmed_claims),
    unconfirmed: asArray(story.unconfirmed_claims),
    prohibited: asArray(story.prohibited_claims),
    public_copy_guardrails: [
      "viewer_facing_only",
      "no_internal_qa_language",
      "no_weak_fallback_narration",
      "approved_cta_only",
    ],
  };
}

function buildRenderReadinessWorkOrder(story = {}, generatedAt = new Date().toISOString()) {
  const id = storyId(story);
  return {
    schema_version: 1,
    generated_at: generatedAt,
    story_id: id,
    title: cleanText(story.title),
    mode: "LOCAL_ONLY_RENDER_PROMOTION_WORK_ORDER",
    current_state: "fresh_source_draft_validated_reference_only",
    required_lanes: [
      {
        lane: "audio_timestamps",
        command: `npm run ops:goal-audio-timestamps -- --story-id ${id} --work-order output/goal-contract/render_input_work_order.json --out-dir output/goal-contract --json`,
        requirement: "fresh local narration audio and Whisper word timestamps",
      },
      {
        lane: "official_direct_motion",
        command: `npm run ops:v4-source-family-acquisition -- --story-id ${id} --story-packages output/overnight-fresh-green-buffer/local_promotion_story_packages.json --output-json output/overnight-fresh-green-buffer/${id}_source_family_acquisition.json --json`,
        requirement: "official/direct motion references with validated clip windows or an explicit operator-held blocker",
      },
      {
        lane: "visual_v4_final_render",
        command: `npm run ops:goal-production-render -- --work-order output/goal-contract/render_input_work_order.json --out-dir output/goal-contract --story-id ${id} --json`,
        requirement: "Visual V4 final render with freeze/black/choppy QA pass",
      },
      {
        lane: "scheduler_bridge_promotion",
        command: "npm run ops:next-publish-candidates -- --json",
        requirement: "scheduler preflight sees this story and returns preflight_qa pass",
      },
      {
        lane: "strict_dry_run",
        command: "npm run ops:goal-dry-run-publish -- --json",
        requirement: "enabled-platform dry-run actions appear without hard blockers",
      },
    ],
    safety: {
      no_publish_triggered: true,
      no_production_db_mutation: true,
      no_oauth_or_token_change: true,
      no_disabled_platform_enablement: true,
      no_gate_weakening: true,
    },
  };
}

function buildCandidateEntry(story = {}, { generatedAt, now } = {}) {
  const source = buildSourceManifest(story, now);
  const blockingLanes = [
    "audio_timestamps",
    "official_direct_motion",
    "visual_v4_final_render",
    "scheduler_bridge_promotion",
    "strict_dry_run",
  ];
  return {
    story_id: storyId(story),
    title: cleanText(story.title),
    canonical_subject: cleanText(story.canonical_subject || story.canonical_game || story.title),
    primary_source: source.primary_source,
    freshness_gate: source.freshness_gate,
    source_coherence_gate: source.coherence_gate,
    local_package_status: source.blockers.length ? "blocked_source_reference" : "ready_for_local_render_promotion",
    scheduler_green: false,
    counted_as_green: false,
    blocking_lanes: source.blockers.length ? ["source", ...blockingLanes] : blockingLanes,
    blockers: [
      ...source.blockers,
      "not_persisted_to_scheduler_candidate_store",
      "missing_fresh_audio_and_word_timestamps",
      "missing_validated_official_direct_motion",
      "missing_visual_v4_final_render",
      "missing_strict_dry_run_pass",
    ],
    package_dir: `packages/${storyId(story)}`,
    files: [
      "canonical_story_manifest.json",
      "source_manifest.json",
      "claim_inventory.json",
      "render_readiness_work_order.json",
    ],
    original_story: story,
    generated_at: generatedAt,
  };
}

function buildFreshGreenBufferLocalPromotionReport({
  stories = [],
  generatedAt = new Date().toISOString(),
  now = new Date(generatedAt),
} = {}) {
  const rows = asArray(stories);
  const candidates = rows.map((story, index) =>
    buildCandidateEntry({ ...story, id: storyId(story, index) }, { generatedAt, now }),
  );
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "LOCAL_ONLY_FRESH_GREEN_BUFFER_PROMOTION",
    verdict: candidates.length >= 5 ? "local_promotion_ready_partial" : "local_promotion_under_target",
    summary: {
      story_count: rows.length,
      local_package_count: candidates.length,
      scheduler_green_count: 0,
      strict_dry_run_ready_action_count: 0,
      production_db_mutation_required: false,
      minimum_target: 5,
      stretch_target: 10,
    },
    candidates,
    next_action:
      "Run the listed local render promotion lanes, then strict dry-run. Do not count these as GREEN until scheduler preflight and strict dry-run pass.",
    safety: {
      no_publish_triggered: true,
      no_network_uploads_started: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_platform_setting_change: true,
      disabled_platforms_enabled: false,
      gates_weakened: false,
    },
  };
}

function renderMarkdown(report = {}) {
  const lines = [];
  lines.push("# Fresh GREEN Buffer Local Promotion");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Verdict: ${report.verdict || "unknown"}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Draft stories: ${report.summary?.story_count || 0}`);
  lines.push(`- Local packages: ${report.summary?.local_package_count || 0}`);
  lines.push(`- Scheduler GREEN: ${report.summary?.scheduler_green_count || 0}`);
  lines.push(`- Strict dry-run ready actions: ${report.summary?.strict_dry_run_ready_action_count || 0}`);
  lines.push(`- Production DB mutation required by this report: ${report.summary?.production_db_mutation_required === true ? "yes" : "no"}`);
  lines.push("");
  lines.push("## Candidates");
  for (const candidate of asArray(report.candidates)) {
    lines.push("");
    lines.push(`### ${candidate.story_id}`);
    lines.push(`- Title: ${candidate.title}`);
    lines.push(`- Source: ${candidate.primary_source?.name || "unknown"}`);
    lines.push(`- Freshness: ${candidate.freshness_gate}`);
    lines.push(`- Local package: ${candidate.local_package_status}`);
    lines.push(`- Blocking lanes: ${asArray(candidate.blocking_lanes).join(", ") || "none"}`);
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- No publish was triggered.");
  lines.push("- No production DB mutation was performed.");
  lines.push("- No OAuth, token, billing or platform setting was changed.");
  lines.push("- Disabled platforms remain deferred.");
  return `${lines.join("\n")}\n`;
}

async function writeFreshGreenBufferLocalPromotionArtifacts(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeFreshGreenBufferLocalPromotionArtifacts requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const reportJson = path.join(outDir, "fresh_green_buffer_local_promotion_report.json");
  const reportMd = path.join(outDir, "fresh_green_buffer_local_promotion_report.md");
  await fs.writeJson(reportJson, report, { spaces: 2 });
  await fs.writeFile(reportMd, renderMarkdown(report), "utf8");

  const manifest = [];
  for (const candidate of asArray(report.candidates)) {
    const original = candidate.original_story || {};
    const packageDir = path.join(outDir, candidate.package_dir);
    await fs.ensureDir(packageDir);
    const story = original.id ? original : candidate;
    await fs.writeJson(path.join(packageDir, "canonical_story_manifest.json"), buildCanonicalStoryManifest(story, report.generated_at), { spaces: 2 });
    await fs.writeJson(path.join(packageDir, "source_manifest.json"), buildSourceManifest(story, new Date(report.generated_at)), { spaces: 2 });
    await fs.writeJson(path.join(packageDir, "claim_inventory.json"), buildClaimInventory(story), { spaces: 2 });
    await fs.writeJson(path.join(packageDir, "render_readiness_work_order.json"), buildRenderReadinessWorkOrder(story, report.generated_at), { spaces: 2 });
    const canonical = buildCanonicalStoryManifest(story, report.generated_at);
    manifest.push({
      story_id: candidate.story_id,
      id: candidate.story_id,
      title: canonical.selected_title,
      public_title: canonical.public_title,
      upload_title: canonical.upload_title,
      description: canonical.description,
      public_description: canonical.public_description,
      full_script: canonical.full_script,
      tts_script: canonical.tts_script,
      canonical_subject: canonical.canonical_subject,
      canonical_game: canonical.canonical_game,
      primary_source: canonical.primary_source,
      primary_source_url: canonical.primary_source_url,
      source_published_at: canonical.source_published_at,
      verdict: "ready",
      status: "ready_for_render_proof",
      blockers: asArray(candidate.blockers).filter((blocker) =>
        /^source_age_|^primary_source_/i.test(cleanText(blocker)),
      ),
      artifact_dir: packageDir,
      local_promotion_only: true,
      no_publish_triggered: true,
    });
  }
  const storyPackages = path.join(outDir, "local_promotion_story_packages.json");
  await fs.writeJson(storyPackages, manifest, { spaces: 2 });
  return { reportJson, reportMd, storyPackages };
}

module.exports = {
  buildCanonicalStoryManifest,
  buildClaimInventory,
  buildFreshGreenBufferLocalPromotionReport,
  buildRenderReadinessWorkOrder,
  buildSourceManifest,
  renderMarkdown,
  writeFreshGreenBufferLocalPromotionArtifacts,
};
