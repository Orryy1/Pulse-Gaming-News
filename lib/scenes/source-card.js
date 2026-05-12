/**
 * lib/scenes/source-card.js — designed source-reveal scene.
 *
 * Full-screen scene that announces where the story comes from.
 * Layout (1080×1920):
 *   - Backdrop: blurred + darkened smart-cropped trailer frame
 *   - Top: small kicker "SOURCE" in amber
 *   - Centre: source label (e.g. r/GAMES) at 96pt with drop-shadow
 *   - Below: optional sub-line (flair / publisher domain)
 *   - Animated reveal: kicker fade 0–0.3s, label slide-up + fade 0.3–0.9s,
 *     amber underline draws across 0.5–1.1s
 *
 * Returns the per-scene filter graph fragment ready for the
 * renderer to inject. Caller still wraps with `[N:v]…[vN]` semantics
 * — this function returns the comma-joinable middle.
 */

"use strict";

const FPS = 30;
const ACCENT = "0xFF6B1A";

function ffEscape(s) {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "’")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/=/g, "\\=")
    .replace(/%/g, "\\%");
}

const fadeIn = (start, dur = 0.4) =>
  `alpha='if(lt(t\\,${start})\\,0\\,if(lt(t-${start}\\,${dur})\\,(t-${start})/${dur}\\,1))'`;
const enableAfter = (start) => `enable='gte(t\\,${start})'`;

function compactDisplayLabel(value, maxLen = 26) {
  const cleaned = String(value || "NEWSROOM")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, Math.max(0, maxLen - 3)).replace(/\s+\S*$/, "").trim()}...`;
}

function flashLaneSourceCardLayout(sourceLabel = "") {
  const label = compactDisplayLabel(sourceLabel);
  const labelFontSize = label.length > 22 ? 34 : label.length > 18 ? 36 : label.length > 12 ? 48 : 56;
  return {
    box: { x: 60, y: 196, w: 610, h: 156 },
    label,
    labelFontSize,
    textX: 88,
    kickerY: 220,
    labelY: 255,
    sublabelY: 316,
  };
}

/**
 * Build the source-card filter chain for a slot.
 *
 * @param {object} args
 * @param {number} args.slot               input index
 * @param {number} args.duration           seconds
 * @param {string} args.sourceLabel        big label (e.g. "r/GAMES")
 * @param {string} [args.sublabel]         optional sub-line
 * @param {string} args.fontOpt            ffmpeg font directive
 * @returns {string}                       comma-joined filter chain
 */
function buildSourceCardFilter({
  slot,
  duration,
  sourceLabel,
  sublabel = "",
  treatment = "standard",
  fontOpt,
}) {
  if (treatment === "flash_lane") {
    return buildFlashLaneSourceCardFilter({
      slot,
      duration,
      sourceLabel,
      sublabel,
      fontOpt,
    });
  }
  const trim = `trim=duration=${duration},setpts=PTS-STARTPTS`;
  const label = ffEscape(String(sourceLabel || "").toUpperCase());
  const sub = ffEscape(String(sublabel || "").toUpperCase());

  // Static y for the big label — animation comes from the alpha
  // fade alone. (An earlier slide-up version produced a malformed
  // ffmpeg expression with mismatched parens.)
  const labelY = `h/2-30`;
  const shadowY = `h/2-30+4`;

  return [
    `[${slot}:v]setrange=tv`,
    `scale=1080:1920:force_original_aspect_ratio=increase`,
    `crop=1080:1920:(iw-1080)/2:(ih-1920)/2`,
    // Force 30fps + matching timebase so this card chain xfades
    // cleanly against clip / still scenes which already normalize
    // to 1/30 via their own fps=30 step.
    `fps=30`,
    `boxblur=18:5`,
    `eq=brightness=-0.32:saturation=0.5:contrast=1.05`,
    // Vignette
    `drawbox=x=0:y=0:w=iw:h=400:color=black@0.55:t=fill`,
    `drawbox=x=0:y=h-500:w=iw:h=500:color=black@0.55:t=fill`,
    // Kicker — small caps "SOURCE"
    `drawtext=text='SOURCE':${fontOpt}:fontcolor=${ACCENT}:fontsize=32:x=(w-tw)/2:y=h/2-150:${fadeIn(0, 0.3)}`,
    // Big label drop-shadow (black, 4px down + 4px right)
    `drawtext=text='${label}':${fontOpt}:fontcolor=black@0.7:fontsize=96:x=(w-tw)/2+4:y=${shadowY}:${fadeIn(0.3, 0.6)}`,
    // Big label (white)
    `drawtext=text='${label}':${fontOpt}:fontcolor=white:fontsize=96:x=(w-tw)/2:y=${labelY}:${fadeIn(0.3, 0.6)}`,
    // Amber underline that draws across 0.5–1.1s
    `drawbox=x=(w-1)/2:y=h/2+85:w='if(lt(t\\,0.5)\\,1\\,if(lt(t-0.5\\,0.6)\\,1+(640-1)*(t-0.5)/0.6\\,640))':h=4:color=${ACCENT}@0.95:t=fill`,
    // Sublabel below
    sub
      ? `drawtext=text='${sub}':${fontOpt}:fontcolor=white@0.75:fontsize=32:x=(w-tw)/2:y=h/2+115:${fadeIn(0.7, 0.4)}`
      : null,
    trim,
    `format=yuv420p,setsar=1[v${slot}]`,
  ]
    .filter(Boolean)
    .join(",");
}

function buildFlashLaneSourceCardFilter({
  slot,
  duration,
  sourceLabel,
  sublabel = "",
  fontOpt,
}) {
  const trim = `trim=duration=${duration},setpts=PTS-STARTPTS`;
  const layout = flashLaneSourceCardLayout(sourceLabel);
  const label = ffEscape(layout.label);
  const sub = ffEscape(String(sublabel || "SOURCE VERIFIED").toUpperCase());

  return [
    `[${slot}:v]setrange=tv`,
    `scale=1080:1920:force_original_aspect_ratio=increase`,
    `crop=1080:1920:(iw-1080)/2:(ih-1920)/2`,
    `fps=30`,
    `boxblur=3:1`,
    `eq=brightness=0.02:saturation=1.06:contrast=1.12`,
    `drawbox=x=60:y=196:w=610:h=156:color=black@0.34:t=fill:${enableAfter(0.04)}`,
    `drawbox=x=60:y=196:w=7:h=156:color=${ACCENT}@0.98:t=fill:${enableAfter(0.04)}`,
    `drawbox=x=60:y=196:w='if(lt(t\\,0.35)\\,1+(610-1)*t/0.35\\,610)':h=4:color=${ACCENT}@0.98:t=fill`,
    `drawtext=text='SOURCE CHECK':${fontOpt}:fontcolor=${ACCENT}:fontsize=24:x=${layout.textX}:y=${layout.kickerY}:${fadeIn(0.08, 0.2)}`,
    `drawtext=text='${label}':${fontOpt}:fontcolor=black@0.64:fontsize=${layout.labelFontSize}:x=${layout.textX + 3}:y=${layout.labelY + 3}:${fadeIn(0.18, 0.35)}`,
    `drawtext=text='${label}':${fontOpt}:fontcolor=white:fontsize=${layout.labelFontSize}:x=${layout.textX}:y=${layout.labelY}:${fadeIn(0.18, 0.35)}`,
    `drawtext=text='${sub}':${fontOpt}:fontcolor=white@0.78:fontsize=22:x=${layout.textX}:y=${layout.sublabelY}:${fadeIn(0.36, 0.25)}`,
    `drawtext=text=' VERIFIED ':${fontOpt}:fontcolor=black:fontsize=21:x=520:y=314:box=1:boxcolor=${ACCENT}@0.96:boxborderw=8:${fadeIn(0.45, 0.25)}`,
    trim,
    `format=yuv420p,setsar=1[v${slot}]`,
  ].join(",");
}

module.exports = { buildSourceCardFilter, buildFlashLaneSourceCardFilter, flashLaneSourceCardLayout };
