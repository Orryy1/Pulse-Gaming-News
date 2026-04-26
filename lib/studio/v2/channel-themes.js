/**
 * lib/studio/v2/channel-themes.js — channel-aware brand themes for v2.
 *
 * Each channel's HyperFrames cards use the same composition structure
 * but swap brand-specific values:
 *   - PRIMARY (the accent / hero colour)
 *   - SECONDARY (background tone)
 *   - GLOW (low-opacity halo for the accent — usually PRIMARY at 0.7)
 *   - HEX_DOT (tiny mark used in the BREAKING bug)
 *   - CHANNEL_NAME (shown in the takeaway pulse line)
 *   - TAGLINE (shown in opener meta tag where applicable)
 *
 * The channel registry at /channels/<id>.js owns the canonical palette.
 * This module wraps it into a v2-shaped record that the HF builders
 * inject into the templates before rendering.
 *
 * Theme injection happens in hf-card-builders.js via a deterministic
 * regex sweep over the per-story HTML — the templates use named
 * sentinel hex values (#FF6B1A, #0d0d0f, etc.) which the builder
 * substitutes per channel.
 */

"use strict";

const path = require("node:path");
const ROOT = path.resolve(__dirname, "..", "..", "..");

/**
 * Pull a v2-shaped theme out of the channel registry. Returns:
 *   {
 *     channelId,        // 'pulse-gaming'
 *     channelName,      // 'PULSE GAMING'
 *     tagline,          // 'Verified leaks. Every day.'
 *     primary,          // '#FF6B1A'
 *     primaryGlow,      // 'rgba(255,107,26,0.7)'
 *     primaryHalf,      // 'rgba(255,107,26,0.18)'
 *     secondary,        // '#0d0d0f'
 *     alert,            // '#FF2D2D'
 *     text,             // '#F0F0F0'
 *     muted,            // '#6B7280'
 *   }
 */
function getChannelTheme(channelId) {
  // Lazy-require so this module doesn't pull the full channel registry
  // when only theme metadata is needed.
  const channels = require(path.join(ROOT, "channels"));
  const channel = channels.getChannel(channelId);
  const c = channel.colours;
  return {
    channelId: channel.id,
    channelName: channel.name,
    tagline: channel.tagline,
    primary: c.PRIMARY,
    primaryGlow: hexToRgba(c.PRIMARY, 0.7),
    primaryHalf: hexToRgba(c.PRIMARY, 0.18),
    primaryDark: hexToRgba(c.PRIMARY, 0.95),
    secondary: c.SECONDARY,
    alert: c.ALERT,
    text: c.TEXT,
    muted: c.MUTED,
  };
}

function hexToRgba(hex, alpha) {
  const clean = String(hex || "").replace(/^#/, "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return `rgba(255, 107, 26, ${alpha})`;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Apply the theme to a template HTML string. Replaces the canonical
 * Pulse Gaming sentinel values with channel-specific equivalents.
 *
 * Sentinels chosen so the regex never matches anything other than the
 * brand colour. (i.e. we don't accidentally rewrite an inline-styled
 * scanline or the backdrop background.)
 */
function applyThemeToHtml(html, theme) {
  let out = String(html || "");

  // Primary hex (case-insensitive). The Pulse template uses #FF6B1A
  // many times in inline styles, GSAP color hints and SVGs.
  out = out.replace(/#FF6B1A/gi, theme.primary);
  // Pulse's primary in shadow rgba at 0.7
  out = out.replace(/rgba\(255,\s*107,\s*26,\s*0\.7\)/gi, theme.primaryGlow);
  // Pulse's primary in shadow rgba at 0.18
  out = out.replace(/rgba\(255,\s*107,\s*26,\s*0\.18\)/gi, theme.primaryHalf);
  // Other primary opacities — handle 0.65, 0.55, 0.32, 0.25, 0.95, 0.45 in
  // case the templates ever include them
  out = out.replace(
    /rgba\(255,\s*107,\s*26,\s*0\.95\)/gi,
    hexToRgba(theme.primary, 0.95),
  );
  out = out.replace(
    /rgba\(255,\s*107,\s*26,\s*0\.65\)/gi,
    hexToRgba(theme.primary, 0.65),
  );
  out = out.replace(
    /rgba\(255,\s*107,\s*26,\s*0\.55\)/gi,
    hexToRgba(theme.primary, 0.55),
  );
  out = out.replace(
    /rgba\(255,\s*107,\s*26,\s*0\.45\)/gi,
    hexToRgba(theme.primary, 0.45),
  );
  out = out.replace(
    /rgba\(255,\s*107,\s*26,\s*0\.32\)/gi,
    hexToRgba(theme.primary, 0.32),
  );
  out = out.replace(
    /rgba\(255,\s*107,\s*26,\s*0\.25\)/gi,
    hexToRgba(theme.primary, 0.25),
  );

  // Background — Pulse uses #0d0d0f. Replace ONLY when not part of
  // a different colour reference. Use word boundaries.
  out = out.replace(/#0d0d0f/gi, theme.secondary);

  // Replace the channel name in the takeaway pulse strip and opener
  // kicker. The Pulse template uses "PULSE GAMING" verbatim.
  out = out.replace(/PULSE GAMING/g, theme.channelName);

  return out;
}

/**
 * Build a default theme based on env CHANNEL or 'pulse-gaming'.
 */
function getActiveTheme() {
  return getChannelTheme(process.env.CHANNEL || "pulse-gaming");
}

module.exports = {
  getChannelTheme,
  getActiveTheme,
  applyThemeToHtml,
  hexToRgba,
};
