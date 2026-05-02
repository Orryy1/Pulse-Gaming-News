"use strict";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function nonVoicePreflightBlockers(renderPreflight) {
  return asArray(renderPreflight?.blockers).filter(
    (blocker) => blocker !== "unapproved_local_tts_voice_path",
  );
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
  nonVoicePreflightBlockers,
  recommendStudioV2Promotion,
};
