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
 *   - Body: word-wrapped quote text at adaptive size, max 4 lines
 *   - Attribution: amber `— u/handle` + score with arrow glyph
 *   - Animation: glyph fades 0–0.4s, body lines stagger-fade
 *     0.4–1.4s, attribution fades 1.0–1.5s
 *
 * Wraps comment text in line-wrap that is more generous than the
 * overlay variant since the quote-card has the full canvas width.
 */

"use strict";

const ACCENT = "0xFF6B1A";
const QUOTE_SAFE_BODY_TOP = 620;
const QUOTE_SAFE_BODY_BOTTOM = 1180;

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
  for (const rawWord of words) {
    const w =
      rawWord.length > lineMax
        ? `${rawWord.slice(0, Math.max(1, lineMax - 3))}...`
        : rawWord;
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

function centredSafeBlockTop(lineCount, lineH) {
  const height = lineCount * lineH;
  const centred = Math.round(1920 / 2 - height / 2);
  const maxTop = QUOTE_SAFE_BODY_BOTTOM - height;
  return Math.max(QUOTE_SAFE_BODY_TOP, Math.min(centred, maxTop));
}

function buildQuoteBodyLayout(body) {
  const cleaned = String(body || "").replace(/\s+/g, " ").trim();
  const variants = [
    { lineMax: 28, fontSize: 46, lineH: 62, maxLines: 3 },
    { lineMax: 32, fontSize: 40, lineH: 54, maxLines: 4 },
    { lineMax: 36, fontSize: 34, lineH: 48, maxLines: 4 },
  ];

  for (const variant of variants) {
    const lines = wrapBody(cleaned, variant.lineMax);
    if (lines.length <= variant.maxLines) {
      const downgraded = cleaned
        .split(/\s+/)
        .some((word) => word.length > variant.lineMax);
      const blockTop = centredSafeBlockTop(lines.length, variant.lineH);
      return {
        ...variant,
        lines,
        truncated: false,
        downgraded,
        safeBounds: {
          top: QUOTE_SAFE_BODY_TOP,
          bottom: QUOTE_SAFE_BODY_BOTTOM,
        },
        blockTop,
        blockBottom: blockTop + lines.length * variant.lineH,
      };
    }
  }

  const fallback = variants[variants.length - 1];
  const maxChars = fallback.lineMax * fallback.maxLines - 3;
  const clipped = `${cleaned.slice(0, Math.max(0, maxChars)).trimEnd()}...`;
  const lines = wrapBody(clipped, fallback.lineMax).slice(0, fallback.maxLines);
  const blockTop = centredSafeBlockTop(lines.length, fallback.lineH);
  return {
    ...fallback,
    lines,
    truncated: true,
    downgraded: true,
    safeBounds: {
      top: QUOTE_SAFE_BODY_TOP,
      bottom: QUOTE_SAFE_BODY_BOTTOM,
    },
    blockTop,
    blockBottom: blockTop + lines.length * fallback.lineH,
  };
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
  const layout = buildQuoteBodyLayout(body);
  const lines = layout.lines;
  const handle = `— u/${clip(author || "Redditor", 18)}`;
  const scoreSuffix =
    Number.isFinite(Number(score)) && Number(score) > 0
      ? `   ↑${Number(score).toLocaleString()}`
      : "";
  const attribution = ffEscape(handle + scoreSuffix);

  // Body block is centred from the adaptive layout so longer quotes
  // reduce size before they hit the frame edge.
  const bodyParts = lines.map((line, i) => {
    const yPos = layout.blockTop + i * layout.lineH;
    // Stagger the per-line fade-in: each line starts 0.1s after the
    // previous, base start 0.4s
    const start = 0.4 + i * 0.1;
    return `drawtext=text='${ffEscape(line)}':${fontOpt}:fontcolor=white:fontsize=${layout.fontSize}:x=(w-tw)/2:y=${yPos}:${fadeIn(start, 0.4)}`;
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

module.exports = { buildQuoteCardFilter, wrapBody, buildQuoteBodyLayout };
