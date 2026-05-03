"use strict";

const {
  buildFlashLaneFootageBackboneReport,
} = require("./flash-lane-footage-backbone");
const {
  buildOfficialTrailerClipsFromFrameReport,
} = require("./official-trailer-clip-refs");

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function buildBackboneSafetyDetails(report) {
  if (!report) return {};
  const frameEntities = asArray(report.frame_inventory?.entities);
  const validatedEntities = asArray(report.segment_inventory?.validated_entities);
  const missingValidatedEntities = frameEntities.filter((entity) => !validatedEntities.includes(entity));
  const recommendations = asArray(report.recommendations);
  const nextAction =
    recommendations.find((item) => /downgrade_to_standard_short/i.test(item)) ||
    recommendations.find((item) => /motion_acquisition|validated_clip_window/i.test(item)) ||
    "continue_motion_acquisition_before_flash_render";
  return {
    backbone_verdict: report.verdict,
    blockers: asArray(report.blockers),
    validated_entities: validatedEntities,
    missing_validated_entities: missingValidatedEntities,
    projected_clip_dominance: report.projected_clip_dominance,
    rejected_segment_reasons: report.segment_inventory?.rejected_reasons || {},
    recommendations,
    next_action: nextAction,
  };
}

function resolveOfficialTrailerClipRefsForProof({
  storyId,
  frameReport = null,
  segmentValidationReport = null,
  useOfficialTrailerClips = false,
  allowUnvalidatedOfficialClips = false,
  targetRuntimeS = 66,
} = {}) {
  if (!useOfficialTrailerClips) {
    return {
      clipRefs: [],
      footageBackboneReport: null,
      safety: {
        status: "disabled",
        reason: "official trailer clips were not requested",
      },
    };
  }

  if (!frameReport) {
    return {
      clipRefs: [],
      footageBackboneReport: null,
      safety: {
        status: "blocked_missing_frame_report",
        reason: "official trailer clips require a local frame extraction report",
      },
    };
  }

  if (segmentValidationReport) {
    const footageBackboneReport = buildFlashLaneFootageBackboneReport({
      storyId,
      frameReport,
      segmentValidationReport,
      targetRuntimeS,
    });
    const clipRefs = footageBackboneReport.validated_clip_refs || [];
    if (footageBackboneReport.verdict !== "ready_for_flash_render_preflight" || clipRefs.length === 0) {
      return {
        clipRefs: [],
        footageBackboneReport,
        safety: {
          status: "blocked_footage_backbone_not_ready",
          reason:
            "official trailer clips require a ready gameplay/action footage backbone before proof render use",
          ...buildBackboneSafetyDetails(footageBackboneReport),
        },
      };
    }
    return {
      clipRefs,
      footageBackboneReport,
      safety: {
        status: "validated_segments_only",
        reason: "official trailer clips were backed by segment validation",
      },
    };
  }

  if (!allowUnvalidatedOfficialClips) {
    return {
      clipRefs: [],
      footageBackboneReport: null,
      safety: {
        status: "blocked_missing_segment_validation",
        reason:
          "official trailer clips require segment validation; run media:validate-trailer-segments or pass an explicit diagnostic override",
      },
    };
  }

  return {
    clipRefs: buildOfficialTrailerClipsFromFrameReport(frameReport, storyId, {
      maxClips: 8,
      maxCandidateWindowsPerSource: 3,
      includeFrameAnchoredWindows: true,
    }),
    footageBackboneReport: null,
    safety: {
      status: "unvalidated_diagnostic_only",
      reason:
        "unvalidated official trailer clips were allowed only for an explicit local diagnostic render",
    },
  };
}

module.exports = {
  resolveOfficialTrailerClipRefsForProof,
};
