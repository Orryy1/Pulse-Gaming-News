// Words/Breaking (kind "report"): a TV news banner in the channel's colours, stacked for a phone. The
// REPORT tag snaps in, the headline banner wipes across with its lines rising through their masks and a
// glint passing over, and a ticker slides up beneath it crawling the credit and the headline. Generic (no
// network look or name), tagged ILLUSTRATION.
// primary: the headline (3-18 words, 110 characters at most); secondary: the outlet (optional, 36 at most).
import React from "react";
import { useCurrentFrame } from "remotion";
import { BODY, DISPLAY } from "../../fonts.ts";
import { COLOUR } from "../../../brand.ts";
import type { VGfxProps } from "../types.ts";
import { exitOf, onAccent, ramp, textW, txt, words, wrapEven } from "./kit.ts";

const W = 952;
const H = 500;
const STRAP_H = 62;
const EDGE = 16;
const PAD_X = 30;
const PAD_Y = 22;
const TICKER_H = 64;
const TICK_SIZE = 34;
const SIZES = [108, 98, 88, 80, 72, 66, 60, 54, 50];

type Layout = {
  lines: string[];
  size: number;
  lineH: number;
  outlet: string;
  bannerH: number;
  total: number;
};

export function layoutBreaking(v: VGfxProps["v"]): Layout | null {
  const headline = txt(v.primary).toUpperCase();
  const n = words(headline).length;
  if (n < 3 || n > 18 || headline.length > 110) return null;
  const outlet = txt(v.secondary).toUpperCase();
  if (outlet.length > 36) return null;
  for (const size of SIZES) {
    const lines = wrapEven(headline, "anton", size, W - EDGE - 2 * PAD_X);
    if (!lines || lines.length > 3) continue;
    const lineH = Math.round(size * 1.08);
    const bannerH = PAD_Y * 2 + lines.length * lineH;
    const total = STRAP_H + bannerH + TICKER_H;
    if (total <= H) return { lines, size, lineH, outlet, bannerH, total };
  }
  return null;
}

export const Breaking: React.FC<VGfxProps> = ({
  v,
  len,
  accent,
  variant = 0,
}) => {
  const frame = useCurrentFrame();
  const L = layoutBreaking(v);
  if (!L) return null;
  const { lines, size, lineH, outlet, bannerH, total } = L;
  const top = Math.round((H - total) / 3);
  const out = exitOf(frame, len);
  const gone = 1 - out;
  // Two colourways: a paper banner with ink type, or an ink banner with paper type.
  const light = variant % 2 === 0;
  const bannerBg = light ? COLOUR.paper : "#141418";
  const bannerInk = light ? COLOUR.ink : COLOUR.paper;
  const tagInk = onAccent(accent);

  const tag = ramp(frame, 0, 6);
  const wipe = ramp(frame, 2, 10);
  const ticker = ramp(frame, 8, 14);
  const glint = (frame - 12) / 12;

  // The crawl: the credit and the headline, round and round, bullets between.
  const parts = [
    outlet ? `AS REPORTED BY ${outlet}` : "",
    lines.join(" "),
  ].filter(Boolean);
  const loopW = parts.reduce((s, p) => s + textW(p, "inter800", TICK_SIZE, 1) + 70, 0);
  const reps = Math.ceil((W + Math.max(0, len) * 5) / Math.max(200, loopW)) + 1;
  const crawl = Array.from({ length: reps }, () => parts).flat();
  const shift = -Math.max(0, frame - 10) * 5;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top,
        width: W,
        height: total,
        clipPath: `inset(-40px ${0}px -40px ${gone * 100}%)`,
        opacity: Math.min(1, out * 2),
      }}
    >
      {/* The strap: REPORT on the left, ILLUSTRATION on the right. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: W,
          height: STRAP_H,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          paddingBottom: 8,
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            background: accent,
            color: tagInk,
            fontFamily: DISPLAY,
            fontSize: 44,
            lineHeight: "54px",
            height: 54,
            padding: "0 20px",
            letterSpacing: 2,
            clipPath: `inset(0 ${(1 - tag) * 100}% 0 0)`,
            transform: `translateX(${(1 - tag) * -30}px)`,
          }}
        >
          REPORT
        </div>
        <div
          style={{
            padding: "5px 12px 4px",
            borderRadius: 6,
            background: "rgba(11,11,14,0.78)",
            border: "2px solid rgba(245,245,242,0.55)",
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: 30,
            letterSpacing: 2,
            lineHeight: 1.1,
            color: "rgba(245,245,242,0.88)",
            opacity: ramp(frame, 8, 14),
          }}
        >
          ILLUSTRATION
        </div>
      </div>

      {/* The banner. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: STRAP_H,
          width: W,
          height: bannerH,
          clipPath: `inset(0 ${(1 - wipe) * 100}% 0 0)`,
          boxShadow: "0 26px 60px rgba(0,0,0,0.55)",
          background: bannerBg,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: EDGE,
            background: accent,
          }}
        />
        <div style={{ position: "absolute", left: EDGE + PAD_X, top: PAD_Y }}>
          {lines.map((l, i) => {
            const p = ramp(frame, 5 + i * 2, 12 + i * 2);
            return (
              <div key={i} style={{ height: lineH, overflow: "hidden" }}>
                <div
                  style={{
                    fontFamily: DISPLAY,
                    fontSize: size,
                    lineHeight: `${lineH}px`,
                    color: bannerInk,
                    whiteSpace: "nowrap",
                    transform: `translateY(${(1 - p) * lineH}px)`,
                  }}
                >
                  {l}
                </div>
              </div>
            );
          })}
        </div>
        {glint > 0 && glint < 1 ? (
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: -260 + glint * (W + 400),
              width: 160,
              transform: "skewX(-20deg)",
              background: `linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,${light ? 0.55 : 0.16}) 50%, rgba(255,255,255,0) 100%)`,
            }}
          />
        ) : null}
      </div>

      {/* The ticker, sliding up from behind the banner. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: STRAP_H + bannerH,
          width: W,
          height: TICKER_H,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(11,11,14,0.95)",
            transform: `translateY(${(1 - ticker) * -TICKER_H}px)`,
            display: "flex",
            alignItems: "center",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: 64,
              background: accent,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 2,
            }}
          >
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: 9,
                background: tagInk,
                opacity: 0.55 + 0.45 * Math.abs(Math.cos(frame / 9)),
              }}
            />
          </div>
          <div
            style={{
              position: "absolute",
              left: 64 + 26,
              whiteSpace: "nowrap",
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: TICK_SIZE,
              letterSpacing: 1,
              color: COLOUR.paper,
              transform: `translateX(${shift}px)`,
            }}
          >
            {crawl.map((p, i) => (
              <span key={i}>
                {p}
                <span style={{ color: accent, margin: "0 26px" }}>{"•"}</span>
              </span>
            ))}
          </div>
          <div
            style={{
              position: "absolute",
              right: 0,
              top: 0,
              bottom: 0,
              width: 80,
              background:
                "linear-gradient(90deg, rgba(11,11,14,0) 0%, rgba(11,11,14,0.95) 100%)",
            }}
          />
        </div>
      </div>
    </div>
  );
};

export const fitsBreaking = (v: VGfxProps["v"]) => layoutBreaking(v) !== null;
