/**
 * lib/prl-overlays.js — Premium Render Layer overlay generators.
 *
 * The legacy assemble.js renders most of these inline as a giant
 * comma-chained drawtext / drawbox stack inside buildVideoCommand.
 * This module extracts the same primitives (and adds new ones) as
 * pure functions so the harness can compose them deterministically
 * and so production can cherry-pick file-by-file later.
 *
 * Each exported builder returns an array of ffmpeg filter
 * fragments (drawbox / drawtext expressions, comma-joinable). The
 * caller is responsible for chaining them in the correct Z-order:
 *
 *   1. background image (Ken Burns from lib/motion)
 *   2. eq (brightness/saturation polish)
 *   3. lower-third dark bar
 *   4. badge (top-left, classification colour)
 *   5. source bug (below badge)
 *   6. stat card (timed, top-right)            ← optional
 *   7. comment swoop (timed, mid-screen)       ← optional
 *   8. lower-third channel name + tagline
 *   9. opener overlay (0–3s, lib/hook-factory) ← optional
 *  10. ASS subtitle stream                     ← always last
 *
 * All ffmpeg-text values are escaped via `ffEscape`. Colours arrive
 * as 0xRRGGBB strings (ffmpeg drawbox format).
 */

"use strict";

// Pulse Gaming brand colours (mirrored from channels/pulse-gaming).
const COLOURS = {
  PRIMARY: "0xFF6B1A", // amber accent
  MUTED: "0x6B7280", // grey text/UI
  CARD_BG: "0x0D0D0F", // near-black card
  WHITE: "0xFFFFFF",
};

// Classification colours mirrored from brand.classificationColour.
const FLAIR_COLOURS = {
  Confirmed: "0x10B981", // green
  Breaking: "0xFF2D2D", // red
  Rumour: "0xF59E0B", // amber
  Verified: "0x10B981",
  News: "0x6B7280",
  Trailer: "0x8B5CF6", // purple
  Test: "0x6B7280",
};

function flairColour(flair) {
  if (!flair) return FLAIR_COLOURS.News;
  // Match by case-insensitive prefix.
  const key = String(flair).replace(/[^a-z]/gi, "");
  for (const [name, hex] of Object.entries(FLAIR_COLOURS)) {
    if (name.toLowerCase() === key.toLowerCase()) return hex;
  }
  return FLAIR_COLOURS.News;
}

/**
 * Escape a string for ffmpeg drawtext text='...'. Mirror of
 * sanitizeDrawtext in production assemble.js.
 */
function ffEscape(s) {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "’")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/=/g, "\\=")
    .replace(/%/g, "\\%");
}

/**
 * Truncate a string to N characters with an ellipsis if it overflows.
 */
function clip(s, n) {
  const v = String(s ?? "");
  if (v.length <= n) return v;
  return v.slice(0, Math.max(0, n - 1)).trimEnd() + "…";
}

// =================================================================
// 1. Lower-third dark bar (always-on bottom shade for legibility)
// =================================================================

/**
 * Returns the dark bar that production already draws at y=ih-200.
 * Hidden during the outro card reveal so the CTA isn't dimmed.
 */
function buildLowerThirdShade({ outroStartS = null }) {
  const enable = outroStartS ? `:enable='lt(t\\,${outroStartS})'` : "";
  return [`drawbox=x=0:y=ih-200:w=iw:h=200:color=black@0.55:t=fill${enable}`];
}

// =================================================================
// 2. Channel-name + tagline (always-on, bottom centre)
// =================================================================

function buildChannelLowerThird({
  channelName = "PULSE GAMING",
  tagline = "Never miss a beat",
  fontOpt,
  outroStartS = null,
}) {
  const enable = outroStartS ? `:enable='lt(t\\,${outroStartS})'` : "";
  // Thin amber accent line above the text — a small premium tell.
  return [
    `drawbox=x=(w-260)/2:y=h-110:w=260:h=2:color=${COLOURS.PRIMARY}@0.65:t=fill${enable}`,
    `drawtext=text='${ffEscape(channelName)}':${fontOpt}:fontcolor=${COLOURS.PRIMARY}@0.85:fontsize=28:x=(w-tw)/2:y=h-90${enable}`,
    `drawtext=text='${ffEscape(tagline)}':${fontOpt}:fontcolor=${COLOURS.MUTED}@0.65:fontsize=18:x=(w-tw)/2:y=h-58${enable}`,
  ];
}

// =================================================================
// 3. Flair badge (top-left, classification colour, optional pulse)
// =================================================================

/**
 * Top-left classification badge. For high-energy classifications
 * (Breaking, Rumour) we add a subtle scale pulse via a thin border
 * line that brightens every 2s.
 */
function buildFlairBadge({ flair, fontOpt, fadeInS = 0.25 }) {
  const label = clip(String(flair || "NEWS").toUpperCase(), 14);
  const colour = flairColour(flair);
  // Mild fade-in so it doesn't pop in jarringly on frame 0.
  const fade = `alpha='if(lt(t\\,${fadeInS})\\,t/${fadeInS}\\,1)'`;
  // Pulse: drawbox doesn't support runtime alpha, so we use the
  // `enable` gate to flash the border line on/off in a 0.6s on /
  // 1.4s off pattern. Subtle but live-looking.
  const pulseGate = `enable='lt(mod(t\\,2)\\,0.6)'`;
  const out = [
    // Filled badge body (steady alpha — pulse is on the border).
    `drawtext=text='  ${ffEscape(label)}  ':${fontOpt}:fontcolor=white:fontsize=38:` +
      `box=1:boxcolor=${colour}@0.85:boxborderw=14:x=40:y=60:${fade}`,
    // Thin pulsing border line above the badge — appears every 2s.
    `drawbox=x=40:y=58:w=180:h=2:color=${colour}@1.0:t=fill:${pulseGate}`,
  ];
  return out;
}

// =================================================================
// 4. Source bug (below the badge — subreddit / publisher name)
// =================================================================

function buildSourceBug({ story, fontOpt, fadeInS = 0.4 }) {
  const sub = story?.subreddit ? `r/${story.subreddit}` : null;
  const src = sub || story?.source_type || story?.source || "News";
  const label = clip(String(src), 30);
  const fade = `alpha='if(lt(t\\,${fadeInS})\\,t/${fadeInS}\\,1)'`;
  return [
    `drawtext=text='  ${ffEscape(label)}  ':${fontOpt}:fontcolor=white@0.85:fontsize=24:` +
      `box=1:boxcolor=${COLOURS.MUTED}@0.55:boxborderw=8:x=40:y=130:${fade}`,
  ];
}

// =================================================================
// 5. Stat card (top-right, timed pop-in if Steam metrics available)
// =================================================================

function buildStatCard({ story, fontOpt, startS = 4.0, durationS = 4.0 }) {
  const stats = [];
  if (story?.steam_review_score) {
    stats.push(`${story.steam_review_score}% Positive`);
  }
  if (story?.steam_player_count) {
    const n = Number(story.steam_player_count);
    if (Number.isFinite(n)) stats.push(`${n.toLocaleString()} Playing`);
  }
  if (stats.length === 0) return [];
  const text = clip(stats.join("  |  "), 50);

  const endS = startS + durationS;
  // Slide-in from right + fade.
  const fadeIn = 0.25;
  const fadeOut = 0.4;
  const alpha = `alpha='if(lt(t-${startS}\\,${fadeIn})\\,(t-${startS})/${fadeIn}\\,if(gt(t-${startS}\\,${durationS - fadeOut})\\,1-(t-${startS}-(${durationS - fadeOut}))/${fadeOut}\\,1))'`;
  const enable = `enable='between(t\\,${startS}\\,${endS})'`;
  // Slide x: starts off-screen right, slides to final pos over fadeIn.
  const x = `x='if(lt(t-${startS}\\,${fadeIn})\\,w-tw-40+(40)*(${fadeIn}-(t-${startS}))/${fadeIn}\\,w-tw-40)'`;
  return [
    `drawtext=text='  ${ffEscape(text)}  ':${fontOpt}:fontcolor=white:fontsize=24:` +
      `box=1:boxcolor=${COLOURS.CARD_BG}@0.80:boxborderw=10:${x}:y=130:${alpha}:${enable}`,
  ];
}

// =================================================================
// 6. Comment swoop (mid-screen card with reddit top_comment)
// =================================================================

/**
 * A Reddit-style comment card that slides in from the right. Shows
 * `u/<author>` + a clipped first line of the comment body.
 *
 * Defaults: fires at startS, holds durationS, slides out. If no
 * comment data on the story, returns [].
 */
function buildCommentSwoop({ story, fontOpt, startS = 12.0, durationS = 6.0 }) {
  const top = story?.top_comment || story?.reddit_comments?.[0]?.body;
  const author =
    story?.reddit_comments?.[0]?.author ||
    story?.top_comment_author ||
    "Redditor";
  const upvotes =
    story?.reddit_comments?.[0]?.score ?? story?.top_comment_score;
  if (!top) return [];

  const upvoteStr =
    Number.isFinite(Number(upvotes)) && Number(upvotes) > 0
      ? `  ↑${Number(upvotes).toLocaleString()}`
      : "";
  const handle = `u/${clip(author, 18)}${upvoteStr}`;
  const lineMax = 38;
  const lines = [];
  // Word-wrap the comment to ~38 chars per line, max 3 lines.
  const words = String(top).replace(/\s+/g, " ").trim().split(" ");
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > lineMax) {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length >= 3) break;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur && lines.length < 3) lines.push(cur);
  if (lines.length === 0) return [];

  const endS = startS + durationS;
  const fadeIn = 0.35;
  const fadeOut = 0.45;
  const alpha = `alpha='if(lt(t-${startS}\\,${fadeIn})\\,(t-${startS})/${fadeIn}\\,if(gt(t-${startS}\\,${durationS - fadeOut})\\,1-(t-${startS}-(${durationS - fadeOut}))/${fadeOut}\\,1))'`;
  const enable = `enable='between(t\\,${startS}\\,${endS})'`;

  // x slides in from right
  const xExpr = `x='if(lt(t-${startS}\\,${fadeIn})\\,(w-tw)/2+200*(${fadeIn}-(t-${startS}))/${fadeIn}\\,(w-tw)/2)'`;

  // Card body: dark bg with amber stripe.
  const yBase = 230;
  const lineH = 36;
  const totalH = 44 + lines.length * lineH + 16;
  const out = [];
  // Card background
  out.push(
    `drawbox=x=(w-680)/2:y=${yBase}:w=680:h=${totalH}:color=${COLOURS.CARD_BG}@0.78:t=fill:${enable}`,
  );
  // Amber side stripe
  out.push(
    `drawbox=x=(w-680)/2:y=${yBase}:w=4:h=${totalH}:color=${COLOURS.PRIMARY}@1.0:t=fill:${enable}`,
  );
  // Header line: u/handle in amber
  out.push(
    `drawtext=text='${ffEscape(handle)}':${fontOpt}:fontcolor=${COLOURS.PRIMARY}:fontsize=28:` +
      `${xExpr}:y=${yBase + 12}:${alpha}:${enable}`,
  );
  // Body lines
  for (let i = 0; i < lines.length; i++) {
    out.push(
      `drawtext=text='${ffEscape(lines[i])}':${fontOpt}:fontcolor=white:fontsize=24:` +
        `${xExpr}:y=${yBase + 48 + i * lineH}:${alpha}:${enable}`,
    );
  }
  return out;
}

// =================================================================
// 7. Hot-take / analysis card (a soft-call-out anywhere in the body)
// =================================================================

/**
 * A bottom-centre "HOT TAKE" or analysis card. Wraps short
 * editorial text. Intended for stories where we have a soft
 * hot_take or analysis_blurb field, but the harness can also
 * derive one from the loop string.
 */
function buildHotTakeCard({
  story,
  fontOpt,
  startS,
  durationS = 4.5,
  label = "HOT TAKE",
}) {
  const text = story?.hot_take || story?.analysis_blurb || story?.loop || null;
  if (!text) return [];
  const cleaned = clip(String(text).replace(/\s+/g, " ").trim(), 90);
  if (!cleaned) return [];

  const endS = startS + durationS;
  const fadeIn = 0.3;
  const fadeOut = 0.5;
  const alpha = `alpha='if(lt(t-${startS}\\,${fadeIn})\\,(t-${startS})/${fadeIn}\\,if(gt(t-${startS}\\,${durationS - fadeOut})\\,1-(t-${startS}-(${durationS - fadeOut}))/${fadeOut}\\,1))'`;
  const enable = `enable='between(t\\,${startS}\\,${endS})'`;

  // Two-line layout: small-caps label on top, body below.
  const yBase = 1320;
  return [
    `drawbox=x=(w-820)/2:y=${yBase}:w=820:h=120:color=${COLOURS.CARD_BG}@0.80:t=fill:${enable}`,
    `drawbox=x=(w-820)/2:y=${yBase}:w=820:h=4:color=${COLOURS.PRIMARY}@0.95:t=fill:${enable}`,
    `drawtext=text='${ffEscape(label)}':${fontOpt}:fontcolor=${COLOURS.PRIMARY}:fontsize=22:x=(w-tw)/2:y=${yBase + 14}:${alpha}:${enable}`,
    `drawtext=text='${ffEscape(cleaned)}':${fontOpt}:fontcolor=white:fontsize=26:x=(w-tw)/2:y=${yBase + 56}:${alpha}:${enable}`,
  ];
}

// =================================================================
// Composer: orchestrates a full PRL overlay chain in correct Z-order.
// =================================================================

/**
 * Build the per-frame overlay chain. Returned array can be
 * comma-joined onto an existing video label like:
 *
 *   [base]<chain>[afterprl];
 *
 * The CALLER is responsible for the eq() polish + opener overlay
 * (separate, since opener is from lib/hook-factory and we want
 * opener LAST so it sits on top of everything except captions).
 */
function buildPrlChain({
  story,
  fontOpt,
  videoDuration,
  outroStartS = null,
  options = {},
}) {
  const opts = {
    enableLowerThird: true,
    enableBadge: true,
    enableSourceBug: true,
    enableStatCard: true,
    enableCommentSwoop: true,
    enableHotTake: true,
    statCardStart: 4.0,
    statCardDur: 4.0,
    commentSwoopStart: 12.0,
    commentSwoopDur: 6.0,
    hotTakeStart: Math.max(15, videoDuration - 18),
    hotTakeDur: 4.5,
    ...options,
  };

  const chain = [];

  // Polish: brightness/saturation tweak that production already does.
  chain.push("eq=brightness=-0.08:saturation=1.2");

  if (opts.enableLowerThird) {
    chain.push(...buildLowerThirdShade({ outroStartS }));
  }

  if (opts.enableBadge) {
    chain.push(
      ...buildFlairBadge({
        flair: story?.flair || story?.classification,
        fontOpt,
      }),
    );
  }

  if (opts.enableSourceBug) {
    chain.push(...buildSourceBug({ story, fontOpt }));
  }

  if (opts.enableStatCard) {
    chain.push(
      ...buildStatCard({
        story,
        fontOpt,
        startS: opts.statCardStart,
        durationS: opts.statCardDur,
      }),
    );
  }

  if (opts.enableCommentSwoop) {
    chain.push(
      ...buildCommentSwoop({
        story,
        fontOpt,
        startS: opts.commentSwoopStart,
        durationS: opts.commentSwoopDur,
      }),
    );
  }

  if (opts.enableHotTake) {
    chain.push(
      ...buildHotTakeCard({
        story,
        fontOpt,
        startS: opts.hotTakeStart,
        durationS: opts.hotTakeDur,
      }),
    );
  }

  if (opts.enableLowerThird) {
    chain.push(...buildChannelLowerThird({ fontOpt, outroStartS }));
  }

  return chain;
}

module.exports = {
  buildPrlChain,
  buildLowerThirdShade,
  buildChannelLowerThird,
  buildFlairBadge,
  buildSourceBug,
  buildStatCard,
  buildCommentSwoop,
  buildHotTakeCard,
  flairColour,
  ffEscape,
  clip,
  COLOURS,
  FLAIR_COLOURS,
};
