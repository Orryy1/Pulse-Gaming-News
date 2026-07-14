"use strict";

const CREATIVE_SYSTEM_VERSION = "pulse_visual_identity_v5";

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
  return {
    ...IDENTITIES[category],
    version: CREATIVE_SYSTEM_VERSION,
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
  return `
<style id="pulse-creative-system-styles">
  :root {
    --pulse-primary: ${identity.primary};
    --pulse-secondary: ${identity.secondary};
    --pulse-ink: ${identity.background};
    --pulse-paper: ${identity.foreground};
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
      linear-gradient(color-mix(in srgb, var(--pulse-secondary) 26%, transparent) 1px, transparent 1px),
      linear-gradient(90deg, color-mix(in srgb, var(--pulse-primary) 22%, transparent) 1px, transparent 1px);
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
    background: linear-gradient(90deg, var(--pulse-primary), var(--pulse-secondary) 72%, transparent);
    box-shadow: 0 0 24px color-mix(in srgb, var(--pulse-primary) 68%, transparent);
  }
  .pulse-signal-rail::after {
    content: "";
    position: absolute;
    right: 0;
    top: -5px;
    width: 14px;
    height: 14px;
    background: var(--pulse-secondary);
    transform: rotate(45deg);
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
    border-left: 6px solid var(--pulse-primary);
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
  .pulse-mark span:nth-child(2) { height: 20px; background: var(--pulse-primary); }
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
    border-right: 3px solid var(--pulse-secondary);
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
    border: 1px solid color-mix(in srgb, var(--pulse-primary) 48%, transparent) !important;
    border-left: 5px solid var(--pulse-primary) !important;
    padding: 10px 16px !important;
    clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%);
  }
  .micro {
    display: inline-block;
    width: fit-content;
    color: var(--pulse-paper) !important;
    background: rgba(7, 9, 13, 0.86) !important;
    border-left: 4px solid var(--pulse-secondary) !important;
    padding: 8px 12px !important;
    text-shadow: 0 2px 10px rgba(0, 0, 0, 0.92) !important;
  }
  .step {
    display: inline-block;
    width: fit-content;
    color: var(--pulse-paper) !important;
    background: rgba(7, 9, 13, 0.86) !important;
    border-left: 4px solid var(--pulse-primary) !important;
    padding: 8px 12px !important;
    text-shadow: 0 2px 10px rgba(0, 0, 0, 0.92) !important;
  }
  .cta {
    display: inline-block;
    width: fit-content;
    color: var(--pulse-paper) !important;
    background: rgba(7, 9, 13, 0.90) !important;
    border-left: 4px solid var(--pulse-primary) !important;
    padding: 10px 16px !important;
    text-shadow: 0 2px 12px rgba(0, 0, 0, 0.96) !important;
  }
  .arrow {
    display: inline-block;
    width: fit-content;
    background: rgba(7, 9, 13, 0.90) !important;
    border-bottom: 3px solid var(--pulse-secondary) !important;
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
  .headline .word:last-child, .arrow { color: var(--pulse-secondary) !important; }
  .headline, .number, .label, .quote {
    letter-spacing: 0 !important;
    text-shadow: 0 5px 0 rgba(0,0,0,0.62), 0 16px 42px rgba(0,0,0,0.70), 0 0 54px color-mix(in srgb, var(--pulse-primary) 24%, transparent) !important;
  }
  .bullets li {
    background: rgba(7, 9, 13, 0.62) !important;
    border-left: 5px solid var(--pulse-primary) !important;
    backdrop-filter: blur(12px);
  }
  .rule, .accent-bar, .accent-bar-bottom, .frame-top, .frame-bot {
    background: linear-gradient(90deg, var(--pulse-primary), var(--pulse-secondary)) !important;
  }
  ${kind === "quote" ? `.quote-mark {
    top: 330px !important;
  }` : ""}
</style>`;
}

function creativeMarkup(identity) {
  return `
        <div id="pulse-creative-layer" class="pulse-creative-layer" aria-hidden="true">
          <div id="pulse-depth-a" class="pulse-depth-layer pulse-depth-a"></div>
          <div id="pulse-depth-b" class="pulse-depth-layer pulse-depth-b"></div>
          <div id="pulse-grid" class="pulse-grid"></div>
          <div id="pulse-light-sweep" class="pulse-light-sweep" data-layout-allow-overflow="true"></div>
          <div id="pulse-signal-rail" class="pulse-signal-rail"></div>
        </div>
        <div id="pulse-brand-bug" class="pulse-brand-bug">
          <span class="pulse-mark"><span></span><span></span><span></span></span>
          <span class="pulse-wordmark">PULSE</span>
          <span class="pulse-category">${escapeHtml(identity.label)}</span>
        </div>
        <div id="pulse-story-code" class="pulse-story-code">${escapeHtml(identity.segment_name).toUpperCase()} / ${escapeHtml(identity.code)}</div>`;
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
    `$1 data-pulse-creative-system="${CREATIVE_SYSTEM_VERSION}" data-pulse-category="${escapeHtml(resolved.category || "news")}" data-pulse-motion-mode="${escapeHtml(resolved.motion_mode || "kinetic_brief")}"$2`,
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

function inspectPulseVisualIdentityHtml(html = "", { expectedCategory = "" } = {}) {
  const source = String(html || "");
  const blockers = [];
  const systemPresent = source.includes(`data-pulse-creative-system="${CREATIVE_SYSTEM_VERSION}"`);
  const categoryMatch = source.match(/data-pulse-category="([^"]+)"/i);
  const category = cleanText(categoryMatch?.[1]).toLowerCase();
  const depthLayerCount = countMatches(source, /class="[^"]*\bpulse-depth-layer\b[^"]*"/g);
  const brandBug = /id="pulse-brand-bug"/.test(source);
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
  if (depthLayerCount < 2) blockers.push("pulse_parallax_depth_layers_missing");
  if (!brandBug) blockers.push("pulse_signature_brand_bug_missing");
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
      depth_layer_count: depthLayerCount,
      signature_brand_bug: brandBug,
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
  applyPulseVisualIdentityToHtml,
  classifyPulseStory,
  inspectPulseVisualIdentityHtml,
  resolvePulseTransitionCycle,
  resolvePulseVisualIdentity,
};
