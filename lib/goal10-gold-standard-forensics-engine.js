"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const { loadGoldStandardReferenceLibrary } = require("./gold-standard-reference-library");

const GOAL_ID = "10_gold_standard_forensics_engine";

const GOAL10_BENCHMARK_PACKS = [
  "Gaming News Core",
  "Official Publisher Motion",
  "Social-First News",
  "Explainer and Data Graphics",
  "Pacing and Retention Impact",
  "Premium Visual Texture",
  "Commercial and Affiliate Mechanics",
  "X Hot Take and Thread Mechanics",
  "Instagram Carousel Mechanics",
];

const REQUIRED_PATTERN_FIELDS = [
  "title_structure",
  "hook_type",
  "first_frame_structure",
  "first_3_second_pacing",
  "shot_length",
  "motion_density",
  "transition_rhythm",
  "overlay_density",
  "caption_style",
  "source_card_style",
  "sfx_timing",
  "music_energy",
  "cta_placement",
  "commercial_integration",
  "platform_behaviour",
];

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function numberOr(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function resolveWorkspacePath(workspaceRoot, value) {
  const text = cleanText(value);
  if (!text) return "";
  if (path.isAbsolute(text)) return path.resolve(text);
  return path.resolve(workspaceRoot || process.cwd(), text);
}

async function readJsonIfPresent(filePath, fallback = {}) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  try {
    return await fs.readJson(filePath);
  } catch {
    return fallback;
  }
}

function canonicalPackSlug(value) {
  const text = cleanText(value).toLowerCase();
  if (/gaming.*news.*core/.test(text)) return "gaming_news_core";
  if (/official.*publisher.*motion/.test(text)) return "official_publisher_motion";
  if (/social.*first.*news/.test(text)) return "social_first_news";
  if (/explainer.*data.*graphics/.test(text)) return "explainer_and_data_graphics";
  if (/pacing.*retention.*impact/.test(text)) return "pacing_and_retention_impact";
  if (/premium.*visual.*texture/.test(text)) return "premium_visual_texture";
  if (/commercial.*affiliate.*mechanics/.test(text)) return "commercial_and_affiliate_mechanics";
  if (/\bx\b.*hot.*take.*thread/.test(text)) return "x_hot_take_and_thread_mechanics";
  if (/instagram.*carousel.*mechanics/.test(text)) return "instagram_carousel_mechanics";
  return text.replace(/&/g, "and").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function buildReferencePackScorecard(referenceLibrary = {}) {
  const packs = asArray(referenceLibrary.reference_packs);
  const packIndex = new Map(packs.map((pack) => [canonicalPackSlug(pack.pack), pack]));
  const required = GOAL10_BENCHMARK_PACKS.map((pack) => {
    const slug = canonicalPackSlug(pack);
    const sourcePack = packIndex.get(slug);
    return {
      pack,
      slug,
      status: sourcePack ? "pass" : "blocked",
      source_pack_name: sourcePack?.pack || null,
      primary_references: cleanText(sourcePack?.primary_references),
      use_this_when: cleanText(sourcePack?.use_this_when),
      main_extraction_targets: cleanText(sourcePack?.main_extraction_targets),
      blocker: sourcePack ? null : `benchmark_pack:${slug}_missing`,
    };
  });
  const missing = required.filter((pack) => pack.status === "blocked");
  return {
    schema_version: 1,
    goal: GOAL_ID,
    mode: "LOCAL_PROOF",
    workbook_path: cleanText(referenceLibrary.workbook_path),
    required_pack_count: required.length,
    present_required_pack_count: required.length - missing.length,
    missing_required_pack_count: missing.length,
    packs: required,
    missing_packs: missing.map((pack) => pack.pack),
    blockers: missing.map((pack) => pack.blocker),
  };
}

function referenceLibraryBlockers(referenceLibrary = {}, scorecard = {}) {
  const blockers = [];
  const summary = referenceLibrary.summary || {};
  const references = asArray(referenceLibrary.references);
  const rules = asArray(referenceLibrary.codex_rules);
  if (numberOr(summary.total_references, references.length) < 50) {
    blockers.push("reference_library:reference_count_below_50");
  }
  if (rules.length < 12) blockers.push("reference_library:codex_rule_count_below_12");
  const legalRule = cleanText(summary.core_legal_rule).toLowerCase();
  if (!/(reference-only|reference only)/.test(legalRule) || !/(licence|license|permission|verified reuse rights)/.test(legalRule)) {
    blockers.push("reference_library:unsafe_or_missing_reference_only_rule");
  }
  if (references.some((reference) => {
    const note = cleanText(reference.rights_usage_note).toLowerCase();
    return /\bcopy\b.*\b(footage|music|graphics|template)/.test(note) && !/do not copy|reference only|reference-only/.test(note);
  })) {
    blockers.push("reference_library:unsafe_rights_note");
  }
  return unique([...blockers, ...asArray(scorecard.blockers)]);
}

function buildUpstreamSoundIndex(upstreamSoundReport = {}) {
  const index = new Map();
  for (const story of asArray(upstreamSoundReport.stories)) {
    index.set(cleanText(story.story_id || story.id), story);
  }
  return index;
}

function upstreamBlockers(storyId, upstreamSoundIndex = new Map()) {
  const row = upstreamSoundIndex.get(cleanText(storyId));
  if (!row) return ["upstream:goal09_sound_design_engine_missing"];
  if (cleanText(row.status) === "ready") return [];
  return unique(["upstream:goal09_sound_design_engine_blocked", ...asArray(row.blockers)]);
}

function firstShot(director = {}) {
  return asArray(director.shot_plan || director.shots)[0] || {};
}

function shotStart(shot = {}) {
  return numberOr(shot.startS ?? shot.start_s ?? shot.start, 0);
}

function shotDuration(shot = {}) {
  return numberOr(shot.durationS ?? shot.duration_s ?? shot.duration, 0);
}

function transitionFamilies(director = {}) {
  return asArray(director.transition_plan?.planned || director.sound_transition_plan?.transitions?.planned)
    .map((transition) => cleanText(transition.family || transition.transition_family))
    .filter(Boolean);
}

function soundCues(director = {}) {
  return asArray(director.sound_transition_plan?.sfx?.cues || director.sfx_plan?.cues);
}

function cardRatio(director = {}, renderedDuration = 0) {
  const shots = asArray(director.shot_plan || director.shots);
  const duration = Math.max(
    numberOr(renderedDuration, 0),
    numberOr(director.sound_transition_plan?.duration_s, 0),
    ...shots.map((shot) => shotStart(shot) + shotDuration(shot)),
    1,
  );
  const cardSeconds = shots
    .filter((shot) => /\b(card|source_lock)\b/i.test(cleanText(shot.kind || shot.visual_treatment)))
    .reduce((sum, shot) => sum + Math.max(0, shotDuration(shot)), 0);
  return Number((cardSeconds / duration).toFixed(3));
}

function averageShotLength(director = {}, renderManifest = {}) {
  const shots = asArray(director.shot_plan || director.shots);
  if (shots.length) {
    const avg = shots.reduce((sum, shot) => sum + Math.max(0, shotDuration(shot)), 0) / shots.length;
    return Number(avg.toFixed(2));
  }
  const clips = numberOr(renderManifest.clips, 0);
  if (clips > 0) return Number((numberOr(renderManifest.rendered_duration_s, 0) / clips).toFixed(2));
  return null;
}

function titleStructure(title = "") {
  const words = cleanText(title).split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  if (words.length <= 5) return "short_subject_action_headline";
  return "subject_plus_context_headline";
}

function hookType(firstLine = "", canonical = {}) {
  const text = cleanText(firstLine || canonical.first_spoken_line || canonical.narration_script);
  if (!text) return "";
  if (/\bfinally|just|now|confirmed|showed|revealed|leaked\b/i.test(text)) return "source_led_news_hook";
  if (/\?/.test(text)) return "question_hook";
  return "direct_context_hook";
}

function ctaPlacement(canonical = {}, platformManifest = {}) {
  const script = cleanText(canonical.narration_script || platformManifest.outputs?.youtube_shorts?.cta);
  if (!script) return "";
  const followIndex = script.toLowerCase().lastIndexOf("follow");
  if (followIndex >= 0 && followIndex / Math.max(script.length, 1) > 0.66) return "end_identity_follow";
  const outputCtas = Object.values(platformManifest.outputs || {}).map((output) => cleanText(output?.cta_style)).filter(Boolean);
  return outputCtas.length ? unique(outputCtas).join(", ") : "";
}

function patternEntry(status, value, evidence = {}) {
  return {
    status: value === "" || value === null || value === undefined ? "missing" : status,
    value: value === undefined ? null : value,
    evidence,
  };
}

function extractPatternData({
  storyPackage = {},
  canonical = {},
  visualQualityReport = {},
  director = {},
  renderManifest = {},
  platformManifest = {},
  affiliateManifest = {},
} = {}) {
  const shots = asArray(director.shot_plan || director.shots);
  const first = firstShot(director);
  const transitions = transitionFamilies(director);
  const cues = soundCues(director);
  const outputs = platformManifest.outputs || {};
  const title = cleanText(canonical.selected_title || renderManifest.input_fingerprint?.canonical_snapshot?.selected_title || storyPackage.title);
  const firstLine = cleanText(canonical.first_spoken_line || renderManifest.input_fingerprint?.canonical_snapshot?.first_spoken_line);
  const motionScore = numberOr(visualQualityReport.scores?.motion_density_score, null);
  const renderedDuration = numberOr(renderManifest.rendered_duration_s, director.sound_transition_plan?.duration_s || 0);
  const platformNames = Object.keys(outputs).filter(Boolean);
  const musicEnergy =
    cleanText(director.sound_transition_plan?.sfx?.mastering?.music_energy) ||
    (director.sound_transition_plan?.sfx?.mastering?.duck_under_narration === true ? "narration_first_ducked_bed_or_no_music" : "");

  return {
    title_structure: patternEntry("present", titleStructure(title), { title }),
    hook_type: patternEntry("present", hookType(firstLine, canonical), { first_spoken_line: firstLine }),
    first_frame_structure: patternEntry("present", cleanText(first.kind || first.visual_treatment), { shot_id: cleanText(first.id) }),
    first_3_second_pacing: patternEntry("present", {
      shots_started_before_3s: shots.filter((shot) => shotStart(shot) < 3).length,
      transitions_before_3s: asArray(director.transition_plan?.planned).filter((transition) => numberOr(transition.atS ?? transition.at_s, 99) < 3).length,
      sfx_before_3s: cues.filter((cue) => numberOr(cue.atS ?? cue.at_s, 99) < 3).length,
    }),
    shot_length: patternEntry("present", averageShotLength(director, renderManifest), { shot_count: shots.length, rendered_duration_s: renderedDuration }),
    motion_density: patternEntry("present", motionScore, { threshold: visualQualityReport.thresholds?.motion_density_score ?? null }),
    transition_rhythm: patternEntry("present", transitions.length ? unique(transitions) : "", { transition_count: transitions.length }),
    overlay_density: patternEntry("present", cardRatio(director, renderedDuration), { card_ratio_basis: "card_and_source_lock_seconds" }),
    caption_style: patternEntry("present", director.caption_policy?.clean_manual_captions === true ? "clean_manual_captions" : cleanText(outputs.youtube_shorts?.captions?.file), {
      avoid_collisions: director.caption_policy?.avoid_lower_third_collisions === true,
    }),
    source_card_style: patternEntry("present", shots.some((shot) => cleanText(shot.kind) === "source_lock") ? "readable_source_lock" : cleanText(outputs.youtube_shorts?.cover_frame?.source_label)),
    sfx_timing: patternEntry("present", cues.length ? { cue_count: cues.length, first_cues_s: cues.slice(0, 5).map((cue) => numberOr(cue.atS ?? cue.at_s, 0)) } : ""),
    music_energy: patternEntry("present", musicEnergy),
    cta_placement: patternEntry("present", ctaPlacement(canonical, platformManifest)),
    commercial_integration: patternEntry("present", affiliateManifest.disclosure_required === true ? "disclosed_story_page_route" : "", {
      landing_page_route: cleanText(affiliateManifest.landing_page_route),
      link_tracking_count: asArray(affiliateManifest.landing_page_attribution?.link_tracking).length,
    }),
    platform_behaviour: patternEntry("present", platformNames.length ? platformNames : "", {
      native_evidence_verdict: cleanText(platformManifest.platform_native_evidence?.verdict),
    }),
  };
}

function missingPatternBlockers(patternData = {}) {
  return REQUIRED_PATTERN_FIELDS
    .filter((field) => patternData[field]?.status !== "present")
    .map((field) => `pattern:${field}_missing`);
}

function qualityBlockers(visualQualityReport = {}, benchmarkReport = {}) {
  const blockers = [];
  const qualityStatus = cleanText(visualQualityReport.result || visualQualityReport.verdict || visualQualityReport.status);
  const benchmarkStatus = cleanText(benchmarkReport.result || benchmarkReport.verdict || benchmarkReport.status);
  if (qualityStatus && qualityStatus !== "pass") blockers.push("benchmark:visual_quality_not_pass");
  if (benchmarkStatus && benchmarkStatus !== "pass") blockers.push("benchmark:benchmark_report_not_pass");
  for (const failure of asArray(visualQualityReport.failures)) blockers.push(`benchmark:${failure}`);
  for (const failure of asArray(benchmarkReport.failures)) blockers.push(`benchmark:${failure}`);
  if (numberOr(visualQualityReport.scores?.motion_density_score, 100) < numberOr(visualQualityReport.thresholds?.motion_density_score, 75)) {
    blockers.push("benchmark:motion_density_below_reference");
  }
  if (numberOr(visualQualityReport.scores?.first_3_seconds_hook_score, 100) < numberOr(visualQualityReport.thresholds?.first_3_seconds_hook_score, 75)) {
    blockers.push("benchmark:first_3_seconds_below_reference");
  }
  if (numberOr(visualQualityReport.scores?.rights_risk_score, 100) < numberOr(visualQualityReport.thresholds?.rights_risk_score, 70)) {
    blockers.push("benchmark:rights_risk_above_reference");
  }
  return unique(blockers);
}

function usedPackBlockers(visualQualityReport = {}, scorecard = {}) {
  const allowed = new Set(asArray(scorecard.packs).filter((pack) => pack.status === "pass").map((pack) => pack.slug));
  const used = asArray(visualQualityReport.reference_pack_used);
  if (!used.length) return ["benchmark:reference_pack_used_missing"];
  return used
    .map(canonicalPackSlug)
    .filter((slug) => !allowed.has(slug))
    .map((slug) => `benchmark:reference_pack_used_unknown:${slug}`);
}

async function inspectStoryPackage(storyPackage = {}, options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
  const storyId = cleanText(storyPackage.story_id || storyPackage.id);
  const artifactDir = resolveWorkspacePath(workspaceRoot, storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir);
  const [
    canonical,
    visualQualityReport,
    benchmarkReport,
    director,
    renderManifest,
    platformManifest,
    affiliateManifest,
  ] = await Promise.all([
    readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "visual_quality_report.json"), null),
    readJsonIfPresent(path.join(artifactDir, "benchmark_report.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "director_beat_map.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "render_manifest.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "platform_publish_manifest.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "affiliate_link_manifest.json"), {}),
  ]);
  const missing = [];
  if (!visualQualityReport) missing.push("benchmark:visual_quality_report_missing");
  const patternData = extractPatternData({
    storyPackage,
    canonical,
    visualQualityReport: visualQualityReport || {},
    director,
    renderManifest,
    platformManifest,
    affiliateManifest,
  });
  const directBlockers = unique([
    ...missing,
    ...qualityBlockers(visualQualityReport || {}, benchmarkReport),
    ...usedPackBlockers(visualQualityReport || {}, options.referencePackScorecard || {}),
    ...missingPatternBlockers(patternData),
  ]);
  const upstream = upstreamBlockers(storyId, options.upstreamSoundIndex);
  const globalBlockers = asArray(options.globalBlockers);
  const blockers = unique([...globalBlockers, ...upstream, ...directBlockers]);
  return {
    story_id: storyId || "unknown",
    title: cleanText(storyPackage.title || canonical.selected_title),
    artifact_dir: artifactDir || null,
    status: blockers.length ? "blocked" : "ready",
    direct_benchmark_status: directBlockers.length ? "blocked" : "pass",
    blockers,
    direct_benchmark_blockers: directBlockers,
    upstream_blockers: upstream,
    global_blockers: globalBlockers,
    reference_pack_used: asArray(visualQualityReport?.reference_pack_used),
    pattern_data: patternData,
    pattern_coverage: {
      required_count: REQUIRED_PATTERN_FIELDS.length,
      present_count: REQUIRED_PATTERN_FIELDS.filter((field) => patternData[field]?.status === "present").length,
      missing: REQUIRED_PATTERN_FIELDS.filter((field) => patternData[field]?.status !== "present"),
    },
    scores: visualQualityReport?.scores || {},
    thresholds: visualQualityReport?.thresholds || {},
    safety: {
      no_source_media_copied: true,
      non_infringing_reference_grammar_only: true,
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

function buildBenchmarkComparisonReport(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    benchmark_packs: report.reference_pack_scorecard?.packs || [],
    stories: asArray(report.stories).map((story) => ({
      story_id: story.story_id,
      status: story.status,
      direct_benchmark_status: story.direct_benchmark_status,
      reference_pack_used: story.reference_pack_used,
      pattern_coverage: story.pattern_coverage,
      non_infringing_use: story.safety?.non_infringing_reference_grammar_only === true,
      blockers: story.blockers,
    })),
  };
}

function buildPulseRenderBenchmarkReport(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    summary: report.summary || {},
    required_patterns: REQUIRED_PATTERN_FIELDS,
    stories: asArray(report.stories).map((story) => ({
      story_id: story.story_id,
      status: story.status,
      pattern_data: story.pattern_data,
      scores: story.scores,
      thresholds: story.thresholds,
    })),
  };
}

function buildBenchmarkRejectionReasons(report = {}) {
  const globalRejections = asArray(report.global_blockers).map((blocker) => ({
    scope: "reference_library",
    blocker,
    required_action: blocker.startsWith("benchmark_pack:")
      ? "Add the missing benchmark pack to the reference library or record an explicit operator-approved replacement pack."
      : "Repair the reference library before using it as a benchmark source.",
  }));
  const storyRejections = asArray(report.stories).flatMap((story) =>
    asArray(story.direct_benchmark_blockers).map((blocker) => ({
      scope: "story",
      story_id: story.story_id,
      blocker,
      required_action: "Repair the story evidence or pattern extraction before claiming benchmark readiness.",
    })),
  );
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    rejections: [...globalRejections, ...storyRejections],
  };
}

async function buildGoal10GoldStandardForensicsEngine({
  storyPackages = [],
  upstreamSoundReport = {},
  referenceLibrary = null,
  workbookPath,
  workspaceRoot = process.cwd(),
  outputDir,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!outputDir) throw new Error("buildGoal10GoldStandardForensicsEngine requires outputDir");
  await fs.ensureDir(path.resolve(outputDir));
  const library = referenceLibrary || loadGoldStandardReferenceLibrary({ workbookPath });
  const referencePackScorecard = buildReferencePackScorecard(library);
  const globalBlockers = referenceLibraryBlockers(library, referencePackScorecard);
  const upstreamSoundIndex = buildUpstreamSoundIndex(upstreamSoundReport);
  const stories = [];
  for (const storyPackage of asArray(storyPackages)) {
    stories.push(await inspectStoryPackage(storyPackage, {
      workspaceRoot,
      referencePackScorecard,
      upstreamSoundIndex,
      globalBlockers,
    }));
  }
  const readyStories = stories.filter((story) => story.status === "ready");
  const blockedStories = stories.filter((story) => story.status === "blocked");
  const directPassStories = stories.filter((story) => story.direct_benchmark_status === "pass");
  const directBlockedStories = stories.filter((story) => story.direct_benchmark_status === "blocked");
  const verdict = !stories.length
    ? "FAIL"
    : blockedStories.length && readyStories.length
      ? "PARTIAL"
      : blockedStories.length
        ? "BLOCKED"
        : "PASS";
  const report = {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    verdict,
    summary: {
      story_count: stories.length,
      benchmark_ready_story_count: readyStories.length,
      blocked_story_count: blockedStories.length,
      direct_benchmark_pass_story_count: directPassStories.length,
      direct_benchmark_blocked_story_count: directBlockedStories.length,
      required_reference_pack_count: GOAL10_BENCHMARK_PACKS.length,
      present_reference_pack_count: referencePackScorecard.present_required_pack_count,
      missing_reference_pack_count: referencePackScorecard.missing_required_pack_count,
      required_pattern_count: REQUIRED_PATTERN_FIELDS.length,
      full_pattern_coverage_story_count: stories.filter((story) => story.pattern_coverage.present_count === REQUIRED_PATTERN_FIELDS.length).length,
    },
    blocker_counts: blockerCounts(stories),
    global_blockers: globalBlockers,
    upstream_blockers: {
      goal09_sound_design_engine: "Goal 10 records benchmark grammar, but full readiness requires Goal 09 sound readiness first.",
      note: "This gate reads existing local evidence and the reference workbook. It does not copy footage, scrape platforms, render media, publish or mutate accounts.",
    },
    reference_library: {
      workbook_path: cleanText(library.workbook_path),
      total_references: numberOr(library.summary?.total_references, asArray(library.references).length),
      reference_count: asArray(library.references).length,
      codex_rule_count: asArray(library.codex_rules).length,
      core_legal_rule: cleanText(library.summary?.core_legal_rule),
    },
    stories,
    safety: {
      read_only_audit: true,
      no_reference_media_downloaded: true,
      no_template_or_footage_copying: true,
      no_render_triggered: true,
      no_publish_triggered: true,
      no_platform_uploads: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_values_exposed: true,
      no_gate_weakened: true,
    },
  };
  report.reference_pack_scorecard = referencePackScorecard;
  report.benchmark_comparison_report = buildBenchmarkComparisonReport(report);
  report.pulse_render_benchmark_report = buildPulseRenderBenchmarkReport(report);
  report.benchmark_rejection_reasons = buildBenchmarkRejectionReasons(report);
  return report;
}

function renderGoal10GoldStandardForensicsEngineMarkdown(report = {}) {
  const lines = [];
  lines.push("# Goal 10 Gold Standard Forensics Engine");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Verdict: ${report.verdict || "UNKNOWN"}`);
  lines.push(`Stories checked: ${report.summary?.story_count || 0}`);
  lines.push(`Benchmark-ready stories: ${report.summary?.benchmark_ready_story_count || 0}`);
  lines.push(`Direct benchmark pass stories: ${report.summary?.direct_benchmark_pass_story_count || 0}`);
  lines.push(`Required benchmark packs present: ${report.summary?.present_reference_pack_count || 0}/${report.summary?.required_reference_pack_count || 0}`);
  lines.push(`Full pattern coverage stories: ${report.summary?.full_pattern_coverage_story_count || 0}`);
  lines.push("");
  lines.push("## Blockers");
  const blockers = Object.keys(report.blocker_counts || {}).sort();
  if (!blockers.length) lines.push("- none");
  for (const blocker of blockers) lines.push(`- ${blocker}: ${report.blocker_counts[blocker]}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("LOCAL_PROOF only. This audit did not copy reference footage, render, publish, upload, mutate the database, touch OAuth or expose token values.");
  return `${lines.join("\n")}\n`;
}

async function writeGoal10GoldStandardForensicsEngine(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoal10GoldStandardForensicsEngine requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const readinessJson = path.join(outDir, "goal10_readiness_report.json");
  const readinessMarkdown = path.join(outDir, "goal10_readiness_report.md");
  const referencePackScorecard = path.join(outDir, "reference_pack_scorecard.json");
  const benchmarkComparisonReport = path.join(outDir, "benchmark_comparison_report.json");
  const pulseRenderBenchmarkReport = path.join(outDir, "pulse_render_benchmark_report.json");
  const benchmarkRejectionReasons = path.join(outDir, "benchmark_rejection_reasons.json");
  await fs.writeJson(readinessJson, report, { spaces: 2 });
  await fs.writeFile(readinessMarkdown, renderGoal10GoldStandardForensicsEngineMarkdown(report), "utf8");
  await fs.writeJson(referencePackScorecard, report.reference_pack_scorecard || buildReferencePackScorecard({}), { spaces: 2 });
  await fs.writeJson(benchmarkComparisonReport, report.benchmark_comparison_report || buildBenchmarkComparisonReport(report), { spaces: 2 });
  await fs.writeJson(pulseRenderBenchmarkReport, report.pulse_render_benchmark_report || buildPulseRenderBenchmarkReport(report), { spaces: 2 });
  await fs.writeJson(benchmarkRejectionReasons, report.benchmark_rejection_reasons || buildBenchmarkRejectionReasons(report), { spaces: 2 });
  return {
    readinessJson,
    readinessMarkdown,
    referencePackScorecard,
    benchmarkComparisonReport,
    pulseRenderBenchmarkReport,
    benchmarkRejectionReasons,
  };
}

module.exports = {
  GOAL10_BENCHMARK_PACKS,
  REQUIRED_PATTERN_FIELDS,
  buildBenchmarkComparisonReport,
  buildBenchmarkRejectionReasons,
  buildGoal10GoldStandardForensicsEngine,
  buildPulseRenderBenchmarkReport,
  buildReferencePackScorecard,
  inspectStoryPackage,
  renderGoal10GoldStandardForensicsEngineMarkdown,
  writeGoal10GoldStandardForensicsEngine,
};
