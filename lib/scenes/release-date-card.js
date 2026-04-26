/**
 * lib/scenes/release-date-card.js — release-date reveal scene.
 *
 * Full-screen card showing release info. Uses the same blurred-
 * trailer-frame backdrop language as the other cards so the video
 * has visual continuity but text-typography variety.
 *
 * Layout:
 *   - Backdrop: blurred trailer frame
 *   - Two amber accent lines (top + bottom of the date block)
 *   - Kicker: "RELEASE DATE" or "RELEASE WINDOW" small caps
 *   - Big date string at 144pt — the focal element
 *   - Sublabel: "UNCONFIRMED" / "DEVELOPER ESTIMATE" / etc.
 *   - Animation: lines grow 0–0.5s, kicker fades 0–0.4s,
 *     date scales+fades 0.4–1.0s, sublabel fades 0.9–1.3s
 */

"use strict";

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

function buildReleaseDateCardFilter({
  slot,
  duration,
  dateLabel,
  kicker = "RELEASE DATE",
  sublabel = "",
  fontOpt,
}) {
  const trim = `trim=duration=${duration},setpts=PTS-STARTPTS`;
  const date = ffEscape(String(dateLabel || "TBA").toUpperCase());
  const kick = ffEscape(String(kicker || "").toUpperCase());
  const sub = ffEscape(String(sublabel || "").toUpperCase());
  const dateFontSize =
    date.length > 14 ? 92 : date.length > 10 ? 108 : date.length > 7 ? 122 : 140;

  // Date fontsize is XXL — 140 px. The kicker + sublabel sit in
  // tighter weight to give the date the entire visual stage.
  return [
    `[${slot}:v]setrange=tv`,
    `scale=1080:1920:force_original_aspect_ratio=increase`,
    `crop=1080:1920:(iw-1080)/2:(ih-1920)/2`,
    // Force 30fps + matching timebase for xfade compat
    `fps=30`,
    `boxblur=18:5`,
    `eq=brightness=-0.32:saturation=0.5:contrast=1.05`,
    // Vignette
    `drawbox=x=0:y=0:w=iw:h=400:color=black@0.55:t=fill`,
    `drawbox=x=0:y=h-500:w=iw:h=500:color=black@0.55:t=fill`,
    // Top amber accent line — animated reveal
    `drawbox=x=(w-1)/2:y=h/2-180:w='if(lt(t\\,0.5)\\,1+(700-1)*t/0.5\\,700)':h=3:color=${ACCENT}@0.95:t=fill`,
    // Bottom amber accent line
    `drawbox=x=(w-1)/2:y=h/2+180:w='if(lt(t\\,0.5)\\,1+(700-1)*t/0.5\\,700)':h=3:color=${ACCENT}@0.95:t=fill`,
    // Kicker "RELEASE DATE" small caps in amber
    `drawtext=text='${kick}':${fontOpt}:fontcolor=${ACCENT}:fontsize=36:x=(w-tw)/2:y=h/2-130:${fadeIn(0, 0.4)}`,
    // Big date / known-unknown statement.
    `drawtext=text='${date}':${fontOpt}:fontcolor=black@0.7:fontsize=${dateFontSize}:x=(w-tw)/2+5:y=h/2-50+5:${fadeIn(0.4, 0.6)}`,
    `drawtext=text='${date}':${fontOpt}:fontcolor=white:fontsize=${dateFontSize}:x=(w-tw)/2:y=h/2-50:${fadeIn(0.4, 0.6)}`,
    // Sublabel
    sub
      ? `drawtext=text='${sub}':${fontOpt}:fontcolor=white@0.7:fontsize=32:x=(w-tw)/2:y=h/2+115:${fadeIn(0.9, 0.4)}`
      : null,
    trim,
    `format=yuv420p,setsar=1[v${slot}]`,
  ]
    .filter(Boolean)
    .join(",");
}

module.exports = { buildReleaseDateCardFilter };
