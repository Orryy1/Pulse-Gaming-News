// Screen pack, "Broadcast": the story as a TV news package in the channel's own colours. A REPORT tag
// and the headline land on a lower-third banner over the dimmed picture, a ticker crawls along the foot
// carrying the outlet and year, a small clock bug sits at the ticker's left. Generic, tagged ILLUSTRATION.
import React from "react";
import { AbsoluteFill, interpolate, spring } from "remotion";
import { COLOUR } from "../../../brand.ts";
import { SPRING } from "../../../motion.ts";
import { BODY, DISPLAY } from "../../fonts.ts";
import { useStage } from "../../DocGraphics.tsx";
import { TextureBackground } from "../../Backgrounds.tsx";
import type { GfxProps } from "../types.ts";
import type { MomentGraphic } from "../../LongMoments.tsx";
import { clamp, easeOut, sizeByLength, txt, wordCount } from "./common.ts";
import { LOWER_THIRD } from "../fit.ts";

const SIDE = 96;
const WIDTH = 1920 - SIDE * 2;
const TICKER_H = 60;
// The ticker sits above the lower third, where the documentary's chapter tag and title bar live: at 72 px
// it ran over them and the check read both as garbled (30 Oct 2026).
const TICKER_BOTTOM = LOWER_THIRD;

/** Splits the headline into lines of roughly equal length so each can rise through its own mask. */
function balance(text: string, perLine: number): string[] {
  const words = text.split(" ");
  const lines = Math.max(1, Math.ceil(text.length / perLine));
  if (lines === 1) return [text];
  const target = text.length / lines;
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && next.length > target * 1.08 && out.length < lines - 1) {
      out.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

export const Broadcast: React.FC<GfxProps> = ({ g, len, bg, variant = 0 }) => {
  const { frame, fps, showFor, dim, visible } = useStage(len, 200);
  const headline = txt(g.primary).toUpperCase();
  const secondary = txt(g.secondary).toUpperCase();
  if (!visible || !headline) return null;

  // Two colourways: a paper banner with ink type, or an ink banner with paper type.
  const light = variant % 2 === 0;
  const size = sizeByLength(headline.length, [
    [30, 96],
    [48, 84],
    [70, 72],
    [96, 62],
    [999, 54],
  ]);
  // Anton runs about 0.43 em a character in capitals (0.44 for slack); the banner hugs its text, at
  // most the safe width less its padding.
  const perLine = Math.max(10, Math.floor((WIDTH - 110) / (size * 0.44)));
  const lines = balance(headline, perLine);

  const rule = interpolate(frame, [2, 14], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const tag = spring({ frame: frame - 4, fps, config: SPRING.SNAP });
  const wipe = interpolate(frame, [7, 22], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const ticker = spring({ frame: frame - 12, fps, config: SPRING.ENTER });
  const note = interpolate(frame, [22, 32], [0, 1], clamp);
  const sweep = interpolate(frame, [26, 52], [-30, 130], clamp);
  const out = interpolate(frame, [showFor - 12, showFor], [0, 1], {
    ...clamp,
    easing: easeOut,
  });

  // The crawl: the outlet and year, then the headline, round and round; it starts already moving.
  const segments = [secondary, headline].filter(Boolean);
  const crawl = Array.from({ length: 8 }, () => segments).flat();
  const crawlX = 40 - Math.max(0, frame - 10) * 3.6;
  const colonOn = Math.floor(frame / 15) % 2 === 0;

  const ink = light ? COLOUR.ink : COLOUR.paper;
  const plate = light
    ? "linear-gradient(180deg, #FFFFFF 0%, #EEEEE9 100%)"
    : "linear-gradient(180deg, rgba(26,26,32,0.96) 0%, rgba(12,12,16,0.96) 100%)";

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {bg ? (
        <AbsoluteFill style={{ opacity: dim }}>
          <TextureBackground kind={bg} variant={variant} />
        </AbsoluteFill>
      ) : null}
      {/* The picture stays the picture: darkened towards the foot so the graphics sit on it. */}
      <AbsoluteFill
        style={{
          opacity: dim,
          background:
            "linear-gradient(180deg, rgba(11,11,14,0.18) 0%, rgba(11,11,14,0.28) 45%, rgba(11,11,14,0.78) 78%, rgba(11,11,14,0.92) 100%)",
        }}
      />
      <AbsoluteFill
        style={{ opacity: dim, transform: `translateY(${out * 24}px)` }}
      >
        <div
          style={{
            position: "absolute",
            left: SIDE,
            minWidth: 860,
            maxWidth: WIDTH,
            bottom: TICKER_BOTTOM + TICKER_H + 16,
          }}
        >
          {/* The strap above the banner: the REPORT tag on the left, the ILLUSTRATION note on the right. */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              gap: 24,
            }}
          >
            <div
              style={{
                overflow: "hidden",
                clipPath: `inset(0 ${(1 - tag) * 100}% 0 0)`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "9px 20px 8px",
                  background: COLOUR.amber,
                  fontFamily: BODY,
                  fontWeight: 900,
                  fontSize: 28,
                  letterSpacing: 5,
                  color: COLOUR.ink,
                }}
              >
                <div
                  style={{
                    width: 0,
                    height: 0,
                    borderTop: "9px solid transparent",
                    borderBottom: "9px solid transparent",
                    borderLeft: `13px solid ${COLOUR.ink}`,
                  }}
                />
                REPORT
              </div>
            </div>
            <div
              style={{
                marginBottom: 10,
                padding: "5px 12px",
                borderRadius: 6,
                border: "1.5px solid rgba(245,245,242,0.55)",
                background: "rgba(11,11,14,0.55)",
                fontFamily: BODY,
                fontWeight: 800,
                fontSize: 22,
                letterSpacing: 3,
                color: "rgba(245,245,242,0.85)",
                opacity: note,
              }}
            >
              ILLUSTRATION
            </div>
          </div>
          {/* The amber rule draws first, then the banner wipes open behind it. */}
          <div
            style={{
              height: 6,
              width: `${rule * 100}%`,
              background: COLOUR.amber,
            }}
          />
          <div
            style={{
              position: "relative",
              overflow: "hidden",
              background: plate,
              clipPath: `inset(0 ${(1 - wipe) * 100}% 0 0)`,
              boxShadow: "0 30px 80px rgba(0,0,0,0.55)",
              padding: `${Math.round(size * 0.3)}px 48px ${Math.round(size * 0.34)}px 54px`,
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: 16,
                background: COLOUR.amber,
              }}
            />
            {lines.map((line, i) => {
              const rise = spring({
                frame: frame - 9 - i * 4,
                fps,
                config: SPRING.ENTER,
              });
              return (
                <div key={i} style={{ overflow: "hidden" }}>
                  <div
                    style={{
                      fontFamily: DISPLAY,
                      fontSize: size,
                      lineHeight: 1.08,
                      color: ink,
                      letterSpacing: 0.5,
                      whiteSpace: "normal",
                      transform: `translateY(${(1 - rise) * 105}%)`,
                    }}
                  >
                    {line}
                  </div>
                </div>
              );
            })}
            {/* One glint across the banner as it settles. */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: `linear-gradient(105deg, transparent ${sweep - 14}%, ${light ? "rgba(255,255,255,0.65)" : "rgba(255,255,255,0.12)"} ${sweep}%, transparent ${sweep + 14}%)`,
              }}
            />
          </div>
        </div>

        {/* The ticker: a clock bug at the left, the crawl running under a fade at each end. */}
        <div
          style={{
            position: "absolute",
            left: SIDE,
            width: WIDTH,
            bottom: TICKER_BOTTOM,
            height: TICKER_H,
            display: "flex",
            background: "rgba(10,10,13,0.94)",
            borderTop: `2px solid ${COLOUR.amber}`,
            opacity: ticker,
            transform: `translateY(${(1 - ticker) * 40}px)`,
            boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          }}
        >
          <div
            style={{
              flex: "0 0 auto",
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "0 24px",
              background: light ? COLOUR.amber : COLOUR.paper,
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: 32,
              color: COLOUR.ink,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: 6,
                background: COLOUR.ink,
                opacity:
                  0.55 + 0.45 * Math.cos((frame / fps) * Math.PI * 2) ** 2,
              }}
            />
            <span>
              9<span style={{ opacity: colonOn ? 1 : 0.25 }}>:</span>41
            </span>
          </div>
          <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: 0,
                display: "flex",
                alignItems: "center",
                whiteSpace: "nowrap",
                transform: `translateX(${crawlX}px)`,
                fontFamily: BODY,
                fontWeight: 800,
                fontSize: 30,
                letterSpacing: 1.5,
                color: COLOUR.paper,
              }}
            >
              {crawl.map((s, i) => (
                <React.Fragment key={i}>
                  <span>{s}</span>
                  <span
                    style={{
                      display: "inline-block",
                      width: 12,
                      height: 12,
                      margin: "0 30px",
                      background: COLOUR.amber,
                      transform: "rotate(45deg)",
                    }}
                  />
                </React.Fragment>
              ))}
            </div>
            <div
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "linear-gradient(90deg, rgba(10,10,13,1) 0%, rgba(10,10,13,0) 4%, rgba(10,10,13,0) 92%, rgba(10,10,13,1) 100%)",
              }}
            />
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** A headline of 3 to 14 words that fits two or three banner lines. */
export const fitsBroadcast = (g: MomentGraphic) => {
  const h = txt(g.primary);
  const n = wordCount(h);
  return n >= 3 && n <= 14 && h.length <= 120 && txt(g.secondary).length <= 80;
};
