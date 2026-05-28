"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");
const {
  isGeneratedMotionAsset,
  isRealMediaAsset,
  visualEvidenceProfile,
} = require("./visual-evidence-classifier");
const { evaluateGoalPublicCopy } = require("./goal-public-copy-qa");
const { buildCaptionSrt } = require("./goal-public-copy-repair");
const { runMediaHouseBenchmark } = require("./media-house-benchmark");
const mediaPaths = require("./media-paths");
const { PRIMARY_PULSE_CTA } = require("./pulse-cta");
const {
  currentRenderPolicyManifest,
  policyVersionBlockers,
} = require("./studio/v4/render-policy");

const REQUIRED_INPUTS = [
  "canonical_story_manifest.json",
  "director_beat_map.json",
  "rights_ledger.json",
  "benchmark_report.json",
  "visual_quality_report.json",
  "sfx_manifest.json",
  "platform_publish_manifest.json",
  "publish_verdict.json",
  "captions.srt",
  "visual_v4_render.mp4",
];

const PRODUCTION_RENDERERS = new Set([
  "visual_v4_production",
  "studio_v4_production",
  "visual_v4_creator_studio",
  "visual_v4_platform_native",
]);

const PRODUCTION_TIERS = new Set([
  "production_v4_motion",
  "platform_native_production",
  "creator_studio_final",
  "premium_motion_final",
]);

const DEFAULT_THRESHOLDS = {
  motion_density_score: 75,
  first_3_seconds_hook_score: 75,
  caption_legibility_score: 80,
  transition_energy_score: 70,
  sfx_impact_score: 70,
  media_house_polish_score: 80,
};

const FINAL_RENDER_INPUTS = [
  "audio_manifest.json",
  "footage_inventory.json",
];

const DEFAULT_FINAL_RENDER_INPUT_REQUIREMENTS = {
  min_materialised_motion_clips: 5,
  min_distinct_motion_families: 4,
};

const DIRECT_VIDEO_MOTION_BLOCKER = "visual_evidence:direct_video_motion_missing";
const NORMAL_PRODUCTION_TARGET_SECONDS = { min: 35, max: 59 };

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function currentSpokenTextForTts(canonical = {}) {
  const script = cleanText(
    canonical.narration_script ||
      canonical.full_script ||
      canonical.tts_script ||
      canonical.first_spoken_line ||
      canonical.description,
  );
  if (!script) return "";
  try {
    const audio = require("../audio");
    return cleanText(audio.cleanForTTS(script));
  } catch {
    const { applyGamingPronunciation } = require("./tts-pronunciation");
    return cleanText(applyGamingPronunciation(script));
  }
}

function spokenFreshnessKey(value = "") {
  return cleanText(value)
    .toLowerCase()
    .replace(/\bhades,\s+two\b/g, "hades pause two")
    .replace(/[\u2018\u2019']/g, "")
    .replace(/[\u2010-\u2015-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function timeMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

async function readJsonIfPresent(filePath, fallback = {}) {
  try {
    if (await fs.pathExists(filePath)) return await fs.readJson(filePath);
  } catch {}
  return fallback;
}

function timestampWords(payload = {}) {
  return asArray(payload.words)
    .map((word) => ({
      word: cleanText(word.word || word.text),
      start: Number(word.start),
      end: Number(word.end),
    }))
    .filter((word) => word.word && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end >= word.start);
}

async function resolveTimestampPayload({ artifactDir = "", audioManifest = {}, storyId = "" } = {}) {
  const candidates = [
    audioManifest.word_timestamps_path,
    audioManifest.timestamps_path,
    audioManifest.resolved_timestamps_path,
    path.join(artifactDir, "word_timestamps.json"),
    storyId ? path.join(artifactDir, `${storyId}_timestamps.json`) : "",
    storyId ? `output/audio/${storyId}_timestamps.json` : "",
  ].filter(Boolean);
  const seen = new Set();
  for (const candidate of candidates) {
    const raw = cleanText(candidate);
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    const resolved = path.isAbsolute(raw)
      ? raw
      : await mediaPaths.resolveExisting(raw).catch(() => raw);
    if (!resolved || !(await fs.pathExists(resolved))) continue;
    const payload = await readJsonIfPresent(resolved, null);
    if (timestampWords(payload).length) return { path: resolved, payload };
  }
  return null;
}

async function ttsPronunciationFreshness({ timestampPath = "", canonical = {} } = {}) {
  const expected = currentSpokenTextForTts(canonical);
  if (!timestampPath || !expected) return { blockers: [], evidence: {} };
  const payload = await readJsonIfPresent(timestampPath, null);
  const transcript = cleanText(payload?.meta?.transcript || payload?.meta?.spoken_text);
  if (!transcript || transcript === expected || spokenFreshnessKey(transcript) === spokenFreshnessKey(expected)) {
    return { blockers: [], evidence: {} };
  }
  return {
    blockers: [
      "final_narration_audio_stale_after_pronunciation_repair",
      "word_timestamps_stale_after_pronunciation_repair",
    ],
    evidence: {
      tts_pronunciation_expected_transcript: expected,
      tts_pronunciation_timestamp_transcript: transcript,
    },
  };
}

function timestampPayloadSource(payload = {}) {
  return cleanText(
    payload?.meta?.wordTimestampSource ||
      payload?.meta?.word_timestamp_source ||
      payload?.wordTimestampSource ||
      payload?.word_timestamp_source,
  ).toLowerCase();
}

function wordTranscriptFromTimestampPayload(payload = {}) {
  return cleanText(timestampWords(payload).map((word) => word.word).join(" "));
}

function coverageTokens(value = "") {
  return spokenFreshnessKey(value).split(/\s+/).filter(Boolean);
}

function asrWordTimestampCoverage({ payload = {}, canonical = {} } = {}) {
  const source = timestampPayloadSource(payload);
  const whisperReady =
    source === "local_whisper_word_alignment" ||
    payload?.meta?.timestampWhisperAlignment?.repaired === true;
  if (!whisperReady) return null;

  const wordTranscript = wordTranscriptFromTimestampPayload(payload);
  const expectedText = cleanText(payload?.meta?.transcript || payload?.meta?.spoken_text || currentSpokenTextForTts(canonical));
  const expectedTokens = coverageTokens(expectedText);
  const actualTokens = coverageTokens(wordTranscript);
  if (!expectedTokens.length || !actualTokens.length) return null;

  const ratio = actualTokens.length / expectedTokens.length;
  const expectedOpening = expectedTokens.slice(0, Math.min(5, expectedTokens.length)).join(" ");
  const actualOpeningWindow = actualTokens.slice(0, 12).join(" ");
  const openingCovered = !expectedOpening || actualOpeningWindow.includes(expectedOpening);
  return {
    ratio,
    expected_word_count: expectedTokens.length,
    actual_word_count: actualTokens.length,
    opening_covered: openingCovered,
    expected_opening: expectedOpening,
    actual_opening: actualTokens.slice(0, 12).join(" "),
  };
}

function asrSemanticMisrecognitions({ payload = {}, canonical = {} } = {}) {
  const source = timestampPayloadSource(payload);
  const whisperReady =
    source === "local_whisper_word_alignment" ||
    payload?.meta?.timestampWhisperAlignment?.repaired === true;
  if (!whisperReady) return [];

  const wordTranscript = wordTranscriptFromTimestampPayload(payload);
  if (!wordTranscript) return [];
  const normalisedWords = spokenFreshnessKey(wordTranscript);
  const expected = spokenFreshnessKey(currentSpokenTextForTts(canonical));
  const issues = [];
  if (/\bportlands?\b/.test(normalisedWords) && /\bport lands\b/.test(expected)) {
    issues.push("port_lands_as_portland");
  }
  if (/\bhades tattoo\b/.test(normalisedWords) && /\bhades(?: number)? two\b|\bhades sequel\b/.test(expected)) {
    issues.push("hades_two_as_hades_tattoo");
  }
  if (/\bpauls? gaming\b/.test(normalisedWords) && /\bpulse gaming\b/.test(expected)) {
    issues.push("pulse_gaming_as_pauls_gaming");
  }
  if (/\bpublic public\b/.test(normalisedWords)) {
    issues.push("duplicated_public_word");
  }
  return unique(issues);
}

async function wordTimestampSemanticReadiness({ timestampPath = "", canonical = {} } = {}) {
  if (!timestampPath) return { blockers: [], evidence: {} };
  const payload = await readJsonIfPresent(timestampPath, null);
  const issues = asrSemanticMisrecognitions({ payload, canonical });
  const coverage = asrWordTimestampCoverage({ payload, canonical });
  const blockers = [];
  const evidence = {};
  if (coverage && (coverage.ratio < 0.85 || coverage.opening_covered === false)) {
    blockers.push("word_timestamps_asr_coverage_incomplete");
    Object.assign(evidence, {
      word_timestamp_coverage_ratio: Number(coverage.ratio.toFixed(3)),
      word_timestamp_expected_word_count: coverage.expected_word_count,
      word_timestamp_actual_word_count: coverage.actual_word_count,
      word_timestamp_opening_covered: coverage.opening_covered,
      word_timestamp_expected_opening: coverage.expected_opening,
      word_timestamp_actual_opening: coverage.actual_opening,
    });
  }
  if (!issues.length && !blockers.length) return { blockers: [], evidence: {} };
  if (issues.length) {
    blockers.push("word_timestamps_semantic_misrecognition");
    Object.assign(evidence, {
      word_timestamp_semantic_misrecognitions: issues,
      word_timestamp_word_transcript: wordTranscriptFromTimestampPayload(payload),
    });
  }
  return {
    blockers: unique(blockers),
    evidence,
  };
}

async function wordTimestampAlignmentReadiness({ timestampPath = "", audioManifest = {} } = {}) {
  if (!timestampPath) return { blockers: [], evidence: {} };
  const payload = await readJsonIfPresent(timestampPath, null);
  const source = cleanText(
    payload?.meta?.wordTimestampSource ||
      payload?.meta?.word_timestamp_source ||
      payload?.wordTimestampSource ||
      payload?.word_timestamp_source,
  );
  const voiceProvider = cleanText(audioManifest.voice_provider || audioManifest.provider).toLowerCase();
  const localProvider = /^local(?:_|$)/.test(voiceProvider) || source.startsWith("local_");
  const whisperReady =
    source === "local_whisper_word_alignment" ||
    payload?.meta?.timestampWhisperAlignment?.repaired === true;
  if (!localProvider || whisperReady) {
    return {
      blockers: [],
      evidence: source ? { word_timestamp_source: source } : {},
    };
  }
  return {
    blockers: ["word_timestamps_not_asr_aligned"],
    evidence: {
      word_timestamp_source: source || "unknown",
      word_timestamp_alignment_required: "local_whisper_word_alignment",
    },
  };
}

async function refreshSchedulerCaptionSrt({
  artifactDir = "",
  canonical = {},
  audioManifest = {},
  renderManifest = {},
  storyId = "",
  generatedAt = new Date().toISOString(),
} = {}) {
  const script = cleanText(
    canonical.narration_script ||
      canonical.full_script ||
      canonical.tts_script ||
      canonical.first_spoken_line,
  );
  if (!script) return { status: "skipped_no_script" };
  const timestampPayload = await resolveTimestampPayload({ artifactDir, audioManifest, storyId });
  if (!timestampPayload) return { status: "skipped_no_word_timestamps" };
  const words = timestampWords(timestampPayload.payload);
  const captions = buildCaptionSrt(script, renderedDurationSeconds(renderManifest), {
    words,
    maxWordsPerPhrase: 2,
    maxPhraseChars: 18,
    maxPhraseDurationS: 1.05,
    danglingMergeMaxWords: 2,
  });
  if (!cleanText(captions)) return { status: "skipped_unusable_word_timestamps" };
  const captionsPath = path.join(artifactDir, "captions.srt");
  await fs.writeFile(captionsPath, captions, "utf8");
  await fs.writeJson(path.join(artifactDir, "caption_manifest.json"), {
    schema_version: 1,
    story_id: storyId || cleanText(canonical.story_id),
    generated_at: generatedAt,
    caption_srt_path: captionsPath,
    word_timestamps_path: timestampPayload.path,
    timing_source: "word_timestamps",
    caption_generator: "goal_production_cutover_word_timed_srt",
    word_count: words.length,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  }, { spaces: 2 });
  return { status: "refreshed", captionsPath, wordTimestampsPath: timestampPayload.path };
}

async function fileReady(filePath, basename) {
  if (!(await fs.pathExists(filePath))) return false;
  if (/\.mp4$/i.test(basename)) {
    const stat = await fs.stat(filePath);
    return stat.size > 1000;
  }
  if (/\.(mp3|wav|m4a|aac)$/i.test(basename)) {
    const stat = await fs.stat(filePath);
    return stat.size > 1000;
  }
  if (/\.srt$/i.test(basename)) {
    const text = await fs.readFile(filePath, "utf8").catch(() => "");
    return /\d\d:\d\d:\d\d,\d{3}\s+-->\s+\d\d:\d\d:\d\d,\d{3}/.test(text);
  }
  return true;
}

function cleanPathCandidate(value) {
  const text = cleanText(value);
  if (!text || /^local:\/\//i.test(text)) return "";
  return text;
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function collectObjectPaths(source = {}, fieldNames = []) {
  const found = [];
  for (const fieldName of fieldNames) {
    const value = source?.[fieldName];
    if (typeof value === "string") found.push(value);
  }
  return found;
}

async function resolveReadyPath(value, artifactDir = "") {
  const candidate = cleanPathCandidate(value);
  if (!candidate) return null;
  const attempts = [];
  const outputMatch = candidate.match(/[\\/]output[\\/].+$/i);
  const outputRelative = outputMatch
    ? outputMatch[0].replace(/^[\\/]/, "").replace(/\\/g, "/")
    : /^output[\\/]/i.test(candidate)
      ? candidate.replace(/\\/g, "/")
      : null;
  if (outputRelative) {
    const mediaCandidate = await mediaPaths.resolveExisting(outputRelative).catch(() => null);
    if (mediaCandidate) attempts.push(mediaCandidate);
  }
  if (path.isAbsolute(candidate)) {
    attempts.push(candidate);
  } else {
    if (artifactDir && !outputRelative) attempts.push(path.resolve(artifactDir, candidate));
    attempts.push(path.resolve(candidate));
    if (!outputRelative) {
      const mediaCandidate = await mediaPaths.resolveExisting(candidate).catch(() => null);
      if (mediaCandidate) attempts.push(mediaCandidate);
    }
  }
  for (const attempt of unique(attempts)) {
    if (await fileReady(attempt, path.basename(attempt))) return attempt;
  }
  return null;
}

async function firstReadyPath(values = [], artifactDir = "") {
  for (const value of values) {
    const ready = await resolveReadyPath(value, artifactDir);
    if (ready) return ready;
  }
  return null;
}

async function pathMtimeMs(filePath) {
  if (!filePath || !(await fs.pathExists(filePath))) return null;
  const stat = await fs.stat(filePath);
  return stat.isFile() ? stat.mtimeMs : null;
}

async function fileDigestEvidence(filePath) {
  if (!filePath || !(await fs.pathExists(filePath))) {
    return { sha256: null, size_bytes: null };
  }
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return { sha256: null, size_bytes: null };
    const data = await fs.readFile(filePath);
    return {
      sha256: crypto.createHash("sha256").update(data).digest("hex"),
      size_bytes: stat.size,
    };
  } catch {
    return { sha256: null, size_bytes: null };
  }
}

function staleFinalRenderBlockers({ canonical = {}, sfxManifest = {} } = {}, renderManifest = {}) {
  const blockers = policyVersionBlockers(renderManifest);
  const renderedAt = timeMs(renderManifest.generated_at);
  if (renderedAt == null) return blockers;
  const publicCopyRepairedAt = timeMs(canonical.public_copy_repaired_at);
  if (publicCopyRepairedAt != null && publicCopyRepairedAt > renderedAt) {
    blockers.push("public_copy_newer_than_render");
  }
  const durationVariantRepairedAt = timeMs(canonical.duration_variant_repaired_at);
  if (durationVariantRepairedAt != null && durationVariantRepairedAt > renderedAt) {
    blockers.push("duration_variant_newer_than_render");
  }
  const sfxManifestGeneratedAt = timeMs(sfxManifest.generated_at);
  if (sfxManifestGeneratedAt != null && sfxManifestGeneratedAt > renderedAt) {
    blockers.push("sfx_manifest_newer_than_render");
  }
  return blockers;
}

function normalisePublicScriptKey(value = "") {
  return cleanText(value)
    .toLowerCase()
    .replace(/&(?:nbsp|amp|quot|#[0-9]+|#x[0-9a-f]+);/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function renderStoryTranscriptBlockers(canonical = {}, renderStory = {}) {
  const renderScript = firstText(renderStory.narration_script, renderStory.full_script, renderStory.tts_script);
  if (!renderScript) return [];
  const canonicalScript = firstText(canonical.narration_script, canonical.full_script, canonical.tts_script);
  const blockers = [];
  if (canonicalScript && normalisePublicScriptKey(renderScript) !== normalisePublicScriptKey(canonicalScript)) {
    blockers.push("render_story_transcript_diverges_from_canonical");
  }
  const renderCopyQa = evaluateGoalPublicCopy({
    ...canonical,
    narration_script: renderScript,
    full_script: firstText(renderStory.full_script, renderScript),
    tts_script: firstText(renderStory.tts_script, renderScript),
  });
  if (asArray(renderCopyQa.failures).length) {
    blockers.push("render_story_public_copy_failed");
    for (const failure of asArray(renderCopyQa.failures)) {
      blockers.push(`render_story:${failure}`);
    }
  }
  return unique(blockers);
}

function renderInputRequirements(footageInventory = {}, director = {}) {
  const motionBudget = footageInventory.motion_budget || {};
  const shotBudget = director.shot_budget || {};
  const clips =
    Number(shotBudget.min_actual_motion_clips) ||
    Number(motionBudget.required_motion_scenes) ||
    DEFAULT_FINAL_RENDER_INPUT_REQUIREMENTS.min_materialised_motion_clips;
  const families =
    Number(shotBudget.min_distinct_motion_families) ||
    Number(motionBudget.required_distinct_families) ||
    DEFAULT_FINAL_RENDER_INPUT_REQUIREMENTS.min_distinct_motion_families;
  return {
    min_materialised_motion_clips: clips,
    min_distinct_motion_families: families,
  };
}

function collectMotionClipCandidates(footageInventory = {}, director = {}) {
  const clips = [
    ...asArray(footageInventory?.motion_inventory?.accepted_local_clips),
    ...asArray(footageInventory?.motion_inventory?.production_motion_clips),
    ...asArray(footageInventory?.accepted_local_clips),
    ...asArray(footageInventory?.production_motion_clips),
    ...asArray(footageInventory?.clips),
    ...asArray(director?.shot_plan)
      .filter((beat) => cleanText(beat.kind) === "motion_clip" || cleanPathCandidate(beat.media_path))
      .map((beat) => ({
        ...beat,
        path: beat.media_path || beat.path,
      })),
  ];
  return clips
    .filter((clip) => clip && clip.validated !== false)
    .map((clip, index) => ({
      id: cleanText(clip.id || clip.motion_pack_clip_id || `motion-${index + 1}`),
      source_family: cleanText(clip.source_family || clip.family || clip.id || `motion-${index + 1}`),
      asset: clip,
      path_candidates: collectObjectPaths(clip, [
        "path",
        "media_path",
        "file_path",
        "local_path",
        "resolved_path",
        "output_path",
      ]),
    }));
}

function isPublicCopyDependentMotionAsset(asset = {}) {
  const text = [
    asset.source_url,
    asset.source_type,
    asset.source_kind,
    asset.media_kind,
    asset.asset_class,
    asset.visual_asset_class,
    asset.rights_risk_class,
    asset.licence_basis,
    asset.rights_basis,
  ].map(cleanText).join(" ").toLowerCase();
  return (
    text.includes("local://pulse-generated-motion") ||
    text.includes("internally_generated_motion_graphic") ||
    text.includes("owned_explainer_motion") ||
    text.includes("owned_source_card") ||
    text.includes("owned_generated_editorial_motion")
  );
}

async function inspectMaterialisedMotion({ footageInventory = {}, director = {}, artifactDir = "" } = {}) {
  const candidates = collectMotionClipCandidates(footageInventory, director);
  const materialised = [];
  const seen = new Set();
  for (const clip of candidates) {
    const readyPath = await firstReadyPath(clip.path_candidates, artifactDir);
    if (readyPath) {
      const key = `${readyPath}|${clip.source_family}`;
      if (seen.has(key)) continue;
      seen.add(key);
      materialised.push({
        id: clip.id,
        source_family: clip.source_family,
        path: readyPath,
        mtime_ms: await pathMtimeMs(readyPath),
        public_copy_dependent: isPublicCopyDependentMotionAsset(clip.asset),
        real_media: isRealMediaAsset(clip.asset) && !isGeneratedMotionAsset(clip.asset),
      });
    }
  }
  const realClips = materialised.filter((clip) => clip.real_media === true);
  return {
    candidates_seen: candidates.length,
    clips: materialised,
    families: unique(materialised.map((clip) => clip.source_family)),
    real_clips: realClips,
    real_families: unique(realClips.map((clip) => clip.source_family)),
  };
}

function rightsRecords(rightsLedger = {}) {
  if (Array.isArray(rightsLedger)) return rightsLedger.filter(Boolean);
  return [
    ...asArray(rightsLedger.records),
    ...asArray(rightsLedger.assets),
    ...asArray(rightsLedger.rights_ledger),
    ...asArray(rightsLedger.matched_assets),
  ];
}

function normalisedPath(value = "") {
  return cleanText(value).replace(/\\/g, "/").toLowerCase();
}

function ownedExplainerMotionReady({
  footageInventory = {},
  rightsLedger = {},
  motion = {},
  requirements = DEFAULT_FINAL_RENDER_INPUT_REQUIREMENTS,
} = {}) {
  const inventory = footageInventory.motion_inventory || {};
  const budget = footageInventory.motion_budget || {};
  const explicitlyAllowed =
    inventory.owned_explainer_visual_plan === true ||
    budget.owned_explainer_visual_plan === true ||
    budget.allow_owned_explainer_motion_only === true;
  if (!explicitlyAllowed) return false;
  if (motion.clips.length < requirements.min_materialised_motion_clips) return false;
  if (motion.families.length < requirements.min_distinct_motion_families) return false;
  const records = rightsRecords(rightsLedger);
  const ownedRecordKeys = new Set();
  for (const record of records) {
    const text = [
      record.asset_type,
      record.source_type,
      record.licence_basis,
      record.license_basis,
      record.rights_basis,
      record.media_kind,
    ].map(cleanText).join(" ").toLowerCase();
    if (!text.includes("owned_generated")) continue;
    for (const value of [
      record.path,
      record.local_path,
      record.file_path,
      record.media_path,
      record.source_url,
      record.source_family,
      record.motion_family,
      record.asset_id,
      record.id,
    ]) {
      const key = normalisedPath(value);
      if (key) ownedRecordKeys.add(key);
    }
  }
  return motion.clips.every((clip) => {
    const keys = [
      clip.path,
      clip.source_family,
      clip.id,
    ].map(normalisedPath).filter(Boolean);
    return keys.some((key) => ownedRecordKeys.has(key));
  });
}

function ownedExplainerExceptionApproved({
  canonical = {},
  renderManifest = {},
  storyPackage = {},
} = {}) {
  return Boolean(
    canonical.breaking_news_flag === true ||
      renderManifest.breaking_news_flag === true ||
      storyPackage.breaking_news_flag === true ||
      canonical.human_reviewed_owned_explainer_motion_exception === true ||
      canonical.owned_explainer_motion_exception_approved === true ||
      renderManifest.human_reviewed_owned_explainer_motion_exception === true ||
      renderManifest.owned_explainer_motion_exception_approved === true ||
      storyPackage.human_reviewed_owned_explainer_motion_exception === true ||
      storyPackage.owned_explainer_motion_exception_approved === true,
  );
}

function sourceLooksEditoriallyVerified(canonical = {}) {
  const sourceName = cleanText(canonical.primary_source || canonical.source_card_label || canonical.official_source);
  const sourceUrl = cleanText(canonical.primary_source_url || canonical.source_url || canonical.url);
  if (!sourceName || /reddit|unknown|source needed/i.test(sourceName)) return false;
  try {
    const parsed = new URL(sourceUrl);
    if (!/^https?:$/.test(parsed.protocol)) return false;
    if (/reddit\.com$/i.test(parsed.hostname.replace(/^www\./i, ""))) return false;
  } catch {
    return false;
  }
  return true;
}

function ownedExplainerPolicyApproved({ canonical = {}, footageInventory = {} } = {}) {
  const budget =
    footageInventory.motion_budget && typeof footageInventory.motion_budget === "object"
      ? footageInventory.motion_budget
      : {};
  const inventory =
    footageInventory.motion_inventory && typeof footageInventory.motion_inventory === "object"
      ? footageInventory.motion_inventory
      : {};
  const explicitOwnedExplainerPlan =
    budget.allow_owned_explainer_motion_only === true &&
    (budget.owned_explainer_visual_plan === true || inventory.owned_explainer_visual_plan === true);
  if (!explicitOwnedExplainerPlan) return false;
  const subject = cleanText(canonical.canonical_subject || canonical.canonical_game);
  if (!subject || /^(?:this story|gaming story|story|news|update)$/i.test(subject)) return false;
  return sourceLooksEditoriallyVerified(canonical);
}

function realMotionInputReadiness({
  motion = {},
  requirements = DEFAULT_FINAL_RENDER_INPUT_REQUIREMENTS,
  visualProfile = {},
} = {}) {
  const minClips = Number(requirements.min_materialised_motion_clips) ||
    DEFAULT_FINAL_RENDER_INPUT_REQUIREMENTS.min_materialised_motion_clips;
  const minFamilies = Number(requirements.min_distinct_motion_families) ||
    DEFAULT_FINAL_RENDER_INPUT_REQUIREMENTS.min_distinct_motion_families;
  const directVideoMotionAssetCount = Number(visualProfile.direct_video_motion_asset_count || 0);
  const directVideoMotionFamilyCount = Number(visualProfile.direct_video_motion_family_count || 0);
  const realVisualMotionClipFloor = Math.min(5, minClips);
  const directVideoMotionClipFloor = realVisualMotionClipFloor;
  const directVideoMotionClipFloorMet = directVideoMotionAssetCount >= directVideoMotionClipFloor;
  const materialisedRealMotionClipFloorMet = motion.real_clips.length >= realVisualMotionClipFloor;
  const hasDirectVideoMotion =
    directVideoMotionAssetCount >= 1 &&
    directVideoMotionFamilyCount >= 1 &&
    motion.real_clips.length >= 1 &&
    motion.real_families.length >= 1;
  const realVisualMotionClipFloorMet =
    directVideoMotionClipFloorMet &&
    materialisedRealMotionClipFloorMet;
  const totalMotionBudgetMet = motion.clips.length >= minClips && motion.families.length >= minFamilies;
  const directVideoProofPlusOwnedMotionReady =
    hasDirectVideoMotion &&
    realVisualMotionClipFloorMet &&
    totalMotionBudgetMet &&
    motion.real_families.length >= 1;
  return {
    has_direct_video_motion: hasDirectVideoMotion,
    direct_video_motion_asset_count: directVideoMotionAssetCount,
    direct_video_motion_family_count: directVideoMotionFamilyCount,
    direct_video_motion_clip_floor: directVideoMotionClipFloor,
    direct_video_motion_clip_floor_met: directVideoMotionClipFloorMet,
    materialised_real_motion_clip_floor_met: materialisedRealMotionClipFloorMet,
    real_visual_motion_clip_floor: realVisualMotionClipFloor,
    real_visual_motion_clip_floor_met: realVisualMotionClipFloorMet,
    total_motion_budget_met: totalMotionBudgetMet,
    direct_video_proof_plus_owned_motion_ready: directVideoProofPlusOwnedMotionReady,
  };
}

async function inspectFinalRenderInputs({
  artifactDir = "",
  audioManifest = {},
  footageInventory = {},
  director = {},
  canonical = {},
  rightsLedger = {},
} = {}) {
  const storyId = cleanText(canonical.story_id || canonical.id || audioManifest.story_id);
  const missingInputFiles = [];
  for (const basename of FINAL_RENDER_INPUTS) {
    if (!artifactDir || !(await fs.pathExists(path.join(artifactDir, basename)))) {
      missingInputFiles.push(basename);
    }
  }

  const narrationAudioPath = await firstReadyPath(
    [
      ...collectObjectPaths(audioManifest, [
        "narration_audio_path",
        "audio_path",
        "output_audio_path",
        "resolved_audio_path",
        "final_mix_path",
        "enriched_audio_path",
      ]),
      ...(storyId ? [`output/audio/${storyId}.mp3`] : []),
    ],
    artifactDir,
  );
  const wordTimestampsPath = await firstReadyPath(
    [
      ...collectObjectPaths(audioManifest, [
        "word_timestamps_path",
        "timestamps_path",
        "resolved_timestamps_path",
        "word_timing_path",
        "stamped_timestamps_path",
        "enriched_timestamps_path",
      ]),
      ...(storyId
        ? [
            `output/audio/${storyId}_timestamps.json`,
            `output/audio/${storyId}_timing.json`,
          ]
        : []),
    ],
    artifactDir,
  );
  const motion = await inspectMaterialisedMotion({ footageInventory, director, artifactDir });
  const requirements = renderInputRequirements(footageInventory, director);
  const ownedExplainerReady = ownedExplainerMotionReady({
    footageInventory,
    rightsLedger,
    motion,
    requirements,
  });
  const blockers = [];
  if (missingInputFiles.includes("audio_manifest.json")) blockers.push("missing_render_input:audio_manifest.json");
  if (missingInputFiles.includes("footage_inventory.json")) blockers.push("missing_render_input:footage_inventory.json");
  if (!narrationAudioPath) blockers.push("final_narration_audio_missing");
  if (!wordTimestampsPath) blockers.push("word_timestamps_missing");
  const repairEvents = [
    {
      at: timeMs(canonical.public_copy_repaired_at),
      audioBlocker: "final_narration_audio_stale_after_public_copy_repair",
      timestampBlocker: "word_timestamps_stale_after_public_copy_repair",
      motionBlocker: "materialised_motion_stale_after_public_copy_repair",
    },
    {
      at: timeMs(canonical.duration_variant_repaired_at),
      audioBlocker: "final_narration_audio_stale_after_duration_variant_repair",
      timestampBlocker: "word_timestamps_stale_after_duration_variant_repair",
      motionBlocker: "materialised_motion_stale_after_duration_variant_repair",
    },
  ].filter((event) => event.at != null).sort((a, b) => b.at - a.at);
  const latestRepairEvent = repairEvents[0] || null;
  let staleMotionPaths = [];
  if (latestRepairEvent) {
    const audioMtime = await pathMtimeMs(narrationAudioPath);
    const timestampMtime = await pathMtimeMs(wordTimestampsPath);
    if (audioMtime != null && audioMtime + 1000 < latestRepairEvent.at) {
      blockers.push(latestRepairEvent.audioBlocker);
    }
    if (timestampMtime != null && timestampMtime + 1000 < latestRepairEvent.at) {
      blockers.push(latestRepairEvent.timestampBlocker);
    }
    staleMotionPaths = motion.clips
      .filter((clip) =>
        clip.public_copy_dependent === true &&
        clip.mtime_ms != null &&
        clip.mtime_ms + 1000 < latestRepairEvent.at,
      )
      .map((clip) => clip.path);
    if (staleMotionPaths.length) {
      blockers.push(latestRepairEvent.motionBlocker);
    }
  }
  if (motion.clips.length < requirements.min_materialised_motion_clips) {
    blockers.push("materialised_motion_clips_missing");
  }
  if (motion.families.length < requirements.min_distinct_motion_families) {
    blockers.push("materialised_motion_families_insufficient");
  }
  const visualProfile = visualEvidenceProfile({
    story: canonical,
    rightsLedger,
    footageInventory,
    directorPlan: director,
  });
  const realMotionReadiness = realMotionInputReadiness({
    motion,
    requirements,
    visualProfile,
  });
  const visualProfileBlockers = asArray(visualProfile.blockers).filter(
    (blocker) =>
      !(
        blocker === "visual_evidence:insufficient_real_visual_source_families" &&
        realMotionReadiness.direct_video_proof_plus_owned_motion_ready
      ),
  );
  if (!ownedExplainerReady) blockers.push(...visualProfileBlockers);
  if (!ownedExplainerReady && !realMotionReadiness.has_direct_video_motion) {
    blockers.push(DIRECT_VIDEO_MOTION_BLOCKER);
  }
  if (!ownedExplainerReady && !realMotionReadiness.direct_video_motion_clip_floor_met) {
    blockers.push("direct_video_motion_clip_floor_not_met");
  }
  if (!ownedExplainerReady && !realMotionReadiness.materialised_real_motion_clip_floor_met) {
    blockers.push("real_visual_motion_clips_missing");
  }
  if (
    !ownedExplainerReady &&
    !realMotionReadiness.direct_video_proof_plus_owned_motion_ready &&
    motion.real_families.length < requirements.min_distinct_motion_families
  ) {
    blockers.push("real_visual_motion_families_insufficient");
  }
  const [audioDigest, timestampsDigest] = await Promise.all([
    fileDigestEvidence(narrationAudioPath),
    fileDigestEvidence(wordTimestampsPath),
  ]);
  const pronunciationFreshness = await ttsPronunciationFreshness({
    timestampPath: wordTimestampsPath,
    canonical,
  });
  blockers.push(...pronunciationFreshness.blockers);
  const timestampAlignment = await wordTimestampAlignmentReadiness({
    timestampPath: wordTimestampsPath,
    audioManifest,
  });
  blockers.push(...timestampAlignment.blockers);
  const timestampSemantics = await wordTimestampSemanticReadiness({
    timestampPath: wordTimestampsPath,
    canonical,
  });
  blockers.push(...timestampSemantics.blockers);

  return {
    status: blockers.length ? "blocked" : "ready_for_final_render_job",
    blockers: unique(blockers),
    required_inputs: FINAL_RENDER_INPUTS,
    requirements,
    evidence: {
      narration_audio_path: narrationAudioPath,
      word_timestamps_path: wordTimestampsPath,
      narration_audio_sha256: audioDigest.sha256,
      narration_audio_size_bytes: audioDigest.size_bytes,
      word_timestamps_sha256: timestampsDigest.sha256,
      word_timestamps_size_bytes: timestampsDigest.size_bytes,
      ...pronunciationFreshness.evidence,
      ...timestampAlignment.evidence,
      ...timestampSemantics.evidence,
      materialised_motion_clip_count: motion.clips.length,
      distinct_motion_family_count: motion.families.length,
      real_visual_motion_clip_count: motion.real_clips.length,
      real_visual_motion_family_count: motion.real_families.length,
      real_motion_input_readiness: realMotionReadiness,
      motion_candidates_seen: motion.candidates_seen,
      materialised_motion_clip_paths: motion.clips.map((clip) => clip.path),
      materialised_motion_clip_mtimes: Object.fromEntries(
        motion.clips.map((clip) => [clip.path, clip.mtime_ms]).filter(([filePath]) => cleanText(filePath)),
      ),
      stale_materialised_motion_clip_paths: staleMotionPaths,
      real_visual_motion_clip_paths: motion.real_clips.map((clip) => clip.path),
      visual_evidence_profile: visualProfile,
      owned_explainer_motion_ready: ownedExplainerReady,
      public_copy_repaired_at: canonical.public_copy_repaired_at || null,
      duration_variant_repaired_at: canonical.duration_variant_repaired_at || null,
    },
  };
}

function finalRenderInputFingerprintBlockers(renderManifest = {}, evidence = {}) {
  const fingerprint = renderManifest?.input_fingerprint || {};
  const blockers = [];
  const audioSha = cleanText(fingerprint.audio_sha256);
  const currentAudioSha = cleanText(evidence.narration_audio_sha256);
  if (audioSha && currentAudioSha) {
    evidence.audio_fingerprint_matches_render = audioSha === currentAudioSha;
    if (audioSha !== currentAudioSha) blockers.push("final_render_audio_fingerprint_mismatch");
  }
  const timestampsSha = cleanText(fingerprint.word_timestamps_sha256);
  const currentTimestampsSha = cleanText(evidence.word_timestamps_sha256);
  if (timestampsSha && currentTimestampsSha) {
    evidence.word_timestamps_fingerprint_matches_render = timestampsSha === currentTimestampsSha;
    if (timestampsSha !== currentTimestampsSha) {
      blockers.push("final_render_word_timestamps_fingerprint_mismatch");
    }
  }
  const audioSize = Number(fingerprint.audio_size_bytes);
  const currentAudioSize = Number(evidence.narration_audio_size_bytes);
  if (Number.isFinite(audioSize) && Number.isFinite(currentAudioSize)) {
    evidence.audio_size_matches_render = audioSize === currentAudioSize;
    if (audioSize !== currentAudioSize) blockers.push("final_render_audio_size_mismatch");
  }
  const timestampsSize = Number(fingerprint.word_timestamps_size_bytes);
  const currentTimestampsSize = Number(evidence.word_timestamps_size_bytes);
  if (Number.isFinite(timestampsSize) && Number.isFinite(currentTimestampsSize)) {
    evidence.word_timestamps_size_matches_render = timestampsSize === currentTimestampsSize;
    if (timestampsSize !== currentTimestampsSize) {
      blockers.push("final_render_word_timestamps_size_mismatch");
    }
  }
  return unique(blockers);
}

function productionRenderTarget(storyId, artifactDir) {
  return {
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
    final_publish_render: true,
    ...currentRenderPolicyManifest(),
    output: "visual_v4_render.mp4",
    output_path: path.join(artifactDir, "visual_v4_render.mp4"),
    manifest_path: path.join(artifactDir, "render_manifest.json"),
    required_quality_gates: DEFAULT_THRESHOLDS,
    story_id: storyId,
  };
}

function firstText(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return "";
}

function isRedditUrl(value) {
  return /(?:^|\/\/)(?:www\.)?(?:reddit\.com|old\.reddit\.com|i\.redd\.it|v\.redd\.it)\b/i.test(
    cleanText(value),
  );
}

function schedulerBridgeSourceType(canonical = {}) {
  const explicit = cleanText(canonical.source_type);
  const primaryUrl = firstText(
    canonical.primary_source_url,
    canonical.source_url,
    canonical.article_url,
    canonical.official_source_url,
  );
  const primarySource = firstText(
    canonical.primary_source,
    canonical.source_card_label,
    canonical.discovery_source,
  );
  if (primaryUrl && !isRedditUrl(primaryUrl) && !/^reddit|r\//i.test(primarySource)) {
    return explicit && explicit.toLowerCase() !== "reddit" ? explicit : "rss";
  }
  return explicit || "governed_bridge_candidate";
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function renderedDurationSeconds(renderManifest = {}, platformManifest = {}) {
  return (
    numberOrNull(renderManifest.rendered_duration_s) ??
    numberOrNull(renderManifest.duration_s) ??
    numberOrNull(renderManifest.video_duration_s) ??
    numberOrNull(platformManifest.rendered_duration_s) ??
    numberOrNull(platformManifest.duration_s) ??
    numberOrNull(platformManifest.video_duration_s)
  );
}

function isRetentionShortApproved({ canonical = {}, renderManifest = {}, platformManifest = {} } = {}) {
  return (
    canonical.breaking_news_flag === true ||
    canonical.retention_short_approved === true ||
    canonical.human_reviewed_retention_short === true ||
    renderManifest.retention_short_approved === true ||
    renderManifest.human_reviewed_retention_short === true ||
    platformManifest.retention_short_approved === true ||
    platformManifest.human_reviewed_retention_short === true ||
    cleanText(renderManifest.duration_lane) === "pulse_retention_short_approved" ||
    cleanText(platformManifest.duration_lane) === "pulse_retention_short_approved"
  );
}

function durationFloorBlockers({ canonical = {}, renderManifest = {}, platformManifest = {} } = {}) {
  const duration = renderedDurationSeconds(renderManifest, platformManifest);
  if (
    duration != null &&
    duration < 35 &&
    !isRetentionShortApproved({ canonical, renderManifest, platformManifest })
  ) {
    return [`normal_production_duration_below_quality_floor:${Math.round(duration)}`];
  }
  return [];
}

function normalDurationRepairJob(item = {}, { generatedAt = new Date().toISOString() } = {}) {
  const duration = numberOrNull(item.rendered_duration_s);
  const durationBlocker = asArray(item.blockers).find((blocker) =>
    /^normal_production_duration_below_quality_floor:/i.test(cleanText(blocker)),
  );
  if (!durationBlocker || item.render_input_status !== "ready_for_final_render_job") return null;
  return {
    story_id: cleanText(item.story_id),
    title: cleanText(item.title),
    artifact_dir: item.artifact_dir,
    status: "needs_duration_variant_rerender",
    repair_lane: "normal_production_duration_floor",
    current_duration_s: duration,
    target_duration_seconds: { ...NORMAL_PRODUCTION_TARGET_SECONDS },
    minimum_extension_seconds: Number.isFinite(duration)
      ? Math.max(0, Math.round((NORMAL_PRODUCTION_TARGET_SECONDS.min - duration) * 1000) / 1000)
      : null,
    source_blockers: asArray(item.blockers),
    generated_at: generatedAt,
    actions: [
      "extend_canonical_script_source_safely",
      "regenerate_audio_and_word_timestamps",
      "rerender_visual_v4_platform_variants",
      "rerun_content_video_platform_governance_preflight",
    ],
    publish_gate: "do_not_treat_as_green_until_rerendered_and_preflight_passes",
    safety: {
      no_publish_triggered: true,
      no_db_mutation: true,
      no_gate_weakened: true,
    },
  };
}

function rightsRecordsFromLedger(ledger = {}) {
  if (Array.isArray(ledger)) return ledger.filter(Boolean);
  if (Array.isArray(ledger.records)) return ledger.records.filter(Boolean);
  if (Array.isArray(ledger.rights_ledger)) return ledger.rights_ledger.filter(Boolean);
  return [];
}

function rightsAssetsFromLedger(ledger = {}) {
  if (ledger && typeof ledger === "object" && Array.isArray(ledger.assets)) {
    return ledger.assets.filter(Boolean);
  }
  return [];
}

function footageMotionAssets(footageInventory = {}) {
  return [
    ...asArray(footageInventory?.motion_inventory?.accepted_local_clips),
    ...asArray(footageInventory?.motion_inventory?.production_motion_clips),
    ...asArray(footageInventory?.accepted_local_clips),
    ...asArray(footageInventory?.production_motion_clips),
    ...asArray(footageInventory?.clips),
  ].filter(Boolean);
}

function selectedRenderMotionAssets(renderStory = {}) {
  return [
    ...asArray(renderStory.visual_v4_bridge_video_clips),
    ...asArray(renderStory.selected_render_clips),
    ...asArray(renderStory.video_clips),
  ]
    .filter(Boolean)
    .map((asset, index) => {
      if (typeof asset === "string") {
        return {
          id: `selected_render_clip_${index + 1}`,
          path: asset,
          source_type: "selected_render_motion_clip",
          source_family: `selected_render_clip_${index + 1}`,
          validated: true,
        };
      }
      return {
        ...asset,
        source_type: asset.source_type || asset.media_kind || "selected_render_motion_clip",
      };
    })
    .filter((asset) =>
      cleanPathCandidate(
        asset.path ||
          asset.local_materialized_path ||
          asset.local_materialised_path ||
          asset.local_path ||
          asset.file_path ||
          asset.media_path,
      ),
    );
}

function selectedRenderEvidenceProfile(renderStory = {}) {
  const assets = selectedRenderMotionAssets(renderStory);
  return {
    has_selected_render_assets: assets.length > 0,
    ...visualEvidenceProfile({
      footageInventory: {
        motion_inventory: {
          production_motion_clips: assets,
        },
      },
    }),
  };
}

function selectedRenderRealEvidenceRefreshBlockers({
  selectedRenderEvidence = {},
  visualEvidence = {},
} = {}) {
  if (selectedRenderEvidence.has_selected_render_assets !== true) return [];
  const blockers = [];
  const availableRealMotion = Number(visualEvidence.real_motion_asset_count || 0);
  const availableDirectVideo = Number(visualEvidence.direct_video_motion_asset_count || 0);
  const selectedRealMotion = Number(selectedRenderEvidence.real_motion_asset_count || 0);
  const selectedDirectVideo = Number(selectedRenderEvidence.direct_video_motion_asset_count || 0);
  if (selectedRenderEvidence.generated_only_motion_deck === true && availableRealMotion > 0) {
    blockers.push("selected_render_evidence:generated_only_motion_deck");
  }
  if (selectedRealMotion < 1 && availableRealMotion > 0) {
    blockers.push("selected_render_evidence:available_real_motion_not_used");
  }
  if (selectedDirectVideo < 1 && availableDirectVideo > 0) {
    blockers.push("selected_render_evidence:available_direct_video_not_used");
  }
  return unique(blockers);
}

const SELECTED_RENDER_SATISFIED_INPUT_BLOCKERS = new Set([
  "materialised_motion_clips_missing",
  "materialised_motion_families_insufficient",
  "real_visual_motion_clips_missing",
  "real_visual_motion_families_insufficient",
  "direct_video_motion_clip_floor_not_met",
  DIRECT_VIDEO_MOTION_BLOCKER,
]);

function selectedRenderSatisfiesMotionInputBudget({
  selectedRenderEvidence = {},
  requirements = DEFAULT_FINAL_RENDER_INPUT_REQUIREMENTS,
} = {}) {
  if (selectedRenderEvidence.has_selected_render_assets !== true) return false;
  if (selectedRenderEvidence.generated_only_motion_deck === true) return false;
  const minClips = Number(requirements.min_materialised_motion_clips) ||
    DEFAULT_FINAL_RENDER_INPUT_REQUIREMENTS.min_materialised_motion_clips;
  const minFamilies = Number(requirements.min_distinct_motion_families) ||
    DEFAULT_FINAL_RENDER_INPUT_REQUIREMENTS.min_distinct_motion_families;
  const directVideoFloor = Math.min(5, minClips);
  return (
    Number(selectedRenderEvidence.motion_asset_count || 0) >= minClips &&
    Number(selectedRenderEvidence.real_motion_asset_count || 0) >= Math.min(5, minClips) &&
    Number(selectedRenderEvidence.real_media_family_count || 0) >= minFamilies &&
    Number(selectedRenderEvidence.direct_video_motion_asset_count || 0) >= directVideoFloor &&
    Number(selectedRenderEvidence.direct_video_motion_family_count || 0) >= 1
  );
}

function renderInputsWithSelectedRenderMotionEvidence(renderInputs = {}, {
  selectedRenderEvidence = {},
} = {}) {
  const blockers = asArray(renderInputs.blockers).map(cleanText).filter(Boolean);
  const selectedRenderSatisfied = selectedRenderSatisfiesMotionInputBudget({
    selectedRenderEvidence,
    requirements: renderInputs.requirements,
  });
  if (!selectedRenderSatisfied) return renderInputs;
  const cleared = blockers.filter((blocker) => SELECTED_RENDER_SATISFIED_INPUT_BLOCKERS.has(blocker));
  if (!cleared.length) {
    return {
      ...renderInputs,
      evidence: {
        ...(renderInputs.evidence || {}),
        selected_render_input_motion_ready: true,
      },
    };
  }
  const remainingBlockers = blockers.filter((blocker) => !SELECTED_RENDER_SATISFIED_INPUT_BLOCKERS.has(blocker));
  return {
    ...renderInputs,
    status: remainingBlockers.length ? "blocked" : "ready_for_final_render_job",
    blockers: remainingBlockers,
    evidence: {
      ...(renderInputs.evidence || {}),
      selected_render_input_motion_ready: true,
      selected_render_input_motion_blockers_cleared: unique(cleared),
    },
  };
}

function bridgeClipFromAsset(asset = {}, index = 0, fallbackSourceType = "owned_motion_clip") {
  const mediaKind = cleanText(asset.media_kind || asset.kind || "");
  const sourceUrlKind = cleanText(asset.source_url_kind || asset.url_kind || "");
  const sourceType = cleanText(asset.source_type || asset.type || mediaKind || fallbackSourceType);
  const directVideoLike = /direct_video|hls_manifest|dash_manifest|official_trailer_segment|official_video|gameplay|trailer/i.test(
    [mediaKind, sourceUrlKind, sourceType, asset.source_url, asset.url].map(cleanText).join(" "),
  );
  const fallbackRightsBasis = directVideoLike
    ? "official_reference_transformative_editorial_use"
    : "owned_generated_motion";
  return {
    id: cleanText(asset.asset_id || asset.id || asset.motion_pack_clip_id || `bridge_clip_${index + 1}`),
    path: cleanText(
      asset.path ||
        asset.local_materialized_path ||
        asset.local_materialised_path ||
        asset.local_path ||
        asset.file_path ||
        asset.media_path ||
        "",
    ),
    source_url: cleanText(asset.source_url || asset.url || ""),
    source_type: sourceType,
    media_kind: mediaKind,
    source_url_kind: sourceUrlKind,
    source_family: cleanText(
      asset.source_family ||
        asset.motion_family ||
        asset.family ||
        asset.id ||
        asset.asset_id ||
        `bridge_family_${index + 1}`,
    ),
    rights_risk_class: cleanText(
      asset.rights_risk_class ||
        asset.rights_basis ||
        asset.licence_basis ||
        asset.approval_status ||
        fallbackRightsBasis,
    ),
    rights_basis: cleanText(asset.rights_basis || asset.licence_basis || asset.license_basis || fallbackRightsBasis),
    licence_basis: cleanText(asset.licence_basis || asset.license_basis || asset.rights_basis || fallbackRightsBasis),
    transformation_notes: cleanText(asset.transformation_notes || asset.transformative_use_notes || ""),
    counts_towards_motion_readiness: asset.counts_towards_motion_readiness === true || directVideoLike,
    validated: asset.validated !== false,
  };
}

function dedupeBridgeClips(clips = []) {
  const seen = new Set();
  const deduped = [];
  for (const clip of clips) {
    const key = [clip.path, clip.source_family, clip.id].map(cleanText).join("|");
    if (!cleanText(clip.path) || seen.has(key)) continue;
    seen.add(key);
    deduped.push(clip);
  }
  return deduped;
}

function bridgeVideoClips({
  rightsLedger = {},
  footageInventory = {},
  director = {},
  renderManifest = {},
  renderStory = {},
  storyId = "",
  artifactDir = "",
} = {}) {
  const selectedRenderClips = [
    ...asArray(renderStory.visual_v4_bridge_video_clips),
    ...asArray(renderStory.selected_render_clips),
  ]
    .filter((asset) =>
      asset &&
      asset.validated !== false &&
      cleanPathCandidate(
        asset.path ||
          asset.local_materialized_path ||
          asset.local_materialised_path ||
          asset.local_path ||
          asset.file_path ||
          asset.media_path,
      ),
    )
    .map((asset, index) => bridgeClipFromAsset(asset, index, "selected_render_motion_clip"));
  if (selectedRenderClips.length) return dedupeBridgeClips(selectedRenderClips);

  const footageClips = footageMotionAssets(footageInventory)
    .filter((asset) =>
      asset &&
      asset.validated !== false &&
      asset.counts_towards_motion_readiness !== false &&
      cleanPathCandidate(
        asset.path ||
          asset.local_materialized_path ||
          asset.local_materialised_path ||
          asset.local_path ||
          asset.file_path ||
          asset.media_path,
      ),
    )
    .map((asset, index) => bridgeClipFromAsset(asset, index, "materialised_motion_clip"));
  if (footageClips.length) return dedupeBridgeClips(footageClips);

  const rightsRecords = [
    ...rightsAssetsFromLedger(rightsLedger),
    ...rightsRecordsFromLedger(rightsLedger),
  ];
  const assets = rightsRecords
    .filter((asset) =>
      /video|motion|clip|trailer|screenshot_derived/i.test(
        `${asset.kind || ""} ${asset.type || ""} ${asset.asset_type || ""} ${asset.source_type || ""}`,
      ),
    )
    .map((asset, index) => bridgeClipFromAsset(asset, index, "owned_motion_clip"));
  if (assets.length) return dedupeBridgeClips(assets);

  const shots = asArray(director.shot_plan || director.shots)
    .filter((shot) => cleanText(shot.kind) === "motion_clip" && cleanPathCandidate(shot.media_path || shot.path))
    .map((shot, index) => ({
      id: cleanText(shot.motion_pack_clip_id || shot.id || `bridge_shot_${index + 1}`),
      path: cleanText(shot.media_path || shot.path),
      source_url: cleanText(shot.source_url || ""),
      source_type: "director_motion_clip",
      source_family: cleanText(shot.source_family || shot.id || `bridge_shot_family_${index + 1}`),
      rights_risk_class: cleanText(shot.rights_risk_class || "owned_generated_motion"),
      validated: shot.validated !== false,
    }));
  if (shots.length) return dedupeBridgeClips(shots);

  const outputPath = cleanText(renderManifest.output_path || path.join(artifactDir, renderManifest.output || "visual_v4_render.mp4"));
  return outputPath
    ? [{
        id: `${storyId || "story"}_final_render`,
        path: outputPath,
        source_url: `local://pulse-production-render/${storyId || "story"}`,
        source_type: "visual_v4_production_render",
        source_family: `${storyId || "story"}_final_render`,
        rights_risk_class: "owned_generated_motion",
        validated: true,
      }]
    : [];
}

function buildFinalRenderRightsRecord(clip = {}, storyId = "") {
  return {
    asset_id: cleanText(clip.id || `${storyId || "story"}_final_render`),
    path: cleanText(clip.path),
    source_url: cleanText(clip.source_url),
    source_type: cleanText(clip.source_type || "visual_v4_production_render"),
    licence_basis: "owned_generated_editorial_render",
    allowed_platforms: ["youtube", "tiktok", "instagram", "facebook", "x", "threads", "pinterest"],
    commercial_use_allowed: true,
    transformation_notes: "Final Pulse Gaming production render generated from governed story package assets.",
    expiry: null,
    credit_required: false,
    risk_score: 0.02,
    approval_status: "approved",
  };
}

function normaliseText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9$]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textContainsSubjectToken(text = "", subject = "") {
  const haystack = normaliseText(text);
  const needle = normaliseText(subject);
  if (!haystack || !needle) return true;
  if (haystack.includes(needle)) return true;
  return needle
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !["this", "that", "with", "from"].includes(token))
    .some((token) => haystack.includes(token));
}

function subjectThumbnailKeyword(subject = "", title = "") {
  const subjectText = cleanText(subject);
  const titleText = cleanText(title);
  const parts = subjectText.includes(":")
    ? [subjectText.split(":").pop(), subjectText.split(":")[0]]
    : [subjectText];
  const stop = new Set(["the", "and", "for", "with", "that", "this", "game", "gaming", "story", "news"]);
  for (const part of parts) {
    const tokens = cleanText(part)
      .split(/[^a-zA-Z0-9$]+/)
      .filter((token) => token.length >= 4 && !stop.has(token.toLowerCase()));
    const titleToken = tokens.find((token) => normaliseText(titleText).includes(normaliseText(token)));
    if (titleToken) return titleToken.toUpperCase();
    if (tokens[0]) return tokens[0].toUpperCase();
  }
  return "";
}

function subjectAlignedThumbnailText({ thumbnailText = "", title = "", subject = "" } = {}) {
  const base = firstText(thumbnailText, title);
  if (!base || !subject || textContainsSubjectToken(base, subject)) return base;
  const keyword = subjectThumbnailKeyword(subject, title);
  if (!keyword) return base;
  return cleanText(`${keyword} ${base}`)
    .split(/\s+/)
    .slice(0, 7)
    .join(" ")
    .toUpperCase();
}

function subjectAlignedDescription({
  description = "",
  subject = "",
  title = "",
  angle = "",
  sourceLabel = "",
} = {}) {
  const base = cleanText(description);
  const subjectText = cleanText(subject);
  if (!base && !subjectText) return "";
  if (base && textContainsSubjectToken(base, subjectText)) return base;

  const fallback = cleanText(base || title || angle);
  let repaired = subjectText ? `${subjectText}: ${fallback || cleanText(title || angle)}` : fallback;
  if (sourceLabel && !/\bsource\s*:/i.test(repaired)) {
    repaired = `${repaired}. Source: ${cleanText(sourceLabel)}.`;
  }
  return cleanText(repaired.replace(/\s+\./g, "."));
}

function buildAudioRightsRecord({ storyId = "", audioPath = "", audioManifest = {} } = {}) {
  if (!audioPath) return null;
  const provider = cleanText(
    audioManifest.voice_provider ||
      audioManifest.provider ||
      audioManifest.tts_provider ||
      audioManifest.voice_source,
  ).toLowerCase();
  const elevenLabs = provider.includes("elevenlabs");
  return {
    asset_id: `${storyId || "story"}_audio_path`,
    path: audioPath,
    source_url: elevenLabs
      ? `elevenlabs://pulse-gaming/${storyId || "story"}`
      : `local://pulse-local-tts/${storyId || "story"}`,
    source_type: elevenLabs ? "elevenlabs_tts_voice" : "local_tts_voice",
    licence_basis: elevenLabs ? "elevenlabs_commercial_tts_generation" : "owned_local_voice_model",
    allowed_platforms: ["youtube", "tiktok", "instagram", "facebook", "x", "threads", "pinterest"],
    commercial_use_allowed: true,
    transformation_notes: "Narration generated for the governed Pulse Gaming story package.",
    expiry: null,
    credit_required: false,
    risk_score: elevenLabs ? 0.08 : 0.05,
    evidence_file: elevenLabs ? "rights/elevenlabs-commercial-tts.json" : "rights/local-tts-liam.json",
    approval_status: "approved",
  };
}

function refreshedGovernanceForBridgeCandidate(candidate = {}, { generatedAt = new Date().toISOString() } = {}) {
  try {
    const { buildStudioGovernanceReport } = require("./studio-governance-engine");
    return buildStudioGovernanceReport({
      story: candidate,
      rightsLedger: candidate.rights_ledger,
      commercialManifest: candidate.affiliate_link_manifest,
      generatedAt,
      captionPath: candidate.manual_caption_path || candidate.caption_path,
    });
  } catch (error) {
    return {
      publish_control_tower: candidate.publish_verdict || {},
      publish_manifest: {
        publish_status: candidate.platform_publish_manifest?.publish_status || null,
        can_auto_publish: candidate.publish_verdict?.can_auto_publish === true,
        reason_codes: candidate.publish_verdict?.reason_codes || [],
        warnings: [`governance_refresh_error:${error.code || "unknown"}`],
      },
    };
  }
}

function applyGovernanceRefreshToBridgeCandidate(candidate = {}, { generatedAt = new Date().toISOString() } = {}) {
  const report = refreshedGovernanceForBridgeCandidate(candidate, { generatedAt });
  const publishVerdict = report.publish_control_tower || candidate.publish_verdict || {};
  const publishManifest = report.publish_manifest || {};
  return {
    ...candidate,
    governance_publish_status: publishManifest.publish_status || candidate.governance_publish_status,
    publish_verdict: publishVerdict,
    publish_manifest: publishManifest,
    platform_publish_manifest: {
      ...(candidate.platform_publish_manifest || {}),
      publish_status: publishManifest.publish_status || candidate.platform_publish_manifest?.publish_status || null,
      can_auto_publish: publishManifest.can_auto_publish === true,
      reason_codes: publishManifest.reason_codes || publishVerdict.reason_codes || [],
      warnings: publishManifest.warnings || publishVerdict.warnings || [],
      governance_refreshed_at: generatedAt,
      governance_refresh_source: "studio_governance_engine",
      governance_gates: publishManifest.gates || null,
    },
  };
}

async function persistGovernanceRefreshArtifacts({ artifactDir = "", candidate = {}, generatedAt = new Date().toISOString() } = {}) {
  if (!artifactDir || !candidate.publish_verdict || !candidate.platform_publish_manifest) return null;
  const publishVerdictPath = path.join(artifactDir, "publish_verdict.json");
  const platformManifestPath = path.join(artifactDir, "platform_publish_manifest.json");
  const refreshedVerdict = {
    ...candidate.publish_verdict,
    governance_refreshed_at: generatedAt,
    governance_refresh_source: "studio_governance_engine",
    safety: {
      ...(candidate.publish_verdict.safety || {}),
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
  const refreshedPlatformManifest = {
    ...candidate.platform_publish_manifest,
    safety: {
      ...(candidate.platform_publish_manifest.safety || {}),
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
  await fs.writeJson(publishVerdictPath, refreshedVerdict, { spaces: 2 });
  await fs.writeJson(platformManifestPath, refreshedPlatformManifest, { spaces: 2 });
  return {
    publishVerdictPath,
    platformManifestPath,
  };
}

function buildSchedulerBridgeCandidate({
  storyId = "",
  artifactDir = "",
  canonical = {},
  renderManifest = {},
  renderStory = {},
  benchmark = {},
  visualQuality = {},
  platformManifest = {},
  publishVerdict = {},
  director = {},
  audioManifest = {},
  footageInventory = {},
  rightsLedger = {},
  sfxManifest = {},
  affiliateManifest = {},
  platformPolicyReport = {},
  landingPageManifest = {},
  ownedExplainerMotionReady = false,
  ownedExplainerExceptionApproved = false,
  humanReviewedOwnedExplainerException = false,
  generatedAt = new Date().toISOString(),
} = {}) {
  const title = firstText(canonical.selected_title, canonical.short_title, canonical.canonical_title, storyId);
  const canonicalSubject = firstText(canonical.canonical_subject, canonical.canonical_game, title);
  const script = firstText(canonical.narration_script, canonical.full_script, canonical.first_spoken_line, title);
  const hook = firstText(canonical.first_spoken_line, canonical.narration_hook, script);
  const exportedPath = firstText(renderManifest.output_path, path.join(artifactDir, renderManifest.output || "visual_v4_render.mp4"));
  const captionsPath = path.join(artifactDir, "captions.srt");
  const audioPath = firstText(
    audioManifest.final_mix_path,
    audioManifest.narration_audio_path,
    audioManifest.audio_path,
    audioManifest.output_audio_path,
  );
  const timestampsPath = firstText(
    audioManifest.word_timestamps_path,
    audioManifest.timestamps_path,
    audioManifest.resolved_timestamps_path,
  );
  const videoClips = bridgeVideoClips({
    rightsLedger,
    footageInventory,
    director,
    renderManifest,
    renderStory,
    storyId,
    artifactDir,
  });
  const existingRecords = rightsRecordsFromLedger(rightsLedger);
  const finalRecords = videoClips
    .filter((clip) => !existingRecords.some((record) =>
      cleanText(record.asset_id) === cleanText(clip.id) ||
      (record.path && cleanText(record.path) === cleanText(clip.path)) ||
      (record.source_url && cleanText(record.source_url) === cleanText(clip.source_url))
    ))
    .map((clip) => buildFinalRenderRightsRecord(clip, storyId));
  const audioRecord = buildAudioRightsRecord({ storyId, audioPath, audioManifest });
  const audioRecordNeeded = audioRecord && !existingRecords.some((record) =>
    cleanText(record.asset_id) === audioRecord.asset_id ||
    (record.path && cleanText(record.path) === audioRecord.path) ||
    (record.source_url && cleanText(record.source_url) === audioRecord.source_url)
  );
  const duration = renderedDurationSeconds(renderManifest, platformManifest);
  const clipCount = numberOrNull(renderManifest.clips) ?? videoClips.length;
  const explicitDurationLane = cleanText(
    platformManifest.duration_lane ||
      renderManifest.duration_lane ||
      canonical.duration_lane,
  );
  const normalProductionDuration =
    explicitDurationLane === "normal_production" ||
    cleanText(platformManifest.duration_contract_strategy) === "normal_production_safe_script_expansion" ||
    cleanText(canonical.duration_variant_repair_strategy) === "normal_production_safe_script_expansion";
  const durationLane = normalProductionDuration ? "normal_production" : "pulse_retention_short";
  const allowRetentionShortVideo = !normalProductionDuration;
  const thumbnailText = subjectAlignedThumbnailText({
    thumbnailText: firstText(canonical.thumbnail_headline, canonical.thumbnail_text, title),
    title,
    subject: canonicalSubject,
  });
  const sourceLabel = firstText(canonical.source_card_label, canonical.primary_source);
  const description = subjectAlignedDescription({
    description: canonical.description,
    subject: canonicalSubject,
    title,
    angle: canonical.canonical_angle,
    sourceLabel,
  });
  const affiliateLinks = [
    affiliateManifest.primary_link,
    ...asArray(affiliateManifest.fallback_links),
    ...asArray(affiliateManifest.affiliate_links),
  ]
    .filter((link) => link && (typeof link === "string" || cleanText(link.url || link.href || link.link)))
    .map((link) =>
      typeof link === "string"
        ? { url: cleanText(link), label: "Related link" }
        : link,
    );
  const primaryAffiliateLink = affiliateLinks[0] || null;
  const affiliateDisclosure = firstText(
    affiliateManifest.disclosure,
    affiliateManifest.disclosure_text,
    affiliateManifest.disclosure_copy?.short,
    affiliateManifest.disclosure_copy?.video,
    affiliateManifest.disclosure_copy?.landing,
  );

  const candidate = {
    id: storyId,
    title,
    suggested_title: title,
    public_title: title,
    upload_title: title,
    canonical_subject: canonicalSubject,
    canonical_game: firstText(canonical.canonical_game, canonical.canonical_subject),
    canonical_company: cleanText(canonical.canonical_company),
    canonical_angle: firstText(canonical.canonical_angle, "source_locked_update"),
    confirmed_claims: asArray(canonical.confirmed_claims),
    unconfirmed_claims: asArray(canonical.unconfirmed_claims),
    prohibited_claims: asArray(canonical.prohibited_claims),
    primary_source: firstText(canonical.primary_source, canonical.source_card_label),
    primary_source_url: cleanText(canonical.primary_source_url),
    source_type: schedulerBridgeSourceType(canonical),
    source_name: sourceLabel,
    subreddit: null,
    url: cleanText(canonical.primary_source_url),
    source_url: cleanText(canonical.primary_source_url),
    article_url: cleanText(canonical.primary_source_url),
    discovery_source: cleanText(canonical.discovery_source),
    source_card_label: sourceLabel,
    thumbnail_source_label: sourceLabel,
    suggested_thumbnail_text: thumbnailText,
    thumbnail_text: thumbnailText,
    full_script: script,
    tts_script: script,
    hook,
    body: script,
    loop: `${PRIMARY_PULSE_CTA}.`,
    description,
    pinned_comment: cleanText(canonical.pinned_comment),
    platform_ctas: canonical.platform_ctas || {},
    affiliate_url: primaryAffiliateLink ? cleanText(primaryAffiliateLink.url || primaryAffiliateLink.href || primaryAffiliateLink.link) : null,
    affiliate_links: affiliateLinks,
    affiliate_disclosure: affiliateDisclosure || null,
    commercial_intelligence: affiliateManifest,
    exported_path: exportedPath,
    audio_path: audioPath,
    timestamps_path: timestampsPath,
    manual_caption_path: captionsPath,
    caption_path: captionsPath,
    approved: true,
    auto_approved: true,
    approved_at: generatedAt,
    publish_status: null,
    publish_error: null,
    qa_failed: false,
    qa_failures: [],
    video_qa_failures: [],
    content_qa_failures: [],
    script_generation_status: "approved",
    script_review_reason: "",
    render_lane: "visual_v4_production",
    render_quality_class: "premium",
    render_manifest_path: path.join(artifactDir, "render_manifest.json"),
    governance_manifest_path: path.join(artifactDir, "publish_manifest.json"),
    governance_publish_status: "GREEN",
    visual_v4_render_bridge_status: "ready_for_live_cutover",
    visual_v4_render_bridge_clip_count: clipCount,
    visual_v4_bridge_video_clips: videoClips,
    video_clips: videoClips,
    rights_ledger: [
      ...existingRecords,
      ...finalRecords,
      ...(audioRecordNeeded ? [audioRecord] : []),
    ],
    visual_v4_director_plan: director,
    director_plan: director,
    footage_inventory: footageInventory,
    media_house_benchmark: benchmark,
    benchmark_report: benchmark,
    visual_quality_report: visualQuality,
    require_gold_standard_benchmark: true,
    media_house_benchmark_required: true,
    transformative_edit_evidence: true,
    transformative_edit_notes:
      "Bridge candidate uses a governed Pulse Gaming edit with generated motion graphics, source locks, captions and original narration.",
    manual_caption_generated: true,
    clean_manual_captions: true,
    subtitle_timing_source: "timestamps",
    duration_seconds: duration,
    runtime_seconds: duration,
    audio_duration: numberOrNull(audioManifest.duration_seconds) ?? duration,
    qa_visual_count: clipCount,
    distinct_visual_count: clipCount,
    outro_present: true,
    thumbnail_candidate_present: true,
    duration_lane: durationLane,
    allow_retention_short_video: allowRetentionShortVideo,
    min_video_duration_seconds: normalProductionDuration ? 35 : 15,
    max_video_duration_seconds: 60,
    owned_explainer_motion_ready: ownedExplainerMotionReady === true,
    owned_explainer_motion_exception_approved: ownedExplainerExceptionApproved === true,
    human_reviewed_owned_explainer_motion_exception: humanReviewedOwnedExplainerException === true,
    scheduler_bridge_source: "goal_production_cutover",
    scheduler_bridge_artifact_dir: artifactDir,
    platform_publish_manifest: platformManifest,
    publish_verdict: publishVerdict,
    sfx_manifest: sfxManifest,
    affiliate_link_manifest: affiliateManifest,
    platform_policy_report: platformPolicyReport,
    landing_page_manifest: landingPageManifest,
  };
  return applyGovernanceRefreshToBridgeCandidate(candidate, { generatedAt });
}

function buildSchedulerBridge(inspected = [], { generatedAt = new Date().toISOString() } = {}) {
  const candidates = inspected
    .filter((item) => item.status === "ready_for_dry_run_publish" && item.scheduler_candidate)
    .map((item) => item.scheduler_candidate);
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "SCHEDULER_BRIDGE_DRY_RUN",
    status: candidates.length ? "ready_for_dry_run_preflight" : "no_ready_candidates",
    candidate_count: candidates.length,
    candidates,
    safety: {
      read_only: true,
      db_mutation: false,
      posting: false,
      oauth: false,
      token_printing: false,
      safety_gates_weakened: false,
    },
  };
}

function benchmarkBlockers(benchmark = {}, thresholds = DEFAULT_THRESHOLDS) {
  const blockers = [];
  const scores = benchmark.scores || {};
  if (benchmark.result && benchmark.result !== "pass") {
    blockers.push("benchmark_not_pass");
  }
  for (const [scoreName, minimum] of Object.entries(thresholds)) {
    const actual = Number(scores[scoreName]);
    if (!Number.isFinite(actual) || actual < minimum) {
      blockers.push(`benchmark_below_production_threshold:${scoreName}`);
    }
  }
  return blockers;
}

function schedulerCandidateBenchmarkBlockers(candidate = {}, thresholds = DEFAULT_THRESHOLDS) {
  const benchmark = runMediaHouseBenchmark({
    story: candidate,
    directorPlan: candidate.visual_v4_director_plan || candidate.director_plan,
    requireGate: true,
  });
  const blockers = [];
  if (benchmark.result && benchmark.result !== "pass") {
    blockers.push("scheduler_candidate_benchmark_not_pass");
  }
  for (const failure of asArray(benchmark.failures)) {
    blockers.push(`scheduler_candidate:${failure}`);
  }
  for (const blocker of benchmarkBlockers(benchmark, thresholds)) {
    blockers.push(`scheduler_candidate:${blocker}`);
  }
  return {
    benchmark,
    blockers: unique(blockers),
  };
}

function renderManifestBlockers(renderManifest = {}) {
  const blockers = [];
  if (renderManifest.final_publish_render !== true) {
    blockers.push("render_not_final_publish_ready");
  }
  if (!PRODUCTION_RENDERERS.has(cleanText(renderManifest.renderer))) {
    blockers.push("render_renderer_not_production");
  }
  if (!PRODUCTION_TIERS.has(cleanText(renderManifest.visual_tier))) {
    blockers.push("render_tier_not_production");
  }
  return blockers;
}

async function inspectStoryPackage(storyPackage = {}, options = {}) {
  const artifactDir = storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir || "";
  const storyId = storyPackage.story_id || storyPackage.id || "unknown";
  const missingInputs = [];
  for (const basename of REQUIRED_INPUTS) {
    const ok = artifactDir ? await fileReady(path.join(artifactDir, basename), basename) : false;
    if (!ok) missingInputs.push(basename);
  }

  const [
    canonical,
    renderManifest,
    renderStory,
    benchmark,
    visualQuality,
    platformManifest,
    publishVerdict,
    director,
    audioManifest,
    footageInventory,
    rightsLedger,
    sfxManifest,
  ] = await Promise.all([
    readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json")),
    readJsonIfPresent(path.join(artifactDir, "render_manifest.json")),
    readJsonIfPresent(path.join(artifactDir, "visual_v4_render_story.json")),
    readJsonIfPresent(path.join(artifactDir, "benchmark_report.json")),
    readJsonIfPresent(path.join(artifactDir, "visual_quality_report.json")),
    readJsonIfPresent(path.join(artifactDir, "platform_publish_manifest.json")),
    readJsonIfPresent(path.join(artifactDir, "publish_verdict.json")),
    readJsonIfPresent(path.join(artifactDir, "director_beat_map.json")),
    readJsonIfPresent(path.join(artifactDir, "audio_manifest.json")),
    readJsonIfPresent(path.join(artifactDir, "footage_inventory.json")),
    readJsonIfPresent(path.join(artifactDir, "rights_ledger.json")),
    readJsonIfPresent(path.join(artifactDir, "sfx_manifest.json")),
  ]);

  const qualityBlockers = benchmarkBlockers(benchmark, options.thresholds || DEFAULT_THRESHOLDS);
  const visualEvidence = visualEvidenceProfile({
    story: canonical,
    rightsLedger,
    footageInventory,
    directorPlan: director,
  });
  const finalMotionEvidence = await inspectMaterialisedMotion({ footageInventory, director, artifactDir });
  const finalMotionRequirements = renderInputRequirements(footageInventory, director);
  const ownedExplainerReadyForStory = ownedExplainerMotionReady({
    footageInventory,
    rightsLedger,
    motion: finalMotionEvidence,
    requirements: finalMotionRequirements,
  });
  const ownedExplainerExceptionForStory = ownedExplainerExceptionApproved({
    canonical,
    renderManifest,
    storyPackage,
  }) || (ownedExplainerReadyForStory && ownedExplainerPolicyApproved({ canonical, footageInventory }));
  const ownedExplainerCanBypassRealMotion =
    ownedExplainerReadyForStory && ownedExplainerExceptionForStory;
  const visualEvidenceBlockers = ownedExplainerCanBypassRealMotion ? [] : asArray(visualEvidence.blockers);
  const directVideoMotionMissing =
    !ownedExplainerCanBypassRealMotion &&
    Number(visualEvidence.direct_video_motion_asset_count || 0) < 1;
  const selectedRenderEvidence = selectedRenderEvidenceProfile(renderStory);
  const selectedRenderRefreshBlockers = selectedRenderRealEvidenceRefreshBlockers({
    selectedRenderEvidence,
    visualEvidence,
  });
  const selectedRenderDirectVideoMotionMissing =
    !ownedExplainerCanBypassRealMotion &&
    selectedRenderEvidence.has_selected_render_assets === true &&
    Number(selectedRenderEvidence.direct_video_motion_asset_count || 0) < 1;
  const renderBlockers = renderManifestBlockers(renderManifest);
  const finalReady = renderManifest.final_publish_render === true;
  const durationBlockers = finalReady
    ? durationFloorBlockers({ canonical, renderManifest, platformManifest })
    : [];
  const publicCopyQa = evaluateGoalPublicCopy({
    ...canonical,
    platform_publish_manifest: platformManifest,
  });
  const publicCopyBlockers = asArray(publicCopyQa.failures);
  const blockers = [
    ...missingInputs.map((item) => `missing_input:${item}`),
    ...(finalReady ? renderBlockers.filter((item) => item !== "render_not_final_publish_ready") : []),
    ...(finalReady ? qualityBlockers : []),
    ...(finalReady ? visualEvidenceBlockers : []),
    ...durationBlockers,
    ...publicCopyBlockers,
  ];

  const common = {
    story_id: storyId,
    title:
      cleanText(canonical.selected_title || canonical.short_title || canonical.canonical_title) ||
      storyId,
    artifact_dir: artifactDir || null,
    render_manifest: renderManifest,
    benchmark_summary: {
      result: benchmark.result || "unknown",
      scores: benchmark.scores || {},
      visual_quality_result: visualQuality.result || "unknown",
    },
    visual_evidence_profile: visualEvidence,
    owned_explainer_motion_ready: ownedExplainerReadyForStory,
    owned_explainer_exception_approved: ownedExplainerExceptionForStory,
    selected_render_evidence: selectedRenderEvidence,
    platform_publish_status: platformManifest.publish_status || null,
    publish_verdict: publishVerdict.verdict || null,
    rendered_duration_s: renderedDurationSeconds(renderManifest, platformManifest),
    public_copy_qa: publicCopyQa,
  };
  let schedulerCandidatePreview = null;
  let schedulerCandidateBenchmarkReport = null;
  const buildSchedulerCandidatePreview = async () => {
    if (schedulerCandidatePreview) return schedulerCandidatePreview;
    const [affiliateManifest, platformPolicyReport, landingPageManifest] = await Promise.all([
      readJsonIfPresent(path.join(artifactDir, "affiliate_link_manifest.json")),
      readJsonIfPresent(path.join(artifactDir, "platform_policy_report.json")),
      readJsonIfPresent(path.join(artifactDir, "landing_page_manifest.json")),
    ]);
    schedulerCandidatePreview = buildSchedulerBridgeCandidate({
      storyId,
      artifactDir,
      canonical,
      renderManifest,
      renderStory,
      benchmark,
      visualQuality,
      platformManifest,
      publishVerdict,
      director,
      audioManifest,
      footageInventory,
      rightsLedger,
      sfxManifest,
      affiliateManifest,
      platformPolicyReport,
      landingPageManifest,
      ownedExplainerMotionReady: ownedExplainerReadyForStory,
      ownedExplainerExceptionApproved: ownedExplainerExceptionForStory,
      humanReviewedOwnedExplainerException: Boolean(
        canonical.human_reviewed_owned_explainer_motion_exception === true ||
          renderManifest.human_reviewed_owned_explainer_motion_exception === true ||
          storyPackage.human_reviewed_owned_explainer_motion_exception === true,
      ),
      generatedAt: options.generatedAt || new Date().toISOString(),
    });
    return schedulerCandidatePreview;
  };

  if (!finalReady && publicCopyBlockers.length) {
    return {
      ...common,
      status: "blocked",
      blockers: [...new Set(publicCopyBlockers)],
      required_inputs: REQUIRED_INPUTS,
      dry_run_publish_eligible: false,
    };
  }

  if (!finalReady && !missingInputs.length) {
    const renderInputs = await inspectFinalRenderInputs({
      artifactDir,
      audioManifest,
      footageInventory,
      director,
      canonical,
      rightsLedger,
    });
    return {
      ...common,
      status: "needs_final_render",
      blockers: ["render_not_final_publish_ready"],
      render_input_status: renderInputs.status,
      render_input_blockers: renderInputs.blockers,
      render_input_required_inputs: renderInputs.required_inputs,
      render_input_requirements: renderInputs.requirements,
      render_input_evidence: renderInputs.evidence,
      required_inputs: REQUIRED_INPUTS,
      target_render_manifest: productionRenderTarget(storyId, artifactDir),
      dry_run_publish_eligible: false,
    };
  }

  let finalReadyRenderInputs = null;
  const finalRenderInputFreshnessBlockers = [];
  if (finalReady && !missingInputs.length) {
    finalReadyRenderInputs = await inspectFinalRenderInputs({
      artifactDir,
      audioManifest,
      footageInventory,
      director,
      canonical,
      rightsLedger,
    });
    finalRenderInputFreshnessBlockers.push(
      ...asArray(finalReadyRenderInputs.blockers).filter((blocker) =>
        /^(?:(?:materialised_motion|final_narration_audio|word_timestamps)_stale_after_|word_timestamps_not_asr_aligned|word_timestamps_semantic_misrecognition|word_timestamps_asr_coverage_incomplete)/i.test(
          cleanText(blocker),
        ),
      ),
    );
    const renderedAt = timeMs(renderManifest.generated_at);
    const motionMtimes = Object.values(finalReadyRenderInputs.evidence?.materialised_motion_clip_mtimes || {})
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
    if (renderedAt != null && motionMtimes.some((mtime) => mtime > renderedAt + 1000)) {
      finalRenderInputFreshnessBlockers.push("materialised_motion_newer_than_render");
    }
    finalRenderInputFreshnessBlockers.push(
      ...finalRenderInputFingerprintBlockers(renderManifest, finalReadyRenderInputs.evidence || {}),
    );
  }

  const staleRenderBlockers = unique([
    ...staleFinalRenderBlockers({ canonical, sfxManifest }, renderManifest),
    ...renderStoryTranscriptBlockers(canonical, renderStory),
    ...finalRenderInputFreshnessBlockers,
  ]);
  if (finalReady && !missingInputs.length && staleRenderBlockers.length && !blockers.length) {
    const renderInputs = renderInputsWithSelectedRenderMotionEvidence(
      finalReadyRenderInputs || await inspectFinalRenderInputs({
        artifactDir,
        audioManifest,
        footageInventory,
        director,
        canonical,
        rightsLedger,
      }),
      { selectedRenderEvidence },
    );
    return {
      ...common,
      status: "needs_final_render",
      blockers: unique([...staleRenderBlockers, ...durationBlockers]),
      force_final_render: true,
      render_input_status: renderInputs.status,
      render_input_blockers: renderInputs.blockers,
      render_input_required_inputs: renderInputs.required_inputs,
      render_input_requirements: renderInputs.requirements,
      render_input_evidence: renderInputs.evidence,
      required_inputs: REQUIRED_INPUTS,
      target_render_manifest: productionRenderTarget(storyId, artifactDir),
      dry_run_publish_eligible: false,
    };
  }

  if (finalReady && !missingInputs.length && durationBlockers.length) {
    const renderInputs = renderInputsWithSelectedRenderMotionEvidence(
      finalReadyRenderInputs || await inspectFinalRenderInputs({
        artifactDir,
        audioManifest,
        footageInventory,
        director,
        canonical,
        rightsLedger,
      }),
      { selectedRenderEvidence },
    );
    return {
      ...common,
      status: "needs_final_render",
      blockers: durationBlockers,
      force_final_render: true,
      render_input_status: renderInputs.status,
      render_input_blockers: renderInputs.blockers,
      render_input_required_inputs: renderInputs.required_inputs,
      render_input_requirements: renderInputs.requirements,
      render_input_evidence: renderInputs.evidence,
      required_inputs: REQUIRED_INPUTS,
      target_render_manifest: productionRenderTarget(storyId, artifactDir),
      dry_run_publish_eligible: false,
    };
  }

  if (
    finalReady &&
    !missingInputs.length &&
    (directVideoMotionMissing || selectedRenderDirectVideoMotionMissing) &&
    !visualEvidenceBlockers.length
  ) {
    const renderInputs = renderInputsWithSelectedRenderMotionEvidence(
      finalReadyRenderInputs || await inspectFinalRenderInputs({
        artifactDir,
        audioManifest,
        footageInventory,
        director,
        canonical,
        rightsLedger,
      }),
      { selectedRenderEvidence },
    );
    return {
      ...common,
      status: "needs_final_render",
      blockers: unique([DIRECT_VIDEO_MOTION_BLOCKER, ...selectedRenderRefreshBlockers]),
      force_final_render: true,
      render_input_status: renderInputs.status,
      render_input_blockers: renderInputs.blockers,
      render_input_required_inputs: renderInputs.required_inputs,
      render_input_requirements: renderInputs.requirements,
      render_input_evidence: renderInputs.evidence,
      required_inputs: REQUIRED_INPUTS,
      target_render_manifest: productionRenderTarget(storyId, artifactDir),
      dry_run_publish_eligible: false,
    };
  }

  if (
    finalReady &&
    !missingInputs.length &&
    selectedRenderRefreshBlockers.length &&
    !visualEvidenceBlockers.length
  ) {
    const renderInputs = renderInputsWithSelectedRenderMotionEvidence(
      finalReadyRenderInputs || await inspectFinalRenderInputs({
        artifactDir,
        audioManifest,
        footageInventory,
        director,
        canonical,
        rightsLedger,
      }),
      { selectedRenderEvidence },
    );
    return {
      ...common,
      status: "needs_final_render",
      blockers: selectedRenderRefreshBlockers,
      force_final_render: true,
      render_input_status: renderInputs.status,
      render_input_blockers: renderInputs.blockers,
      render_input_required_inputs: renderInputs.required_inputs,
      render_input_requirements: renderInputs.requirements,
      render_input_evidence: renderInputs.evidence,
      required_inputs: REQUIRED_INPUTS,
      target_render_manifest: productionRenderTarget(storyId, artifactDir),
      dry_run_publish_eligible: false,
    };
  }

  if (finalReady && !missingInputs.length && !blockers.length) {
    const candidatePreview = await buildSchedulerCandidatePreview();
    const candidateBenchmark = schedulerCandidateBenchmarkBlockers(
      candidatePreview,
      options.thresholds || DEFAULT_THRESHOLDS,
    );
    schedulerCandidateBenchmarkReport = candidateBenchmark.benchmark;
    common.scheduler_candidate_benchmark_report = schedulerCandidateBenchmarkReport;
    blockers.push(...candidateBenchmark.blockers);
  }

  if (blockers.length) {
    return {
      ...common,
      status: "blocked",
      blockers: [...new Set(blockers)],
      required_inputs: REQUIRED_INPUTS,
      dry_run_publish_eligible: false,
    };
  }

  await refreshSchedulerCaptionSrt({
    artifactDir,
    canonical,
    audioManifest,
    renderManifest,
    storyId,
    generatedAt: options.generatedAt || new Date().toISOString(),
  });

  const schedulerCandidate = schedulerCandidatePreview || await buildSchedulerCandidatePreview();
  await persistGovernanceRefreshArtifacts({
    artifactDir,
    candidate: schedulerCandidate,
    generatedAt: options.generatedAt || new Date().toISOString(),
  });

  return {
    ...common,
    status: "ready_for_dry_run_publish",
    blockers: [],
    required_inputs: REQUIRED_INPUTS,
    dry_run_publish_eligible: true,
    platform_publish_status: schedulerCandidate.platform_publish_manifest?.publish_status || common.platform_publish_status,
    publish_verdict: schedulerCandidate.publish_verdict?.verdict || common.publish_verdict,
    scheduler_candidate: schedulerCandidate,
  };
}

async function buildProductionRenderCutoverPlan({
  storyPackages = [],
  generatedAt = new Date().toISOString(),
  thresholds = DEFAULT_THRESHOLDS,
} = {}) {
  const inspected = [];
  for (const storyPackage of asArray(storyPackages)) {
    inspected.push(await inspectStoryPackage(storyPackage, { thresholds, generatedAt }));
  }
  const ready = inspected.filter((item) => item.status === "ready_for_dry_run_publish");
  const queue = inspected.filter((item) => item.status === "needs_final_render");
  const blocked = inspected.filter((item) => item.status === "blocked");
  const finalRenderInputReady = queue.filter(
    (item) => item.render_input_status === "ready_for_final_render_job",
  );
  const finalRenderInputBlocked = queue.filter((item) => item.render_input_status === "blocked");
  const normalDurationRepairJobs = queue
    .map((item) => normalDurationRepairJob(item, { generatedAt }))
    .filter(Boolean);
  const schedulerBridge = buildSchedulerBridge(inspected, { generatedAt });
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "PRODUCTION_RENDER_CUTOVER",
    thresholds,
    summary: {
      story_count: inspected.length,
      ready_final_render_count: ready.length,
      queued_final_render_count: queue.length,
      final_render_input_ready_count: finalRenderInputReady.length,
      final_render_input_blocked_count: finalRenderInputBlocked.length,
      blocked_count: blocked.length,
      dry_run_publish_eligible_count: ready.filter((item) => item.dry_run_publish_eligible).length,
      scheduler_bridge_candidate_count: schedulerBridge.candidate_count,
      normal_duration_repair_ready_count: normalDurationRepairJobs.length,
    },
    ready,
    queue,
    blocked,
    normal_duration_rerender_work_order: {
      schema_version: 1,
      generated_at: generatedAt,
      mode: "NORMAL_PRODUCTION_DURATION_RERENDER_WORK_ORDER",
      jobs: normalDurationRepairJobs,
      safety: {
        no_publish_triggered: true,
        no_network_uploads: true,
        no_db_mutation: true,
        no_oauth_or_token_change: true,
        no_gate_weakened: true,
      },
    },
    scheduler_bridge: schedulerBridge,
    validation_report: inspected.map((item) => ({
      story_id: item.story_id,
      status: item.status,
      blockers: item.blockers,
      renderer: item.render_manifest?.renderer || null,
      visual_tier: item.render_manifest?.visual_tier || null,
      final_publish_render: item.render_manifest?.final_publish_render === true,
      benchmark_scores: item.benchmark_summary?.scores || {},
      rendered_duration_s: item.rendered_duration_s ?? null,
      public_copy_qa: item.public_copy_qa || null,
      render_input_status: item.render_input_status || null,
      render_input_blockers: item.render_input_blockers || [],
      render_input_evidence: item.render_input_evidence || {},
    })),
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_local_proof_promoted_to_final: true,
    },
  };
}

async function writeProductionRenderCutoverPlan(plan = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeProductionRenderCutoverPlan requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const planPath = path.join(outDir, "production_render_cutover_plan.json");
  const queuePath = path.join(outDir, "production_render_queue.json");
  const validationPath = path.join(outDir, "production_render_validation_report.json");
  const schedulerBridgePath = path.join(outDir, "scheduler_bridge_manifest.json");
  const schedulerBridgeCandidatesPath = path.join(outDir, "scheduler_bridge_candidates.json");
  const normalDurationWorkOrderPath = path.join(outDir, "normal_duration_rerender_work_order.json");
  await fs.writeJson(planPath, plan, { spaces: 2 });
  await fs.writeJson(queuePath, plan.queue || [], { spaces: 2 });
  await fs.writeJson(validationPath, plan.validation_report || [], { spaces: 2 });
  await fs.writeJson(schedulerBridgePath, plan.scheduler_bridge || {}, { spaces: 2 });
  await fs.writeJson(schedulerBridgeCandidatesPath, plan.scheduler_bridge?.candidates || [], { spaces: 2 });
  await fs.writeJson(normalDurationWorkOrderPath, plan.normal_duration_rerender_work_order || { jobs: [] }, { spaces: 2 });
  return {
    outputDir: outDir,
    planPath,
    queuePath,
    validationPath,
    schedulerBridgePath,
    schedulerBridgeCandidatesPath,
    normalDurationWorkOrderPath,
  };
}

module.exports = {
  DEFAULT_THRESHOLDS,
  FINAL_RENDER_INPUTS,
  REQUIRED_INPUTS,
  buildProductionRenderCutoverPlan,
  writeProductionRenderCutoverPlan,
};
