"use strict";

const {
  officialTrailerFrameRejectReason,
} = require("../../controlled-frame-extraction-worker");
const {
  applySegmentValidationToClipRefs,
} = require("./official-trailer-segment-validator");

const DEFAULT_MAX_CLIPS = 3;
const MIN_OFFICIAL_CLIP_START_S = 36;
const SAFE_FRAME_LEAD_OUT_S = 4;
const QUALITY_TIE_EPSILON = 0.001;

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

function scoreOfficialTrailerFrameForClip(frame) {
  if (officialTrailerFrameRejectReason(frame, frame?.qa || {})) return Number.NEGATIVE_INFINITY;
  const qa = frame?.qa || {};
  const prescan = qa.prescan || {};
  const edgeDensity = bounded(prescan.edge_density, 0, 0.45);
  const saturation = bounded(prescan.saturation_mean, 0, 0.7);
  const textOverlay = bounded(prescan.text_overlay_likelihood, 0, 0.7);
  const targetSeconds = Number(frame?.target_time_seconds);

  let score = 50;
  score += edgeDensity * 140;
  score += saturation * 60;
  score -= textOverlay * 90;
  if (prescan.likely_is_logo === true) score -= 55;
  if (qa.verdict === "pass") score += 8;
  if (qa.verdict === "warn") score -= 18;
  if (Number.isFinite(targetSeconds)) {
    if (targetSeconds < MIN_OFFICIAL_CLIP_START_S) score -= 18;
    else if (targetSeconds < 22) score -= 6;
    else score += Math.min(10, targetSeconds / 8);
  }
  return Number(score.toFixed(3));
}

function buildOfficialTrailerClipsFromFrameReport(frameReport, storyId, opts = {}) {
  const maxClips = Math.max(1, Number(opts.maxClips || DEFAULT_MAX_CLIPS));
  const bestBySource = new Map();
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
      const current = bestBySource.get(sourceUrl);
      const currentScore = Number(current?.__segment_quality_score);
      if (
        !current ||
        qualityScore > currentScore + QUALITY_TIE_EPSILON ||
        (Math.abs(qualityScore - currentScore) <= QUALITY_TIE_EPSILON &&
          (Number.isFinite(targetSeconds) ? targetSeconds : 0) >
            (Number.isFinite(Number(current.target_time_seconds)) ? Number(current.target_time_seconds) : 0))
      ) {
        bestBySource.set(sourceUrl, {
          ...frame,
          __segment_quality_score: qualityScore,
        });
      }
    }
  }
  const refs = [...bestBySource.values()]
    .slice(0, maxClips)
    .map((frame) => {
      const targetSeconds = Number(frame.target_time_seconds);
      return {
        path: String(frame.source_url || "").trim(),
        source: "official-trailer-reference",
        sourceType: frame.source_type || "steam_movie",
        entity: frame.entity || null,
        durationS: 5,
        mediaStartS: safeClipStartFromFrame(frame),
        provenance: {
          target_time_seconds: Number.isFinite(targetSeconds) ? targetSeconds : null,
          frame_local_path: frame.local_path || null,
          content_hash: frame.qa?.content_hash || null,
          clip_start_policy: "start_after_accepted_safe_frame",
          min_start_seconds: MIN_OFFICIAL_CLIP_START_S,
          safe_frame_lead_out_seconds: SAFE_FRAME_LEAD_OUT_S,
          segment_selection_policy: "highest_quality_safe_frame",
          segment_quality_score: frame.__segment_quality_score ?? null,
          requires_segment_validation: true,
          segment_validated: false,
          allowed_for_flash_lane: false,
          segment_validation_reason: "segment_window_not_sampled_by_frame_qa",
        },
      };
    });
  const segmentAwareRefs = opts.segmentValidationReport
    ? applySegmentValidationToClipRefs(refs, opts.segmentValidationReport)
    : refs;
  return opts.requireValidatedSegments
    ? segmentAwareRefs.filter((ref) => ref?.provenance?.allowed_for_flash_lane === true)
    : segmentAwareRefs;
}

module.exports = {
  buildOfficialTrailerClipsFromFrameReport,
  safeClipStartFromFrame,
  scoreOfficialTrailerFrameForClip,
  MIN_OFFICIAL_CLIP_START_S,
  SAFE_FRAME_LEAD_OUT_S,
};
