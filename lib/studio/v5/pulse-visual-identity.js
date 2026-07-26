"use strict";

const CREATIVE_SYSTEM_VERSION = "pulse_visual_identity_v5";
const PLATFORM_VISUAL_LANGUAGE_VERSION = "pulse_platform_visual_language_v1";

const PLATFORM_VISUAL_LANGUAGES = Object.freeze({
  neutral: Object.freeze({
    id: "neutral",
    label: "PULSE",
    accent: "#ff6b1a",
    highlight: "#43d7ff",
    deep: "#07090d",
    motif: "pulse_signal_matrix",
    motion_signature: "signal_trace",
    card_shape: "broadcast_cut_corner",
    use_official_platform_logo: false,
    animated_elements: Object.freeze([
      "kinetic_headline",
      "source_lock",
      "count_up_metric",
      "timeline",
      "comparison_panel",
      "signal_sweep",
    ]),
  }),
  multi_platform: Object.freeze({
    id: "multi_platform",
    label: "MULTI-PLATFORM",
    accent: "#ff6b1a",
    highlight: "#43d7ff",
    deep: "#07090d",
    motif: "cross_platform_signal_matrix",
    motion_signature: "interlocking_signal_tiles",
    card_shape: "modular_split_panel",
    use_official_platform_logo: false,
    animated_elements: Object.freeze([
      "platform_split_reveal",
      "kinetic_headline",
      "source_lock",
      "comparison_panel",
      "availability_timeline",
      "cross_platform_signal_sweep",
    ]),
  }),
  xbox: Object.freeze({
    id: "xbox",
    label: "XBOX",
    accent: "#107c10",
    highlight: "#9bf00b",
    deep: "#071807",
    motif: "achievement_orbit_grid",
    motion_signature: "achievement_pop_and_tile_snap",
    card_shape: "square_tile_with_orbital_nodes",
    use_official_platform_logo: false,
    animated_elements: Object.freeze([
      "achievement_pop",
      "game_pass_count_reveal",
      "orbital_node_grid",
      "availability_timeline",
      "price_comparison_tile",
      "green_signal_sweep",
      "source_lock",
      "kinetic_headline",
    ]),
  }),
  playstation: Object.freeze({
    id: "playstation",
    label: "PLAYSTATION",
    accent: "#0070d1",
    highlight: "#ffffff",
    deep: "#06152d",
    motif: "console_ribbon_geometry",
    motion_signature: "ribbon_slice_and_console_focus",
    card_shape: "angled_console_panel",
    use_official_platform_logo: false,
    animated_elements: Object.freeze([
      "console_ribbon_reveal",
      "blue_depth_planes",
      "feature_comparison_panel",
      "release_window_timeline",
      "performance_metric_pop",
      "white_light_sweep",
      "source_lock",
      "kinetic_headline",
    ]),
  }),
  nintendo: Object.freeze({
    id: "nintendo",
    label: "NINTENDO",
    accent: "#e60012",
    highlight: "#ffffff",
    deep: "#2a0509",
    motif: "playful_modular_tiles",
    motion_signature: "spring_tile_and_cartridge_snap",
    card_shape: "rounded_modular_panel",
    use_official_platform_logo: false,
    animated_elements: Object.freeze([
      "spring_tile_reveal",
      "cartridge_card_snap",
      "game_count_stepper",
      "release_date_flip",
      "feature_badge_pop",
      "red_signal_wipe",
      "source_lock",
      "kinetic_headline",
    ]),
  }),
  steam: Object.freeze({
    id: "steam",
    label: "STEAM",
    accent: "#66c0f4",
    highlight: "#c7d5e0",
    deep: "#171a21",
    motif: "storefront_data_orbit",
    motion_signature: "data_orbit_and_chart_trace",
    card_shape: "technical_storefront_panel",
    use_official_platform_logo: false,
    animated_elements: Object.freeze([
      "concurrent_player_count_up",
      "storefront_data_orbit",
      "price_history_snap",
      "review_score_meter",
      "platform_chart_trace",
      "cyan_scan_line",
      "source_lock",
      "kinetic_headline",
    ]),
  }),
});

const PLATFORM_PATTERNS = Object.freeze({
  xbox:
    /\b(?:xbox(?:\s+(?:one|series\s+[xs]))?|game\s*pass|microsoft\s+gaming|xcloud)\b/i,
  playstation:
    /\b(?:playstation|ps[45](?:\s+pro)?|ps\s*plus|sony\s+interactive\s+entertainment)\b/i,
  nintendo:
    /\b(?:nintendo|switch(?:\s*2)?|eshop)\b/i,
  steam:
    /\b(?:steam(?:db|works|deck)?|valve\s+storefront)\b/i,
});

const IDENTITIES = Object.freeze({
  breaking: Object.freeze({
    category: "breaking",
    label: "BREAKING PULSE",
    segment_name: "Breaking Pulse",
    code: "PG/BRK",
    palette_id: "alert_cyan",
    primary: "#ff3b30",
    secondary: "#22d3ee",
    transition_family: "signal_slam",
    transition_cycle: Object.freeze(["fadeblack", "smoothleft", "wipeup", "fade"]),
    motion_mode: "shock_cut",
  }),
  reveal: Object.freeze({
    category: "reveal",
    label: "TRAILER TRUTH",
    segment_name: "Trailer Truth Check",
    code: "PG/RVL",
    palette_id: "amber_cyan",
    primary: "#ff6b1a",
    secondary: "#14d9ff",
    transition_family: "aperture_wipe",
    transition_cycle: Object.freeze(["circleopen", "smoothleft", "revealup", "fade"]),
    motion_mode: "prism_reveal",
  }),
  update: Object.freeze({
    category: "update",
    label: "UPDATE",
    segment_name: "Patch Notes That Matter",
    code: "PG/UPD",
    palette_id: "green_gold",
    primary: "#45e06f",
    secondary: "#f7c948",
    transition_family: "data_sweep",
    transition_cycle: Object.freeze(["smoothup", "slideleft", "wipeleft", "fade"]),
    motion_mode: "scan_up",
  }),
  rumour: Object.freeze({
    category: "rumour",
    label: "RUMOUR WATCH",
    segment_name: "Rumour Watch",
    code: "PG/RMR",
    palette_id: "magenta_cyan",
    primary: "#df68ff",
    secondary: "#32d9ff",
    transition_family: "signal_scramble",
    transition_cycle: Object.freeze(["dissolve", "smoothright", "hblur", "fade"]),
    motion_mode: "interference",
  }),
  review: Object.freeze({
    category: "review",
    label: "VERDICT",
    segment_name: "Worth Your Wishlist?",
    code: "PG/RVW",
    palette_id: "blue_amber",
    primary: "#2f80ed",
    secondary: "#ffb020",
    transition_family: "score_slice",
    transition_cycle: Object.freeze(["wipeleft", "smoothup", "slideleft", "fade"]),
    motion_mode: "score_pulse",
  }),
  deal: Object.freeze({
    category: "deal",
    label: "PLAYER VALUE",
    segment_name: "Worth Your Wishlist?",
    code: "PG/DAL",
    palette_id: "lime_orange",
    primary: "#b9f227",
    secondary: "#ff9f1c",
    transition_family: "ticket_swipe",
    transition_cycle: Object.freeze(["slideleft", "wipeup", "smoothleft", "fade"]),
    motion_mode: "price_snap",
  }),
  release: Object.freeze({
    category: "release",
    label: "RELEASE RADAR",
    segment_name: "Release Radar",
    code: "PG/RLS",
    palette_id: "orange_teal",
    primary: "#ff8a3d",
    secondary: "#35e0c1",
    transition_family: "date_flip",
    transition_cycle: Object.freeze(["revealleft", "slideup", "smoothleft", "fade"]),
    motion_mode: "countdown",
  }),
  industry: Object.freeze({
    category: "industry",
    label: "INDUSTRY PULSE",
    segment_name: "Industry Pulse",
    code: "PG/IND",
    palette_id: "violet_amber",
    primary: "#9b7cff",
    secondary: "#ffb347",
    transition_family: "ledger_wipe",
    transition_cycle: Object.freeze(["fade", "smoothleft", "wipeleft", "smoothup"]),
    motion_mode: "signal_trace",
  }),
  news: Object.freeze({
    category: "news",
    label: "PULSE BRIEF",
    segment_name: "Pulse Brief",
    code: "PG/NWS",
    palette_id: "amber_ice",
    primary: "#ff6b1a",
    secondary: "#43d7ff",
    transition_family: "pulse_wipe",
    transition_cycle: Object.freeze(["smoothleft", "fade", "smoothup", "wipeleft"]),
    motion_mode: "kinetic_brief",
  }),
});

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function platformIdsInText(value) {
  const text = cleanText(value);
  if (!text) return [];
  return Object.entries(PLATFORM_PATTERNS)
    .filter(([, pattern]) => pattern.test(text))
    .map(([id]) => id);
}

function explicitPlatformValues(story = {}) {
  const values = [
    story.platform,
    story.platform_name,
    story.platformName,
    story.platform_context,
    story.platformContext,
    ...((Array.isArray(story.platforms) && story.platforms) || []),
    ...((Array.isArray(story.target_platforms) && story.target_platforms) || []),
  ];
  return values.map(cleanText).filter(Boolean);
}

function platformLanguage(id, {
  confidence = "none",
  evidence = [],
  scores = {},
} = {}) {
  const base = PLATFORM_VISUAL_LANGUAGES[id] || PLATFORM_VISUAL_LANGUAGES.neutral;
  return {
    ...base,
    animated_elements: [...base.animated_elements],
    version: PLATFORM_VISUAL_LANGUAGE_VERSION,
    confidence,
    evidence: [...new Set(evidence.map(cleanText).filter(Boolean))],
    scores: { ...scores },
  };
}

function detectPlatformVisualLanguage(story = {}) {
  const explicitValues = explicitPlatformValues(story);
  const explicitIds = [
    ...new Set(explicitValues.flatMap((value) => platformIdsInText(value))),
  ];
  if (explicitIds.length > 1) {
    return platformLanguage("multi_platform", {
      confidence: "explicit_multi_platform",
      evidence: explicitValues,
    });
  }
  if (explicitIds.length === 1) {
    return platformLanguage(explicitIds[0], {
      confidence: "explicit_platform",
      evidence: explicitValues,
    });
  }

  const weightedFields = [
    [story.title, 6, "title"],
    [story.suggested_title, 5, "suggested_title"],
    [story.hook, 4, "hook"],
    [story.canonical_subject, 4, "canonical_subject"],
    [story.source_name, 5, "source_name"],
    [story.source, 4, "source"],
    [story.subreddit, 3, "subreddit"],
    [story.body, 2, "body"],
    [story.full_script, 2, "full_script"],
    [story.narration_script, 2, "narration_script"],
    [story.description, 1, "description"],
  ];
  const scores = Object.fromEntries(
    Object.keys(PLATFORM_PATTERNS).map((id) => [id, 0]),
  );
  const evidence = {};
  for (const [value, weight, field] of weightedFields) {
    for (const id of platformIdsInText(value)) {
      scores[id] += weight;
      evidence[id] = evidence[id] || [];
      evidence[id].push(field);
    }
  }

  const ranked = Object.entries(scores)
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!ranked.length) {
    return platformLanguage("neutral", {
      confidence: "no_platform_signal",
      scores,
    });
  }

  const [topId, topScore] = ranked[0];
  const [secondId, secondScore] = ranked[1] || ["", 0];
  const bothHeadlineStrength =
    topScore >= 5 &&
    secondScore >= 5 &&
    secondScore >= topScore * 0.8;
  if (bothHeadlineStrength) {
    return platformLanguage("multi_platform", {
      confidence: "balanced_multi_platform_signals",
      evidence: [
        ...(evidence[topId] || []).map((field) => `${topId}:${field}`),
        ...(evidence[secondId] || []).map((field) => `${secondId}:${field}`),
      ],
      scores,
    });
  }

  return platformLanguage(topId, {
    confidence: topScore >= 6 ? "strong_story_signal" : "story_signal",
    evidence: (evidence[topId] || []).map((field) => `${topId}:${field}`),
    scores,
  });
}

function storySearchText(story = {}) {
  return [
    story.creative_category,
    story.category,
    story.content_pillar,
    story.flair,
    story.title,
    story.hook,
    story.body,
    story.full_script,
    story.canonical_subject,
  ].map(cleanText).filter(Boolean).join(" ").toLowerCase();
}

function explicitCategory(story = {}) {
  const candidate = cleanText(story.creative_category || story.visual_category)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return IDENTITIES[candidate] ? candidate : "";
}

function classifyPulseStory(story = {}) {
  const explicit = explicitCategory(story);
  if (explicit) return explicit;
  const text = storySearchText(story);
  const breakingScore = Number(story.breaking_score || story.breakingScore || 0);

  if (breakingScore >= 88 || /\bbreaking\b/.test(text)) return "breaking";
  if (/\b(?:rumou?r|leak(?:ed)?|reportedly|alleged|claimed)\b/.test(text)) return "rumour";
  if (/\b(?:review|metacritic|opencritic|critic score|review score|verdict)\b/.test(text)) return "review";
  if (/\b(?:deal|discount|sale|price cut|free this week|game pass|playstation plus|subscription)\b/.test(text)) return "deal";
  if (/\b(?:update|patch|hotfix|season|expansion|dlc|roadmap)\b/.test(text)) return "update";
  if (/\b(?:trailer|reveal(?:ed)?|announc(?:e|ed|ement)|showcase|first look|gameplay debut)\b/.test(text)) return "reveal";
  if (/\b(?:launch(?:es|ed)?|release(?:s|d)?|release date|coming on|arrives?)\b/.test(text)) return "release";
  if (/\b(?:studio|publisher|layoffs?|jobs?|acquisition|earnings|executive|industry)\b/.test(text)) return "industry";
  return "news";
}

function resolvePulseVisualIdentity(story = {}) {
  const category = classifyPulseStory(story);
  const platformVisualLanguage = detectPlatformVisualLanguage(story);
  return {
    ...IDENTITIES[category],
    version: CREATIVE_SYSTEM_VERSION,
    platform_visual_language: platformVisualLanguage,
    pulse_brand_boundary: {
      pulse_wordmark_retained: true,
      pulse_amber_signature_retained: true,
      platform_theme_is_context_not_identity: true,
      official_platform_logo_required: false,
      official_account_impersonation_forbidden: true,
    },
    background: "#07090d",
    foreground: "#f7f9fc",
    safe_top_px: 252,
    safe_right_px: 56,
    safe_left_px: 56,
    safe_bottom_px: 164,
  };
}

function resolvePulseTransitionCycle(story = {}) {
  const identity = resolvePulseVisualIdentity(story);
  return [...(identity.transition_cycle || IDENTITIES.news.transition_cycle)];
}

function escapeHtml(value) {
  return cleanText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clampDuration(value) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) return 4;
  return Number(Math.max(1.6, Math.min(6.4, duration)).toFixed(2));
}

function creativeStyles(identity, kind) {
  const compactSource = kind === "source";
  const platform =
    identity.platform_visual_language || PLATFORM_VISUAL_LANGUAGES.neutral;
  return `
<style id="pulse-creative-system-styles">
  :root {
    --pulse-primary: ${identity.primary};
    --pulse-secondary: ${identity.secondary};
    --pulse-ink: ${identity.background};
    --pulse-paper: ${identity.foreground};
    --pulse-brand-amber: #ff6b1a;
    --platform-accent: ${platform.accent};
    --platform-highlight: ${platform.highlight};
    --platform-deep: ${platform.deep};
  }
  .backdrop {
    z-index: 0 !important;
    filter: brightness(${compactSource ? "0.62" : "0.68"}) saturate(1.18) contrast(1.12) !important;
    transform: scale(1.08) !important;
  }
  .shade, .vignette {
    z-index: 1 !important;
    opacity: 0.84 !important;
    background:
      linear-gradient(180deg, rgba(7, 9, 13, 0.76) 0%, rgba(7, 9, 13, 0.10) 31%, rgba(7, 9, 13, 0.18) 64%, rgba(7, 9, 13, 0.82) 100%),
      linear-gradient(118deg, color-mix(in srgb, var(--pulse-primary) 24%, transparent), transparent 46%, color-mix(in srgb, var(--pulse-secondary) 18%, transparent));
  }
  .pulse-creative-layer {
    position: absolute;
    inset: 0;
    z-index: 2;
    overflow: hidden;
    pointer-events: none;
  }
  .pulse-depth-layer {
    position: absolute;
    inset: -7%;
    background: url("assets/backdrop.jpg") center / cover no-repeat;
    opacity: 0.16;
    filter: saturate(1.45) contrast(1.18) brightness(0.86);
    mix-blend-mode: screen;
    will-change: transform;
  }
  .pulse-depth-a {
    clip-path: polygon(0 8%, 66% 0, 47% 100%, 0 91%);
  }
  .pulse-depth-b {
    clip-path: polygon(74% 0, 100% 7%, 100% 94%, 52% 100%);
    opacity: 0.12;
    mix-blend-mode: soft-light;
  }
  .pulse-grid {
    position: absolute;
    inset: 0;
    opacity: 0.20;
    background-image:
      linear-gradient(color-mix(in srgb, var(--platform-highlight) 24%, transparent) 1px, transparent 1px),
      linear-gradient(90deg, color-mix(in srgb, var(--platform-accent) 24%, transparent) 1px, transparent 1px);
    background-size: 96px 96px;
    mask-image: linear-gradient(180deg, transparent 4%, black 28%, black 70%, transparent 96%);
  }
  .pulse-light-sweep {
    position: absolute;
    top: -12%;
    bottom: -12%;
    left: -34%;
    width: 28%;
    transform: skewX(-14deg);
    opacity: 0;
    background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--pulse-secondary) 26%, white), transparent);
    mix-blend-mode: screen;
  }
  .pulse-signal-rail {
    position: absolute;
    top: 236px;
    left: 56px;
    right: 56px;
    height: 4px;
    transform-origin: left center;
    background: linear-gradient(90deg, var(--pulse-brand-amber), var(--platform-accent) 52%, var(--platform-highlight) 78%, transparent);
    box-shadow: 0 0 24px color-mix(in srgb, var(--platform-accent) 68%, transparent);
  }
  .pulse-signal-rail::after {
    content: "";
    position: absolute;
    right: 0;
    top: -5px;
    width: 14px;
    height: 14px;
    background: var(--platform-highlight);
    transform: rotate(45deg);
  }
  .pulse-platform-motif {
    position: absolute;
    z-index: 3;
    top: 318px;
    right: 34px;
    width: 280px;
    height: 280px;
    opacity: 0.58;
    transform-origin: 50% 50%;
    pointer-events: none;
    filter: drop-shadow(0 0 22px color-mix(in srgb, var(--platform-accent) 30%, transparent));
  }
  .pulse-platform-node {
    position: absolute;
    display: block;
    border: 2px solid color-mix(in srgb, var(--platform-highlight) 76%, transparent);
    background: color-mix(in srgb, var(--platform-accent) 18%, transparent);
    box-shadow:
      inset 0 0 24px color-mix(in srgb, var(--platform-highlight) 12%, transparent),
      0 0 18px color-mix(in srgb, var(--platform-accent) 26%, transparent);
    will-change: transform, opacity;
  }
  .pulse-platform-node:nth-child(1) { width: 116px; height: 116px; top: 22px; right: 26px; }
  .pulse-platform-node:nth-child(2) { width: 72px; height: 72px; top: 142px; right: 142px; }
  .pulse-platform-node:nth-child(3) { width: 42px; height: 42px; top: 178px; right: 48px; }
  .pulse-platform-node:nth-child(4) { width: 22px; height: 22px; top: 76px; right: 176px; }
  [data-pulse-platform="xbox"] .pulse-platform-node {
    border-radius: 50%;
  }
  [data-pulse-platform="xbox"] .pulse-platform-node:nth-child(1) {
    background:
      radial-gradient(circle at 50% 50%, transparent 0 27%, color-mix(in srgb, var(--platform-highlight) 42%, transparent) 29% 34%, transparent 36%),
      color-mix(in srgb, var(--platform-accent) 20%, transparent);
  }
  [data-pulse-platform="playstation"] .pulse-platform-node {
    border-radius: 5px;
    clip-path: polygon(18% 0, 100% 0, 82% 100%, 0 100%);
  }
  [data-pulse-platform="nintendo"] .pulse-platform-node {
    border-radius: 22px;
    border-width: 4px;
    background: color-mix(in srgb, var(--platform-accent) 44%, white 10%);
  }
  [data-pulse-platform="steam"] .pulse-platform-node {
    border-radius: 50%;
    background: transparent;
    border-style: double;
    border-width: 5px;
  }
  [data-pulse-platform="multi_platform"] .pulse-platform-node {
    border-radius: 8px;
  }
  .pulse-platform-tag {
    position: absolute;
    z-index: 7;
    top: 314px;
    left: 56px;
    padding: 7px 12px 7px 16px;
    color: var(--pulse-paper);
    background: linear-gradient(90deg, color-mix(in srgb, var(--platform-deep) 92%, black), rgba(7, 9, 13, 0.78));
    border-left: 5px solid var(--platform-accent);
    border-bottom: 1px solid color-mix(in srgb, var(--platform-highlight) 44%, transparent);
    font-family: Arial, sans-serif;
    font-size: 17px;
    font-weight: 900;
    line-height: 1;
    letter-spacing: 0.055em;
    text-transform: uppercase;
  }
  .pulse-brand-bug {
    position: absolute;
    z-index: 7;
    top: 252px;
    left: 56px;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 46px;
    padding: 8px 14px 8px 10px;
    color: var(--pulse-paper);
    background: rgba(7, 9, 13, 0.82);
    border: 1px solid color-mix(in srgb, var(--pulse-primary) 62%, white);
    border-left: 6px solid var(--pulse-brand-amber);
    clip-path: polygon(0 0, calc(100% - 13px) 0, 100% 13px, 100% 100%, 0 100%);
    font-family: "Arial Black", Arial, sans-serif;
    font-size: 22px;
    line-height: 1;
    letter-spacing: 0 !important;
    text-transform: uppercase;
  }
  .pulse-mark {
    display: grid;
    grid-template-columns: repeat(3, 5px);
    align-items: end;
    gap: 3px;
    height: 20px;
  }
  .pulse-mark span {
    display: block;
    width: 5px;
    background: var(--pulse-secondary);
  }
  .pulse-mark span:nth-child(1) { height: 8px; }
  .pulse-mark span:nth-child(2) { height: 20px; background: var(--pulse-brand-amber); }
  .pulse-mark span:nth-child(3) { height: 13px; }
  .pulse-wordmark { color: var(--pulse-paper); }
  .pulse-category { color: var(--pulse-secondary); }
  .pulse-story-code {
    position: absolute;
    z-index: 7;
    top: 262px;
    right: 56px;
    max-width: 390px;
    padding: 7px 11px;
    color: rgba(247, 249, 252, 0.84);
    background: rgba(7, 9, 13, 0.68);
    border-right: 3px solid var(--platform-accent);
    font-family: Arial, sans-serif;
    font-size: 18px;
    font-weight: 800;
    line-height: 1.1;
    letter-spacing: 0 !important;
    text-align: right;
    text-transform: uppercase;
  }
  .stage, .live-bug, .accent-bar, .accent-bar-bottom, .frame-top, .frame-bot, .pulse {
    z-index: 5 !important;
  }
  .kicker, .step, .meta-source, .meta-tag, .sub, .micro, .cta, .attribution, .attribution-sub {
    letter-spacing: 0 !important;
  }
  .kicker {
    color: var(--pulse-paper) !important;
    background: rgba(7, 9, 13, 0.70) !important;
    border: 1px solid color-mix(in srgb, var(--platform-accent) 48%, transparent) !important;
    border-left: 5px solid var(--platform-accent) !important;
    padding: 10px 16px !important;
    clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%);
  }
  .sub {
    display: inline-block;
    width: fit-content;
    color: var(--pulse-paper) !important;
    background: rgba(7, 9, 13, 0.86) !important;
    border-left: 4px solid var(--platform-accent) !important;
    padding: 8px 14px !important;
    text-shadow: 0 2px 10px rgba(0, 0, 0, 0.92) !important;
  }
  .micro {
    display: inline-block;
    width: fit-content;
    color: var(--pulse-paper) !important;
    background: rgba(7, 9, 13, 0.86) !important;
    border-left: 4px solid var(--platform-highlight) !important;
    padding: 8px 12px !important;
    text-shadow: 0 2px 10px rgba(0, 0, 0, 0.92) !important;
  }
  .step {
    display: inline-block;
    width: fit-content;
    color: var(--pulse-paper) !important;
    background: rgba(7, 9, 13, 0.86) !important;
    border-left: 4px solid var(--platform-accent) !important;
    padding: 8px 12px !important;
    text-shadow: 0 2px 10px rgba(0, 0, 0, 0.92) !important;
  }
  .cta {
    display: inline-block;
    width: fit-content;
    color: var(--pulse-paper) !important;
    background: rgba(7, 9, 13, 0.90) !important;
    border-left: 4px solid var(--pulse-brand-amber) !important;
    padding: 10px 16px !important;
    text-shadow: 0 2px 12px rgba(0, 0, 0, 0.96) !important;
  }
  .arrow {
    display: inline-block;
    width: fit-content;
    background: rgba(7, 9, 13, 0.90) !important;
    border-bottom: 3px solid var(--platform-highlight) !important;
    padding: 4px 14px 8px !important;
    text-shadow: 0 2px 12px rgba(0, 0, 0, 0.96) !important;
  }
  .pulse {
    color: var(--pulse-paper) !important;
    background: rgba(7, 9, 13, 0.90) !important;
    border-top: 2px solid var(--pulse-primary) !important;
    padding: 8px 12px !important;
    text-shadow: 0 2px 12px rgba(0, 0, 0, 0.96) !important;
  }
  .headline .word:first-child, .number, .label { color: var(--pulse-paper) !important; }
  .headline .word:last-child, .arrow { color: var(--platform-highlight) !important; }
  .headline, .number, .label, .quote {
    letter-spacing: 0 !important;
    text-shadow: 0 5px 0 rgba(0,0,0,0.62), 0 16px 42px rgba(0,0,0,0.70), 0 0 54px color-mix(in srgb, var(--pulse-primary) 24%, transparent) !important;
  }
  .bullets li {
    background: rgba(7, 9, 13, 0.62) !important;
    border-left: 5px solid var(--platform-accent) !important;
    backdrop-filter: blur(12px);
  }
  .rule, .accent-bar, .accent-bar-bottom, .frame-top, .frame-bot {
    background: linear-gradient(90deg, var(--pulse-brand-amber), var(--platform-accent), var(--platform-highlight)) !important;
  }
  ${kind === "quote" ? `.quote-mark {
    top: 330px !important;
  }` : ""}
</style>`;
}

function compactBrandCategoryLabel(identity) {
  const label = cleanText(identity?.label).toUpperCase();
  const compact = label.replace(/^PULSE(?:\s+GAMING)?\s+/i, "").trim();
  return compact || cleanText(identity?.category).toUpperCase() || "BRIEF";
}

function creativeMarkup(identity) {
  const platform =
    identity.platform_visual_language || PLATFORM_VISUAL_LANGUAGES.neutral;
  return `
        <div id="pulse-creative-layer" class="pulse-creative-layer" aria-hidden="true">
          <div id="pulse-depth-a" class="pulse-depth-layer pulse-depth-a"></div>
          <div id="pulse-depth-b" class="pulse-depth-layer pulse-depth-b"></div>
          <div id="pulse-grid" class="pulse-grid"></div>
          <div id="pulse-light-sweep" class="pulse-light-sweep" data-layout-allow-overflow="true"></div>
          <div id="pulse-platform-motif" class="pulse-platform-motif" data-platform-motif="${escapeHtml(platform.motif)}">
            <span id="pulse-platform-node-1" class="pulse-platform-node"></span>
            <span id="pulse-platform-node-2" class="pulse-platform-node"></span>
            <span id="pulse-platform-node-3" class="pulse-platform-node"></span>
            <span id="pulse-platform-node-4" class="pulse-platform-node"></span>
          </div>
          <div id="pulse-signal-rail" class="pulse-signal-rail"></div>
        </div>
        <div id="pulse-brand-bug" class="pulse-brand-bug">
          <span class="pulse-mark"><span></span><span></span><span></span></span>
          <span class="pulse-wordmark">PULSE</span>
          <span class="pulse-category">${escapeHtml(compactBrandCategoryLabel(identity))}</span>
        </div>
        <div id="pulse-story-code" class="pulse-story-code">${escapeHtml(identity.segment_name).toUpperCase()} / ${escapeHtml(identity.code)}</div>
        <div class="pulse-platform-tag">${escapeHtml(platform.label).toUpperCase()} STORY</div>`;
}

function creativeTimeline(durationS) {
  const duration = clampDuration(durationS);
  const sweepDuration = Number(Math.max(0.8, Math.min(1.4, duration * 0.28)).toFixed(2));
  return `
      tl.fromTo("#pulse-signal-rail", { scaleX: 0, opacity: 0 }, { scaleX: 1, opacity: 1, duration: 0.42, ease: "power3.out" }, 0)
        .fromTo("#pulse-brand-bug", { opacity: 0, y: -18 }, { opacity: 1, y: 0, duration: 0.38, ease: "power3.out" }, 0.08)
        .fromTo("#pulse-story-code", { opacity: 0, x: 22 }, { opacity: 1, x: 0, duration: 0.38, ease: "power3.out" }, 0.16)
        .fromTo("#pulse-depth-a", { x: -34, y: 18, scale: 1.05 }, { x: 18, y: -12, scale: 1.13, duration: ${duration}, ease: "none" }, 0)
        .fromTo("#pulse-depth-b", { x: 28, y: -14, scale: 1.12 }, { x: -20, y: 16, scale: 1.05, duration: ${duration}, ease: "none" }, 0)
        .fromTo("#pulse-grid", { x: -12, opacity: 0.08 }, { x: 16, opacity: 0.20, duration: ${duration}, ease: "none" }, 0)
        .fromTo("#pulse-platform-motif", { opacity: 0, scale: 0.82, rotation: -8 }, { opacity: 0.58, scale: 1.04, rotation: 4, duration: ${duration}, ease: "sine.inOut" }, 0.12)
        .fromTo("#pulse-platform-node-1", { scale: 0.5, rotation: -16 }, { scale: 1, rotation: 8, duration: 0.72, ease: "back.out(1.6)" }, 0.16)
        .fromTo("#pulse-platform-node-2", { scale: 0.4, y: 26 }, { scale: 1, y: 0, duration: 0.62, ease: "back.out(1.8)" }, 0.28)
        .fromTo("#pulse-platform-node-3", { scale: 0.2, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.46, ease: "power3.out" }, 0.42)
        .fromTo("#pulse-platform-node-4", { scale: 0.2, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.38, ease: "power3.out" }, 0.52)
        .fromTo("#pulse-light-sweep", { x: 0, opacity: 0 }, { x: 1540, opacity: 0.44, duration: ${sweepDuration}, ease: "power2.inOut" }, 0.34);
`;
}

function applyPulseVisualIdentityToHtml(html = "", {
  identity = IDENTITIES.news,
  kind = "context",
  durationS = 4,
} = {}) {
  let output = String(html || "");
  if (!output || output.includes(`data-pulse-creative-system="${CREATIVE_SYSTEM_VERSION}"`)) return output;
  const resolved = identity?.category ? identity : IDENTITIES.news;
  output = output.replace(
    /(<div\b[^>]*\bid=["']root["'][^>]*)(>)/i,
    `$1 data-pulse-creative-system="${CREATIVE_SYSTEM_VERSION}" data-pulse-category="${escapeHtml(resolved.category || "news")}" data-pulse-motion-mode="${escapeHtml(resolved.motion_mode || "kinetic_brief")}" data-pulse-platform="${escapeHtml(resolved.platform_visual_language?.id || "neutral")}"$2`,
  );
  output = output.replace(/<\/head>/i, `${creativeStyles(resolved, kind)}\n</head>`);
  output = output.replace(
    /(<div\b(?=[^>]*\bdata-track-index=["']0["'])[^>]*>)/i,
    `$1${creativeMarkup(resolved)}`,
  );
  if (kind === "quote") {
    output = output.replace(
      /(<div\b[^>]*\bid=["']quote-mark["'][^>]*)(>)/i,
      '$1 data-layout-allow-overlap="true" data-layout-allow-occlusion="true"$2',
    );
  }
  output = output.replace(
    /window\.__timelines\[["']main["']\]\s*=\s*tl\s*;/,
    `${creativeTimeline(durationS)}      window.__timelines["main"] = tl;`,
  );
  return output;
}

function countMatches(value, pattern) {
  return (String(value || "").match(pattern) || []).length;
}

function inspectPulseVisualIdentityHtml(html = "", {
  expectedCategory = "",
  expectedPlatform = "",
} = {}) {
  const source = String(html || "");
  const blockers = [];
  const systemPresent = source.includes(`data-pulse-creative-system="${CREATIVE_SYSTEM_VERSION}"`);
  const categoryMatch = source.match(/data-pulse-category="([^"]+)"/i);
  const category = cleanText(categoryMatch?.[1]).toLowerCase();
  const platformMatch = source.match(/data-pulse-platform="([^"]+)"/i);
  const platform = cleanText(platformMatch?.[1]).toLowerCase();
  const platformMotifMatch = source.match(
    /id="pulse-platform-motif"[^>]*data-platform-motif="([^"]+)"/i,
  );
  const platformMotif = cleanText(platformMotifMatch?.[1]);
  const platformMotifNodeCount = countMatches(
    source,
    /id="pulse-platform-node-\d+"/g,
  );
  const depthLayerCount = countMatches(source, /class="[^"]*\bpulse-depth-layer\b[^"]*"/g);
  const brandBug = /id="pulse-brand-bug"/.test(source);
  const pulseWordmarkRetained =
    /class="pulse-wordmark"[^>]*>\s*PULSE\s*</i.test(source);
  const officialPlatformLogoPresent =
    /class="[^"]*\bofficial-platform-logo\b[^"]*"/i.test(source);
  const signalRail = /id="pulse-signal-rail"/.test(source);
  const safeZoneBranding = /\.pulse-brand-bug\s*\{[\s\S]*?top:\s*252px/.test(source);
  const timelineCount = countMatches(source, /gsap\.timeline\s*\(/g);
  const singleTimeline = timelineCount === 1;
  const kineticSteps = countMatches(source, /\.(?:to|fromTo)\s*\(/g);

  if (!systemPresent) blockers.push("pulse_creative_system_missing");
  if (!category) blockers.push("pulse_creative_category_missing");
  else if (expectedCategory && category !== cleanText(expectedCategory).toLowerCase()) {
    blockers.push("pulse_creative_category_mismatch");
  }
  if (!platform) blockers.push("pulse_platform_visual_language_missing");
  else if (
    expectedPlatform &&
    platform !== cleanText(expectedPlatform).toLowerCase()
  ) {
    blockers.push("pulse_platform_visual_language_mismatch");
  }
  if (!platformMotif) blockers.push("pulse_platform_motif_missing");
  if (platformMotifNodeCount < 4) blockers.push("pulse_platform_motif_too_thin");
  if (depthLayerCount < 2) blockers.push("pulse_parallax_depth_layers_missing");
  if (!brandBug) blockers.push("pulse_signature_brand_bug_missing");
  if (!pulseWordmarkRetained) blockers.push("pulse_wordmark_missing");
  if (officialPlatformLogoPresent) blockers.push("official_platform_logo_impersonation_risk");
  if (!signalRail) blockers.push("pulse_signal_rail_missing");
  if (!safeZoneBranding) blockers.push("pulse_brand_safe_zone_missing");
  if (!singleTimeline) blockers.push("pulse_single_timeline_contract_failed");
  if (kineticSteps < 8) blockers.push("pulse_kinetic_motion_too_thin");

  return {
    status: blockers.length ? "fail" : "pass",
    blockers,
    evidence: {
      version: systemPresent ? CREATIVE_SYSTEM_VERSION : null,
      category: category || null,
      platform: platform || null,
      platform_motif: platformMotif || null,
      platform_motif_node_count: platformMotifNodeCount,
      depth_layer_count: depthLayerCount,
      signature_brand_bug: brandBug,
      pulse_wordmark_retained: pulseWordmarkRetained,
      official_platform_logo_present: officialPlatformLogoPresent,
      signal_rail: signalRail,
      safe_zone_branding: safeZoneBranding,
      timeline_count: timelineCount,
      single_timeline: singleTimeline,
      kinetic_animation_steps: kineticSteps,
    },
  };
}

module.exports = {
  CREATIVE_SYSTEM_VERSION,
  IDENTITIES,
  PLATFORM_VISUAL_LANGUAGE_VERSION,
  PLATFORM_VISUAL_LANGUAGES,
  applyPulseVisualIdentityToHtml,
  classifyPulseStory,
  detectPlatformVisualLanguage,
  inspectPulseVisualIdentityHtml,
  resolvePulseTransitionCycle,
  resolvePulseVisualIdentity,
};
