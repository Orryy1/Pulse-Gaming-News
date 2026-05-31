"use strict";

const STUDIO_V4_SFX_MIX_POLICY_VERSION = "source_lock_news_tick_v6";
const STUDIO_V4_VOICE_MIX_POLICY_VERSION = "local_voice_levelled_v2";
const STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION = "newsroom_safe_vertical_compose_v6";

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function policyVersionBlockers(renderManifest = {}) {
  const blockers = [];
  if (cleanText(renderManifest.sfx_mix_policy_version) !== STUDIO_V4_SFX_MIX_POLICY_VERSION) {
    blockers.push("sfx_mix_policy_stale");
  }
  if (cleanText(renderManifest.voice_mix_policy_version) !== STUDIO_V4_VOICE_MIX_POLICY_VERSION) {
    blockers.push("voice_mix_policy_stale");
  }
  if (cleanText(renderManifest.visual_design_policy_version) !== STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION) {
    blockers.push("visual_design_policy_stale");
  }
  return blockers;
}

function currentRenderPolicyManifest() {
  return {
    sfx_mix_policy_version: STUDIO_V4_SFX_MIX_POLICY_VERSION,
    voice_mix_policy_version: STUDIO_V4_VOICE_MIX_POLICY_VERSION,
    visual_design_policy_version: STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION,
  };
}

module.exports = {
  STUDIO_V4_SFX_MIX_POLICY_VERSION,
  STUDIO_V4_VOICE_MIX_POLICY_VERSION,
  STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION,
  currentRenderPolicyManifest,
  policyVersionBlockers,
};
