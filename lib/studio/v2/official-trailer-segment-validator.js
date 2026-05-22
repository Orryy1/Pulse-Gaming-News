"use strict";

const path = require("node:path");
const { execFile } = require("node:child_process");
const fs = require("fs-extra");

const {
  inspectExtractedFrame,
  officialTrailerFrameRejectReason,
} = require("../../controlled-frame-extraction-worker");
const {
  classifyTrailerFrameTaste,
  isLetterboxedCinematicCandidate,
} = require("../../visual-content-prescan");
const {
  officialMediaReferenceRejectReason,
} = require("../../official-media-reference-preflight");
const {
  mediaSourceUrlKindFields,
} = require("../../media-source-url-kind");
const { buildStillFrameExtractionArgs } = require("../../ffmpeg-still-frame");

const ROOT = path.resolve(__dirname, "../../..");
const TEST_OUTPUT_ROOT = path.join(ROOT, "test", "output");
const DEFAULT_OUTPUT_ROOT = path.join(TEST_OUTPUT_ROOT, "official-trailer-segment-validation-v1", "assets");
const DEFAULT_SAMPLE_OFFSETS_S = [0.65, 2.35, 4.15];
const DEFAULT_MAX_SEGMENTS = 6;
const DEFAULT_EXHAUSTED_SOURCE_FAMILY_THRESHOLD = 8;
const MIN_PASSING_SAMPLES = 2;
const MIN_GAMEPLAY_ACTION_SAMPLES = 2;
const MIN_SEGMENT_ACTION_SCORE = 70;
const MIN_OFFICIAL_SEGMENT_START_S = 36;
const SHORT_OFFICIAL_SEGMENT_GRACE_S = 8;
const TRIMMED_SEGMENT_RENDER_HEAD_INSET_S = 0.25;
const TRIMMED_SEGMENT_RENDER_TAIL_INSET_S = 0.35;
const VALIDATOR_RULESET_VERSION = 4;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeName(value, fallback = "item") {
  const out = String(value || fallback)
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 90);
  return out || fallback;
}

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
}

function isUnder(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function assertLocalOutputRoot(outputRoot) {
  if (!isUnder(TEST_OUTPUT_ROOT, outputRoot)) {
    throw new Error("apply-local segment validation output must stay under test/output");
  }
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sourceDurationSeconds(record = {}) {
  const provenance = record.provenance || {};
  for (const value of [
    record.sourceDurationS,
    record.source_duration_s,
    record.durationSeconds,
    record.duration_seconds,
    record.referenceDurationS,
    record.reference_duration_s,
    provenance.sourceDurationS,
    provenance.source_duration_s,
    provenance.durationSeconds,
    provenance.duration_seconds,
  ]) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function minimumSegmentStartForSource(record = {}) {
  const duration = sourceDurationSeconds(record);
  if (!Number.isFinite(duration)) return MIN_OFFICIAL_SEGMENT_START_S;
  if (duration > MIN_OFFICIAL_SEGMENT_START_S + SHORT_OFFICIAL_SEGMENT_GRACE_S) {
    return MIN_OFFICIAL_SEGMENT_START_S;
  }
  return Number(Math.max(4, duration * 0.28).toFixed(2));
}

function renderSafeTrimTiming({ start, duration, trimmed }) {
  const mediaStartS = Number(start);
  const durationS = Number(duration);
  if (!Number.isFinite(mediaStartS) || !Number.isFinite(durationS) || durationS <= 0) {
    return { mediaStartS, durationS };
  }
  if (trimmed !== true) return { mediaStartS, durationS };
  const headInset = Math.min(TRIMMED_SEGMENT_RENDER_HEAD_INSET_S, Math.max(0, durationS - 1));
  const tailInset = Math.min(
    TRIMMED_SEGMENT_RENDER_TAIL_INSET_S,
    Math.max(0, durationS - headInset - 1),
  );
  return {
    mediaStartS: Number((mediaStartS + headInset).toFixed(2)),
    durationS: Number(Math.max(1, durationS - headInset - tailInset).toFixed(2)),
    headInsetS: Number(headInset.toFixed(2)),
    tailInsetS: Number(tailInset.toFixed(2)),
  };
}

function segmentKeyForClipRef(clip) {
  const sourceUrl = String(clip?.path || clip?.source_url || clip?.sourceUrl || "").trim();
  const entity = safeName(clip?.entity || clip?.provenance?.entity || "subject").toLowerCase();
  const start = numberOr(clip?.mediaStartS ?? clip?.media_start_s, 0).toFixed(2);
  return `${sourceUrl}|${entity}|${start}`;
}

function segmentStoryId(segment) {
  return normaliseFamilyValue(
    segment?.story_id ||
      segment?.storyId ||
      segment?.provenance?.story_id ||
      segment?.provenance?.storyId,
  );
}

function storyIdsFromClipRefs(clipRefs = []) {
  return new Set(asArray(clipRefs).map(segmentStoryId).filter(Boolean));
}

function filterSegmentsForStoryIds(segments = [], storyIds = []) {
  const storyIdList = storyIds instanceof Set ? [...storyIds] : asArray(storyIds);
  const wanted = new Set(storyIdList.map(normaliseFamilyValue).filter(Boolean));
  if (!wanted.size) return asArray(segments);
  return asArray(segments).filter((segment) => {
    const storyId = segmentStoryId(segment);
    return storyId && wanted.has(storyId);
  });
}

function normaliseFamilyValue(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function clipSourceUrl(clip = {}) {
  return String(clip?.path || clip?.source_url || clip?.sourceUrl || clip?.clip_url || "").trim();
}

function parseSteamTrailerUrl(sourceUrl) {
  const text = String(sourceUrl || "");
  const match = text.match(/store_trailers\/(\d+)\/(\d+)\//i);
  if (!match) return null;
  return {
    provider: "steam",
    store_app_id: match[1],
    movie_id: match[2],
    reference_title: `Steam movie ${match[2]}`,
  };
}

function clipSourceFamily(clip = {}) {
  const provenance = clip.provenance || {};
  const sourceUrl = clipSourceUrl(clip);
  const parsedSteam = parseSteamTrailerUrl(sourceUrl);
  const sourceAlias = String(clip.source || "").includes("official-trailer") ? "" : clip.source;
  const provider = normaliseFamilyValue(
    clip.provider || provenance.provider || parsedSteam?.provider || clip.source_type || clip.sourceType || sourceAlias,
  );
  const storeAppId = normaliseFamilyValue(
    clip.store_app_id ||
      clip.storeAppId ||
      provenance.store_app_id ||
      provenance.storeAppId ||
      parsedSteam?.store_app_id,
  );
  const movieId = normaliseFamilyValue(
    clip.movie_id ||
      clip.movieId ||
      clip.video_id ||
      provenance.movie_id ||
      provenance.movieId ||
      parsedSteam?.movie_id,
  );
  const sourceKey = normaliseFamilyValue(sourceUrl.replace(/[?#].*$/, ""));
  const entity = normaliseFamilyValue(clip.entity || provenance.entity);
  const storyId = normaliseFamilyValue(clip.story_id || clip.storyId || provenance.story_id);
  const key = [
    storyId || "unknown_story",
    entity || "unknown_entity",
    provider || "unknown_provider",
    storeAppId || "unknown_app",
    movieId || sourceKey || "unknown_source",
  ].join("|");
  return {
    key,
    story_id: storyId || null,
    entity: entity || null,
    provider: provider || null,
    store_app_id: storeAppId || null,
    store_app_title:
      clip.store_app_title || clip.storeAppTitle || provenance.store_app_title || provenance.storeAppTitle || null,
    movie_id: movieId || null,
    reference_title:
      clip.reference_title ||
      clip.movie_name ||
      clip.movieName ||
      clip.name ||
      clip.title ||
      provenance.reference_title ||
      provenance.movie_name ||
      provenance.movieName ||
      provenance.name ||
      provenance.title ||
      parsedSteam?.reference_title ||
      null,
    source_url: sourceUrl || null,
  };
}

function outputPathForSample({ outputRoot, clip, segmentIndex, sampleIndex, seekSeconds }) {
  const story = safeName(clip?.storyId || clip?.story_id || clip?.provenance?.story_id || "story");
  const entity = safeName(clip?.entity || clip?.provenance?.entity || "subject");
  const seconds = String(Math.round(seekSeconds * 100)).padStart(5, "0");
  return path.join(
    outputRoot,
    story,
    `${String(segmentIndex + 1).padStart(3, "0")}_${entity}_${String(sampleIndex + 1).padStart(2, "0")}_${seconds}cs.jpg`,
  );
}

function buildSamplePlan(clip, opts = {}) {
  const durationS = Math.max(1, numberOr(clip?.durationS ?? clip?.duration_s, 5));
  const mediaStartS = Math.max(0, numberOr(clip?.mediaStartS ?? clip?.media_start_s, 0));
  const requested = asArray(opts.sampleOffsetsS).length ? asArray(opts.sampleOffsetsS) : DEFAULT_SAMPLE_OFFSETS_S;
  return requested
    .map((offset) => numberOr(offset, 0))
    .filter((offset) => offset >= 0 && offset <= durationS)
    .map((offset) => ({
      offset_s: Number(offset.toFixed(2)),
      seek_seconds: Number((mediaStartS + offset).toFixed(2)),
    }));
}

function isOfficialTrailerClip(clip) {
  return (
    String(clip?.source || "").includes("official-trailer") ||
    /(steam_movie|steam_storefront_video_reference|igdb_video|official_trailer|publisher_video|platform_video)/i.test(
      String(clip?.sourceType || clip?.source_type || ""),
    )
  );
}

function officialTrailerSegmentPreflightRejectReason(clip) {
  if (!isOfficialTrailerClip(clip)) return null;
  const sourceUrl = clipSourceUrl(clip);
  const urlKind = mediaSourceUrlKindFields(sourceUrl);
  if (clip.segment_validation_eligible === false || clip?.provenance?.segment_validation_eligible === false) {
    return (
      clip.segment_validation_ineligible_reason ||
      clip?.provenance?.segment_validation_ineligible_reason ||
      urlKind.segment_validation_ineligible_reason ||
      "segment_source_url_not_direct_media"
    );
  }
  if (urlKind.segment_validation_eligible !== true) {
    return urlKind.segment_validation_ineligible_reason || "segment_source_url_not_direct_media";
  }
  const metadataRejectReason = officialMediaReferenceRejectReason(clip);
  if (metadataRejectReason === "rating_board_reference") {
    return "segment_source_is_rating_board_reference";
  }
  if (metadataRejectReason === "logo_or_title_only_reference") {
    return "segment_source_is_logo_or_title_only_reference";
  }
  if (metadataRejectReason === "localised_non_english_reference") {
    return "segment_source_is_localised_non_english_reference";
  }
  if (metadataRejectReason === "embedded_subtitle_reference") {
    return "segment_source_has_embedded_subtitle_reference";
  }
  const mediaStartS = numberOr(clip?.mediaStartS ?? clip?.media_start_s, 0);
  if (mediaStartS < minimumSegmentStartForSource(clip)) {
    return "segment_starts_in_trailer_intro_or_rating_window";
  }
  return null;
}

function clipSourceProvenance(clip) {
  return {
    provider: clip?.provider || clip?.provenance?.provider || null,
    source_family: clip?.sourceFamily || clip?.source_family || clip?.provenance?.source_family || null,
    reference_title:
      clip?.reference_title ||
      clip?.movie_name ||
      clip?.movieName ||
      clip?.name ||
      clip?.title ||
      clip?.provenance?.reference_title ||
      clip?.provenance?.movie_name ||
      clip?.provenance?.movieName ||
      clip?.provenance?.name ||
      clip?.provenance?.title ||
      null,
    movie_id: clip?.movie_id || clip?.movieId || clip?.provenance?.movie_id || clip?.provenance?.movieId || null,
    store_app_id: clip?.store_app_id || clip?.storeAppId || clip?.provenance?.store_app_id || null,
    store_app_title: clip?.store_app_title || clip?.storeAppTitle || clip?.provenance?.store_app_title || null,
  };
}

function defaultSegmentSampleExtractor({ sourceUrl, outputPath, seekSeconds, timeoutMs = 45000 }) {
  if (!sourceUrl) return Promise.reject(new Error("segment_source_missing"));
  return new Promise((resolve, reject) => {
    fs.ensureDirSync(path.dirname(outputPath));
    execFile(
      "ffmpeg",
      buildStillFrameExtractionArgs({ source: sourceUrl, outputPath, seekSeconds }),
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          err.stderr = stderr;
          reject(err);
          return;
        }
        resolve({ outputPath, stdout, stderr });
      },
    );
  });
}

function guardSegmentSample(clip, sample, qa = {}) {
  const guarded = {
    ...(qa || {}),
    warnings: Array.isArray(qa?.warnings) ? [...qa.warnings] : [],
    failures: Array.isArray(qa?.failures) ? [...qa.failures] : [],
  };
  const prescan = guarded.prescan || {};
  guarded.visual_taste =
    guarded.visual_taste ||
    classifyTrailerFrameTaste({
      ...prescan,
      detected_text: guarded.detected_text || prescan.detected_text,
      ocr_text: guarded.ocr_text || prescan.ocr_text,
      embedded_text: guarded.embedded_text || prescan.embedded_text,
    });
  if (
    guarded.failures.includes("unsafe_face_like_frame") &&
    prescan.likely_is_stock_person !== true
  ) {
    guarded.failures = guarded.failures.filter((failure) => failure !== "unsafe_face_like_frame");
    if (!guarded.warnings.includes("official_game_character_face_allowed")) {
      guarded.warnings.push("official_game_character_face_allowed");
    }
  }
  const frameLike = {
    source_type: clip?.sourceType || clip?.source_type || "steam_movie",
    target_time_seconds: sample.seek_seconds,
    source_duration_s: sourceDurationSeconds(clip),
    qa: guarded,
  };
  const reason = officialTrailerFrameRejectReason(frameLike, guarded);
  if (reason && !guarded.failures.includes(reason)) guarded.failures.push(reason);
  if (reason) {
    guarded.thumbnail_safe = false;
    guarded.verdict = "fail";
  } else {
    guarded.thumbnail_safe = guarded.failures.length === 0;
    guarded.verdict = guarded.failures.length ? "fail" : guarded.warnings.length ? "warn" : "pass";
  }
  const action = scoreGameplayActionSample(guarded);
  guarded.gameplay_action_score = action.score;
  guarded.gameplay_action_candidate = action.candidate;
  guarded.gameplay_action_reason = action.reason;
  return guarded;
}

function scoreGameplayActionSample(qa = {}) {
  const prescan = qa.prescan || {};
  const taste = qa.visual_taste || classifyTrailerFrameTaste(prescan);
  const edge = numberOr(prescan.edge_density, 0);
  const saturation = numberOr(prescan.saturation_mean, 0);
  const text = numberOr(prescan.text_overlay_likelihood, 0);
  const whiteText = numberOr(prescan.white_text_on_dark_likelihood, 0);
  const dark = numberOr(prescan.dark_pixel_ratio, 0);
  const bright = numberOr(prescan.bright_pixel_ratio, 0);
  const letterboxedCinematic = isLetterboxedCinematicCandidate(prescan);
  let score = 35;
  score += Math.min(edge, 0.38) * 115;
  score += Math.min(saturation, 0.65) * 45;
  score -= Math.min(text, 0.6) * 85;
  score -= Math.min(whiteText, 1) * (letterboxedCinematic ? 10 : 70);
  if (letterboxedCinematic) score += 24;
  if (dark >= 0.82) score -= (dark - 0.82) * 120;
  if (bright >= 0.58) score -= (bright - 0.58) * 90;
  if (taste?.verdict === "fail") score -= 45;
  const rounded = Number(Math.max(0, Math.min(100, score)).toFixed(1));
  const standardDetailFloor = 0.16;
  const standardCandidate =
    edge >= standardDetailFloor &&
    saturation >= 0.28 &&
    text <= 0.26 &&
    whiteText <= 0.2 &&
    rounded >= 68;
  const cinematicCandidate =
    letterboxedCinematic &&
    edge >= 0.065 &&
    saturation >= 0.45 &&
    text <= 0.12 &&
    rounded >= 68;
  const candidate =
    qa.verdict !== "fail" &&
    qa.thumbnail_safe !== false &&
    taste?.verdict !== "fail" &&
    (standardCandidate || cinematicCandidate);
  let reason = "gameplay_action_candidate";
  if (!candidate) {
    if (taste?.verdict === "fail") reason = `taste_${taste.reason || "failed"}`;
    else if (text > 0.26) reason = "text_heavy_context_frame";
    else if (edge < (letterboxedCinematic ? 0.065 : standardDetailFloor)) {
      reason = "not_enough_visual_detail";
    }
    else if (saturation < 0.28) reason = "not_enough_colour_energy";
    else if (whiteText > 0.2 && !letterboxedCinematic) reason = "white_text_context_frame";
    else reason = "action_score_below_threshold";
  }
  return {
    score: rounded,
    candidate,
    reason,
  };
}

function segmentSampleOrder(sample, fallbackIndex) {
  const order = Number(sample?.order);
  return Number.isFinite(order) ? order : fallbackIndex + 1;
}

function averageGameplayScore(samples) {
  if (!samples.length) return 0;
  return Number(
    (
      samples.reduce((sum, sample) => sum + numberOr(sample.qa?.gameplay_action_score, 0), 0) /
      samples.length
    ).toFixed(1),
  );
}

function isShortLicensedDirectMediaClip(clip = {}) {
  const sourceType = String(clip?.sourceType || clip?.source_type || "").toLowerCase();
  const sourceUrl = clipSourceUrl(clip);
  const urlKind = mediaSourceUrlKindFields(sourceUrl);
  const duration = sourceDurationSeconds(clip);
  return (
    sourceType.includes("licensed_direct_media_url") &&
    urlKind.source_url_kind === "direct_video" &&
    Number.isFinite(duration) &&
    duration <= 20
  );
}

function blockedDirectMediaMotionSourceText(clip = {}) {
  const sourceText = [
    clipSourceUrl(clip),
    clip?.source_family,
    clip?.sourceFamily,
    clip?.reference_title,
    clip?.movie_name,
    clip?.movieName,
    clip?.title,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /(?:keyart|key[-_\s]?art|\bwallpaper\b|\bposter\b|\bpack\b|pre[-_\s]?order|\bbonus\b|\bvoucher\b|\baccessibility\b|\bcolourblind\b|\bcolorblind\b|high[-_\s]?contrast)/.test(
    sourceText,
  );
}

function shortDirectMediaMotionCandidate({
  clip,
  passing,
  actionSamples,
  actionScore,
} = {}) {
  if (blockedDirectMediaMotionSourceText(clip)) return false;
  if (!isShortLicensedDirectMediaClip(clip)) return false;
  if (!Array.isArray(passing) || passing.length < MIN_PASSING_SAMPLES) return false;
  if (!Array.isArray(actionSamples) || actionSamples.length < 1) return false;
  if (actionScore < MIN_SEGMENT_ACTION_SCORE) return false;
  const floorPassed = passing.every((sample) => numberOr(sample.qa?.gameplay_action_score, 0) >= 58);
  return floorPassed;
}

function shortDirectMediaDetailMotionCandidate({ clip, passing, actionScore } = {}) {
  if (blockedDirectMediaMotionSourceText(clip)) return false;
  const sourceType = String(clip?.sourceType || clip?.source_type || "").toLowerCase();
  const sourceUrl = clipSourceUrl(clip);
  const duration = sourceDurationSeconds(clip);
  if (!sourceType.includes("licensed_direct_media_url")) return false;
  if (mediaSourceUrlKindFields(sourceUrl).source_url_kind !== "direct_video") return false;
  if (!Number.isFinite(duration) || duration > 30) return false;
  if (!Array.isArray(passing) || passing.length < 3) return false;
  if (uniqueContentHashCount(passing) < Math.min(MIN_PASSING_SAMPLES, passing.length)) return false;
  if (actionScore < 68) return false;
  return passing.every((sample) => {
    const score = numberOr(sample.qa?.gameplay_action_score, 0);
    const text = numberOr(sample.qa?.prescan?.text_overlay_likelihood, 0);
    const whiteText = numberOr(sample.qa?.prescan?.white_text_on_dark_likelihood, 0);
    return score >= 58 && text <= 0.16 && whiteText <= 0.2;
  });
}

function brandedDirectMediaMotionCandidate({
  clip,
  passing,
  actionSamples,
  actionScore,
} = {}) {
  const sourceType = String(clip?.sourceType || clip?.source_type || "").toLowerCase();
  const sourceUrl = clipSourceUrl(clip);
  const sourceText = [
    sourceUrl,
    clip?.source_family,
    clip?.sourceFamily,
    clip?.reference_title,
    clip?.movie_name,
    clip?.movieName,
    clip?.title,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!sourceType.includes("licensed_direct_media_url")) return false;
  if (mediaSourceUrlKindFields(sourceUrl).source_url_kind !== "direct_video") return false;
  if (blockedDirectMediaMotionSourceText({ ...clip, sourceUrl, path: sourceUrl, title: sourceText })) return false;
  if (!Array.isArray(passing) || passing.length < 3) return false;
  if (!Array.isArray(actionSamples) || actionSamples.length < 1) return false;
  if (uniqueContentHashCount(passing) < Math.min(MIN_PASSING_SAMPLES, passing.length)) return false;
  if (actionScore < MIN_SEGMENT_ACTION_SCORE) return false;
  const cleanMotionFloor = passing.every((sample) => {
    const score = numberOr(sample.qa?.gameplay_action_score, 0);
    const text = numberOr(sample.qa?.prescan?.text_overlay_likelihood, 0);
    const whiteText = numberOr(sample.qa?.prescan?.white_text_on_dark_likelihood, 0);
    return score >= 58 && text <= 0.18 && whiteText <= 0.2;
  });
  if (!cleanMotionFloor) return false;
  return actionSamples.some((sample) => {
    const tags = asArray(sample.qa?.visual_taste?.tags);
    return tags.includes("gameplay_candidate") || numberOr(sample.qa?.gameplay_action_score, 0) >= 80;
  });
}

function officialDirectMediaCleanMotionCandidate({ clip, passing, actionScore } = {}) {
  const sourceType = String(clip?.sourceType || clip?.source_type || "").toLowerCase();
  const sourceUrl = clipSourceUrl(clip);
  const urlKind = mediaSourceUrlKindFields(sourceUrl);
  const directOfficialSource =
    /(?:platform_storefront_video_reference|official_game_website_media_page|official_publisher|official_studio|official_source)/.test(
      sourceType,
    );
  if (!directOfficialSource) return false;
  if (!["direct_video", "hls_manifest", "dash_manifest"].includes(urlKind.source_url_kind)) return false;
  if (blockedDirectMediaMotionSourceText(clip)) return false;
  if (!Array.isArray(passing) || passing.length < MIN_PASSING_SAMPLES) return false;
  if (uniqueContentHashCount(passing) < Math.min(MIN_PASSING_SAMPLES, passing.length)) return false;
  if (actionScore < 75) return false;
  return passing.every((sample) => {
    if (sample.qa?.thumbnail_safe === false) return false;
    if (asArray(sample.qa?.failures).length) return false;
    if (sample.qa?.visual_taste?.verdict === "fail") return false;
    const score = numberOr(sample.qa?.gameplay_action_score, 0);
    const text = numberOr(sample.qa?.prescan?.text_overlay_likelihood, 0);
    const whiteText = numberOr(sample.qa?.prescan?.white_text_on_dark_likelihood, 0);
    return score >= 68 && text <= 0.12 && whiteText <= 0.25;
  });
}

function sampleRejectionReasons(samples) {
  return [
    ...new Set(
      asArray(samples).flatMap((sample) =>
        asArray(sample.qa?.failures).concat(
          sample.status === "extract_failed" ? ["extract_failed"] : [],
        ),
      ),
    ),
  ];
}

function uniqueContentHashCount(samples) {
  return new Set(
    samples.map((sample) => sample.qa?.content_hash).filter((hash) => typeof hash === "string" && hash),
  ).size;
}

function trimCandidateFromSamples(samples) {
  const ordered = samples
    .map((sample, index) => ({
      sample,
      index,
      order: segmentSampleOrder(sample, index),
    }))
    .sort((a, b) => a.order - b.order);
  const runs = [];
  let current = [];

  for (const item of ordered) {
    const sample = item.sample;
    const isCleanAction =
      sample.status === "accepted" &&
      sample.qa?.gameplay_action_candidate === true &&
      sample.qa?.thumbnail_safe !== false &&
      !asArray(sample.qa?.failures).length;

    if (isCleanAction) {
      current.push(item);
      continue;
    }
    if (current.length) runs.push(current);
    current = [];
  }
  if (current.length) runs.push(current);

  const candidates = runs
    .filter((run) => run.length >= MIN_GAMEPLAY_ACTION_SAMPLES)
    .map((run) => {
      const runSamples = run.map((item) => item.sample);
      const uniqueHashes = uniqueContentHashCount(runSamples);
      const actionScore = averageGameplayScore(runSamples);
      return {
        run,
        runSamples,
        uniqueHashes,
        actionScore,
      };
    })
    .filter((candidate) => {
      const requiredHashes = Math.min(MIN_PASSING_SAMPLES, candidate.runSamples.length);
      return candidate.uniqueHashes >= requiredHashes && candidate.actionScore >= MIN_SEGMENT_ACTION_SCORE;
    })
    .sort((a, b) => {
      if (b.runSamples.length !== a.runSamples.length) return b.runSamples.length - a.runSamples.length;
      return b.actionScore - a.actionScore;
    });

  const best = candidates[0];
  if (!best) return null;
  if (best.runSamples.length === ordered.length) return null;

  const first = best.runSamples[0];
  const last = best.runSamples[best.runSamples.length - 1];
  const firstSeek = numberOr(first?.seek_seconds, null);
  const firstOffset = numberOr(first?.offset_s, 0);
  const lastSeek = numberOr(last?.seek_seconds, null);
  if (!Number.isFinite(firstSeek) || !Number.isFinite(lastSeek)) return null;

  const originalStart = Math.max(0, Number((firstSeek - firstOffset).toFixed(2)));
  const originalDuration = Math.max(1, numberOr(samples?.[0]?.duration_s, 5));
  const originalEnd = originalStart + originalDuration;
  const recommendedStart = Number(Math.max(originalStart, firstSeek - 0.2).toFixed(2));
  const recommendedEnd = Number(Math.min(originalEnd, lastSeek + 1.05).toFixed(2));
  const recommendedDuration = Number(Math.max(1, recommendedEnd - recommendedStart).toFixed(2));

  return {
    action_sample_count: best.runSamples.length,
    action_score: best.actionScore,
    recommended_media_start_s: recommendedStart,
    recommended_duration_s: recommendedDuration,
    trim_sample_orders: best.run.map((item) => item.order),
  };
}

function classifySegment(samples, clip = {}) {
  const finished = samples.filter((sample) => sample.status !== "would_sample");
  const failed = finished.filter((sample) => sample.status !== "accepted");
  const passing = finished.filter((sample) => sample.status === "accepted");
  const failureReasons = [
    ...new Set(
      failed.flatMap((sample) =>
        asArray(sample.qa?.failures).concat(sample.status === "extract_failed" ? ["extract_failed"] : []),
      ),
    ),
  ];
  const rejectionReasons = sampleRejectionReasons(finished);
  const uniqueHashes = new Set(
    passing.map((sample) => sample.qa?.content_hash).filter((hash) => typeof hash === "string" && hash),
  );
  const actionSamples = passing.filter((sample) => sample.qa?.gameplay_action_candidate === true);
  const weakFlashSamples = passing.filter((sample) => sample.qa?.gameplay_action_candidate !== true);
  const actionScore = passing.length > 0 ? averageGameplayScore(passing) : 0;
  const trimCandidate = trimCandidateFromSamples(finished);

  if (finished.length === 0) {
    return {
      status: "would_validate",
      segment_validated: false,
      allowed_for_flash_lane: false,
      reason: "dry_run_only",
      action_sample_count: 0,
      action_score: 0,
      segment_motion_class: "not_sampled",
      sample_rejection_reasons: rejectionReasons,
    };
  }
  if (failureReasons.includes("title_or_rating_card_frame")) {
    return {
      status: "rejected",
      segment_validated: false,
      allowed_for_flash_lane: false,
      reason: "segment_contains_title_or_rating_card",
      action_sample_count: actionSamples.length,
      action_score: actionScore,
      segment_motion_class: "rejected",
      sample_rejection_reasons: rejectionReasons,
    };
  }
  if (trimCandidate) {
    return {
      status: "validated",
      segment_validated: true,
      allowed_for_flash_lane: true,
      reason: "trimmed_segment_samples_passed",
      action_sample_count: trimCandidate.action_sample_count,
      action_score: trimCandidate.action_score,
      segment_motion_class: "gameplay_action",
      trim_recommended: true,
      recommended_media_start_s: trimCandidate.recommended_media_start_s,
      recommended_duration_s: trimCandidate.recommended_duration_s,
      trim_sample_orders: trimCandidate.trim_sample_orders,
      sample_rejection_reasons: rejectionReasons,
    };
  }
  if (failureReasons.includes("extract_failed")) {
    return {
      status: "rejected",
      segment_validated: false,
      allowed_for_flash_lane: false,
      reason: "segment_sample_extract_failed",
      action_sample_count: actionSamples.length,
      action_score: actionScore,
      segment_motion_class: "rejected",
      sample_rejection_reasons: rejectionReasons,
    };
  }
  if (failureReasons.includes("black_frame")) {
    return {
      status: "rejected",
      segment_validated: false,
      allowed_for_flash_lane: false,
      reason: "segment_contains_black_frame",
      action_sample_count: actionSamples.length,
      action_score: actionScore,
      segment_motion_class: "rejected",
      sample_rejection_reasons: rejectionReasons,
    };
  }
  if (failureReasons.includes("title_or_rating_card_frame")) {
    return {
      status: "rejected",
      segment_validated: false,
      allowed_for_flash_lane: false,
      reason: "segment_contains_title_or_rating_card",
      action_sample_count: actionSamples.length,
      action_score: actionScore,
      segment_motion_class: "rejected",
      sample_rejection_reasons: rejectionReasons,
    };
  }
  if (failureReasons.includes("low_detail_official_frame")) {
    return {
      status: "rejected",
      segment_validated: false,
      allowed_for_flash_lane: false,
      reason: "segment_contains_low_detail_frame",
      action_sample_count: actionSamples.length,
      action_score: actionScore,
      segment_motion_class: "rejected",
      sample_rejection_reasons: rejectionReasons,
    };
  }
  if (failureReasons.includes("poor_subject_framing_frame")) {
    return {
      status: "rejected",
      segment_validated: false,
      allowed_for_flash_lane: false,
      reason: "segment_contains_poor_subject_frame",
      action_sample_count: actionSamples.length,
      action_score: actionScore,
      segment_motion_class: "rejected",
      sample_rejection_reasons: rejectionReasons,
    };
  }
  if (failureReasons.includes("unsafe_face_like_frame")) {
    return {
      status: "rejected",
      segment_validated: false,
      allowed_for_flash_lane: false,
      reason: "segment_contains_unsafe_face_like_frame",
      action_sample_count: actionSamples.length,
      action_score: actionScore,
      segment_motion_class: "rejected",
      sample_rejection_reasons: rejectionReasons,
    };
  }
  if (passing.length < MIN_PASSING_SAMPLES) {
    return {
      status: "rejected",
      segment_validated: false,
      allowed_for_flash_lane: false,
      reason: "too_few_clean_segment_samples",
      action_sample_count: actionSamples.length,
      action_score: actionScore,
      segment_motion_class: "non_gameplay_context",
      sample_rejection_reasons: rejectionReasons,
    };
  }
  if (uniqueHashes.size > 0 && uniqueHashes.size < Math.min(MIN_PASSING_SAMPLES, passing.length)) {
    return {
      status: "rejected",
      segment_validated: false,
      allowed_for_flash_lane: false,
      reason: "segment_samples_too_repetitive",
      action_sample_count: actionSamples.length,
      action_score: actionScore,
      segment_motion_class: "non_gameplay_context",
      sample_rejection_reasons: rejectionReasons,
    };
  }
  if (
    shortDirectMediaMotionCandidate({
      clip,
      passing,
      actionSamples,
      actionScore,
    })
  ) {
    return {
      status: "validated",
      segment_validated: true,
      allowed_for_flash_lane: true,
      reason: "short_direct_media_motion_samples_passed",
      action_sample_count: actionSamples.length,
      action_score: actionScore,
      segment_motion_class: "gameplay_action",
      sample_rejection_reasons: rejectionReasons,
    };
  }
  if (
    shortDirectMediaDetailMotionCandidate({
      clip,
      passing,
      actionScore,
    })
  ) {
    return {
      status: "validated",
      segment_validated: true,
      allowed_for_flash_lane: true,
      reason: "short_direct_media_detail_motion_samples_passed",
      action_sample_count: actionSamples.length,
      action_score: actionScore,
      segment_motion_class: "gameplay_action",
      sample_rejection_reasons: rejectionReasons,
    };
  }
  if (
    brandedDirectMediaMotionCandidate({
      clip,
      passing,
      actionSamples,
      actionScore,
    })
  ) {
    return {
      status: "validated",
      segment_validated: true,
      allowed_for_flash_lane: true,
      reason: "branded_direct_media_motion_samples_passed",
      action_sample_count: actionSamples.length,
      action_score: actionScore,
      segment_motion_class: "gameplay_action",
      sample_rejection_reasons: rejectionReasons,
    };
  }
  if (
    officialDirectMediaCleanMotionCandidate({
      clip,
      passing,
      actionScore,
    })
  ) {
    return {
      status: "validated",
      segment_validated: true,
      allowed_for_flash_lane: true,
      reason: "official_direct_media_clean_motion_samples_passed",
      action_sample_count: actionSamples.length,
      action_score: actionScore,
      segment_motion_class: "gameplay_action",
      sample_rejection_reasons: rejectionReasons,
    };
  }
  if (actionSamples.length < MIN_GAMEPLAY_ACTION_SAMPLES) {
    return {
      status: "rejected",
      segment_validated: false,
      allowed_for_flash_lane: false,
      reason: "segment_lacks_gameplay_action_samples",
      action_sample_count: actionSamples.length,
      action_score: actionScore,
      segment_motion_class: "non_gameplay_context",
      sample_rejection_reasons: rejectionReasons,
    };
  }
  if (actionScore < MIN_SEGMENT_ACTION_SCORE) {
    return {
      status: "rejected",
      segment_validated: false,
      allowed_for_flash_lane: false,
      reason: "segment_action_score_below_flash_threshold",
      action_sample_count: actionSamples.length,
      action_score: actionScore,
      segment_motion_class: "non_gameplay_context",
      sample_rejection_reasons: rejectionReasons,
    };
  }
  if (weakFlashSamples.length > 0) {
    return {
      status: "rejected",
      segment_validated: false,
      allowed_for_flash_lane: false,
      reason: "segment_contains_weak_flash_sample",
      action_sample_count: actionSamples.length,
      action_score: actionScore,
      segment_motion_class: "non_gameplay_context",
      sample_rejection_reasons: rejectionReasons,
    };
  }
  return {
    status: "validated",
    segment_validated: true,
    allowed_for_flash_lane: true,
    reason: "segment_samples_passed",
    action_sample_count: actionSamples.length,
    action_score: actionScore,
    segment_motion_class: "gameplay_action",
    sample_rejection_reasons: rejectionReasons,
  };
}

async function processClipSegment(clip, index, options) {
  const applyLocal = options.applyLocal === true;
  const sourceUrl = String(clip?.path || clip?.source_url || clip?.sourceUrl || "").trim();
  const sourceUrlKind = mediaSourceUrlKindFields(sourceUrl);
  const outputRoot = path.resolve(options.outputRoot || DEFAULT_OUTPUT_ROOT);
  const preflightRejectReason = officialTrailerSegmentPreflightRejectReason(clip);
  if (preflightRejectReason) {
    return {
      order: index + 1,
      story_id: clip?.story_id || clip?.storyId || clip?.provenance?.story_id || null,
      clip_key: segmentKeyForClipRef(clip),
      source_url: sourceUrl,
      source_type: clip?.sourceType || clip?.source_type || "steam_movie",
      source_url_kind: sourceUrlKind.source_url_kind,
      segment_validation_eligible: false,
      segment_validation_ineligible_reason: preflightRejectReason,
      entity: clip?.entity || null,
      ...clipSourceProvenance(clip),
      media_start_s: numberOr(clip?.mediaStartS ?? clip?.media_start_s, 0),
      duration_s: Math.max(1, numberOr(clip?.durationS ?? clip?.duration_s, 5)),
      source_duration_s: sourceDurationSeconds(clip),
      status: "rejected",
      segment_validated: false,
      allowed_for_flash_lane: false,
      validation_reason: preflightRejectReason,
      segment_motion_class: "rejected",
      action_score: 0,
      action_sample_count: 0,
      samples: [],
    };
  }
  const samplePlan = buildSamplePlan(clip, options);
  const samples = [];

  for (const [sampleIndex, sample] of samplePlan.entries()) {
    const outputPath = outputPathForSample({
      outputRoot,
      clip,
      segmentIndex: index,
      sampleIndex,
      seekSeconds: sample.seek_seconds,
    });
    const base = {
      order: sampleIndex + 1,
      source_url: sourceUrl,
      entity: clip?.entity || null,
      offset_s: sample.offset_s,
      seek_seconds: sample.seek_seconds,
      local_path: applyLocal ? outputPath : null,
      planned_local_path: applyLocal ? null : outputPath,
    };

    if (!applyLocal) {
      samples.push({
        ...base,
        status: "would_sample",
        qa: null,
      });
      continue;
    }

    try {
      await options.extractor({
        sourceUrl,
        outputPath,
        seekSeconds: sample.seek_seconds,
        clip,
        sample,
      });
      const qa = await options.inspectFrame(outputPath, {
        frame: {
          source_url: sourceUrl,
          source_type: clip?.sourceType || clip?.source_type || "steam_movie",
          target_time_seconds: sample.seek_seconds,
        },
        sourceTypeHint: "trailer",
      });
      const guarded = guardSegmentSample(clip, sample, qa);
      samples.push({
        ...base,
        duration_s: Math.max(1, numberOr(clip?.durationS ?? clip?.duration_s, 5)),
        status: guarded.verdict === "fail" || guarded.thumbnail_safe === false ? "rejected_qa" : "accepted",
        qa: guarded,
      });
    } catch (err) {
      samples.push({
        ...base,
        duration_s: Math.max(1, numberOr(clip?.durationS ?? clip?.duration_s, 5)),
        status: "extract_failed",
        error: err.message || String(err),
        qa: {
          verdict: "fail",
          thumbnail_safe: false,
          failures: ["extract_failed"],
          warnings: [],
        },
      });
    }
  }

  const verdict = classifySegment(samples, clip);
  return {
    order: index + 1,
    story_id: clip?.story_id || clip?.storyId || clip?.provenance?.story_id || null,
    clip_key: segmentKeyForClipRef(clip),
    source_url: sourceUrl,
    source_type: clip?.sourceType || clip?.source_type || "steam_movie",
    source_url_kind: sourceUrlKind.source_url_kind,
    segment_validation_eligible: sourceUrlKind.segment_validation_eligible,
    segment_validation_ineligible_reason: sourceUrlKind.segment_validation_ineligible_reason,
    entity: clip?.entity || null,
    ...clipSourceProvenance(clip),
    media_start_s: numberOr(clip?.mediaStartS ?? clip?.media_start_s, 0),
    duration_s: Math.max(1, numberOr(clip?.durationS ?? clip?.duration_s, 5)),
    source_duration_s: sourceDurationSeconds(clip),
    status: verdict.status,
    segment_validated: verdict.segment_validated,
    allowed_for_flash_lane: verdict.allowed_for_flash_lane,
    validation_reason: verdict.reason,
    segment_motion_class: verdict.segment_motion_class,
    action_score: verdict.action_score,
    action_sample_count: verdict.action_sample_count,
    sample_rejection_reasons: asArray(verdict.sample_rejection_reasons),
    trim_recommended: verdict.trim_recommended === true,
    recommended_media_start_s: Number.isFinite(Number(verdict.recommended_media_start_s))
      ? Number(verdict.recommended_media_start_s)
      : null,
    recommended_duration_s: Number.isFinite(Number(verdict.recommended_duration_s))
      ? Number(verdict.recommended_duration_s)
      : null,
    trim_sample_orders: asArray(verdict.trim_sample_orders),
    samples,
  };
}

function segmentMetadataRejectReason(segment = {}) {
  const urlKind = mediaSourceUrlKindFields(segment.source_url || segment.sourceUrl || segment.path);
  if (urlKind.segment_validation_eligible !== true) {
    return urlKind.segment_validation_ineligible_reason || "segment_source_url_not_direct_media";
  }
  const metadataRejectReason = officialMediaReferenceRejectReason(segment);
  if (metadataRejectReason === "rating_board_reference") {
    return "segment_source_is_rating_board_reference";
  }
  if (metadataRejectReason === "logo_or_title_only_reference") {
    return "segment_source_is_logo_or_title_only_reference";
  }
  if (metadataRejectReason === "localised_non_english_reference") {
    return "segment_source_is_localised_non_english_reference";
  }
  if (metadataRejectReason === "embedded_subtitle_reference") {
    return "segment_source_has_embedded_subtitle_reference";
  }
  return null;
}

function applySegmentMetadataGuard(segment = {}) {
  const reason = segmentMetadataRejectReason(segment);
  if (!reason) return segment;
  return {
    ...segment,
    status: "rejected",
    segment_validated: false,
    allowed_for_flash_lane: false,
    validation_reason: reason,
    segment_motion_class: "rejected",
    metadata_reject_reason: reason,
  };
}

function summariseSegments(segments, applyLocal) {
  return {
    segments: segments.length,
    segments_would_validate: applyLocal
      ? 0
      : segments.filter((segment) => segment.status === "would_validate").length,
    segments_validated: segments.filter((segment) => segment.segment_validated === true).length,
    segments_rejected: segments.filter((segment) => segment.status === "rejected").length,
    samples_would_extract: applyLocal
      ? 0
      : segments.flatMap((segment) => segment.samples || []).filter((sample) => sample.status === "would_sample").length,
    samples_extracted: segments
      .flatMap((segment) => segment.samples || [])
      .filter((sample) => sample.status !== "would_sample").length,
    gameplay_action_segments: segments.filter((segment) => segment.segment_motion_class === "gameplay_action").length,
  };
}

function filterPreviouslySampledClipRefs(clipRefs = [], previousReport = null) {
  if (Number(previousReport?.validator_ruleset_version || 0) !== VALIDATOR_RULESET_VERSION) {
    return asArray(clipRefs);
  }
  const requestedStoryIds = storyIdsFromClipRefs(clipRefs);
  const previousSegments = filterSegmentsForStoryIds(previousReport?.segments, requestedStoryIds);
  const previousKeys = new Set(
    previousSegments
      .map((segment) => segment?.clip_key || segmentKeyForClipRef(segment))
      .filter(Boolean),
  );
  if (!previousKeys.size) return asArray(clipRefs);
  return asArray(clipRefs).filter((clip) => !previousKeys.has(segmentKeyForClipRef(clip)));
}

function exhaustedSourceFamiliesFromReport(previousReport = null, options = {}) {
  const threshold = Math.max(
    1,
    Number(options.threshold || DEFAULT_EXHAUSTED_SOURCE_FAMILY_THRESHOLD),
  );
  const families = new Map();
  for (const segment of asArray(previousReport?.segments)) {
    const family = clipSourceFamily(segment);
    if (!family.key || !family.source_url) continue;
    const existing =
      families.get(family.key) ||
      {
        ...family,
        attempted_segments: 0,
        validated_segments: 0,
        rejected_segments: 0,
        rejection_reasons: {},
        top_rejection_reason: null,
      };
    existing.attempted_segments += 1;
    if (segment.segment_validated === true && segment.allowed_for_flash_lane === true) {
      existing.validated_segments += 1;
    } else {
      existing.rejected_segments += 1;
      const reason = segment.validation_reason || "unvalidated_segment";
      existing.rejection_reasons[reason] = (existing.rejection_reasons[reason] || 0) + 1;
    }
    existing.top_rejection_reason =
      Object.entries(existing.rejection_reasons).sort((a, b) => Number(b[1]) - Number(a[1]))[0]?.[0] || null;
    families.set(family.key, existing);
  }

  return [...families.values()]
    .filter((family) => family.validated_segments === 0 && family.attempted_segments >= threshold)
    .sort((a, b) => {
      const attempts = Number(b.attempted_segments || 0) - Number(a.attempted_segments || 0);
      if (attempts) return attempts;
      return String(a.key).localeCompare(String(b.key));
    });
}

function filterExhaustedSourceFamilyClipRefs(clipRefs = [], previousReport = null, options = {}) {
  const exhaustedFamilies = exhaustedSourceFamiliesFromReport(previousReport, options);
  if (!exhaustedFamilies.length) {
    return {
      clipRefs: asArray(clipRefs),
      skipped: [],
      exhausted_source_families: [],
    };
  }
  const exhaustedKeys = new Map(exhaustedFamilies.map((family) => [family.key, family]));
  const kept = [];
  const skipped = [];
  for (const clip of asArray(clipRefs)) {
    const family = clipSourceFamily(clip);
    const exhausted = exhaustedKeys.get(family.key);
    if (exhausted) {
      skipped.push({
        clip_key: segmentKeyForClipRef(clip),
        source_family_key: family.key,
        story_id: family.story_id,
        entity: family.entity,
        provider: family.provider,
        store_app_id: family.store_app_id,
        movie_id: family.movie_id,
        reference_title: family.reference_title,
        source_url: family.source_url,
        attempted_segments: exhausted.attempted_segments,
        top_rejection_reason: exhausted.top_rejection_reason,
      });
      continue;
    }
    kept.push(clip);
  }
  return {
    clipRefs: kept,
    skipped,
    exhausted_source_families: exhaustedFamilies,
  };
}

function mergeOfficialTrailerSegmentReports(previousReport = null, currentReport = null, options = {}) {
  const currentSegments = asArray(currentReport?.segments);
  const scopedStoryIds = new Set([
    ...asArray(options.storyIds).map(normaliseFamilyValue).filter(Boolean),
    ...asArray(currentReport?.merge_story_ids).map(normaliseFamilyValue).filter(Boolean),
    ...[currentReport?.story_id].map(normaliseFamilyValue).filter(Boolean),
  ]);
  if (!options.preserveUnscopedPrevious && !scopedStoryIds.size) {
    for (const storyId of storyIdsFromClipRefs(currentSegments)) scopedStoryIds.add(storyId);
  }
  const previousUnscopedSegments = asArray(previousReport?.segments);
  const previousSegments = !options.preserveUnscopedPrevious && scopedStoryIds.size
    ? filterSegmentsForStoryIds(previousUnscopedSegments, scopedStoryIds)
    : previousUnscopedSegments;
  const byKey = new Map();
  for (const segment of previousSegments) {
    const key = segment?.clip_key || segmentKeyForClipRef(segment);
    if (!key) continue;
    byKey.set(key, segment);
  }
  let duplicateSegmentCount = 0;
  for (const segment of currentSegments) {
    const key = segment?.clip_key || segmentKeyForClipRef(segment);
    if (!key) continue;
    if (byKey.has(key)) duplicateSegmentCount += 1;
    byKey.set(key, segment);
  }
  const previousApplyLocal = previousReport?.apply_local === true;
  const currentApplyLocal = currentReport?.apply_local === true;
  const applyLocal =
    typeof currentReport?.apply_local === "boolean"
      ? currentApplyLocal
      : previousApplyLocal;
  const segments = [...byKey.values()].map(applySegmentMetadataGuard);
  return {
    ...(previousReport || {}),
    ...(currentReport || {}),
    validator_ruleset_version: VALIDATOR_RULESET_VERSION,
    generated_at: currentReport?.generated_at || new Date().toISOString(),
    mode: currentReport?.mode || previousReport?.mode || (applyLocal ? "apply_local" : "dry_run"),
    dry_run: currentReport?.dry_run ?? previousReport?.dry_run ?? !applyLocal,
    apply_local: applyLocal,
    summary: summariseSegments(segments, applyLocal),
    segments,
    merge: {
      previous_segment_count: previousSegments.length,
      previous_unscoped_segment_count: previousUnscopedSegments.length,
      scoped_story_ids: [...scopedStoryIds],
      current_segment_count: currentSegments.length,
      merged_segment_count: segments.length,
      duplicate_segment_count: duplicateSegmentCount,
      previous_apply_local: previousApplyLocal,
      current_apply_local: currentApplyLocal,
      preserved_previous_apply_local: previousApplyLocal && !currentApplyLocal,
    },
  };
}

async function runOfficialTrailerSegmentValidation(clipRefs = [], options = {}) {
  const applyLocal = options.applyLocal === true;
  const outputRoot = path.resolve(options.outputRoot || DEFAULT_OUTPUT_ROOT);
  if (applyLocal) assertLocalOutputRoot(outputRoot);
  const clips = asArray(clipRefs)
    .filter((clip) => String(clip?.source || "").includes("official-trailer"))
    .slice(0, Math.max(1, Number(options.maxSegments || DEFAULT_MAX_SEGMENTS)));
  const workerOptions = {
    ...options,
    outputRoot,
    extractor: options.extractor || defaultSegmentSampleExtractor,
    inspectFrame: options.inspectFrame || inspectExtractedFrame,
  };
  const segments = [];
  for (const [index, clip] of clips.entries()) {
    segments.push(await processClipSegment(clip, index, workerOptions));
  }
  return {
    schema_version: 1,
    validator_ruleset_version: VALIDATOR_RULESET_VERSION,
    generated_at: new Date().toISOString(),
    mode: applyLocal ? "apply_local" : "dry_run",
    dry_run: !applyLocal,
    apply_local: applyLocal,
    output_root: outputRoot,
    will_download_video: false,
    will_retain_video: false,
    will_fetch_source_for_segment_samples: applyLocal,
    summary: summariseSegments(segments, applyLocal),
    segments,
    safety: {
      local_only: true,
      output_under_test_output: isUnder(TEST_OUTPUT_ROOT, outputRoot),
      production_db_mutated: false,
      railway_mutated: false,
      oauth_triggered: false,
      posted_to_platforms: false,
      render_default_changed: false,
      retained_video_files: false,
      yt_dlp: false,
      browser_scraping: false,
    },
  };
}

function applySegmentValidationToClipRefs(clipRefs = [], report = null) {
  const byKey = new Map(asArray(report?.segments).map((segment) => [segment.clip_key, segment]));
  return asArray(clipRefs).map((clip) => {
    const segment = byKey.get(segmentKeyForClipRef(clip));
    if (!segment) return clip;
    const actionScore = numberOr(segment.action_score, null);
    const metadataRejectReason =
      officialMediaReferenceRejectReason(clip) || officialMediaReferenceRejectReason(segment);
    const clipUrlKind = mediaSourceUrlKindFields(clipSourceUrl(clip) || segment.source_url || segment.sourceUrl);
    const segmentValidationEligible =
      clipUrlKind.segment_validation_eligible === true &&
      clip.segment_validation_eligible !== false &&
      clip?.provenance?.segment_validation_eligible !== false;
    const allowedForFlashLane =
      !metadataRejectReason &&
      segmentValidationEligible &&
      segment.allowed_for_flash_lane === true &&
      segment.segment_motion_class === "gameplay_action" &&
      Number.isFinite(actionScore) &&
      actionScore >= MIN_SEGMENT_ACTION_SCORE;
    const recommendedStart = Number(segment.recommended_media_start_s ?? segment.recommendedMediaStartS);
    const recommendedDuration = Number(segment.recommended_duration_s ?? segment.recommendedDurationS);
    const hasTrimTiming =
      segment.trim_recommended === true &&
      Number.isFinite(recommendedStart) &&
      Number.isFinite(recommendedDuration) &&
      recommendedDuration > 0;
    const originalStart = numberOr(segment.media_start_s ?? segment.mediaStartS, numberOr(clip.mediaStartS, null));
    const originalDuration = numberOr(segment.duration_s ?? segment.durationS, numberOr(clip.durationS, null));
    const renderTiming = renderSafeTrimTiming({
      start: allowedForFlashLane && hasTrimTiming ? recommendedStart : clip.mediaStartS,
      duration: allowedForFlashLane && hasTrimTiming ? recommendedDuration : clip.durationS,
      trimmed: allowedForFlashLane && hasTrimTiming,
    });
    return {
      ...clip,
      mediaStartS:
        allowedForFlashLane && hasTrimTiming
          ? Number(renderTiming.mediaStartS.toFixed(2))
          : clip.mediaStartS,
      durationS:
        allowedForFlashLane && hasTrimTiming
          ? Number(renderTiming.durationS.toFixed(2))
          : clip.durationS,
      provenance: {
        ...(clip.provenance || {}),
        requires_segment_validation: true,
        segment_validated: segment.segment_validated === true && segmentValidationEligible,
        allowed_for_flash_lane: allowedForFlashLane,
        segment_metadata_reject_reason: metadataRejectReason || null,
        segment_validation_reason: metadataRejectReason
          ? `metadata_guard_${metadataRejectReason}`
          : !segmentValidationEligible
            ? clipUrlKind.segment_validation_ineligible_reason || "segment_source_url_not_direct_media"
            : segment.validation_reason,
        source_url_kind: clipUrlKind.source_url_kind,
        segment_validation_eligible: segmentValidationEligible,
        segment_validation_ineligible_reason: segmentValidationEligible
          ? null
          : clipUrlKind.segment_validation_ineligible_reason || "segment_source_url_not_direct_media",
        segment_validation_samples: asArray(segment.samples).length,
        segment_motion_class: segment.segment_motion_class || null,
        segment_action_score: actionScore,
        segment_action_sample_count: numberOr(segment.action_sample_count, null),
        segment_validation_reported_at: report?.generated_at || null,
        segment_trim_recommended: allowedForFlashLane && hasTrimTiming,
        segment_original_start_s: originalStart,
        segment_original_duration_s: originalDuration,
        segment_recommended_start_s: allowedForFlashLane && hasTrimTiming ? Number(recommendedStart.toFixed(2)) : null,
        segment_recommended_duration_s: allowedForFlashLane && hasTrimTiming ? Number(recommendedDuration.toFixed(2)) : null,
        segment_render_start_s:
          allowedForFlashLane && hasTrimTiming ? Number(renderTiming.mediaStartS.toFixed(2)) : null,
        segment_render_duration_s:
          allowedForFlashLane && hasTrimTiming ? Number(renderTiming.durationS.toFixed(2)) : null,
        segment_render_head_inset_s:
          allowedForFlashLane && hasTrimTiming ? renderTiming.headInsetS : null,
        segment_render_tail_inset_s:
          allowedForFlashLane && hasTrimTiming ? renderTiming.tailInsetS : null,
        segment_trim_sample_orders: asArray(segment.trim_sample_orders),
      },
    };
  });
}

function renderOfficialTrailerSegmentValidationMarkdown(report) {
  const lines = [];
  const displayStoryIds = new Set(
    asArray(report.display_story_ids || report.scoped_story_ids)
      .map(normaliseFamilyValue)
      .filter(Boolean),
  );
  const visibleSegments = displayStoryIds.size
    ? filterSegmentsForStoryIds(report.segments, displayStoryIds)
    : asArray(report.segments);
  lines.push("# Official Trailer Segment Validator v1");
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Mode: ${report.mode}`);
  lines.push(`Dry run: ${report.dry_run}`);
  lines.push(`Apply local: ${report.apply_local}`);
  if (report.current_run) {
    lines.push(`Current run mode: ${report.current_run.mode}`);
    lines.push(`Current run fetches samples: ${report.current_run.will_fetch_source_for_segment_samples}`);
  }
  if (report.merge?.preserved_previous_apply_local) {
    lines.push("Preserved previous apply-local samples: true");
  }
  if (displayStoryIds.size) {
    lines.push(`Displayed story scope: ${[...displayStoryIds].join(", ")}`);
  }
  lines.push(`Output root: ${toPosix(report.output_root)}`);
  lines.push(`Fetch source for segment samples: ${report.will_fetch_source_for_segment_samples}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  const displaySummary = displayStoryIds.size
    ? summariseSegments(visibleSegments, report.apply_local === true)
    : report.summary;
  lines.push(`- segments: ${displaySummary.segments}`);
  lines.push(`- segments would validate: ${displaySummary.segments_would_validate}`);
  lines.push(`- segments validated: ${displaySummary.segments_validated}`);
  lines.push(`- segments rejected: ${displaySummary.segments_rejected}`);
  lines.push(`- gameplay/action segments: ${displaySummary.gameplay_action_segments}`);
  lines.push(`- samples would extract: ${displaySummary.samples_would_extract}`);
  lines.push(`- samples extracted: ${displaySummary.samples_extracted}`);
  if (Number.isFinite(Number(report.clip_refs_filtered_previous_count))) {
    lines.push(`- previously sampled clip refs skipped: ${report.clip_refs_filtered_previous_count}`);
  }
  if (Number.isFinite(Number(report.clip_refs_filtered_exhausted_source_family_count))) {
    lines.push(
      `- exhausted source-family clip refs skipped: ${report.clip_refs_filtered_exhausted_source_family_count}`,
    );
  }
  lines.push("");
  const exhaustedFamilies = displayStoryIds.size
    ? asArray(report.exhausted_source_family_filter?.exhausted_source_families).filter((family) => {
        const storyId = normaliseFamilyValue(family.story_id);
        return storyId && displayStoryIds.has(storyId);
      })
    : asArray(report.exhausted_source_family_filter?.exhausted_source_families);
  if (exhaustedFamilies.length) {
    lines.push("## Exhausted Source Families", "");
    lines.push("| entity | source | attempts | top rejection |");
    lines.push("| --- | --- | ---: | --- |");
    for (const family of exhaustedFamilies.slice(0, 12)) {
      const sourceLabel =
        family.reference_title ||
        family.movie_id ||
        (family.source_url ? String(family.source_url).replace(/^https?:\/\//i, "").slice(0, 72) : "unknown");
      lines.push(
        [
          family.entity || "unknown",
          sourceLabel,
          family.attempted_segments,
          family.top_rejection_reason || "none",
        ]
          .map((value) => String(value ?? "").replace(/\|/g, "/"))
          .join(" | ")
          .replace(/^/, "| ")
          .replace(/$/, " |"),
      );
    }
    lines.push("");
  }
  lines.push("| clip | entity | source | start | status | motion | action score | Flash Lane | reason | samples |");
  lines.push("| --- | --- | --- | ---: | --- | --- | ---: | --- | --- | ---: |");
  for (const segment of visibleSegments) {
    lines.push(
      [
        segment.order,
        segment.entity || "unknown",
        segment.reference_title || segment.provider || "unknown",
        segment.media_start_s,
        segment.status,
        segment.segment_motion_class || "unknown",
        segment.action_score ?? "n/a",
        segment.allowed_for_flash_lane ? "allowed" : "blocked",
        segment.validation_reason,
        asArray(segment.samples).length,
      ]
        .map((value) => String(value ?? "").replace(/\|/g, "/"))
        .join(" | ")
        .replace(/^/, "| ")
        .replace(/$/, " |"),
    );
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- Dry-run by default.");
  lines.push("- Apply-local writes only under `test/output`.");
  lines.push("- No retained trailer downloads.");
  lines.push("- No production DB, Railway, OAuth, scheduler, render-default or posting changes.");
  lines.push("- No yt-dlp or browser scraping.");
  return lines.join("\n") + "\n";
}

module.exports = {
  DEFAULT_OUTPUT_ROOT,
  DEFAULT_EXHAUSTED_SOURCE_FAMILY_THRESHOLD,
  VALIDATOR_RULESET_VERSION,
  DEFAULT_SAMPLE_OFFSETS_S,
  MIN_GAMEPLAY_ACTION_SAMPLES,
  MIN_PASSING_SAMPLES,
  MIN_SEGMENT_ACTION_SCORE,
  applySegmentValidationToClipRefs,
  buildSamplePlan,
  classifySegment,
  exhaustedSourceFamiliesFromReport,
  filterExhaustedSourceFamilyClipRefs,
  filterPreviouslySampledClipRefs,
  filterSegmentsForStoryIds,
  guardSegmentSample,
  mergeOfficialTrailerSegmentReports,
  renderOfficialTrailerSegmentValidationMarkdown,
  runOfficialTrailerSegmentValidation,
  segmentKeyForClipRef,
  scoreGameplayActionSample,
};
