"use strict";

const PULSE_SIGNATURE_VERSION = "pulse_signal_editorial_v1";

const SEGMENTS = [
  { label: "BREAKING PULSE", pattern: /\bbreaking\b|just (?:dropped|revealed|announced)|shadow[- ]?drop|urgent/i },
  { label: "TRAILER TRUTH", pattern: /\btrailer\b|gameplay|footage|reveal|showcase/i },
  { label: "PATCH PULSE", pattern: /\bpatch\b|update|season|dlc|hotfix|nerf|buff/i },
  { label: "WISHLIST CHECK", pattern: /\bdemo\b|release date|launch|wishlist|preorder|price|deal|free/i },
  { label: "PLATFORM PULSE", pattern: /\bxbox\b|game pass|playstation|ps5|nintendo|switch|steam|pc\b/i },
];

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function storyText(story = {}) {
  return [
    story.segment_label,
    story.classification,
    story.canonical_subject,
    story.canonical_game,
    story.canonical_angle,
    story.title,
    story.selected_title,
    story.thumbnail_headline,
  ].map(cleanText).filter(Boolean).join(" ");
}

function resolvePulseSegment(story = {}) {
  const explicit = cleanText(story.pulse_segment_label || story.segment_label);
  if (explicit) return explicit.toUpperCase();
  const text = storyText(story);
  return SEGMENTS.find((segment) => segment.pattern.test(text))?.label || "PULSE BRIEF";
}

function displaySegmentLabel(label) {
  const compact = cleanText(label)
    .replace(/^PULSE\s+/i, "")
    .replace(/\s+PULSE$/i, "")
    .toUpperCase();
  return `PULSE // ${compact || "BRIEF"}`;
}

function round(value) {
  return Number(Number(value || 0).toFixed(2));
}

function buildPulseSignatureContract({ story = {}, durationS = 0 } = {}) {
  const duration = Math.max(0, Number(durationS) || 0);
  const outroDuration = Math.min(2.8, duration);
  const segmentLabel = resolvePulseSegment(story);
  const segmentDisplayLabel = displaySegmentLabel(segmentLabel);
  const chipWidth = Math.max(250, Math.min(320, 38 + segmentDisplayLabel.length * 10));
  const chipX = 90;
  const sourceX = chipX + chipWidth + 24;
  return {
    version: PULSE_SIGNATURE_VERSION,
    segment: {
      label: segmentLabel,
      display_label: segmentDisplayLabel,
      placement: "opening_identity_chip",
    },
    opening: {
      start_s: 0,
      duration_s: 1.6,
      end_s: Math.min(1.6, round(duration)),
      rule: "identity lands with the hook and never delays narration",
      layout: {
        chip_x_px: chipX,
        chip_width_px: chipWidth,
        source_x_px: sourceX,
        source_width_px: Math.max(220, 1010 - sourceX),
      },
    },
    persistent_mark: {
      label: "PULSE // GAMING",
      placement: "lower_right_safe_zone",
      opacity: 0.92,
    },
    proof_label: "KEY SIGNAL",
    impact_label: "WHY IT MATTERS",
    outro: {
      start_s: round(Math.max(0, duration - outroDuration)),
      end_s: round(duration),
      duration_s: round(outroDuration),
      brand_line: "PULSE GAMING",
      catch_line: "NEVER MISS A BEAT",
    },
    palette: {
      pulse_amber: "0xFF6B1A",
      signal_ice: "0xBEEBFF",
      signal_cyan: "0x38BDF8",
      ink: "0x0D0D0F",
      paper: "0xF0F0F0",
    },
    typography: {
      display: "Bahnschrift",
      metadata: "Consolas",
    },
    motion: {
      opening: "signal_snap",
      persistent: "dual_rail_pulse",
      proof: "source_lock_wipe",
      outro: "cta_beat_lockup",
    },
  };
}

module.exports = {
  PULSE_SIGNATURE_VERSION,
  buildPulseSignatureContract,
  displaySegmentLabel,
  resolvePulseSegment,
};
