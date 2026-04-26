/**
 * lib/scenes/quote-card.js — full-screen Reddit/community quote scene.
 *
 * Full-screen, theatrical version of the comment swoop overlay.
 * Where the overlay sits on top of a clip and shares attention,
 * the quote-card is a dedicated scene that gives the quote the
 * full canvas — the way creator studios cut to a "REACTION" beat.
 *
 * Layout:
 *   - Backdrop: blurred + heavily-darkened trailer frame
 *     (deeper darken than other cards so the quote pops)
 *   - Top: large amber `"` glyph
 *   - Body: word-wrapped quote text at 38pt, max ~6 lines
 *   - Attribution: amber `— u/handle` + score with arrow glyph
 *   - Animation: glyph fades 0–0.4s, body lines stagger-fade
 *     0.4–1.4s, attribution fades 1.0–1.5s
 *
 * Wraps comment text in line-wrap that is more generous than the
 * overlay variant since the quote-card has the full canvas width.
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

function clip(s, n) {
  const v = String(s ?? "");
  if (v.length <= n) return v;
  return v.slice(0, Math.max(0, n - 1)).trimEnd() + "…";
}

/**
 * Word-wrap the body text. Quote-card uses a tighter wrap than the
 * overlay to give a "literary" feel — slightly shorter line length
 * so the text sits in a clean column.
 */
function wrapBody(text, lineMax = 26) {
  const words = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    const candidate = (cur ? cur + " " : "") + w;
    if (candidate.length > lineMax) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = candidate;
    }
  }
  if (cur) lines.push(cur);

  // Anti-orphan: fold short trailing lines back if they fit.
  while (lines.length >= 2) {
    const last = lines[lines.length - 1];
    const lastWords = last.split(/\s+/).filter(Boolean);
    const lastShort = lastWords.length <= 2 || last.length <= 6;
    const prevHasRoom =
      (lines[lines.length - 2] + " " + last).length <= lineMax + 6;
    if (lastShort && prevHasRoom) {
      lines[lines.length - 2] = `${lines[lines.length - 2]} ${last}`;
      lines.pop();
    } else {
      break;
    }
  }
  return lines;
}

/**
 * Build the quote-card filter chain.
 *
 * @param {object} args
 * @param {number} args.slot
 * @param {number} args.duration
 * @param {string} args.body              quote text
 * @param {string} args.author            no `u/` prefix needed
 * @param {number} [args.score]
 * @param {string} args.fontOpt
 */
function buildQuoteCardFilter({
  slot,
  duration,
  body,
  author,
  score,
  fontOpt,
}) {
  const trim = `trim=duration=${duration},setpts=PTS-STARTPTS`;
  const lines = wrapBody(body, 26);
  const handle = `— u/${clip(author || "Redditor", 18)}`;
  const scoreSuffix =
    Number.isFinite(Number(score)) && Number(score) > 0
      ? `   ↑${Number(score).toLocaleString()}`
      : "";
  const attribution = ffEscape(handle + scoreSuffix);

  // Body block centred vertically. With up to 6 lines × 56px line-height,
  // the block is up to ~336px tall, sat between y=h/2-200 and y=h/2+136.
  const lineH = 56;
  const blockTop = 1920 / 2 - 220 + 60; // 60 = glyph + gap above body

  const bodyParts = lines.slice(0, 6).map((line, i) => {
    const yPos = blockTop + i * lineH;
    // Stagger the per-line fade-in: each line starts 0.1s after the
    // previous, base start 0.4s
    const start = 0.4 + i * 0.1;
    return `drawtext=text='${ffEscape(line)}':${fontOpt}:fontcolor=white:fontsize=42:x=(w-tw)/2:y=${yPos}:${fadeIn(start, 0.4)}`;
  });

  return [
    `[${slot}:v]setrange=tv`,
    `scale=1080:1920:force_original_aspect_ratio=increase`,
    `crop=1080:1920:(iw-1080)/2:(ih-1920)/2`,
    // Force 30fps + matching timebase for xfade compat
    `fps=30`,
    // Heavier blur + darker overlay than other cards so the quote
    // sits centre-stage.
    `boxblur=24:8`,
    `eq=brightness=-0.45:saturation=0.4:contrast=1.05`,
    `drawbox=x=0:y=0:w=iw:h=ih:color=black@0.25:t=fill`,
    // Vignette top + bottom for legibility band
    `drawbox=x=0:y=0:w=iw:h=350:color=black@0.5:t=fill`,
    `drawbox=x=0:y=h-450:w=iw:h=450:color=black@0.5:t=fill`,
    // Big amber opening-quote glyph
    `drawtext=text='\\"':${fontOpt}:fontcolor=${ACCENT}:fontsize=180:x=(w-tw)/2:y=h/2-380:${fadeIn(0, 0.4)}`,
    ...bodyParts,
    // Attribution near bottom
    `drawtext=text='${attribution}':${fontOpt}:fontcolor=${ACCENT}:fontsize=34:x=(w-tw)/2:y=h/2+260:${fadeIn(1.0, 0.5)}`,
    trim,
    `format=yuv420p,setsar=1[v${slot}]`,
  ].join(",");
}

module.exports = { buildQuoteCardFilter, wrapBody };
