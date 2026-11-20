// Words/Alert (kind "report"): a phone's news-alert notification at full card size, no phone drawn. It
// drops in from above with a small haptic buzz, a blank notification settles in behind it, the headline
// rises line by line and the credit sits at its foot. Generic (no maker or app brand), tagged ILLUSTRATION.
// primary: the headline (3-18 words, 110 characters at most); secondary: the outlet (optional, 36 at most).
import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { BODY } from "../../fonts.ts";
import type { VGfxProps } from "../types.ts";
import { exitOf, onAccent, ramp, shadow, textW, txt, words, wrapEven } from "./kit.ts";

const W = 952;
const H = 500;
const PAD_X = 40;
const PAD_Y = 30;
const HEAD_H = 60;
const GHOST = 22;
const CREDIT = 34;
const SIZES = [76, 70, 64, 60, 56, 52, 48, 44, 40];
const TAG = 30;

type Layout = {
  lines: string[];
  size: number;
  lineH: number;
  credit: string;
  cardH: number;
};

export function layoutAlert(v: VGfxProps["v"]): Layout | null {
  const headline = txt(v.primary);
  const n = words(headline).length;
  if (n < 3 || n > 18 || headline.length > 110) return null;
  const outlet = txt(v.secondary);
  if (outlet.length > 36) return null;
  const credit = outlet ? `As reported by ${outlet}` : "";
  if (credit && textW(credit, "inter800", CREDIT) > W - 2 * PAD_X) return null;
  for (const size of SIZES) {
    const lines = wrapEven(headline, "inter800", size, W - 2 * PAD_X);
    if (!lines || lines.length > 4) continue;
    const lineH = Math.round(size * 1.14);
    const cardH =
      PAD_Y +
      HEAD_H +
      16 +
      lines.length * lineH +
      (credit ? 14 + CREDIT + 6 : 0) +
      PAD_Y +
      4;
    if (cardH + GHOST <= H) return { lines, size, lineH, credit, cardH };
  }
  return null;
}

/** The app's mark: a rounded accent square with a pulse line, generic and drawn in code. */
const AppIcon: React.FC<{ size: number; accent: string }> = ({
  size,
  accent,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 48 48"
    style={{ flex: "0 0 auto" }}
  >
    <rect width={48} height={48} rx={12} fill={accent} />
    <polyline
      points="7,26 16,26 20,15 27,35 31,22 34,26 41,26"
      fill="none"
      stroke={onAccent(accent)}
      strokeWidth={4}
      strokeLinejoin="round"
      strokeLinecap="round"
    />
  </svg>
);

export const Alert: React.FC<VGfxProps> = ({ v, len, accent, variant = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = layoutAlert(v);
  if (!L) return null;
  const { lines, size, lineH, credit, cardH } = L;
  const total = cardH + GHOST;
  const top = Math.round((H - total) / 3);
  const out = exitOf(frame, len);
  const dark = variant % 2 === 1;
  const face = dark ? "rgba(30,30,35,0.97)" : "rgba(247,247,249,0.98)";
  const ink = dark ? "#F5F5F2" : "#111114";
  const soft = dark ? "rgba(245,245,242,0.62)" : "rgba(17,17,20,0.55)";

  const drop = spring({
    frame,
    fps,
    config: { damping: 13, stiffness: 260, mass: 0.55 },
  });
  const ghost = spring({
    frame: frame - 6,
    fps,
    config: { damping: 16, stiffness: 300, mass: 0.5 },
  });
  // The haptic buzz as it lands: a few px side to side, dying away.
  const buzzT = frame - 8;
  const buzz =
    buzzT >= 0 && buzzT < 8 ? Math.sin(buzzT * 2.6) * 6 * (1 - buzzT / 8) : 0;
  const creditIn = ramp(frame, 10, 16);

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top,
        width: W,
        height: total,
        opacity: out,
        transform: `translateY(${-(1 - out) * 90}px)`,
      }}
    >
      {/* The notification behind: blank, narrower, peeking out under the card. */}
      <div
        style={{
          position: "absolute",
          left: 34,
          right: 34,
          top: cardH - 60 + GHOST * ghost,
          height: 60,
          borderRadius: 30,
          background: dark ? "rgba(30,30,35,0.7)" : "rgba(235,235,240,0.72)",
          boxShadow: shadow(0.6),
          opacity: ghost,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: W,
          height: cardH,
          borderRadius: 42,
          background: face,
          boxShadow:
            "0 30px 70px rgba(0,0,0,0.55), 0 2px 0 rgba(255,255,255,0.12) inset",
          opacity: Math.min(1, drop * 2.5),
          transform: `translate(${buzz}px, ${(1 - drop) * -130}px) scale(${0.95 + 0.05 * drop})`,
          transformOrigin: "50% 0%",
          padding: `${PAD_Y}px ${PAD_X}px`,
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            height: HEAD_H,
          }}
        >
          <AppIcon size={58} accent={accent} />
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: TAG,
              letterSpacing: 2,
              color: soft,
              flex: 1,
              whiteSpace: "nowrap",
            }}
          >
            NEWS ALERT
          </div>
          <div
            style={{
              padding: "4px 12px 3px",
              borderRadius: 8,
              border: `2px solid ${soft}`,
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: TAG,
              letterSpacing: 2,
              lineHeight: 1.1,
              color: soft,
              whiteSpace: "nowrap",
            }}
          >
            ILLUSTRATION
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          {lines.map((l, i) => {
            const p = ramp(frame, 4 + i * 2, 10 + i * 2);
            return (
              <div key={i} style={{ height: lineH, overflow: "hidden" }}>
                <div
                  style={{
                    fontFamily: BODY,
                    fontWeight: 800,
                    fontSize: size,
                    lineHeight: `${lineH}px`,
                    color: ink,
                    whiteSpace: "nowrap",
                    transform: `translateY(${(1 - p) * lineH * 0.9}px)`,
                  }}
                >
                  {l}
                </div>
              </div>
            );
          })}
        </div>
        {credit ? (
          <div
            style={{
              marginTop: 14,
              display: "flex",
              alignItems: "center",
              gap: 14,
              height: CREDIT + 6,
              opacity: creditIn,
              transform: `translateY(${(1 - creditIn) * 10}px)`,
            }}
          >
            <div
              style={{
                width: 8,
                height: 30,
                borderRadius: 4,
                background: accent,
              }}
            />
            <div
              style={{
                fontFamily: BODY,
                fontWeight: 800,
                fontSize: CREDIT,
                color: soft,
                whiteSpace: "nowrap",
              }}
            >
              {credit}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export const fitsAlert = (v: VGfxProps["v"]) => layoutAlert(v) !== null;
