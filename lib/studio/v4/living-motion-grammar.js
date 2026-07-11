"use strict";

const { resolveContentIdentity } = require("../../content-identity-system");

const LIVING_MOTION_VERSION = "pulse_living_motion_v1";

const TREATMENTS = Object.freeze({
  breaking_alert: { ghost: "BREAKING", bg: 0.34, fgX: 22, fgY: 14, rate: 0.34, sweep: 500 },
  leak_file: { ghost: "LEAK FILE", bg: 0.30, fgX: 18, fgY: 12, rate: 0.27, sweep: 410 },
  rumour_watch: { ghost: "RUMOUR", bg: 0.24, fgX: 14, fgY: 10, rate: 0.20, sweep: 330 },
  confirmed_drop: { ghost: "CONFIRMED", bg: 0.28, fgX: 16, fgY: 10, rate: 0.24, sweep: 390 },
  major_reveal: { ghost: "REVEAL", bg: 0.38, fgX: 24, fgY: 16, rate: 0.30, sweep: 470 },
  game_update: { ghost: "PATCH", bg: 0.29, fgX: 17, fgY: 11, rate: 0.25, sweep: 420 },
  review_verdict: { ghost: "VERDICT", bg: 0.26, fgX: 14, fgY: 9, rate: 0.22, sweep: 360 },
  release_radar: { ghost: "RELEASE", bg: 0.33, fgX: 20, fgY: 13, rate: 0.29, sweep: 450 },
  deal_drop: { ghost: "DEAL DROP", bg: 0.32, fgX: 20, fgY: 12, rate: 0.31, sweep: 480 },
  industry_watch: { ghost: "INDUSTRY", bg: 0.20, fgX: 10, fgY: 8, rate: 0.18, sweep: 300 },
  community_debate: { ghost: "DEBATE", bg: 0.31, fgX: 19, fgY: 12, rate: 0.28, sweep: 440 },
  evergreen_guide: { ghost: "GUIDE", bg: 0.18, fgX: 8, fgY: 6, rate: 0.16, sweep: 280 },
});

function resolveLivingMotionGrammar(story = {}) {
  const identity = resolveContentIdentity(story);
  const treatment = TREATMENTS[identity.id] || TREATMENTS.confirmed_drop;
  const energy = Number(identity.audio?.mix?.energy || 0.6);

  return Object.freeze({
    version: LIVING_MOTION_VERSION,
    identity_id: identity.id,
    accent: identity.brand.accent,
    ghost_word: treatment.ghost,
    depth: Object.freeze({
      background_drift_ratio: treatment.bg,
      background_rate_x: Number(treatment.rate.toFixed(2)),
      background_rate_y: Number((treatment.rate * 0.74).toFixed(2)),
      foreground_drift_x_px: treatment.fgX,
      foreground_drift_y_px: treatment.fgY,
      foreground_rate_x: Number((treatment.rate * 2.2).toFixed(2)),
      foreground_rate_y: Number((treatment.rate * 1.7).toFixed(2)),
    }),
    editorial: Object.freeze({
      ghost_opacity: Number((0.045 + energy * 0.045).toFixed(3)),
      ghost_font_size_px: Math.round(160 + energy * 50),
      ghost_y_px: 1288,
      ghost_drift_x_px: Math.round(12 + energy * 10),
      ghost_rate: Number((0.11 + energy * 0.08).toFixed(2)),
    }),
    sweeps: Object.freeze({
      primary_speed_px_s: treatment.sweep,
      primary_opacity: Number((0.035 + energy * 0.025).toFixed(3)),
      accent_speed_px_s: Math.round(treatment.sweep * 0.68),
      accent_opacity: Number((0.028 + energy * 0.025).toFixed(3)),
    }),
    motion_continuity: Object.freeze({
      seek_safe: true,
      caption_priority: true,
      persistent_micro_motion: true,
      max_static_hold_s: 0,
    }),
  });
}

module.exports = {
  LIVING_MOTION_VERSION,
  TREATMENTS,
  resolveLivingMotionGrammar,
};
