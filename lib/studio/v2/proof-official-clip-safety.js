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

function clipRefSourceKey(ref) {
  return String(ref?.path || ref?.source_url || ref?.sourceUrl || "").trim();
}

function clipRefStart(ref) {
  const start = Number(ref?.mediaStartS ?? ref?.media_start_s);
  return Number.isFinite(start) ? start : null;
}

function clipRefScore(ref) {
  const action = Number(ref?.provenance?.segment_action_score ?? ref?.action_score);
  if (Number.isFinite(action)) return action;
  const quality = Number(ref?.provenance?.segment_quality_score ?? ref?.segment_quality_score);
  return Number.isFinite(quality) ? quality : 0;
}

function selectNonOverlappingRefsForSource(refs, { maxPerSource, minStartGapS }) {
  const ordered = asArray(refs)
    .slice()
    .sort((a, b) => {
      const scoreDelta = clipRefScore(b) - clipRefScore(a);
      if (Math.abs(scoreDelta) > 0.001) return scoreDelta;
      return Number(clipRefStart(a) ?? 0) - Number(clipRefStart(b) ?? 0);
    });
  const selected = [];
  const filtered = [];
  for (const ref of ordered) {
    const start = clipRefStart(ref);
    const overlaps = Number.isFinite(start)
      ? selected.some((kept) => {
          const keptStart = clipRefStart(kept);
          return Number.isFinite(keptStart) && Math.abs(start - keptStart) < minStartGapS;
        })
      : false;
    if (overlaps || selected.length >= maxPerSource) {
      filtered.push({
        source: clipRefSourceKey(ref) || null,
        mediaStartS: start,
        reason: overlaps ? "overlapping_visual_window" : "source_render_cap",
      });
      continue;
    }
    selected.push(ref);
  }
  selected.sort((a, b) => Number(clipRefStart(a) ?? 0) - Number(clipRefStart(b) ?? 0));
  return { selected, filtered };
}

function selectRenderSafeOfficialClipRefs(clipRefs, opts = {}) {
  const refs = asArray(clipRefs);
  if (refs.length === 0) {
    return { clipRefs: [], filtered: [], sourceCount: 0 };
  }
  const maxPerSource = Math.max(1, Number(opts.maxPerSource || 4));
  const minStartGapS = Math.max(0, Number(opts.minStartGapS ?? 4));
  const maxRefs = Math.max(1, Number(opts.maxRefs || refs.length));
  const groups = new Map();
  for (const ref of refs) {
    const source = clipRefSourceKey(ref) || "unknown";
    if (!groups.has(source)) groups.set(source, []);
    groups.get(source).push(ref);
  }

  const filtered = [];
  const perSource = [...groups.entries()]
    .map(([source, sourceRefs]) => {
      const result = selectNonOverlappingRefsForSource(sourceRefs, {
        maxPerSource,
        minStartGapS,
      });
      filtered.push(...result.filtered);
      return {
        source,
        refs: result.selected,
        bestScore: Math.max(0, ...result.selected.map(clipRefScore)),
      };
    })
    .filter((group) => group.refs.length > 0)
    .sort((a, b) => b.bestScore - a.bestScore);

  const balanced = [];
  let madeProgress = true;
  while (balanced.length < maxRefs && madeProgress) {
    madeProgress = false;
    for (const group of perSource) {
      if (balanced.length >= maxRefs) break;
      const next = group.refs.shift();
      if (!next) continue;
      balanced.push(next);
      madeProgress = true;
    }
  }

  return {
    clipRefs: balanced,
    filtered,
    sourceCount: perSource.length,
  };
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
    const renderSafe = selectRenderSafeOfficialClipRefs(clipRefs);
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
      clipRefs: renderSafe.clipRefs,
      allClipRefs: clipRefs,
      footageBackboneReport,
      safety: {
        status: "validated_segments_only",
        reason: "official trailer clips were backed by segment validation",
        render_safe_clip_refs: renderSafe.clipRefs.length,
        render_safe_filtered_refs: renderSafe.filtered.length,
        render_safe_filtered: renderSafe.filtered,
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
  selectRenderSafeOfficialClipRefs,
};
