// Community posts for Facebook and Instagram, 1080x1350 (the 4:5 feed shape):
// "Which was better?" with both games split by a VS badge, "Guess the game"
// from a cropped screenshot, "Rate it out of 10", and an open question over
// a striking picture. Official screenshots, the Pulse lockup, no clutter.

import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { COLOUR } from "./brand.ts";
import { BODY, DISPLAY } from "./components/fonts.ts";

export type EngageFormat = "versus" | "guess" | "rate" | "question";

export type EngageProps = {
  format: EngageFormat;
  kicker: string; // "WHICH WAS BETTER?"
  question: string;
  images: string[]; // one, or two for versus
  labels: string[]; // game names under the pictures (empty for guess)
};

export const SAMPLE_ENGAGE: EngageProps = {
  format: "versus",
  kicker: "Which was better?",
  question: "Super Mario Bros. 3 or Super Mario World?",
  images: [],
  labels: ["Super Mario Bros. 3", "Super Mario World"],
};

const Lockup: React.FC = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
    <Img
      src={staticFile("logo.png")}
      style={{ width: 54, height: 54, borderRadius: 12 }}
    />
    <div
      style={{
        fontFamily: DISPLAY,
        fontSize: 44,
        color: COLOUR.paper,
        letterSpacing: 2,
      }}
    >
      PULSE<span style={{ color: COLOUR.amber }}>.</span>
    </div>
  </div>
);

const Pic: React.FC<{
  src?: string;
  style?: React.CSSProperties;
  zoom?: number;
}> = ({ src, style, zoom = 1 }) =>
  src ? (
    <div style={{ overflow: "hidden", background: COLOUR.ink, ...style }}>
      <Img
        src={src}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${zoom})`,
        }}
      />
    </div>
  ) : (
    <div style={{ background: "#1a1a22", ...style }} />
  );

const Label: React.FC<{ text: string; align?: "left" | "right"; top?: boolean }> = ({ text, align = "left", top = false }) => (
  <div
    style={{
      position: "absolute",
      [align]: 36,
      ...(top ? { top: 28 } : { bottom: 28 }),
      maxWidth: 760,
      padding: "10px 18px",
      background: "rgba(11,11,14,0.82)",
      borderLeft: align === "left" ? `6px solid ${COLOUR.amber}` : undefined,
      borderRight: align === "right" ? `6px solid ${COLOUR.amber}` : undefined,
      borderRadius: 8,
      fontFamily: DISPLAY,
      fontSize: text.length > 26 ? 40 : 52,
      lineHeight: 1.05,
      color: COLOUR.paper,
      textTransform: "uppercase",
    }}
  >
    {text}
  </div>
);

export const Engage: React.FC<EngageProps> = ({
  format,
  kicker,
  question,
  images,
  labels,
}) => {
  const header = (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        height: 250,
        padding: "34px 44px",
        background: COLOUR.ink,
        zIndex: 2,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Lockup />
        <div
          style={{
            background: COLOUR.amber,
            color: COLOUR.ink,
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 26,
            letterSpacing: 2,
            padding: "8px 16px",
            borderRadius: 8,
            textTransform: "uppercase",
          }}
        >
          {kicker}
        </div>
      </div>
      <div
        style={{
          marginTop: 24,
          fontFamily: BODY,
          fontWeight: 800,
          fontSize: question.length > 60 ? 38 : 46,
          lineHeight: 1.15,
          color: COLOUR.paper,
        }}
      >
        {question}
      </div>
    </div>
  );
  if (format === "versus") {
    return (
      <AbsoluteFill style={{ background: COLOUR.ink }}>
        {header}
        <div
          style={{
            position: "absolute",
            top: 250,
            left: 0,
            right: 0,
            height: 550,
          }}
        >
          <Pic src={images[0]} style={{ position: "absolute", inset: 0 }} />
          <Label text={labels[0] ?? ""} top />
        </div>
        <div
          style={{
            position: "absolute",
            top: 800,
            left: 0,
            right: 0,
            height: 550,
          }}
        >
          <Pic src={images[1]} style={{ position: "absolute", inset: 0 }} />
          <Label text={labels[1] ?? ""} align="right" />
        </div>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 796,
            height: 8,
            background: COLOUR.amber,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 540 - 78,
            top: 800 - 78,
            width: 156,
            height: 156,
            borderRadius: 78,
            background: COLOUR.amber,
            border: `8px solid ${COLOUR.ink}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: DISPLAY,
            fontSize: 72,
            color: COLOUR.ink,
            boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
          }}
        >
          VS
        </div>
      </AbsoluteFill>
    );
  }
  if (format === "guess") {
    return (
      <AbsoluteFill style={{ background: COLOUR.ink }}>
        {header}
        <Pic
          src={images[0]}
          zoom={1.6}
          style={{
            position: "absolute",
            top: 250,
            left: 0,
            right: 0,
            height: 960,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 140,
            background: COLOUR.ink,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: 32,
            color: COLOUR.muted,
            letterSpacing: 1,
          }}
        >
          Answer in the comments tomorrow
        </div>
      </AbsoluteFill>
    );
  }
  if (format === "rate") {
    return (
      <AbsoluteFill style={{ background: COLOUR.ink }}>
        {header}
        <Pic
          src={images[0]}
          style={{
            position: "absolute",
            top: 250,
            left: 0,
            right: 0,
            height: 900,
          }}
        />
        {labels[0] ? (
          <div
            style={{
              position: "absolute",
              top: 1030,
              left: 0,
              right: 0,
              height: 120,
            }}
          >
            <Label text={labels[0]} />
          </div>
        ) : null}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 200,
            background: COLOUR.ink,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
          }}
        >
          {Array.from({ length: 10 }, (_, i) => (
            <div
              key={i}
              style={{
                width: 82,
                height: 82,
                borderRadius: 14,
                border: `3px solid ${"rgba(255,255,255,0.3)"}`,
                color: COLOUR.paper,
                fontFamily: DISPLAY,
                fontSize: 44,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {i + 1}
            </div>
          ))}
        </div>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ background: COLOUR.ink }}>
      {header}
      <Pic
        src={images[0]}
        style={{ position: "absolute", top: 250, left: 0, right: 0, bottom: 0 }}
      />
      {labels[0] ? <Label text={labels[0]} /> : null}
    </AbsoluteFill>
  );
};
