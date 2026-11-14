// A meme post (MEME_POSTS, src/funny/meme.ts): a well-known layout drawn as Pulse's own graphic around the owner's
// own stream frames. 1080x1350 (4:5), which Instagram, X and the Community tab all show whole.

import React from "react";
import { AbsoluteFill, Img } from "remotion";
import { COLOUR } from "./brand.ts";
import { BODY, DISPLAY } from "./components/fonts.ts";
import type { MemeLayout } from "../funny/meme.ts";

export const MEME_W = 1080;
export const MEME_H = 1350;

export type MemeProps = {
  layout: MemeLayout;
  lines: string[];
  /** Served image URLs, in the layout's order. */
  frames: string[];
  accent: string;
};

export const SAMPLE_MEME: MemeProps = {
  layout: "nobody_me",
  lines: ["Nobody:", "Me with a full tank and zero plan:"],
  frames: [],
  accent: COLOUR.amber,
};

const outline =
  "0 0 2px #000, 0 0 2px #000, 0 4px 0 #000, 0 -3px 0 #000, 3px 0 0 #000, -3px 0 0 #000, 0 8px 24px rgba(0,0,0,0.6)";

const Frame: React.FC<{ src?: string; style?: React.CSSProperties }> = ({
  src,
  style,
}) =>
  src ? (
    <Img
      src={src}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        display: "block",
        ...style,
      }}
    />
  ) : (
    <div
      style={{ width: "100%", height: "100%", background: "#222", ...style }}
    />
  );

const Watermark: React.FC<{ accent: string }> = ({ accent }) => (
  <div
    style={{
      position: "absolute",
      right: 28,
      bottom: 22,
      display: "flex",
      alignItems: "center",
      gap: 10,
      fontFamily: BODY,
      fontWeight: 800,
      fontSize: 30,
      color: "rgba(255,255,255,0.85)",
      textShadow: "0 2px 8px rgba(0,0,0,0.9)",
    }}
  >
    <span
      style={{ width: 14, height: 14, borderRadius: 7, background: accent }}
    />
    @PulseGMG
  </div>
);

const Plain: React.FC<{
  children: React.ReactNode;
  size?: number;
  align?: "left" | "center";
}> = ({ children, size = 58, align = "left" }) => (
  <div
    style={{
      fontFamily: BODY,
      fontWeight: 800,
      fontSize: size,
      lineHeight: 1.12,
      color: COLOUR.ink,
      textAlign: align,
    }}
  >
    {children}
  </div>
);

export const Meme: React.FC<MemeProps> = ({
  layout,
  lines,
  frames,
  accent,
}) => {
  const [a = "", b = "", c = ""] = lines;
  if (layout === "nobody_me")
    return (
      <AbsoluteFill style={{ background: COLOUR.paper }}>
        <div
          style={{
            padding: "56px 60px 36px",
            display: "flex",
            flexDirection: "column",
            gap: 26,
          }}
        >
          <Plain>{a}</Plain>
          <Plain>{b}</Plain>
        </div>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            top: 340,
          }}
        >
          <Frame src={frames[0]} />
          <Watermark accent={accent} />
        </div>
      </AbsoluteFill>
    );
  if (layout === "expectation_reality")
    return (
      <AbsoluteFill style={{ background: COLOUR.ink }}>
        <div
          style={{
            padding: "34px 40px 20px",
            fontFamily: DISPLAY,
            fontSize: 64,
            color: COLOUR.paper,
            textAlign: "center",
            textTransform: "uppercase",
          }}
        >
          {c}
        </div>
        {[0, 1].map((i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: 40,
              right: 40,
              top: 150 + i * 590,
              height: 560,
              borderRadius: 18,
              overflow: "hidden",
            }}
          >
            <Frame src={frames[i]} />
            <div
              style={{
                position: "absolute",
                left: 22,
                top: 22,
                padding: "8px 20px",
                borderRadius: 10,
                background: i === 0 ? COLOUR.paper : accent,
                color: COLOUR.ink,
                fontFamily: DISPLAY,
                fontSize: 52,
                letterSpacing: 2,
              }}
            >
              {i === 0 ? a : b}
            </div>
          </div>
        ))}
        <Watermark accent={accent} />
      </AbsoluteFill>
    );
  if (layout === "two_panel")
    return (
      <AbsoluteFill style={{ background: COLOUR.paper }}>
        {[0, 1].map((i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: i * 675,
              height: 675,
              display: "flex",
              borderTop: i ? `6px solid ${COLOUR.ink}` : undefined,
            }}
          >
            <div style={{ width: "50%", height: "100%" }}>
              <Frame src={frames[i]} />
            </div>
            <div
              style={{
                width: "50%",
                padding: "0 44px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                gap: 28,
              }}
            >
              <div
                style={{
                  fontFamily: DISPLAY,
                  fontSize: 120,
                  lineHeight: 1,
                  color: i === 0 ? COLOUR.alert : COLOUR.up,
                }}
              >
                {i === 0 ? "✗" : "✓"}
              </div>
              <Plain size={56}>{i === 0 ? a : b}</Plain>
            </div>
          </div>
        ))}
        <Watermark accent={accent} />
      </AbsoluteFill>
    );
  // top_bottom and pov: words over one frame.
  const big = (text: string, top: boolean) => (
    <div
      style={{
        position: "absolute",
        left: 40,
        right: 40,
        ...(top ? { top: 46 } : { bottom: 86 }),
        fontFamily: DISPLAY,
        fontSize: text.length > 26 ? 76 : 92,
        lineHeight: 1.04,
        color: "#fff",
        textAlign: "center",
        textTransform: "uppercase",
        textShadow: outline,
      }}
    >
      {text}
    </div>
  );
  return (
    <AbsoluteFill style={{ background: COLOUR.ink }}>
      <Frame src={frames[0]} />
      {big(a, true)}
      {big(b, false)}
      <Watermark accent={accent} />
    </AbsoluteFill>
  );
};
