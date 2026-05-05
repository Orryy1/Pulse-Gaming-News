"use strict";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function nonVoicePreflightBlockers(renderPreflight) {
  return asArray(renderPreflight?.blockers).filter(
    (blocker) => blocker !== "unapproved_local_tts_voice_path",
  );
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function evaluateStillDeckRenderReadiness({
  baselineSummary = {},
  enrichedSummary = {},
  enrichedMetrics = {},
} = {}) {
  const acceptedStills = safeNumber(enrichedMetrics.acceptedCount);
  const acceptedFrames = safeNumber(enrichedMetrics.acceptedFrameCount);
  const acceptedOfficialClips = safeNumber(enrichedMetrics.acceptedOfficialClipRefs);
  const visualCount = acceptedStills + acceptedFrames;
  const hasMotionBackbone = acceptedFrames >= 2 || acceptedOfficialClips > 0;
  const baselineSources = safeNumber(baselineSummary.topicalSources);
  const enrichedSources = safeNumber(enrichedSummary.topicalSources);
  const baselineMix = safeNumber(baselineSummary.sourceMixScore);
  const enrichedMix = safeNumber(enrichedSummary.sourceMixScore);
  const blockers = [];
  const warnings = [];

  if (!hasMotionBackbone && visualCount < 4) {
    blockers.push("still_deck_too_thin_for_render");
  }
  if (!hasMotionBackbone && baselineMix > 0 && enrichedMix < baselineMix) {
    blockers.push("still_deck_degrades_source_diversity");
  }
  if (!hasMotionBackbone && baselineSources > 0 && enrichedSources < baselineSources) {
    blockers.push("still_deck_loses_visual_coverage");
  }
  if (acceptedOfficialClips <= 0 && acceptedFrames <= 0) {
    warnings.push("still_deck_has_no_motion_backbone");
  }

  return {
    verdict: blockers.length ? "block" : "pass",
    blockers,
    warnings,
    metrics: {
      acceptedStills,
      acceptedFrames,
      acceptedOfficialClips,
      visualCount,
      hasMotionBackbone,
      baselineSources,
      enrichedSources,
      baselineMix,
      enrichedMix,
    },
  };
}

function recommendStudioV2Promotion({
  renderPreflightBlocked,
  renderPreflight,
  renderAttempted,
  enrichedVoiceGate,
  renderRejected,
  visualImproved,
} = {}) {
  if (renderPreflightBlocked) {
    const visualBlockers = nonVoicePreflightBlockers(renderPreflight);
    const hasVoiceBlocker = asArray(renderPreflight?.blockers).includes(
      "unapproved_local_tts_voice_path",
    );
    if (visualBlockers.length > 0) {
      return `do not render again until Flash Lane visual blockers are fixed: ${visualBlockers.join(", ")}`;
    }
    if (hasVoiceBlocker) {
      return "use approved Flash Lane narration before render; visual preflight is otherwise clear";
    }
    return "do not render again until Flash Lane preflight blockers are fixed";
  }
  if (!renderAttempted) {
    return "render before promotion; this package alone is not a pilot proof";
  }
  if (enrichedVoiceGate === "red") {
    return "do not promote; fix local voice or use approved production voice before another pilot";
  }
  if (renderRejected) {
    return "do not promote; fix render QA blockers before another pilot";
  }
  return visualImproved
    ? "keep local-only and test Studio V2 with enriched still decks on more stories"
    : "wait for richer stills or trailer-frame enrichment before promotion";
}

module.exports = {
  evaluateStillDeckRenderReadiness,
  nonVoicePreflightBlockers,
  recommendStudioV2Promotion,
};
