"use strict";

const {
  buildFlashLaneFootageBackboneReport,
} = require("./flash-lane-footage-backbone");
const {
  buildOfficialTrailerClipsFromFrameReport,
} = require("./official-trailer-clip-refs");

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
    return {
      clipRefs: footageBackboneReport.validated_clip_refs || [],
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
