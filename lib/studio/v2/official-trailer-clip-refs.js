"use strict";

const {
  officialTrailerFrameRejectReason,
} = require("../../controlled-frame-extraction-worker");
const {
  classifyTrailerFrameTaste,
} = require("../../visual-content-prescan");
const {
  applySegmentValidationToClipRefs,
} = require("./official-trailer-segment-validator");

const DEFAULT_MAX_CLIPS = 3;
const MIN_OFFICIAL_CLIP_START_S = 36;
const SAFE_FRAME_LEAD_OUT_S = 4;
const QUALITY_TIE_EPSILON = 0.001;
const DEFAULT_EXPLORATORY_START_SECONDS = [36, 42, 48, 54, 60, 66];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function bounded(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function safeClipStartFromFrame(frame) {
  const targetSeconds = Number(frame?.target_time_seconds);
  if (!Number.isFinite(targetSeconds)) return MIN_OFFICIAL_CLIP_START_S;
  return Number(Math.max(MIN_OFFICIAL_CLIP_START_S, targetSeconds + SAFE_FRAME_LEAD_OUT_S).toFixed(2));
}

function clipStartCandidatesFromFrame(frame, opts = {}) {
  const after = safeClipStartFromFrame(frame);
  const targetSeconds = Number(frame?.target_time_seconds);
  if (opts.includeFrameAnchoredWindows !== true || !Number.isFinite(targetSeconds)) {
    return [
      {
        mediaStartS: after,
        clipStartPolicy: "start_after_accepted_safe_frame",
      },
    ];
  }
  const before = Number(Math.max(MIN_OFFICIAL_CLIP_START_S, targetSeconds - 2).toFixed(2));
  const candidates = [
    {
      mediaStartS: before,
      clipStartPolicy: "start_before_accepted_safe_frame",
    },
    {
      mediaStartS: after,
      clipStartPolicy: "start_after_accepted_safe_frame",
    },
  ];
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.mediaStartS)) return false;
    seen.add(candidate.mediaStartS);
    return true;
  });
}

function scoreOfficialTrailerFrameForClip(frame) {
  if (officialTrailerFrameRejectReason(frame, frame?.qa || {})) return Number.NEGATIVE_INFINITY;
  const qa = frame?.qa || {};
  const prescan = qa.prescan || {};
  const taste = qa.visual_taste || prescan.trailer_frame_taste || classifyTrailerFrameTaste(prescan);
  const edgeDensity = bounded(prescan.edge_density, 0, 0.45);
  const saturation = bounded(prescan.saturation_mean, 0, 0.7);
  const textOverlay = bounded(prescan.text_overlay_likelihood, 0, 0.7);
  const targetSeconds = Number(frame?.target_time_seconds);

  let score = 50;
  score += edgeDensity * 140;
  score += saturation * 60;
  score -= textOverlay * 90;
  if (Number.isFinite(Number(taste.score))) {
    score += (Number(taste.score) - 50) * 0.55;
  }
  if (Array.isArray(taste.tags) && taste.tags.includes("gameplay_candidate")) score += 12;
  if (Array.isArray(taste.tags) && taste.tags.includes("text_heavy")) score -= 10;
  if (prescan.likely_is_logo === true) score -= 55;
  if (qa.verdict === "pass") score += 8;
  if (qa.verdict === "warn") score -= 18;
  if (Number.isFinite(targetSeconds)) {
    if (targetSeconds < 24) score -= 18;
    else if (targetSeconds < MIN_OFFICIAL_CLIP_START_S) score -= 6;
    else score += Math.min(10, targetSeconds / 8);
  }
  return Number(score.toFixed(3));
}

function clipRefDedupeKey(ref) {
  return [
    String(ref?.path || "").trim(),
    String(ref?.entity || "").trim().toLowerCase(),
    Number(ref?.mediaStartS || 0).toFixed(2),
  ].join("|");
}

function dedupeClipRefs(refs) {
  const seen = new Set();
  const out = [];
  for (const ref of refs) {
    const key = clipRefDedupeKey(ref);
    if (!key.trim() || seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

function clipEntityKey(ref) {
  return String(ref?.entity || ref?.provenance?.entity || ref?.path || "unknown")
    .trim()
    .toLowerCase();
}

function clipSourceKey(ref) {
  return [
    String(ref?.path || "").trim(),
    clipEntityKey(ref),
  ].join("|");
}

function selectBalancedClipRefs(refs, maxClips) {
  const limit = Math.max(1, Number(maxClips || DEFAULT_MAX_CLIPS));
  if (!Array.isArray(refs) || refs.length <= limit) return refs;

  const selected = [];
  const selectedIndexes = new Set();

  const entityOrder = [];
  const byEntity = new Map();
  refs.forEach((ref, index) => {
    const entity = clipEntityKey(ref);
    if (!byEntity.has(entity)) {
      byEntity.set(entity, []);
      entityOrder.push(entity);
    }
    byEntity.get(entity).push({ ref, index });
  });

  let madeProgress = true;
  while (selected.length < limit && madeProgress) {
    madeProgress = false;
    for (const entity of entityOrder) {
      if (selected.length >= limit) break;
      const next = (byEntity.get(entity) || []).find((item) => !selectedIndexes.has(item.index));
      if (!next) continue;
      selected.push(next.ref);
      selectedIndexes.add(next.index);
      madeProgress = true;
    }
  }

  for (let i = 0; i < refs.length && selected.length < limit; i++) {
    if (selectedIndexes.has(i)) continue;
    selected.push(refs[i]);
    selectedIndexes.add(i);
  }

  return selected;
}

function uniqueOfficialSourceRecords(frameReport, storyId) {
  const records = [];
  const seen = new Set();
  for (const plan of Array.isArray(frameReport?.plans) ? frameReport.plans : []) {
    if (plan?.story_id !== storyId) continue;
    for (const frame of Array.isArray(plan.frames) ? plan.frames : []) {
      const sourceUrl = String(frame?.source_url || "").trim();
      if (!sourceUrl) continue;
      const sourceType = frame?.source_type || "steam_movie";
      const entity = frame?.entity || null;
      const key = [sourceUrl, String(entity || "").trim().toLowerCase()].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      records.push({ sourceUrl, sourceType, entity, referenceReportSource: false });
    }
  }
  return records;
}

function isOfficialReference(record) {
  const sourceType = String(record?.source_type || record?.sourceType || "").toLowerCase();
  const sourceUrl = String(record?.source_url || record?.sourceUrl || record?.local_path || "").trim();
  return (
    Boolean(sourceUrl) &&
    record?.downloads_allowed !== true &&
    /(steam_movie|igdb_video|official_trailer|publisher_video|platform_video)/.test(sourceType)
  );
}

function uniqueOfficialReferenceRecords(referenceReport, storyId) {
  const records = [];
  const seen = new Set();
  for (const plan of Array.isArray(referenceReport?.plans) ? referenceReport.plans : []) {
    if (plan?.story_id !== storyId) continue;
    for (const reference of Array.isArray(plan.references) ? plan.references : []) {
      if (!isOfficialReference(reference)) continue;
      const sourceUrl = String(reference.source_url || reference.sourceUrl || reference.local_path || "").trim();
      const sourceType = reference.source_type || reference.sourceType || "official_trailer";
      const entity = reference.entity || null;
      const key = [sourceUrl, String(entity || "").trim().toLowerCase()].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      records.push({
        sourceUrl,
        sourceType,
        entity,
        provider: reference.provider || null,
        movieName: reference.movie_name || reference.name || null,
        movieId: reference.movie_id || reference.video_id || null,
        storeAppId: reference.store_app_id || null,
        storeAppTitle: reference.store_app_title || null,
        allowedRenderUse: reference.allowed_render_use || null,
        rightsRiskClass: reference.rights_risk_class || null,
        referenceReportSource: true,
      });
    }
  }
  return records;
}

function mergeSourceRecords(primary = [], secondary = []) {
  const seen = new Set();
  const out = [];
  for (const record of primary.concat(secondary)) {
    const key = [record.sourceUrl, String(record.entity || "").trim().toLowerCase()].join("|");
    if (!key.trim() || seen.has(key)) continue;
    seen.add(key);
    out.push(record);
  }
  return out;
}

function buildExploratoryClipRefs(frameReport, storyId, opts = {}) {
  const starts = (
    Array.isArray(opts.exploratoryStartSeconds) && opts.exploratoryStartSeconds.length
      ? opts.exploratoryStartSeconds
      : DEFAULT_EXPLORATORY_START_SECONDS
  )
    .map((seconds) => Number(seconds))
    .filter((seconds) => Number.isFinite(seconds) && seconds >= MIN_OFFICIAL_CLIP_START_S)
    .map((seconds) => Number(seconds.toFixed(2)));
  const refs = [];
  const records = mergeSourceRecords(
    uniqueOfficialSourceRecords(frameReport, storyId),
    uniqueOfficialReferenceRecords(opts.referenceReport, storyId),
  );
  for (const record of records) {
    for (const start of starts) {
      refs.push({
        path: record.sourceUrl,
        source: "official-trailer-reference",
        sourceType: record.sourceType,
        entity: record.entity,
        durationS: 5,
        mediaStartS: start,
        provenance: {
          target_time_seconds: null,
          frame_local_path: null,
          content_hash: null,
          clip_start_policy: "exploratory_uniform_window",
          min_start_seconds: MIN_OFFICIAL_CLIP_START_S,
          safe_frame_lead_out_seconds: SAFE_FRAME_LEAD_OUT_S,
          segment_selection_policy: "deep_scan_uniform_window",
          segment_quality_score: null,
          requires_segment_validation: true,
          segment_validated: false,
          allowed_for_flash_lane: false,
          segment_validation_reason: "exploratory_window_not_sampled",
          exploratory_scan: true,
          reference_report_source: record.referenceReportSource === true,
          provider: record.provider || null,
          movie_name: record.movieName || null,
          movie_id: record.movieId || null,
          store_app_id: record.storeAppId || null,
          store_app_title: record.storeAppTitle || null,
          allowed_render_use: record.allowedRenderUse || null,
          rights_risk_class: record.rightsRiskClass || null,
        },
      });
    }
  }
  return dedupeClipRefs(refs);
}

function segmentStoryId(segment) {
  const sample = asArray(segment?.samples)[0];
  const localPath = String(sample?.local_path || sample?.planned_local_path || "");
  const match = localPath.match(/[\\/]assets[\\/]([^\\/]+)[\\/]/i);
  return match ? match[1] : null;
}

function segmentBelongsToStory(segment, storyId) {
  if (!storyId) return true;
  return segment?.story_id === storyId || segmentStoryId(segment) === storyId;
}

function segmentActionScore(segment) {
  const score = Number(segment?.action_score);
  return Number.isFinite(score) ? score : null;
}

function isAllowedGameplaySegment(segment, storyId) {
  const sourceUrl = String(segment?.source_url || segment?.sourceUrl || "").trim();
  const start = Number(segment?.media_start_s ?? segment?.mediaStartS);
  const actionScore = segmentActionScore(segment);
  return (
    Boolean(sourceUrl) &&
    segmentBelongsToStory(segment, storyId) &&
    Number.isFinite(start) &&
    start >= MIN_OFFICIAL_CLIP_START_S &&
    segment?.segment_validated === true &&
    segment?.allowed_for_flash_lane === true &&
    segment?.segment_motion_class === "gameplay_action" &&
    Number.isFinite(actionScore)
  );
}

function validatedSegmentClipRefs(segmentValidationReport, storyId) {
  return dedupeClipRefs(
    asArray(segmentValidationReport?.segments)
      .filter((segment) => isAllowedGameplaySegment(segment, storyId))
      .sort((a, b) => {
        const actionDelta = Number(b.action_score || 0) - Number(a.action_score || 0);
        if (Math.abs(actionDelta) > QUALITY_TIE_EPSILON) return actionDelta;
        return Number(a.media_start_s || 0) - Number(b.media_start_s || 0);
      })
      .map((segment) => {
        const start = Number(segment.media_start_s ?? segment.mediaStartS);
        const duration = Number(segment.duration_s ?? segment.durationS);
        return {
          path: String(segment.source_url || segment.sourceUrl || "").trim(),
          source: "official-trailer-reference",
          sourceType: segment.source_type || segment.sourceType || "steam_movie",
          entity: segment.entity || null,
          durationS: Number.isFinite(duration) && duration > 0 ? duration : 5,
          mediaStartS: Number(start.toFixed(2)),
          provenance: {
            target_time_seconds: null,
            frame_local_path: null,
            content_hash: null,
            clip_start_policy: "validated_segment_window",
            min_start_seconds: MIN_OFFICIAL_CLIP_START_S,
            safe_frame_lead_out_seconds: SAFE_FRAME_LEAD_OUT_S,
            segment_selection_policy: "validated_deep_scan_segment",
            segment_quality_score: Number.isFinite(Number(segment.segment_quality_score))
              ? Number(segment.segment_quality_score)
              : undefined,
            candidate_windows_per_source: null,
            requires_segment_validation: true,
            segment_validated: true,
            allowed_for_flash_lane: true,
            segment_validation_reason: segment.validation_reason || "segment_samples_passed",
            segment_validation_samples: asArray(segment.samples).length,
            segment_motion_class: segment.segment_motion_class || null,
            segment_action_score: segmentActionScore(segment),
            segment_action_sample_count: Number.isFinite(Number(segment.action_sample_count))
              ? Number(segment.action_sample_count)
              : null,
            segment_validation_reported_at: segmentValidationReport?.generated_at || null,
            segment_clip_key: segment.clip_key || null,
            validated_deep_scan_segment: true,
          },
        };
      }),
  );
}

function buildOfficialTrailerClipsFromFrameReport(frameReport, storyId, opts = {}) {
  const maxClips = Math.max(1, Number(opts.maxClips || DEFAULT_MAX_CLIPS));
  const maxCandidateWindowsPerSource = Math.max(
    1,
    Number(opts.maxCandidateWindowsPerSource || 1),
  );
  const candidatesBySource = new Map();
  for (const plan of Array.isArray(frameReport?.plans) ? frameReport.plans : []) {
    if (plan?.story_id !== storyId) continue;
    for (const frame of Array.isArray(plan.frames) ? plan.frames : []) {
      if (frame?.status !== "accepted") continue;
      if (officialTrailerFrameRejectReason(frame, frame.qa || {})) continue;
      const sourceUrl = String(frame.source_url || "").trim();
      if (!sourceUrl) continue;
      const targetSeconds = Number(frame.target_time_seconds);
      const qualityScore = scoreOfficialTrailerFrameForClip(frame);
      if (!Number.isFinite(qualityScore)) continue;
      const list = candidatesBySource.get(sourceUrl) || [];
      list.push({
        ...frame,
        __segment_quality_score: qualityScore,
        __target_seconds_for_tie_break: Number.isFinite(targetSeconds) ? targetSeconds : 0,
      });
      candidatesBySource.set(sourceUrl, list);
    }
  }
  const multiWindowMode = maxCandidateWindowsPerSource > 1;
  const candidateFrames = [...candidatesBySource.values()]
    .flatMap((frames) =>
      frames
        .sort((a, b) => {
          const scoreDelta = b.__segment_quality_score - a.__segment_quality_score;
          if (Math.abs(scoreDelta) > QUALITY_TIE_EPSILON) return scoreDelta;
          return b.__target_seconds_for_tie_break - a.__target_seconds_for_tie_break;
        })
        .slice(0, maxCandidateWindowsPerSource),
    )
    .sort((a, b) => {
      if (multiWindowMode && a.source_url === b.source_url) {
        return a.__target_seconds_for_tie_break - b.__target_seconds_for_tie_break;
      }
      const scoreDelta = b.__segment_quality_score - a.__segment_quality_score;
      if (Math.abs(scoreDelta) > QUALITY_TIE_EPSILON) return scoreDelta;
      return b.__target_seconds_for_tie_break - a.__target_seconds_for_tie_break;
    });
  const allRefs = candidateFrames
    .flatMap((frame) =>
      clipStartCandidatesFromFrame(frame, {
        includeFrameAnchoredWindows: opts.includeFrameAnchoredWindows,
      }).map((startCandidate) => ({
        frame,
        startCandidate,
      })),
    )
    .map(({ frame, startCandidate }) => {
      const targetSeconds = Number(frame.target_time_seconds);
      return {
        path: String(frame.source_url || "").trim(),
        source: "official-trailer-reference",
        sourceType: frame.source_type || "steam_movie",
        entity: frame.entity || null,
        durationS: 5,
        mediaStartS: startCandidate.mediaStartS,
        provenance: {
          target_time_seconds: Number.isFinite(targetSeconds) ? targetSeconds : null,
          frame_local_path: frame.local_path || null,
          content_hash: frame.qa?.content_hash || null,
          clip_start_policy: startCandidate.clipStartPolicy,
          min_start_seconds: MIN_OFFICIAL_CLIP_START_S,
          safe_frame_lead_out_seconds: SAFE_FRAME_LEAD_OUT_S,
          segment_selection_policy: multiWindowMode
            ? "ranked_quality_candidate_window"
            : "highest_quality_safe_frame",
          segment_quality_score: frame.__segment_quality_score ?? null,
          candidate_windows_per_source: maxCandidateWindowsPerSource,
          requires_segment_validation: true,
          segment_validated: false,
          allowed_for_flash_lane: false,
          segment_validation_reason: "segment_window_not_sampled_by_frame_qa",
        },
      };
    });
  const exploratoryRefs =
    opts.includeExploratoryWindows === true
      ? buildExploratoryClipRefs(frameReport, storyId, opts)
      : [];
  const uniqueRefs = dedupeClipRefs([...allRefs, ...exploratoryRefs]);
  const refs =
    opts.requireValidatedSegments === true
      ? uniqueRefs
      : selectBalancedClipRefs(uniqueRefs, maxClips);
  const segmentAwareRefs = opts.segmentValidationReport
    ? applySegmentValidationToClipRefs(refs, opts.segmentValidationReport)
    : refs;
  const directSegmentRefs =
    opts.requireValidatedSegments === true && opts.segmentValidationReport
      ? validatedSegmentClipRefs(opts.segmentValidationReport, storyId)
      : [];
  return opts.requireValidatedSegments
    ? dedupeClipRefs([
        ...segmentAwareRefs.filter((ref) => ref?.provenance?.allowed_for_flash_lane === true),
        ...directSegmentRefs,
      ])
        .slice(0, maxClips)
    : segmentAwareRefs;
}

module.exports = {
  buildOfficialTrailerClipsFromFrameReport,
  buildExploratoryClipRefs,
  selectBalancedClipRefs,
  DEFAULT_EXPLORATORY_START_SECONDS,
  safeClipStartFromFrame,
  scoreOfficialTrailerFrameForClip,
  MIN_OFFICIAL_CLIP_START_S,
  SAFE_FRAME_LEAD_OUT_S,
  clipStartCandidatesFromFrame,
};
