"use strict";

const PULSE_VISUAL_EDITORIAL_POLICY = Object.freeze({
  version: "pulse_visual_editorial_policy_v1",
  mode: "gameplay_first_animated_news_hybrid",
  benchmark_reference: "pulse_xbox_four_game_pass_games_video",
  authentic_game_media_is_default_backbone: true,
  target_authentic_motion_ratio: 0.72,
  minimum_authentic_motion_ratio_when_available: 0.6,
  maximum_context_card_duration_ratio: 0.25,
  maximum_generic_abstract_visual_ratio_when_relevant_game_media_exists: 0.08,
  preferred_motion_scene_count: 10,
  minimum_motion_scene_count: 8,
  source_audio_policy: "remove_or_replace",
  generic_ai_or_abstract_visuals_when_relevant_game_media_exists: "fallback_only",
  animated_context_is_required: true,
  animation_rule: "clarify_or_intensify_story_beat",
  decorative_motion_without_story_function: "forbidden",
  platform_story_theme_required: true,
  pulse_brand_boundary_required: true,
  supported_platform_visual_languages: Object.freeze([
    "xbox",
    "playstation",
    "nintendo",
    "steam",
    "multi_platform",
    "neutral",
  ]),
  required_animated_element_families: Object.freeze([
    "kinetic_headline",
    "game_count_reveal",
    "achievement_or_feature_pop",
    "timeline",
    "comparison_panel",
    "source_lock",
    "stat_or_price_count_up",
    "platform_signal_transition",
  ]),
  preferred_optional_element_families: Object.freeze([
    "animated_map",
    "release_calendar",
    "before_after_panel",
    "rank_or_score_meter",
    "quote_reveal",
    "player_impact_callout",
  ]),
  edit_rules: Object.freeze({
    open_on_story_specific_motion_or_animated_proof: true,
    first_attention_reset_deadline_s: 2.5,
    maximum_seconds_without_visual_change: 3.8,
    cards_overlay_gameplay_when_readable: true,
    adjacent_fullscreen_cards_forbidden: true,
    source_lock_is_provenance_not_narrative: true,
    gameplay_clips_must_be_story_specific: true,
    irrelevant_eye_candy_forbidden: true,
  }),
  platform_theme_rules: Object.freeze({
    preserve_pulse_amber_signature: true,
    preserve_pulse_wordmark: true,
    official_platform_logo_as_pulse_identity: false,
    official_account_impersonation_forbidden: true,
    platform_colour_and_motion_language_as_context: true,
  }),
});

function clamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function resolvePulseVisualEditorialPolicy(story = {}) {
  const override =
    story.visual_editorial_policy ||
    story.visualEditorialPolicy ||
    story.channel_visual_editorial_policy ||
    {};
  const targetAuthenticMotionRatio = clamp(
    override.target_authentic_motion_ratio,
    PULSE_VISUAL_EDITORIAL_POLICY.minimum_authentic_motion_ratio_when_available,
    0.9,
    PULSE_VISUAL_EDITORIAL_POLICY.target_authentic_motion_ratio,
  );
  const preferredMotionSceneCount = Math.round(
    clamp(
      override.preferred_motion_scene_count,
      PULSE_VISUAL_EDITORIAL_POLICY.minimum_motion_scene_count,
      16,
      PULSE_VISUAL_EDITORIAL_POLICY.preferred_motion_scene_count,
    ),
  );

  return {
    ...PULSE_VISUAL_EDITORIAL_POLICY,
    ...override,
    target_authentic_motion_ratio: targetAuthenticMotionRatio,
    preferred_motion_scene_count: preferredMotionSceneCount,
    maximum_context_card_duration_ratio: Math.min(
      PULSE_VISUAL_EDITORIAL_POLICY.maximum_context_card_duration_ratio,
      clamp(
        override.maximum_context_card_duration_ratio,
        0.1,
        PULSE_VISUAL_EDITORIAL_POLICY.maximum_context_card_duration_ratio,
        PULSE_VISUAL_EDITORIAL_POLICY.maximum_context_card_duration_ratio,
      ),
    ),
    supported_platform_visual_languages: [
      ...PULSE_VISUAL_EDITORIAL_POLICY.supported_platform_visual_languages,
    ],
    required_animated_element_families: [
      ...PULSE_VISUAL_EDITORIAL_POLICY.required_animated_element_families,
    ],
    preferred_optional_element_families: [
      ...PULSE_VISUAL_EDITORIAL_POLICY.preferred_optional_element_families,
    ],
    edit_rules: {
      ...PULSE_VISUAL_EDITORIAL_POLICY.edit_rules,
      ...(override.edit_rules || {}),
    },
    platform_theme_rules: {
      ...PULSE_VISUAL_EDITORIAL_POLICY.platform_theme_rules,
      ...(override.platform_theme_rules || {}),
    },
  };
}

module.exports = {
  PULSE_VISUAL_EDITORIAL_POLICY,
  resolvePulseVisualEditorialPolicy,
};
