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
  fontOpt,
}) {
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

module.exports = { buildSourceCardFilter };
